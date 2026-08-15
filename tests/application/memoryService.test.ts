import assert from 'node:assert/strict';
import test from 'node:test';

import type { MemorySearchStrategy } from '../../src/application/memorySearch';
import { KeywordMemorySearch } from '../../src/application/memorySearch';
import { MemoryService } from '../../src/application/memoryService';
import {
  LabForbiddenError,
  LabNotFoundError,
  MemoryValidationError,
} from '../../src/domain/errors';
import { createAgent } from '../../src/domain/agent';
import { createLab } from '../../src/domain/lab';
import { createProject } from '../../src/domain/project';
import { inMemoryAgentRepository } from '../support/inMemoryAgentRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryMemoryRepository } from '../support/inMemoryMemoryRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';

/** Builds a MemoryService over in-memory repos plus a populated Lab world. */
function makeWorld(search: MemorySearchStrategy = new KeywordMemorySearch()) {
  const labs = inMemoryLabRepository();
  const agents = inMemoryAgentRepository();
  const projects = inMemoryProjectRepository();
  const memories = inMemoryMemoryRepository();
  const service = new MemoryService(memories, labs, agents, projects, search);
  const lab = createLab({ ownerUserId: 'user-1', name: 'Lab' });
  labs.insert(lab);
  const alice = createAgent({ labId: lab.id, name: 'Alice' });
  const bob = createAgent({ labId: lab.id, name: 'Bob' });
  agents.insert(alice);
  agents.insert(bob);
  const project1 = createProject({ labId: lab.id, title: 'Survey' });
  const project2 = createProject({ labId: lab.id, title: 'Write-up' });
  projects.insert(project1);
  projects.insert(project2);
  return { service, labs, agents, projects, memories, lab, alice, bob, project1, project2 };
}

test('writeMemory records full provenance with a server-set PI author (rule 17)', () => {
  const { service, lab, alice, memories } = makeWorld();

  const memory = service.writeMemory('user-1', lab.id, {
    scope: 'agent',
    scopeId: alice.id,
    content: 'Alice prefers structured survey notes.',
    sourceType: 'interview',
    sourceId: 'interview-2026-08',
  });

  assert.equal(memory.authorType, 'pi', 'author is never client-supplied');
  assert.equal(memory.authorId, 'user-1', 'author is the requesting PI');
  assert.equal(memory.sourceType, 'interview');
  assert.equal(memory.sourceId, 'interview-2026-08');
  assert.equal(memory.scope, 'agent');
  assert.equal(memory.scopeId, alice.id);
  assert.equal(memories.memories.length, 1, 'canonical row persisted');
});

test('writeMemory forbids a non-owner and rejects an unknown lab', () => {
  const { service, lab, alice } = makeWorld();

  assert.throws(
    () =>
      service.writeMemory('user-2', lab.id, {
        scope: 'agent',
        scopeId: alice.id,
        content: 'x',
        sourceType: 'note',
        sourceId: 's1',
      }),
    LabForbiddenError,
  );
  assert.throws(
    () =>
      service.writeMemory('user-1', 'no-such-lab', {
        scope: 'lab',
        content: 'x',
        sourceType: 'note',
        sourceId: 's1',
      }),
    LabNotFoundError,
  );
});

test('writeMemory requires the agent/project target to live in the same Lab', () => {
  const { service, lab, alice, project1, labs, agents, projects } = makeWorld();
  const otherLab = createLab({ ownerUserId: 'user-1', name: 'Other' });
  labs.insert(otherLab);
  const foreignAgent = createAgent({ labId: otherLab.id, name: 'Foreign' });
  agents.insert(foreignAgent);
  const foreignProject = createProject({ labId: otherLab.id, title: 'Foreign' });
  projects.insert(foreignProject);

  assert.throws(
    () =>
      service.writeMemory('user-1', lab.id, {
        scope: 'agent',
        scopeId: 'no-such-agent',
        content: 'x',
        sourceType: 'note',
        sourceId: 's1',
      }),
    MemoryValidationError,
    'agent scope must reference a real Agent',
  );
  assert.throws(
    () =>
      service.writeMemory('user-1', lab.id, {
        scope: 'agent',
        scopeId: foreignAgent.id,
        content: 'x',
        sourceType: 'note',
        sourceId: 's1',
      }),
    MemoryValidationError,
    'cross-Lab agent references are rejected',
  );
  assert.throws(
    () =>
      service.writeMemory('user-1', lab.id, {
        scope: 'project',
        scopeId: 'no-such-project',
        content: 'x',
        sourceType: 'note',
        sourceId: 's1',
      }),
    MemoryValidationError,
    'project scope must reference a real Project',
  );
  assert.throws(
    () =>
      service.writeMemory('user-1', lab.id, {
        scope: 'project',
        scopeId: foreignProject.id,
        content: 'x',
        sourceType: 'note',
        sourceId: 's1',
      }),
    MemoryValidationError,
    'cross-Lab project references are rejected',
  );

  // Valid same-Lab references pass.
  assert.doesNotThrow(() =>
    service.writeMemory('user-1', lab.id, {
      scope: 'agent',
      scopeId: alice.id,
      content: 'x',
      sourceType: 'note',
      sourceId: 's1',
    }),
  );
  assert.doesNotThrow(() =>
    service.writeMemory('user-1', lab.id, {
      scope: 'project',
      scopeId: project1.id,
      content: 'x',
      sourceType: 'note',
      sourceId: 's1',
    }),
  );
});

