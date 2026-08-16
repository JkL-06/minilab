import type { MeetingStatus } from '../domain/meeting';
import type { TaskPriority } from '../domain/task';
import type { TaskStatus } from '../domain/task';
import type { DashboardService } from './dashboardService';
import type { LabService } from './labService';

/**
 * Lab Pulse (S1 IA): the cross-lab read model behind the Today / Lab Pulse home
 * page.
 *
 * The product thesis is "每次打开 MiniLab，只需要回答两个问题——实验室现在在
 * 干什么？我现在需要做什么？" The Today page therefore answers them in four
 * ordered blocks:
 *
 *   1. Needs your attention — blocked/review tasks, PI questions, and rule-based
 *      hints (an Agent holding open tasks but no Doing task), across every Lab
 *      the user owns.
 *   2. Lab progress     — each Lab's active projects with a task-derived
 *      progress bar.
 *   3. People           — every Agent's Doing + next (ready/backlog) tasks.
 *   4. Today schedule   — meetings that started on the current local day.
 *
 * Like DashboardService this is a **deterministic read model** (no model calls).
 * It is a pure aggregator: it calls `DashboardService.getLabDashboard` per Lab
 * (which already asserts Lab ownership for the requester) and merges the rows —
 * no new repository reads, no `findAll()` methods (ADR-0006 #4).
 */
export interface PulseTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string;
  projectTitle: string;
}

export interface PulseAttentionTask extends PulseTask {
  assigneeName: string;
  labId: string;
  labName: string;
}

export interface PulseQuestion {
  question: string;
  taskTitle: string;
  agentName: string;
  labId: string;
  labName: string;
}

export interface PulseHint {
  kind: 'idle';
  agentName: string;
  labName: string;
  /** Open (non-terminal) tasks the Agent holds but is not currently running. */
  openCount: number;
}

export interface PulseProject {
  labId: string;
  labName: string;
  projectId: string;
  title: string;
  stage: string;
  status: string;
  updatedAt: string;
  /** 0–100, derived from completed / non-cancelled tasks in the project. */
  progress: number;
}

export interface PulsePerson {
  labId: string;
  labName: string;
  agentId: string;
  name: string;
  role: string;
  specialization: string | null;
  status: string;
  doing: PulseTask[];
  next: PulseTask[];
  blockedCount: number;
  awaitingPiCount: number;
}

export interface PulseMeeting {
  id: string;
  title: string;
  status: MeetingStatus;
  projectId: string;
  projectTitle: string;
  labId: string;
  labName: string;
  startedAt: string | null;
}

export interface LabPulse {
  /** True when the user owns no Labs (fresh setup; the route handles the fallback). */
  empty: boolean;
  attention: {
    tasks: PulseAttentionTask[];
    questions: PulseQuestion[];
    hints: PulseHint[];
  };
  labProgress: PulseProject[];
  people: PulsePerson[];
  todaySchedule: PulseMeeting[];
}

const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['backlog', 'ready', 'running', 'blocked', 'review'];

export class LabPulseService {
  constructor(
    private readonly labs: LabService,
    private readonly dashboards: DashboardService,
  ) {}

  getPulse(requesterUserId: string, now: Date = new Date()): LabPulse {
    const ownedLabs = this.labs.listLabs(requesterUserId);
    if (ownedLabs.length === 0) {
      return {
        empty: true,
        attention: { tasks: [], questions: [], hints: [] },
        labProgress: [],
        people: [],
        todaySchedule: [],
      };
    }

    // Per-Lab aggregation reuses the dashboard's already-authorized reads
    // (dashboardService asserts lab ownership for requesterUserId).
    const dashboards = ownedLabs.map((lab) =>
      this.dashboards.getLabDashboard(requesterUserId, lab.id),
    );

    const attentionTasks: PulseAttentionTask[] = [];
    const questions: PulseQuestion[] = [];
    const hints: PulseHint[] = [];
    const labProgress: PulseProject[] = [];
    const people: PulsePerson[] = [];
    const todaySchedule: PulseMeeting[] = [];

    for (const d of dashboards) {
      const labId = d.lab.id;
      const labName = d.lab.name;

      for (const t of d.attentionTasks) {
        attentionTasks.push({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          projectId: t.projectId,
          projectTitle: t.projectTitle,
          assigneeName: t.assigneeName,
          labId,
          labName,
        });
      }
      for (const q of d.questionsForPi) {
        questions.push({
          question: q.question,
          taskTitle: q.taskTitle,
          agentName: q.agentName,
          labId,
          labName,
        });
      }
      for (const agent of d.agents) {
        const open = agent.currentTasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status));
        const hasDoing = open.some((t) => t.status === 'running');
        if (!hasDoing && open.length > 0) {
          hints.push({ kind: 'idle', agentName: agent.name, labName, openCount: open.length });
        }
      }
      for (const p of d.projects) {
        labProgress.push({
          labId,
          labName,
          projectId: p.id,
          title: p.title,
          stage: p.stage,
          status: p.status,
          updatedAt: p.updatedAt,
          progress: p.progress,
        });
      }
      for (const agent of d.agents) {
        const current = agent.currentTasks;
        people.push({
          labId,
          labName,
          agentId: agent.id,
          name: agent.name,
          role: agent.role,
          specialization: agent.specialization,
          status: agent.status,
          doing: current.filter((t) => t.status === 'running').map(toPulseTask),
          next: current.filter((t) => t.status === 'ready' || t.status === 'backlog').map(toPulseTask),
          blockedCount: current.filter((t) => t.status === 'blocked').length,
          awaitingPiCount: current.filter((t) => t.status === 'review').length,
        });
      }
      for (const m of d.meetings) {
        if (m.startedAt && isOnLocalDay(m.startedAt, now)) {
          todaySchedule.push({
            id: m.id,
            title: m.title,
            status: m.status,
            projectId: m.projectId,
            projectTitle: m.projectTitle,
            labId,
            labName,
            startedAt: m.startedAt,
          });
        }
      }
    }

    return {
      empty: false,
      attention: { tasks: attentionTasks, questions, hints },
      labProgress,
      people,
      todaySchedule,
    };
  }
}

function toPulseTask(t: {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string;
  projectTitle: string;
}): PulseTask {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    projectId: t.projectId,
    projectTitle: t.projectTitle,
  };
}

/** True when a UTC ISO timestamp falls on `now`'s local calendar day. */
function isOnLocalDay(isoUtc: string, now: Date): boolean {
  const ts = Date.parse(isoUtc);
  if (!Number.isFinite(ts)) return false;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return ts >= start && ts < end;
}
