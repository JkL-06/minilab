import type { Agent } from '../domain/agent';
import type { AgentStatus } from '../domain/agent';
import type { AgentRun } from '../domain/agentRun';
import type { MeetingStatus } from '../domain/meeting';
import type { Project } from '../domain/project';
import type { ProjectStatus } from '../domain/project';
import type { ResearchStage } from '../domain/project';
import type { Task } from '../domain/task';
import type { TaskPriority } from '../domain/task';
import type { TaskStatus } from '../domain/task';
import type { AgentRepository } from './agentRepository';
import type { AgentRunRepository } from './agentRunRepository';
import type { ArtifactRepository } from './artifactRepository';
import type { DecisionRepository } from './decisionRepository';
import type { LabRepository } from './labRepository';
import type { MeetingRepository } from './meetingRepository';
import type { ProjectRepository } from './projectRepository';
import type { TaskRepository } from './taskRepository';
import { assertLabOwnedBy } from './labAccess';

/**
 * SPEC-010: the PI Dashboard (ADR-0006).
 *
 * The default UI tells the PI what is happening in the Lab without an
 * empty-prompt interaction. It is a **deterministic read model over canonical
 * domain rows** (acceptance #5): this service composes the existing
 * repositories and never calls a model provider — a model gateway cannot even
 * be injected here. Every section is derived, so the dashboard cannot drift
 * from the persistent state it summarizes.
 *
 * Section definitions (all deterministic and tested):
 *  - active Projects: status neither `completed` nor `archived`, newest first.
 *  - Agent roster: every Agent in the Lab with its persistent identity
 *    (`id/name/role/specialization/status` — acceptance #4) and its current
 *    assignment (non-terminal tasks in non-archived projects).
 *  - Tasks requiring attention: `blocked`/`review` tasks in non-archived
 *    projects — blocked tasks are always visible (acceptance #2).
 *  - questions waiting for PI: the latest succeeded run per non-terminal task,
 *    its validated `result.questions_for_pi` surfaced (acceptance #3).
 *  - recent Artifacts / Decisions / Meetings: newest-first, capped.
 */

/** How many rows each "recent …" section surfaces. */
export const DASHBOARD_RECENT_LIMIT = 10;

/** Terminal tasks no longer need PI attention (their questions are resolved). */
const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'cancelled'];

/** Tasks that demand PI attention, per the spec ("Tasks requiring attention"). */
const ATTENTION_TASK_STATUSES: readonly TaskStatus[] = ['blocked', 'review'];

const ARCHIVED_PROJECT_STATUS: ProjectStatus = 'archived';

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface DashboardProject {
  id: string;
  title: string;
  stage: ResearchStage;
  status: ProjectStatus;
  updatedAt: string;
}

export interface DashboardAgentTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string;
  projectTitle: string;
}

export interface DashboardAgent {
  id: string;
  name: string;
  role: string;
  specialization: string | null;
  status: AgentStatus;
  /** The Agent's current assignment: non-terminal tasks, priority-ordered. */
  currentTasks: DashboardAgentTask[];
  openTaskCount: number;
  blockedTaskCount: number;
}

export interface DashboardAttentionTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string;
  projectTitle: string;
  assigneeAgentId: string;
  assigneeName: string;
}

export interface DashboardQuestion {
  question: string;
  runId: string;
  taskId: string;
  taskTitle: string;
  agentId: string;
  agentName: string;
  createdAt: string;
}

export interface DashboardArtifact {
  id: string;
  title: string;
  type: string;
  version: number;
  projectId: string;
  projectTitle: string;
  createdAt: string;
}

export interface DashboardDecision {
  id: string;
  statement: string;
  rationale: string | null;
  projectId: string | null;
  projectTitle: string | null;
  meetingId: string | null;
  madeById: string;
  createdAt: string;
}

export interface DashboardMeeting {
  id: string;
  title: string;
  status: MeetingStatus;
  projectId: string;
  projectTitle: string;
  updatedAt: string;
}

