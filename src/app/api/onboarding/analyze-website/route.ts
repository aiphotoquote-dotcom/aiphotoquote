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

function buildCandidateBaseUrls(raw: string): string[] {
  const s = safeTrim(raw);
  if (!s) return [];

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
  const bareHost = host.replace(/^www\./i, "");
  const wwwHost = `www.${bareHost}`;

  const candidates = [
    `https://${bareHost}`,
    `https://${wwwHost}`,
    `http://${bareHost}`,
    `http://${wwwHost}`,
  ];

  if (hadScheme) candidates.unshift(normalizeUrl(s));

  // dedup
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

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

type Attempt = {
  url: string;
  ok: boolean;
  status: number;
  statusText?: string;
  contentType: string;
  finalUrl?: string;
  bytes: number;
  extractedChars: number;
  note?: string;
};

type FetchDebug = {
  attempted: Attempt[];
  pagesAttempted: Attempt[];
  pagesUsed: string[];
  chosenFinalUrl?: string;
  chosenContentType?: string;
  chosenStatus?: number;
  aggregateChars: number;
};

async function fetchText(url: string, timeoutMs = 12_000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  // Browser-ish headers
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
      },
    });

    const ct = String(res.headers.get("content-type") ?? "");
    const isHtml = ct.includes("text/html") || ct.includes("application/xhtml+xml") || ct.includes("application/xml") || ct.includes("text/xml");

    const raw = await res.text().catch(() => "");
    const bytes = Buffer.byteLength(raw || "", "utf8");

    const text = isHtml ? stripHtmlToText(raw) : raw;
    const clipped = clamp(text, 12_000);

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

function sameHost(a: string, b: string) {
  try {
    const A = new URL(a);
    const B = new URL(b);
    return A.host === B.host;
  } catch {
    return false;
  }
}

function joinUrl(base: string, path: string) {
  try {
    const u = new URL(base);
    // ensure base has no path
    u.pathname = "/";
    const out = new URL(path, u.toString());
    return out.toString().replace(/\/+$/g, "");
  } catch {
    return "";
  }
}

function extractSitemapLocs(xmlText: string, max = 8): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmlText)) && out.length < max) {
    out.push(String(m[1]));
  }
  return out;
}

