import assert from 'node:assert/strict';
import test from 'node:test';

import { MODEL_ERROR_CATEGORIES } from '../../src/domain/model';
import { DomainError, ModelGatewayError } from '../../src/domain/errors';

test('MODEL_ERROR_CATEGORIES enumerates the normalized provider failure categories (SPEC-005 #4)', () => {
  assert.deepEqual(MODEL_ERROR_CATEGORIES, [
    'authentication',
    'rate_limit',
    'invalid_request',
    'provider_unavailable',
    'connection_failed',
    'invalid_response',
    'unknown',
  ]);
});

test('ModelGatewayError carries a category and is a DomainError', () => {
  const err = new ModelGatewayError('rate_limit', 'Provider rate limited the request');
  assert.ok(err instanceof DomainError);
  assert.ok(err instanceof Error);
  assert.equal(err.category, 'rate_limit');
  assert.equal(err.message, 'Provider rate limited the request');
});
