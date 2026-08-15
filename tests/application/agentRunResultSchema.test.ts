import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentRunSchemaError } from '../../src/domain/errors';
import { parseAgentRunResult } from '../../src/application/agentRunResultSchema';

const VALID = {
  summary: 'Summarized the evidence base.',
  task_status: 'completed',
  artifact_proposals: [{ title: 'Draft evidence map' }],
  findings: [{ claim: '40 studies found' }],
  questions_for_pi: [{ question: 'Include grey literature?' }],
  suggested_tasks: [{ title: 'Screen full texts', rationale: 'Shortlist needs reading' }],
  memory_candidates: [{ content: 'Scope agreed: 2020–2026', scope: 'project' }],
};

test('a valid structured result parses to the exact snake_case shape', () => {
  const parsed = parseAgentRunResult(JSON.stringify(VALID));
  assert.equal(parsed.summary, VALID.summary);
  assert.equal(parsed.task_status, 'completed');
  assert.deepEqual(parsed.artifact_proposals, VALID.artifact_proposals);
  assert.deepEqual(parsed.suggested_tasks, VALID.suggested_tasks);
  assert.deepEqual(parsed.memory_candidates, VALID.memory_candidates);
});

test('v2: artifact proposals carry optional content/type, preserved verbatim', () => {
  const v2 = {
    ...VALID,
    artifact_proposals: [
      { title: 'Evidence map', content: 'A durable report body…', type: 'report' },
    ],
  };
  const parsed = parseAgentRunResult(JSON.stringify(v2));
  assert.deepEqual(parsed.artifact_proposals, v2.artifact_proposals);
});

test('v2: the model can never supply the created artifact id (ADR-0004)', () => {
  // `.strict()` rejects any extra key on an artifact proposal; the Runtime is the
  // only writer of the created `id`, backfilled after materialization.
  assert.throws(
    () =>
      parseAgentRunResult(
        JSON.stringify({ ...VALID, artifact_proposals: [{ title: 'x', id: 'forged' }] }),
      ),
    AgentRunSchemaError,
  );
  // Empty or oversized content is rejected like every other string field.
  assert.throws(
    () =>
      parseAgentRunResult(
        JSON.stringify({ ...VALID, artifact_proposals: [{ title: 'x', content: '' }] }),
      ),
    AgentRunSchemaError,
  );
});

test('a fenced JSON block (model wrapper) is accepted', () => {
  const parsed = parseAgentRunResult(`\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\``);
  assert.equal(parsed.task_status, 'completed');
  assert.equal(parsed.summary, VALID.summary);
});

test('raw text that is not JSON is rejected', () => {
  assert.throws(() => parseAgentRunResult('Sure, the task is done.'), AgentRunSchemaError);
});

test('schema violations are rejected (unvalidated fields cannot pass the boundary)', () => {
  // Missing required field.
  const missingSummary = { ...VALID };
  delete (missingSummary as { summary?: string }).summary;
  assert.throws(() => parseAgentRunResult(JSON.stringify(missingSummary)), AgentRunSchemaError);

  // Unknown top-level field (strict schema).
  assert.throws(
    () => parseAgentRunResult(JSON.stringify({ ...VALID, secret_payload: 'x' })),
    AgentRunSchemaError,
  );

  // Illegal task_status.
  assert.throws(
    () => parseAgentRunResult(JSON.stringify({ ...VALID, task_status: 'running' })),
    AgentRunSchemaError,
  );

  // Oversized summary.
  assert.throws(
    () => parseAgentRunResult(JSON.stringify({ ...VALID, summary: 'x'.repeat(4001) })),
    AgentRunSchemaError,
  );

  // A suggested task without a title.
  assert.throws(
    () =>
      parseAgentRunResult(
        JSON.stringify({ ...VALID, suggested_tasks: [{ rationale: 'no title' }] }),
      ),
    AgentRunSchemaError,
  );
});
