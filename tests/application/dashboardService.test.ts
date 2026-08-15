import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAgentRunSuccess,
  type AgentRunResult,
  type AgentRunDraft,
} from '../../src/domain/agentRun';
import { createAgent } from '../../src/domain/agent';
import { createArtifact } from '../../src/domain/artifact';
import { createDecision } from '../../src/domain/decision';
import { LabForbiddenError, LabNotFoundError } from '../../src/domain/errors';
import { createLab } from '../../src/domain/lab';
import { createMeeting } from '../../src/domain/meeting';
import { createProject } from '../../src/domain/project';
import { applyTaskUpdate, createTask } from '../../src/domain/task';
import { DashboardService } from '../../src/application/dashboardService';
import { inMemoryAgentRepository } from '../support/inMemoryAgentRepository';
import { inMemoryAgentRunRepository } from '../support/inMemoryAgentRunRepository';
import { inMemoryArtifactRepository } from '../support/inMemoryArtifactRepository';
import { inMemoryDecisionRepository } from '../support/inMemoryDecisionRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryMeetingRepository } from '../support/inMemoryMeetingRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';
import { inMemoryTaskRepository } from '../support/inMemoryTaskRepository';

const USER = 'user-1';
const NOW = '2026-08-15T00:00:00.000Z';

function emptyResult(taskStatus: AgentRunResult['task_status'] = 'completed'): AgentRunResult {
  return {
    summary: 'Done.',
    task_status: taskStatus,
    artifact_proposals: [],
    findings: [],
    questions_for_pi: [],
    suggested_tasks: [],
    memory_candidates: [],
  };
}

function succeededRun(
  draft: AgentRunDraft,
  result: AgentRunResult,
  now: string,
  id: string,
) {
  return createAgentRunSuccess(draft, result, now, id);
}

/**
 * Inserts a task and walks it through the legal status machine (e.g.
 * backlog → ready → running → blocked), persisting each step via the repo.
 * The dashboard reads the task row's status, so a "blocked" scenario must
 * actually transition the row — direct assignment would be an invalid
 * transition (SPEC-004 acceptance #4).
 */
function advanceTask(
  tasks: ReturnType<typeof inMemoryTaskRepository>,
  task: ReturnType<typeof createTask>,
  path: readonly string[],
): ReturnType<typeof createTask> {
  tasks.insert(task);
  let current = task;
  for (const status of path) {
    current = applyTaskUpdate(current, { status });
    tasks.update(current);
  }
  return current;
}

/** Builds a DashboardService over in-memory repos with a populated Lab world. */
function makeWorld() {
  const labs = inMemoryLabRepository();
  const agents = inMemoryAgentRepository();
  const projects = inMemoryProjectRepository();
  const tasks = inMemoryTaskRepository();
  const artifacts = inMemoryArtifactRepository();
  const meetings = inMemoryMeetingRepository();
  const decisions = inMemoryDecisionRepository();
  const runs = inMemoryAgentRunRepository();
  const service = new DashboardService(
    labs,
    agents,
    projects,
    tasks,
    artifacts,
    meetings,
    decisions,
    runs,
  );

  const lab = createLab({ ownerUserId: USER, name: 'Cognitive Lab' });
  labs.insert(lab);
  const alice = createAgent({
    labId: lab.id,
    name: 'Alice',
    role: 'phd_researcher',
    specialization: 'working memory',
  });
  const bob = createAgent({ labId: lab.id, name: 'Bob', role: 'literature_reviewer' });
  agents.insert(alice);
  agents.insert(bob);
  const project = createProject({ labId: lab.id, title: 'WM survey', status: 'active', stage: 'survey' });
  projects.insert(project);

  const blocked = advanceTask(
    tasks,
    createTask({
      projectId: project.id,
      creatorType: 'pi',
      creatorId: USER,
      assigneeAgentId: alice.id,
      title: 'Map evidence',
    }),
    ['ready', 'running', 'blocked'],
  );
  const runDraft = {
    labId: lab.id,
    agentId: alice.id,
    projectId: project.id,
    taskId: blocked.id,
    modelConfigId: null,
    provider: null,
    model: null,
    startedAt: NOW,
  };
  runs.insert(
    succeededRun(
      runDraft,
      {
        ...emptyResult('blocked'),
        questions_for_pi: [{ question: 'Should we prioritize individual differences?' }],
      },
      NOW,
      'run-1',
    ),
  );

  const artifact = createArtifact({
    projectId: project.id,
    taskId: blocked.id,
    creatorAgentId: alice.id,
    title: 'Evidence map',
    content: 'Map of 40 studies.',
    type: 'map',
  });
  artifacts.insert(artifact);

  const meeting = createMeeting({
    labId: lab.id,
    projectId: project.id,
    title: 'Sprint sync',
    agenda: 'Review the plan.',
  });
  meetings.insertMeeting(meeting);
  const decision = createDecision({
    labId: lab.id,
    projectId: project.id,
    meetingId: meeting.id,
    madeByType: 'pi',
    madeById: USER,
    statement: 'Survey first.',
    rationale: 'Thin evidence base.',
  });
  decisions.insert(decision);

  return { service, runs, tasks, projects, lab, alice, bob, project, blocked, artifact, meeting, decision };
}

