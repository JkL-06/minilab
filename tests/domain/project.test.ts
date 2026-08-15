import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyProjectUpdate,
  createProject,
  DEFAULT_PROJECT_STAGE,
  DEFAULT_PROJECT_STATUS,
  PROJECT_STATUSES,
  RESEARCH_STAGES,
  validateProjectStatus,
  validateResearchStage,
} from '../../src/domain/project';
import { ProjectValidationError } from '../../src/domain/errors';

test('createProject defaults stage/status and stores the full shape', () => {
  const project = createProject({ labId: 'lab-1', title: 'Memory & Decision' });

  assert.ok(project.id, 'immutable UUIDv4 id');
  assert.equal(project.labId, 'lab-1');
  assert.equal(project.teamId, null, 'team reference is nullable (v0.1 single team)');
  assert.equal(project.title, 'Memory & Decision');
  assert.equal(project.objective, null);
  assert.equal(project.stage, DEFAULT_PROJECT_STAGE);
  assert.equal(project.status, DEFAULT_PROJECT_STATUS);
  assert.match(project.createdAt, /Z$/);
  assert.equal(project.updatedAt, project.createdAt);
});

test('createProject accepts an explicit stage, status, objective, and team reference', () => {
  const project = createProject({
    labId: 'lab-1',
    title: 'Survey',
    objective: 'Map the existing evidence base.',
    teamId: 'team-core',
    stage: 'survey',
    status: 'active',
  });

  assert.equal(project.objective, 'Map the existing evidence base.');
  assert.equal(project.teamId, 'team-core');
  assert.equal(project.stage, 'survey');
  assert.equal(project.status, 'active');
});

test('createProject rejects an empty title', () => {
  assert.throws(() => createProject({ labId: 'lab-1', title: '   ' }), ProjectValidationError);
});

test('createProject rejects an unsupported research stage (SPEC-003 #2)', () => {
  assert.throws(
    () => createProject({ labId: 'lab-1', title: 'X', stage: 'brainstorm' as never }),
    ProjectValidationError,
  );
});

test('createProject rejects an unsupported status', () => {
  assert.throws(
    () => createProject({ labId: 'lab-1', title: 'X', status: 'draft' as never }),
    ProjectValidationError,
  );
});

test('RESEARCH_STAGES enumerates the nine supported stages in DOMAIN_MODEL order', () => {
  assert.deepEqual(RESEARCH_STAGES, [
    'explore',
    'survey',
    'ideate',
    'validate',
    'develop',
    'analyze',
    'write',
    'submit',
    'revise',
  ]);
});

test('PROJECT_STATUSES enumerates the six supported statuses', () => {
  assert.deepEqual(PROJECT_STATUSES, [
    'planned',
    'active',
    'blocked',
    'paused',
    'completed',
    'archived',
  ]);
});

test('validateResearchStage / validateProjectStatus accept every enum value and reject anything else', () => {
  for (const stage of RESEARCH_STAGES) {
    assert.equal(validateResearchStage(stage), stage);
  }
  assert.throws(() => validateResearchStage('fabricate'), ProjectValidationError);

  for (const status of PROJECT_STATUSES) {
    assert.equal(validateProjectStatus(status), status);
  }
  assert.throws(() => validateProjectStatus('cancelled'), ProjectValidationError);
});

test('applyProjectUpdate changes only supplied fields and bumps updatedAt', () => {
  const before = createProject({ labId: 'lab-1', title: 'Title' });
  const updated = applyProjectUpdate(before, { objective: 'New objective' });

  assert.equal(updated.objective, 'New objective');
  assert.equal(updated.title, 'Title', 'unsupplied fields are untouched');
  assert.equal(updated.stage, before.stage);
  assert.equal(updated.status, before.status);
  assert.ok(
    Date.parse(updated.updatedAt) >= Date.parse(before.updatedAt),
    'updatedAt must never go backwards',
  );
});

test('an objective change is recorded with an update timestamp (SPEC-003 #4)', () => {
  const before = createProject({ labId: 'lab-1', title: 'Title' });
  const updated = applyProjectUpdate(before, { objective: 'Refocus on working memory.' });

  assert.equal(updated.objective, 'Refocus on working memory.');
  // updatedAt is bumped to (at least) the current time on every write; it must
  // never go backwards even when the update lands in the same millisecond.
  assert.ok(
    Date.parse(updated.updatedAt) >= Date.parse(before.updatedAt),
    'updatedAt must never go backwards',
  );
  assert.match(updated.updatedAt, /Z$/, 'the update carries an ISO-8601 UTC timestamp');
});

test('applyProjectUpdate validates stage/status and clears nullable fields with null', () => {
  const project = createProject({ labId: 'lab-1', title: 'Title', teamId: 'team-1' });

  assert.throws(
    () => applyProjectUpdate(project, { stage: 'not-a-stage' }),
    ProjectValidationError,
  );
  assert.throws(
    () => applyProjectUpdate(project, { status: 'unknown' }),
    ProjectValidationError,
  );

  const cleared = applyProjectUpdate(project, { teamId: null, objective: null });
  assert.equal(cleared.teamId, null);
  assert.equal(cleared.objective, null);
});
