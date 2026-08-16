import assert from 'node:assert/strict';
import test from 'node:test';

import { createLab } from '../../src/domain/lab';
import { openDatabase } from '../../src/infrastructure/db/database';
import { SqliteLabRepository } from '../../src/infrastructure/db/sqliteLabRepository';
import { cleanupTempDb, tempDbPath } from '../support/tempDb';

test('migrations apply exactly once and are idempotent', () => {
  const path = tempDbPath();
  const db1 = openDatabase(path); // first open applies migrations
  try {
    const db2 = openDatabase(path); // second open must be a no-op
    try {
      const count = db2.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as {
        n: number;
      };
      assert.equal(
        count.n,
        10,
        'ten migrations recorded (labs, agents, projects, tasks, model_configs, agent_runs, memories, artifacts, meetings, users)',
      );
      const names = (
        db2.prepare('SELECT name FROM schema_migrations ORDER BY version').all() as Array<{
          name: string;
        }>
      ).map((row) => row.name);
      assert.deepEqual(names, [
        'create_labs',
        'create_agents',
        'create_projects',
        'create_tasks',
        'create_model_configs',
        'create_agent_runs',
        'create_memories',
        'create_artifacts',
        'create_meetings',
        'create_users',
      ]);
    } finally {
      db2.close();
    }
  } finally {
    db1.close();
    cleanupTempDb(path);
  }
});

test('a lab written through the repository survives a database reopen (simulated restart)', () => {
  const path = tempDbPath();
  try {
    // First "process"
    const db1 = openDatabase(path);
    const repo1 = new SqliteLabRepository(db1);
    const lab = createLab({ ownerUserId: 'user-1', name: 'Persistent Lab', description: 'durable' });
    repo1.insert(lab);
    db1.close();

    // Simulated restart: fresh connection to the same file
    const db2 = openDatabase(path);
    const repo2 = new SqliteLabRepository(db2);
    const loaded = repo2.findById(lab.id);
    db2.close();

    assert.ok(loaded, 'lab should be retrievable after restart');
    assert.equal(loaded!.name, 'Persistent Lab');
    assert.equal(loaded!.description, 'durable');
    assert.equal(loaded!.ownerUserId, 'user-1');
    assert.equal(loaded!.id, lab.id);
  } finally {
    cleanupTempDb(path);
  }
});

test('findByOwner returns only labs owned by the given user', () => {
  const path = tempDbPath();
  try {
    const db = openDatabase(path);
    const repo = new SqliteLabRepository(db);
    const mine = createLab({ ownerUserId: 'user-1', name: 'Mine' });
    const theirs = createLab({ ownerUserId: 'user-2', name: 'Theirs' });
    repo.insert(mine);
    repo.insert(theirs);

    const names = repo.findByOwner('user-1').map((lab) => lab.name);
    assert.deepEqual(names, ['Mine']);
    db.close();
  } finally {
    cleanupTempDb(path);
  }
});

test('update persists the changed name and description', () => {
  const path = tempDbPath();
  try {
    const db = openDatabase(path);
    const repo = new SqliteLabRepository(db);
    const lab = createLab({ ownerUserId: 'user-1', name: 'Before' });
    repo.insert(lab);

    repo.update({ ...lab, name: 'After', description: 'changed', updatedAt: new Date().toISOString() });

    const reloaded = repo.findById(lab.id);
    assert.equal(reloaded!.name, 'After');
    assert.equal(reloaded!.description, 'changed');
    db.close();
  } finally {
    cleanupTempDb(path);
  }
});
