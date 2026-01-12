import Link from "next/link";
import TopNav from "@/components/TopNav";

const TIERS = [
  {
    name: "Starter",
    price: "$29",
    cadence: "/mo",
    blurb: "For solo shops testing AI quoting.",
    highlights: [
      "AI photo-based estimate",
      "Customer + admin email notifications",
      "Redirect/thank-you URLs",
      "Basic pricing guardrails",
      "Unlimited quote forms",
    ],
    cta: { label: "Get started", href: "/sign-up" },
  },
  {
    name: "Pro",
    price: "$79",
    cadence: "/mo",
    blurb: "For busy shops that want consistency and speed.",
    highlights: [
      "Everything in Starter",
      "Advanced guardrails (min/typical/max)",
      "Admin workflow for leads",
      "Higher quality AI analysis",
      "Priority deliverability tuning",
    ],
    cta: { label: "Start Pro", href: "/sign-up" },
    featured: true,
  },
  {
    name: "Business",
    price: "Let’s talk",
    cadence: "",
    blurb: "For multi-location or high-volume operations.",
    highlights: [
      "Everything in Pro",
      "Custom routing + lead workflows",
      "Dedicated onboarding + migration",
      "Custom tuning (where applicable)",
      "SLA & priority support",
    ],
    cta: { label: "Contact sales", href: "/onboarding" },
  },
];

