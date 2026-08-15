import type { AgentRepository } from '../../src/application/agentRepository';
import type { AgentRunRepository } from '../../src/application/agentRunRepository';
import type { AgentMemorySource } from '../../src/application/agentMemorySource';
import type { ArtifactRepository } from '../../src/application/artifactRepository';
import type { AgentRun } from '../../src/domain/agentRun';
import type { Artifact } from '../../src/domain/artifact';
import type { LabRepository } from '../../src/application/labRepository';
import type { ModelConfigService } from '../../src/application/modelConfigService';
import type { ModelGateway } from '../../src/application/modelGateway';
import type { ProjectRepository } from '../../src/application/projectRepository';
import type { TaskRepository } from '../../src/application/taskRepository';
import { AgentRuntimeService } from '../../src/application/agentRuntimeService';
import { ArtifactService } from '../../src/application/artifactService';
import { TaskService } from '../../src/application/taskService';
import { EmptyAgentMemorySource } from '../../src/infrastructure/memory/emptyAgentMemorySource';
import { inMemoryAgentRunRepository } from './inMemoryAgentRunRepository';
import { inMemoryArtifactRepository } from './inMemoryArtifactRepository';

export interface TestAgentRuntimeInput {
  agentRepo: AgentRepository;
  labRepo: LabRepository;
  projectRepo: ProjectRepository;
  taskRepo: TaskRepository;
  modelConfigService: ModelConfigService;
  gateway: ModelGateway;
  memorySource?: AgentMemorySource;
}

export interface TestAgentRuntimeResult {
  runtime: AgentRuntimeService;
  /** Concrete in-memory repo so tests can inspect the persisted run array. */
  runs: AgentRunRepository & { runs: AgentRun[] };
  memorySource: AgentMemorySource;
  taskService: TaskService;
  /** Concrete in-memory repo so tests can inspect materialized artifacts. */
  artifacts: ArtifactRepository & { artifacts: Artifact[] };
  artifactService: ArtifactService;
}

/**
 * Builds an AgentRuntimeService over the caller's repositories, using a fresh
 * in-memory AgentRunRepository and (by default) the v0.1 empty memory source.
 * Tests that need to prove the memory retrieval path inject a fake `memorySource`.
 * Artifacts are served by a fresh in-memory repository so API/application tests
 * can assert what a `succeeded` run materialized (SPEC-008).
 */
export function testAgentRuntime(input: TestAgentRuntimeInput): TestAgentRuntimeResult {
  const taskService = new TaskService(
    input.taskRepo,
    input.projectRepo,
    input.agentRepo,
    input.labRepo,
  );
  const runs = inMemoryAgentRunRepository();
  const memorySource = input.memorySource ?? new EmptyAgentMemorySource();
  const artifacts = inMemoryArtifactRepository();
  const artifactService = new ArtifactService(artifacts, input.projectRepo, input.labRepo);
  const runtime = new AgentRuntimeService(
    input.agentRepo,
    input.labRepo,
    input.projectRepo,
    input.taskRepo,
    taskService,
    input.modelConfigService,
    input.gateway,
    runs,
    memorySource,
    artifactService,
  );
  return { runtime, runs, memorySource, taskService, artifacts, artifactService };
}