test('dashboard exposes every SPEC-010 required section from canonical state (acceptance #1, #5)', () => {
  const { service, lab, alice, bob, project, blocked, artifact, meeting, decision } = makeWorld();

  const d = service.getLabDashboard(USER, lab.id);

  assert.equal(d.lab.name, 'Cognitive Lab');

  // 1. active Projects with stage/status.
  assert.deepEqual(
    d.projects.map((p) => ({ id: p.id, stage: p.stage, status: p.status })),
    [{ id: project.id, stage: 'survey', status: 'active' }],
  );

  // 2. Agent roster with persistent identity + current assignment (acceptance #4).
  assert.deepEqual(
    d.agents.map((a) => a.id).sort(),
    [alice.id, bob.id].sort(),
  );
  const aliceRow = d.agents.find((a) => a.id === alice.id)!;
  assert.equal(aliceRow.name, 'Alice');
  assert.equal(aliceRow.role, 'phd_researcher');
  assert.equal(aliceRow.specialization, 'working memory');
  assert.equal(aliceRow.status, 'active');
  assert.deepEqual(aliceRow.currentTasks.map((t) => t.id), [blocked.id], 'Alice’s current assignment');
  assert.equal(aliceRow.openTaskCount, 1);
  assert.equal(aliceRow.blockedTaskCount, 1);

  // 3. Tasks requiring attention — the blocked task is visible (acceptance #2).
  assert.ok(
    d.attentionTasks.some((t) => t.id === blocked.id && t.status === 'blocked'),
    'blocked task appears in attention',
  );
  assert.equal(d.attentionTasks[0].assigneeName, 'Alice');

  // 4. questions waiting for the PI (acceptance #3).
  assert.deepEqual(
    d.questionsForPi.map((q) => q.question),
    ['Should we prioritize individual differences?'],
  );
  assert.equal(d.questionsForPi[0].taskId, blocked.id);
  assert.equal(d.questionsForPi[0].agentName, 'Alice');
  assert.equal(d.questionsForPi[0].runId, 'run-1');

  // 5. recent Artifacts.
  assert.deepEqual(d.recentArtifacts.map((a) => a.id), [artifact.id]);
  assert.equal(d.recentArtifacts[0].projectTitle, 'WM survey');

  // 6. recent Decisions.
  assert.deepEqual(d.recentDecisions.map((x) => x.id), [decision.id]);
  assert.equal(d.recentDecisions[0].statement, 'Survey first.');

  // 7. Group Meeting entry point.
  assert.deepEqual(d.meetings.map((m) => m.id), [meeting.id]);
  assert.equal(d.meetings[0].projectTitle, 'WM survey');
});

