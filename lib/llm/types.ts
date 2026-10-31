/**
 * Provider-neutral shapes for the agent loop. The loop (lib/agent/runAgent.ts)
 * only speaks these; adapters translate to OpenAI or Anthropic.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema with additionalProperties:false and every property required (strict mode on both providers). */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type Turn =
  | { role: "user"; text: string }
  /** `raw` carries the provider's own assistant message so it can be sent back unchanged. */
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: "tool_results"; results: { id: string; content: string; isError?: boolean }[] };

export interface Completion {
  text: string;
  toolCalls: ToolCall[];
  stop: "tool_use" | "end" | "max_tokens" | "refusal";
  raw?: unknown;
}

export interface LlmClient {
  provider: "openai" | "anthropic" | "fake";
  model: string;
  complete(req: { system: string; tools: ToolSpec[]; turns: Turn[] }): Promise<Completion>;
}

/** Parse tool arguments defensively – a bad payload becomes an empty object, never a crash. */
export function parseArgs(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
