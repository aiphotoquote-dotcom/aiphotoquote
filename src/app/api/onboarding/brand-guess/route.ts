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

function extractEmails(html: string) {
  const found = new Set<string>();

  // mailto:
  const mailtoRe = /mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
  let m: RegExpExecArray | null;
  while ((m = mailtoRe.exec(html))) found.add(String(m[1]).toLowerCase());

  // plain emails:
  const emailRe = /\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi;
  while ((m = emailRe.exec(html))) found.add(String(m[1]).toLowerCase());

  return Array.from(found);
}

function scoreEmail(email: string, websiteUrl: string) {
  const e = email.toLowerCase();
  let score = 0;

  // prefer non-noreply
  if (!e.includes("noreply") && !e.includes("no-reply")) score += 3;

  // prefer common business inboxes
  if (e.startsWith("info@")) score += 3;
  if (e.startsWith("sales@")) score += 2;
  if (e.startsWith("quotes@")) score += 2;
  if (e.startsWith("contact@")) score += 2;

  // prefer matching domain
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./, "");
    const domain = e.split("@")[1] ?? "";
    if (domain === host) score += 5;
    if (domain.endsWith(host)) score += 3;
  } catch {}

  // mild penalty for personal providers
  if (/(gmail|yahoo|outlook|hotmail|icloud)\.com$/i.test(e.split("@")[1] ?? "")) score -= 1;

  return score;
}

function pickBestEmail(emails: string[], websiteUrl: string) {
  if (!emails.length) return "";
  const sorted = [...emails].sort((a, b) => scoreEmail(b, websiteUrl) - scoreEmail(a, websiteUrl));
  return sorted[0] ?? "";
}

function extractMetaContent(html: string, key: { property?: string; name?: string }) {
  const prop = key.property ? String(key.property).toLowerCase() : "";
  const name = key.name ? String(key.name).toLowerCase() : "";

  // crude but effective meta matcher
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

function extractLinkHref(html: string, relValue: string) {
  const rel = relValue.toLowerCase();

  const linkRe = /<link\b[^>]*>/gi;
  const attrsRe = /([a-zA-Z:_-]+)\s*=\s*["']([^"']+)["']/g;

  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    while ((a = attrsRe.exec(tag))) attrs[a[1].toLowerCase()] = a[2];

    const r = (attrs["rel"] ?? "").toLowerCase();
    if (!r) continue;

    // match if rel contains our relValue token
    if (r.includes(rel)) {
      return attrs["href"] ?? "";
    }
  }

  return "";
}

function extractLikelyLogoImg(html: string) {
  // Try to find <img ...> with class/id/alt containing "logo"
  const imgRe = /<img\b[^>]*>/gi;
  const attrsRe = /([a-zA-Z:_-]+)\s*=\s*["']([^"']+)["']/g;

  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html))) {
    const tag = m[0];
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    while ((a = attrsRe.exec(tag))) attrs[a[1].toLowerCase()] = a[2];

    const alt = (attrs["alt"] ?? "").toLowerCase();
    const cls = (attrs["class"] ?? "").toLowerCase();
    const id = (attrs["id"] ?? "").toLowerCase();

    const looksLogo = alt.includes("logo") || cls.includes("logo") || id.includes("logo");
    if (!looksLogo) continue;

    const src = attrs["src"] ?? attrs["data-src"] ?? "";
    if (src) return src;
  }
  return "";
}

function guessLogoFromAi(ai: any | null) {
  // flexible: try common shapes we’ve used
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

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
    headers: {
      // helps some sites return real HTML instead of bot-block minimal pages
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  });

  const ct = res.headers.get("content-type") || "";
  const text = await res.text();

  return { ok: res.ok, status: res.status, contentType: ct, text };
}

export async function GET(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const u = new URL(req.url);
    const tenantId = safeTrim(u.searchParams.get("tenantId"));
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });
    }

    await requireMembership(clerkUserId, tenantId);

    // Pull: website + ai_analysis + current settings
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

    // If both are already set, no need to scrape.
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
          debug: {
            used: "tenant_settings",
          },
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

    // 1) Prefer AI-provided logo if present
    const aiLogo = guessLogoFromAi(aiAnalysis);
    // 2) Otherwise scrape
    const htmlRes = await fetchHtml(website);

    const html = htmlRes.text || "";

    // Try: og:image, twitter:image, img heuristics, icons
    const ogImage = extractMetaContent(html, { property: "og:image" });
    const twImage = extractMetaContent(html, { name: "twitter:image" });
    const appleIcon = extractLinkHref(html, "apple-touch-icon");
    const icon = extractLinkHref(html, "icon");
    const logoImg = extractLikelyLogoImg(html);

    const logoCandidate =
      safeTrim(aiLogo) ||
      safeTrim(ogImage) ||
      safeTrim(twImage) ||
      safeTrim(logoImg) ||
      safeTrim(appleIcon) ||
      safeTrim(icon);

    const suggestedLogoUrl = logoCandidate ? toAbs(website, logoCandidate) : "";

    // Emails
    const emails = extractEmails(html);
    const suggestedEmail = pickBestEmail(emails, website);

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        website,
        current: {
          brandLogoUrl: null,
          leadToEmail: null,
        },
        suggested: {
          brandLogoUrl: suggestedLogoUrl || null,
          leadToEmail: suggestedEmail || null,
        },
        debug: {
          used: htmlRes.ok ? "scrape" : "scrape_failed",
          httpStatus: htmlRes.status,
          contentType: htmlRes.contentType,
          candidates: {
            aiLogo: aiLogo || null,
            ogImage: ogImage ? toAbs(website, ogImage) : null,
            twitterImage: twImage ? toAbs(website, twImage) : null,
            logoImg: logoImg ? toAbs(website, logoImg) : null,
            appleIcon: appleIcon ? toAbs(website, appleIcon) : null,
            icon: icon ? toAbs(website, icon) : null,
          },
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