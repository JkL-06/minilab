import assert from 'node:assert/strict';
import test from 'node:test';

import { LabValidationError } from '../../src/domain/errors';
import { applyLabUpdate, createLab } from '../../src/domain/lab';

test('createLab returns an immutable ID, normalized fields, and UTC timestamps', () => {
  const lab = createLab({ ownerUserId: 'user-1', name: '  Neuro Lab  ', description: 'Cognition' });

  assert.ok(lab.id.length > 0, 'id should be generated');
  assert.equal(lab.ownerUserId, 'user-1');
  assert.equal(lab.name, 'Neuro Lab', 'name should be trimmed');
  assert.equal(lab.description, 'Cognition');
  assert.match(lab.createdAt, /Z$/, 'createdAt should be UTC ISO-8601');
  assert.match(lab.updatedAt, /Z$/, 'updatedAt should be UTC ISO-8601');
  assert.ok(!Number.isNaN(Date.parse(lab.createdAt)));
  assert.ok(!Number.isNaN(Date.parse(lab.updatedAt)));
});

test('createLab defaults description to null', () => {
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  assert.equal(lab.description, null);
});

test('createLab rejects an empty or non-string name', () => {
  for (const bad of ['', '   ', null, undefined, 42, {}]) {
    assert.throws(
      () => createLab({ ownerUserId: 'user-1', name: bad as never }),
      LabValidationError,
      `expected name=${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test('applyLabUpdate changes only the supplied fields and bumps updatedAt', () => {
  const lab = createLab({ ownerUserId: 'user-1', name: 'Old Lab' });
  const before = lab.updatedAt;

  const updated = applyLabUpdate(lab, { name: 'New Lab' });

  assert.equal(updated.id, lab.id, 'id must stay immutable');
  assert.equal(updated.ownerUserId, lab.ownerUserId);
  assert.equal(updated.name, 'New Lab');
  assert.equal(updated.description, lab.description, 'description untouched');
  assert.ok(
    Date.parse(updated.updatedAt) >= Date.parse(before),
    'updatedAt should not go backwards',
  );
});

test('applyLabUpdate clears description when set to null', () => {
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab', description: 'old' });
  const updated = applyLabUpdate(lab, { description: null });
  assert.equal(updated.description, null);
});

test('applyLabUpdate rejects an empty name', () => {
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  assert.throws(() => applyLabUpdate(lab, { name: '   ' }), LabValidationError);
});