test('writeMemory rejects a lab-scoped memory carrying a scopeId', () => {
  const { service, lab } = makeWorld();

  assert.throws(
    () =>
      service.writeMemory('user-1', lab.id, {
        scope: 'lab',
        scopeId: 'team-1',
        content: 'x',
        sourceType: 'note',
        sourceId: 's1',
      }),
    MemoryValidationError,
  );
});

test('listMemory returns only the Lab’s memories, newest first, with scope filtering', () => {
  const { service, lab, alice } = makeWorld();

  service.writeMemory('user-1', lab.id, {
    scope: 'lab',
    content: 'Lab goal: accelerate evidence synthesis.',
    sourceType: 'note',
    sourceId: 'kickoff',
  });
  service.writeMemory('user-1', lab.id, {
    scope: 'agent',
    scopeId: alice.id,
    content: 'Alice likes tables.',
    sourceType: 'note',
    sourceId: 'kickoff',
  });
  service.writeMemory('user-1', lab.id, {
    scope: 'team',
    scopeId: 'team-1',
    content: 'Team prefers async updates.',
    sourceType: 'note',
    sourceId: 'kickoff',
  });

  const all = service.listMemory('user-1', lab.id);
  assert.equal(all.length, 3);

  const agentOnly = service.listMemory('user-1', lab.id, { scope: 'agent' });
  assert.equal(agentOnly.length, 1);
  assert.equal(agentOnly[0].scopeId, alice.id);

  assert.ok(
    all[0].createdAt >= all[1].createdAt && all[1].createdAt >= all[2].createdAt,
    'newest first',
  );
});

test('listMemory forbids a non-owner', () => {
  const { service, lab } = makeWorld();
  assert.throws(() => service.listMemory('user-2', lab.id), LabForbiddenError);
});

test('acceptance #1/#2: an Agent retrieves its own memory, not another Agent’s private memory', () => {
  const { service, lab, alice, bob, project1 } = makeWorld();

  service.writeMemory('user-1', lab.id, {
    scope: 'agent',
    scopeId: alice.id,
    content: 'Alice: private hypothesis about survey A.',
    sourceType: 'note',
    sourceId: 's1',
  });
  service.writeMemory('user-1', lab.id, {
    scope: 'agent',
    scopeId: bob.id,
    content: 'Bob: private preference for statistics.',
    sourceType: 'note',
    sourceId: 's2',
  });
  service.writeMemory('user-1', lab.id, {
    scope: 'project',
    scopeId: project1.id,
    content: 'Project survey shared context.',
    sourceType: 'note',
    sourceId: 's3',
  });
  service.writeMemory('user-1', lab.id, {
    scope: 'lab',
    content: 'Lab-wide policy: cite sources.',
    sourceType: 'note',
    sourceId: 's4',
  });

  const forAlice = service.retrieveAuthorizedMemory({ labId: lab.id, agentId: alice.id, projectId: project1.id });
  const forBob = service.retrieveAuthorizedMemory({ labId: lab.id, agentId: bob.id, projectId: project1.id });

  assert.ok(
    forAlice.some((m) => m.content.includes('Alice: private hypothesis')),
    'Alice retrieves her own agent-scoped memory',
  );
  assert.ok(
    forAlice.some((m) => m.content.includes('Project survey shared context')),
    'Alice retrieves the current project’s memory',
  );
  assert.ok(
    forAlice.some((m) => m.content.includes('Lab-wide policy')),
    'Alice retrieves lab-shared memory',
  );
  assert.ok(
    !forAlice.some((m) => m.content.includes('Bob: private preference')),
    'Alice cannot see Bob’s private memory (acceptance #2)',
  );
  assert.ok(
    !forBob.some((m) => m.content.includes('Alice: private hypothesis')),
    'Bob cannot see Alice’s private memory (acceptance #2)',
  );
});

