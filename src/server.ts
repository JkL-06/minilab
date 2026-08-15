import { createApp } from './api/app';
import { AgentRuntimeService } from './application/agentRuntimeService';
import { AgentService } from './application/agentService';
import { ArtifactService } from './application/artifactService';
import { DashboardService } from './application/dashboardService';
import { LabService } from './application/labService';
import { MeetingService } from './application/meetingService';
import { MemoryService } from './application/memoryService';
import { KeywordMemorySearch } from './application/memorySearch';
import { ModelConfigService } from './application/modelConfigService';
import { ModelGatewayService } from './application/modelGateway';
import { ProjectService } from './application/projectService';
import { TaskService } from './application/taskService';
import { openDatabase } from './infrastructure/db/database';
import { SqliteAgentRepository } from './infrastructure/db/sqliteAgentRepository';
import { SqliteAgentRunRepository } from './infrastructure/db/sqliteAgentRunRepository';
import { SqliteArtifactRepository } from './infrastructure/db/sqliteArtifactRepository';
import { SqliteDecisionRepository } from './infrastructure/db/sqliteDecisionRepository';
import { SqliteLabRepository } from './infrastructure/db/sqliteLabRepository';
import { SqliteMeetingRepository } from './infrastructure/db/sqliteMeetingRepository';
import { SqliteMemoryRepository } from './infrastructure/db/sqliteMemoryRepository';
import { SqliteModelConfigRepository } from './infrastructure/db/sqliteModelConfigRepository';
import { SqliteProjectRepository } from './infrastructure/db/sqliteProjectRepository';
import { SqliteTaskRepository } from './infrastructure/db/sqliteTaskRepository';
import { OpenAICompatibleAdapter } from './infrastructure/models/adapters/openAiCompatibleAdapter';
import { MockProviderAdapter } from './infrastructure/models/adapters/mockProviderAdapter';
import { getOrCreateCredentialCipher } from './infrastructure/models/credentialCipher';

const port = Number(process.env.PORT ?? 3000);
const databasePath = process.env.DATABASE_PATH ?? './data/minilab.db';

const db = openDatabase(databasePath);
const labRepository = new SqliteLabRepository(db);
const agentRepository = new SqliteAgentRepository(db);
const projectRepository = new SqliteProjectRepository(db);
const labService = new LabService(labRepository);
const agentService = new AgentService(agentRepository, labRepository);
const projectService = new ProjectService(projectRepository, labRepository);
const taskService = new TaskService(
  new SqliteTaskRepository(db),
  projectRepository,
  agentRepository,
  labRepository,
);
const modelConfigService = new ModelConfigService(
  new SqliteModelConfigRepository(db),
  labRepository,
  getOrCreateCredentialCipher(process.env.MODEL_GATEWAY_KEY, `${databasePath}.key`),
);
const modelGateway = new ModelGatewayService({
  openai_compatible: new OpenAICompatibleAdapter(),
  mock: new MockProviderAdapter(),
});
const memoryService = new MemoryService(
  new SqliteMemoryRepository(db),
  labRepository,
  agentRepository,
  projectRepository,
  new KeywordMemorySearch(),
);
const artifactService = new ArtifactService(
  new SqliteArtifactRepository(db),
  projectRepository,
  labRepository,
);
const meetingService = new MeetingService(
  new SqliteMeetingRepository(db),
  new SqliteDecisionRepository(db),
  projectRepository,
  labRepository,
  agentRepository,
  new SqliteTaskRepository(db),
  new SqliteArtifactRepository(db),
  taskService,
  memoryService,
);
const agentRuntime = new AgentRuntimeService(
  agentRepository,
  labRepository,
  projectRepository,
  new SqliteTaskRepository(db),
  taskService,
  modelConfigService,
  modelGateway,
  new SqliteAgentRunRepository(db),
  memoryService,
  artifactService,
);
const dashboardService = new DashboardService(
  labRepository,
  agentRepository,
  projectRepository,
  new SqliteTaskRepository(db),
  new SqliteArtifactRepository(db),
  new SqliteMeetingRepository(db),
  new SqliteDecisionRepository(db),
  new SqliteAgentRunRepository(db),
);
const app = createApp({
  labService,
  agentService,
  projectService,
  taskService,
  modelConfigService,
  modelGateway,
  agentRuntime,
  memoryService,
  artifactService,
  meetingService,
  dashboardService,
});

app.listen(port, () => {
  console.log(`MiniLab API listening on http://localhost:${port}`);
  console.log(`Database: ${databasePath}`);
});
