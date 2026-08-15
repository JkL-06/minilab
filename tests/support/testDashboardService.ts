import { DashboardService } from '../../src/application/dashboardService';
import type { AgentRepository } from '../../src/application/agentRepository';
import type { AgentRunRepository } from '../../src/application/agentRunRepository';
import type { ArtifactRepository } from '../../src/application/artifactRepository';
import type { DecisionRepository } from '../../src/application/decisionRepository';
import type { LabRepository } from '../../src/application/labRepository';
import type { MeetingRepository } from '../../src/application/meetingRepository';
import type { ProjectRepository } from '../../src/application/projectRepository';
import type { TaskRepository } from '../../src/application/taskRepository';
import { inMemoryAgentRunRepository } from './inMemoryAgentRunRepository';
import { inMemoryDecisionRepository } from './inMemoryDecisionRepository';
import { inMemoryMeetingRepository } from './inMemoryMeetingRepository';

export interface TestDashboardServiceInput {
  labRepo: LabRepository;
  agentRepo: AgentRepository;
  projectRepo: ProjectRepository;
  taskRepo: TaskRepository;
  artifacts: ArtifactRepository;
  /** Defaults to a fresh in-memory repo; pass the API's repo to share state. */
  meetings?: MeetingRepository;
  decisions?: DecisionRepository;
  runs?: AgentRunRepository;
}

/**
 * Builds a DashboardService for API/application tests. Meetings, decisions, and
 * runs default to fresh in-memory repositories so wiring a `dashboardService`
 * into any `createApp` call site stays one line; pass the same repos the other
 * services use when a test needs the dashboard to see them (e.g. the meeting
 * API test shares its meeting/decision repos).
 */
export function testDashboardService(input: TestDashboardServiceInput): DashboardService {
  return new DashboardService(
    input.labRepo,
    input.agentRepo,
    input.projectRepo,
    input.taskRepo,
    input.artifacts,
    input.meetings ?? inMemoryMeetingRepository(),
    input.decisions ?? inMemoryDecisionRepository(),
    input.runs ?? inMemoryAgentRunRepository(),
  );
}
