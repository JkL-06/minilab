import { Router } from 'express';
import { z } from 'zod';

import type { TaskService } from '../application/taskService';
import { TASK_PRIORITIES, TASK_STATUSES } from '../domain/task';
import { requireUser } from './auth';
import { handle } from './handlers';

const statusEnum = z.enum(TASK_STATUSES);
const priorityEnum = z.enum(TASK_PRIORITIES);

/**
 * Request bodies are `.strict()`: unknown keys are rejected rather than
 * silently dropped. Note there is no `status` on create — a new Task always
 * starts in the backlog — and no `creatorType`/`creatorId`/`projectId`: the
 * creator is recorded server-side from the authenticated requester and the
 * project comes from the URL, so provenance can never be forged.
 */
const createTaskSchema = z
  .object({
    title: z.string().min(1, 'title must not be empty').max(300),
    description: z.string().max(10_000).nullish(),
    assigneeAgentId: z.string().min(1).max(200),
    priority: priorityEnum.optional(),
    dueAt: z.string().datetime().nullish(),
  })
  .strict();

const updateTaskSchema = z
  .object({
    title: z.string().min(1, 'title must not be empty').max(300).optional(),
    description: z.string().max(10_000).nullish(),
    assigneeAgentId: z.string().min(1).max(200).optional(),
    status: statusEnum.optional(),
    priority: priorityEnum.optional(),
    dueAt: z.string().datetime().nullish(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * SPEC-004 routes:
 *   POST  /projects/:projectId/tasks   create a Task in a Project, assign an Agent
 *   GET   /projects/:projectId/tasks   list a Project's Tasks
 *   GET   /tasks/:taskId               get a Task by ID
 *   PATCH /tasks/:taskId               update a Task (incl. status transitions)
 */
export function taskRouter(service: TaskService): Router {
  const router = Router();

  router.use(requireUser);

  router.post(
    '/projects/:projectId/tasks',
    handle((req, res) => {
      const input = createTaskSchema.parse(req.body);
      const task = service.createTask(req.userId, req.params.projectId, input);
      res.status(201).json({ task });
    }),
  );

  router.get(
    '/projects/:projectId/tasks',
    handle((req, res) => {
      const tasks = service.listTasks(req.userId, req.params.projectId);
      res.json({ tasks });
    }),
  );

  router.get(
    '/tasks/:taskId',
    handle((req, res) => {
      const task = service.getTask(req.userId, req.params.taskId);
      res.json({ task });
    }),
  );

  router.patch(
    '/tasks/:taskId',
    handle((req, res) => {
      const patch = updateTaskSchema.parse(req.body);
      const task = service.updateTask(req.userId, req.params.taskId, patch);
      res.json({ task });
    }),
  );

  return router;
}
