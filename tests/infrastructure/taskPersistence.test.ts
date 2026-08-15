import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgent } from '../../src/domain/agent';
import { createLab } from '../../src/domain/lab';
import { createProject } from '../../src/domain/project';
import { createTask } from '../../src/domain/task';
import { openDatabase } from '../../src/infrastructure/db/database';
import { SqliteAgentRepository } from '../../src/infrastructure/db/sqliteAgentRepository';
import { SqliteLabRepository } from '../../src/infrastructure/db/sqliteLabRepository';
import { SqliteProjectRepository } from '../../src/infrastructure/db/sqliteProjectRepository';
import { SqliteTaskRepository } from '../../src/infrastructure/db/sqliteTaskRepository';
import { cleanupTempDb, tempDbPath } from '../support/tempDb';

function setup() {
  const path = tempDbPath();
  const db = openDatabase(path);
  const labs = new SqliteLabRepository(db);
  const agents = new SqliteAgentRepository(db);
  const projects = new SqliteProjectRepository(db);
  const tasks = new SqliteTaskRepository(db);
  return { path, db, labs, agents, projects, tasks };
}

function seed({ labs, agents, projects }: { labs: SqliteLabRepository; agents: SqliteAgentRepository; projects: SqliteProjectRepository }) {
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);
  const alice = createAgent({ labId: lab.id, name: 'Alice' });
  agents.insert(alice);
  const project = createProject({ labId: lab.id, title: 'Survey' });
  projects.insert(project);
  return { lab, alice, project };
}

test('tasks table schema exposes the SPEC-004 fields and no secret columns', () => {
  const { path, db } = setup();
  try {
    const columns = (
      db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>
    ).map((c) => c.name.toLowerCase());
    assert.deepEqual(columns, [
      'id',
      'project_id',
      'creator_type',
      'creator_id',
      'assignee_agent_id',
      'title',
      'description',
      'status',
      'priority',
      'due_at',
      'created_at',
      'updated_at',
    ]);
    for (const forbidden of ['api_key', 'apikey', 'secret', 'token', 'password']) {
      assert.ok(!columns.includes(forbidden), `tasks table must not have a ${forbidden} column`);
    }
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('tasks.project_id and tasks.assignee_agent_id are enforced as foreign keys', () => {
  const { path, db, labs, agents, projects, tasks } = setup();
  try {
    const noProject = createTask({
      projectId: 'no-such-project',
      creatorType: 'pi',
      creatorId: 'user-1',
      assigneeAgentId: 'no-such-agent',
      title: 'X',
    });
    assert.throws(() => tasks.insert(noProject), /FOREIGN KEY/i);

    const { project } = seed({ labs, agents, projects });
    const noAgent = createTask({
      projectId: project.id,
      creatorType: 'pi',
      creatorId: 'user-1',
      assigneeAgentId: 'no-such-agent',
      title: 'X',
    });
    assert.throws(() => tasks.insert(noAgent), /FOREIGN KEY/i);
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('a task remains associated with its assignee across a database reopen (SPEC-004 #2)', () => {
  const path = tempDbPath();
  let taskId: string;
  try {
    const db1 = openDatabase(path);
    const labs = new SqliteLabRepository(db1);
    const agents = new SqliteAgentRepository(db1);
    const projects = new SqliteProjectRepository(db1);
    const tasks = new SqliteTaskRepository(db1);
    const { alice, project } = seed({ labs, agents, projects });
    const task = createTask({
      projectId: project.id,
      creatorType: 'pi',
      creatorId: 'user-1',
      assigneeAgentId: alice.id,
      title: 'Map the evidence base.',
      priority: 'high',
    });
    tasks.insert(task);
    taskId = task.id;
    db1.close();

    const db2 = openDatabase(path);
    const repo2 = new SqliteTaskRepository(db2);
    const loaded = repo2.findById(taskId);
    db2.close();

    assert.ok(loaded, 'task should be retrievable after restart');
    assert.equal(loaded!.assigneeAgentId, alice.id, 'still assigned to Alice');
    assert.equal(loaded!.title, 'Map the evidence base.');
    assert.equal(loaded!.priority, 'high');
    assert.equal(loaded!.status, 'backlog');
    assert.equal(loaded!.projectId, project.id);
    assert.equal(loaded!.creatorId, 'user-1');
  } finally {
    cleanupTempDb(path);
  }
});

test('findByProject returns only tasks of that project', () => {
  const { path, db, labs, agents, projects, tasks } = setup();
  try {
    const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
    labs.insert(lab);
    const alice = createAgent({ labId: lab.id, name: 'Alice' });
    agents.insert(alice);
    const p1 = createProject({ labId: lab.id, title: 'P1' });
    const p2 = createProject({ labId: lab.id, title: 'P2' });
    projects.insert(p1);
    projects.insert(p2);
    const mk = (projectId: string, title: string) =>
      createTask({ projectId, creatorType: 'pi', creatorId: 'user-1', assigneeAgentId: alice.id, title });
    tasks.insert(mk(p1.id, 'T1'));
    tasks.insert(mk(p1.id, 'T2'));
    tasks.insert(mk(p2.id, 'T3'));

    const titles = tasks.findByProject(p1.id).map((t) => t.title).sort();
    assert.deepEqual(titles, ['T1', 'T2']);
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('update persists a status change without deleting the row (SPEC-004 #5)', () => {
  const { path, db, labs, agents, projects, tasks } = setup();
  try {
    const { alice, project } = seed({ labs, agents, projects });
    const task = createTask({
      projectId: project.id,
      creatorType: 'pi',
      creatorId: 'user-1',
      assigneeAgentId: alice.id,
      title: 'Keep history',
    });
    tasks.insert(task);

    tasks.update({ ...task, status: 'completed', updatedAt: new Date().toISOString() });

    const reloaded = tasks.findById(task.id);
    assert.ok(reloaded, 'row is retained after completion');
    assert.equal(reloaded!.status, 'completed');
    assert.equal(reloaded!.assigneeAgentId, alice.id, 'assignment retained');
    assert.equal(reloaded!.title, 'Keep history');
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});