async function fetchWebsiteTextSmart(rawWebsiteUrl: string) {
  const debug: FetchDebug = {
    attempted: [],
    pagesAttempted: [],
    pagesUsed: [],
    aggregateChars: 0,
  };

  const baseCandidates = buildCandidateBaseUrls(rawWebsiteUrl);
  if (!baseCandidates.length) {
    return { extractedText: "", extractedTextPreview: "", fetchDebug: debug };
  }

  // 1) Try to find a working base URL
  let basePick: any | null = null;

  for (const base of baseCandidates) {
    try {
      const r = await fetchText(base);
      debug.attempted.push({
        url: base,
        ok: Boolean(r.ok),
        status: Number(r.status ?? 0),
        statusText: r.statusText,
        contentType: String(r.contentType ?? ""),
        finalUrl: r.finalUrl,
        bytes: Number(r.rawBytes ?? 0),
        extractedChars: Number(r.extractedText?.length ?? 0),
        note: r.note,
      });

      if (!basePick) basePick = r;

      // prefer an OK response with decent text
      if (r.ok && (r.extractedText?.length ?? 0) >= 400) {
        basePick = r;
        break;
      }

      // else keep best: OK beats non-OK; longer beats shorter
      const bestOk = Boolean(basePick?.ok);
      const curOk = Boolean(r.ok);
      const bestLen = Number(basePick?.extractedText?.length ?? 0);
      const curLen = Number(r.extractedText?.length ?? 0);

      if (curOk && !bestOk) basePick = r;
      else if (curOk === bestOk && curLen > bestLen) basePick = r;
    } catch (e: any) {
      debug.attempted.push({
        url: base,
        ok: false,
        status: 0,
        contentType: "",
        bytes: 0,
        extractedChars: 0,
        note: `Fetch error: ${e?.message ?? String(e)}`,
      });
    }
  }

  const chosenFinalUrl = String(basePick?.finalUrl ?? baseCandidates[0]);
  debug.chosenFinalUrl = chosenFinalUrl;
  debug.chosenContentType = String(basePick?.contentType ?? "");
  debug.chosenStatus = Number(basePick?.status ?? 0);

  const baseUrl = chosenFinalUrl;

  // 2) If homepage text is weak, try sitemap + common content paths
  const pages: string[] = [];
  const homeText = String(basePick?.extractedText ?? "");
  const homeLen = homeText.length;

  // Always include home first
  pages.push(baseUrl);

  const commonPaths = ["/about", "/about-us", "/services", "/service", "/contact", "/portfolio", "/gallery", "/work"];
  for (const p of commonPaths) {
    const u = joinUrl(baseUrl, p);
    if (u) pages.push(u);
  }

  // Try sitemap(s) if homepage is thin
  if (homeLen < 400) {
    const sitemapUrls = [joinUrl(baseUrl, "/sitemap.xml"), joinUrl(baseUrl, "/sitemap_index.xml")].filter(Boolean);
    for (const sm of sitemapUrls) {
      try {
        const smRes = await fetchText(sm, 10_000);
        debug.pagesAttempted.push({
          url: sm,
          ok: Boolean(smRes.ok),
          status: Number(smRes.status ?? 0),
          statusText: smRes.statusText,
          contentType: String(smRes.contentType ?? ""),
          finalUrl: smRes.finalUrl,
          bytes: Number(smRes.rawBytes ?? 0),
          extractedChars: Number(smRes.extractedText?.length ?? 0),
          note: smRes.note,
        });

        if (smRes.ok) {
          const locs = extractSitemapLocs(String(smRes.extractedText ?? ""), 8);
          // keep only same host URLs
          for (const loc of locs) {
            if (!sameHost(baseUrl, loc)) continue;
            pages.push(loc);
          }
          if (locs.length) break; // got something, stop trying more sitemaps
        }
      } catch (e: any) {
        debug.pagesAttempted.push({
          url: sm,
          ok: false,
          status: 0,
          contentType: "",
          bytes: 0,
          extractedChars: 0,
          note: `Sitemap fetch error: ${e?.message ?? String(e)}`,
        });
      }
    }
  }

  // Dedup pages, limit to 6 total fetches (home + 5)
  const pageList: string[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pageList.push(p);
    if (pageList.length >= 6) break;
  }

  // Fetch pages and aggregate text
  let aggregate = "";
  const pagesUsed: string[] = [];

  for (const pageUrl of pageList) {
    try {
      const r = await fetchText(pageUrl);
      const text = String(r.extractedText ?? "");
      const len = text.length;

      debug.pagesAttempted.push({
        url: pageUrl,
        ok: Boolean(r.ok),
        status: Number(r.status ?? 0),
        statusText: r.statusText,
        contentType: String(r.contentType ?? ""),
        finalUrl: r.finalUrl,
        bytes: Number(r.rawBytes ?? 0),
        extractedChars: len,
        note: r.note,
      });

      // Only use OK pages with *some* signal
      if (r.ok && len >= 150) {
        pagesUsed.push(pageUrl);
        aggregate += `\n\n=== PAGE: ${pageUrl} ===\n${text}`;
      }

      if (aggregate.length >= 12_000) break;
    } catch (e: any) {
      debug.pagesAttempted.push({
        url: pageUrl,
        ok: false,
        status: 0,
        contentType: "",
        bytes: 0,
        extractedChars: 0,
        note: `Page fetch error: ${e?.message ?? String(e)}`,
      });
    }
  }

  aggregate = clamp(aggregate.trim(), 12_000);
  debug.pagesUsed = pagesUsed;
  debug.aggregateChars = aggregate.length;

  const preview = clamp(aggregate, 900);

  return {
    extractedText: aggregate,
    extractedTextPreview: preview,
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
    "WEBSITE_TEXT (clipped, may include multiple pages):",
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

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);
    const tenantId = safeTrim(body?.tenantId);
    if (!tenantId) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });

    await requireMembership(clerkUserId, tenantId);

    const r = await db.execute(sql`
      select website, ai_analysis
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? null;
    const websiteRaw = String(row?.website ?? "").trim();
    const website = normalizeUrl(websiteRaw);

    const extracted = website
      ? await fetchWebsiteTextSmart(website)
      : { extractedText: "", extractedTextPreview: "", fetchDebug: { attempted: [], pagesAttempted: [], pagesUsed: [], aggregateChars: 0 } };

    const extractedText = extracted.extractedText ?? "";
    const extractedTextPreview = extracted.extractedTextPreview ?? "";
    const fetchDebug = extracted.fetchDebug ?? { attempted: [], pagesAttempted: [], pagesUsed: [], aggregateChars: 0 };

    const priorAnalysis = row?.ai_analysis ?? null;

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
            : "We couldn’t extract readable text from your website (it may be blocked or JS-rendered). Please describe what you do and what you service (cars/boats/etc.).",
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