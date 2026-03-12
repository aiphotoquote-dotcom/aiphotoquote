// src/lib/ai/assessQuote.ts

import OpenAI from "openai";
import { db } from "@/lib/db/client";
import { tenantSecrets, tenantSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type AiMode = "assessment_only" | "range" | "fixed";

export async function assessQuote(options: {
  tenantId: string;
  input: any;
  aiMode: AiMode;
}) {
  const { tenantId, input, aiMode } = options;

  // 1️⃣ Load tenant OpenAI key
  const secret = await db
    .select()
    .from(tenantSecrets)
    .where(eq(tenantSecrets.tenantId, tenantId))
    .limit(1)
    .then(r => r[0]);

  if (!secret?.openaiKeyEnc) {
    throw new Error("Missing tenant OpenAI key");
  }

  // TODO: decrypt key (use your existing decrypt helper)
  const apiKey = secret.openaiKeyEnc; // replace with decrypt

  const openai = new OpenAI({ apiKey });

  // 2️⃣ Build prompt (reuse your existing logic)
  const systemPrompt = `
You are an AI estimator.
Mode: ${aiMode}
  `;

  const userPrompt = JSON.stringify(input);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { summary: raw };
  }

  // 3️⃣ Run deterministic pricing if needed
  let pricingBasis = null;

  if (aiMode !== "assessment_only") {
    // TODO: plug in your deterministic pricing function here
    pricingBasis = {
      method: "deterministic_v1"
    };
  }

  return {
    output: {
      ...parsed,
      pricing_basis: pricingBasis,
    },
    pricingBasis,
  };
}