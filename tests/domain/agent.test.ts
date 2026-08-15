import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentValidationError } from '../../src/domain/errors';
import { applyAgentUpdate, createAgent } from '../../src/domain/agent';

test('createAgent returns a persistent ID, defaults, and UTC timestamps', () => {
  const agent = createAgent({ labId: 'lab-1', name: '  Alice  ', specialization: 'memory' });

  assert.ok(agent.id.length > 0, 'id should be generated');
  assert.equal(agent.labId, 'lab-1');
  assert.equal(agent.name, 'Alice', 'name should be trimmed');
  assert.equal(agent.role, 'researcher', 'role defaults to researcher');
  assert.equal(agent.specialization, 'memory');
  assert.equal(agent.profile, null);
  assert.equal(agent.status, 'active', 'status defaults to active');
  assert.equal(agent.modelConfigId, null);
  assert.match(agent.createdAt, /Z$/, 'createdAt should be UTC ISO-8601');
  assert.match(agent.updatedAt, /Z$/);
});

test('createAgent accepts an explicit role, status, profile, and model reference', () => {
  const agent = createAgent({
    labId: 'lab-1',
    name: 'Alice',
    role: 'phd_researcher',
    profile: 'Focuses on experimental design',
    status: 'inactive',
    modelConfigId: 'mc-42',
  });

  assert.equal(agent.role, 'phd_researcher');
  assert.equal(agent.profile, 'Focuses on experimental design');
  assert.equal(agent.status, 'inactive');
  assert.equal(agent.modelConfigId, 'mc-42');
});

test('createAgent rejects an empty or non-string name', () => {
  for (const bad of ['', '   ', null, undefined, 42]) {
    assert.throws(
      () => createAgent({ labId: 'lab-1', name: bad as never }),
      AgentValidationError,
      `expected name=${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test('createAgent rejects an empty role and an invalid status', () => {
  assert.throws(() => createAgent({ labId: 'lab-1', name: 'Alice', role: '  ' }), AgentValidationError);
  assert.throws(
    () => createAgent({ labId: 'lab-1', name: 'Alice', status: 'retired' as never }),
    AgentValidationError,
  );
});

test('createAgent rejects a provider secret-shaped modelConfigId', () => {
  assert.throws(
    () => createAgent({ labId: 'lab-1', name: 'Alice', modelConfigId: '' }),
    AgentValidationError,
  );
  assert.throws(
    () => createAgent({ labId: 'lab-1', name: 'Alice', modelConfigId: 123 as never }),
    AgentValidationError,
  );
});

test('applyAgentUpdate changes only supplied fields and bumps updatedAt', () => {
  const agent = createAgent({ labId: 'lab-1', name: 'Alice' });
  const before = agent.updatedAt;

  const updated = applyAgentUpdate(agent, { name: 'Alice B', role: 'methodologist' });

  assert.equal(updated.id, agent.id, 'id must stay immutable');
  assert.equal(updated.labId, agent.labId, 'labId must stay immutable');
  assert.equal(updated.name, 'Alice B');
  assert.equal(updated.role, 'methodologist');
  assert.equal(updated.specialization, null, 'unsupplied fields untouched');
  assert.ok(Date.parse(updated.updatedAt) >= Date.parse(before), 'updatedAt should not go backwards');
});

test('applyAgentUpdate deactivates without deleting the record (SPEC-002 #6)', () => {
  const agent = createAgent({ labId: 'lab-1', name: 'Alice' });

  const deactivated = applyAgentUpdate(agent, { status: 'inactive' });

  assert.equal(deactivated.status, 'inactive');
  assert.equal(deactivated.id, agent.id, 'record is retained');
  assert.equal(deactivated.labId, agent.labId);
});

test('applyAgentUpdate clears specialization and modelConfigId when set to null', () => {
  const agent = createAgent({ labId: 'lab-1', name: 'Alice', specialization: 'x', modelConfigId: 'mc' });

  const updated = applyAgentUpdate(agent, { specialization: null, modelConfigId: null });

  assert.equal(updated.specialization, null);
  assert.equal(updated.modelConfigId, null);
});

test('applyAgentUpdate rejects an empty name and an invalid status', () => {
  const agent = createAgent({ labId: 'lab-1', name: 'Alice' });

  assert.throws(() => applyAgentUpdate(agent, { name: '   ' }), AgentValidationError);
  assert.throws(() => applyAgentUpdate(agent, { status: 'paused' }), AgentValidationError);
});
