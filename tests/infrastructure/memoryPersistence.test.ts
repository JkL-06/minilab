import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemory } from '../../src/domain/memory';
import { createAgent } from '../../src/domain/agent';
import { createLab } from '../../src/domain/lab';
import { createProject } from '../../src/domain/project';
import { openDatabase } from '../../src/infrastructure/db/database';
import { SqliteAgentRepository } from '../../src/infrastructure/db/sqliteAgentRepository';
import { SqliteLabRepository } from '../../src/infrastructure/db/sqliteLabRepository';
import { SqliteMemoryRepository } from '../../src/infrastructure/db/sqliteMemoryRepository';
import { SqliteProjectRepository } from '../../src/infrastructure/db/sqliteProjectRepository';
import { cleanupTempDb, tempDbPath } from '../support/tempDb';

function setup() {
  const path = tempDbPath();
  const db = openDatabase(path);
  const labs = new SqliteLabRepository(db);
  const agents = new SqliteAgentRepository(db);
  const projects = new SqliteProjectRepository(db);
  const memories = new SqliteMemoryRepository(db);
  return { path, db, labs, agents, projects, memories };
}

function seed(labs: SqliteLabRepository, agents: SqliteAgentRepository, projects: SqliteProjectRepository) {
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);
  const alice = createAgent({ labId: lab.id, name: 'Alice' });
  agents.insert(alice);
  const project = createProject({ labId: lab.id, title: 'Survey' });
  projects.insert(project);
  return { lab, alice, project };
}

