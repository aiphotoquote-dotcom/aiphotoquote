import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

/**
 * Normalize to match your PCC normalization style:
 * - lowercase
 * - & -> and
 * - non-alnum -> underscore
 * - collapse underscores
 */
export function normalizeIndustryKey(v: unknown) {
  const s = safeTrim(v).toLowerCase();
  if (!s) return "";
  return s
    .replace(/&/g, "and")
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function titleFromKey(key: string) {
  const s = safeTrim(key).replace(/[-_]+/g, " ").trim();
  if (!s) return "Service";
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Resolve an AI-proposed industry to canonical if it exists.
 * - try key exact match (case-insensitive)
 * - try label exact match (case-insensitive trimmed)
 * - else return normalized derived key
 */
export async function resolveIndustryCandidate(args: {
  proposedKey?: string | null;
  proposedLabel?: string | null;
}) {
  const proposedKeyNorm = normalizeIndustryKey(args.proposedKey ?? "");
  const proposedLabelRaw = safeTrim(args.proposedLabel ?? "");
  const proposedLabelNorm = safeTrim(args.proposedLabel ?? "").toLowerCase();

  // 1) canonical by key
  if (proposedKeyNorm) {
    const r = await db.execute(sql`
      select key::text as "key", label::text as "label", description::text as "description"
      from industries
      where lower(key) = ${proposedKeyNorm}
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? null;
    if (row?.key) {
      return {
        key: normalizeIndustryKey(row.key),
        label: safeTrim(row.label) || titleFromKey(String(row.key)),
        description: row.description ? String(row.description) : null,
        isCanonical: true,
        matchedBy: "key" as const,
      };
    }
  }

  // 2) canonical by label (exact)
  if (proposedLabelNorm) {
    const r = await db.execute(sql`
      select key::text as "key", label::text as "label", description::text as "description"
      from industries
      where lower(trim(label)) = ${proposedLabelNorm}
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? null;
    if (row?.key) {
      return {
        key: normalizeIndustryKey(row.key),
        label: safeTrim(row.label) || titleFromKey(String(row.key)),
        description: row.description ? String(row.description) : null,
        isCanonical: true,
        matchedBy: "label" as const,
      };
    }
  }

  // 3) derived
  const derivedKey =
    proposedKeyNorm || normalizeIndustryKey(proposedLabelRaw) || "service";

  return {
    key: derivedKey,
    label: proposedLabelRaw || titleFromKey(derivedKey),
    description: null,
    isCanonical: false,
    matchedBy: "derived" as const,
  };
}