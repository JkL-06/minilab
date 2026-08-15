import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import type { ApiDeps } from './app';
import { requireUser } from './auth';
import { handle } from './handlers';
import { renderAgentPage, renderMeetingPage, renderProjectPage, type ProjectPageTask } from './uiView';
import { statusLabel } from './dashboardView';
import { buildLabMarkdown, labExportFilename, type LabExportData } from './labExportView';

/**
 * Browser UI layer (productization, outside the SPEC pipeline).
 *
 * The JSON API stays the contract; this router adds a thin server-rendered UI on
 * top so the whole core loop is doable from the browser — hire an agent, connect
 * a model, create a project/task, run a task, run a meeting — without curl.
 *
 * Routing rules:
 *  - Detail pages (`/projects/:id`, `/meetings/:id`, `/agents/:id`) are served
 *    as HTML **only when the client explicitly asks for `text/html`** (browser
 *    navigation). Every other client falls through to the JSON routes below, so
 *    the API contract is unchanged (curl and script clients still get JSON).
 *  - Form actions live under `/ui/*` (no JSON counterpart), accept
 *    `application/x-www-form-urlencoded`, and redirect back with a `?error=`
 *    or `?notice=` flash. Redirect targets are restricted to same-origin
 *    relative paths (no open redirect).
 *  - `/labs/:labId/export` serves a Markdown bundle of the Lab as a download.
 *
 * Mounted in createApp before all JSON routers.
 */
