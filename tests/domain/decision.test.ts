import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDecision,
  validateDecisionRationale,
  validateDecisionStatement,
} from '../../src/domain/decision';
import { DecisionValidationError } from '../../src/domain/errors';

function baseInput(overrides: Partial<Parameters<typeof createDecision>[0]> = {}) {
  return {
    labId: 'lab-1',
    projectId: 'project-1',
    meetingId: 'meeting-1',
    madeByType: 'pi' as const,
    madeById: 'user-1',
    statement: 'Adopt a survey-first stage plan.',
    ...overrides,
  };
}

test('createDecision records a PI decision linked to its Meeting and Project (SPEC-009 #3)', () => {
  const decision = createDecision(baseInput({ rationale: 'The evidence base is thin.' }));

  assert.ok(decision.id);
  assert.equal(decision.labId, 'lab-1');
  assert.equal(decision.projectId, 'project-1');
  assert.equal(decision.meetingId, 'meeting-1');
  assert.equal(decision.madeByType, 'pi');
  assert.equal(decision.madeById, 'user-1');
  assert.equal(decision.statement, 'Adopt a survey-first stage plan.');
  assert.equal(decision.rationale, 'The evidence base is thin.');
  assert.match(decision.createdAt, /Z$/);
});

test('createDecision trims the statement and nullifies an absent rationale', () => {
  const decision = createDecision(baseInput({ statement: '  Decide.  ' }));
  assert.equal(decision.statement, 'Decide.');
  assert.equal(decision.rationale, null);
});

test('createDecision allows null links and an agent maker (domain shape)', () => {
  const decision = createDecision({
    labId: 'lab-1',
    madeByType: 'agent',
    madeById: 'agent-1',
    statement: 'Agent proposal.',
  });
  assert.equal(decision.projectId, null);
  assert.equal(decision.meetingId, null);
  assert.equal(decision.madeByType, 'agent');
});

test('createDecision rejects empty or oversized statements and rationales', () => {
  assert.throws(() => createDecision(baseInput({ statement: '   ' })), DecisionValidationError);
  assert.throws(
    () => createDecision(baseInput({ statement: 'x'.repeat(5_001) })),
    DecisionValidationError,
  );
  assert.throws(
    () => createDecision(baseInput({ rationale: 'x'.repeat(5_001) })),
    DecisionValidationError,
  );
});

test('validators accept conforming values and reject non-conforming ones', () => {
  assert.equal(validateDecisionStatement('  Decide  '), 'Decide');
  assert.equal(validateDecisionRationale('  why  '), 'why');
  assert.equal(validateDecisionRationale('   '), '', 'rationale may be blank whitespace');
  assert.throws(() => validateDecisionStatement(7 as never), DecisionValidationError);
  assert.throws(() => validateDecisionRationale(42 as never), DecisionValidationError);
});