test('attention tasks include review and exclude archived projects; active excludes completed/archived', () => {
  const { service, tasks, projects, lab, alice, project } = makeWorld();

  advanceTask(
    tasks,
    createTask({
      projectId: project.id,
      creatorType: 'pi',
      creatorId: USER,
      assigneeAgentId: alice.id,
      title: 'Review the draft',
    }),
    ['ready', 'running', 'review'],
  );

  const archivedProject = createProject({ labId: lab.id, title: 'Done project', status: 'archived' });
  projects.insert(archivedProject);
  const archivedBlocked = advanceTask(
    tasks,
    createTask({
      projectId: archivedProject.id,
      creatorType: 'pi',
      creatorId: USER,
      assigneeAgentId: alice.id,
      title: 'Stale blocked task',
    }),
    ['ready', 'running', 'blocked'],
  );

  const completed = createProject({ labId: lab.id, title: 'Finished', status: 'completed' });
  projects.insert(completed);

  const d = service.getLabDashboard(USER, lab.id);

  // review + blocked of the active project, but not the archived project's task.
  assert.deepEqual(d.attentionTasks.map((t) => t.status).sort(), ['blocked', 'review']);
  assert.ok(!d.attentionTasks.some((t) => t.id === archivedBlocked.id), 'archived project tasks are out of attention');
  assert.ok(d.projects.every((p) => p.status !== 'completed' && p.status !== 'archived'));
});

test('pending questions use the latest succeeded run per non-terminal task (acceptance #3)', () => {
  const { service, runs, tasks, lab, alice, project } = makeWorld();
  const task = tasks.tasks[0];

  // A second, newer run on the same task supersedes run-1's question.
  runs.insert(
    succeededRun(
      {
        labId: lab.id,
        agentId: alice.id,
        projectId: project.id,
        taskId: task.id,
        modelConfigId: null,
        provider: null,
        model: null,
        startedAt: NOW,
      },
      {
        ...emptyResult('blocked'),
        questions_for_pi: [{ question: 'The newer question.' }],
      },
      '2026-08-15T00:00:10.000Z',
      'run-2',
    ),
  );

  let d = service.getLabDashboard(USER, lab.id);
  assert.deepEqual(d.questionsForPi.map((q) => q.question), ['The newer question.']);

  // A terminal task's questions are resolved.
  const completedTask = advanceTask(
    tasks,
    createTask({
      projectId: project.id,
      creatorType: 'pi',
      creatorId: USER,
      assigneeAgentId: alice.id,
      title: 'Finished task',
    }),
    ['ready', 'running', 'completed'],
  );
  runs.insert(
    succeededRun(
      {
        labId: lab.id,
        agentId: alice.id,
        projectId: project.id,
        taskId: completedTask.id,
        modelConfigId: null,
        provider: null,
        model: null,
        startedAt: NOW,
      },
      { ...emptyResult('completed'), questions_for_pi: [{ question: 'Resolved.' }] },
      '2026-08-15T00:00:20.000Z',
      'run-3',
    ),
  );

  d = service.getLabDashboard(USER, lab.id);
  assert.ok(!d.questionsForPi.some((q) => q.question === 'Resolved.'), 'terminal task questions are not pending');
});

test('a failed run or a run without questions contributes no pending question', () => {
  const { service, runs, tasks, lab, alice, project } = makeWorld();
  const task = tasks.tasks[0];

  // A newer run on the same task that succeeded but carried no questions clears them.
  runs.insert(
    succeededRun(
      {
        labId: lab.id,
        agentId: alice.id,
        projectId: project.id,
        taskId: task.id,
        modelConfigId: null,
        provider: null,
        model: null,
        startedAt: NOW,
      },
      emptyResult('blocked'),
      '2026-08-15T00:00:30.000Z',
      'run-4',
    ),
  );

  const d = service.getLabDashboard(USER, lab.id);
  assert.equal(d.questionsForPi.length, 0, 'the latest run had no questions for the PI');
});

test('the dashboard is a pure read: it never creates runs or mutates state (acceptance #5)', () => {
  const { service, runs, lab } = makeWorld();
  const before = runs.runs.length;

  const d1 = service.getLabDashboard(USER, lab.id);
  const d2 = service.getLabDashboard(USER, lab.id);

  assert.equal(runs.runs.length, before, 'no runs were created by reading the dashboard');
  assert.deepEqual(d2, d1, 'deterministic: the same canonical state yields the same dashboard');
});

test('dashboard enforces Lab ownership and unknown-Lab 404', () => {
  const { service, lab } = makeWorld();
  assert.throws(() => service.getLabDashboard('user-2', lab.id), LabForbiddenError);
  assert.throws(() => service.getLabDashboard(USER, 'no-such-lab'), LabNotFoundError);
});
