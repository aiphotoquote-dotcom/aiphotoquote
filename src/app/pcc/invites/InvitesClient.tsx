// src/app/pcc/invites/InvitesClient.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type OnboardingMode = "open" | "invite_only";
type InviteStatus = "pending" | "used" | "revoked" | "expired";
type InviteFilter = "all" | InviteStatus;

type InviteRow = {
  id: string;
  code: string;
  email: string | null;
  createdBy: string;
  createdByEmail?: string | null;
  campaignKey?: string | null;
  source?: string | null;
  targetIndustryKey?: string | null;
  targetIndustryLocked?: boolean | null;
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

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
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

function matchesSearch(invite: InviteRow, rawQuery: string) {
  const q = safeTrim(rawQuery).toLowerCase();
  if (!q) return true;

  const haystack = [
    invite.code,
    invite.email ?? "",
    invite.createdBy ?? "",
    invite.createdByEmail ?? "",
    invite.campaignKey ?? "",
    invite.source ?? "",
    invite.targetIndustryKey ?? "",
    invite.usedByTenantId ?? "",
    invite.meta?.note ?? "",
  ]
    .map((x) => String(x).toLowerCase())
    .join(" ");

  return haystack.includes(q);
}

function sortNewestFirst(a: InviteRow, b: InviteRow) {
  const ad = new Date(a.createdAt).getTime();
  const bd = new Date(b.createdAt).getTime();
  return bd - ad;
}

function countByStatus(invites: InviteRow[], status: InviteStatus) {
  return invites.filter((x) => x.status === status).length;
}

export default function InvitesClient({
  initialOnboardingMode,
  initialInvites,
}: {
  initialOnboardingMode: OnboardingMode;
  initialInvites: InviteRow[];
}) {
  const [invites, setInvites] = useState<InviteRow[]>([...initialInvites].sort(sortNewestFirst));

  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const [campaignKey, setCampaignKey] = useState("");
  const [source, setSource] = useState("");
  const [targetIndustryKey, setTargetIndustryKey] = useState("");
  const [targetIndustryLocked, setTargetIndustryLocked] = useState(false);

  const [creating, setCreating] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [filter, setFilter] = useState<InviteFilter>("pending");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const inviteOnly = initialOnboardingMode === "invite_only";
  const pageSize = 10;

  const inviteBaseUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/invite/`;
  }, []);

  const counts = useMemo(
    () => ({
      all: invites.length,
      pending: countByStatus(invites, "pending"),
      used: countByStatus(invites, "used"),
      revoked: countByStatus(invites, "revoked"),
      expired: countByStatus(invites, "expired"),
    }),
    [invites]
  );

  const filteredInvites = useMemo(() => {
    const rows = invites.filter((invite) => {
      if (filter !== "all" && invite.status !== filter) return false;
      return matchesSearch(invite, query);
    });

    return [...rows].sort(sortNewestFirst);
  }, [invites, filter, query]);

  const totalPages = Math.max(1, Math.ceil(filteredInvites.length / pageSize));

  const pagedInvites = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    return filteredInvites.slice(start, start + pageSize);
  }, [filteredInvites, page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [filter, query]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  async function createInvite() {
    setCreating(true);
    setErr(null);
    setMsg(null);

    try {
      const res = await fetch("/api/pcc/onboarding-invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: safeTrim(email) || null,
          note: safeTrim(note) || null,
          expiresAt: safeTrim(expiresAt) ? new Date(expiresAt).toISOString() : null,
          campaignKey: safeTrim(campaignKey) || null,
          source: safeTrim(source) || null,
          targetIndustryKey: safeTrim(targetIndustryKey) || null,
          targetIndustryLocked,
        }),
      });

      const data = await safeJson<any>(res);
      if (!res.ok || !data?.ok || !data?.invite) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }

      const newInvite = data.invite as InviteRow;
      setInvites((prev) => [newInvite, ...prev].sort(sortNewestFirst));
      setFilter("pending");

      if (data?.emailSendOk === false) {
        setMsg(`Invite created: ${data.invite.code}. Email warning: ${data.emailSendError || "send failed"}`);
      } else if (newInvite.email) {
        setMsg(`Invite created: ${data.invite.code}. Email sent.`);
      } else {
        setMsg(`Invite created: ${data.invite.code}`);
      }

      setEmail("");
      setNote("");
      setExpiresAt("");
      setCampaignKey("");
      setSource("");
      setTargetIndustryKey("");
      setTargetIndustryLocked(false);
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
      setInvites((prev) => prev.map((row) => (row.id === inviteId ? next : row)).sort(sortNewestFirst));
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
          able to create a tenant.
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
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Optional. Informational only — not required to redeem the code.
            </div>
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

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">Campaign key</label>
            <input
              value={campaignKey}
              onChange={(e) => setCampaignKey(e.target.value)}
              placeholder="hvac_beta_wave_1"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">Source</label>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="email / sms / referral"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">Target industry key</label>
            <input
              value={targetIndustryKey}
              onChange={(e) => setTargetIndustryKey(e.target.value)}
              placeholder="upholstery"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Optional industry hint or lock for this invite.
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-800 dark:bg-gray-900">
          <input
            id="targetIndustryLocked"
            type="checkbox"
            checked={targetIndustryLocked}
            onChange={(e) => setTargetIndustryLocked(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          <label htmlFor="targetIndustryLocked" className="text-sm text-gray-800 dark:text-gray-200">
            Lock target industry during onboarding
          </label>
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
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Invites</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">Most recent 200 invites.</div>
            </div>

            <div className="w-full lg:w-auto lg:min-w-[340px]">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Search</label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by code, email, campaign, source…"
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {([
              ["pending", `Pending (${counts.pending})`],
              ["used", `Used (${counts.used})`],
              ["revoked", `Revoked (${counts.revoked})`],
              ["expired", `Expired (${counts.expired})`],
              ["all", `All (${counts.all})`],
            ] as Array<[InviteFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  filter === value
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
            <div>
              Showing {filteredInvites.length === 0 ? 0 : (page - 1) * pageSize + 1}–
              {Math.min(page * pageSize, filteredInvites.length)} of {filteredInvites.length}
              {filter !== "all" ? ` ${filter}` : ""} invite{filteredInvites.length === 1 ? "" : "s"}
            </div>
            <div>
              Page {totalPages === 0 ? 1 : page} of {totalPages}
            </div>
          </div>
        </div>

        {filteredInvites.length === 0 ? (
          <div className="px-5 py-8 text-sm text-gray-600 dark:text-gray-300">No invites match the current view.</div>
        ) : (
          <>
            <div className="divide-y divide-gray-200 dark:divide-gray-800">
              {pagedInvites.map((invite) => {
                const link = `${inviteBaseUrl}${encodeURIComponent(invite.code)}`;
                const noteText =
                  invite.meta && typeof invite.meta === "object" && invite.meta.note
                    ? String(invite.meta.note)
                    : null;

                const campaign = safeTrim(invite.campaignKey);
                const sourceText = safeTrim(invite.source);
                const targetIndustry = safeTrim(invite.targetIndustryKey);
                const creatorEmail = safeTrim(invite.createdByEmail);

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
                          {targetIndustry ? (
                            <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-900 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-100">
                              industry: {targetIndustry}
                              {invite.targetIndustryLocked ? " (locked)" : ""}
                            </span>
                          ) : null}
                        </div>

                        <div className="text-sm text-gray-600 dark:text-gray-300">Email: {invite.email ?? "—"}</div>

                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Created: {fmtDate(invite.createdAt)} · Expires: {fmtDate(invite.expiresAt)} · Used:{" "}
                          {fmtDate(invite.usedAt)}
                        </div>

                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Created by: <span className="font-mono">{invite.createdBy}</span>
                          {creatorEmail ? <> · {creatorEmail}</> : null}
                        </div>

                        {campaign || sourceText ? (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {campaign ? (
                              <>
                                Campaign: <span className="font-mono">{campaign}</span>
                              </>
                            ) : null}
                            {campaign && sourceText ? " · " : null}
                            {sourceText ? (
                              <>
                                Source: <span className="font-mono">{sourceText}</span>
                              </>
                            ) : null}
                          </div>
                        ) : null}

                        {invite.usedByTenantId ? (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Tenant used: <span className="font-mono">{invite.usedByTenantId}</span>
                          </div>
                        ) : null}

                        {noteText ? <div className="text-xs text-gray-600 dark:text-gray-300">Note: {noteText}</div> : null}

                        <div className="break-all text-xs text-gray-500 dark:text-gray-400">Link: {link}</div>
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

            <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
              >
                Previous
              </button>

              <div className="text-xs text-gray-500 dark:text-gray-400">
                Page {page} of {totalPages}
              </div>

              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}