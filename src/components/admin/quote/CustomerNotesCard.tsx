// src/components/admin/quote/CustomerNotesCard.tsx
import React from "react";

export default function CustomerNotesCard(props: { notes: string }) {
  const { notes } = props;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div>
        <h3 className="text-lg font-semibold">Customer notes</h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">What the customer told you when submitting.</p>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200">
        {notes ? (
          <div className="whitespace-pre-wrap leading-relaxed">{notes}</div>
        ) : (
          <div className="italic text-gray-500">No notes provided.</div>
        )}
      </div>
    </section>
  );
}