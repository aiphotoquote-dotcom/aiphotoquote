// src/lib/llm/executor.ts

import OpenAI from "openai";
import { z } from "zod";
import type { DebugFn } from "./types";

/* --------------------- image inlining for OpenAI vision --------------------- */
const OPENAI_VISION_MAX_IMAGES = 6;
const IMAGE_FETCH_TIMEOUT_MS = 12_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

function guessContentType(url: string): string {
  const u = url.toLowerCase();
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".gif")) return "image/gif";
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function toBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64");
}

async function fetchAsDataUrl(url: string, debug?: DebugFn) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`IMAGE_FETCH_FAILED: HTTP ${res.status}`);

    const ct = (res.headers.get("content-type") || "").split(";")[0].trim();
    const contentType = ct || guessContentType(url);

    const ab = await res.arrayBuffer();
    if (ab.byteLength > IMAGE_MAX_BYTES) throw new Error(`IMAGE_TOO_LARGE: ${ab.byteLength} bytes`);

    const b64 = toBase64(ab);
    return `data:${contentType};base64,${b64}`;
  } catch (e: any) {
    debug?.("llm.openai.image.inline_failed", { url, message: e?.message ?? String(e) });
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function buildOpenAiVisionContent(args: {
  images: Array<{ url: string; shotType?: string }>;
  debug?: DebugFn;
}) {
  const { images, debug } = args;
  const picked = (images || []).filter((x) => x?.url).slice(0, OPENAI_VISION_MAX_IMAGES);

  const content: any[] = [];
  for (const img of picked) {
    const u = String(img.url);
    try {
      const dataUrl = await fetchAsDataUrl(u, debug);
      content.push({ type: "image_url", image_url: { url: dataUrl } });
    } catch {
      content.push({ type: "image_url", image_url: { url: u } });
    }
  }
  return content;
}

/* --------------------- JSON schema helpers --------------------- */

export const QaQuestionsSchema = z.object({
  questions: z.array(z.string().min(1)).min(1),
});

export const AiOutputSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]),
  inspection_required: z.boolean(),
  estimate_low: z.number().nonnegative(),
  estimate_high: z.number().nonnegative(),
  currency: z.string().default("USD"),
  summary: z.string(),
  visible_scope: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
});

function coerceToNumber(v: any): number {
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function coerceStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

export function coerceAiCandidate(candidate: any) {
  if (!candidate || typeof candidate !== "object") return candidate;

  return {
    confidence: String(candidate.confidence ?? "").trim() || "low",
    inspection_required: Boolean(candidate.inspection_required),
    estimate_low: coerceToNumber(candidate.estimate_low),
    estimate_high: coerceToNumber(candidate.estimate_high),
    currency: String(candidate.currency ?? "USD"),
    summary: String(candidate.summary ?? ""),
    visible_scope: coerceStringArray(candidate.visible_scope),
    assumptions: coerceStringArray(candidate.assumptions),
    questions: coerceStringArray(candidate.questions),
  };
}

export async function runQaQuestions(args: {
  openai: OpenAI;
  model: string;
  system: string;
  images: Array<{ url: string; shotType?: string }>;
  userText: string;
  maxQuestions: number;
  debug?: DebugFn;
}) {
  const { openai, model, system, images, userText, maxQuestions, debug } = args;

  const content: any[] = [{ type: "text", text: userText }];
  const vision = await buildOpenAiVisionContent({ images, debug });
  content.push(...vision);

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    temperature: 0.2,
  });

  const raw = completion.choices?.[0]?.message?.content ?? "{}";

  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const safe = QaQuestionsSchema.safeParse(parsed);
  const questions = safe.success
    ? safe.data.questions.slice(0, maxQuestions)
    : ["Can you describe what you want done (repair vs full replacement) and any material preference?"];

  return questions.map((q) => String(q).trim()).filter(Boolean).slice(0, maxQuestions);
}

export async function runEstimate(args: {
  openai: OpenAI;
  model: string;
  system: string;
  images: Array<{ url: string; shotType?: string }>;
  userText: string;
  debug?: DebugFn;
}) {
  const { openai, model, system, images, userText, debug } = args;

  const content: any[] = [{ type: "text", text: userText }];
  const vision = await buildOpenAiVisionContent({ images, debug });
  content.push(...vision);

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "quote_estimate",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            inspection_required: { type: "boolean" },
            estimate_low: { type: "number" },
            estimate_high: { type: "number" },
            currency: { type: "string" },
            summary: { type: "string" },
            visible_scope: { type: "array", items: { type: "string" } },
            assumptions: { type: "array", items: { type: "string" } },
            questions: { type: "array", items: { type: "string" } },
          },
          required: [
            "confidence",
            "inspection_required",
            "estimate_low",
            "estimate_high",
            "summary",
            "visible_scope",
            "assumptions",
            "questions",
          ],
        },
      },
    } as any,
  });

  const raw = completion.choices?.[0]?.message?.content ?? "{}";

  let outputParsed: any = null;
  try {
    outputParsed = JSON.parse(raw);
  } catch {
    outputParsed = null;
  }

  const candidate0 =
    outputParsed &&
    typeof outputParsed === "object" &&
    outputParsed.properties &&
    typeof outputParsed.properties === "object"
      ? outputParsed.properties
      : outputParsed;

  const candidate = coerceAiCandidate(candidate0);

  const safe = AiOutputSchema.safeParse(candidate);
  if (!safe.success) {
    return {
      ok: false as const,
      raw,
      value: {
        confidence: "low" as const,
        inspection_required: true,
        estimate_low: 0,
        estimate_high: 0,
        currency: "USD",
        summary:
          "We couldn't generate a structured estimate from the submission. Please add 2–6 clear photos and any details you can.",
        visible_scope: [],
        assumptions: [],
        questions: ["Can you add a wide shot and 1–2 close-ups of the problem area?"],
        _raw: raw,
      },
    };
  }

  return { ok: true as const, raw, value: safe.data };
}