test('acceptance #3: project memory is retrievable in later project tasks, scoped to that project', () => {
  const { service, lab, alice, project1, project2 } = makeWorld();

  service.writeMemory('user-1', lab.id, {
    scope: 'project',
    scopeId: project1.id,
    content: 'This survey targets working memory.',
    sourceType: 'note',
    sourceId: 's1',
  });

  const inProject1 = service.retrieveAuthorizedMemory({ labId: lab.id, agentId: alice.id, projectId: project1.id });
  const inProject2 = service.retrieveAuthorizedMemory({ labId: lab.id, agentId: alice.id, projectId: project2.id });

  assert.ok(inProject1.some((m) => m.content.includes('working memory')));
  assert.ok(
    !inProject2.some((m) => m.content.includes('working memory')),
    'a different project task does not see this project’s memory',
  );
});

test('retrieveAuthorizedMemory retains provenance on every item (rule 17)', () => {
  const { service, lab, alice, project1 } = makeWorld();

  service.writeMemory('user-1', lab.id, {
    scope: 'project',
    scopeId: project1.id,
    content: 'Context.',
    sourceType: 'experiment',
    sourceId: 'exp-42',
    memoryType: 'hypothesis',
  });

  const [memory] = service.retrieveAuthorizedMemory({ labId: lab.id, agentId: alice.id, projectId: project1.id });
  assert.equal(memory.scope, 'project');
  assert.equal(memory.sourceType, 'experiment');
  assert.equal(memory.sourceId, 'exp-42');
  assert.equal(memory.authorType, 'pi');
  assert.equal(memory.authorId, 'user-1');
  assert.ok(memory.createdAt);
  assert.ok(memory.content);
  assert.ok(memory.id);
});

test('searchMemory ranks by relevance then importance', () => {
  const { service, lab, alice } = makeWorld();

  service.writeMemory('user-1', lab.id, {
    scope: 'agent',
    scopeId: alice.id,
    content: 'Prefers structured survey notes.',
    sourceType: 'interview',
    sourceId: 's1',
    importance: 2,
  });
  service.writeMemory('user-1', lab.id, {
    scope: 'agent',
    scopeId: alice.id,
    content: 'The survey must include statistics.',
    sourceType: 'interview',
    sourceId: 's2',
    importance: 5,
  });

  const result = service.searchMemory('user-1', lab.id, 'survey statistics');

  assert.equal(result.fallback, false);
  assert.equal(result.query, 'survey statistics');
  assert.equal(result.memories.length, 2, 'both match at least one query term');
  assert.equal(
    result.memories[0].content,
    'The survey must include statistics.',
    'more relevant (more shared terms) ranks first',
  );

  const noMatch = service.searchMemory('user-1', lab.id, 'quantum tunneling');
  assert.deepEqual(noMatch.memories, [], 'zero shared terms scores zero');
});

test('acceptance #6: a failed semantic index falls back and never erases canonical memory', () => {
  class ExplodingSearch implements MemorySearchStrategy {
    search(): never {
      throw new Error('index unavailable');
    }
  }
  const { service, memories, lab, alice } = makeWorld(new ExplodingSearch());

  const written = service.writeMemory('user-1', lab.id, {
    scope: 'agent',
    scopeId: alice.id,
    content: 'Canonical memory that must survive an index failure.',
    sourceType: 'note',
    sourceId: 's1',
  });

  const result = service.searchMemory('user-1', lab.id, 'index failure');
  assert.equal(result.fallback, true, 'degraded index signals the fallback');
  assert.ok(
    result.memories.some((m) => m.id === written.id),
    'fallback returns the canonical rows',
  );

  const after = service.listMemory('user-1', lab.id);
  assert.ok(
    after.some((m) => m.id === written.id),
    'the canonical row is untouched by the failed search (acceptance #6)',
  );
  assert.equal(memories.memories.length, 1, 'nothing was erased');
});
