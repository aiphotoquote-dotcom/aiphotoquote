// src/app/page.tsx
import React from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import MarketingTopNav from "@/components/marketing/MarketingTopNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function SectionTitle({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="max-w-3xl">
      {eyebrow && (
        <div className="text-xs font-extrabold tracking-widest text-gray-500 uppercase">
          {eyebrow}
        </div>
      )}
      <h2 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-4 text-lg text-gray-600">
          {subtitle}
        </p>
      )}
    </div>
  );
}

function FeatureCard({
  title,
  desc,
}: {
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-300 bg-white/90 backdrop-blur p-6 shadow-md">
      <div className="text-lg font-extrabold text-gray-900">{title}</div>
      <div className="mt-2 text-sm text-gray-600">{desc}</div>
    </div>
  );
}

export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/admin");

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <MarketingTopNav />

      {/* ================= HERO ================= */}
      <section className="relative isolate overflow-hidden">
        {/* Background Image */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1581092918484-8313c8e7c9c5?auto=format&fit=crop&w=1600&q=80')",
          }}
        />

        {/* Steel texture overlay */}
        <div
          className="absolute inset-0 opacity-40 mix-blend-overlay"
          style={{
            backgroundImage:
              "url('https://www.transparenttextures.com/patterns/brushed-alum.png')",
          }}
        />

        {/* Dark overlay */}
        <div className="absolute inset-0 bg-black/60" />

        <div className="relative mx-auto max-w-6xl px-4 py-28 sm:px-6">
          <div className="max-w-2xl text-white">
            <div className="text-xs font-extrabold tracking-widest uppercase text-gray-300">
              AI Infrastructure for Service Businesses
            </div>

            <h1 className="mt-6 text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight">
              Quote Jobs From Photos. <br />
              <span className="text-gray-300">
                Respond Faster. Win More.
              </span>
            </h1>

            <p className="mt-6 text-lg text-gray-200">
              AI Photo Quote turns customer photos into structured,
              quote-ready estimate drafts in seconds.
              Built for real working business owners — not tech startups.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="/sign-up"
                className="rounded-xl bg-white px-6 py-3 text-sm font-extrabold text-gray-900 shadow-lg hover:bg-gray-100"
              >
                Create Account
              </a>
              <a
                href="#how-it-works"
                className="rounded-xl border border-white/50 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
              >
                See How It Works
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ================= PROBLEM ================= */}
      <section className="bg-gray-100 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionTitle
            eyebrow="THE REALITY"
            title="Most owners are still typing estimates at night."
            subtitle="Driving out for jobs that never close. Digging through emails. Writing the same scope descriptions over and over."
          />

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            <FeatureCard
              title="Wasted Trips"
              desc="Driving across town just to realize the job isn't qualified."
            />
            <FeatureCard
              title="Slow Response Time"
              desc="Customers move on when you don’t reply fast."
            />
            <FeatureCard
              title="Inconsistent Quotes"
              desc="Different wording. Different pricing logic. Every time."
            />
          </div>
        </div>
      </section>

      {/* ================= HOW IT WORKS ================= */}
      <section id="how-it-works" className="py-20 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionTitle
            eyebrow="THE SYSTEM"
            title="AI That Works Like a Digital Estimator"
            subtitle="Not a chatbot. Not a form builder. A real estimating engine."
          />

          <div className="mt-12 grid gap-8 sm:grid-cols-4">
            <FeatureCard
              title="1. Customer Uploads"
              desc="Photos + quick job details."
            />
            <FeatureCard
              title="2. AI Analyzes"
              desc="Generates structured scope + estimate range."
            />
            <FeatureCard
              title="3. You Review"
              desc="Approve, adjust, and control the final number."
            />
            <FeatureCard
              title="4. Send & Close"
              desc="Branded receipt + optional concept render."
            />
          </div>
        </div>
      </section>

      {/* ================= INDUSTRIAL FEATURE STRIP ================= */}
      <section className="relative py-24 text-white">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1581093588401-12c38a6c9f33?auto=format&fit=crop&w=1600&q=80')",
          }}
        />
        <div className="absolute inset-0 bg-black/70" />

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <SectionTitle
            eyebrow="BUILT FOR MAIN STREET"
            title="AI-as-a-Service for Working Owners"
            subtitle="You don’t need to understand AI. You just need it to work."
          />

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            <FeatureCard
              title="Photo-Based Intake"
              desc="Optimized for real-world job site photos."
            />
            <FeatureCard
              title="Confidence Scoring"
              desc="Know when inspection is required."
            />
            <FeatureCard
              title="Optional Concept Renders"
              desc="Help customers visualize the finished work."
            />
          </div>
        </div>
      </section>

      {/* ================= CTA ================= */}
      <section className="bg-gray-900 py-20 text-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold">
            Stop Typing Estimates. Start Closing Faster.
          </h2>
          <p className="mt-4 text-lg text-gray-300">
            Create your AI-powered quote page and see it working today.
          </p>

          <div className="mt-8 flex justify-center gap-4">
            <a
              href="/sign-up"
              className="rounded-xl bg-white px-8 py-3 text-sm font-extrabold text-gray-900 hover:bg-gray-200"
            >
              Create Account
            </a>
            <a
              href="/sign-in"
              className="rounded-xl border border-white/40 px-8 py-3 text-sm font-semibold hover:bg-white/10"
            >
              Sign In
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}