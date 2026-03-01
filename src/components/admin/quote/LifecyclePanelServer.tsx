// src/components/admin/quote/LifecyclePanelServer.tsx
import React from "react";

import LifecyclePanel from "@/components/admin/quote/LifecyclePanel";
import type { QuoteNoteRow, QuoteRenderRow, QuoteVersionRow } from "@/lib/admin/quotes/getLifecycle";

// ✅ IMPORTANT: import server actions here (server component file)
import {
  createNewVersionAction,
  restoreVersionAction,
  requestRenderAction,
  deleteVersionAction,
  deleteNoteAction,
  deleteRenderAction,
} from "@/app/admin/quotes/[id]/actions"; // <-- adjust path to wherever your actions live

export default function LifecyclePanelServer(props: {
  quoteId: string;
  versionRows: QuoteVersionRow[];
  noteRows: QuoteNoteRow[];
  renderRows: QuoteRenderRow[];
  lifecycleReadError: string | null;
  activeVersion: number | null;
}) {
  return (
    <LifecyclePanel
      quoteId={props.quoteId}
      versionRows={props.versionRows}
      noteRows={props.noteRows}
      renderRows={props.renderRows}
      lifecycleReadError={props.lifecycleReadError}
      activeVersion={props.activeVersion}
      createNewVersionAction={createNewVersionAction}
      restoreVersionAction={restoreVersionAction}
      requestRenderAction={requestRenderAction}
      deleteVersionAction={deleteVersionAction}
      deleteNoteAction={deleteNoteAction}
      deleteRenderAction={deleteRenderAction}
    />
  );
}