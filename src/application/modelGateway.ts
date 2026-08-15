import { ModelGatewayError } from '../domain/errors';
import type { ModelRequest, ModelResponse } from '../domain/model';
import type { ModelConfig, ModelProvider } from '../domain/modelConfig';
import type { ProviderAdapter } from './providerAdapter';

export interface ModelConfigRef {
  config: ModelConfig;
  apiKey: string | null;
}

/**
 * Provider-neutral model access (SPEC-005, AGENTS.md #6).
 *
 * Everything that wants a model call — the Agent Runtime in SPEC-006, the
 * connection-test endpoint now — goes through this interface, never a provider
 * SDK. The gateway routes to the adapter registered for the config's provider,
 * enforces that the config is enabled, and normalizes any failure into a
 * `ModelGatewayError` with a stable category (SPEC-005 #4).
 */
export interface ModelGateway {
  generate(request: ModelRequest, ref: ModelConfigRef): Promise<ModelResponse>;
}

export class ModelGatewayService implements ModelGateway {
  constructor(
    private readonly adapters: Partial<Record<ModelProvider, ProviderAdapter>>,
  ) {}

  async generate(request: ModelRequest, ref: ModelConfigRef): Promise<ModelResponse> {
    const { config } = ref;
    if (!config.isEnabled) {
      throw new ModelGatewayError('invalid_request', 'Model config is disabled');
    }
    const adapter = this.adapters[config.provider];
    if (!adapter) {
      throw new ModelGatewayError(
        'invalid_request',
        `No adapter registered for provider: ${config.provider}`,
      );
    }
    try {
      const response = await adapter.complete(request, {
        model: request.model ?? config.model,
        baseUrl: config.baseUrl ?? undefined,
        apiKey: ref.apiKey,
      });
      // Normalize provenance to the config actually used.
      return { ...response, provider: config.provider, model: request.model ?? config.model };
    } catch (err) {
      if (err instanceof ModelGatewayError) {
        throw err;
      }
      // Never surface raw provider errors (or any embedded secrets) upward.
      throw new ModelGatewayError('unknown', 'Model provider call failed unexpectedly');
    }
  }
}
