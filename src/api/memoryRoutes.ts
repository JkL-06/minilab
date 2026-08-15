import { Router } from 'express';
import { z } from 'zod';

import type { MemoryService } from '../application/memoryService';
import type { MemoryListFilter } from '../application/memoryRepository';
import { MEMORY_SCOPES, type MemoryScope } from '../domain/memory';
import { requireUser } from './auth';
import { handle } from './handlers';

const scopeEnum = z.enum(MEMORY_SCOPES);

/**
 * PI-authored memory writes. Request bodies are `.strict()`: unknown keys are
 * rejected, and `author` is never accepted from the client — the service always
 * server-sets provenance to the requesting PI (ADR-0003, rule 17).
 */
const writeMemorySchema = z
  .object({
    scope: scopeEnum,
    scopeId: z.string().min(1).max(200).nullish(),
    memoryType: z.string().min(1).max(100).optional(),
    content: z.string().min(1, 'content must not be empty').max(10_000),
    sourceType: z.string().min(1, 'sourceType must not be empty').max(100),
    sourceId: z.string().min(1, 'sourceId must not be empty').max(200),
    importance: z.number().int('importance must be an integer').min(1).max(5).optional(),
  })
  .strict();

const listQuerySchema = z
  .object({
    scope: scopeEnum.optional(),
    scopeId: z.string().min(1).max(200).optional(),
  })
  .strict();

const searchQuerySchema = z
  .object({
    q: z.string().min(1, 'q must not be empty').max(500),
    scope: scopeEnum.optional(),
    scopeId: z.string().min(1).max(200).optional(),
  })
  .strict();

function filterFrom(query: { scope?: MemoryScope; scopeId?: string }): MemoryListFilter | undefined {
  return query.scope || query.scopeId
    ? { scope: query.scope, scopeId: query.scopeId }
    : undefined;
}

/**
 * SPEC-007 routes:
 *   POST /labs/:labId/memory             write scoped memory (PI)
 *   GET  /labs/:labId/memory             list memory, optionally by scope/scopeId
 *   GET  /labs/:labId/memory/search?q=   relevant-memory search over canonical rows
 *
 * Every route authorizes the requester as the Lab owner; the PI may inspect all
 * scopes in their Lab, and cross-Lab memory is never visible.
 */
export function memoryRouter(service: MemoryService): Router {
  const router = Router();

  router.use(requireUser);

  router.post(
    '/labs/:labId/memory',
    handle((req, res) => {
      const input = writeMemorySchema.parse(req.body);
      const memory = service.writeMemory(req.userId, req.params.labId, {
        scope: input.scope,
        scopeId: input.scopeId,
        memoryType: input.memoryType,
        content: input.content,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        importance: input.importance,
      });
      res.status(201).json({ memory });
    }),
  );

  router.get(
    '/labs/:labId/memory/search',
    handle((req, res) => {
      const query = searchQuerySchema.parse(req.query);
      const result = service.searchMemory(
        req.userId,
        req.params.labId,
        query.q,
        filterFrom(query),
      );
      res.json(result);
    }),
  );

  router.get(
    '/labs/:labId/memory',
    handle((req, res) => {
      const query = listQuerySchema.parse(req.query);
      const memories = service.listMemory(req.userId, req.params.labId, filterFrom(query));
      res.json({ memories });
    }),
  );

  return router;
}
