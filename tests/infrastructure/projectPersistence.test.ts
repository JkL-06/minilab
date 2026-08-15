import assert from 'node:assert/strict';
import test from 'node:test';

import { createLab } from '../../src/domain/lab';
import { createProject } from '../../src/domain/project';
import { openDatabase } from '../../src/infrastructure/db/database';
import { SqliteLabRepository } from '../../src/infrastructure/db/sqliteLabRepository';
import { SqliteProjectRepository } from '../../src/infrastructure/db/sqliteProjectRepository';
import { cleanupTempDb, tempDbPath } from '../support/tempDb';

function setup() {
  const path = tempDbPath();
  const db = openDatabase(path);
  const projects = new SqliteProjectRepository(db);
  const labs = new SqliteLabRepository(db);
  return { path, db, projects, labs };
}

test('projects table schema exposes the SPEC-003 fields and no secret columns', () => {
  const { path, db } = setup();
  try {
    const columns = (
      db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>
    ).map((c) => c.name.toLowerCase());
    assert.deepEqual(columns, [
      'id',
      'lab_id',
      'team_id',
      'title',
      'objective',
      'stage',
      'status',
      'created_at',
      'updated_at',
    ]);
    for (const forbidden of ['api_key', 'apikey', 'secret', 'token', 'password']) {
      assert.ok(!columns.includes(forbidden), `projects table must not have a ${forbidden} column`);
    }
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('projects.lab_id is enforced as a foreign key (projects live in exactly one lab)', () => {
  const { path, db, projects } = setup();
  try {
    const orphan = createProject({ labId: 'no-such-lab', title: 'Orphan' });
    assert.throws(() => projects.insert(orphan), /FOREIGN KEY/i);
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('a project survives a database reopen (simulated restart, SPEC-003 #1)', () => {
  const path = tempDbPath();
  let projectId: string;
  try {
    const db1 = openDatabase(path);
    const lab1 = new SqliteLabRepository(db1);
    const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
    lab1.insert(lab);

    const repo1 = new SqliteProjectRepository(db1);
    const project = createProject({
      labId: lab.id,
      title: 'Memory & Decision',
      objective: 'Map the evidence base.',
      stage: 'survey',
      status: 'active',
    });
    repo1.insert(project);
    projectId = project.id;
    db1.close();

    const db2 = openDatabase(path);
    const repo2 = new SqliteProjectRepository(db2);
    const loaded = repo2.findById(projectId);
    db2.close();

    assert.ok(loaded, 'project should be retrievable after restart');
    assert.equal(loaded!.title, 'Memory & Decision');
    assert.equal(loaded!.objective, 'Map the evidence base.');
    assert.equal(loaded!.stage, 'survey');
    assert.equal(loaded!.status, 'active');
    assert.equal(loaded!.labId, lab.id);
  } finally {
    cleanupTempDb(path);
  }
});

test('findByLab returns only projects of that lab', () => {
  const { path, db, projects, labs } = setup();
  try {
    const lab1 = createLab({ ownerUserId: 'user-1', name: 'Lab 1' });
    const lab2 = createLab({ ownerUserId: 'user-1', name: 'Lab 2' });
    labs.insert(lab1);
    labs.insert(lab2);
    projects.insert(createProject({ labId: lab1.id, title: 'Survey' }));
    projects.insert(createProject({ labId: lab1.id, title: 'Write-up' }));
    projects.insert(createProject({ labId: lab2.id, title: 'Other' }));

    const titles = projects.findByLab(lab1.id).map((p) => p.title).sort();
    assert.deepEqual(titles, ['Survey', 'Write-up']);
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});

test('update persists an objective change with its update timestamp (SPEC-003 #4)', () => {
  const { path, db, projects, labs } = setup();
  try {
    const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
    labs.insert(lab);
    const project = createProject({ labId: lab.id, title: 'Survey' });
    projects.insert(project);
    const updatedAt = new Date().toISOString();

    projects.update({
      ...project,
      objective: 'Refocus on working memory.',
      stage: 'validate',
      status: 'active',
      updatedAt,
    });

    const reloaded = projects.findById(project.id);
    assert.ok(reloaded);
    assert.equal(reloaded!.objective, 'Refocus on working memory.');
    assert.equal(reloaded!.stage, 'validate');
    assert.equal(reloaded!.status, 'active');
    assert.equal(reloaded!.updatedAt, updatedAt, 'the objective change is persisted with its timestamp');
  } finally {
    db.close();
    cleanupTempDb(path);
  }
});
