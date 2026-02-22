// src/app/api/onboarding/analyze-website/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";
import { resolveIndustryCandidate, titleFromKey } from "@/lib/pcc/industries/resolveIndustryCandidate";
import { ensureIndustryPack } from "@/lib/onboarding/ensureIndustryPack";

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
              suggestedIndustryLabel: "Service",
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

    // ✅ Resolve to canonical (when it exists) instead of inventing variants
    const resolved = await resolveIndustryCandidate({
      proposedKey: parsed.data.suggestedIndustryKey,
      proposedLabel: null,
    });

    const analysis = {
      ...parsed.data,
      suggestedIndustryKey: resolved.key,
      suggestedIndustryLabel: resolved.label || titleFromKey(resolved.key),
      website,
      analyzedAt: new Date().toISOString(),
      source: "web_tools_two_pass",
      modelUsed: model,
      rawWebIntelPreview: clamp(rawIntel, 1200),
      meta: mergeMeta(prior, {
        status: "complete",
        round: nextRound,
        lastAction: resolved.isCanonical
          ? `AI analysis complete (matched canonical by ${resolved.matchedBy}).`
          : "AI analysis complete.",
        error: null,
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    };

    await upsertAnalysis(tenantId, website, analysis, 2);

    // ✅ Ensure pack exists ONLY when we are confident enough to not need confirmation.
    if (analysis.needsConfirmation === false) {
      await ensureIndustryPack({
        tenantId,
        industryKey: analysis.suggestedIndustryKey,
        industryLabel: analysis.suggestedIndustryLabel || titleFromKey(analysis.suggestedIndustryKey),
        industryDescription: null,
      });
    }

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