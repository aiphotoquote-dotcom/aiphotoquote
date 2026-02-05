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
  return t.length <= max ? t : t.slice(0, max);
}

// Drizzle `db.execute(sql`...`)` can return an array-like RowList.
// Avoid `.rows` to keep TS happy.
function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  // many RowList types are indexable
  if (typeof r === "object" && r !== null && 0 in r) return (r as any)[0] ?? null;
  // last resort
  if (Array.isArray((r as any)?.rows)) return (r as any).rows[0] ?? null;
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

function pickOnboardingModel(cfg: any) {
  return (
    String(cfg?.models?.onboardingModel ?? "").trim() ||
    String(cfg?.models?.estimatorModel ?? "").trim() ||
    "gpt-4.1"
  );
}

function withMeta(base: any, meta: any) {
  const prevMeta = base?.meta && typeof base.meta === "object" ? base.meta : {};
  return { ...(base || {}), meta: { ...prevMeta, ...(meta || {}) } };
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

function buildSystemPrompt() {
  return [
    "You are onboarding intelligence for AIPhotoQuote.",
    "You may use web tools to read the business website and reputable references.",
    "",
    "Rules:",
    "- Read the business website and infer what the company does.",
    "- Be specific about what they service (boats, cars, homes, etc.) and top services.",
    "- If uncertain, be cautious and ask clarifying questions.",
    "- Output MUST be valid JSON matching the requested schema.",
    "- confidenceScore is 0..1 (certainty).",
    "- needsConfirmation must be true if confidenceScore < 0.8.",
  ].join("\n");
}

function buildUserPrompt(url: string) {
  return [
    `WEBSITE_URL: ${url}`,
    "",
    "TASK:",
    "1) Write businessGuess (2–5 sentences).",
    "2) Decide fit: good / maybe / poor for photo-based quoting.",
    "3) Explain fitReason (1–3 sentences).",
    "4) Pick suggestedIndustryKey (snake_case or kebab-case).",
    "5) Provide 3–6 short confirmation questions.",
    "6) List detectedServices and billingSignals (best-effort).",
    "7) Provide confidenceScore (0–1) and needsConfirmation boolean.",
    "",
    "Return ONLY JSON.",
  ].join("\n");
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

    // Pull website + prior analysis (if any)
    const r = await db.execute(sql`
      select website, ai_analysis
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row = firstRow(r);
    const websiteRaw = String(row?.website ?? "").trim();
    const website = normalizeUrl(websiteRaw);

    if (!website) {
      return NextResponse.json({ ok: false, error: "NO_WEBSITE", message: "No website on file." }, { status: 400 });
    }

    const priorAnalysis = row?.ai_analysis ?? null;
    const prevRound = Number(priorAnalysis?.meta?.round ?? 0) || 0;
    const nextRound = prevRound + 1;

    // Write "running" meta immediately so UI can show progress
    const runningStub = withMeta(
      {
        ...(typeof priorAnalysis === "object" && priorAnalysis ? priorAnalysis : {}),
        website,
      },
      {
        status: "running",
        round: nextRound,
        lastAction: "Analyzing website via web tools…",
        error: null,
        startedAt: new Date().toISOString(),
      }
    );

    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, ${JSON.stringify(runningStub)}::jsonb, 2, false, now(), now())
      on conflict (tenant_id) do update
      set ai_analysis = excluded.ai_analysis,
          current_step = greatest(tenant_onboarding.current_step, 2),
          updated_at = now()
    `);

    const cfg = await loadPlatformLlmConfig();
    const model = pickOnboardingModel(cfg);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("MISSING_OPENAI_API_KEY");

    const client = new OpenAI({ apiKey });

    // ✅ Responses API w/ web tool + JSON output formatting (typed correctly)
    const resp = await client.responses.create({
      model,
      tools: [{ type: "web_search" }],
      temperature: 0.2,

      // IMPORTANT: OpenAI SDK types expect JSON formatting under `text.format`
      text: { format: { type: "json_object" } },

      input: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(website) },
      ],
    });

    const text = String(resp.output_text ?? "").trim();
    const json = safeJsonParse(text);
    const parsed = json ? AnalysisSchema.safeParse(json) : null;

    let finalAnalysis: any;

    if (!parsed?.success) {
      finalAnalysis = {
        businessGuess:
          "We attempted to analyze your website, but the response wasn’t valid JSON for our schema. Please confirm what services you provide.",
        fit: "maybe" as const,
        fitReason: "Website content could not be confidently classified.",
        suggestedIndustryKey: "service",
        questions: ["What do you primarily work on?", "What are your top services?", "Do customers usually send photos?"],
        confidenceScore: 0.25,
        needsConfirmation: true,
        detectedServices: [],
        billingSignals: [],
        analyzedAt: new Date().toISOString(),
        source: "openai_web_tools_parse_fail",
        modelUsed: model,
        website,
        rawModelOutputPreview: clamp(text, 1200),
      };
    } else {
      finalAnalysis = {
        ...parsed.data,
        analyzedAt: new Date().toISOString(),
        source: "openai_web_tools",
        modelUsed: model,
        website,
      };
    }

    // Persist with complete meta
    const persisted = withMeta(finalAnalysis, {
      status: "complete",
      round: nextRound,
      lastAction: "AI analysis complete.",
      error: null,
      finishedAt: new Date().toISOString(),
    });

    await db.execute(sql`
      update tenant_onboarding
      set ai_analysis = ${JSON.stringify(persisted)}::jsonb,
          current_step = greatest(current_step, 2),
          updated_at = now()
      where tenant_id = ${tenantId}::uuid
    `);

    return NextResponse.json({ ok: true, tenantId, aiAnalysis: persisted }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;

    // Best-effort: store error meta so UI doesn't look stuck
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
        const prevRound = Number(prior?.meta?.round ?? 0) || 0;

        const errored = withMeta(
          { ...(typeof prior === "object" && prior ? prior : {}) },
          {
            status: "error",
            round: prevRound || 1,
            lastAction: "AI analysis failed.",
            error: msg,
            failedAt: new Date().toISOString(),
          }
        );

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