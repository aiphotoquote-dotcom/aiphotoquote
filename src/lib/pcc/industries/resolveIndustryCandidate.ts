// src/lib/pcc/industries/resolveIndustryCandidate.ts

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export function normalizeIndustryKey(v: unknown) {
  const s = safeTrim(v).toLowerCase();
  return s
    .replace(/[\s\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeLabel(v: unknown) {
  return safeTrim(v).toLowerCase();
}

export async function resolveIndustryCandidate(args: {
  proposedKey?: string | null;
  proposedLabel?: string | null;
}) {
  const proposedKey = normalizeIndustryKey(args.proposedKey ?? "");
  const proposedLabelRaw = safeTrim(args.proposedLabel ?? "");
  const proposedLabel = normalizeLabel(proposedLabelRaw);

  // 1) exact key match (canonical)
  if (proposedKey) {
    const r = await db.execute(sql`
      select key::text as "key", label::text as "label", description::text as "description"
      from industries
      where lower(key) = ${proposedKey}
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? null;
    if (row?.key) {
      return { key: normalizeIndustryKey(row.key), label: String(row.label ?? row.key), matched: "canonical_key" as const };
    }
  }

  // 2) exact label match (canonical)
  if (proposedLabel) {
    const r = await db.execute(sql`
      select key::text as "key", label::text as "label"
      from industries
      where lower(trim(label)) = ${proposedLabel}
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? null;
    if (row?.key) {
      return { key: normalizeIndustryKey(row.key), label: String(row.label ?? row.key), matched: "canonical_label" as const };
    }
  }

  // 3) fallback: keep proposed (derived)
  // We return normalized key + label, but no canonical mapping
  return {
    key: proposedKey || normalizeIndustryKey(proposedLabelRaw) || "service",
    label: proposedLabelRaw || "",
    matched: "derived" as const,
  };
}