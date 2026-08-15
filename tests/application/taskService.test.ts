import assert from 'node:assert/strict';
import test from 'node:test';

import { TaskService } from '../../src/application/taskService';
import {
  AgentNotFoundError,
  LabForbiddenError,
  ProjectNotFoundError,
  TaskForbiddenError,
  TaskNotFoundError,
  TaskValidationError,
} from '../../src/domain/errors';
import { createAgent } from '../../src/domain/agent';
import { createLab } from '../../src/domain/lab';
import { createProject } from '../../src/domain/project';
import { inMemoryAgentRepository } from '../support/inMemoryAgentRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';
import { inMemoryTaskRepository } from '../support/inMemoryTaskRepository';

function makeService() {
  const labs = inMemoryLabRepository();
  const agents = inMemoryAgentRepository();
  const projects = inMemoryProjectRepository();
  const tasks = inMemoryTaskRepository();
  const service = new TaskService(tasks, projects, agents, labs);
  return { service, labs, agents, projects, tasks };
}

function world(userId = 'user-1') {
  const { service, labs, agents, projects, tasks } = makeService();
  const lab = createLab({ ownerUserId: userId, name: 'Lab' });
  labs.insert(lab);
  const alice = createAgent({ labId: lab.id, name: 'Alice' });
  agents.insert(alice);
  const project = createProject({ labId: lab.id, title: 'Survey' });
  projects.insert(project);
  return { service, labs, lab, alice, project, agents, tasks };
}

test('createTask assigns a task to an agent in the same lab (SPEC-004 #1)', () => {
  const { service, alice, project, tasks } = world();

  const task = service.createTask('user-1', project.id, {
    title: 'Map the evidence base.',
    assigneeAgentId: alice.id,
  });

  assert.equal(task.projectId, project.id, 'task belongs to exactly one project');
  assert.equal(task.assigneeAgentId, alice.id, 'assigned to Alice');
  assert.equal(task.creatorType, 'pi');
  assert.equal(task.creatorId, 'user-1', 'creator provenance is server-set');
  assert.equal(task.status, 'backlog');
  assert.equal(tasks.tasks.length, 1);
});

test('createTask rejects an assignee from a different lab (SPEC-004 #3)', () => {
  const { service, labs, agents, project } = world();
  const otherLab = createLab({ ownerUserId: 'user-2', name: 'Other Lab' });
  labs.insert(otherLab);
  const mallory = createAgent({ labId: otherLab.id, name: 'Mallory' });
  agents.insert(mallory);

  assert.throws(
    () =>
      service.createTask('user-1', project.id, {
        title: 'X',
        assigneeAgentId: mallory.id,
      }),
    TaskForbiddenError,
  );
});

test('createTask rejects an unknown assignee, unknown project, and non-owner', () => {
  const { service, alice, project } = world();

  assert.throws(
    () =>
      service.createTask('user-1', project.id, {
        title: 'X',
        assigneeAgentId: 'no-such-agent',
      }),
    AgentNotFoundError,
  );

  assert.throws(
    () =>
      service.createTask('user-1', 'no-such-project', {
        title: 'X',
        assigneeAgentId: alice.id,
      }),
    ProjectNotFoundError,
  );

  assert.throws(
    () =>
      service.createTask('user-2', project.id, {
        title: 'X',
        assigneeAgentId: alice.id,
      }),
    LabForbiddenError,
  );
});

test('listTasks returns only the tasks of the given (owned) project', () => {
  const { service, alice, project, tasks } = world();
  const a = service.createTask('user-1', project.id, {
    title: 'First',
    assigneeAgentId: alice.id,
  });
  service.createTask('user-1', project.id, { title: 'Second', assigneeAgentId: alice.id });

  const listed = service.listTasks('user-1', project.id);
  assert.deepEqual(
    listed.map((t) => t.title).sort(),
    ['First', 'Second'],
  );
  assert.ok(listed.some((t) => t.id === a.id));
  assert.equal(tasks.tasks.length, 2);
});

test('listTasks forbids a non-owner of the project’s lab', () => {
  const { service, project } = world();
  assert.throws(() => service.listTasks('user-2', project.id), LabForbiddenError);
});

