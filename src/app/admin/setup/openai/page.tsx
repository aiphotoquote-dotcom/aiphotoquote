"use client";

import React, { useEffect, useMemo, useState } from "react";

type StatusResp =
  | {
      ok: true;
      tenantId: string;
      role: "owner" | "admin" | "member";
      configured: boolean;
      openai_key_last4: string | null;
      updated_at: string | null;
    }
  | { ok: false; error: string; message?: string };

type SaveResp =
  | { ok: true; tenantId: string; configured: true; openai_key_last4: string }
  | { ok: false; error: string; message?: string; issues?: any };

type TestResp =
  | { ok: true; tenantId: string; openai_key_last4: string | null; updated_at: string | null; responseId: string | null; note: string }
  | { ok: false; error: string; message?: string; status?: number; code?: string; type?: string };

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expected JSON but got "${ct || "unknown"}" (status ${res.status}). First 80 chars: ${text.slice(0, 80)}`);
  }
  return (await res.json()) as T;
}

export default function OpenAISetupPage() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResp | null>(null);

  const canEdit = useMemo(() => {
    const r = (status as any)?.role;
    return r === "owner" || r === "admin";
  }, [status]);

  async function load() {
    setErr(null);
    setMsg(null);
    setTestResult(null);
    setLoading(true);

    try {
      // Ensure tenant cookie exists (auto-select on GET)
      await fetch("/api/tenant/context", { cache: "no-store" });

      const res = await fetch("/api/admin/openai-key", { cache: "no-store" });
      const data = await safeJson<StatusResp>(res);
      if (!data.ok) throw new Error(data.message || data.error || "Failed to load OpenAI key status");
      setStatus(data);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setErr(null);
    setMsg(null);
    setTestResult(null);
    setSaving(true);

    try {
      const res = await fetch("/api/admin/openai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openai_api_key: keyInput.trim() }),
      });
      const data = await safeJson<SaveResp>(res);
      if (!data.ok) {
        throw new Error(data.message || data.error || "Failed to save key");
      }
      setMsg(`Saved. Key ending in ${data.openai_key_last4}.`);
      setKeyInput("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function testKey() {
    setErr(null);
    setMsg(null);
    setTestResult(null);
    setTesting(true);

    try {
      const res = await fetch("/api/admin/openai-key/test", { method: "POST" });
      const data = await safeJson<TestResp>(res);
      setTestResult(data);
      if (!data.ok) throw new Error(data.message || data.error || "Test failed");
      setMsg("Test succeeded.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const role = (status as any)?.role ?? null;

  return (
    <div className="mx-auto max-w-3xl p-6 bg-gray-50 min-h-screen">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Setup: OpenAI Key</h1>
          <p className="mt-1 text-sm text-gray-600">
            Add your OpenAI API key so AI Photo Quote can generate assessments for your tenant.
          </p>
          {role ? (
            <div className="mt-2 text-sm">
              <span className="rounded-md bg-white border border-gray-200 px-2 py-1 text-gray-800">
                Role: <span className="font-mono">{role}</span>
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex gap-2">
          <a
            href="/admin"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
          >
            ← Setup Home
          </a>
          <button
            onClick={load}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="text-sm text-gray-700">Loading…</div>
        ) : err ? (
          <div className="text-sm text-red-700 whitespace-pre-wrap">{err}</div>
        ) : status && status.ok ? (
          <div className="grid gap-6">
            {/* Status */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="text-sm font-semibold text-gray-900">Current status</div>

              <div className="mt-2 text-sm text-gray-700">
                Configured:{" "}
                <span className={status.configured ? "text-green-700 font-semibold" : "text-yellow-800 font-semibold"}>
                  {status.configured ? "Yes" : "No"}
                </span>
              </div>

              <div className="mt-1 text-sm text-gray-700">
                Key last4: <span className="font-mono">{status.openai_key_last4 ?? "—"}</span>
              </div>

              <div className="mt-1 text-sm text-gray-700">
                Updated: <span className="font-mono">{status.updated_at ?? "—"}</span>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={testKey}
                  disabled={!canEdit || testing || !status.configured}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {testing ? "Testing…" : "Test Key"}
                </button>

                <a
                  href="/admin/settings"
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
                >
                  Email Settings →
                </a>
              </div>

              {!canEdit ? (
                <div className="mt-3 text-sm text-yellow-900">
                  You can view this page, but only <span className="font-mono">owner</span> or <span className="font-mono">admin</span> can change the key.
                </div>
              ) : null}
            </div>

            {/* Save form */}
            <div>
              <div className="text-sm font-semibold text-gray-900">Add / Update key</div>
              <p className="mt-1 text-sm text-gray-600">
                Your key is stored encrypted. We only display the last 4 characters.
              </p>

              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-800">OpenAI API Key</label>
                <input
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  disabled={!canEdit || saving}
                  placeholder="sk-..."
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>

              <div className="mt-3 flex items-center gap-4">
                <button
                  onClick={save}
                  disabled={!canEdit || saving || keyInput.trim().length < 20}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save Key"}
                </button>

                {msg && <span className="text-sm text-green-700">{msg}</span>}
                {err && <span className="text-sm text-red-700 whitespace-pre-wrap">{err}</span>}
              </div>

              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                Tip: after saving, click <span className="font-semibold">Test Key</span> to confirm the tenant is ready to generate assessments.
              </div>
            </div>

            {/* Test output */}
            {testResult ? (
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="text-sm font-semibold text-gray-900">Test result</div>
                <pre className="mt-2 text-xs text-gray-800 whitespace-pre-wrap">
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-sm text-gray-700">No status available.</div>
        )}
      </div>
    </div>
  );
}
