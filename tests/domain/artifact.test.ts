import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createArtifact,
  createArtifactRevision,
  DEFAULT_ARTIFACT_TYPE,
  validateArtifactContent,
  validateArtifactTitle,
  validateArtifactType,
  validateArtifactVersion,
  type CreateArtifactInput,
} from '../../src/domain/artifact';
import { ArtifactValidationError } from '../../src/domain/errors';

function baseInput(overrides: Partial<CreateArtifactInput> = {}): CreateArtifactInput {
  return {
    projectId: 'project-1',
    title: 'Evidence map',
    content: 'Draft map of 40 studies.',
    ...overrides,
  };
}

test('createArtifact builds a v1 artifact linked to its Project (SPEC-008)', () => {
  const artifact = createArtifact(
    baseInput({ taskId: 'task-1', creatorAgentId: 'agent-1', type: 'report' }),
  );

  assert.ok(artifact.id, 'immutable UUIDv4 id');
  assert.equal(artifact.projectId, 'project-1');
  assert.equal(artifact.taskId, 'task-1');
  assert.equal(artifact.creatorAgentId, 'agent-1');
  assert.equal(artifact.type, 'report');
  assert.equal(artifact.title, 'Evidence map');
  assert.equal(artifact.content, 'Draft map of 40 studies.');
  assert.equal(artifact.version, 1);
  assert.equal(artifact.metadata, null);
  assert.match(artifact.createdAt, /Z$/, 'UTC ISO-8601 timestamp');
});

test('createArtifact defaults type to note and nullifies absent links', () => {
  const artifact = createArtifact(baseInput());
  assert.equal(artifact.type, DEFAULT_ARTIFACT_TYPE);
  assert.equal(artifact.taskId, null);
  assert.equal(artifact.creatorAgentId, null);
  assert.equal(artifact.version, 1);
});

test('createArtifact trims title/type/content', () => {
  const artifact = createArtifact(baseInput({ title: '  Map  ', content: '  body  ', type: ' note ' }));
  assert.equal(artifact.title, 'Map');
  assert.equal(artifact.content, 'body');
  assert.equal(artifact.type, 'note');
});

test('createArtifact rejects empty or oversized fields', () => {
  assert.throws(() => createArtifact(baseInput({ title: '   ' })), ArtifactValidationError);
  assert.throws(() => createArtifact(baseInput({ content: '  ' })), ArtifactValidationError);
  assert.throws(() => createArtifact(baseInput({ type: '   ' })), ArtifactValidationError);
  assert.throws(() => createArtifact(baseInput({ title: 'x'.repeat(301) })), ArtifactValidationError);
  assert.throws(() => createArtifact(baseInput({ content: 'x'.repeat(100_001) })), ArtifactValidationError);
  assert.throws(() => createArtifact(baseInput({ type: 'x'.repeat(101) })), ArtifactValidationError);
});

test('createArtifactRevision bumps version and keeps the parent lineage (acceptance #4)', () => {
  const parent = createArtifact(baseInput({ taskId: 'task-1', creatorAgentId: 'agent-1' }));
  const revision = createArtifactRevision(parent, { content: 'Revised body.' });

  assert.notEqual(revision.id, parent.id, 'a revision is a new sibling row');
  assert.equal(revision.projectId, parent.projectId, 'Project linkage is preserved');
  assert.equal(revision.taskId, parent.taskId);
  assert.equal(revision.creatorAgentId, parent.creatorAgentId);
  assert.equal(revision.type, parent.type, 'type carries over unless overridden');
  assert.equal(revision.title, parent.title, 'title carries over unless overridden');
  assert.equal(revision.version, 2, 'version bumps by one');
  assert.equal(
    (revision.metadata as { sourceArtifactId?: string }).sourceArtifactId,
    parent.id,
    'lineage records the parent artifact id',
  );
});

test('createArtifactRevision overrides title/type while recording the parent id', () => {
  const parent = createArtifact(baseInput({ type: 'note', metadata: { keep: true } }));
  const revision = createArtifactRevision(parent, {
    title: 'Renamed',
    type: 'report',
    content: 'New body.',
  });

  assert.equal(revision.title, 'Renamed');
  assert.equal(revision.type, 'report');
  assert.equal(revision.version, 2);
  assert.deepEqual(revision.metadata, {
    keep: true,
    sourceArtifactId: parent.id,
  }, 'parent metadata is carried and lineage added');
});

test('validators reject non-conforming values', () => {
  assert.equal(validateArtifactType('map'), 'map');
  assert.equal(validateArtifactTitle('Map'), 'Map');
  assert.equal(validateArtifactContent('body'), 'body');
  assert.equal(validateArtifactVersion(3), 3);

  assert.throws(() => validateArtifactType(''), ArtifactValidationError);
  assert.throws(() => validateArtifactTitle(7 as never), ArtifactValidationError);
  assert.throws(() => validateArtifactContent(42 as never), ArtifactValidationError);
  assert.throws(() => validateArtifactVersion(0), ArtifactValidationError);
  assert.throws(() => validateArtifactVersion(1.5), ArtifactValidationError);
});
