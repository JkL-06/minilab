import { MeetingService } from '../../src/application/meetingService';
import type { AgentRepository } from '../../src/application/agentRepository';
import type { ArtifactRepository } from '../../src/application/artifactRepository';
import type { DecisionRepository } from '../../src/application/decisionRepository';
import type { LabRepository } from '../../src/application/labRepository';
import type { MeetingRepository } from '../../src/application/meetingRepository';
import type { MemoryService } from '../../src/application/memoryService';
import type { ProjectRepository } from '../../src/application/projectRepository';
import type { TaskRepository } from '../../src/application/taskRepository';
import type { TaskService } from '../../src/application/taskService';
import { inMemoryDecisionRepository } from './inMemoryDecisionRepository';
import { inMemoryMeetingRepository } from './inMemoryMeetingRepository';

export interface TestMeetingServiceInput {
  projectRepo: ProjectRepository;
  labRepo: LabRepository;
  agentRepo: AgentRepository;
  taskRepo: TaskRepository;
  /** The raw in-memory artifact repo (from `testAgentRuntime`) for grounding updates. */
  artifacts: ArtifactRepository;
  taskService: TaskService;
  memoryService: MemoryService;
  /** Override so another service (e.g. the PI dashboard) can share the same repos. */
  meetings?: MeetingRepository;
  decisions?: DecisionRepository;
}

/**
 * Builds a MeetingService over in-memory meeting/decision repositories and
 * the caller's repos, so API/application tests can wire a complete app without
 * repeating the constructor.
 */
export function testMeetingService(input: TestMeetingServiceInput): MeetingService {
  return new MeetingService(
    input.meetings ?? inMemoryMeetingRepository(),
    input.decisions ?? inMemoryDecisionRepository(),
    input.projectRepo,
    input.labRepo,
    input.agentRepo,
    input.taskRepo,
    input.artifacts,
    input.taskService,
    input.memoryService,
  );
}
