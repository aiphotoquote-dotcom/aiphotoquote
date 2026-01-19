import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const { userId } = await auth();

  // ✅ Make dashboard the "home" for signed-in users
  if (userId) {
    redirect("/dashboard");
  }

  // Signed-out "starter" landing (simple, can polish later)
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-16 space-y-10">
        <div className="space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight">
            AIPhotoQuote
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl">
            AI-powered photo quoting for service businesses. Collect photos, generate an estimate,
            and optionally create an AI “after” rendering — all under your tenant brand and settings.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/sign-in"
            className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white dark:bg-white dark:text-black"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-950"
          >
            Create account
          </Link>
        </div>

        <div className="rounded-2xl border border-gray-200 p-6 dark:border-gray-800">
          <h2 className="font-semibold">What you’ll do first</h2>
          <ol className="mt-3 list-decimal pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-1">
            <li>Complete onboarding (tenant slug + industry + OpenAI key).</li>
            <li>Share your public quote page: <span className="font-mono">/q/&lt;tenantSlug&gt;</span></li>
            <li>Run a test quote end-to-end (estimate + optional rendering).</li>
          </ol>
        </div>
      </div>
    </main>
  );
}
