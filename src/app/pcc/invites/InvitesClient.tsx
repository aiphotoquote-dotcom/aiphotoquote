// src/app/pcc/invites/InvitesClient.tsx
"use client";

import React, { useMemo, useState } from "react";

type OnboardingMode = "open" | "invite_only";
type InviteStatus = "pending" | "used" | "revoked" | "expired";

type InviteRow = {
  id: string;
  code: string;
  email: string | null;
  createdBy: string;
  status: InviteStatus;
  usedByTenantId: string | null;
  usedAt: string | Date | null;
  expiresAt: string | Date | null;
  meta: Record<string, any>;
  createdAt: string | Date;
  updatedAt: string | Date;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function fmtDate(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString();
}

function statusTone(status: InviteStatus) {
  if (status === "used") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100";
  }
  if (status === "revoked") {
    return "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200";
  }
  if (status === "expired") {
    return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100";
  }
  return "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100";
}

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expected JSON but got "${ct || "unknown"}". ${text.slice(0, 180)}`);
  }
  return (await res.json()) as T;
}

export default function InvitesClient({
  initialOnboardingMode,
  initialInvites,
}: {
  initialOnboardingMode: OnboardingMode;
  initialInvites: InviteRow[];
}) {
  const [invites, setInvites] = useState<InviteRow[]>(initialInvites);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const inviteOnly = initialOnboardingMode === "invite_only";

  const inviteBaseUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/invite/`;
  }, []);

  async function createInvite() {
    setCreating(true);
    setErr(null);
    setMsg(null);

    try {
      const res = await fetch("/api/pcc/onboarding-invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim() || null,
          note: note.trim() || null,
          expiresAt: expiresAt.trim() ? new Date(expiresAt).toISOString() : null,
        }),
      });

      const data = await safeJson<any>(res);
      if (!res.ok || !data?.ok || !data?.invite) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }

      setInvites((prev) => [data.invite as InviteRow, ...prev]);
      setMsg(`Invite created: ${data.invite.code}`);
      setEmail("");
      setNote("");
      setExpiresAt("");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    setWorkingId(inviteId);
    setErr(null);
    setMsg(null);

    try {
      const res = await fetch(`/api/pcc/onboarding-invites/${encodeURIComponent(inviteId)}/revoke`, {
        method: "POST",
      });

      const data = await safeJson<any>(res);
      if (!res.ok || !data?.ok || !data?.invite) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }

      const next = data.invite as InviteRow;
      setInvites((prev) => prev.map((row) => (row.id === inviteId ? next : row)));
      setMsg(`Invite revoked: ${next.code}`);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setWorkingId(null);
    }
  }

  async function copyText(value: string, label: string) {
    setErr(null);
    setMsg(null);

    try {
      await navigator.clipboard.writeText(value);
      setMsg(`${label} copied`);
    } catch (e: any) {
      setErr(e?.message ?? `Failed to copy ${label.toLowerCase()}`);
    }
  }

  return (
    <div className="space-y-6">
      {!inviteOnly ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          Onboarding is currently <span className="font-semibold">open</span>. Invites can still be created now, but they
          will only be enforced once onboarding mode is switched to <span className="font-semibold">invite_only</span>.
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          Onboarding is currently <span className="font-semibold">invite_only</span>. Only valid invites/codes should be
          able to create a tenant once the onboarding gate is wired.
        </div>
      )}

      {msg ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          {msg}
        </div>
      ) : null}

      {err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Create invite</div>
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Generate a single-use invite code for a new tenant onboarding.
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">Invitee email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">Expires at</label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">Note</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional internal note"
            rows={3}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={createInvite}
            disabled={creating}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
          >
            {creating ? "Creating…" : "Create invite"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
        <div className="border-b border-gray-200 bg-gray-50 px-5 py-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Invites</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Most recent 200 invites.
          </div>
        </div>

        {invites.length === 0 ? (
          <div className="px-5 py-8 text-sm text-gray-600 dark:text-gray-300">No invites yet.</div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {invites.map((invite) => {
              const link = `${inviteBaseUrl}${encodeURIComponent(invite.code)}`;
              const noteText =
                invite.meta && typeof invite.meta === "object" && invite.meta.note
                  ? String(invite.meta.note)
                  : null;

              return (
                <div key={invite.id} className="px-5 py-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {invite.code}
                        </div>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                            statusTone(invite.status)
                          )}
                        >
                          {invite.status}
                        </span>
                      </div>

                      <div className="text-sm text-gray-600 dark:text-gray-300">
                        Email: {invite.email ?? "—"}
                      </div>

                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Created: {fmtDate(invite.createdAt)} · Expires: {fmtDate(invite.expiresAt)} · Used:{" "}
                        {fmtDate(invite.usedAt)}
                      </div>

                      {invite.usedByTenantId ? (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Tenant used: <span className="font-mono">{invite.usedByTenantId}</span>
                        </div>
                      ) : null}

                      {noteText ? (
                        <div className="text-xs text-gray-600 dark:text-gray-300">
                          Note: {noteText}
                        </div>
                      ) : null}

                      <div className="break-all text-xs text-gray-500 dark:text-gray-400">
                        Link: {link}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => copyText(invite.code, "Code")}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
                      >
                        Copy code
                      </button>

                      <button
                        type="button"
                        onClick={() => copyText(link, "Invite link")}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
                      >
                        Copy link
                      </button>

                      {invite.status === "pending" ? (
                        <button
                          type="button"
                          onClick={() => revokeInvite(invite.id)}
                          disabled={workingId === invite.id}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/50"
                        >
                          {workingId === invite.id ? "Revoking…" : "Revoke"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}