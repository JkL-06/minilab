/**
 * Domain errors. These are transport-agnostic: the API layer maps them to
 * HTTP status codes via the base classes below.
 */

import type { ModelErrorCategory } from './model';

export class DomainError extends Error {}

/** Maps to HTTP 400. */
export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Maps to HTTP 404. */
export class NotFoundError extends DomainError {
  constructor(
    public readonly resourceId: string,
    message: string,
  ) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Maps to HTTP 403. */
export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have access to this resource') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

// --- Lab ---

export class LabValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'LabValidationError';
  }
}

export class LabNotFoundError extends NotFoundError {
  constructor(public readonly labId: string) {
    super(labId, `Lab not found: ${labId}`);
    this.name = 'LabNotFoundError';
  }
}

export class LabForbiddenError extends ForbiddenError {
  constructor() {
    super('You do not have access to this lab');
    this.name = 'LabForbiddenError';
  }
}

// --- Agent ---

export class AgentValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'AgentValidationError';
  }
}

export class AgentNotFoundError extends NotFoundError {
  constructor(public readonly agentId: string) {
    super(agentId, `Agent not found: ${agentId}`);
    this.name = 'AgentNotFoundError';
  }
}

// --- Project ---

export class ProjectValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectValidationError';
  }
}

export class ProjectNotFoundError extends NotFoundError {
  constructor(public readonly projectId: string) {
    super(projectId, `Project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

// --- Task ---

export class TaskValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'TaskValidationError';
  }
}

export class TaskNotFoundError extends NotFoundError {
  constructor(public readonly taskId: string) {
    super(taskId, `Task not found: ${taskId}`);
    this.name = 'TaskNotFoundError';
  }
}

export class TaskForbiddenError extends ForbiddenError {
  constructor(message = 'You do not have access to this task') {
    super(message);
    this.name = 'TaskForbiddenError';
  }
}

// --- Model Config ---

export class ModelConfigValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'ModelConfigValidationError';
  }
}

export class ModelConfigNotFoundError extends NotFoundError {
  constructor(public readonly modelConfigId: string) {
    super(modelConfigId, `Model config not found: ${modelConfigId}`);
    this.name = 'ModelConfigNotFoundError';
  }
}

// --- Model Gateway ---

/**
 * A normalized provider failure (SPEC-005 #4). Carries a stable error category
 * so callers (and the API) can react without depending on provider SDK types.
 * Messages are always sanitized — provider error bodies and credentials are
 * never echoed (SPEC-005 #5).
 */
export class ModelGatewayError extends DomainError {
  constructor(
    public readonly category: ModelErrorCategory,
    message: string,
  ) {
    super(message);
    this.name = 'ModelGatewayError';
  }
}

// --- Memory ---

export class MemoryValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryValidationError';
  }
}

// --- Artifact ---

export class ArtifactValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactValidationError';
  }
}

export class ArtifactNotFoundError extends NotFoundError {
  constructor(public readonly artifactId: string) {
    super(artifactId, `Artifact not found: ${artifactId}`);
    this.name = 'ArtifactNotFoundError';
  }
}

// --- Meeting (SPEC-009) ---

export class MeetingValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'MeetingValidationError';
  }
}

export class MeetingNotFoundError extends NotFoundError {
  constructor(public readonly meetingId: string) {
    super(meetingId, `Meeting not found: ${meetingId}`);
    this.name = 'MeetingNotFoundError';
  }
}

export class ActionItemNotFoundError extends NotFoundError {
  constructor(public readonly actionItemId: string) {
    super(actionItemId, `Action item not found: ${actionItemId}`);
    this.name = 'ActionItemNotFoundError';
  }
}

// --- Decision (SPEC-009) ---

export class DecisionValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionValidationError';
  }
}

// --- Agent Run ---

export class AgentRunValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRunValidationError';
  }
}

export class AgentRunNotFoundError extends NotFoundError {
  constructor(public readonly runId: string) {
    super(runId, `Agent run not found: ${runId}`);
    this.name = 'AgentRunNotFoundError';
  }
}

/**
 * The model's output did not parse or did not satisfy the typed
 * task-completion schema. It is an execution failure, not a client error, so it
 * does not extend ValidationError; the runtime classifies it as a `schema`
 * (retryable) run failure.
 */
export class AgentRunSchemaError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRunSchemaError';
  }
}

// --- User (multi-user accounts) ---

export class UserValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'UserValidationError';
  }
}

export class UserNotFoundError extends NotFoundError {
  constructor(public readonly userId: string) {
    super(userId, `User not found: ${userId}`);
    this.name = 'UserNotFoundError';
  }
}

/** Login failed (unknown username or wrong password). Never distinguishes which. */
export class AuthenticationError extends DomainError {
  constructor() {
    super('Invalid username or password');
    this.name = 'AuthenticationError';
  }
}

export class PasswordValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordValidationError';
  }
}

// --- Voice (ASR / TTS) ---

export class VoiceError extends DomainError {
  constructor(
    public readonly category: 'authentication' | 'invalid_request' | 'provider_unavailable' | 'connection_failed' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'VoiceError';
  }
}
