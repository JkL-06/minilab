import { Router } from 'express';
import { z } from 'zod';

import type { ArtifactService } from '../application/artifactService';
import { requireUser } from './auth';
import { handle } from './handlers';

const createRevisionSchema = z
  .object({
    content: z.string().min(1, 'content must not be empty').max(100_000),
    title: z.string().min(1, 'title must not be empty').max(300).optional(),
    type: z.string().min(1, 'type must not be empty').max(100).optional(),
  })
  .strict()
  .refine((body) => body.content, {
    message: 'content must not be empty',
  });

/**
 * SPEC-008 routes:
 *   GET  /projects/:projectId/artifacts   list a Project's artifacts (newest first)
 *   GET  /artifacts/:artifactId           get one Artifact by ID
 *   POST /artifacts/:artifactId/revisions create the next version of an Artifact
 *
 * Artifacts are PI-readable through the Project → Lab ownership chain; cross-Lab
 * artifacts are never visible (DOMAIN_MODEL invariant #5). Creating artifacts is
 * the Agent Runtime's job (a `succeeded` run materializes its proposals) — the PI
 * only reads and revises them.
 */
export function artifactRouter(service: ArtifactService): Router {
  const router = Router();

  router.use(requireUser);

  router.get(
    '/projects/:projectId/artifacts',
    handle((req, res) => {
      const artifacts = service.listProjectArtifacts(req.userId, req.params.projectId);
      res.json({ artifacts });
    }),
  );

  router.get(
    '/artifacts/:artifactId',
    handle((req, res) => {
      const artifact = service.getArtifact(req.userId, req.params.artifactId);
      res.json({ artifact });
    }),
  );

  router.post(
    '/artifacts/:artifactId/revisions',
    handle((req, res) => {
      const input = createRevisionSchema.parse(req.body);
      const artifact = service.createRevision(req.userId, req.params.artifactId, input);
      res.status(201).json({ artifact });
    }),
  );

  return router;
}
