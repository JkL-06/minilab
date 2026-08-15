import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentService } from '../../src/application/agentService';
import { AgentNotFoundError, LabForbiddenError, LabNotFoundError } from '../../src/domain/errors';
import { createLab } from '../../src/domain/lab';
import { inMemoryAgentRepository } from '../support/inMemoryAgentRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';

function makeService() {
  const labs = inMemoryLabRepository();
  const agents = inMemoryAgentRepository();
  const service = new AgentService(agents, labs);
  return { service, labs, agents };
}

test('createAgent hires an agent into a lab the user owns', () => {
  const { service, labs, agents } = makeService();
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);

  const agent = service.createAgent('user-1', lab.id, { name: 'Alice' });

  assert.equal(agent.labId, lab.id, 'agent belongs to exactly one lab (invariant #1)');
  assert.equal(agents.agents.length, 1);
  assert.equal(agents.agents[0].id, agent.id);
});

test('createAgent forbids a non-owner and rejects an unknown lab', () => {
  const { service, labs } = makeService();
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);

  assert.throws(() => service.createAgent('user-2', lab.id, { name: 'Alice' }), LabForbiddenError);
  assert.throws(() => service.createAgent('user-1', 'no-such-lab', { name: 'Alice' }), LabNotFoundError);
});

test('listAgents returns only the agents of the given (owned) lab', () => {
  const { service, labs } = makeService();
  const lab1 = createLab({ ownerUserId: 'user-1', name: 'Lab 1' });
  const lab2 = createLab({ ownerUserId: 'user-1', name: 'Lab 2' });
  labs.insert(lab1);
  labs.insert(lab2);

  const alice = service.createAgent('user-1', lab1.id, { name: 'Alice' });
  service.createAgent('user-1', lab1.id, { name: 'Bob' });
  service.createAgent('user-1', lab2.id, { name: 'Carol' });

  const inLab1 = service.listAgents('user-1', lab1.id);
  assert.deepEqual(
    inLab1.map((a) => a.name).sort(),
    ['Alice', 'Bob'],
  );
  assert.ok(inLab1.some((a) => a.id === alice.id));
});

test('listAgents forbids a non-owner of the lab', () => {
  const { service, labs } = makeService();
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);

  assert.throws(() => service.listAgents('user-2', lab.id), LabForbiddenError);
});

test('getAgent returns an agent when the requester owns its lab', () => {
  const { service, labs } = makeService();
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);
  const alice = service.createAgent('user-1', lab.id, { name: 'Alice' });

  assert.equal(service.getAgent('user-1', alice.id).id, alice.id);
});

test('getAgent rejects cross-lab access (SPEC-002 #4)', () => {
  const { service, labs } = makeService();
  const myLab = createLab({ ownerUserId: 'user-1', name: 'Mine' });
  const theirLab = createLab({ ownerUserId: 'user-2', name: 'Theirs' });
  labs.insert(myLab);
  labs.insert(theirLab);

  const theirAlice = service.createAgent('user-2', theirLab.id, { name: 'Alice' });

  // user-1 owns a different lab, not the agent's lab.
  assert.throws(() => service.getAgent('user-1', theirAlice.id), LabForbiddenError);
});

test('getAgent throws AgentNotFoundError for an unknown id', () => {
  const { service } = makeService();
  assert.throws(() => service.getAgent('user-1', 'no-such-agent'), AgentNotFoundError);
});

test('updateAgent lets the owner rename and deactivate an agent (SPEC-002 #6)', () => {
  const { service, labs, agents } = makeService();
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);
  const alice = service.createAgent('user-1', lab.id, { name: 'Alice' });

  const updated = service.updateAgent('user-1', alice.id, { status: 'inactive' });

  assert.equal(updated.status, 'inactive');
  // Record is retained — still retrievable, still one agent in the lab.
  assert.equal(service.getAgent('user-1', alice.id).status, 'inactive');
  assert.equal(agents.agents.length, 1, 'deactivation must not delete the record');
});

test('updateAgent forbids a non-owner of the agent’s lab', () => {
  const { service, labs } = makeService();
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);
  const alice = service.createAgent('user-1', lab.id, { name: 'Alice' });

  assert.throws(() => service.updateAgent('user-2', alice.id, { name: 'X' }), LabForbiddenError);
});

test('updateAgent throws AgentNotFoundError for an unknown id', () => {
  const { service } = makeService();
  assert.throws(() => service.updateAgent('user-1', 'no-such-agent', { name: 'X' }), AgentNotFoundError);
});
