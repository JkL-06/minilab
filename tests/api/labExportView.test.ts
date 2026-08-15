import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLabMarkdown, labExportFilename, type LabExportData } from '../../src/api/labExportView';
import type { Agent } from '../../src/domain/agent';
import type { Artifact } from '../../src/domain/artifact';
import type { Decision } from '../../src/domain/decision';
import type { Memory } from '../../src/domain/memory';
import type { Meeting } from '../../src/domain/meeting';
import type { Project } from '../../src/domain/project';
import type { Task } from '../../src/domain/task';

/**
 * The renderer only reads a handful of fields from each entity; a unit test of
 * the output doesn't need full domain objects. The casts keep the fixtures
 * readable while staying type-checked against the shapes the renderer touches.
 */
function sampleData(): LabExportData {
  return {
    lab: { id: 'lab-1', name: '认知实验室', description: '研究 working memory', createdAt: '2026-08-16T00:00:00Z' },
    agents: [
      {
        id: 'agent-1',
        labId: 'lab-1',
        name: 'Alice',
        role: 'researcher',
        status: 'active',
        specialization: 'NLP',
        profile: '资深研究助理',
      } as unknown as Agent,
    ],
    projects: [
      {
        project: { id: 'p1', labId: 'lab-1', title: '注意力综述', stage: 'survey', status: 'active', objective: '横向对比三类机制' } as unknown as Project,
        tasks: [
          {
            id: 't1',
            projectId: 'p1',
            assigneeAgentId: 'agent-1',
            status: 'running',
            title: '收集基线数据',
            description: '至少 3 篇论文',
            priority: 'high',
          } as unknown as Task,
        ],
        artifacts: [{ id: 'a1', projectId: 'p1', title: '基线对比表', type: 'table', version: 1, content: 'A vs B vs C' } as unknown as Artifact],
        meetings: [{ id: 'm1', projectId: 'p1', status: 'completed', title: '中期同步', agenda: '对齐口径', createdAt: 'x', updatedAt: 'x' } as unknown as Meeting],
      },
    ],
    decisions: [{ id: 'd1', meetingId: 'm1', statement: '改用 RAG 路线', rationale: '证据更强' } as unknown as Decision],
    memories: [
      {
        id: 'mem-1',
        labId: 'lab-1',
        scope: 'agent',
        scopeId: 'agent-1',
        content: 'Alice 偏好用 PyTorch',
        sourceType: 'meeting',
        sourceId: 'm1',
        importance: 3,
        createdAt: '2026-08-16T01:00:00Z',
      } as unknown as Memory,
    ],
  };
}

test('buildLabMarkdown renders every section from canonical data', () => {
  const md = buildLabMarkdown(sampleData());
  assert.match(md, /^# 认知实验室$/m);
  assert.match(md, /> 研究 working memory/);
  assert.match(md, /## 成员/);
  assert.match(md, /### Alice（researcher）/);
  assert.match(md, /专长：NLP/);
  assert.match(md, /## 项目/);
  assert.match(md, /### 注意力综述/);
  assert.match(md, /- 阶段：survey｜状态：active/);
  assert.match(md, /目标：/);
  assert.match(md, /横向对比三类机制/);
  assert.match(md, /#### 任务（1）/);
  assert.match(md, /\[running\] \*\*收集基线数据\*\*/);
  assert.match(md, /至少 3 篇论文/);
  assert.match(md, /#### 产物（1）/);
  assert.match(md, /\*\*基线对比表\*\*（table，v1）/);
  assert.match(md, /A vs B vs C/);
  assert.match(md, /#### 组会（1）/);
  assert.match(md, /\[completed\] 中期同步/);
  assert.match(md, /## 决策/);
  assert.match(md, /改用 RAG 路线/);
  assert.match(md, /## 记忆/);
  assert.match(md, /\[agent\]\s+Alice 偏好用 PyTorch/);
});

test('buildLabMarkdown renders empty states when data is empty', () => {
  const empty: LabExportData = {
    lab: { id: 'lab-0', name: '空实验室', description: null, createdAt: 'x' },
    agents: [],
    projects: [],
    decisions: [],
    memories: [],
  };
  const md = buildLabMarkdown(empty);
  assert.match(md, /（暂无成员）/);
  assert.match(md, /（暂无项目）/);
  assert.match(md, /（暂无决策）/);
  assert.match(md, /（暂无记忆）/);
});

test('labExportFilename sanitizes the lab name and pins the date', () => {
  assert.match(labExportFilename('认知实验室'), /^minilab-认知实验室-\d{4}-\d{2}-\d{2}\.md$/);
  assert.match(labExportFilename('a/b c..d'), /^minilab-a-b-c\.\.d-\d{4}-\d{2}-\d{2}\.md$/);
  assert.match(labExportFilename('!!!'), /^minilab-lab-\d{4}-\d{2}-\d{2}\.md$/);
});
