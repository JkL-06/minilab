import { Router } from 'express';
import { z } from 'zod';

import type { MeetingService } from '../application/meetingService';
import { requireUser } from './auth';
import { handle } from './handlers';

const createMeetingSchema = z
  .object({
    title: z.string().min(1).max(300).refine((s) => s.trim().length > 0, 'title must not be empty'),
    agenda: z.string().max(20_000).optional(),
    participantAgentIds: z
      .array(z.string().min(1))
      .min(1, 'a meeting needs at least one participant agent'),
  })
  .strict();

const updateMeetingSchema = z
  .object({
    agenda: z.union([z.string().max(20_000), z.null()]).optional(),
    transcript: z.union([z.string().max(100_000), z.null()]).optional(),
  })
  .strict();

const decisionSchema = z
  .object({
    statement: z
      .string()
      .min(1)
      .max(5_000)
      .refine((s) => s.trim().length > 0, 'statement must not be empty'),
    rationale: z.union([z.string().max(5_000), z.null()]).optional(),
  })
  .strict();

const actionItemSchema = z
  .object({
    title: z.string().min(1).max(300).refine((s) => s.trim().length > 0, 'title must not be empty'),
    assigneeAgentId: z.union([z.string().min(1), z.null()]).optional(),
  })
  .strict();

/**
 * SPEC-009 routes. The Group Meeting is PI-orchestrated:
 *   POST   /projects/:projectId/meetings                  prepare a Meeting (participants + agenda),
 *                                                         generates each participant's structured update
 *   GET    /projects/:projectId/meetings                  list a Project's Meetings (newest first)
 *   GET    /meetings/:meetingId                           the full structured outcome (participants,
 *                                                         updates, decisions, action items, resulting
 *                                                         task ids, memory write ids)
 *   PATCH  /meetings/:meetingId                           edit agenda / discussion transcript
 *   POST   /meetings/:meetingId/start                     scheduled → in_progress
 *   POST   /meetings/:meetingId/decisions                 PI records a Decision
 *   POST   /meetings/:meetingId/action-items              record an Action Item
 *   POST   /meetings/:meetingId/action-items/:id/tasks    generate a follow-up Task from an Action Item
 *   POST   /meetings/:meetingId/complete                  → completed; writes Project/Lab memory
 *
 * All writes flow validate → authorize (Project → Lab) → domain invariant →
 * write. Completion is never "only a transcript": the detail view is the
 * structured record (acceptance #6).
 */
export function meetingRouter(service: MeetingService): Router {
  const router = Router();

  router.use(requireUser);

  router.post(
    '/projects/:projectId/meetings',
    handle((req, res) => {
      const input = createMeetingSchema.parse(req.body);
      const meeting = service.createMeeting(req.userId, req.params.projectId, input);
      res.status(201).json({ meeting });
    }),
  );

  router.get(
    '/projects/:projectId/meetings',
    handle((req, res) => {
      const meetings = service.listProjectMeetings(req.userId, req.params.projectId);
      res.json({ meetings });
    }),
  );

  router.get(
    '/meetings/:meetingId',
    handle((req, res) => {
      res.json(service.getMeetingDetail(req.userId, req.params.meetingId));
    }),
  );

  router.patch(
    '/meetings/:meetingId',
    handle((req, res) => {
      const input = updateMeetingSchema.parse(req.body);
      const meeting = service.updateMeeting(req.userId, req.params.meetingId, input);
      res.json({ meeting });
    }),
  );

  router.post(
    '/meetings/:meetingId/start',
    handle((req, res) => {
      const meeting = service.startMeeting(req.userId, req.params.meetingId);
      res.json({ meeting });
    }),
  );

  router.post(
    '/meetings/:meetingId/decisions',
    handle((req, res) => {
      const input = decisionSchema.parse(req.body);
      const decision = service.recordDecision(req.userId, req.params.meetingId, input);
      res.status(201).json({ decision });
    }),
  );

  router.post(
    '/meetings/:meetingId/action-items',
    handle((req, res) => {
      const input = actionItemSchema.parse(req.body);
      const actionItem = service.createActionItem(req.userId, req.params.meetingId, input);
      res.status(201).json({ actionItem });
    }),
  );

  router.post(
    '/meetings/:meetingId/action-items/:actionItemId/tasks',
    handle((req, res) => {
      const { task, actionItem } = service.generateTaskFromActionItem(
        req.userId,
        req.params.meetingId,
        req.params.actionItemId,
      );
      res.status(201).json({ task, actionItem });
    }),
  );

  router.post(
    '/meetings/:meetingId/complete',
    handle((req, res) => {
      res.json(service.completeMeeting(req.userId, req.params.meetingId));
    }),
  );

  return router;
}
