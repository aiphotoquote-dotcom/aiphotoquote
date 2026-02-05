// src/app/api/onboarding/analyze-website/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray(r.rows)) return r.rows[0] ?? null;
  return null;
}

async function requireAuthed(): Promise<{ clerkUserId: string }> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return { clerkUserId: userId };
}

async function requireMembership(clerkUserId: string, tenantId: string): Promise<void> {
  const r = await db.execute(sql`
    select 1 as ok
    from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${clerkUserId}
    limit 1
  `);
  const row = firstRow(r);
  if (!row?.ok) throw new Error("FORBIDDEN_TENANT");
}

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  if (t.length <= max) return t;
  return t.slice(0, max);
}

function normalizeUrl(raw: string) {
  const s = safeTrim(raw);
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function stripHtmlToText(html: string) {
  // Basic + fast: remove script/style, tags, collapse whitespace.
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const noTags = withoutScripts.replace(/<[^>]+>/g, " ");
  const decoded = noTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return decoded.replace(/\s+/g, " ").trim();
}

function buildCandidateUrls(raw: string): string[] {
  const s = safeTrim(raw);
  if (!s) return [];

  // If they provided a full URL, also try a couple normalized variants.
  // If they provided only a host, generate http/https and www/no-www.
  let host = s;
  let hadScheme = false;

  if (/^https?:\/\//i.test(host)) {
    hadScheme = true;
    try {
      const u = new URL(host);
      host = u.host || host.replace(/^https?:\/\//i, "");
    } catch {
      host = host.replace(/^https?:\/\//i, "");
    }
  }

  host = host.replace(/\/+$/g, "");
  host = host.replace(/^www\./i, (m) => m.toLowerCase()); // normalize

  const bareHost = host.replace(/^www\./i, "");
  const wwwHost = bareHost.startsWith("www.") ? bareHost : `www.${bareHost}`;

  // Prefer https first
  const candidates = [
    `https://${bareHost}`,
    `https://${wwwHost}`,
    `http://${bareHost}`,
    `http://${wwwHost}`,
  ];

  // If original was a full URL, try it first (with path)
  if (hadScheme) {
    candidates.unshift(normalizeUrl(s));
  }

  // Dedup while preserving order
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

type FetchDebug = {
  attempted: Array<{
    url: string;
    ok: boolean;
    status: number;
    statusText?: string;
    contentType: string;
    finalUrl?: string;
    bytes: number;
    extractedChars: number;
    note?: string;
  }>;
  chosenUrl?: string;
  chosenFinalUrl?: string;
  chosenStatus?: number;
  chosenContentType?: string;
  chosenExtractedChars?: number;
};

async function fetchOne(url: string) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);

  // Realistic browser-ish headers (many sites will serve empty/blocked HTML to bot UAs)
  const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache",
        // NOTE: Adding sec-fetch headers can help sometimes, but can also hurt.
      },
    });

    const ct = String(res.headers.get("content-type") ?? "");
    const isHtml = ct.includes("text/html") || ct.includes("application/xhtml+xml");

    const raw = await res.text().catch(() => "");
    const bytes = Buffer.byteLength(raw || "", "utf8");

    const text = isHtml ? stripHtmlToText(raw) : raw;
    const clipped = clamp(text, 12_000);

    // If the site is JS-rendered, stripped text can be tiny.
    // We still return it, but mark it for diagnostics.
    const extractedChars = clipped.length;

    const finalUrl = (res as any)?.url ? String((res as any).url) : undefined;

    return {
      ok: res.ok,
      status: res.status,
      statusText: (res as any)?.statusText ? String((res as any).statusText) : undefined,
      contentType: ct,
      finalUrl,
      rawBytes: bytes,
      extractedText: clipped,
      extractedTextPreview: clamp(clipped, 900),
      note:
        !res.ok
          ? "HTTP not ok"
          : extractedChars < 200
          ? "Very little extractable text (JS-rendered site or blocking likely)"
          : undefined,
    };
  } finally {
    clearTimeout(t);
  }
}

