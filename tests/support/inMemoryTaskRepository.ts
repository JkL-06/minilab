import type { TaskRepository } from '../../src/application/taskRepository';
import type { Task } from '../../src/domain/task';

/**
 * In-memory TaskRepository for domain/service/API tests. Not used by the
 * persistence and restart tests, which exercise the real SQLite repository.
 */
export function inMemoryTaskRepository(): TaskRepository & { tasks: Task[] } {
  const tasks: Task[] = [];
  return {
    tasks,
    insert(task: Task): void {
      tasks.push(task);
    },
    findById(id: string): Task | null {
      return tasks.find((task) => task.id === id) ?? null;
    },
    findByProject(projectId: string): Task[] {
      return tasks.filter((task) => task.projectId === projectId);
    },
    update(task: Task): void {
      const index = tasks.findIndex((existing) => existing.id === task.id);
      if (index === -1) {
        throw new Error(`Task not found in memory: ${task.id}`);
      }
      tasks[index] = task;
    },
  };
}
