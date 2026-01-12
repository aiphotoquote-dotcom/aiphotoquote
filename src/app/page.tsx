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
      "Admin dashboard workflow",
      "Higher quality AI analysis",
      "Priority email deliverability settings",
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
      "Custom model tuning (where applicable)",
      "SLA & priority support",
    ],
    cta: { label: "Contact sales", href: "/onboarding" },
  },
];

const FAQ = [
  {
    q: "What does the customer experience look like?",
    a: "Your customer uploads photos, adds notes, and instantly gets a guided estimate range (with clear language that it’s an estimate). You receive a clean lead email with the photos and details, and you can route them wherever you want next.",
  },
  {
    q: "Is this an instant quote or an estimate?",
    a: "It’s an estimate. You control the tone and guardrails so the output stays realistic and protects your margins. For complex jobs, the system can recommend an in-person inspection.",
  },
  {
    q: "Can I customize the redirect and thank-you pages?",
    a: "Yes — set your redirect URL and optional thank-you URL in Settings. Send customers back to your site, your scheduler, or a confirmation page.",
  },
  {
    q: "Does it work for automotive and marine upholstery?",
    a: "Absolutely. This is built for photo-based quoting workflows where customers don’t know how to describe the job but can take great photos.",
  },
];

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <TopNav />

      {/* HERO */}
      <section className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-gray-700">
                <span className="font-medium">AIPhotoQuote</span>
                <span className="text-gray-400">•</span>
                <span>Photo-based estimates for real-world shops</span>
              </div>

              <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
                Turn customer photos into{" "}
                <span className="underline decoration-gray-300">clean, consistent estimates</span>{" "}
                — instantly.
              </h1>

              <p className="mt-4 text-base leading-7 text-gray-600">
                Stop the back-and-forth. AIPhotoQuote turns uploaded photos + notes into a
                customer-friendly estimate range and a high-quality lead for your shop — with
                pricing guardrails you control.
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/sign-up"
                  className="inline-flex items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-medium text-white"
                >
                  Start free setup
                </Link>
                <Link
                  href="/onboarding"
                  className="inline-flex items-center justify-center rounded-xl border px-5 py-3 text-sm font-medium"
                >
                  Configure settings
                </Link>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600">
                <div className="inline-flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
                  Built for upholstery, auto, marine, and service pros
                </div>
                <div className="inline-flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
                  Guardrails protect your margins
                </div>
                <div className="inline-flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
                  Works with your existing website flow
                </div>
              </div>
            </div>

            {/* HERO CARD */}
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-gray-500">Example output</p>
                  <h3 className="mt-1 text-lg font-semibold">Photo Estimate Summary</h3>
                </div>
                <span className="rounded-full border px-3 py-1 text-xs text-gray-700">
                  Customer-friendly
                </span>
              </div>

              <div className="mt-5 space-y-4">
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-sm font-medium">Estimate range</p>
                  <p className="mt-1 text-2xl font-semibold">$650 – $1,250</p>
                  <p className="mt-2 text-sm text-gray-600">
                    Based on visible wear, required materials, and stitching complexity. Final
                    quote after inspection.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border p-4">
                    <p className="text-sm font-medium">Materials</p>
                    <p className="mt-1 text-sm text-gray-600">
                      Marine vinyl / UV-resistant thread
                    </p>
                  </div>
                  <div className="rounded-xl border p-4">
                    <p className="text-sm font-medium">Turnaround</p>
                    <p className="mt-1 text-sm text-gray-600">3–7 business days</p>
                  </div>
                </div>

                <div className="rounded-xl border p-4">
                  <p className="text-sm font-medium">Next steps</p>
                  <ul className="mt-2 list-disc pl-5 text-sm text-gray-600 space-y-1">
                    <li>Confirm measurements & pattern details</li>
                    <li>Choose material + color</li>
                    <li>Schedule drop-off or mobile visit</li>
                  </ul>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between border-t pt-4 text-xs text-gray-500">
                <span>Lead emailed to your shop + stored in admin</span>
                <span>Powered by your guardrails</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-2xl border p-6">
              <p className="text-sm font-medium">Less back-and-forth</p>
              <p className="mt-2 text-sm text-gray-600">
                Customers can’t describe jobs — but they can take photos. You get better
                leads with fewer emails.
              </p>
            </div>
            <div className="rounded-2xl border p-6">
              <p className="text-sm font-medium">More consistent pricing</p>
              <p className="mt-2 text-sm text-gray-600">
                Guardrails help the AI stay aligned with how your shop actually prices work.
              </p>
            </div>
            <div className="rounded-2xl border p-6">
              <p className="text-sm font-medium">A site that feels premium</p>
              <p className="mt-2 text-sm text-gray-600">
                Your quoting experience is part of your brand. This makes it feel modern and
                trustworthy.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="text-2xl font-semibold">How it works</h2>
          <p className="mt-2 text-sm text-gray-600">
            A simple flow that fits how real shops operate.
          </p>

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            {[
              {
                step: "01",
                title: "Customer uploads photos",
                desc: "They choose a category, add notes, and upload multiple photos from any device.",
              },
              {
                step: "02",
                title: "AI generates an estimate range",
                desc: "Your pricing guardrails keep estimates realistic and protect margins.",
              },
              {
                step: "03",
                title: "You get a clean lead + next steps",
                desc: "Photos, notes, estimate, and inspection flags — delivered to your inbox and admin.",
              },
            ].map((x) => (
              <div key={x.step} className="rounded-2xl border p-6">
                <div className="text-xs font-medium text-gray-500">Step {x.step}</div>
                <div className="mt-2 text-lg font-semibold">{x.title}</div>
                <div className="mt-2 text-sm text-gray-600">{x.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="text-2xl font-semibold">Built for shops that move fast</h2>
          <p className="mt-2 text-sm text-gray-600">
            Everything you need for an estimate workflow that feels modern — without losing
            control.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Pricing guardrails",
                desc: "Set minimums and typical ranges so the AI stays aligned with your shop.",
              },
              {
                title: "Redirect + thank-you pages",
                desc: "Send customers back to your site, scheduler, or a confirmation page.",
              },
              {
                title: "Admin workflow",
                desc: "Keep leads organized and follow up faster with all context captured.",
              },
              {
                title: "Customer-friendly language",
                desc: "Clear estimate wording that avoids overpromising and reduces disputes.",
              },
              {
                title: "Works for auto + marine + more",
                desc: "Photo-first quoting is perfect when customers don’t know how to describe a job.",
              },
              {
                title: "Brand-ready experience",
                desc: "The quote flow looks polished, clean, and trustworthy — like a real SaaS product.",
              },
            ].map((f) => (
              <div key={f.title} className="rounded-2xl border p-6">
                <div className="text-lg font-semibold">{f.title}</div>
                <div className="mt-2 text-sm text-gray-600">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Pricing</h2>
              <p className="mt-2 text-sm text-gray-600">
                Simple tiers — built around the quoting workflow.
              </p>
            </div>
            <Link href="/sign-up" className="text-sm underline">
              Start now
            </Link>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            {TIERS.map((t) => (
              <div
                key={t.name}
                className={classNames(
                  "rounded-2xl border p-6",
                  t.featured && "border-black shadow-sm"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold">{t.name}</div>
                    <div className="mt-1 text-sm text-gray-600">{t.blurb}</div>
                  </div>
                  {t.featured && (
                    <span className="rounded-full bg-black px-3 py-1 text-xs text-white">
                      Most popular
                    </span>
                  )}
                </div>

                <div className="mt-6 flex items-end gap-2">
                  <div className="text-4xl font-semibold">{t.price}</div>
                  <div className="pb-1 text-sm text-gray-600">{t.cadence}</div>
                </div>

                <ul className="mt-6 space-y-2 text-sm text-gray-700">
                  {t.highlights.map((h) => (
                    <li key={h} className="flex gap-2">
                      <span className="mt-1 inline-block h-2 w-2 rounded-full bg-black" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-7">
                  <Link
                    href={t.cta.href}
                    className={classNames(
                      "inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-medium",
                      t.featured
                        ? "bg-black text-white"
                        : "border hover:bg-gray-50"
                    )}
                  >
                    {t.cta.label}
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 text-xs text-gray-500">
            Want “redirect URL required” as a completion rule? We can enforce that in Settings
            + routing.
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section>
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="text-2xl font-semibold">FAQ</h2>
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            {FAQ.map((f) => (
              <div key={f.q} className="rounded-2xl border p-6">
                <div className="font-semibold">{f.q}</div>
                <div className="mt-2 text-sm text-gray-600">{f.a}</div>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded-2xl border bg-gray-50 p-8">
            <div className="text-xl font-semibold">Ready to stop the quoting chaos?</div>
            <div className="mt-2 text-sm text-gray-600">
              Set your guardrails once. Let customers do the photo work. You focus on closing
              jobs.
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/sign-up"
                className="inline-flex items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-medium text-white"
              >
                Start free setup
              </Link>
              <Link
                href="/onboarding"
                className="inline-flex items-center justify-center rounded-xl border px-5 py-3 text-sm font-medium"
              >
                Go to Settings
              </Link>
            </div>
          </div>

          <footer className="mt-10 border-t pt-6 text-sm text-gray-500 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
