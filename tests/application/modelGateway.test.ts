import assert from 'node:assert/strict';
import test from 'node:test';

import { ModelGatewayService } from '../../src/application/modelGateway';
import { createModelConfig } from '../../src/domain/modelConfig';
import { ModelGatewayError } from '../../src/domain/errors';
import { MockProviderAdapter } from '../../src/infrastructure/models/adapters/mockProviderAdapter';

function makeGateway() {
  const mock = new MockProviderAdapter('mock');
  const openaiCompatible = new MockProviderAdapter('openai_compatible');
  const gateway = new ModelGatewayService({ mock, openai_compatible: openaiCompatible });
  return { gateway, mock, openaiCompatible };
}

function config(overrides: Partial<ReturnType<typeof createModelConfig>> = {}) {
  return {
    ...createModelConfig({
      labId: 'lab-1',
      name: 'Mock',
      provider: 'mock',
      model: 'mock-model',
    }),
    ...overrides,
  };
}

test('generate returns a deterministic normalized response (SPEC-005 #3)', async () => {
  const { gateway } = makeGateway();
  const response = await gateway.generate(
    { messages: [{ role: 'user', content: 'hello' }] },
    { config: config(), apiKey: null },
  );

  assert.equal(response.content, 'Mock reply to: hello');
  assert.equal(response.provider, 'mock', 'provenance is normalized to the config provider');
  assert.equal(response.model, 'mock-model', 'model falls back to the config model');
  assert.equal(response.finishReason, 'stop');
  assert.deepEqual(response.usage, { inputTokens: 1, outputTokens: 8 });
});

test('generate routes to the adapter registered for the config provider (SPEC-005 #1)', async () => {
  const { gateway, openaiCompatible } = makeGateway();
  openaiCompatible.onCall(() => ({
    content: 'pong',
    provider: 'openai_compatible',
    model: 'gpt-4o-mini',
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1 },
  }));

  const response = await gateway.generate(
    { messages: [{ role: 'user', content: 'ping' }], model: 'gpt-4o-mini' },
    {
      config: config({ provider: 'openai_compatible' }),
      apiKey: 'sk-test',
    },
  );
  assert.equal(response.provider, 'openai_compatible');
  assert.equal(response.model, 'gpt-4o-mini');
});

test('generate normalizes adapter failures into their category (SPEC-005 #4)', async () => {
  const { gateway, mock } = makeGateway();
  mock.onCall(() => {
    throw new ModelGatewayError('rate_limit', '429: quota exceeded');
  });

  await assert.rejects(
    gateway.generate({ messages: [{ role: 'user', content: 'x' }] }, { config: config(), apiKey: null }),
    (err: unknown) => err instanceof ModelGatewayError && err.category === 'rate_limit',
  );
});

test('generate wraps plain errors as unknown and never leaks the secret (SPEC-005 #4/#5)', async () => {
  const { gateway, mock } = makeGateway();
  mock.onCall(() => {
    throw new Error('boom with sk-super-secret');
  });

  await assert.rejects(
    gateway.generate({ messages: [{ role: 'user', content: 'x' }] }, { config: config(), apiKey: 'sk-super-secret' }),
    (err: unknown) => {
      assert.ok(err instanceof ModelGatewayError);
      assert.equal(err.category, 'unknown');
      assert.ok(!err.message.includes('sk-super-secret'), 'secret must never appear in the error');
      assert.ok(!String(err).includes('sk-super-secret'));
      return true;
    },
  );
});

test('generate rejects a disabled config before calling any provider', async () => {
  const { gateway, mock } = makeGateway();
  let called = false;
  mock.onCall(() => {
    called = true;
    return {
      content: 'nope',
      provider: 'mock',
      model: 'mock-model',
      finishReason: 'stop',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  });

  await assert.rejects(
    gateway.generate(
      { messages: [{ role: 'user', content: 'x' }] },
      { config: config({ isEnabled: false }), apiKey: null },
    ),
    (err: unknown) => err instanceof ModelGatewayError && err.category === 'invalid_request',
  );
  assert.equal(called, false, 'no provider call may happen for a disabled config');
});
