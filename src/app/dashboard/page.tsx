import TopNav from "@/components/TopNav";

function pickFirstNonEmpty(...vals: Array<unknown>) {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

export default function Dashboard() {
  // NOTE: This page is intentionally simple and static right now.
  // If you later want it to be server-driven with tenant settings,
  // we can fetch /api/tenant/me-settings and show status blocks.

  // If you *already* have tenant settings being passed into this page somewhere
  // in your local version, keep that logic there; this file compiles cleanly.

  return (
    <main className="min-h-screen">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>

        <div className="rounded-2xl border p-6">
          <h2 className="font-semibold">Quick actions</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
            <li>
              Go to <b>Onboarding</b> to set your tenant slug, industry, OpenAI key, and redirects.
            </li>
            <li>
              After onboarding, your public quote page will be:
              <span className="ml-2 font-mono">/q/&lt;tenant-slug&gt;</span>
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border p-6">
          <h2 className="font-semibold">What’s next</h2>
          <p className="mt-2 text-sm text-gray-700">
            Next we’ll add: tenant lookup + embedded widget script + admin prompt library.
          </p>
        </div>
      </div>
    </main>
  );
}
