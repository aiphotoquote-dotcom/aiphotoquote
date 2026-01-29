// src/app/pcc/industries/page.tsx
import React from "react";
import { db } from "@/lib/db/client";
import { industries } from "@/lib/db/schema";

export const runtime = "nodejs";

export default async function PccIndustriesPage() {
  let rows:
    | {
        id: string;
        key: string;
        label: string;
        description: string | null;
        createdAt: Date;
      }[]
    | null = null;

  let loadError: string | null = null;

  try {
    rows = await db
      .select({
        id: industries.id,
        key: industries.key,
        label: industries.label,
        description: industries.description,
        createdAt: industries.createdAt,
      })
      .from(industries)
      .orderBy(industries.label);
  } catch (e: any) {
    loadError = e?.message ?? "Failed to load industries.";
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Industries
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Global industry catalog used across tenants. (Read-only in v1.)
            </p>
          </div>

          <span className="shrink-0 rounded-full border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:text-gray-300">
            PCC v1
          </span>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          <div className="font-semibold mb-1">Couldn’t load industries</div>
          {loadError}
        </div>
      ) : null}

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            All industries
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {rows ? `${rows.length} total` : "—"}
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-[11px] font-semibold tracking-wide text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            <div className="col-span-3">KEY</div>
            <div className="col-span-3">LABEL</div>
            <div className="col-span-6">DESCRIPTION</div>
          </div>

          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows?.length ? (
              rows.map((r) => (
                <div
                  key={r.id}
                  className="grid grid-cols-12 gap-2 px-4 py-3 text-sm text-gray-900 dark:text-gray-100"
                >
                  <div className="col-span-3 font-mono text-[12px] text-gray-700 dark:text-gray-300 break-words">
                    {r.key}
                  </div>
                  <div className="col-span-3 font-semibold break-words">
                    {r.label}
                  </div>
                  <div className="col-span-6 text-gray-700 dark:text-gray-300 break-words">
                    {r.description ? r.description : (
                      <span className="italic text-gray-500 dark:text-gray-400">
                        (no description)
                      </span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-6 text-sm text-gray-600 dark:text-gray-300">
                No industries found.
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          Next: add create/edit flows + sub-industry mapping + tenant overrides.
        </div>
      </div>
    </div>
  );
}