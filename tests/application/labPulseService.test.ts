import assert from 'node:assert/strict';
import test from 'node:test';

import { DashboardService } from '../../src/application/dashboardService';
import { LabPulseService } from '../../src/application/labPulseService';
import { LabService } from '../../src/application/labService';
import {
  createAgentRunSuccess,
  type AgentRunDraft,
  type AgentRunResult,
} from '../../src/domain/agentRun';
import { createAgent } from '../../src/domain/agent';
import { createLab } from '../../src/domain/lab';
import { createMeeting, transitionMeetingStatus } from '../../src/domain/meeting';
import { createProject } from '../../src/domain/project';
import { createTask } from '../../src/domain/task';
import { inMemoryAgentRepository } from '../support/inMemoryAgentRepository';
import { inMemoryAgentRunRepository } from '../support/inMemoryAgentRunRepository';
import { inMemoryArtifactRepository } from '../support/inMemoryArtifactRepository';
import { inMemoryDecisionRepository } from '../support/inMemoryDecisionRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { inMemoryMeetingRepository } from '../support/inMemoryMeetingRepository';
import { inMemoryProjectRepository } from '../support/inMemoryProjectRepository';
import { inMemoryTaskRepository } from '../support/inMemoryTaskRepository';

const OWNER = 'user-1';
const OTHER = 'user-2';

/**
 * S1 Today / Lab Pulse aggregation (cross-lab), tested against the canonical
 * in-memory repos. `LabPulseService` only depends on LabService +
 * DashboardService (the dashboard already asserts Lab ownership), so this suite
 * seeds raw domain rows and asserts the four home-page blocks merge correctly
 * and stay Lab-isolated.
 */
function makeWorld() {
  const labRepo = inMemoryLabRepository();
  const agentRepo = inMemoryAgentRepository();
  const projectRepo = inMemoryProjectRepository();
  const taskRepo = inMemoryTaskRepository();
  const meetingRepo = inMemoryMeetingRepository();
  const decisionRepo = inMemoryDecisionRepository();
  const artifactRepo = inMemoryArtifactRepository();
  const runRepo = inMemoryAgentRunRepository();

  const labService = new LabService(labRepo);
  const dashboardService = new DashboardService(
    labRepo,
    agentRepo,
    projectRepo,
    taskRepo,
    artifactRepo,
    meetingRepo,
    decisionRepo,
    runRepo,
  );
  const pulse = new LabPulseService(labService, dashboardService);

  return { labRepo, agentRepo, projectRepo, taskRepo, meetingRepo, runRepo, pulse };
}

/** One task with a given status; creator = the PI (`pi` / OWNER). */
function seedTask(
  taskRepo: ReturnType<typeof inMemoryTaskRepository>,
  projectId: string,
  assigneeAgentId: string,
  title: string,
  status: ReturnType<typeof createTask>['status'],
) {
  const task = { ...createTask({ projectId, creatorType: 'pi', creatorId: OWNER, assigneeAgentId, title }), status };
  taskRepo.insert(task);
  return task;
}

test('getPulse is empty for a user who owns no Labs', () => {
  const { pulse } = makeWorld();
  const result = pulse.getPulse(OWNER);
  assert.equal(result.empty, true);
  assert.equal(result.attention.tasks.length, 0);
  assert.equal(result.labProgress.length, 0);
  assert.equal(result.people.length, 0);
  assert.equal(result.todaySchedule.length, 0);
});

