import TopNav from "@/components/TopNav";
import Link from "next/link";

export default function Dashboard() {
  return (
    <main className="min-h-screen">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>

        <div className="rounded-2xl border p-6">
          <h2 className="font-semibold">Quick actions</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-2">
            <li>
              Go to <b>Onboarding</b> to set your tenant slug, industry, OpenAI key, and redirects.
              <span className="ml-2">
                <Link className="underline" href="/onboarding">
                  Open onboarding
                </Link>
              </span>
            </li>
            <li>
              Your public quote page will be:
              <span className="ml-2 font-mono">/q/&lt;tenant-slug&gt;</span>
            </li>
            <li>
              Admin area:
              <span className="ml-2">
                <Link className="underline" href="/admin">
                  Open admin
                </Link>
              </span>
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border p-6">
          <h2 className="font-semibold">What’s next</h2>
          <p className="mt-2 text-sm text-gray-700">
            Next we’ll refine tenant dashboard UX + navigation flow and then tighten the onboarding → dashboard experience.
          </p>
        </div>
      </div>
    </main>
  );
}
