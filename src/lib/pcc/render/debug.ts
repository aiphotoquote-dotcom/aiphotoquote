// src/lib/pcc/render/debug.ts
export function isRenderDebugEnabled() {
  // Accept both possible env var names to avoid drift
  const a = String(process.env.PCC_RENDER_DEBUG ?? "").trim();
  const b = String(process.env.PCC_RENDER_DEBUG ?? "").trim();
  return a === "1" || b === "1";
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export function buildRenderDebugPayload(args: {
  debugId: string;

  renderModel: string;

  tenantStyleKey: string;
  styleText: string;

  renderPromptPreamble: string;
  renderPromptTemplate: string;
  finalPrompt: string;

  serviceType: string;
  summary: string;
  customerNotes: string;
  tenantRenderNotes: string;

  images: Array<{ url?: string }>;
}) {
  const urls = (args.images ?? []).map((x) => safeTrim(x?.url)).filter(Boolean);

  return {
    debugId: args.debugId,
    at: new Date().toISOString(),

    renderModel: safeTrim(args.renderModel),

    tenantStyleKey: safeTrim(args.tenantStyleKey),
    styleText: safeTrim(args.styleText),

    renderPromptPreamble: String(args.renderPromptPreamble ?? ""),
    renderPromptTemplate: String(args.renderPromptTemplate ?? ""),
    finalPrompt: String(args.finalPrompt ?? ""),

    inputs: {
      serviceType: safeTrim(args.serviceType),
      summary: safeTrim(args.summary),
      customerNotes: safeTrim(args.customerNotes),
      tenantRenderNotes: safeTrim(args.tenantRenderNotes),
    },

    images: {
      count: urls.length,
      sample: urls.slice(0, 3),
    },
  };
}