/** The complete Lab-wide dashboard view (SPEC-010 required sections). */
export interface LabDashboard {
  lab: { id: string; name: string; description: string | null };
  projects: DashboardProject[];
  agents: DashboardAgent[];
  attentionTasks: DashboardAttentionTask[];
  questionsForPi: DashboardQuestion[];
  recentArtifacts: DashboardArtifact[];
  recentDecisions: DashboardDecision[];
  meetings: DashboardMeeting[];
}

/**
 * Composes the Lab-wide dashboard from the canonical repositories. Read-only:
 * no method on this service mutates anything.
 */
export class DashboardService {
  constructor(
    private readonly labs: LabRepository,
    private readonly agents: AgentRepository,
    private readonly projects: ProjectRepository,
    private readonly tasks: TaskRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly meetings: MeetingRepository,
    private readonly decisions: DecisionRepository,
    private readonly runs: AgentRunRepository,
  ) {}

  getLabDashboard(requesterUserId: string, labId: string): LabDashboard {
    assertLabOwnedBy(this.labs, requesterUserId, labId);
    const lab = this.labs.findById(labId)!;

    const projects = this.projects.findByLab(labId);
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const agents = this.agents.findByLab(labId);
    const agentById = new Map(agents.map((a) => [a.id, a]));

    // Compose per-project reads (ADR-0006 #4: no new repository methods).
    const tasks = projects.flatMap((p) => this.tasks.findByProject(p.id));
    const artifacts = projects.flatMap((p) => this.artifacts.findByProject(p.id));
    const meetings = projects.flatMap((p) => this.meetings.findMeetingsByProject(p.id));
    const decisions = meetings.flatMap((m) => this.decisions.findByMeeting(m.id));

    const projectTitle = (projectId: string): string =>
      projectById.get(projectId)?.title ?? '?';

    return {
      lab: { id: lab.id, name: lab.name, description: lab.description },

      // Active Projects with stage/status (required section 1).
      projects: projects
        .filter(
          (p) => p.status !== 'completed' && p.status !== ARCHIVED_PROJECT_STATUS,
        )
        .sort(byUpdatedAtDesc)
        .map((p) => ({
          id: p.id,
          title: p.title,
          stage: p.stage,
          status: p.status,
          updatedAt: p.updatedAt,
        })),

      // Agent roster with current assignment/status (required section 2).
      agents: agents.map((agent) =>
        this.buildAgentRow(agent, tasks, projectById, projectTitle),
      ),

      // Tasks requiring attention (required section 3, acceptance #2).
      attentionTasks: tasks
        .filter(
          (t) =>
            ATTENTION_TASK_STATUSES.includes(t.status) &&
            projectById.get(t.projectId)?.status !== ARCHIVED_PROJECT_STATUS,
        )
        .sort(byPriorityThenUpdatedAtDesc)
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          projectId: t.projectId,
          projectTitle: projectTitle(t.projectId),
          assigneeAgentId: t.assigneeAgentId,
          assigneeName: agentById.get(t.assigneeAgentId)?.name ?? '?',
        })),

      // Questions waiting for the PI (required section 4, acceptance #3).
      questionsForPi: this.collectPendingQuestions(tasks, agentById, projectById),

      recentArtifacts: artifacts
        .slice()
        .sort(byNewest)
        .slice(0, DASHBOARD_RECENT_LIMIT)
        .map((a) => ({
          id: a.id,
          title: a.title,
          type: a.type,
          version: a.version,
          projectId: a.projectId,
          projectTitle: projectTitle(a.projectId),
          createdAt: a.createdAt,
        })),

      recentDecisions: decisions
        .slice()
        .sort(byNewest)
        .slice(0, DASHBOARD_RECENT_LIMIT)
        .map((d) => ({
          id: d.id,
          statement: d.statement,
          rationale: d.rationale,
          projectId: d.projectId,
          projectTitle: d.projectId ? projectTitle(d.projectId) : null,
          meetingId: d.meetingId,
          madeById: d.madeById,
          createdAt: d.createdAt,
        })),

      // Group Meeting entry point (required section 7).
      meetings: meetings
        .slice()
        .sort(byUpdatedAtDesc)
        .slice(0, DASHBOARD_RECENT_LIMIT)
        .map((m) => ({
          id: m.id,
          title: m.title,
          status: m.status,
          projectId: m.projectId,
          projectTitle: projectTitle(m.projectId),
          updatedAt: m.updatedAt,
        })),
    };
  }

  /** Agent identity + current assignment (acceptance #4: persistent identity). */
  private buildAgentRow(
    agent: Agent,
    tasks: Task[],
    projectById: Map<string, Project>,
    projectTitle: (projectId: string) => string,
  ): DashboardAgent {
    const currentTasks = tasks
      .filter(
        (t) =>
          t.assigneeAgentId === agent.id &&
          !TERMINAL_TASK_STATUSES.includes(t.status) &&
          projectById.get(t.projectId)?.status !== ARCHIVED_PROJECT_STATUS,
      )
      .sort(byPriorityThenUpdatedAtDesc);
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      specialization: agent.specialization,
      status: agent.status,
      currentTasks: currentTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        projectId: t.projectId,
        projectTitle: projectTitle(t.projectId),
      })),
      openTaskCount: currentTasks.length,
      blockedTaskCount: currentTasks.filter((t) => t.status === 'blocked').length,
    };
  }

  /**
   * Pending PI questions (acceptance #3): for each non-terminal task in a
   * non-archived project, take its **latest** run (newest `createdAt`, tie-break
   * on id) from the assignee; if that run succeeded and its validated result
   * carried `questions_for_pi`, surface them. A newer run supersedes an older
   * one's questions; a terminal task's questions are resolved. Deterministic,
   * derived entirely from canonical run rows (ADR-0006).
   */
  private collectPendingQuestions(
    tasks: Task[],
    agentById: Map<string, Agent>,
    projectById: Map<string, Project>,
  ): DashboardQuestion[] {
    const pending: DashboardQuestion[] = [];
    for (const task of tasks) {
      if (TERMINAL_TASK_STATUSES.includes(task.status)) continue;
      if (projectById.get(task.projectId)?.status === ARCHIVED_PROJECT_STATUS) continue;
      const assignee = agentById.get(task.assigneeAgentId);
      if (!assignee) continue;
      const latest = this.latestRunForTask(assignee.id, task.id);
      if (!latest || latest.status !== 'succeeded' || !latest.result) continue;
      for (const q of latest.result.questions_for_pi) {
        pending.push({
          question: q.question,
          runId: latest.id,
          taskId: task.id,
          taskTitle: task.title,
          agentId: assignee.id,
          agentName: assignee.name,
          createdAt: latest.createdAt,
        });
      }
    }
    return pending.sort(byNewestRun);
  }

  private latestRunForTask(agentId: string, taskId: string): AgentRun | null {
    const runs = this.runs
      .findByAgent(agentId)
      .filter((run) => run.taskId === taskId)
      .sort(byNewest);
    return runs[0] ?? null;
  }
}

/** Newest first, tie-broken on id for deterministic ordering. */
function byNewest(a: { id: string; createdAt: string }, b: { id: string; createdAt: string }): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

/** Newest run first, tie-broken on runId (questions carry runId, not id). */
function byNewestRun(a: { runId: string; createdAt: string }, b: { runId: string; createdAt: string }): number {
  return b.createdAt.localeCompare(a.createdAt) || b.runId.localeCompare(a.runId);
}

/** Newest `updatedAt` first, tie-broken on id. */
function byUpdatedAtDesc(a: { id: string; updatedAt: string }, b: { id: string; updatedAt: string }): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id);
}

/** Priority (urgent first), then newest `updatedAt`, then id. */
function byPriorityThenUpdatedAtDesc(
  a: { id: string; priority: TaskPriority; updatedAt: string },
  b: { id: string; priority: TaskPriority; updatedAt: string },
): number {
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  return byUpdatedAtDesc(a, b);
}
