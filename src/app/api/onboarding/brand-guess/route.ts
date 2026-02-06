// src/app/api/onboarding/brand-guess/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

// Drizzle RowList can be array-like; avoid `.rows`
function firstRow(r: any): any | null {
  try {
    if (!r) return null;
    if (Array.isArray(r)) return r[0] ?? null;
    if (typeof r === "object" && r !== null && 0 in r) return (r as any)[0] ?? null;
    return null;
  } catch {
    return null;
  }
}

async function requireAuthed(): Promise<{ clerkUserId: string }> {
  const a = await auth();
  const clerkUserId = a?.userId ?? null;
  if (!clerkUserId) throw new Error("UNAUTHENTICATED");
  return { clerkUserId };
}

/**
 * ✅ IMPORTANT:
 * Your DB keys tenant membership by clerk_user_id.
 */
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

function toAbs(baseUrl: string, maybeRel: string) {
  try {
    return new URL(maybeRel, baseUrl).toString();
  } catch {
    return "";
  }
}

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  });

  const ct = res.headers.get("content-type") || "";
  const text = await res.text();

  return { ok: res.ok, status: res.status, contentType: ct, text };
}

/* --------------------- email extraction --------------------- */

function extractEmails(html: string) {
  const found = new Set<string>();

  const mailtoRe = /mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
  let m: RegExpExecArray | null;
  while ((m = mailtoRe.exec(html))) found.add(String(m[1]).toLowerCase());

  const emailRe = /\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi;
  while ((m = emailRe.exec(html))) found.add(String(m[1]).toLowerCase());

  return Array.from(found);
}

function scoreEmail(email: string, websiteUrl: string) {
  const e = email.toLowerCase();
  let score = 0;

  if (!e.includes("noreply") && !e.includes("no-reply")) score += 3;
  if (e.startsWith("info@")) score += 3;
  if (e.startsWith("sales@")) score += 2;
  if (e.startsWith("quotes@")) score += 2;
  if (e.startsWith("contact@")) score += 2;

  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./, "");
    const domain = e.split("@")[1] ?? "";
    if (domain === host) score += 5;
    if (domain.endsWith(host)) score += 3;
  } catch {}

  if (/(gmail|yahoo|outlook|hotmail|icloud)\.com$/i.test(e.split("@")[1] ?? "")) score -= 1;

  return score;
}

function pickBestEmail(emails: string[], websiteUrl: string) {
  if (!emails.length) return "";
  const sorted = [...emails].sort((a, b) => scoreEmail(b, websiteUrl) - scoreEmail(a, websiteUrl));
  return sorted[0] ?? "";
}

/* --------------------- better logo detection --------------------- */

type LogoCandidate = {
  kind:
    | "jsonld_org_logo"
    | "link_rel_logo"
    | "img_logoish"
    | "icon_apple"
    | "icon"
    | "meta_twitter"
    | "meta_og";
  url: string;
  hint?: string;
  score: number;
};

function extScore(url: string) {
  const u = url.toLowerCase();
  if (u.endsWith(".svg")) return 20;
  if (u.endsWith(".png")) return 12;
  if (u.endsWith(".webp")) return 8;
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return 2;
  return 0;
}

function penaltyWords(urlOrHint: string) {
  const s = (urlOrHint || "").toLowerCase();

  const bad = [
    "hero",
    "banner",
    "slider",
    "carousel",
    "featured",
    "gallery",
    "background",
    "bg-",
    "stock",
    "shutterstock",
    "getty",
    "unsplash",
    "pexels",
    "homepage",
    "header-image",
    "blog",
    "post",
    "article",
  ];

  const contenty = ["brick", "painting", "house", "kitchen", "bath", "deck", "fence", "interior", "exterior"];

  let p = 0;
  for (const w of bad) if (s.includes(w)) p += 12;
  for (const w of contenty) if (s.includes(w)) p += 6;

  // wordpress uploads are common for both logos and content, no penalty by itself
  return p;
}

function logoWordsBonus(urlOrHint: string) {
  const s = (urlOrHint || "").toLowerCase();
  const good = ["logo", "brand", "wordmark", "logomark", "mark", "site-logo", "custom-logo"];
  let b = 0;
  for (const w of good) if (s.includes(w)) b += 10;
  return b;
}

function baseKindScore(kind: LogoCandidate["kind"]) {
  switch (kind) {
    case "jsonld_org_logo":
      return 100;
    case "link_rel_logo":
      return 85;
    case "img_logoish":
      return 70;
    case "icon_apple":
      return 55;
    case "icon":
      return 45;
    case "meta_twitter":
      return 25;
    case "meta_og":
      return 20;
    default:
      return 0;
  }
}

