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

/* --------------------- tiny utils --------------------- */

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeUrl(raw: string) {
  const s = safeTrim(raw);
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  return t.length <= max ? t : t.slice(0, max);
}

function firstRow(r: any): any | null {
  try {
    if (!r) return null;
    if (Array.isArray(r)) return r[0] ?? null;
    if (typeof r === "object" && r !== null && 0 in r) return (r as any)[0] ?? null;
    if (Array.isArray((r as any)?.rows)) return (r as any).rows[0] ?? null;
    return null;
  } catch {
    return null;
  }
}

function rowsOf(r: any): any[] {
  try {
    if (!r) return [];
    if (Array.isArray(r)) return r;
    if (Array.isArray((r as any)?.rows)) return (r as any).rows;
    return [];
  } catch {
    return [];
  }
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

function safeJsonParseObject(txt: string): any | null {
  const s = safeTrim(txt);
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    if (!v || typeof v !== "object") return null;
    return v;
  } catch {
    return null;
  }
}

function mergeMeta(prior: any, patch: any) {
  const prev = prior?.meta && typeof prior.meta === "object" ? prior.meta : {};
  return { ...prev, ...patch };
}

async function upsertAnalysis(tenantId: string, website: string | null, analysis: any, currentStep = 2) {
  await db.execute(sql`
    insert into tenant_onboarding (tenant_id, website, ai_analysis, current_step, completed, created_at, updated_at)
    values (${tenantId}::uuid, ${website}, ${JSON.stringify(analysis)}::jsonb, ${currentStep}, false, now(), now())
    on conflict (tenant_id) do update
      set website = coalesce(excluded.website, tenant_onboarding.website),
          ai_analysis = excluded.ai_analysis,
          current_step = greatest(tenant_onboarding.current_step, excluded.current_step),
          updated_at = now()
  `);
}

/* --------------------- canonical matching --------------------- */

function normalizeKey(raw: string) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function titleFromKey(key: string) {
  const s = safeTrim(key).replace(/[-_]+/g, " ").trim();
  if (!s) return "";
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

function tokenize(s: string): string[] {
  const t = safeTrim(s).toLowerCase();
  if (!t) return [];
  return t
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 32);
}

function jaccard(a: string[], b: string[]) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

async function resolveCanonicalIndustry(suggestedKeyRaw: string, suggestedLabelRaw: string) {
  const suggestedKey = normalizeKey(suggestedKeyRaw);
  const suggestedLabel = safeTrim(suggestedLabelRaw);

  if (!suggestedKey && !suggestedLabel) return null;

  // Pull canonical industries (small table). If this grows huge later, we can optimize.
  const r = await db.execute(sql`
    select key::text as key, label::text as label
    from industries
    order by key asc
  `);

  const inds = rowsOf(r)
    .map((x: any) => ({
      key: normalizeKey(x?.key ?? ""),
      label: safeTrim(x?.label ?? ""),
    }))
    .filter((x: any) => Boolean(x.key));

  if (!inds.length) return null;

  // 1) Exact key match
  if (suggestedKey) {
    const hit = inds.find((i) => i.key === suggestedKey);
    if (hit) return { key: hit.key, label: hit.label || titleFromKey(hit.key), method: "exact_key", score: 1.0 };
  }

  // 2) Label->key normalization match (e.g., "Wholesale Distribution" => wholesale_distribution)
  if (suggestedLabel) {
    const labelAsKey = normalizeKey(suggestedLabel);
    if (labelAsKey) {
      const hit = inds.find((i) => i.key === labelAsKey);
      if (hit) return { key: hit.key, label: hit.label || titleFromKey(hit.key), method: "label_to_key", score: 0.98 };
    }

    const labelLower = suggestedLabel.toLowerCase();
    const exactLabel = inds.find((i) => safeTrim(i.label).toLowerCase() === labelLower);
    if (exactLabel) {
      return {
        key: exactLabel.key,
        label: exactLabel.label || titleFromKey(exactLabel.key),
        method: "exact_label",
        score: 0.97,
      };
    }
  }

  // 3) Fuzzy token overlap (cheap + deterministic)
  const qTokens = tokenize(`${suggestedLabel} ${suggestedKey}`);
  if (!qTokens.length) return null;

  let best: { key: string; label: string; score: number; method: string } | null = null;

  for (const i of inds) {
    const iTokens = tokenize(`${i.label} ${i.key}`);
    const score = jaccard(qTokens, iTokens);

    // Small bias if one is a prefix of the other (common for variants)
    const prefixBoost =
      suggestedKey && (i.key.startsWith(suggestedKey) || suggestedKey.startsWith(i.key)) ? 0.08 : 0;

    const total = Math.min(1, score + prefixBoost);

    if (!best || total > best.score) {
      best = { key: i.key, label: i.label || titleFromKey(i.key), score: total, method: "token_overlap" };
    }
  }

  // Threshold: tune to avoid bad merges.
  // 0.72 works well for "wholesale distribution" variants (e.g., wholesale_dist, wholesale_distributor, etc.)
  if (best && best.score >= 0.72) return best;

  return null;
}

