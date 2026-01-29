import { db } from "@/lib/db/client";
import { platformConfig } from "@/lib/db/schema/platform_config";
import { eq } from "drizzle-orm";

/**
 * Always returns the platform config.
 * If the singleton row does not exist, it is created automatically.
 */
export async function getPlatformConfig() {
  try {
    const rows = await db
      .select()
      .from(platformConfig)
      .where(eq(platformConfig.id, "singleton"))
      .limit(1);

    if (rows.length === 1) {
      return rows[0];
    }

    // Bootstrap singleton row
    const inserted = await db
      .insert(platformConfig)
      .values({ id: "singleton" })
      .returning();

    return inserted[0];
  } catch (err) {
    /**
     * LAST-RESORT SAFE DEFAULTS
     * (prevents total platform lockout if DB is unavailable)
     */
    return {
      id: "singleton",
      aiQuotingEnabled: true,
      aiRenderingEnabled: true,
      maintenanceEnabled: false,
      maintenanceMessage: null,
      updatedAt: new Date(),
    };
  }
}