async function fetchWebsiteTextSmart(rawUrl: string) {
  const candidates = buildCandidateUrls(rawUrl);
  const debug: FetchDebug = { attempted: [] };

  let best: any | null = null;

  for (const url of candidates) {
    try {
      const r = await fetchOne(url);

      debug.attempted.push({
        url,
        ok: Boolean(r.ok),
        status: Number(r.status ?? 0),
        statusText: r.statusText,
        contentType: String(r.contentType ?? ""),
        finalUrl: r.finalUrl,
        bytes: Number(r.rawBytes ?? 0),
        extractedChars: Number(r.extractedText?.length ?? 0),
        note: r.note,
      });

      // Choose first successful response with meaningful text.
      if (r.ok && (r.extractedText?.length ?? 0) >= 200) {
        best = r;
        break;
      }

      // Otherwise, keep the "best so far":
      // - any OK response beats non-OK
      // - higher extracted chars beats lower
      if (!best) best = r;
      else {
        const bestOk = Boolean(best.ok);
        const curOk = Boolean(r.ok);
        const bestLen = Number(best.extractedText?.length ?? 0);
        const curLen = Number(r.extractedText?.length ?? 0);

        if (curOk && !bestOk) best = r;
        else if (curOk === bestOk && curLen > bestLen) best = r;
      }
    } catch (e: any) {
      debug.attempted.push({
        url,
        ok: false,
        status: 0,
        statusText: "",
        contentType: "",
        bytes: 0,
        extractedChars: 0,
        note: `Fetch error: ${e?.message ?? String(e)}`,
      });
    }
  }

  if (!best) {
    return {
      extractedText: "",
      extractedTextPreview: "",
      fetchDebug: debug,
    };
  }

  debug.chosenUrl = candidates[0] || rawUrl;
  debug.chosenFinalUrl = best.finalUrl;
  debug.chosenStatus = best.status;
  debug.chosenContentType = best.contentType;
  debug.chosenExtractedChars = Number(best.extractedText?.length ?? 0);

  return {
    extractedText: String(best.extractedText ?? ""),
    extractedTextPreview: String(best.extractedTextPreview ?? ""),
    fetchDebug: debug,
  };
}

const AnalysisSchema = z.object({
  businessGuess: z.string().min(1),
  fit: z.enum(["good", "maybe", "poor"]),
  fitReason: z.string().min(1),
  suggestedIndustryKey: z.string().min(1),
  questions: z.array(z.string()).min(1).max(6),
  confidenceScore: z.number().min(0).max(1),
  needsConfirmation: z.boolean(),
  detectedServices: z.array(z.string()).default([]),
  billingSignals: z.array(z.string()).default([]),
});

function buildSystemPrompt() {
  return [
    "You are onboarding intelligence for AIPhotoQuote.",
    "Your job: read a business website text and produce an explain-back summary and fit assessment.",
    "",
    "Rules:",
    "- Be specific about what the business does (what they service + top services).",
    "- If uncertain, say so and ask clarifying questions.",
    "- Keep it customer-friendly and non-salesy.",
    "- Output MUST be valid JSON matching the schema requested.",
    "- confidenceScore is 0..1 and should reflect how certain you are.",
    "- needsConfirmation should be true when confidenceScore < 0.8.",
  ].join("\n");
}

function buildUserPrompt(args: {
  url: string;
  extractedText: string;
  prior?: any | null;
  correction?: { answer: "yes" | "no"; feedback?: string } | null;
}) {
  const { url, extractedText, prior, correction } = args;

  const priorBlock = prior
    ? `PRIOR_ANALYSIS_JSON:\n${JSON.stringify(prior, null, 2)}\n`
    : `PRIOR_ANALYSIS_JSON:\n(null)\n`;

  const correctionBlock = correction
    ? `USER_CONFIRMATION:\n${JSON.stringify(correction, null, 2)}\n`
    : `USER_CONFIRMATION:\n(null)\n`;

  return [
    `WEBSITE_URL: ${url}`,
    "",
    priorBlock,
    correctionBlock,
    "WEBSITE_TEXT (clipped):",
    extractedText || "(no text extracted)",
    "",
    "TASK:",
    "1) Write businessGuess: 2-5 sentences describing what the business likely does (what they service + top services).",
    "2) Decide fit: good/maybe/poor for using photo-based quoting.",
    "3) Provide fitReason: 1-3 sentences.",
    "4) Pick suggestedIndustryKey (short snake-case or kebab-case; examples: marine, auto, upholstery, auto-restyling, boat-paint, general-contractor).",
    "5) Provide 3-6 short questions to confirm.",
    "6) Provide detectedServices and billingSignals (best-effort).",
    "7) Provide confidenceScore 0..1 and needsConfirmation boolean.",
    "",
    "Output ONLY JSON.",
  ].join("\n");
}

