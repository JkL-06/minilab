import { Router } from 'express';

import type { DashboardService } from '../application/dashboardService';
import type { LabService } from '../application/labService';
import type { ModelConfigService } from '../application/modelConfigService';
import { requireUser } from './auth';
import { handle } from './handlers';
import { renderDashboardPage, type DashboardModelConfig } from './dashboardView';

/**
 * SPEC-010 routes (ADR-0006 #3). The PI Dashboard is the default UI — it tells
 * the PI what is happening in the Lab without an empty-prompt interaction:
 *
 *   GET /labs/:labId/dashboard   the dashboard. Serves the server-rendered HTML
 *                                page by default (browser); returns the same
 *                                canonical `LabDashboard` as JSON when the client
 *                                sends `Accept: application/json`. No LLM call is
 *                                ever made while serving it (acceptance #5).
 *   GET /                        the product opens on the dashboard: redirect to
 *                                the requester's first Lab's dashboard (or a
 *                                one-line "create your first Lab" page).
 *
 * Acceptance #4 (an Agent is a persistent identity, visually distinct from a
 * temporary chat participant) is realized in the page: agents are rendered as
 * identity cards with their role/specialization/status, never as chat messages.
 */
export function dashboardRouter(
  dashboardService: DashboardService,
  labService: LabService,
  modelConfigService: ModelConfigService,
): Router {
  const router = Router();

  router.use(requireUser);

  router.get(
    '/',
    handle((req, res) => {
      const labs = labService.listLabs(req.userId);
      if (labs.length === 0) {
        // 桌面版首启：浏览器无法 POST 建 Lab，直接给本地用户建一个起始 Lab，
        // 让「双击 exe → 打开即是 PI 仪表盘」（SPEC-010 default UI）成立。
        if (process.env.MINILAB_DESKTOP === '1') {
          const lab = labService.createLab(req.userId, '我的实验室');
          res.redirect(`/labs/${lab.id}/dashboard`);
          return;
        }
        res.type('html').send(renderEmptyLabPage());
        return;
      }
      res.redirect(`/labs/${labs[0].id}/dashboard`);
    }),
  );

  router.get(
    '/labs/:labId/dashboard',
    handle((req, res) => {
      const labId = req.params.labId;
      const dashboard = dashboardService.getLabDashboard(req.userId, labId);
      if (req.accepts(['html', 'json']) === 'html') {
        const modelConfigs: DashboardModelConfig[] = modelConfigService
          .listModelConfigs(req.userId, labId)
          .map((c) => modelConfigService.toView(c));
        const error = typeof req.query.error === 'string' ? req.query.error : null;
        const notice = typeof req.query.notice === 'string' ? req.query.notice : null;
        res.type('html').send(renderDashboardPage(dashboard, { modelConfigs, error, notice }));
      } else {
        res.json({ dashboard });
      }
    }),
  );

  return router;
}

function renderEmptyLabPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MiniLab · 开始</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; background: #f4f6f9; color: #1c2333; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: #fff; border: 1px solid #e2e6ee; border-radius: 10px; padding: 2rem; max-width: 520px; text-align: center; }
  h1 { margin: 0 0 0.5rem; font-size: 1.25rem; }
  code { background: #eef1f6; padding: 0.1rem 0.4rem; border-radius: 4px; }
</style>
</head>
<body>
<div class="card">
  <h1>🏛 欢迎使用 MiniLab</h1>
  <p class="muted">还没有实验室。请先创建一个 Lab，再打开它的 PI Dashboard。</p>
  <p><code>POST /labs  { "name": "你的实验室" }</code></p>
</div>
</body>
</html>`;
}
