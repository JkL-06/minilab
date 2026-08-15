import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgent } from '../../src/domain/agent';
import { createLab } from '../../src/domain/lab';
import { openDatabase } from '../../src/infrastructure/db/database';
import { SqliteAgentRepository } from '../../src/infrastructure/db/sqliteAgentRepository';
import { SqliteLabRepository } from '../../src/infrastructure/db/sqliteLabRepository';
import { cleanupTempDb, tempDbPath } from '../support/tempDb';

function setup() {
  const path = tempDbPath();
  const db = openDatabase(path);
  const agents = new SqliteAgentRepository(db);
  const labs = new SqliteLabRepository(db);
  return { path, db, agents, labs };
}

test('agents table schema contains no provider-secret columns (SPEC-002 #5)', () => {
  const { path, db } = setup();
  try {
    const columns = (
      db.prepare('PRAGMA table_info(agents)').all() as Array<{ name: string }>
    ).map((c) => c.name.toLowerCase());
    assert.deepEqual(
      columns,
      [
        'id',
        'lab_id',
        'name',
        'role',
        'specialization',
        'profile',
        'status',
        'model_config_id',
        'created_at',
        'updated_at',
      ],
    );
    for (const forbidden of ['api_key', 'apikey', 'secret', 'token', 'password']) {
      assert.ok(!columns.includes(forbidden), `agents table must not have a ${forbidden} column`);
    }
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('agents.lab_id is enforced as a foreign key (cross-lab integrity)', () => {
  const { path, db, agents } = setup();
  try {
    const orphan = createAgent({ labId: 'no-such-lab', name: 'Alice' });
    assert.throws(() => agents.insert(orphan), /FOREIGN KEY/i);
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('an agent survives a database reopen (simulated restart, SPEC-002 #2)', () => {
  const path = tempDbPath();
  let agentId: string;
  try {
    const db1 = openDatabase(path);
    const lab1 = new SqliteLabRepository(db1);
    const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
    lab1.insert(lab);

    const repo1 = new SqliteAgentRepository(db1);
    const alice = createAgent({ labId: lab.id, name: 'Alice', role: 'researcher' });
    repo1.insert(alice);
    agentId = alice.id;
    db1.close();

    const db2 = openDatabase(path);
    const repo2 = new SqliteAgentRepository(db2);
    const loaded = repo2.findById(agentId);
    db2.close();

    assert.ok(loaded, 'agent should be retrievable after restart');
    assert.equal(loaded!.name, 'Alice');
    assert.equal(loaded!.role, 'researcher');
    assert.equal(loaded!.labId, lab.id);
    assert.equal(loaded!.status, 'active');
  } finally {
    cleanupTempDb(path);
  }
});

test('findByLab returns only agents of that lab', () => {
  const { path, db, agents, labs } = setup();
  try {
    const lab1 = createLab({ ownerUserId: 'user-1', name: 'Lab 1' });
    const lab2 = createLab({ ownerUserId: 'user-1', name: 'Lab 2' });
    labs.insert(lab1);
    labs.insert(lab2);
    agents.insert(createAgent({ labId: lab1.id, name: 'Alice' }));
    agents.insert(createAgent({ labId: lab1.id, name: 'Bob' }));
    agents.insert(createAgent({ labId: lab2.id, name: 'Carol' }));

    const names = agents.findByLab(lab1.id).map((a) => a.name).sort();
    assert.deepEqual(names, ['Alice', 'Bob']);
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('update persists status deactivation and does not delete the row (SPEC-002 #6)', () => {
  const { path, db, agents, labs } = setup();
  try {
    const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
    labs.insert(lab);
    const alice = createAgent({ labId: lab.id, name: 'Alice' });
    agents.insert(alice);

    agents.update({ ...alice, status: 'inactive', updatedAt: new Date().toISOString() });

    const reloaded = agents.findById(alice.id);
    assert.ok(reloaded, 'row is retained after deactivation');
    assert.equal(reloaded!.status, 'inactive');
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});
