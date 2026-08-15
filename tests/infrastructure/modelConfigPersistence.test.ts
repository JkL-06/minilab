import assert from 'node:assert/strict';
import test from 'node:test';

import { createLab } from '../../src/domain/lab';
import { createModelConfig } from '../../src/domain/modelConfig';
import { AesGcmCredentialCipher } from '../../src/infrastructure/models/credentialCipher';
import { openDatabase } from '../../src/infrastructure/db/database';
import { SqliteLabRepository } from '../../src/infrastructure/db/sqliteLabRepository';
import { SqliteModelConfigRepository } from '../../src/infrastructure/db/sqliteModelConfigRepository';
import { cleanupTempDb, tempDbPath } from '../support/tempDb';

const cipher = new AesGcmCredentialCipher(Buffer.alloc(32, 7));

/** Creates a lab row (the FK target) and returns its id. */
function seedLab(db: ReturnType<typeof openDatabase>, ownerUserId = 'user-1'): string {
  const repo = new SqliteLabRepository(db);
  const lab = createLab({ ownerUserId, name: 'Lab' });
  repo.insert(lab);
  return lab.id;
}

test('a model config persists across a simulated restart, credential encrypted at rest', () => {
  const path = tempDbPath();
  try {
    // First "process": insert a config with an encrypted credential.
    const db1 = openDatabase(path);
    const labId = seedLab(db1);
    const repo1 = new SqliteModelConfigRepository(db1);
    const config = createModelConfig({
      labId,
      name: 'OpenAI main',
      provider: 'openai_compatible',
      model: 'gpt-4o-mini',
      baseUrl: 'http://localhost:8000/v1',
      apiKeyEncrypted: cipher.encrypt('sk-persist'),
    });
    repo1.insert(config);
    db1.close();

    // Restart: a fresh connection to the same file must load the config, and
    // the credential must still be decryptable with the same key.
    const db2 = openDatabase(path);
    const repo2 = new SqliteModelConfigRepository(db2);

    const loaded = repo2.findById(config.id);
    assert.ok(loaded, 'config survives restart');
    assert.equal(loaded!.labId, labId);
    assert.equal(loaded!.name, 'OpenAI main');
    assert.equal(loaded!.provider, 'openai_compatible');
    assert.equal(loaded!.model, 'gpt-4o-mini');
    assert.equal(loaded!.baseUrl, 'http://localhost:8000/v1');
    assert.equal(loaded!.isEnabled, true);
    assert.equal(cipher.decrypt(loaded!.apiKeyEncrypted!), 'sk-persist', 'credential decrypts after restart');

    const list = repo2.findByLab(labId);
    assert.deepEqual(list.map((c) => c.id), [config.id]);
    db2.close();
  } finally {
    cleanupTempDb(path);
  }
});

test('model_configs rows are scoped by lab and ordered by creation', () => {
  const path = tempDbPath();
  try {
    const db = openDatabase(path);
    const labA = seedLab(db, 'user-1');
    const labB = seedLab(db, 'user-2');
    const repo = new SqliteModelConfigRepository(db);
    const a = createModelConfig({ labId: labA, name: 'A', provider: 'mock', model: 'mock-a' });
    const b = createModelConfig({ labId: labB, name: 'B', provider: 'mock', model: 'mock-b' });
    const c = createModelConfig({ labId: labA, name: 'C', provider: 'mock', model: 'mock-c' });
    repo.insert(a);
    repo.insert(b);
    repo.insert(c);

    assert.deepEqual(
      repo.findByLab(labA).map((config) => config.id),
      [a.id, c.id],
      'only labA configs, in insertion order',
    );
    assert.deepEqual(
      repo.findByLab(labB).map((config) => config.id),
      [b.id],
    );
    assert.equal(repo.findById('nope'), null);
    db.close();
  } finally {
    cleanupTempDb(path);
  }
});

test('update persists credential changes without leaking the plaintext into the row', () => {
  const path = tempDbPath();
  try {
    const db = openDatabase(path);
    const labId = seedLab(db);
    const repo = new SqliteModelConfigRepository(db);
    const config = createModelConfig({
      labId,
      name: 'A',
      provider: 'mock',
      model: 'mock-a',
      apiKeyEncrypted: cipher.encrypt('sk-old'),
    });
    repo.insert(config);

    repo.update({
      ...config,
      model: 'mock-b',
      apiKeyEncrypted: cipher.encrypt('sk-new'),
      updatedAt: new Date().toISOString(),
    });

    const reloaded = repo.findById(config.id)!;
    assert.equal(reloaded.model, 'mock-b');
    assert.equal(cipher.decrypt(reloaded.apiKeyEncrypted!), 'sk-new');
    assert.ok(!reloaded.apiKeyEncrypted!.includes('sk-new'), 'plaintext never stored');

    // Clearing the credential persists as NULL.
    repo.update({ ...reloaded, apiKeyEncrypted: null, updatedAt: new Date().toISOString() });
    assert.equal(repo.findById(config.id)!.apiKeyEncrypted, null);
    db.close();
  } finally {
    cleanupTempDb(path);
  }
});
