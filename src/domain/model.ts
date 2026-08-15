/**
 * Normalized, provider-neutral model I/O types (SPEC-005).
 *
 * These are the ONLY shapes domain/application modules talk to when calling a
 * model. Provider adapters (in `infrastructure/models/`) translate between
 * these and provider SDK/HTTP types, so no provider SDK response type ever
 * leaks into domain or application code (SPEC-005 #2).
 */

export type ModelMessageRole = 'system' | 'user' | 'assistant';

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;
}

export interface ModelRequest {
  messages: ModelMessage[];
  /** Model reference; falls back to the config's `model` when omitted. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Versioned structured-output schema expectations (reserved for Agent Runtime / SPEC-006). */
  responseSchema?: Record<string, unknown>;
}

export type ModelFinishReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'tool_calls'
  | 'unknown';

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelResponse {
  content: string;
  provider: string;
  model: string;
  finishReason: ModelFinishReason;
  usage: ModelUsage | null;
}

/**
 * Stable, normalized failure categories (SPEC-005 #4). Provider adapters map
 * provider errors onto these; the API surfaces the category instead of raw
 * SDK errors.
 */
export const MODEL_ERROR_CATEGORIES = [
  'authentication',
  'rate_limit',
  'invalid_request',
  'provider_unavailable',
  'connection_failed',
  'invalid_response',
  'unknown',
] as const;

export type ModelErrorCategory = (typeof MODEL_ERROR_CATEGORIES)[number];
