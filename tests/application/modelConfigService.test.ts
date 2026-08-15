import assert from 'node:assert/strict';
import test from 'node:test';

import { ModelConfigService } from '../../src/application/modelConfigService';
import {
  LabForbiddenError,
  ModelConfigNotFoundError,
} from '../../src/domain/errors';
import { createLab } from '../../src/domain/lab';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryModelConfigRepository } from '../support/inMemoryModelConfigRepository';
import { testCipher } from '../support/testModelGateway';

function makeService() {
  const labs = inMemoryLabRepository();
  const configs = inMemoryModelConfigRepository();
  const service = new ModelConfigService(configs, labs, testCipher);
  return { service, labs, configs };
}

function world(userId = 'user-1') {
  const { service, labs, configs } = makeService();
  const lab = createLab({ ownerUserId: userId, name: 'Lab' });
  labs.insert(lab);
  return { service, labs, lab, configs };
}

test('createModelConfig encrypts the credential, never storing plaintext (SPEC-005 #5)', () => {
  const { service, lab, configs } = world();

  const config = service.createModelConfig('user-1', lab.id, {
    name: 'OpenAI main',
    provider: 'openai_compatible',
    model: 'gpt-4o-mini',
    apiKey: 'sk-topsecret',
  });

  assert.ok(config.apiKeyEncrypted, 'credential is stored encrypted');
  assert.match(config.apiKeyEncrypted, /^v1:/, 'credential is stored in the v1 encrypted format');
  assert.notEqual(config.apiKeyEncrypted, 'sk-topsecret', 'ciphertext is not the plaintext');
  assert.ok(!config.apiKeyEncrypted.includes('topsecret'), 'ciphertext does not contain the key');
  assert.equal(configs.modelConfigs.length, 1);
  assert.equal(service.toView(config).apiKeyConfigured, true);
});

test('createModelConfig stores no credential when apiKey is omitted', () => {
  const { service, lab } = world();
  const config = service.createModelConfig('user-1', lab.id, {
    name: 'Mock',
    provider: 'mock',
    model: 'mock-model',
  });
  assert.equal(config.apiKeyEncrypted, null);
  assert.equal(service.toView(config).apiKeyConfigured, false);
});

test('createModelConfig rejects a non-owner of the lab', () => {
  const { service, lab } = world();
  assert.throws(
    () =>
      service.createModelConfig('user-2', lab.id, {
        name: 'X',
        provider: 'mock',
        model: 'mock-model',
      }),
    LabForbiddenError,
  );
});

test('list and get are lab-scoped and redacted; unknown id is 404', () => {
  const { service, lab, configs } = world();
  const a = service.createModelConfig('user-1', lab.id, {
    name: 'A',
    provider: 'mock',
    model: 'mock-a',
  });

  const listed = service.listModelConfigs('user-1', lab.id);
  assert.deepEqual(listed.map((c) => c.id), [a.id]);
  assert.equal(configs.modelConfigs.length, 1);

  const got = service.getModelConfig('user-1', a.id);
  assert.equal(got.id, a.id);

  assert.throws(() => service.getModelConfig('user-2', a.id), LabForbiddenError);
  assert.throws(() => service.getModelConfig('user-1', 'no-such-config'), ModelConfigNotFoundError);
});

test('updateModelConfig replaces, clears, or keeps the credential', () => {
  const { service, lab } = world();
  const config = service.createModelConfig('user-1', lab.id, {
    name: 'A',
    provider: 'mock',
    model: 'mock-a',
    apiKey: 'sk-old',
  });

  const replaced = service.updateModelConfig('user-1', config.id, { apiKey: 'sk-new' });
  assert.notEqual(replaced.apiKeyEncrypted, config.apiKeyEncrypted, 'credential was re-encrypted');

  const cleared = service.updateModelConfig('user-1', config.id, { apiKey: null });
  assert.equal(cleared.apiKeyEncrypted, null);

  const untouched = service.updateModelConfig('user-1', config.id, { model: 'mock-b' });
  assert.equal(untouched.apiKeyEncrypted, null, 'absent apiKey keeps the stored credential');
  assert.equal(untouched.model, 'mock-b');
  assert.ok(Date.parse(untouched.updatedAt) >= Date.parse(config.updatedAt));
});

test('updateModelConfig forbids a non-owner', () => {
  const { service, lab } = world();
  const config = service.createModelConfig('user-1', lab.id, {
    name: 'A',
    provider: 'mock',
    model: 'mock-a',
  });
  assert.throws(() => service.updateModelConfig('user-2', config.id, { model: 'mock-b' }), LabForbiddenError);
});

test('resolveForGateway decrypts the credential and enforces ownership (SPEC-005 #1)', () => {
  const { service, lab } = world();
  const config = service.createModelConfig('user-1', lab.id, {
    name: 'A',
    provider: 'mock',
    model: 'mock-a',
    apiKey: 'sk-topsecret',
  });

  const resolved = service.resolveForGateway('user-1', config.id);
  assert.equal(resolved.config.id, config.id);
  assert.equal(resolved.apiKey, 'sk-topsecret', 'decrypted back to the original plaintext');

  assert.throws(() => service.resolveForGateway('user-2', config.id), LabForbiddenError);

  const noKey = service.createModelConfig('user-1', lab.id, {
    name: 'B',
    provider: 'mock',
    model: 'mock-b',
  });
  assert.equal(service.resolveForGateway('user-1', noKey.id).apiKey, null);
});
