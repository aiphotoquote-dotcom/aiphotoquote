// src/app/pcc/layout.tsx
import React from "react";

export const metadata = {
  title: "Platform Control Center • AI Photo Quote",
};

export default function PccLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black">
      {/* Top bar */}
      <div className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-950/80">
        <div className="mx-auto w-full max-w-5xl px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">
                PLATFORM
              </div>
              <h1 className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">
                Platform Control Center
              </h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Manage tenants, industries, AI guardrails, and platform settings.
              </p>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-xs text-gray-500 dark:text-gray-400">Environment</div>
              <div className="mt-1 inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
                PCC v1
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Page body */}
      <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}