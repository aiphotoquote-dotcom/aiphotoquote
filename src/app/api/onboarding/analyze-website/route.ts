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

/* --------------------- utils --------------------- */

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
  if (t.length <= max) return t;
  return t.slice(0, max);
}

// Drizzle RowList is often array-like but may not expose `.rows` in typings.
function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray((r as any)?.rows)) return (r as any).rows[0] ?? null;
  if (typeof r === "object" && r !== null && "length" in r) return (r as any)[0] ?? null;
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

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
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
  const m =
    String((cfg as any)?.models?.onboardingModel ?? "").trim() ||
    String(cfg?.models?.estimatorModel ?? "").trim() ||
    "gpt-4.1";
  return m;
}

/* --------------------- phases --------------------- */

type Phase =
  | "reachability"
  | "discover"
  | "extract"
  | "classify"
  | "questions"
  | "finalize";

function mergeMeta(priorAnalysis: any, patch: any) {
  const prevMeta = priorAnalysis?.meta && typeof priorAnalysis.meta === "object" ? priorAnalysis.meta : {};
  return { ...prevMeta, ...patch };
}

async function writeRunning(
  tenantId: string,
  priorAnalysis: any,
  website: string,
  nextRound: number,
  phase: Phase,
  lastAction: string,
  extra: Record<string, any> = {}
) {
  const base = typeof priorAnalysis === "object" && priorAnalysis ? priorAnalysis : {};
  const meta = mergeMeta(priorAnalysis, {
    status: "running",
    round: nextRound,
    phase,
    lastAction,
    error: null,
    ...extra,
  });

  const stub = {
    ...base,
    website,
    meta,
  };

  await db.execute(sql`
    insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
    values (${tenantId}::uuid, ${JSON.stringify(stub)}::jsonb, 2, false, now(), now())
    on conflict (tenant_id) do update
    set ai_analysis = excluded.ai_analysis,
        current_step = greatest(tenant_onboarding.current_step, 2),
        updated_at = now()
  `);

  return stub;
}

async function writeUpdate(
  tenantId: string,
  analysis: any
) {
  await db.execute(sql`
    update tenant_onboarding
    set ai_analysis = ${JSON.stringify(analysis)}::jsonb,
        current_step = greatest(current_step, 2),
        updated_at = now()
    where tenant_id = ${tenantId}::uuid
  `);
}

/* --------------------- handler --------------------- */

