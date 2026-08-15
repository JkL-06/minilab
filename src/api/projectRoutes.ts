import { Router } from 'express';
import { z } from 'zod';

import type { ProjectService } from '../application/projectService';
import { PROJECT_STATUSES, RESEARCH_STAGES } from '../domain/project';
import { requireUser } from './auth';
import { handle } from './handlers';

const stageEnum = z.enum(RESEARCH_STAGES);
const statusEnum = z.enum(PROJECT_STATUSES);

/**
 * Request bodies are `.strict()`: unknown keys are rejected rather than
 * silently dropped, so nothing undeclared (secrets included) can slip into a
 * Project row.
 */
const createProjectSchema = z
  .object({
    title: z.string().min(1, 'title must not be empty').max(300),
    objective: z.string().max(10_000).nullish(),
    teamId: z.string().min(1).max(200).nullish(),
    stage: stageEnum.optional(),
    status: statusEnum.optional(),
  })
  .strict();

const updateProjectSchema = z
  .object({
    title: z.string().min(1, 'title must not be empty').max(300).optional(),
    objective: z.string().max(10_000).nullish(),
    teamId: z.string().min(1).max(200).nullish(),
    stage: stageEnum.optional(),
    status: statusEnum.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * SPEC-003 routes:
 *   POST  /labs/:labId/projects   create a Project in a Lab
 *   GET   /labs/:labId/projects   list a Lab's Projects
 *   GET   /projects/:projectId    get a Project by ID
 *   PATCH /projects/:projectId    update a Project (title/objective/stage/status/teamId)
 */
export function projectRouter(service: ProjectService): Router {
  const router = Router();

  router.use(requireUser);

  router.post(
    '/labs/:labId/projects',
    handle((req, res) => {
      const input = createProjectSchema.parse(req.body);
      const project = service.createProject(req.userId, req.params.labId, input);
      res.status(201).json({ project });
    }),
  );

  router.get(
    '/labs/:labId/projects',
    handle((req, res) => {
      const projects = service.listProjects(req.userId, req.params.labId);
      res.json({ projects });
    }),
  );

  router.get(
    '/projects/:projectId',
    handle((req, res) => {
      const project = service.getProject(req.userId, req.params.projectId);
      res.json({ project });
    }),
  );

  router.patch(
    '/projects/:projectId',
    handle((req, res) => {
      const patch = updateProjectSchema.parse(req.body);
      const project = service.updateProject(req.userId, req.params.projectId, patch);
      res.json({ project });
    }),
  );

  return router;
}
