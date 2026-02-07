// src/app/pcc/layout.tsx
import React from "react";
import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export const runtime = "nodejs";

function NavItem({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
    >
      {label}
    </Link>
  );
}

function parseAllowlist(raw: string | undefined | null): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  return s
    .split(/[,\n]/g)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * PCC gate:
 * - Must be signed in
 * - Must be in allowlist (email-based) unless allowlist is empty in dev
 *
 * Supports multiple env var names so we don't accidentally "replace" existing infra.
 */
async function requirePccAccess() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/pcc");

  const u = await currentUser();
  const emails = (u?.emailAddresses || [])
    .map((e) => String(e.emailAddress || "").toLowerCase().trim())
    .filter(Boolean);

  const allowlist =
    parseAllowlist(process.env.PCC_ADMIN_EMAILS) ||
    parseAllowlist(process.env.PCC_ALLOWLIST_EMAILS) ||
    parseAllowlist(process.env.PLATFORM_ADMIN_EMAILS) ||
    parseAllowlist(process.env.PLATFORM_ALLOWLIST_EMAILS);

  // If allowlist is empty:
  // - allow in dev to avoid locking yourself out
  // - block in prod because PCC is dangerous
  if (allowlist.length === 0) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) {
      return {
        ok: false as const,
        reason: "PCC allowlist env var is not set in production.",
        emails,
      };
    }
    return { ok: true as const, emails };
  }

  const ok = emails.some((e) => allowlist.includes(e));
  if (!ok) {
    return {
      ok: false as const,
      reason: "Your account is not in the PCC allowlist.",
      emails,
    };
  }

  return { ok: true as const, emails };
}

export default async function PccLayout({ children }: { children: React.ReactNode }) {
  const access = await requirePccAccess();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-wrap items-center gap-2">
          <NavItem href="/pcc" label="Overview" />
          <NavItem href="/pcc/industries" label="Industries" />
          <NavItem href="/pcc/llm" label="LLM Manager" />
          <NavItem href="/pcc/env" label="Environment" />
          <NavItem href="/pcc/tenants" label="Tenants" />
          <NavItem href="/pcc/billing" label="Billing" />
        </div>
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">Platform Control Center</div>
      </div>

      {access.ok ? (
        children
      ) : (
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-6 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
          <div className="text-base font-semibold">Access denied</div>
          <div className="mt-2">{access.reason}</div>
          <div className="mt-3 text-xs opacity-80">
            Signed-in email(s):{" "}
            <span className="font-mono">
              {access.emails.length ? access.emails.join(", ") : "(none found on user)"}
            </span>
          </div>
          <div className="mt-4 text-xs">
            Expected env var (one of):{" "}
            <span className="font-mono">
              PCC_ADMIN_EMAILS, PCC_ALLOWLIST_EMAILS, PLATFORM_ADMIN_EMAILS, PLATFORM_ALLOWLIST_EMAILS
            </span>
          </div>
        </div>
      )}
    </div>
  );
}