function uniqueByUrl(cands: LogoCandidate[]) {
  const seen = new Set<string>();
  const out: LogoCandidate[] = [];
  for (const c of cands) {
    const k = c.url.trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

function extractLinkHref(html: string, relToken: string) {
  const token = relToken.toLowerCase();
  const linkRe = /<link\b[^>]*>/gi;
  const attrsRe = /([a-zA-Z:_-]+)\s*=\s*["']([^"']+)["']/g;

  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    while ((a = attrsRe.exec(tag))) attrs[a[1].toLowerCase()] = a[2];

    const rel = (attrs["rel"] ?? "").toLowerCase();
    if (!rel) continue;
    if (!rel.includes(token)) continue;

    const href = attrs["href"] ?? "";
    if (href) return href;
  }
  return "";
}

function extractMetaContent(html: string, key: { property?: string; name?: string }) {
  const prop = key.property ? String(key.property).toLowerCase() : "";
  const name = key.name ? String(key.name).toLowerCase() : "";

  const metaRe = /<meta\b[^>]*>/gi;
  const attrsRe = /([a-zA-Z:_-]+)\s*=\s*["']([^"']+)["']/g;

  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html))) {
    const tag = m[0];
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    while ((a = attrsRe.exec(tag))) attrs[a[1].toLowerCase()] = a[2];

    if (prop && attrs["property"]?.toLowerCase() === prop) return attrs["content"] ?? "";
    if (name && attrs["name"]?.toLowerCase() === name) return attrs["content"] ?? "";
  }
  return "";
}

function extractLogoishImgs(html: string) {
  // Grab <img> tags; prefer those with logo-ish cues and those in header/nav-ish regions.
  const imgRe = /<img\b[^>]*>/gi;
  const attrsRe = /([a-zA-Z:_-]+)\s*=\s*["']([^"']+)["']/g;

  const out: { src: string; hint: string }[] = [];

  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html))) {
    const tag = m[0];
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    while ((a = attrsRe.exec(tag))) attrs[a[1].toLowerCase()] = a[2];

    const src = attrs["src"] ?? attrs["data-src"] ?? "";
    if (!src) continue;

    const alt = (attrs["alt"] ?? "").toLowerCase();
    const cls = (attrs["class"] ?? "").toLowerCase();
    const id = (attrs["id"] ?? "").toLowerCase();

    const hint = [alt, cls, id, src].filter(Boolean).join(" ");
    const logoish = hint.includes("logo") || hint.includes("brand") || hint.includes("site-logo") || hint.includes("custom-logo");

    // Only include “logoish” images; don’t dump the whole page’s image list.
    if (!logoish) continue;

    out.push({ src, hint });
  }

  return out;
}

function extractJsonLdOrgLogo(html: string) {
  // Parse <script type="application/ld+json"> blocks, look for Organization.logo
  const scripts: string[] = [];
  const scriptRe = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html))) {
    scripts.push(m[1] ?? "");
  }

  for (const raw of scripts) {
    const txt = (raw || "").trim();
    if (!txt) continue;

    let data: any;
    try {
      data = JSON.parse(txt);
    } catch {
      // some sites put multiple JSON objects without valid JSON; skip
      continue;
    }

    const nodes = Array.isArray(data) ? data : [data];
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;

      const type = String(n["@type"] ?? "").toLowerCase();
      const isOrg = type.includes("organization") || type.includes("localbusiness") || type.includes("professionalservice");
      if (!isOrg) continue;

      const logo = n.logo;
      if (typeof logo === "string") return logo;
      if (logo && typeof logo === "object") {
        const u = logo.url || logo["@id"];
        if (typeof u === "string") return u;
      }
    }
  }

  return "";
}

function bestLogoCandidate(website: string, html: string) {
  const cands: LogoCandidate[] = [];

  const jsonld = safeTrim(extractJsonLdOrgLogo(html));
  if (jsonld) {
    const abs = toAbs(website, jsonld);
    cands.push({
      kind: "jsonld_org_logo",
      url: abs,
      hint: "jsonld Organization.logo",
      score: baseKindScore("jsonld_org_logo") + extScore(abs) + logoWordsBonus(abs) - penaltyWords(abs),
    });
  }

  const relLogo = safeTrim(extractLinkHref(html, "logo"));
  if (relLogo) {
    const abs = toAbs(website, relLogo);
    cands.push({
      kind: "link_rel_logo",
      url: abs,
      hint: "link[rel*=logo]",
      score: baseKindScore("link_rel_logo") + extScore(abs) + logoWordsBonus(abs) - penaltyWords(abs),
    });
  }

  const logoImgs = extractLogoishImgs(html);
  for (const li of logoImgs) {
    const abs = toAbs(website, li.src);
    cands.push({
      kind: "img_logoish",
      url: abs,
      hint: li.hint,
      score: baseKindScore("img_logoish") + extScore(abs) + logoWordsBonus(li.hint) - penaltyWords(li.hint),
    });
  }

  const apple = safeTrim(extractLinkHref(html, "apple-touch-icon"));
  if (apple) {
    const abs = toAbs(website, apple);
    cands.push({
      kind: "icon_apple",
      url: abs,
      hint: "apple-touch-icon",
      score: baseKindScore("icon_apple") + extScore(abs) + logoWordsBonus(abs) - penaltyWords(abs),
    });
  }

  const icon = safeTrim(extractLinkHref(html, "icon"));
  if (icon) {
    const abs = toAbs(website, icon);
    cands.push({
      kind: "icon",
      url: abs,
      hint: "icon",
      score: baseKindScore("icon") + extScore(abs) + logoWordsBonus(abs) - penaltyWords(abs),
    });
  }

  // Keep these as “last resorts”
  const tw = safeTrim(extractMetaContent(html, { name: "twitter:image" }));
  if (tw) {
    const abs = toAbs(website, tw);
    cands.push({
      kind: "meta_twitter",
      url: abs,
      hint: "twitter:image",
      score: baseKindScore("meta_twitter") + extScore(abs) + logoWordsBonus(abs) - penaltyWords(abs),
    });
  }

  const og = safeTrim(extractMetaContent(html, { property: "og:image" }));
  if (og) {
    const abs = toAbs(website, og);
    cands.push({
      kind: "meta_og",
      url: abs,
      hint: "og:image",
      score: baseKindScore("meta_og") + extScore(abs) + logoWordsBonus(abs) - penaltyWords(abs),
    });
  }

  const unique = uniqueByUrl(cands).sort((a, b) => b.score - a.score);
  return { best: unique[0] ?? null, ranked: unique.slice(0, 8) };
}