test('memories table schema exposes every SPEC-007 field and no secret columns', () => {
  const { path, db } = setup();
  try {
    const columns = (
      db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>
    ).map((c) => c.name.toLowerCase());
    assert.deepEqual(columns, [
      'id',
      'lab_id',
      'scope_type',
      'scope_id',
      'memory_type',
      'content',
      'source_type',
      'source_id',
      'author_type',
      'author_id',
      'importance',
      'created_at',
    ]);
    for (const forbidden of ['api_key', 'apikey', 'secret', 'token', 'password']) {
      assert.ok(!columns.includes(forbidden), `memories table must not have a ${forbidden} column`);
    }
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('memories.scope_type and memories.author_type are constrained to their enums', () => {
  const { path, db, labs, agents, projects } = setup();
  try {
    // Raw inserts bypass the domain so the database CHECK constraints are what
    // gets tested (the domain would reject the same shapes earlier).
    const { lab } = seed(labs, agents, projects);
    const insertRaw = (overrides: Record<string, unknown>) =>
      db
        .prepare(
          `INSERT INTO memories
             (id, lab_id, scope_type, scope_id, memory_type, content, source_type,
              source_id, author_type, author_id, importance, created_at)
           VALUES
             (@id, @lab_id, @scope_type, @scope_id, @memory_type, @content, @source_type,
              @source_id, @author_type, @author_id, @importance, @created_at)`,
        )
        .run({
          id: 'raw-1',
          lab_id: lab.id,
          scope_type: 'agent',
          scope_id: 'agent-1',
          memory_type: 'note',
          content: 'x',
          source_type: 'note',
          source_id: 's1',
          author_type: 'pi',
          author_id: 'user-1',
          importance: 3,
          created_at: new Date().toISOString(),
          ...overrides,
        });

    assert.throws(() => insertRaw({ scope_type: 'system' }), /CHECK/i);
    assert.throws(() => insertRaw({ author_type: 'system' }), /CHECK/i);
    // Lab scope must carry no scope_id; others must carry one.
    assert.throws(() => insertRaw({ scope_type: 'lab', scope_id: 'team-1' }), /CHECK/i);
    assert.throws(() => insertRaw({ scope_id: null }), /CHECK/i, 'agent scope requires scope_id');
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('acceptance #4: memory survives a database reopen (simulated restart)', () => {
  const path = tempDbPath();
  let memoryId: string;
  try {
    const db1 = openDatabase(path);
    const labs = new SqliteLabRepository(db1);
    const agents = new SqliteAgentRepository(db1);
    const projects = new SqliteProjectRepository(db1);
    const memories = new SqliteMemoryRepository(db1);
    const { lab, project } = seed(labs, agents, projects);

    const memory = createMemory({
      labId: lab.id,
      scope: 'project',
      scopeId: project.id,
      memoryType: 'hypothesis',
      content: 'Working-memory load modulates survey outcomes.',
      sourceType: 'experiment',
      sourceId: 'exp-42',
      authorType: 'pi',
      authorId: 'user-1',
      importance: 5,
    });
    memories.insert(memory);
    memoryId = memory.id;
    db1.close();

    const db2 = openDatabase(path);
    const repo2 = new SqliteMemoryRepository(db2);
    const loaded = repo2.findById(memoryId);
    db2.close();

    assert.ok(loaded, 'memory should be retrievable after restart');
    assert.equal(loaded!.scope, 'project');
    assert.equal(loaded!.scopeId, project.id);
    assert.equal(loaded!.content, 'Working-memory load modulates survey outcomes.');
    assert.equal(loaded!.importance, 5);
    assert.equal(loaded!.labId, lab.id);
  } finally {
    cleanupTempDb(path);
  }
});

test('acceptance #5: persisted memory exposes source type and source ID', () => {
  const { path, db, labs, agents, projects, memories } = setup();
  try {
    const { lab, alice } = seed(labs, agents, projects);
    const memory = createMemory({
      labId: lab.id,
      scope: 'agent',
      scopeId: alice.id,
      content: 'Alice flagged replication risk.',
      sourceType: 'replication-check',
      sourceId: 'exp-7',
      authorType: 'pi',
      authorId: 'user-1',
    });
    memories.insert(memory);

    const loaded = memories.findById(memory.id);
    assert.ok(loaded);
    assert.equal(loaded!.sourceType, 'replication-check');
    assert.equal(loaded!.sourceId, 'exp-7');
    assert.equal(loaded!.authorType, 'pi');
    assert.equal(loaded!.authorId, 'user-1');
    assert.equal(loaded!.createdAt, memory.createdAt);
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('findByLab filters by scope and scopeId and returns newest first', () => {
  const { path, db, labs, agents, projects, memories } = setup();
  try {
    const { lab, alice, project } = seed(labs, agents, projects);
    const mk = (scope: 'agent' | 'project' | 'lab', scopeId: string | null, content: string) =>
      createMemory({
        labId: lab.id,
        scope,
        scopeId,
        content,
        sourceType: 'note',
        sourceId: 's1',
        authorType: 'pi',
        authorId: 'user-1',
      });
    memories.insert(mk('agent', alice.id, 'A1'));
    memories.insert(mk('project', project.id, 'P1'));
    memories.insert(mk('lab', null, 'L1'));

    const all = memories.findByLab(lab.id);
    assert.equal(all.length, 3);

    const agentsOnly = memories.findByLab(lab.id, { scope: 'agent' });
    assert.equal(agentsOnly.length, 1);
    assert.equal(agentsOnly[0].content, 'A1');

    const aliceOnly = memories.findByLab(lab.id, { scope: 'agent', scopeId: alice.id });
    assert.equal(aliceOnly.length, 1);

    assert.ok(
      all[0].createdAt >= all[1].createdAt && all[1].createdAt >= all[2].createdAt,
      'newest first',
    );
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('memories.lab_id is enforced as a foreign key', () => {
  const { path, db, memories } = setup();
  try {
    const orphan = createMemory({
      labId: 'no-such-lab',
      scope: 'lab',
      content: 'x',
      sourceType: 'note',
      sourceId: 's1',
      authorType: 'pi',
      authorId: 'user-1',
    });
    assert.throws(() => memories.insert(orphan), /FOREIGN KEY/i);
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});
