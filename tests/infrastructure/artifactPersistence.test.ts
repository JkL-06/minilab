import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgent } from '../../src/domain/agent';
import { createArtifact } from '../../src/domain/artifact';
import { createLab } from '../../src/domain/lab';
import { createProject } from '../../src/domain/project';
import { createTask } from '../../src/domain/task';
import { openDatabase } from '../../src/infrastructure/db/database';
import { SqliteAgentRepository } from '../../src/infrastructure/db/sqliteAgentRepository';
import { SqliteArtifactRepository } from '../../src/infrastructure/db/sqliteArtifactRepository';
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
  const artifacts = new SqliteArtifactRepository(db);
  return { path, db, labs, agents, projects, tasks, artifacts };
}

function seed(
  labs: SqliteLabRepository,
  agents: SqliteAgentRepository,
  projects: SqliteProjectRepository,
  tasks: SqliteTaskRepository,
) {
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);
  const alice = createAgent({ labId: lab.id, name: 'Alice' });
  agents.insert(alice);
  const project = createProject({ labId: lab.id, title: 'Survey' });
  projects.insert(project);
  const task = createTask({
    projectId: project.id,
    creatorType: 'pi',
    creatorId: 'user-1',
    assigneeAgentId: alice.id,
    title: 'Map evidence',
  });
  tasks.insert(task);
  return { lab, alice, project, task };
}

test('artifacts table schema exposes every SPEC-008 field and no secret columns', () => {
  const { path, db } = setup();
  try {
    const columns = (
      db.prepare('PRAGMA table_info(artifacts)').all() as Array<{ name: string }>
    ).map((c) => c.name.toLowerCase());
    assert.deepEqual(columns, [
      'id',
      'project_id',
      'task_id',
      'creator_agent_id',
      'type',
      'title',
      'content',
      'version',
      'metadata',
      'created_at',
    ]);
    for (const forbidden of ['api_key', 'apikey', 'secret', 'token', 'password']) {
      assert.ok(!columns.includes(forbidden), `artifacts table must not have a ${forbidden} column`);
    }
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('an artifact survives a database reopen with version + metadata intact (acceptance #2, #4)', () => {
  const { path, db, labs, agents, projects, tasks, artifacts } = setup();
  const seeded = seed(labs, agents, projects, tasks);
  let artifactId: string;
  try {
    const artifact = createArtifact({
      projectId: seeded.project.id,
      taskId: seeded.task.id,
      creatorAgentId: seeded.alice.id,
      type: 'report',
      title: 'Evidence map',
      content: 'Draft map of 40 studies.',
      metadata: { sourceRunId: 'run-1', sourceType: 'agent-run' },
    });
    artifactId = artifact.id;
    artifacts.insert(artifact);
  } finally {
    db.close();
  }

  // Reopen: the row must be retrievable by id and from its Project (acceptance #2).
  const reopened = openDatabase(path);
  try {
    const reloaded = new SqliteArtifactRepository(reopened);
    const found = reloaded.findById(artifactId!);
    assert.ok(found, 'artifact is durable across a restart');
    assert.equal(found!.projectId, seeded.project.id, 'Project linkage survives a restart (acceptance #3)');
    assert.equal(found!.taskId, seeded.task.id);
    assert.equal(found!.creatorAgentId, seeded.alice.id);
    assert.equal(found!.type, 'report');
    assert.equal(found!.version, 1);
    assert.equal(found!.content, 'Draft map of 40 studies.');
    assert.deepEqual(found!.metadata, { sourceRunId: 'run-1', sourceType: 'agent-run' });

    const listed = reloaded.findByProject(seeded.project.id);
    assert.equal(listed.length, 1, 'visible from its Project after a restart');
  } finally {
    reopened.close();
    cleanupTempDb(path);
  }
});

test('findByProject returns only that project’s artifacts, newest first', () => {
  const { path, db, labs, agents, projects, tasks, artifacts } = setup();
  try {
    const { project, task, alice } = seed(labs, agents, projects, tasks);
    const first = createArtifact({ projectId: project.id, taskId: task.id, creatorAgentId: alice.id, title: 'First', content: 'a' });
    const second = createArtifact({ projectId: project.id, taskId: task.id, creatorAgentId: alice.id, title: 'Second', content: 'b' });
    artifacts.insert(first);
    artifacts.insert(second);

    const listed = artifacts.findByProject(project.id);
    assert.equal(listed.length, 2);
    assert.equal(listed[0].title, 'Second', 'newest first');
    assert.equal(listed[1].title, 'First');
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});
