import QuoteForm from "@/components/QuoteForm";

export default async function Page({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl border p-6 md:p-8 shadow-sm">
          <h1 className="text-2xl font-semibold">Get a Photo Quote</h1>
          <p className="mt-2 text-sm text-gray-600">
            Upload a few clear photos and we’ll send back an estimate range.
          </p>

          <div className="mt-6">
            <QuoteForm tenantSlug={tenantSlug} />
          </div>
        </div>
      </div>
    </main>
  );
}
