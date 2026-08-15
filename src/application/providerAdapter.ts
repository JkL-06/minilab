import type { ModelProvider } from '../domain/modelConfig';
import type { ModelRequest, ModelResponse } from '../domain/model';

export interface AdapterOptions {
  model: string;
  /** Resolved from the config's `baseUrl`; adapters fall back to their own default. */
  baseUrl?: string;
  /** Decrypted credential for the provider; `null` when the config has none. */
  apiKey: string | null;
}

/**
 * Provider adapter contract (SPEC-005). Adapters translate a normalized
 * `ModelRequest` into a provider call and map the result back to a normalized
 * `ModelResponse`. They live in `infrastructure/models/` and must never leak
 * provider SDK types or credentials to the application layer.
 */
export interface ProviderAdapter {
  readonly provider: ModelProvider;
  complete(request: ModelRequest, options: AdapterOptions): Promise<ModelResponse>;
}
