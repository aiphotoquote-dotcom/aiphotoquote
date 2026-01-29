// src/lib/pcc/platformConfig.ts
import { db } from "@/lib/db/client";
import { platformConfig } from "@/lib/db/schema";

/**
 * PlatformConfig is a single-row “feature gate” record.
 * We treat it as optional and fall back to defaults if missing.
 */
export type PlatformConfig = {
  aiQuotingEnabled: boolean;
  aiRenderingEnabled: boolean;
  maintenanceEnabled: boolean;
  maintenanceMessage: string | null;
};

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  aiQuotingEnabled: true,
  aiRenderingEnabled: false,
  maintenanceEnabled: false,
  maintenanceMessage: null,
};

/**
 * Read platform config (single row).
 * - If there are 0 rows, return defaults.
 * - If table isn't migrated yet or query fails, return defaults (no hard crash).
 */
export async function getPlatformConfig(): Promise<PlatformConfig> {
  try {
    // single-row table: just take the first row if present
    const rows = await db.select().from(platformConfig).limit(1);
    const r = rows?.[0];

    if (!r) return DEFAULT_PLATFORM_CONFIG;

    return {
      aiQuotingEnabled: Boolean((r as any).aiQuotingEnabled),
      aiRenderingEnabled: Boolean((r as any).aiRenderingEnabled),
      maintenanceEnabled: Boolean((r as any).maintenanceEnabled),
      maintenanceMessage: (r as any).maintenanceMessage ? String((r as any).maintenanceMessage) : null,
    };
  } catch (e) {
    // If migrations aren't applied yet (table missing) or any transient DB issue:
    // do not take the whole app down.
    return DEFAULT_PLATFORM_CONFIG;
  }
}