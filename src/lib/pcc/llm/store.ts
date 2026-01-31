// src/lib/pcc/llm/store.ts
import { put, head, del } from "@vercel/blob";
import { defaultPlatformLlmConfig, type PlatformLlmConfig } from "./types";

const BLOB_KEY = "pcc/llm/platform-llm-config.json";

function nowIso() {
  return new Date().toISOString();
}

/**
 * Very lightweight parse (route.ts is responsible for full normalization/validation).
 * This just ensures we got an object back.
 */
function safeParse(json: string | null): PlatformLlmConfig | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as PlatformLlmConfig;
  } catch {
    return null;
  }
}

type BlobPointer = {
  url: string;
  versionToken: string;
};

async function getBlobPointerIfExists(): Promise<BlobPointer | null> {
  try {
    const meta: any = await head(BLOB_KEY);

    const url = String(meta?.url ?? "").trim();
    if (!url) return null;

    const uploadedAt = meta?.uploadedAt ? String(meta.uploadedAt) : "";
    const size = Number.isFinite(meta?.size) ? String(meta.size) : "";
    const versionToken = uploadedAt || size || String(Date.now());

    return { url, versionToken };
  } catch {
    return null;
  }
}

export async function loadPlatformLlmConfig(): Promise<PlatformLlmConfig> {
  // 1) Env override first (fast, deploy-friendly)
  const envRaw = process.env.PCC_LLM_CONFIG?.trim();
  const envCfg = safeParse(envRaw || null);
  if (envCfg) return envCfg;

  // 2) Blob (persistent)
  const ptr = await getBlobPointerIfExists();
  if (ptr) {
    try {
      const bustUrl = `${ptr.url}${ptr.url.includes("?") ? "&" : "?"}v=${encodeURIComponent(ptr.versionToken)}`;

      const res = await fetch(bustUrl, {
        cache: "no-store",
        next: { revalidate: 0 },
      });

      if (!res.ok) throw new Error(`Failed to fetch LLM config: ${res.status}`);

      const txt = await res.text();
      const cfg = safeParse(txt);
      if (cfg) return cfg;
    } catch {
      // fallthrough
    }
  }

  // 3) Default
  return defaultPlatformLlmConfig();
}

export async function savePlatformLlmConfig(cfg: PlatformLlmConfig): Promise<PlatformLlmConfig> {
  // Always stamp updatedAt on save (single source of truth)
  const next: PlatformLlmConfig = {
    ...cfg,
    version: Number.isFinite((cfg as any)?.version) ? (cfg as any).version : 1,
    updatedAt: nowIso(),
  };

  const payload = JSON.stringify(next, null, 2);

  await put(BLOB_KEY, payload, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return next;
}

/**
 * Optional: reset to defaults by deleting blob (won't affect env override).
 */
export async function resetPlatformLlmConfig(): Promise<void> {
  try {
    await del(BLOB_KEY);
  } catch {
    // ignore
  }
}