function pickModelFromPcc(cfg: any) {
  const m =
    String(cfg?.models?.onboardingModel ?? "").trim() ||
    String(cfg?.models?.estimatorModel ?? "").trim() ||
    "gpt-4o-mini";
  return m;
}

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);
    const tenantId = safeTrim(body?.tenantId);
    if (!tenantId) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });

    await requireMembership(clerkUserId, tenantId);

    // Read website + prior ai_analysis from onboarding table
    const r = await db.execute(sql`
      select website, ai_analysis
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? null;
    const websiteRaw = String(row?.website ?? "").trim();
    const website = normalizeUrl(websiteRaw);

    // Extract text (or empty) with diagnostics
    const extracted = website
      ? await fetchWebsiteTextSmart(website)
      : { extractedText: "", extractedTextPreview: "", fetchDebug: { attempted: [] as any[] } };

    const extractedText = extracted.extractedText ?? "";
    const extractedTextPreview = extracted.extractedTextPreview ?? "";
    const fetchDebug = extracted.fetchDebug ?? { attempted: [] };

    const priorAnalysis = row?.ai_analysis ?? null;

    // PCC model selection (we’ll port prompts later)
    const cfg = await loadPlatformLlmConfig();
    const model = pickModelFromPcc(cfg);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("MISSING_OPENAI_API_KEY");

    const client = new OpenAI({ apiKey });

    const resp = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: buildUserPrompt({
            url: website || "(none provided)",
            extractedText,
            prior: priorAnalysis,
            correction: null,
          }),
        },
      ],
    });

    const content = resp.choices?.[0]?.message?.content ?? "";
    const json = safeJsonParse(content);
    const parsed = json ? AnalysisSchema.safeParse(json) : null;

    if (!parsed || !parsed.success) {
      const fallback = {
        businessGuess:
          extractedTextPreview && extractedTextPreview.length > 50
            ? "We fetched your website but the AI response was not usable. Please retry."
            : "We couldn’t extract readable text from your website (it may be blocked or JS-rendered). Please describe your business in a sentence or two.",
        fit: "maybe" as const,
        fitReason:
          extractedTextPreview && extractedTextPreview.length > 50
            ? "Model output was not valid for our schema."
            : "We didn’t get enough website text to confidently evaluate fit.",
        suggestedIndustryKey: "service",
        questions: [
          "What do you work on most (cars/trucks/boats/other)?",
          "What are your top 3 services?",
          "Do you mostly do upgrades, repairs, or both?",
        ],
        confidenceScore: 0.25,
        needsConfirmation: true,
        detectedServices: [],
        billingSignals: [],
        analyzedAt: new Date().toISOString(),
        source: json ? "llm_v1_parse_fail" : "llm_v1_invalid_json",
        modelUsed: model,
        extractedTextPreview: extractedTextPreview || "",
        website: website || null,
        fetchDebug,
        rawModelOutputPreview: clamp(content || "", 1200),
      };

      await db.execute(sql`
        insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
        values (${tenantId}::uuid, ${JSON.stringify(fallback)}::jsonb, 2, false, now(), now())
        on conflict (tenant_id) do update
        set ai_analysis = excluded.ai_analysis,
            current_step = greatest(tenant_onboarding.current_step, 2),
            updated_at = now()
      `);

      return NextResponse.json({ ok: true, tenantId, aiAnalysis: fallback }, { status: 200 });
    }

    const analysis = {
      ...parsed.data,
      analyzedAt: new Date().toISOString(),
      source: "llm_v1",
      modelUsed: model,
      extractedTextPreview: extractedTextPreview || "",
      website: website || null,
      fetchDebug,
    };

    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, ${JSON.stringify(analysis)}::jsonb, 2, false, now(), now())
      on conflict (tenant_id) do update
      set ai_analysis = excluded.ai_analysis,
          current_step = greatest(tenant_onboarding.current_step, 2),
          updated_at = now()
    `);

    return NextResponse.json({ ok: true, tenantId, aiAnalysis: analysis }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}