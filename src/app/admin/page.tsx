import TopNav from "@/components/TopNav";

export default function Admin() {
  return (
    <main className="min-h-screen">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <h1 className="text-2xl font-semibold">Admin</h1>

        <div className="rounded-2xl border p-6">
          <p className="text-sm text-gray-700">
            Coming next: Prompt Library, Bundles, Tenant list, Quote logs.
          </p>
        </div>
      </div>
    </main>
  );
}
