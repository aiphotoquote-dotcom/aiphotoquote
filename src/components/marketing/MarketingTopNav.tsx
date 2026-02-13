// src/components/marketing/MarketingTopNav.tsx
"use client";

import Link from "next/link";
import React, { useState } from "react";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

import TenantSwitcher from "@/components/tenant/TenantSwitcher";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function MarketingTopNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const linkBase =
    "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors";
  const linkIdle =
    "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-900 dark:hover:text-white";

  const btnBase =
    "inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-extrabold transition";

  const btnSignIn =
    "border border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900";

  // “pop” CTA: subtle gradient, stronger shadow, hover lift
  const btnSignUp =
    "relative overflow-hidden border border-indigo-200 bg-gradient-to-r from-indigo-600 via-sky-600 to-emerald-600 text-white shadow-md shadow-indigo-500/15 hover:shadow-lg hover:shadow-indigo-500/20 hover:-translate-y-0.5 dark:border-indigo-400/40";

  return (
    <header className="sticky top-0 z-30 w-full border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-black/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg px-2 py-1 font-semibold text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-900"
          >
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-black dark:bg-white" />
            <span>AI Photo Quote</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <Link href="/#features" className={cn(linkBase, linkIdle)}>
              Features
            </Link>
            <Link href="/#pricing" className={cn(linkBase, linkIdle)}>
              Pricing
            </Link>
            <Link href="/#how-it-works" className={cn(linkBase, linkIdle)}>
              How it works
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <SignedIn>
            <div className="hidden md:block">
              <TenantSwitcher />
            </div>

            <Link
              href="/admin"
              className="hidden md:inline-flex rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Dashboard
            </Link>

            <UserButton afterSignOutUrl="/" />
          </SignedIn>

          <SignedOut>
            <Link href="/sign-in" className={cn("hidden md:inline-flex", btnBase, btnSignIn)}>
              Sign in
            </Link>

            <Link href="/sign-up" className={cn("hidden md:inline-flex", btnBase, btnSignUp)}>
              {/* subtle sheen */}
              <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity hover:opacity-100">
                <span className="absolute -left-12 top-0 h-full w-10 rotate-12 bg-white/30 blur-sm" />
              </span>
              <span className="relative">Sign up</span>
            </Link>
          </SignedOut>

          <button
            type="button"
            className="md:hidden rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-900"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation"
          >
            Menu
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="md:hidden border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-black">
          <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col gap-2">
            <Link
              href="/#features"
              className={cn(linkBase, linkIdle)}
              onClick={() => setMobileOpen(false)}
            >
              Features
            </Link>
            <Link
              href="/#pricing"
              className={cn(linkBase, linkIdle)}
              onClick={() => setMobileOpen(false)}
            >
              Pricing
            </Link>
            <Link
              href="/#how-it-works"
              className={cn(linkBase, linkIdle)}
              onClick={() => setMobileOpen(false)}
            >
              How it works
            </Link>

            <SignedIn>
              <div className="pt-2">
                <TenantSwitcher className="w-full" />
              </div>
              <Link
                href="/admin"
                className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                onClick={() => setMobileOpen(false)}
              >
                Dashboard
              </Link>
              <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-black">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  Account
                </span>
                <UserButton afterSignOutUrl="/" />
              </div>
            </SignedIn>

            <SignedOut>
              <div className="pt-2 grid grid-cols-2 gap-2">
                <Link
                  href="/sign-in"
                  className={cn(btnBase, btnSignIn)}
                  onClick={() => setMobileOpen(false)}
                >
                  Sign in
                </Link>
                <Link
                  href="/sign-up"
                  className={cn(btnBase, btnSignUp)}
                  onClick={() => setMobileOpen(false)}
                >
                  <span className="relative">Sign up</span>
                </Link>
              </div>
            </SignedOut>
          </div>
        </div>
      ) : null}
    </header>
  );
}