// src/lib/pcc/llm/industryStore.ts
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { PlatformLlmConfig } from "@/lib/pcc/llm/types";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function isPlainObject(v: any) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Returns a Partial<PlatformLlmConfig> industry pack (models/prompts only).
 * Guardrails are platform-locked and should NOT be stored here.
 */
export async function getIndustryLlmPack(industryKey: string | null | undefined): Promise<Partial<PlatformLlmConfig> | null> {
  const key = safeTrim(industryKey).toLowerCase();
  if (!key) return null;

  try {
    const r = await db.execute(sql`
      select pack
      from industry_llm_packs
      where industry_key = ${key}
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    const pack = row?.pack ?? null;

    if (!isPlainObject(pack)) return null;

    // Defensive: strip guardrails if someone accidentally stored them
    if (isPlainObject((pack as any).guardrails)) {
      delete (pack as any).guardrails;
    }

    return pack as Partial<PlatformLlmConfig>;
  } catch {
    return null;
  }
}