// src/app/api/pcc/llm/route.ts
// Back-compat shim: keep old path working, forward to /api/pcc/llm/config
export { GET, POST, runtime } from "@/app/api/pcc/llm/config/route";