const FAQ = [
  {
    q: "Is this an instant quote or an estimate?",
    a: "It’s an estimate. You control the guardrails so the output stays realistic and protects your margins. For complex jobs, the system can recommend an inspection.",
  },
  {
    q: "What does the customer experience look like?",
    a: "Customers upload photos and notes, then get a customer-friendly estimate range. You get a clean lead email (with photos) and the record is stored in admin.",
  },
  {
    q: "Can I customize the redirect and thank-you pages?",
    a: "Yes — set your redirect URL and optional thank-you URL in Settings and route customers wherever you want next.",
  },
  {
    q: "Does it work for automotive and marine upholstery?",
    a: "Absolutely. Photo-first quoting shines when customers can’t describe the job but can take great pictures.",
  },
];

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Dot() {
  return <span className="mt-1 inline-block h-2 w-2 rounded-full bg-black" />;
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white text-black">
      <TopNav />

      {/* HERO */}
      <section className="relative overflow-hidden border-b">
        {/* Background */}
        <div className="absolute inset-0">
          <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-gradient-to-br from-gray-200 to-white blur-3xl opacity-80" />
          <div className="absolute -left-40 top-24 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-gray-100 to-white blur-3xl opacity-90" />
          <div className="absolute -right-40 top-32 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-gray-100 to-white blur-3xl opacity-90" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(0,0,0,0.08),transparent_45%),radial-gradient(circle_at_80%_20%,rgba(0,0,0,0.06),transparent_45%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.0),rgba(255,255,255,0.9))]" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            {/* Left */}
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1 text-xs text-gray-700 backdrop-blur">
                <span className="font-semibold">AIPhotoQuote</span>
                <span className="text-gray-400">•</span>
                <span>Photo-based estimates that feel premium</span>
              </div>

              <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">
                Turn customer photos into{" "}
                <span className="relative inline-block">
                  <span className="absolute inset-x-0 bottom-2 -z-10 h-3 rounded-full bg-gray-200" />
                  consistent estimates
                </span>{" "}
                in minutes.
              </h1>

              <p className="mt-5 text-base leading-7 text-gray-700 sm:text-lg">
                Stop the back-and-forth. Customers upload photos + notes. You get a clean lead
                and a realistic estimate range — powered by guardrails you control.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/sign-up"
                  className="inline-flex items-center justify-center rounded-2xl bg-black px-6 py-3 text-sm font-semibold text-white shadow-sm"
                >
                  Start free setup
                </Link>
                <Link
                  href="/onboarding"
                  className="inline-flex items-center justify-center rounded-2xl border bg-white/70 px-6 py-3 text-sm font-semibold backdrop-blur hover:bg-white"
                >
                  Configure settings
                </Link>
              </div>

              {/* Trust strip */}
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  { k: "Faster leads", v: "Less email ping-pong" },
                  { k: "More control", v: "Guardrails protect margins" },
                  { k: "Premium feel", v: "Modern SaaS experience" },
                ].map((x) => (
                  <div
                    key={x.k}
                    className="rounded-2xl border bg-white/60 p-4 backdrop-blur"
                  >
                    <div className="text-sm font-semibold">{x.k}</div>
                    <div className="mt-1 text-xs text-gray-600">{x.v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right - Hero card */}
            <div className="relative">
              <div className="absolute -inset-3 rounded-[28px] bg-gradient-to-br from-gray-200 to-white blur-xl opacity-80" />
              <div className="relative rounded-[28px] border bg-white/80 p-6 shadow-sm backdrop-blur">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500">
                      Example output
                    </p>
                    <h3 className="mt-1 text-lg font-semibold">
                      Photo Estimate Summary
                    </h3>
                  </div>
                  <span className="rounded-full border bg-white px-3 py-1 text-xs font-medium text-gray-800">
                    Customer-friendly
                  </span>
                </div>

                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl border bg-gradient-to-b from-gray-50 to-white p-5">
                    <p className="text-sm font-semibold">Estimate range</p>
                    <p className="mt-1 text-3xl font-semibold tracking-tight">
                      $650 – $1,250
                    </p>
                    <p className="mt-2 text-sm text-gray-600">
                      Based on visible wear, materials, and stitching complexity. Final quote
                      after inspection.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border bg-white p-4">
                      <p className="text-sm font-semibold">Materials</p>
                      <p className="mt-1 text-sm text-gray-600">
                        Marine vinyl / UV thread
                      </p>
                    </div>
                    <div className="rounded-2xl border bg-white p-4">
                      <p className="text-sm font-semibold">Turnaround</p>
                      <p className="mt-1 text-sm text-gray-600">
                        3–7 business days
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-white p-4">
                    <p className="text-sm font-semibold">Next steps</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
                      <li>Confirm measurements & pattern details</li>
                      <li>Choose material + color</li>
                      <li>Schedule drop-off or mobile visit</li>
                    </ul>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between border-t pt-4 text-xs text-gray-500">
                  <span>Lead emailed + stored in admin</span>
                  <span>Powered by your guardrails</span>
                </div>
              </div>
            </div>
          </div>

          {/* Under-hero highlight */}
          <div className="mt-10 rounded-[28px] border bg-white/70 p-6 backdrop-blur">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold">
                  Built for upholstery, auto, marine — and any photo-first service business.
                </div>
                <div className="mt-1 text-sm text-gray-600">
                  Your customers don’t know the words. They know how to take pictures.
                </div>
              </div>
              <Link href="/sign-up" className="text-sm font-semibold underline">
                Create your tenant →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">
                Simple flow. Big upgrade.
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                A quoting experience that feels modern — without losing control.
              </p>
            </div>
            <Link href="/onboarding" className="text-sm font-semibold underline">
              Configure →
            </Link>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {[
              {
                step: "01",
                title: "Customer uploads photos",
                desc: "Category + notes + multiple images from any device.",
              },
              {
                step: "02",
                title: "AI generates estimate range",
                desc: "Guardrails keep output realistic and margin-safe.",
              },
              {
                step: "03",
                title: "You get a clean lead",
                desc: "Photos, notes, estimate, and inspection flags in admin + email.",
              },
            ].map((x) => (
              <div key={x.step} className="rounded-[28px] border p-6">
                <div className="text-xs font-semibold text-gray-500">
                  Step {x.step}
                </div>
                <div className="mt-2 text-xl font-semibold">{x.title}</div>
                <div className="mt-2 text-sm text-gray-600">{x.desc}</div>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Pricing guardrails",
                desc: "Minimums and typical ranges keep AI aligned with your shop.",
              },
              {
                title: "Redirect + thank-you pages",
                desc: "Route customers back to your site, scheduler, or confirmation.",
              },
              {
                title: "Admin workflow",
                desc: "Central place to review leads and follow up fast.",
              },
              {
                title: "Customer-friendly language",
                desc: "Estimate wording avoids overpromising and reduces disputes.",
              },
              {
                title: "Made for photo-first jobs",
                desc: "Perfect when customers can’t describe the work reliably.",
              },
              {
                title: "Brand-ready experience",
                desc: "Clean layout, premium feel, and conversion-focused CTAs.",
              },
            ].map((f) => (
              <div key={f.title} className="rounded-[28px] border bg-white p-6">
                <div className="text-lg font-semibold">{f.title}</div>
                <div className="mt-2 text-sm text-gray-600">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Pricing</h2>
              <p className="mt-2 text-sm text-gray-600">
                Simple tiers — built around the quoting workflow.
              </p>
            </div>
            <Link href="/sign-up" className="text-sm font-semibold underline">
              Start now →
            </Link>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {TIERS.map((t) => (
              <div
                key={t.name}
                className={cn(
                  "relative rounded-[28px] border p-6 bg-white",
                  t.featured && "border-black shadow-sm"
                )}
              >
                {t.featured && (
                  <div className="absolute -top-3 left-6 rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
                    Most popular
                  </div>
                )}

                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold">{t.name}</div>
                    <div className="mt-1 text-sm text-gray-600">{t.blurb}</div>
                  </div>
                </div>

                <div className="mt-6 flex items-end gap-2">
                  <div className={cn("text-4xl font-semibold tracking-tight", t.featured && "text-black")}>
                    {t.price}
                  </div>
                  <div className="pb-1 text-sm text-gray-600">{t.cadence}</div>
                </div>

                <ul className="mt-6 space-y-2 text-sm text-gray-700">
                  {t.highlights.map((h) => (
                    <li key={h} className="flex gap-3">
                      <Dot />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  <Link
                    href={t.cta.href}
                    className={cn(
                      "inline-flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold",
                      t.featured
                        ? "bg-black text-white shadow-sm"
                        : "border bg-white hover:bg-gray-50"
                    )}
                  >
                    {t.cta.label}
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 text-xs text-gray-500">
            If you want “redirect URL required” to mark onboarding complete, we can enforce that.
          </div>
        </div>
      </section>

      {/* FAQ + CTA */}
      <section>
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-3xl font-semibold tracking-tight">FAQ</h2>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {FAQ.map((f) => (
              <div key={f.q} className="rounded-[28px] border p-6">
                <div className="text-lg font-semibold">{f.q}</div>
                <div className="mt-2 text-sm leading-6 text-gray-600">{f.a}</div>
              </div>
            ))}
          </div>

          <div className="mt-14 relative overflow-hidden rounded-[28px] border bg-black p-10 text-white">
            <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -right-24 -bottom-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />

            <div className="relative">
              <div className="text-2xl font-semibold tracking-tight">
                Ready to stop the quoting chaos?
              </div>
              <div className="mt-2 text-sm text-white/80">
                Set guardrails once. Let customers do the photo work. You focus on closing jobs.
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/sign-up"
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 text-sm font-semibold text-black"
                >
                  Start free setup
                </Link>
                <Link
                  href="/onboarding"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/30 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Go to Settings
                </Link>
              </div>
            </div>
          </div>

          <footer className="mt-12 border-t pt-6 text-sm text-gray-500 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} AIPhotoQuote</span>
            <div className="flex gap-4">
              <Link href="/dashboard" className="underline">
                Dashboard
              </Link>
              <Link href="/admin" className="underline">
                Admin
              </Link>
              <Link href="/onboarding" className="underline">
                Settings
              </Link>
            </div>
          </footer>
        </div>
      </section>
    </main>
  );
}
