/**
 * Pick the AI provider.
 *   LLM_PROVIDER=openai | anthropic   (explicit)
 *   otherwise: OpenAI if OPENAI_API_KEY is set, else Anthropic if ANTHROPIC_API_KEY is set.
 */
import { anthropicClient } from "./anthropic";
import { openAiClient } from "./openai";
import type { LlmClient } from "./types";

export function selectProvider(env: Record<string, string | undefined> = process.env): "openai" | "anthropic" | null {
  const p = env.LLM_PROVIDER?.toLowerCase();
  if (p === "openai" || p === "anthropic") return p;
  if (env.OPENAI_API_KEY) return "openai";
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return "anthropic";
  return null;
}

export class MissingApiKeyError extends Error {
  constructor() {
    super("missing_api_key");
  }
}

export function defaultLlm(): LlmClient {
  const p = selectProvider();
  if (p === "openai") return openAiClient();
  if (p === "anthropic") return anthropicClient();
  throw new MissingApiKeyError();
}

export type { LlmClient } from "./types";
