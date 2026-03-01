// src/components/admin/quote/LifecyclePanelServer.tsx
import React from "react";

import LifecyclePanel from "@/components/admin/quote/LifecyclePanel";
import type { QuoteNoteRow, QuoteRenderRow, QuoteVersionRow } from "@/lib/admin/quotes/getLifecycle";

// ✅ Server actions MUST be imported from a "use server" module.
// ✅ Passing these into a Client Component is allowed (they serialize as Server Actions).
import {
  createNewVersionAction,
  restoreVersionAction,
  requestRenderAction,
  deleteVersionAction,
  deleteNoteAction,
  deleteRenderAction,
} from "@/app/admin/quotes/[id]/actions";

export default function LifecyclePanelServer(props: {
  quoteId: string;
  versionRows: QuoteVersionRow[];
  noteRows: QuoteNoteRow[];
  renderRows: QuoteRenderRow[];
  lifecycleReadError: string | null;
  activeVersion: number | null;
}) {
  const { quoteId, versionRows, noteRows, renderRows, lifecycleReadError, activeVersion } = props;

  return (
    <LifecyclePanel
      quoteId={quoteId}
      versionRows={versionRows}
      noteRows={noteRows}
      renderRows={renderRows}
      lifecycleReadError={lifecycleReadError}
      activeVersion={activeVersion}
      createNewVersionAction={createNewVersionAction}
      restoreVersionAction={restoreVersionAction}
      requestRenderAction={requestRenderAction}
      deleteVersionAction={deleteVersionAction}
      deleteNoteAction={deleteNoteAction}
      deleteRenderAction={deleteRenderAction}
    />
  );
}