import assert from 'node:assert/strict';
import test from 'node:test';

import { LabService } from '../../src/application/labService';
import { LabForbiddenError, LabNotFoundError, LabValidationError } from '../../src/domain/errors';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';

function service(): LabService {
  return new LabService(inMemoryLabRepository());
}

test('createLab persists the lab under the owner', () => {
  const repo = inMemoryLabRepository();
  const svc = new LabService(repo);

  const lab = svc.createLab('user-1', 'Cognitive Lab');

  assert.equal(lab.ownerUserId, 'user-1');
  assert.equal(repo.labs.length, 1);
  assert.equal(repo.labs[0].id, lab.id);
});

test('getLab returns the lab for its owner', () => {
  const svc = service();
  const lab = svc.createLab('user-1', 'Cognitive Lab');

  assert.equal(svc.getLab('user-1', lab.id).id, lab.id);
});

test('getLab forbids a different user (ownership enforcement)', () => {
  const svc = service();
  const lab = svc.createLab('user-1', 'Cognitive Lab');

  assert.throws(() => svc.getLab('user-2', lab.id), LabForbiddenError);
});

test('getLab throws LabNotFoundError for an unknown id', () => {
  const svc = service();
  assert.throws(() => svc.getLab('user-1', 'missing-id'), LabNotFoundError);
});

test('listLabs returns only the requester-owned labs', () => {
  const svc = service();
  svc.createLab('user-1', 'Lab A');
  svc.createLab('user-2', 'Lab B');
  svc.createLab('user-1', 'Lab C');

  const mine = svc.listLabs('user-1').map((lab) => lab.name).sort();

  assert.deepEqual(mine, ['Lab A', 'Lab C']);
});

test('updateLab updates name and description for the owner', () => {
  const svc = service();
  const lab = svc.createLab('user-1', 'Lab A');

  const updated = svc.updateLab('user-1', lab.id, { name: 'Lab Z', description: 'renewed' });

  assert.equal(updated.name, 'Lab Z');
  assert.equal(updated.description, 'renewed');
  assert.equal(svc.getLab('user-1', lab.id).name, 'Lab Z');
});

test('updateLab forbids a different user', () => {
  const svc = service();
  const lab = svc.createLab('user-1', 'Lab A');

  assert.throws(() => svc.updateLab('user-2', lab.id, { name: 'X' }), LabForbiddenError);
});

test('updateLab throws LabNotFoundError for an unknown id', () => {
  const svc = service();
  assert.throws(() => svc.updateLab('user-1', 'missing-id', { name: 'X' }), LabNotFoundError);
});

test('updateLab rejects an empty name', () => {
  const svc = service();
  const lab = svc.createLab('user-1', 'Lab A');

  assert.throws(() => svc.updateLab('user-1', lab.id, { name: '   ' }), LabValidationError);
});
