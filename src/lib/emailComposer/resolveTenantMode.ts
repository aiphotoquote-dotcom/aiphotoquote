import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

export type ComposerEmailMode = "standard" | "enterprise";

export async function resolveTenantEmailMode(tenantId: string): Promise<{
  mode: ComposerEmailMode;
  emailIdentityId: string | null;
}> {
  try {
    const r = await db.execute(sql`
      select email_send_mode, email_identity_id
      from tenant_settings
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any =
      (r as any)?.rows?.[0] ??
      (Array.isArray(r) ? (r as any)[0] : null);

    const rawMode = String(row?.email_send_mode ?? "standard")
      .trim()
      .toLowerCase();

    return {
      mode: rawMode === "enterprise" ? "enterprise" : "standard",
      emailIdentityId: row?.email_identity_id
        ? String(row.email_identity_id)
        : null,
    };
  } catch {
    return { mode: "standard", emailIdentityId: null };
  }
}