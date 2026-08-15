import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyModelConfigUpdate,
  createModelConfig,
  MODEL_PROVIDERS,
  toModelConfigView,
  type CreateModelConfigInput,
} from '../../src/domain/modelConfig';
import { ModelConfigValidationError } from '../../src/domain/errors';

function baseInput(overrides: Partial<CreateModelConfigInput> = {}): CreateModelConfigInput {
  return {
    labId: 'lab-1',
    name: 'OpenAI main',
    provider: 'openai_compatible',
    model: 'gpt-4o-mini',
    ...overrides,
  };
}

test('createModelConfig stores the full shape with defaults and opaque ciphertext', () => {
  const config = createModelConfig(baseInput({ apiKeyEncrypted: 'v1:cipher' }));

  assert.ok(config.id, 'immutable UUIDv4 id');
  assert.equal(config.labId, 'lab-1');
  assert.equal(config.name, 'OpenAI main');
  assert.equal(config.provider, 'openai_compatible');
  assert.equal(config.model, 'gpt-4o-mini');
  assert.equal(config.baseUrl, null);
  assert.equal(config.apiKeyEncrypted, 'v1:cipher');
  assert.equal(config.isEnabled, true);
  assert.match(config.createdAt, /Z$/);
  assert.equal(config.updatedAt, config.createdAt);
});

test('createModelConfig accepts baseUrl, disabled state, and no credential', () => {
  const config = createModelConfig(
    baseInput({ baseUrl: 'http://localhost:8000/v1', isEnabled: false }),
  );

  assert.equal(config.baseUrl, 'http://localhost:8000/v1');
  assert.equal(config.isEnabled, false);
  assert.equal(config.apiKeyEncrypted, null, 'no credential configured');
});

test('createModelConfig rejects empty name, empty model, and an unsupported provider', () => {
  assert.throws(() => createModelConfig(baseInput({ name: '   ' })), ModelConfigValidationError);
  assert.throws(() => createModelConfig(baseInput({ model: '' })), ModelConfigValidationError);
  assert.throws(
    () =>
      createModelConfig(
        baseInput({ provider: 'anthropic' } as unknown as Partial<CreateModelConfigInput>),
      ),
    ModelConfigValidationError,
  );
});

test('createModelConfig rejects a non-http baseUrl and an empty one', () => {
  assert.throws(() => createModelConfig(baseInput({ baseUrl: 'api.openai.com/v1' })), ModelConfigValidationError);
  assert.throws(() => createModelConfig(baseInput({ baseUrl: '   ' })), ModelConfigValidationError);
});

test('MODEL_PROVIDERS enumerates the supported providers', () => {
  assert.deepEqual(MODEL_PROVIDERS, ['openai_compatible', 'mock']);
});

test('applyModelConfigUpdate changes only supplied fields and bumps updatedAt', () => {
  const before = createModelConfig(baseInput({ apiKeyEncrypted: 'v1:old' }));
  const updated = applyModelConfigUpdate(before, { model: 'gpt-5', isEnabled: false });

  assert.equal(updated.model, 'gpt-5');
  assert.equal(updated.isEnabled, false);
  assert.equal(updated.name, before.name, 'unsupplied fields are untouched');
  assert.equal(updated.apiKeyEncrypted, 'v1:old', 'absent credential field keeps the stored one');
  assert.ok(
    Date.parse(updated.updatedAt) >= Date.parse(before.updatedAt),
    'updatedAt must never go backwards',
  );
});

test('applyModelConfigUpdate can replace or clear the credential', () => {
  const base = createModelConfig(baseInput({ apiKeyEncrypted: 'v1:old' }));

  const replaced = applyModelConfigUpdate(base, { apiKeyEncrypted: 'v1:new' });
  assert.equal(replaced.apiKeyEncrypted, 'v1:new');

  const cleared = applyModelConfigUpdate(base, { apiKeyEncrypted: null });
  assert.equal(cleared.apiKeyEncrypted, null);
});

test('toModelConfigView never exposes the stored credential', () => {
  const config = createModelConfig(baseInput({ apiKeyEncrypted: 'v1:cipher', isEnabled: true }));
  const view = toModelConfigView(config);

  assert.equal(view.apiKeyConfigured, true);
  assert.ok(!('apiKeyEncrypted' in view), 'ciphertext is stripped from the view');
  assert.ok(!('apiKey' in view), 'no plaintext field exists');
  assert.equal(view.name, 'OpenAI main');
  assert.equal(view.labId, 'lab-1');
});

test('toModelConfigView reports apiKeyConfigured=false when no credential is stored', () => {
  const view = toModelConfigView(createModelConfig(baseInput()));
  assert.equal(view.apiKeyConfigured, false);
});
