import type { Task } from '../domain/task';

/**
 * Persistence boundary for Tasks. The application layer depends on this
 * interface; infrastructure provides the SQLite implementation.
 */
export interface TaskRepository {
  insert(task: Task): void;
  findById(id: string): Task | null;
  findByProject(projectId: string): Task[];
  update(task: Task): void;
}