test('getPulse merges attention, progress, people and today-schedule across Labs, Lab-isolated', () => {
  const { labRepo, agentRepo, projectRepo, taskRepo, meetingRepo, runRepo, pulse } = makeWorld();

  // --- Lab A: Alice, two Projects ---
  const labA = createLab({ ownerUserId: OWNER, name: 'Lab A' });
  labRepo.insert(labA);
  const alice = createAgent({ labId: labA.id, name: 'Alice', role: 'phd_researcher', specialization: 'working memory' });
  agentRepo.insert(alice);
  const pa1 = createProject({ labId: labA.id, title: 'WM survey', stage: 'survey', status: 'active' });
  const pa2 = createProject({ labId: labA.id, title: 'Write-up', stage: 'write', status: 'planned' });
  projectRepo.insert(pa1);
  projectRepo.insert(pa2);
  seedTask(taskRepo, pa1.id, alice.id, 'Run study', 'running');
  const tReview = seedTask(taskRepo, pa1.id, alice.id, 'Draft intro', 'review');
  seedTask(taskRepo, pa1.id, alice.id, 'Map evidence', 'blocked');
  seedTask(taskRepo, pa1.id, alice.id, 'Collect data', 'completed');
  seedTask(taskRepo, pa2.id, alice.id, 'Outline', 'ready');

  // A succeeded run on the review task with a pending PI question.
  const runDraft: AgentRunDraft = {
    labId: labA.id,
    agentId: alice.id,
    projectId: pa1.id,
    taskId: tReview.id,
    modelConfigId: null,
    provider: 'mock',
    model: 'mock-a',
    startedAt: '2026-08-10T02:00:00.000Z',
  };
  const runResult: AgentRunResult = {
    summary: 'Intro drafted.',
    task_status: 'review',
    artifact_proposals: [],
    findings: [],
    questions_for_pi: [{ question: 'Should we split the intro in two?' }],
    suggested_tasks: [],
    memory_candidates: [],
  };
  runRepo.insert(createAgentRunSuccess(runDraft, runResult, '2026-08-10T02:05:00.000Z'));

  // --- Lab B: Bob, one Project, two Meetings (today + yesterday) ---
  const labB = createLab({ ownerUserId: OWNER, name: 'Lab B' });
  labRepo.insert(labB);
  const bob = createAgent({ labId: labB.id, name: 'Bob', role: 'literature_reviewer' });
  agentRepo.insert(bob);
  const pb1 = createProject({ labId: labB.id, title: 'Attention review', stage: 'explore', status: 'active' });
  projectRepo.insert(pb1);
  seedTask(taskRepo, pb1.id, bob.id, 'Read Transformers', 'review');

  const now = new Date(2026, 7, 16, 12, 0, 0); // local noon on a fixed day
  const todayIso = new Date(2026, 7, 16, 9, 0, 0).toISOString();
  const yesterdayIso = new Date(2026, 7, 15, 9, 0, 0).toISOString();
  const mToday = transitionMeetingStatus(
    createMeeting({ labId: labB.id, projectId: pb1.id, title: 'Today sync', agenda: null }),
    'in_progress',
    todayIso,
  );
  const mYesterday = transitionMeetingStatus(
    createMeeting({ labId: labB.id, projectId: pb1.id, title: 'Old sync', agenda: null }),
    'in_progress',
    yesterdayIso,
  );
  meetingRepo.insertMeeting(mToday);
  meetingRepo.insertMeeting(mYesterday);

  // --- Aggregate ---
  const result = pulse.getPulse(OWNER, now);
  assert.equal(result.empty, false);

  // 1. attention: blocked + review tasks from both Labs, one question, one hint
  //    (Bob holds an open task but nothing Doing; Alice is busy → no hint).
  const attentionTitles = result.attention.tasks.map((t) => t.title);
  assert.deepEqual(
    attentionTitles.sort(),
    ['Draft intro', 'Map evidence', 'Read Transformers'].sort(),
    'blocked + review tasks surface across Labs',
  );
  assert.equal(result.attention.questions.length, 1);
  assert.equal(result.attention.questions[0].question, 'Should we split the intro in two?');
  assert.equal(result.attention.questions[0].labName, 'Lab A');
  assert.equal(result.attention.hints.length, 1);
  assert.equal(result.attention.hints[0].agentName, 'Bob');
  assert.equal(result.attention.hints[0].openCount, 1);

  // 2. lab progress: active projects with task-derived percentages.
  const progressByTitle = new Map(result.labProgress.map((p) => [p.title, p]));
  assert.equal(progressByTitle.get('WM survey')?.progress, 25, '1 of 4 non-cancelled tasks completed');
  assert.equal(progressByTitle.get('Write-up')?.progress, 0);
  assert.equal(progressByTitle.get('Attention review')?.progress, 0);

  // 3. people: Doing / Next / blocked / awaiting-PI counts per Agent.
  const aliceRow = result.people.find((p) => p.agentId === alice.id);
  assert.ok(aliceRow);
  assert.equal(aliceRow.doing.length, 1);
  assert.equal(aliceRow.doing[0].title, 'Run study');
  assert.equal(aliceRow.next.length, 1);
  assert.equal(aliceRow.next[0].title, 'Outline');
  assert.equal(aliceRow.blockedCount, 1);
  assert.equal(aliceRow.awaitingPiCount, 1);
  const bobRow = result.people.find((p) => p.agentId === bob.id);
  assert.ok(bobRow);
  assert.equal(bobRow.doing.length, 0);
  assert.equal(bobRow.awaitingPiCount, 1);

  // 4. today schedule: only the meeting started on the local day.
  assert.equal(result.todaySchedule.length, 1);
  assert.equal(result.todaySchedule[0].title, 'Today sync');
  assert.equal(result.todaySchedule[0].labName, 'Lab B');

  // 5. cross-Lab isolation: another user sees none of this.
  const other = pulse.getPulse(OTHER, now);
  assert.equal(other.empty, true);
  assert.equal(other.attention.tasks.length, 0);
  assert.equal(other.people.length, 0);
});
