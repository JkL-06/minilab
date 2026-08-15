import { Router } from 'express';
import { z } from 'zod';

import type { LabService } from '../application/labService';
import { requireUser } from './auth';
import { handle } from './handlers';

const createLabSchema = z.object({
  name: z.string().min(1, 'name must not be empty').max(200),
  description: z.string().max(4000).nullish(),
});

const updateLabSchema = z
  .object({
    name: z.string().min(1, 'name must not be empty').max(200).optional(),
    description: z.string().max(4000).nullish(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one of name or description must be provided',
  });

/**
 * SPEC-001 routes:
 *   POST  /labs          create a Lab
 *   GET   /labs          list the current user's Labs
 *   GET   /labs/:labId   get a Lab by ID
 *   PATCH /labs/:labId   update a Lab's name/description
 */
export function labRouter(service: LabService): Router {
  const router = Router();

  router.use(requireUser);

  router.post(
    '/labs',
    handle((req, res) => {
      const input = createLabSchema.parse(req.body);
      const lab = service.createLab(req.userId, input.name, input.description ?? null);
      res.status(201).json({ lab });
    }),
  );

  router.get(
    '/labs',
    handle((req, res) => {
      const labs = service.listLabs(req.userId);
      res.json({ labs });
    }),
  );

  router.get(
    '/labs/:labId',
    handle((req, res) => {
      const lab = service.getLab(req.userId, req.params.labId);
      res.json({ lab });
    }),
  );

  router.patch(
    '/labs/:labId',
    handle((req, res) => {
      const patch = updateLabSchema.parse(req.body);
      const lab = service.updateLab(req.userId, req.params.labId, patch);
      res.json({ lab });
    }),
  );

  return router;
}
