import assert from 'node:assert/strict';
import test from 'node:test';

import { ArtifactService } from '../../src/application/artifactService';
import {
  ArtifactNotFoundError,
  LabForbiddenError,
  ProjectNotFoundError,
} from '../../src/domain/errors';
import { createLab } from '../../src/domain/lab';
import { createProject } from '../../src/domain/project';
import { createTask } from '../../src/domain/task';
import { createAgent } from '../../src/domain/agent';
import { inMemoryArtifactRepository } from '../support/inMemoryArtifactRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';

/** Builds an ArtifactService over in-memory repos plus a populated Lab world. */
function makeWorld() {
  const labs = inMemoryLabRepository();
  const projects = inMemoryProjectRepository();
  const artifacts = inMemoryArtifactRepository();
  const service = new ArtifactService(artifacts, projects, labs);

  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);
  const project = createProject({ labId: lab.id, title: 'Survey' });
  projects.insert(project);
  const alice = createAgent({ labId: lab.id, name: 'Alice' });
  const task = createTask({
    projectId: project.id,
    creatorType: 'pi',
    creatorId: 'user-1',
    assigneeAgentId: alice.id,
    title: 'Map evidence',
  });
  return { service, labs, projects, artifacts, lab, project, alice, task };
}

test('materializeRunArtifacts turns validated proposals into durable rows with lineage', () => {
  const { service, artifacts, project, alice, task } = makeWorld();

  const created = service.materializeRunArtifacts({
    runId: 'run-1',
    projectId: project.id,
    taskId: task.id,
    agentId: alice.id,
    summary: 'Fallback body.',
    proposals: [
      { title: 'Evidence map', content: 'Body from the proposal.', type: 'report' },
      { title: 'Note without content', type: 'note' },
    ],
  });

  assert.equal(created.length, 2, 'one artifact per proposal, in order');
  assert.equal(artifacts.artifacts.length, 2, 'rows are persisted (not just returned)');

  const [first, second] = created;
  assert.equal(first.title, 'Evidence map');
  assert.equal(first.content, 'Body from the proposal.');
  assert.equal(first.type, 'report');
  assert.equal(first.version, 1);
  assert.equal(first.projectId, project.id);
  assert.equal(first.taskId, task.id);
  assert.equal(first.creatorAgentId, alice.id);
  assert.deepEqual(first.metadata, { sourceRunId: 'run-1', sourceType: 'agent-run' });

  // A proposal with no content falls back to the run summary so the stored
  // artifact is never empty (acceptance #5: content lives in the artifacts table).
  assert.equal(second.content, 'Fallback body.');
});

test('materializeRunArtifacts never assigns a version-1 default for a blank type', () => {
  const { service, artifacts, project } = makeWorld();
  const created = service.materializeRunArtifacts({
    runId: 'run-1',
    projectId: project.id,
    taskId: null,
    agentId: null,
    summary: 'Body.',
    proposals: [{ title: 'Plain note' }],
  });
  assert.equal(created[0].type, 'note', 'untyped proposals default to note');
  assert.equal(artifacts.artifacts.length, 1);
});

test('getArtifact returns a row through the Project → Lab ownership chain', () => {
  const { service, project } = makeWorld();
  const materialized = service.materializeRunArtifacts({
    runId: 'run-1',
    projectId: project.id,
    taskId: null,
    agentId: null,
    summary: 'Body.',
    proposals: [{ title: 'Note' }],
  });

  const fetched = service.getArtifact('user-1', materialized[0].id);
  assert.equal(fetched.id, materialized[0].id);
});

test('getArtifact rejects a missing artifact and a cross-Lab requester', () => {
  const { service, project } = makeWorld();
  assert.throws(() => service.getArtifact('user-1', 'nope'), ArtifactNotFoundError);

  const materialized = service.materializeRunArtifacts({
    runId: 'run-1',
    projectId: project.id,
    taskId: null,
    agentId: null,
    summary: 'Body.',
    proposals: [{ title: 'Note' }],
  });

  // user-2 does not own the Lab that owns the artifact's Project.
  assert.throws(() => service.getArtifact('user-2', materialized[0].id), LabForbiddenError);
});

test('listProjectArtifacts returns newest-first and forbids non-owners', () => {
  const { service, artifacts, project } = makeWorld();
  service.materializeRunArtifacts({
    runId: 'run-1',
    projectId: project.id,
    taskId: null,
    agentId: null,
    summary: 'First body.',
    proposals: [{ title: 'First' }],
  });
  service.materializeRunArtifacts({
    runId: 'run-2',
    projectId: project.id,
    taskId: null,
    agentId: null,
    summary: 'Second body.',
    proposals: [{ title: 'Second' }],
  });

  // Distinct timestamps so newest-first is deterministic (both runs complete in
  // the same millisecond by default).
  artifacts.artifacts[0].createdAt = '2026-08-15T00:00:01.000Z';
  artifacts.artifacts[1].createdAt = '2026-08-15T00:00:02.000Z';

  const listed = service.listProjectArtifacts('user-1', project.id);
  assert.equal(listed.length, 2);
  assert.equal(listed[0].title, 'Second', 'newest first');
  assert.equal(listed[1].title, 'First');
  assert.equal(artifacts.artifacts.length, 2);

  assert.throws(() => service.listProjectArtifacts('user-2', project.id), LabForbiddenError);
  assert.throws(() => service.listProjectArtifacts('user-1', 'missing-project'), ProjectNotFoundError);
});

test('createRevision creates the next version with lineage and authorization', () => {
  const { service, artifacts, project } = makeWorld();
  const [original] = service.materializeRunArtifacts({
    runId: 'run-1',
    projectId: project.id,
    taskId: null,
    agentId: null,
    summary: 'Body.',
    proposals: [{ title: 'Note', type: 'note' }],
  });

  const revision = service.createRevision('user-1', original.id, {
    content: 'Revised body.',
    title: 'Note v2',
    type: 'report',
  });

  assert.equal(revision.version, 2);
  assert.equal(revision.title, 'Note v2');
  assert.equal(revision.type, 'report');
  assert.equal(revision.content, 'Revised body.');
  assert.equal(revision.projectId, original.projectId);
  assert.equal((revision.metadata as { sourceArtifactId?: string }).sourceArtifactId, original.id);
  assert.equal(artifacts.artifacts.length, 2, 'revision is a new sibling row');

  assert.throws(() => service.createRevision('user-2', original.id, { content: 'x' }), LabForbiddenError);
});
