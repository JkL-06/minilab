import { z } from 'zod';

import { AgentRunSchemaError } from '../domain/errors';
import type { AgentRunResult } from '../domain/agentRun';

/**
 * Versioned, typed validation of the model's task-completion output
 * (SPEC-006 #6, AGENT_RUNTIME.md step 7).
 *
 * This is the hard gate between raw model text and persistent state: only text
 * that parses AND satisfies the schema becomes an `AgentRunResult` that the
 * Runtime may apply. Everything is `.strict()` so the model cannot smuggle
 * extra (unvalidated) fields past the boundary. The shape version lives in the
 * domain (`AGENT_RUN_RESULT_SCHEMA_VERSION`); bump it when the shape changes and
 * old run records keep their own `result_schema_version`.
 *
 * v2 (SPEC-008 / ADR-0004): artifact proposals may carry optional `content`/`type`
 * so a completed run can materialize durable Artifacts. The created artifact `id`
 * is backfilled by the Runtime into the persisted result — the model can never
 * supply it, and `.strict()` rejects any attempt.
 */

const taskStatusSchema = z.enum(['completed', 'blocked', 'review']);
const artifactProposalSchema = z
  .object({
    title: z.string().min(1, 'title must not be empty').max(200),
    content: z.string().min(1, 'content must not be empty').max(100_000).optional(),
    type: z.string().min(1, 'type must not be empty').max(100).optional(),
  })
  .strict();
const findingSchema = z.object({ claim: z.string().min(1, 'claim must not be empty').max(2000) }).strict();
const questionSchema = z
  .object({ question: z.string().min(1, 'question must not be empty').max(1000) })
  .strict();
const suggestedTaskSchema = z
  .object({
    title: z.string().min(1, 'title must not be empty').max(200),
    rationale: z.string().max(2000).optional(),
  })
  .strict();
const memoryCandidateSchema = z
  .object({
    content: z.string().min(1, 'content must not be empty').max(4000),
    scope: z.enum(['agent', 'project', 'lab']),
  })
  .strict();

const agentRunResultSchemaV1 = z
  .object({
    summary: z.string().min(1, 'summary must not be empty').max(4000),
    task_status: taskStatusSchema,
    artifact_proposals: z.array(artifactProposalSchema),
    findings: z.array(findingSchema),
    questions_for_pi: z.array(questionSchema),
    suggested_tasks: z.array(suggestedTaskSchema),
    memory_candidates: z.array(memoryCandidateSchema),
  })
  .strict();

/** A model may wrap its JSON in a fenced code block; strip that before parsing. */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match ? match[1] : trimmed;
}

/**
 * Parses and validates raw model output. Throws `AgentRunSchemaError` on any
 * failure — the Runtime maps that to a `retryable`/`schema` run.
 */
export function parseAgentRunResult(raw: string): AgentRunResult {
  const text = stripCodeFences(raw);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AgentRunSchemaError('model output is not valid JSON');
  }
  const parsed = agentRunResultSchemaV1.safeParse(data);
  if (!parsed.success) {
    throw new AgentRunSchemaError('model output does not match the task-completion schema');
  }
  return parsed.data as AgentRunResult;
}
