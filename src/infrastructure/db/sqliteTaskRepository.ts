import type {
  Task,
  TaskCreatorType,
  TaskPriority,
  TaskStatus,
} from '../../domain/task';
import type { TaskRepository } from '../../application/taskRepository';
import type { MiniLabDb } from './database';

interface TaskRow {
  id: string;
  project_id: string;
  creator_type: string;
  creator_id: string;
  assignee_agent_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    creatorType: row.creator_type as TaskCreatorType,
    creatorId: row.creator_id,
    assigneeAgentId: row.assignee_agent_id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(task: Task): TaskRow {
  return {
    id: task.id,
    project_id: task.projectId,
    creator_type: task.creatorType,
    creator_id: task.creatorId,
    assignee_agent_id: task.assigneeAgentId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    due_at: task.dueAt,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

/** SQLite-backed TaskRepository. Maps snake_case rows to camelCase domain objects. */
export class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly db: MiniLabDb) {}

  insert(task: Task): void {
    const row = toRow(task);
    this.db
      .prepare(
        `INSERT INTO tasks
           (id, project_id, creator_type, creator_id, assignee_agent_id, title, description,
            status, priority, due_at, created_at, updated_at)
         VALUES
           (@id, @project_id, @creator_type, @creator_id, @assignee_agent_id, @title, @description,
            @status, @priority, @due_at, @created_at, @updated_at)`,
      )
      .run(row);
  }

  findById(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  findByProject(projectId: string): Task[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC')
      .all(projectId) as TaskRow[];
    return rows.map(toTask);
  }

  findByAssignee(agentId: string): Task[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE assignee_agent_id = ? ORDER BY created_at ASC')
      .all(agentId) as TaskRow[];
    return rows.map(toTask);
  }

  update(task: Task): void {
    const row = toRow(task);
    this.db
      .prepare(
        `UPDATE tasks
         SET assignee_agent_id = @assignee_agent_id, title = @title, description = @description,
             status = @status, priority = @priority, due_at = @due_at, updated_at = @updated_at
         WHERE id = @id`,
      )
      .run(row);
  }
}
