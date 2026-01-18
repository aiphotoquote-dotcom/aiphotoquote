import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const { userId } = await auth();

  if (userId) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-4xl font-semibold tracking-tight">AIPhotoQuote</h1>
        <p className="mt-4 max-w-2xl text-lg text-gray-700">
          AI-powered photo quoting for service businesses.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/sign-up"
            className="rounded-lg bg-black px-5 py-3 text-sm font-semibold text-white"
          >
            Create account
          </Link>
          <Link
            href="/sign-in"
            className="rounded-lg border border-gray-200 px-5 py-3 text-sm font-semibold hover:bg-gray-50"
          >
            Sign in
          </Link>
        </div>

        <div className="mt-12 rounded-2xl border p-6">
          <h2 className="font-semibold">How it works</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
            <li>Create a tenant</li>
            <li>Configure industry + OpenAI key + pricing guardrails</li>
            <li>Share your public quote page: <span className="font-mono">/q/&lt;tenantSlug&gt;</span></li>
          </ul>
        </div>
      </div>
    </main>
  );
}