export async function POST(req: Request) {
  let tenantId = "";

  try {
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);
    tenantId = safeTrim(body?.tenantId);
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });
    }

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
    const priorAnalysis = row?.ai_analysis ?? null;

    if (!website) {
      return NextResponse.json(
        { ok: false, error: "NO_WEBSITE", message: "No website on file." },
        { status: 400 }
      );
    }

    const prevMeta = priorAnalysis?.meta && typeof priorAnalysis.meta === "object" ? priorAnalysis.meta : {};
    const prevRound = Number(prevMeta?.round ?? 0) || 0;
    const nextRound = prevRound + 1;

    // Phase 1: reachability / kickoff
    await writeRunning(
      tenantId,
      priorAnalysis,
      website,
      nextRound,
      "reachability",
      "Checking that your website is reachable…",
      { startedAt: new Date().toISOString() }
    );

    const cfg = await loadPlatformLlmConfig();
    const model = pickOnboardingModel(cfg);

    const client = new OpenAI({ apiKey });

    // Phase 2: discover (pass 1 starts)
    await writeRunning(
      tenantId,
      priorAnalysis,
      website,
      nextRound,
      "discover",
      "Finding key pages (services, gallery, contact)…"
    );

    /* ---------- PASS 1: web browsing (NO JSON MODE) ---------- */
    const intelResp = await client.responses.create({
      model,
      tools: [{ type: "web_search" }],
      temperature: 0.2,
      input: websiteIntelPrompt(website),
    });

    const rawIntel = String(intelResp.output_text ?? "").trim();
    if (!rawIntel) throw new Error("EMPTY_WEB_RESULT");

    // Phase 3: extract (we got content, now extracting signals)
    const mid = {
      ...(typeof priorAnalysis === "object" && priorAnalysis ? priorAnalysis : {}),
      website,
      meta: mergeMeta(priorAnalysis, {
        status: "running",
        round: nextRound,
        phase: "extract" as Phase,
        lastAction: "Extracting services and billing signals…",
        error: null,
      }),
      rawWebIntelPreview: clamp(rawIntel, 1200),
    };

    await writeUpdate(tenantId, mid);

    // Phase 4: classify/questions (pass 2 normalization)
    const preJson = {
      ...mid,
      meta: {
        ...(mid.meta ?? {}),
        status: "running",
        round: nextRound,
        phase: "classify" as Phase,
        lastAction: "Converting website intel into structured onboarding data…",
        error: null,
      },
    };

    await writeUpdate(tenantId, preJson);

    /* ---------- PASS 2: JSON normalization (STRICT JSON) ---------- */
    const normalizedResp = await client.responses.create({
      model,
      temperature: 0.2,
      text: { format: { type: "json_object" } },
      input: normalizePrompt(rawIntel),
    });

    const jsonText = String(normalizedResp.output_text ?? "").trim();
    const json = safeJsonParse(jsonText);
    const parsed = json ? AnalysisSchema.safeParse(json) : null;

    if (!parsed?.success) {
      const fallback = {
        businessGuess:
          "We analyzed your website using web tools, but couldn’t reliably convert the result into structured data.",
        fit: "maybe" as const,
        fitReason: "Website intelligence was available, but structured parsing failed.",
        suggestedIndustryKey: "service",
        questions: [
          "What do you primarily work on (boats/cars/homes/etc.)?",
          "What are your top 3 services?",
          "Do customers usually send photos before you quote?",
        ],
        confidenceScore: 0.3,
        needsConfirmation: true,
        detectedServices: [],
        billingSignals: [],
        analyzedAt: new Date().toISOString(),
        source: "web_tools_two_pass_parse_fail",
        modelUsed: model,
        website,
        meta: mergeMeta(priorAnalysis, {
          status: "complete",
          round: nextRound,
          phase: "finalize" as Phase,
          lastAction: "AI analysis complete (needs confirmation).",
          error: null,
          finishedAt: new Date().toISOString(),
        }),
        rawWebIntelPreview: clamp(rawIntel, 1200),
        rawModelJsonPreview: clamp(jsonText, 1200),
      };

      await writeUpdate(tenantId, fallback);
      return NextResponse.json({ ok: true, tenantId, aiAnalysis: fallback }, { status: 200 });
    }

    // Phase 5: questions (we have structured data; we’re effectively finalizing questions+summary)
    const analysis = {
      ...parsed.data,
      website,
      analyzedAt: new Date().toISOString(),
      source: "web_tools_two_pass",
      modelUsed: model,
      meta: mergeMeta(priorAnalysis, {
        status: "complete",
        round: nextRound,
        phase: "finalize" as Phase,
        lastAction: "AI analysis complete.",
        error: null,
        finishedAt: new Date().toISOString(),
      }),
      rawWebIntelPreview: clamp(rawIntel, 1200),
    };

    await writeUpdate(tenantId, analysis);

    return NextResponse.json({ ok: true, tenantId, aiAnalysis: analysis }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;

    // best-effort: store error meta so UI shows meaningful status
    try {
      if (tenantId) {
        const r = await db.execute(sql`
          select ai_analysis
          from tenant_onboarding
          where tenant_id = ${tenantId}::uuid
          limit 1
        `);
        const row = firstRow(r);
        const prior = row?.ai_analysis ?? null;
        const prevMeta = prior?.meta && typeof prior.meta === "object" ? prior.meta : {};
        const prevRound = Number(prevMeta?.round ?? 0) || 0;

        const errored = {
          ...(typeof prior === "object" && prior ? prior : {}),
          meta: {
            ...prevMeta,
            status: "error",
            round: prevRound || 1,
            phase: (prevMeta?.phase as any) || "finalize",
            lastAction: "AI analysis failed.",
            error: msg,
            failedAt: new Date().toISOString(),
          },
        };

        await db.execute(sql`
          update tenant_onboarding
          set ai_analysis = ${JSON.stringify(errored)}::jsonb,
              updated_at = now()
          where tenant_id = ${tenantId}::uuid
        `);
      }
    } catch {
      // swallow
    }

    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}