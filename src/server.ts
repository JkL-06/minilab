import { exec } from 'node:child_process';
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

// 产品承诺「打开网页即是 PI 仪表盘」：默认允许普通浏览器（Accept 含 text/html、
// 无 x-user-id 头）以本地单机用户 local-pi 访问 dashboard（见 src/api/auth.ts 的
// desktopBrowserFallback），可显式设 MINILAB_DESKTOP=0 关闭。API/JSON 客户端不受
// 影响，依旧必须携带 x-user-id（SPEC-001 契约不变）。
if (process.env.MINILAB_DESKTOP !== '0') process.env.MINILAB_DESKTOP = '1';

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
  // 打包成桌面版（pkg）时自动打开默认浏览器进 PI 仪表盘
  if (process.env.MINILAB_OPEN_BROWSER === '1') {
    const url = `http://localhost:${port}`;
    const cmd =
      process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
          ? `open "${url}"`
          : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
