// src/lib/pcc/llm/types.ts
export type Guardrails = {
  // Hard limits / policy enforcement
  disallowTopics?: string[]; // e.g. ["weapons", "self-harm"]
  maxOutputTokens?: number;  // server-side enforcement later
  requireCitations?: boolean;

  // Tone/behavior constraints
  style?: "neutral" | "friendly" | "formal";
  refuseOnPolicyViolation?: boolean;

  // Safety toggles
  enableImageRendering?: boolean;
  enableLiveQa?: boolean;
};

export type PromptSet = {
  id: string;              // stable id like "default-upholstery"
  name: string;            // display name
  description?: string;

  system: string;          // system prompt
  developer?: string;      // internal guidance
  userTemplate?: string;   // optional template wrapper for user input

  // Model selection (we’ll enforce later)
  model?: string;          // e.g. "gpt-5"
  temperature?: number;

  guardrails?: Guardrails;

  updatedAt: string;       // ISO string
};

export type PlatformLlmConfig = {
  activePromptSetId: string;
  promptSets: PromptSet[];

  // global defaults applied if prompt set doesn’t override
  defaultGuardrails?: Guardrails;

  updatedAt: string; // ISO
};