import { ModelGatewayError } from '../../../domain/errors';
import type { ModelRequest, ModelResponse } from '../../../domain/model';
import type { AdapterOptions, ProviderAdapter } from '../../../application/providerAdapter';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface ChatCompletion {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/**
 * A working OpenAI-compatible adapter (SPEC-005). Talks plain HTTP to any
 * OpenAI-compatible `/chat/completions` endpoint — OpenAI, vLLM, Ollama, a
 * local stub — so there is no provider SDK and no SDK type to leak (SPEC-005
 * #2). Failures are mapped to normalized `ModelGatewayError` categories
 * (SPEC-005 #4) and error messages never echo credentials (SPEC-005 #5).
 */
export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly provider = 'openai_compatible' as const;

  constructor(private readonly timeoutMs = 3_000) {}

  async complete(request: ModelRequest, options: AdapterOptions): Promise<ModelResponse> {
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: options.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      throw new ModelGatewayError(
        'connection_failed',
        timedOut ? 'Provider request timed out' : 'Could not reach the model provider',
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) {
      throw new ModelGatewayError('authentication', 'Provider rejected the API key');
    }
    if (res.status === 429) {
      throw new ModelGatewayError('rate_limit', 'Provider rate limited the request');
    }
    if (res.status === 400) {
      throw new ModelGatewayError('invalid_request', 'Provider rejected the request as invalid');
    }
    if (res.status >= 500) {
      throw new ModelGatewayError('provider_unavailable', 'Provider returned a server error');
    }
    if (res.status !== 200) {
      throw new ModelGatewayError('unknown', `Provider returned status ${res.status}`);
    }

    let data: ChatCompletion;
    try {
      data = (await res.json()) as ChatCompletion;
    } catch {
      throw new ModelGatewayError('invalid_response', 'Provider returned a malformed response');
    }
    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string') {
      throw new ModelGatewayError('invalid_response', 'Provider response was missing message content');
    }
    const finishRaw = choice?.finish_reason;
    const finishReason =
      finishRaw === 'stop' ||
      finishRaw === 'length' ||
      finishRaw === 'content_filter' ||
      finishRaw === 'tool_calls'
        ? finishRaw
        : 'unknown';

    return {
      content,
      provider: this.provider,
      model: options.model,
      finishReason,
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 }
        : null,
    };
  }
}
