import express from 'express';

import type { AgentRuntimeService } from '../application/agentRuntimeService';
import type { AgentService } from '../application/agentService';
import type { ArtifactService } from '../application/artifactService';
import type { DashboardService } from '../application/dashboardService';
import type { LabService } from '../application/labService';
import type { MeetingService } from '../application/meetingService';
import type { MemoryService } from '../application/memoryService';
import type { ModelConfigService } from '../application/modelConfigService';
import type { ModelGateway } from '../application/modelGateway';
import type { ProjectService } from '../application/projectService';
import type { TaskService } from '../application/taskService';
import { desktopBrowserFallback } from './auth';
import { agentRunRouter } from './agentRunRoutes';
import { agentRouter } from './agentRoutes';
import { artifactRouter } from './artifactRoutes';
import { dashboardRouter } from './dashboardRoutes';
import { errorHandler } from './errors';
import { labRouter } from './labRoutes';
import { meetingRouter } from './meetingRoutes';
import { memoryRouter } from './memoryRoutes';
import { modelConfigRouter } from './modelConfigRoutes';
import { projectRouter } from './projectRoutes';
import { taskRouter } from './taskRoutes';

export interface ApiDeps {
  labService: LabService;
  agentService: AgentService;
  projectService: ProjectService;
  taskService: TaskService;
  modelConfigService: ModelConfigService;
  modelGateway: ModelGateway;
  agentRuntime: AgentRuntimeService;
  memoryService: MemoryService;
  artifactService: ArtifactService;
  meetingService: MeetingService;
  dashboardService: DashboardService;
}

/**
 * Builds the Express application. Dependencies are injected so tests can
 * supply in-memory or temp-file-backed services without starting a server.
 */
export function createApp({
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
}: ApiDeps): express.Express {
  const app = express();
  app.use(express.json());
  // 桌面版浏览器回退必须在所有路由之前：它只负责给「普通浏览器（Accept:
  // text/html，无 x-user-id）」请求填上本地用户头，之后每个路由的 requireUser
  // 才能通过。npm/源码模式下该中间件是空操作。
  app.use(desktopBrowserFallback);
  app.use(labRouter(labService));
  app.use(agentRouter(agentService));
  app.use(projectRouter(projectService));
  app.use(taskRouter(taskService));
  app.use(modelConfigRouter(modelConfigService, modelGateway));
  app.use(agentRunRouter(agentRuntime));
  app.use(memoryRouter(memoryService));
  app.use(artifactRouter(artifactService));
  app.use(meetingRouter(meetingService));
  app.use(dashboardRouter(dashboardService, labService));
  app.use(errorHandler);
  return app;
}