function guessLogoFromAi(ai: any | null) {
  const candidates = [
    ai?.brand?.logoUrl,
    ai?.brandLogoUrl,
    ai?.logoUrl,
    ai?.logo,
    ai?.detectedLogoUrl,
    ai?.debug?.logoUrl,
  ]
    .map((x) => safeTrim(x))
    .filter(Boolean);

  return candidates[0] ?? "";
}

/* --------------------- handler --------------------- */

export async function GET(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const u = new URL(req.url);
    const tenantId = safeTrim(u.searchParams.get("tenantId"));
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });
    }

    await requireMembership(clerkUserId, tenantId);

    const r = await db.execute(sql`
      select
        o.website as website,
        o.ai_analysis as ai_analysis,
        s.brand_logo_url as brand_logo_url,
        s.lead_to_email as lead_to_email
      from tenant_onboarding o
      left join tenant_settings s on s.tenant_id = o.tenant_id
      where o.tenant_id = ${tenantId}::uuid
      limit 1
    `);
    const row = firstRow(r);

    const website = safeTrim(row?.website);
    const aiAnalysis = row?.ai_analysis ?? null;

    const currentBrandLogoUrl = safeTrim(row?.brand_logo_url);
    const currentLeadToEmail = safeTrim(row?.lead_to_email);

    // If either is already set, return them as “suggested” too (don’t overwrite).
    if (currentBrandLogoUrl || currentLeadToEmail) {
      return NextResponse.json(
        {
          ok: true,
          tenantId,
          website: website || null,
          current: {
            brandLogoUrl: currentBrandLogoUrl || null,
            leadToEmail: currentLeadToEmail || null,
          },
          suggested: {
            brandLogoUrl: currentBrandLogoUrl || null,
            leadToEmail: currentLeadToEmail || null,
          },
          debug: { used: "tenant_settings" },
        },
        { status: 200 }
      );
    }

    if (!website) {
      return NextResponse.json(
        {
          ok: true,
          tenantId,
          website: null,
          current: { brandLogoUrl: null, leadToEmail: null },
          suggested: { brandLogoUrl: null, leadToEmail: null },
          debug: { used: "none", note: "No website saved on tenant_onboarding." },
        },
        { status: 200 }
      );
    }

    // AI suggestion is allowed, but we still run scrape scoring because AI may be noisy.
    const aiLogo = safeTrim(guessLogoFromAi(aiAnalysis));

    const htmlRes = await fetchHtml(website);
    const html = htmlRes.text || "";

    const scored = bestLogoCandidate(website, html);
    const bestScraped = scored.best?.url ? String(scored.best.url) : "";

    // Choose: best scrape first, then AI, then nothing.
    // (Reason: scrape now strongly prefers Organization.logo / logoish imgs / icons over og:image)
    const suggestedLogoUrl = bestScraped || (aiLogo ? toAbs(website, aiLogo) : "");

    const emails = extractEmails(html);
    const suggestedEmail = pickBestEmail(emails, website);

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        website,
        current: { brandLogoUrl: null, leadToEmail: null },
        suggested: {
          brandLogoUrl: suggestedLogoUrl || null,
          leadToEmail: suggestedEmail || null,
        },
        debug: {
          used: htmlRes.ok ? "scrape_scored" : "scrape_failed",
          httpStatus: htmlRes.status,
          contentType: htmlRes.contentType,
          logoPick: scored.best
            ? { kind: scored.best.kind, score: scored.best.score, url: scored.best.url, hint: scored.best.hint }
            : null,
          logoTop: scored.ranked.map((x) => ({ kind: x.kind, score: x.score, url: x.url })),
          aiLogo: aiLogo || null,
          emailCount: emails.length,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}