/* --------------------- schema --------------------- */

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

/* --------------------- prompts --------------------- */

function websiteIntelPrompt(url: string) {
  return `
Visit the website below and summarize the business factually.

Website:
${url}

Return a clear paragraph describing:
- What the business does
- What they service (boats, cars, homes, etc.)
- Core services offered
- Any constraints (size limits, location, specialty)

Do NOT return JSON.
`.trim();
}

function normalizePrompt(rawText: string) {
  return `
You are onboarding intelligence for AIPhotoQuote.

Convert the following website intelligence into structured JSON.

WEBSITE_INTELLIGENCE:
${rawText}

Return JSON with:
- businessGuess (2–5 sentences)
- fit: good | maybe | poor (photo-based quoting)
- fitReason
- suggestedIndustryKey
- questions (3–6)
- detectedServices
- billingSignals
- confidenceScore (0–1)
- needsConfirmation (true if confidenceScore < 0.8)

Return ONLY valid JSON.
`.trim();
}

/* --------------------- model pick --------------------- */

function pickOnboardingModel(cfg: any) {
  return safeTrim(cfg?.models?.onboardingModel) || safeTrim(cfg?.models?.estimatorModel) || "gpt-4.1";
}

/* --------------------- handler --------------------- */

export async function POST(req: Request) {
  let tenantId = "";

  try {
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);
    tenantId = safeTrim(body?.tenantId);
    if (!tenantId) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });

    await requireMembership(clerkUserId, tenantId);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("MISSING_OPENAI_API_KEY");

    // Read website + prior analysis (if any)
    const r = await db.execute(sql`
      select website, ai_analysis
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row = firstRow(r);
    const website = normalizeUrl(safeTrim(row?.website));
    const prior = row?.ai_analysis ?? null;

    if (!website) {
      return NextResponse.json({ ok: false, error: "NO_WEBSITE", message: "No website on file." }, { status: 400 });
    }

    const priorMeta = prior?.meta && typeof prior.meta === "object" ? prior.meta : {};
    const prevRound = Number(priorMeta?.round ?? 0) || 0;
    const nextRound = prevRound + 1;

    // Mark running so UI updates immediately
    const running = {
      ...(typeof prior === "object" && prior ? prior : {}),
      website,
      meta: mergeMeta(prior, {
        status: "running",
        round: nextRound,
        lastAction: "Analyzing website…",
        error: null,
        startedAt: new Date().toISOString(),
      }),
    };

    await upsertAnalysis(tenantId, website, running, 2);

    const cfg = await loadPlatformLlmConfig();
    const model = pickOnboardingModel(cfg);
    const client = new OpenAI({ apiKey });

    // PASS 1: web_search (no JSON)
    const intelResp = await client.responses.create({
      model,
      tools: [{ type: "web_search" }],
      temperature: 0.2,
      input: websiteIntelPrompt(website),
    });

    const rawIntel = safeTrim(intelResp.output_text ?? "");
    if (!rawIntel) throw new Error("EMPTY_WEB_RESULT");

    const mid = {
      ...running,
      rawWebIntelPreview: clamp(rawIntel, 1200),
      meta: mergeMeta(prior, {
        status: "running",
        round: nextRound,
        lastAction: "Converting website intel into structured onboarding data…",
        error: null,
      }),
    };

    await upsertAnalysis(tenantId, website, mid, 2);

    // PASS 2: strict JSON
    const normalizedResp = await client.responses.create({
      model,
      temperature: 0.2,
      text: { format: { type: "json_object" } },
      input: normalizePrompt(rawIntel),
    });

    const jsonText = safeTrim(normalizedResp.output_text ?? "");
    const obj = safeJsonParseObject(jsonText);
    const parsed = obj ? AnalysisSchema.safeParse(obj) : null;

    // ✅ CRITICAL: if parsing fails, DO NOT overwrite the last-good industry with "service".
    if (!parsed || !parsed.success) {
      const preserved = {
        ...(typeof prior === "object" && prior ? prior : {}),
        ...(typeof prior === "object" && prior
          ? {}
          : {
              businessGuess:
                "We analyzed your website using web tools, but couldn’t reliably convert the result into structured data.",
              fit: "maybe" as const,
              fitReason: "Website intelligence was available, but structured parsing failed.",
              suggestedIndustryKey: "service",
              detectedServices: [],
              billingSignals: [],
            }),
        website,
        analyzedAt: new Date().toISOString(),
        source: "web_tools_two_pass_parse_fail_preserved_prior",
        modelUsed: model,
        questions: [
          "In one sentence, what do you do?",
          "What do you primarily work on (boats/cars/homes/commercial/etc.)?",
          "What are your top 3 services?",
          "Do customers usually send photos before you quote?",
        ].slice(0, 6),
        needsConfirmation: true,
        confidenceScore: Math.min(0.5, Math.max(0, Number((prior as any)?.confidenceScore ?? 0) || 0)),
        rawWebIntelPreview: clamp(rawIntel, 1200),
        rawModelJsonPreview: clamp(jsonText, 1200),
        meta: mergeMeta(prior, {
          status: "complete",
          round: nextRound,
          lastAction: "AI analysis complete (needs confirmation).",
          error: "PARSE_FAIL",
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      };

      await upsertAnalysis(tenantId, website, preserved, 2);
      return NextResponse.json({ ok: true, tenantId, aiAnalysis: preserved }, { status: 200 });
    }

    // ✅ Canonicalize suggested industry (tighten matching to existing industries)
    const suggestedKeyRaw = safeTrim(parsed.data.suggestedIndustryKey);
    const suggestedLabelRaw = titleFromKey(suggestedKeyRaw); // model doesn't send label; derive a stable one

    const canonical = await resolveCanonicalIndustry(suggestedKeyRaw, suggestedLabelRaw);

    const suggestedIndustryKey = canonical?.key ? canonical.key : normalizeKey(suggestedKeyRaw) || suggestedKeyRaw;
    const suggestedIndustryLabel = canonical?.label ? canonical.label : suggestedLabelRaw;

    const analysis = {
      ...parsed.data,
      suggestedIndustryKey,
      suggestedIndustryLabel,
      website,
      analyzedAt: new Date().toISOString(),
      source: "web_tools_two_pass",
      modelUsed: model,
      rawWebIntelPreview: clamp(rawIntel, 1200),
      meta: mergeMeta(prior, {
        status: "complete",
        round: nextRound,
        lastAction: "AI analysis complete.",
        error: null,
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        canonicalMatch: canonical
          ? { method: canonical.method, score: canonical.score, key: canonical.key }
          : { method: "none" },
      }),
    };

    await upsertAnalysis(tenantId, website, analysis, 2);
    return NextResponse.json({ ok: true, tenantId, aiAnalysis: analysis }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;

    // Best-effort: persist error meta so UI shows something useful
    try {
      if (tenantId) {
        const r = await db.execute(sql`
          select website, ai_analysis
          from tenant_onboarding
          where tenant_id = ${tenantId}::uuid
          limit 1
        `);
        const row = firstRow(r);
        const website = normalizeUrl(safeTrim(row?.website));
        const prior = row?.ai_analysis ?? null;
        const priorMeta = prior?.meta && typeof prior.meta === "object" ? prior.meta : {};
        const prevRound = Number(priorMeta?.round ?? 0) || 0;

        const errored = {
          ...(typeof prior === "object" && prior ? prior : {}),
          website: website || (typeof prior === "object" && prior ? (prior as any).website : null),
          meta: {
            ...priorMeta,
            status: "error",
            round: prevRound || 1,
            lastAction: "AI analysis failed.",
            error: msg,
            failedAt: new Date().toISOString(),
          },
        };

        await upsertAnalysis(tenantId, website || null, errored, 2);
      }
    } catch {
      // swallow
    }

    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}