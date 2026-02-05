import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

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

function normalizeWebsiteUrl(raw: string): string {
  const s = safeTrim(raw);
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function pickCandidatePages(baseUrl: string) {
  // Keep it small and predictable
  const u = new URL(baseUrl);
  const origin = u.origin;
  return [
    origin,
    `${origin}/services`,
    `${origin}/service`,
    `${origin}/about`,
    `${origin}/contact`,
    `${origin}/portfolio`,
    `${origin}/gallery`,
  ];
}

async function fetchText(url: string, timeoutMs = 10000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      next: { revalidate: 0 },
      signal: ctrl.signal,
      headers: {
        // Some sites behave better with a UA
        "user-agent": "AIPhotoQuote-OnboardingBot/1.0",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) return "";

    const ct = String(res.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.includes("text/html") && !ct.includes("application/xhtml") && !ct.includes("text/plain")) {
      return "";
    }

    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

function stripHtmlToText(html: string): string {
  if (!html) return "";
  let s = html;

  // remove scripts/styles
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");

  // remove nav/footer-ish blocks a bit (best-effort)
  s = s.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ");
  s = s.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ");

  // collapse tags
  s = s.replace(/<\/(p|div|br|li|h[1-6])>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");

  // decode a couple common entities
  s = s.replace(/&nbsp;/g, " ");
  s = s.replace(/&amp;/g, "&");
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/&#39;/g, "'");

  // normalize whitespace
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n\s*\n\s*\n+/g, "\n\n");
  return s.trim();
}

function clampText(s: string, maxChars: number) {
  const t = safeTrim(s);
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "\n…(truncated)";
}

function scoreAndInfer(text: string) {
  const t = text.toLowerCase();

  const keywords = [
    { k: ["upholstery", "reupholstery", "vinyl", "canvas", "marine upholstery"], tag: "upholstery" },
    { k: ["boat", "marine", "yacht", "pontoon"], tag: "marine" },
    { k: ["auto", "automotive", "car", "truck"], tag: "automotive" },
    { k: ["paint", "painting", "gelcoat", "wrap", "bodywork"], tag: "paint" },
    { k: ["detailing", "ceramic coating", "ppf"], tag: "detailing" },
    { k: ["fabrication", "welding", "custom"], tag: "custom" },
  ];

  const hits: string[] = [];
  for (const group of keywords) {
    if (group.k.some((x) => t.includes(x))) hits.push(group.tag);
  }

  // base confidence
  let confidence = 0.52;
  if (text.length > 600) confidence += 0.12;
  if (text.length > 2000) confidence += 0.10;
  confidence += Math.min(0.18, hits.length * 0.04);

  confidence = Math.max(0.45, Math.min(0.88, confidence));

  // suggested industry (simple mapping)
  let suggestedIndustryKey = "service";
  if (hits.includes("marine") && hits.includes("upholstery")) suggestedIndustryKey = "marine";
  else if (hits.includes("upholstery")) suggestedIndustryKey = "upholstery";
  else if (hits.includes("paint")) suggestedIndustryKey = "paint";
  else if (hits.includes("detailing")) suggestedIndustryKey = "detailing";
  else if (hits.includes("automotive")) suggestedIndustryKey = "automotive";

  // build a friendly “what you do” line
  const lines: string[] = [];
  if (hits.includes("marine")) lines.push("boats / marine work");
  if (hits.includes("automotive")) lines.push("cars / trucks");
  if (hits.includes("upholstery")) lines.push("upholstery (seats, cushions, interiors)");
  if (hits.includes("paint")) lines.push("painting / refinishing");
  if (hits.includes("detailing")) lines.push("detailing / coatings");
  if (hits.includes("custom")) lines.push("custom work");

  const businessGuess =
    lines.length > 0
      ? `It looks like your business focuses on ${lines.join(", ")}.`
      : `It looks like you run a service business, but I couldn’t confidently determine the exact specialty from the site text.`;

  const detectedServices =
    hits.includes("upholstery")
      ? ["repairs", "custom upholstery", "replacement upholstery", "materials selection"]
      : hits.includes("paint")
      ? ["prep", "paint/refinish", "spot repairs", "custom color/finish"]
      : ["estimates", "service work", "customer consultation"];

  const questions: string[] = [];
  questions.push("Does the description above sound accurate?");
  if (!hits.includes("upholstery")) questions.push("Do you do upholstery (seats/cushions/interiors), or is your core service different?");
  if (!hits.includes("paint")) questions.push("Do you do painting/refinishing, or is the work mostly repair/customization?");
  if (!hits.includes("marine")) questions.push("Do you serve boats/marine customers, or is it mainly automotive/other?");

  return {
    confidenceScore: confidence,
    suggestedIndustryKey,
    businessGuess,
    detectedServices,
    questions,
    tags: hits,
  };
}

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);
    const tenantId = safeTrim(body?.tenantId);
    if (!tenantId) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });

    await requireMembership(clerkUserId, tenantId);

    // Pull onboarding model from PCC LLM config (for provenance; LLM wiring comes next)
    const cfg = await loadPlatformLlmConfig();
    const onboardingModel =
      String((cfg as any)?.models?.onboardingModel ?? "").trim() ||
      String((cfg as any)?.models?.estimatorModel ?? "").trim() ||
      "gpt-4o-mini";

    // Get saved website from tenant_onboarding
    const r = await db.execute(sql`
      select website, ai_analysis
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? null;
    const websiteRaw = safeTrim(row?.website);
    const website = normalizeWebsiteUrl(websiteRaw);

    // If no website, still return a helpful “needsConfirmation”
    if (!website) {
      const mockNoWebsite = {
        fit: "unknown",
        confidenceScore: 0.52,
        needsConfirmation: true,
        businessGuess:
          "No website was provided, so I can’t auto-detect what you do yet. Tell me what you service (boats/cars/etc.) and what kind of work you perform.",
        detectedServices: [],
        suggestedIndustryKey: "service",
        questions: ["What kind of work do you do (short description)?", "Who do you typically serve (boats/cars/homes/other)?"],
        analyzedAt: new Date().toISOString(),
        source: "website_fetch_v1",
        modelUsed: onboardingModel,
        website: null,
        pagesSampled: [],
        extractedTextPreview: "",
      };

      await db.execute(sql`
        insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
        values (${tenantId}::uuid, ${JSON.stringify(mockNoWebsite)}::jsonb, 2, false, now(), now())
        on conflict (tenant_id) do update
        set ai_analysis = excluded.ai_analysis,
            current_step = greatest(tenant_onboarding.current_step, 2),
            updated_at = now()
      `);

      return NextResponse.json({ ok: true, tenantId, aiAnalysis: mockNoWebsite }, { status: 200 });
    }

    // Fetch a few pages and extract text
    const pages = pickCandidatePages(website);
    const fetched: { url: string; htmlLen: number; textLen: number }[] = [];
    let combinedText = "";

    for (const u of pages) {
      const html = await fetchText(u);
      const text = stripHtmlToText(html);

      fetched.push({ url: u, htmlLen: html.length, textLen: text.length });

      // only add meaningful text
      if (text.length > 120) {
        combinedText += "\n\n" + text;
      }

      // keep bounded
      if (combinedText.length > 20000) break;
    }

    combinedText = clampText(combinedText, 20000);

    const inferred = scoreAndInfer(combinedText);

    const needsConfirmation = inferred.confidenceScore < 0.8;

    const analysis = {
      fit: inferred.tags.length > 0 ? true : "unknown",
      confidenceScore: inferred.confidenceScore,
      needsConfirmation,

      // “What we think you do”
      businessGuess: inferred.businessGuess,
      detectedServices: inferred.detectedServices,

      // Industry guess (Step 3 uses this)
      suggestedIndustryKey: inferred.suggestedIndustryKey,

      // Ask the user to confirm/correct
      questions: inferred.questions,

      analyzedAt: new Date().toISOString(),
      source: "website_fetch_v1",
      modelUsed: onboardingModel,

      website,
      pagesSampled: fetched.map((x) => x.url),
      extractedTextPreview: clampText(combinedText, 1800),
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