import {
  applyTaskUpdate,
  createTask,
  type CreateTaskInput,
  type Task,
  type TaskStatus,
  type TaskUpdatePatch,
} from '../domain/task';
import {
  AgentNotFoundError,
  ProjectNotFoundError,
  TaskForbiddenError,
  TaskNotFoundError,
} from '../domain/errors';
import { assertLabOwnedBy } from './labAccess';
import type { AgentRepository } from './agentRepository';
import type { LabRepository } from './labRepository';
import type { ProjectRepository } from './projectRepository';
import type { TaskRepository } from './taskRepository';

type CreateTaskParams = Omit<CreateTaskInput, 'projectId' | 'creatorType' | 'creatorId'>;

/**
 * Application service for Tasks.
 *
 * A Task belongs to exactly one Project, so all operations first authorize the
 * requesting PI against the owning Lab (rejects cross-lab access) and enforce
 * that the assignee Agent lives in that same Lab (SPEC-004 acceptance #3).
 * The creator is always recorded server-side from the requester, so client
 * input can never forge provenance.
 */
export class TaskService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly projects: ProjectRepository,
    private readonly agents: AgentRepository,
    private readonly labs: LabRepository,
  ) {}

  createTask(requesterUserId: string, projectId: string, params: CreateTaskParams): Task {
    const project = this.requireProject(projectId);
    this.assertLabOwnedBy(requesterUserId, project.labId);
    this.assertAssigneeInLab(params.assigneeAgentId, project.labId);

    const task = createTask({
      projectId,
      creatorType: 'pi',
      creatorId: requesterUserId,
      ...params,
    });
    this.tasks.insert(task);
    return task;
  }

  listTasks(requesterUserId: string, projectId: string): Task[] {
    const project = this.requireProject(projectId);
    this.assertLabOwnedBy(requesterUserId, project.labId);
    return this.tasks.findByProject(projectId);
  }

  getTask(requesterUserId: string, taskId: string): Task {
    const task = this.requireTask(taskId);
    this.assertProjectOwnedBy(requesterUserId, task.projectId);
    return task;
  }

  updateTask(requesterUserId: string, taskId: string, patch: TaskUpdatePatch): Task {
    const task = this.requireTask(taskId);
    const project = this.assertProjectOwnedBy(requesterUserId, task.projectId);
    if ('assigneeAgentId' in patch) {
      this.assertAssigneeInLab(patch.assigneeAgentId as string, project.labId);
    }

    const updated = applyTaskUpdate(task, patch);
    this.tasks.update(updated);
    return updated;
  }

  /**
   * Agent-authorized outcome update (AGENT_RUNTIME.md authority model, SPEC-006 #8).
   *
   * Only the assignee Agent may propose its own task's final status; identity is
   * the Agent ID (the Runtime has already verified the PI owns the Lab), and the
   * transition is validated by the domain state machine — an illegal proposal
   * throws `TaskValidationError` and leaves the Task unchanged. The status is the
   * ONLY thing an Agent run may change; suggested tasks stay proposals.
   */
  agentProposeOutcome(agentId: string, taskId: string, nextStatus: TaskStatus): Task {
    const task = this.requireTask(taskId);
    if (task.assigneeAgentId !== agentId) {
      throw new TaskForbiddenError('only the assignee agent may propose the task outcome');
    }
    const updated = applyTaskUpdate(task, { status: nextStatus });
    this.tasks.update(updated);
    return updated;
  }

  private requireTask(taskId: string): Task {
    const task = this.tasks.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }
    return task;
  }

  private requireProject(projectId: string) {
    const project = this.projects.findById(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }
    return project;
  }

  /** Authorizes the requester against the Lab that owns the given Project. */
  private assertProjectOwnedBy(userId: string, projectId: string) {
    const project = this.requireProject(projectId);
    this.assertLabOwnedBy(userId, project.labId);
    return project;
  }

  private assertLabOwnedBy(userId: string, labId: string): void {
    assertLabOwnedBy(this.labs, userId, labId);
  }

  /** Assignee must be an existing Agent in the same Lab as the Project (SPEC-004 #3). */
  private assertAssigneeInLab(assigneeAgentId: string, labId: string): void {
    const agent = this.agents.findById(assigneeAgentId);
    if (!agent) {
      throw new AgentNotFoundError(assigneeAgentId);
    }
    if (agent.labId !== labId) {
      throw new TaskForbiddenError(
        'assignee must belong to the same Lab as the Project',
      );
    }
  }
}
