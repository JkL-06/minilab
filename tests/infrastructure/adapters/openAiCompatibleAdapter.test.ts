import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ModelRequest } from '../../../src/domain/model';
import { ModelGatewayError } from '../../../src/domain/errors';
import { OpenAICompatibleAdapter } from '../../../src/infrastructure/models/adapters/openAiCompatibleAdapter';

/** Starts a local HTTP stub that asserts on the request and replies with `status`+`body`. */
async function stub(
  handler: (req: { method: string; url: string; headers: Record<string, string | undefined>; rawBody: string }) =>
    | { status: number; body?: unknown }
    | Promise<{ status: number; body?: unknown }>,
): Promise<{ baseUrl: string; close: () => Promise<void>; port: number }> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        const result = await handler({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers as Record<string, string | undefined>,
          rawBody: Buffer.concat(chunks).toString('utf8'),
        });
        if (!res.writableEnded) {
          res.statusCode = result.status;
          if (result.body !== undefined) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result.body));
          } else {
            res.end();
          }
        }
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    port,
  };
}

function okBody(overrides: Record<string, unknown> = {}) {
  return {
    choices: [{ message: { content: 'Hello from the stub' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 5 },
    ...overrides,
  };
}

const request: ModelRequest = { messages: [{ role: 'user', content: 'hi' }] };

test('a 200 response is normalized into the ModelResponse shape (SPEC-005 #2)', async () => {
  const server = await stub(() => ({ status: 200, body: okBody() }));
  try {
    const adapter = new OpenAICompatibleAdapter(30_000);
    const response = await adapter.complete(request, { model: 'gpt-4o-mini', baseUrl: server.baseUrl, apiKey: null });

    assert.equal(response.content, 'Hello from the stub');
    assert.equal(response.provider, 'openai_compatible');
    assert.equal(response.model, 'gpt-4o-mini');
    assert.equal(response.finishReason, 'stop');
    assert.deepEqual(response.usage, { inputTokens: 3, outputTokens: 5 });
  } finally {
    await server.close();
  }
});

test('finish_reason is mapped, with unknown values falling back to unknown', async () => {
  const server = await stub(() => ({
    status: 200,
    body: okBody({ choices: [{ message: { content: 'x' }, finish_reason: 'tool_calls' }] }),
  }));
  try {
    const adapter = new OpenAICompatibleAdapter(30_000);
    assert.equal((await adapter.complete(request, { model: 'm', baseUrl: server.baseUrl, apiKey: null })).finishReason, 'tool_calls');
  } finally {
    await server.close();
  }

  const unknown = await stub(() => ({
    status: 200,
    body: okBody({ choices: [{ message: { content: 'x' }, finish_reason: 'weird' }] }),
  }));
  try {
    const adapter = new OpenAICompatibleAdapter(30_000);
    assert.equal((await adapter.complete(request, { model: 'm', baseUrl: unknown.baseUrl, apiKey: null })).finishReason, 'unknown');
  } finally {
    await unknown.close();
  }
});

test('the adapter sends the Bearer credential only when configured', async () => {
  let seenAuth: string | undefined;
  const server = await stub((req) => {
    seenAuth = req.headers.authorization;
    return { status: 200, body: okBody() };
  });
  try {
    const adapter = new OpenAICompatibleAdapter(30_000);
    await adapter.complete(request, { model: 'm', baseUrl: server.baseUrl, apiKey: 'sk-secret' });
    assert.equal(seenAuth, 'Bearer sk-secret');
    await adapter.complete(request, { model: 'm', baseUrl: server.baseUrl, apiKey: null });
    assert.equal(seenAuth, undefined, 'no Authorization header when no key is set');
  } finally {
    await server.close();
  }
});

test('the adapter forwards the model and messages to /chat/completions', async () => {
  let seen: { url: string; body: { model: string; messages: unknown[] } } | undefined;
  const server = await stub((req) => {
    seen = { url: req.url, body: JSON.parse(req.rawBody) };
    return { status: 200, body: okBody() };
  });
  try {
    const adapter = new OpenAICompatibleAdapter(30_000);
    await adapter.complete(request, { model: 'gpt-4o', baseUrl: server.baseUrl, apiKey: null });
    assert.equal(seen!.url, '/v1/chat/completions');
    assert.equal(seen!.body.model, 'gpt-4o');
    assert.deepEqual(seen!.body.messages, request.messages);
  } finally {
    await server.close();
  }
});

test('provider status codes map to normalized categories (SPEC-005 #4)', async () => {
  const cases: Array<[number, string]> = [
    [401, 'authentication'],
    [403, 'authentication'],
    [429, 'rate_limit'],
    [400, 'invalid_request'],
    [500, 'provider_unavailable'],
    [503, 'provider_unavailable'],
    [418, 'unknown'],
  ];
  for (const [status, category] of cases) {
    const server = await stub(() => ({ status }));
    try {
      const adapter = new OpenAICompatibleAdapter(30_000);
      await assert.rejects(
        adapter.complete(request, { model: 'm', baseUrl: server.baseUrl, apiKey: 'sk' }),
        (err: unknown) => err instanceof ModelGatewayError && err.category === category,
        `status ${status} should map to ${category}`,
      );
    } finally {
      await server.close();
    }
  }
});

test('malformed provider responses map to invalid_response', async () => {
  const server = await stub(() => ({ status: 200, body: { choices: [] } })); // no message.content
  try {
    const adapter = new OpenAICompatibleAdapter(30_000);
    await assert.rejects(
      adapter.complete(request, { model: 'm', baseUrl: server.baseUrl, apiKey: null }),
      (err: unknown) => err instanceof ModelGatewayError && err.category === 'invalid_response',
    );
  } finally {
    await server.close();
  }
});

test('an unreachable provider maps to connection_failed', async () => {
  // Bind a port, note it, then close it — the adapter then connects to nothing.
  const server = await stub(() => ({ status: 200, body: okBody() }));
  const { port, close } = server;
  await close();
  const deadUrl = `http://127.0.0.1:${port}/v1`;

  const adapter = new OpenAICompatibleAdapter(30_000);
  await assert.rejects(
    adapter.complete(request, { model: 'm', baseUrl: deadUrl, apiKey: null }),
    (err: unknown) => err instanceof ModelGatewayError && err.category === 'connection_failed',
  );
});

test('timeout maps to connection_failed', async () => {
  const server = await stub(() => {
    // Never respond — hang until the AbortController fires.
    return new Promise<never>(() => {});
  });
  try {
    const adapter = new OpenAICompatibleAdapter(30); // 30ms so the test stays fast
    await assert.rejects(
      adapter.complete(request, { model: 'm', baseUrl: server.baseUrl, apiKey: null }),
      (err: unknown) => err instanceof ModelGatewayError && err.category === 'connection_failed',
    );
  } finally {
    await server.close();
  }
});
