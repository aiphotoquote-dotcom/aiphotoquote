// src/app/api/pcc/llm/route.ts
// Back-compat shim: keep old path working, forward to /api/pcc/llm/config

export const runtime = "nodejs";

export async function GET(req: Request) {
  const mod = await import("@/app/api/pcc/llm/config/route");
  return mod.GET(req);
}

export async function POST(req: Request) {
  const mod = await import("@/app/api/pcc/llm/config/route");
  return mod.POST(req);
}