test('getTask returns a task for its project’s owner and rejects cross-lab access', () => {
  const { service, alice, project } = world();
  const task = service.createTask('user-1', project.id, {
    title: 'X',
    assigneeAgentId: alice.id,
  });

  assert.equal(service.getTask('user-1', task.id).id, task.id);
  assert.throws(() => service.getTask('user-2', task.id), LabForbiddenError);
  assert.throws(() => service.getTask('user-1', 'no-such-task'), TaskNotFoundError);
});

test('updateTask applies a valid status chain and rejects invalid transitions (SPEC-004 #4)', () => {
  const { service, alice, project, tasks } = world();
  const task = service.createTask('user-1', project.id, {
    title: 'X',
    assigneeAgentId: alice.id,
  });

  const ready = service.updateTask('user-1', task.id, { status: 'ready' });
  assert.equal(ready.status, 'ready');
  const running = service.updateTask('user-1', task.id, { status: 'running' });
  assert.equal(running.status, 'running');
  const review = service.updateTask('user-1', task.id, { status: 'review' });
  assert.equal(review.status, 'review');
  const completed = service.updateTask('user-1', task.id, { status: 'completed' });
  assert.equal(completed.status, 'completed');

  // Terminal: completed cannot move again.
  assert.throws(
    () => service.updateTask('user-1', task.id, { status: 'running' }),
    TaskValidationError,
  );

  // A fresh task cannot jump straight to running.
  const fresh = service.createTask('user-1', project.id, {
    title: 'Y',
    assigneeAgentId: alice.id,
  });
  assert.throws(
    () => service.updateTask('user-1', fresh.id, { status: 'completed' }),
    TaskValidationError,
  );
  assert.equal(tasks.tasks.length, 2, 'no records are harmed by rejected transitions');
});

test('completing a task does not delete its prior history (SPEC-004 #5)', () => {
  const { service, alice, project, tasks } = world();
  const task = service.createTask('user-1', project.id, {
    title: 'Map the evidence base.',
    description: 'initial notes',
    assigneeAgentId: alice.id,
  });

  // Walk a valid chain to completion.
  service.updateTask('user-1', task.id, { status: 'ready' });
  service.updateTask('user-1', task.id, { status: 'running' });
  service.updateTask('user-1', task.id, { status: 'review' });
  const completed = service.updateTask('user-1', task.id, { status: 'completed' });
  assert.equal(completed.status, 'completed');

  const stillThere = service.getTask('user-1', task.id);
  assert.equal(stillThere.id, task.id, 'still retrievable by id');
  assert.equal(stillThere.title, 'Map the evidence base.', 'title retained');
  assert.equal(stillThere.assigneeAgentId, alice.id, 'assignment retained');
  assert.equal(stillThere.description, 'initial notes', 'description retained');
  assert.equal(tasks.tasks.length, 1, 'completion never deletes the row');
});

test('updateTask reassigns only within the same lab and updates other fields', () => {
  const { service, labs, agents, alice, project } = world();
  const bob = createAgent({ labId: project.labId, name: 'Bob' });
  agents.insert(bob);
  const task = service.createTask('user-1', project.id, {
    title: 'X',
    assigneeAgentId: alice.id,
  });

  const reassigned = service.updateTask('user-1', task.id, {
    assigneeAgentId: bob.id,
    priority: 'high',
  });
  assert.equal(reassigned.assigneeAgentId, bob.id);
  assert.equal(reassigned.priority, 'high');

  const otherLab = createLab({ ownerUserId: 'user-2', name: 'Other' });
  labs.insert(otherLab);
  const mallory = createAgent({ labId: otherLab.id, name: 'Mallory' });
  agents.insert(mallory);
  assert.throws(
    () => service.updateTask('user-1', task.id, { assigneeAgentId: mallory.id }),
    TaskForbiddenError,
  );
});

test('updateTask forbids a non-owner and an unknown task', () => {
  const { service, alice, project } = world();
  const task = service.createTask('user-1', project.id, {
    title: 'X',
    assigneeAgentId: alice.id,
  });

  assert.throws(() => service.updateTask('user-2', task.id, { title: 'X' }), LabForbiddenError);
  assert.throws(() => service.updateTask('user-1', 'no-such-task', { title: 'X' }), TaskNotFoundError);
});