export function uiRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use(requireUser);

  const {
    labService,
    agentService,
    projectService,
    taskService,
    modelConfigService,
    agentRuntime,
    memoryService,
    artifactService,
    meetingService,
  } = deps;

  const wantsHtml = (req: Request): boolean =>
    String(req.header('accept') ?? '').includes('text/html');
  const dashboardUrl = (labId: string): string => `/labs/${labId}/dashboard`;
  const queryString = (req: Request, key: string): string | null => {
    const v = req.query[key];
    return typeof v === 'string' ? v : null;
  };

  // --- Detail pages: browsers get HTML, everything else falls through ---

  const gated =
    (handler: (req: Request, res: Response) => void) =>
    (req: Request, res: Response, next: NextFunction): void => {
      if (!wantsHtml(req)) {
        next();
        return;
      }
      try {
        handler(req, res);
      } catch (err) {
        next(err);
      }
    };

  router.get(
    '/projects/:projectId',
    gated((req, res) => {
      const project = projectService.getProject(req.userId, req.params.projectId);
      const lab = labService.getLab(req.userId, project.labId);
      const agents = agentService.listAgents(req.userId, project.labId);
      const tasks: ProjectPageTask[] = taskService
        .listTasks(req.userId, project.id)
        .map((t) => ({ ...t, agentName: agents.find((a) => a.id === t.assigneeAgentId)?.name ?? '?' }));
      const artifacts = artifactService.listProjectArtifacts(req.userId, project.id);
      const meetings = meetingService.listProjectMeetings(req.userId, project.id);
      res.type('html').send(
        renderProjectPage({
          project,
          lab,
          agents,
          tasks,
          artifacts,
          meetings,
          error: queryString(req, 'error'),
          notice: queryString(req, 'notice'),
        }),
      );
    }),
  );

  router.get(
    '/meetings/:meetingId',
    gated((req, res) => {
      const detail = meetingService.getMeetingDetail(req.userId, req.params.meetingId);
      const lab = labService.getLab(req.userId, detail.meeting.labId);
      res.type('html').send(
        renderMeetingPage({
          detail,
          lab,
          error: queryString(req, 'error'),
          notice: queryString(req, 'notice'),
        }),
      );
    }),
  );

  router.get(
    '/agents/:agentId',
    gated((req, res) => {
      const agent = agentService.getAgent(req.userId, req.params.agentId);
      const lab = labService.getLab(req.userId, agent.labId);
      const projects = projectService.listProjects(req.userId, agent.labId);
      const titleById = new Map(projects.map((p) => [p.id, p.title]));
      const tasks = taskService.listAgentTasks(req.userId, agent.id).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        projectId: t.projectId,
        projectTitle: titleById.get(t.projectId) ?? '?',
        updatedAt: t.updatedAt,
      }));
      const runs = agentRuntime.listRuns(req.userId, agent.id);
      const memories = memoryService.listMemory(req.userId, agent.labId, {
        scope: 'agent',
        scopeId: agent.id,
      });
      const modelConfigs = modelConfigService
        .listModelConfigs(req.userId, agent.labId)
        .map((c) => modelConfigService.toView(c));
      res.type('html').send(
        renderAgentPage({
          agent,
          lab,
          tasks,
          runs,
          memories,
          modelConfigs,
          error: queryString(req, 'error'),
          notice: queryString(req, 'notice'),
        }),
      );
    }),
  );

  // --- Lab export (always served, no content-negotiation) ---

  router.get(
    '/labs/:labId/export',
    handle((req, res) => {
      const labId = req.params.labId;
      const lab = labService.getLab(req.userId, labId);
      const agents = agentService.listAgents(req.userId, labId);
      const projects = projectService.listProjects(req.userId, labId);
      const projectBlocks = projects.map((project) => ({
        project,
        tasks: taskService.listTasks(req.userId, project.id),
        artifacts: artifactService.listProjectArtifacts(req.userId, project.id),
        meetings: meetingService.listProjectMeetings(req.userId, project.id),
      }));
      const meetings = projectBlocks.flatMap((b) => b.meetings);
      const decisions = meetings.flatMap((m) =>
        meetingService.getMeetingDetail(req.userId, m.id).decisions,
      );
      const memories = memoryService.listMemory(req.userId, labId);
      const data: LabExportData = { lab, agents, projects: projectBlocks, decisions, memories };
      const markdown = buildLabMarkdown(data);
      // RFC 5987: non-ASCII 文件名（如中文 Lab 名）不能直接出现在 header 里，
      // 用 filename* 传 UTF-8 百分号编码，filename 给一个 ASCII 兜底。
      const filename = labExportFilename(lab.name);
      const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '-');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      res.send(markdown);
    }),
  );

  // --- Form helpers ---

  const str = (v: unknown): string => String(v ?? '').trim();
  const strOpt = (v: unknown): string | undefined => {
    const s = String(v ?? '').trim();
    return s.length === 0 ? undefined : s;
  };

  /** Redirect target restricted to same-origin/relative paths (no open redirect). */
  const safeReturn = (req: Request, fallback: string): string => {
    const raw = req.body?._return ?? req.get('referer');
    const candidate = typeof raw === 'string' && raw.length > 0 ? raw : null;
    if (!candidate) return fallback;
    if (candidate.startsWith('/')) return candidate;
    try {
      const url = new URL(candidate);
      if (url.host === req.headers.host) return candidate;
    } catch {
      // fall through to fallback
    }
    return fallback;
  };

  const redirectFlash = (
    req: Request,
    res: Response,
    fallback: string,
    flash: { error?: string; notice?: string },
  ): void => {
    const base = safeReturn(req, fallback);
    const params = new URLSearchParams();
    if (flash.error) params.set('error', flash.error);
    if (flash.notice) params.set('notice', flash.notice);
    const qs = params.toString();
    const sep = base.includes('?') ? '&' : '?';
    res.redirect(302, qs ? `${base}${sep}${qs}` : base);
  };

  const errorMessage = (err: unknown): string =>
    err instanceof Error ? err.message : '操作失败';

  const form =
    (handler: (req: Request, res: Response) => unknown) =>
    (req: Request, res: Response, _next: NextFunction): void => {
      try {
        Promise.resolve(handler(req, res)).catch((err) => {
          redirectFlash(req, res, '/', { error: errorMessage(err) });
        });
      } catch (err) {
        redirectFlash(req, res, '/', { error: errorMessage(err) });
      }
    };

  // --- Form actions (browser-only paths; no JSON counterpart) ---

  router.post(
    '/ui/labs',
    form((req, res) => {
      const lab = labService.createLab(req.userId, str(req.body?.name), strOpt(req.body?.description) ?? null);
      res.redirect(302, dashboardUrl(lab.id));
    }),
  );

  router.post(
    '/ui/labs/:labId/agents',
    form((req, res) => {
      const labId = req.params.labId;
      const agent = agentService.createAgent(req.userId, labId, {
        name: str(req.body?.name),
        role: strOpt(req.body?.role),
        specialization: strOpt(req.body?.specialization),
        profile: strOpt(req.body?.profile),
        modelConfigId: strOpt(req.body?.modelConfigId) ?? null,
      });
      res.redirect(302, `/agents/${agent.id}`);
    }),
  );

  router.post(
    '/ui/labs/:labId/projects',
    form((req, res) => {
      const project = projectService.createProject(req.userId, req.params.labId, {
        title: str(req.body?.title),
        objective: strOpt(req.body?.objective),
      });
      res.redirect(302, `/projects/${project.id}`);
    }),
  );

  router.post(
    '/ui/projects/:projectId/tasks',
    form((req, res) => {
      const task = taskService.createTask(req.userId, req.params.projectId, {
        title: str(req.body?.title),
        description: strOpt(req.body?.description),
        assigneeAgentId: str(req.body?.assigneeAgentId),
        priority: req.body?.priority === 'low' || req.body?.priority === 'high' || req.body?.priority === 'urgent' ? req.body.priority : 'medium',
      });
      res.redirect(302, `/projects/${req.params.projectId}#task-${task.id}`);
    }),
  );

  router.post(
    '/ui/tasks/:taskId/run',
    form(async (req, res) => {
      const task = taskService.getTask(req.userId, req.params.taskId);
      const run = await agentRuntime.runOnce({
        requesterUserId: req.userId,
        agentId: task.assigneeAgentId,
        taskId: task.id,
        instruction: strOpt(req.body?.instruction),
      });
      const outcome =
        run.status === 'succeeded'
          ? '任务执行成功'
          : run.errorCategory
            ? `任务执行未成功（${run.errorCategory}）`
            : '任务执行未成功';
      redirectFlash(req, res, `/projects/${task.projectId}`, { notice: outcome });
    }),
  );

  router.post(
    '/ui/tasks/:taskId/status',
    form((req, res) => {
      const task = taskService.updateTask(req.userId, req.params.taskId, {
        status: str(req.body?.status),
      });
      redirectFlash(req, res, `/projects/${task.projectId}`, {
        notice: `状态已更新为「${statusLabel(task.status)}」`,
      });
    }),
  );

  router.post(
    '/ui/labs/:labId/model-configs',
    form((req, res) => {
      const labId = req.params.labId;
      const config = modelConfigService.createModelConfig(req.userId, labId, {
        name: str(req.body?.name),
        provider: req.body?.provider === 'mock' ? 'mock' : 'openai_compatible',
        model: str(req.body?.model),
        baseUrl: strOpt(req.body?.baseUrl) ?? null,
        apiKey: strOpt(req.body?.apiKey) ?? null,
      });
      redirectFlash(req, res, dashboardUrl(labId), {
        notice: `模型配置「${config.name}」已保存${config.apiKeyEncrypted == null ? '（未填 API Key）' : ''}`,
      });
    }),
  );

  router.post(
    '/ui/agents/:agentId/model-config',
    form((req, res) => {
      const agent = agentService.updateAgent(req.userId, req.params.agentId, {
        modelConfigId: strOpt(req.body?.modelConfigId) ?? null,
      });
      redirectFlash(req, res, `/agents/${agent.id}`, { notice: '模型配置已更新' });
    }),
  );

  router.post(
    '/ui/projects/:projectId/meetings',
    form((req, res) => {
      const raw = req.body?.participantAgentIds;
      const participantAgentIds = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
      const meeting = meetingService.createMeeting(req.userId, req.params.projectId, {
        title: str(req.body?.title),
        agenda: strOpt(req.body?.agenda),
        participantAgentIds,
      });
      res.redirect(302, `/meetings/${meeting.id}`);
    }),
  );

  router.post(
    '/ui/meetings/:meetingId/start',
    form((req, res) => {
      meetingService.startMeeting(req.userId, req.params.meetingId);
      redirectFlash(req, res, `/meetings/${req.params.meetingId}`, { notice: '会议已开始' });
    }),
  );

  router.post(
    '/ui/meetings/:meetingId/decisions',
    form((req, res) => {
      meetingService.recordDecision(req.userId, req.params.meetingId, {
        statement: str(req.body?.statement),
        rationale: strOpt(req.body?.rationale),
      });
      redirectFlash(req, res, `/meetings/${req.params.meetingId}`, { notice: '决策已记录' });
    }),
  );

  router.post(
    '/ui/meetings/:meetingId/action-items',
    form((req, res) => {
      meetingService.createActionItem(req.userId, req.params.meetingId, {
        title: str(req.body?.title),
        assigneeAgentId: strOpt(req.body?.assigneeAgentId),
      });
      redirectFlash(req, res, `/meetings/${req.params.meetingId}`, { notice: '行动项已添加' });
    }),
  );

  router.post(
    '/ui/meetings/:meetingId/action-items/:actionItemId/task',
    form((req, res) => {
      meetingService.generateTaskFromActionItem(
        req.userId,
        req.params.meetingId,
        req.params.actionItemId,
      );
      redirectFlash(req, res, `/meetings/${req.params.meetingId}`, { notice: '已生成跟进任务' });
    }),
  );

  router.post(
    '/ui/meetings/:meetingId/complete',
    form((req, res) => {
      const detail = meetingService.completeMeeting(req.userId, req.params.meetingId);
      redirectFlash(req, res, `/meetings/${req.params.meetingId}`, {
        notice: `组会已完成，写入 ${detail.memoryWriteIds.length} 条记忆`,
      });
    }),
  );

  return router;
}
