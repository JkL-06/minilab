import assert from 'node:assert/strict';
import test from 'node:test';

import { ProjectService } from '../../src/application/projectService';
import {
  LabForbiddenError,
  LabNotFoundError,
  ProjectNotFoundError,
  ProjectValidationError,
} from '../../src/domain/errors';
import { createLab } from '../../src/domain/lab';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';

function makeService() {
  const labs = inMemoryLabRepository();
  const projects = inMemoryProjectRepository();
  const service = new ProjectService(projects, labs);
  return { service, labs, projects };
}

test('createProject creates a project in a lab the user owns', () => {
  const { service, labs, projects } = makeService();
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);

  const project = service.createProject('user-1', lab.id, { title: 'Survey' });

  assert.equal(project.labId, lab.id, 'project belongs to exactly one lab');
  assert.equal(projects.projects.length, 1);
  assert.equal(projects.projects[0].id, project.id);
});

test('createProject forbids a non-owner and rejects an unknown lab', () => {
  const { service, labs } = makeService();
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);

  assert.throws(
    () => service.createProject('user-2', lab.id, { title: 'X' }),
    LabForbiddenError,
  );
  assert.throws(
    () => service.createProject('user-1', 'no-such-lab', { title: 'X' }),
    LabNotFoundError,
  );
});

test('createProject rejects an unsupported research stage (SPEC-003 #2)', () => {
  const { service, labs } = makeService();
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);

  assert.throws(
    () => service.createProject('user-1', lab.id, { title: 'X', stage: 'draft' as never }),
    ProjectValidationError,
  );
});

test('listProjects returns only the projects of the given (owned) lab', () => {
  const { service, labs } = makeService();
  const lab1 = createLab({ ownerUserId: 'user-1', name: 'Lab 1' });
  const lab2 = createLab({ ownerUserId: 'user-1', name: 'Lab 2' });
  labs.insert(lab1);
  labs.insert(lab2);

  const survey = service.createProject('user-1', lab1.id, { title: 'Survey' });
  service.createProject('user-1', lab1.id, { title: 'Write-up' });
  service.createProject('user-1', lab2.id, { title: 'Other' });

  const inLab1 = service.listProjects('user-1', lab1.id);
  assert.deepEqual(
    inLab1.map((p) => p.title).sort(),
    ['Survey', 'Write-up'],
  );
  assert.ok(inLab1.some((p) => p.id === survey.id));
});

test('listProjects forbids a non-owner of the lab', () => {
  const { service, labs } = makeService();
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);

  assert.throws(() => service.listProjects('user-2', lab.id), LabForbiddenError);
});

test('getProject returns a project when the requester owns its lab', () => {
  const { service, labs } = makeService();
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);
  const project = service.createProject('user-1', lab.id, { title: 'Survey' });

  assert.equal(service.getProject('user-1', project.id).id, project.id);
});

test('getProject rejects cross-lab access (SPEC-003 #3)', () => {
  const { service, labs } = makeService();
  const myLab = createLab({ ownerUserId: 'user-1', name: 'Mine' });
  const theirLab = createLab({ ownerUserId: 'user-2', name: 'Theirs' });
  labs.insert(myLab);
  labs.insert(theirLab);

  const theirProject = service.createProject('user-2', theirLab.id, { title: 'Theirs' });

  assert.throws(() => service.getProject('user-1', theirProject.id), LabForbiddenError);
});

test('getProject throws ProjectNotFoundError for an unknown id', () => {
  const { service } = makeService();
  assert.throws(() => service.getProject('user-1', 'no-such-project'), ProjectNotFoundError);
});

test('updateProject records an objective change with an update timestamp (SPEC-003 #4)', () => {
  const { service, labs, projects } = makeService();
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);
  const project = service.createProject('user-1', lab.id, { title: 'Survey' });
  const before = project.updatedAt;

  const updated = service.updateProject('user-1', project.id, {
    objective: 'Focus on working memory.',
    stage: 'validate',
    status: 'active',
  });

  assert.equal(updated.objective, 'Focus on working memory.');
  assert.equal(updated.stage, 'validate');
  assert.equal(updated.status, 'active');
  assert.equal(updated.title, 'Survey', 'unsupplied fields are untouched');
  assert.ok(
    Date.parse(updated.updatedAt) >= Date.parse(before),
    'the objective change is recorded with a fresh (non-decreasing) update timestamp',
  );
  assert.equal(projects.projects[0].updatedAt, updated.updatedAt, 'timestamp persisted');
});

test('updateProject forbids a non-owner and throws for an unknown id', () => {
  const { service, labs } = makeService();
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);
  const project = service.createProject('user-1', lab.id, { title: 'Survey' });

  assert.throws(
    () => service.updateProject('user-2', project.id, { title: 'X' }),
    LabForbiddenError,
  );
  assert.throws(
    () => service.updateProject('user-1', 'no-such-project', { title: 'X' }),
    ProjectNotFoundError,
  );
});
