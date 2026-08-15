import type { Agent } from '../domain/agent';
import type { Artifact } from '../domain/artifact';
import type { Decision } from '../domain/decision';
import type { Memory } from '../domain/memory';
import type { Meeting } from '../domain/meeting';
import type { Project } from '../domain/project';
import type { Task } from '../domain/task';

/**
 * Lab Markdown export (productization, outside the SPEC pipeline).
 *
 * Turns a Lab's canonical state into a portable Markdown bundle — the kind of
 * thing a PI can archive, hand to a collaborator, or paste into a report. Pure
 * function: the route composes `LabExportData` through the authorized services
 * and this renders it. Content is dumped verbatim (no HTML escaping — the
 * consumer is Markdown, not HTML); every section is derived from domain rows.
 */

export interface LabExportProject {
  project: Project;
  tasks: Task[];
  artifacts: Artifact[];
  meetings: Meeting[];
}

export interface LabExportData {
  lab: { id: string; name: string; description: string | null; createdAt: string };
  agents: Agent[];
  projects: LabExportProject[];
  decisions: Decision[];
  memories: Memory[];
}

function indentLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

export function buildLabMarkdown(data: LabExportData): string {
  const out: string[] = [];

  // --- Lab ---
  out.push(`# ${data.lab.name}`);
  out.push('');
  out.push(`> ${data.lab.description ?? '（无描述）'}`);
  out.push('');
  out.push(`- 实验室 ID：\`${data.lab.id}\``);
  out.push(`- 创建于：${data.lab.createdAt}`);
  out.push('');

  // --- Agents ---
  out.push('## 成员');
  out.push('');
  if (data.agents.length === 0) {
    out.push('（暂无成员）');
  }
  for (const agent of data.agents) {
    out.push(`### ${agent.name}（${agent.role}）`);
    out.push('');
    out.push(`- 状态：${agent.status}`);
    if (agent.specialization) out.push(`- 专长：${agent.specialization}`);
    if (agent.profile) out.push(`- 简介：${agent.profile}`);
    out.push(`- ID：\`${agent.id}\``);
    out.push('');
  }

  // --- Projects ---
  out.push('## 项目');
  out.push('');
  if (data.projects.length === 0) {
    out.push('（暂无项目）');
  }
  for (const { project, tasks, artifacts, meetings } of data.projects) {
    out.push(`### ${project.title}`);
    out.push('');
    out.push(`- 阶段：${project.stage}｜状态：${project.status}`);
    if (project.objective) {
      out.push('- 目标：');
      out.push('');
      out.push(indentLines(project.objective, '  '));
      out.push('');
    }

    out.push(`#### 任务（${tasks.length}）`);
    out.push('');
    if (tasks.length === 0) {
      out.push('（无任务）');
    }
    for (const task of tasks) {
      out.push(`- [${task.status}] **${task.title}** — 派给 \`${task.assigneeAgentId.slice(0, 8)}…\`，优先级 ${task.priority}`);
      if (task.description) out.push(indentLines(task.description, '  '));
    }
    out.push('');

    out.push(`#### 产物（${artifacts.length}）`);
    out.push('');
    if (artifacts.length === 0) {
      out.push('（无产物）');
    }
    for (const artifact of artifacts) {
      out.push(`- **${artifact.title}**（${artifact.type}，v${artifact.version}）`);
      out.push(indentLines(artifact.content, '  '));
    }
    out.push('');

    out.push(`#### 组会（${meetings.length}）`);
    out.push('');
    if (meetings.length === 0) {
      out.push('（无组会）');
    }
    for (const meeting of meetings) {
      out.push(`- [${meeting.status}] ${meeting.title}`);
      if (meeting.agenda) out.push(indentLines(meeting.agenda, '  '));
    }
    out.push('');
  }

  // --- Decisions ---
  out.push('## 决策');
  out.push('');
  if (data.decisions.length === 0) {
    out.push('（暂无决策）');
  }
  for (const decision of data.decisions) {
    out.push(`- ${decision.statement}`);
    if (decision.rationale) out.push(indentLines(decision.rationale, '  '));
  }
  out.push('');

  // --- Memory ---
  out.push('## 记忆');
  out.push('');
  if (data.memories.length === 0) {
    out.push('（暂无记忆）');
  }
  for (const memory of data.memories) {
    out.push(`- [${memory.scope}] ${indentLines(memory.content, '  ')}`);
    out.push(`   — 来源 ${memory.sourceType} / ${memory.sourceId.slice(0, 8)}…，重要度 ${memory.importance}，${memory.createdAt}`);
  }
  out.push('');

  return out.join('\n');
}

/** Safe filename for a Lab (keeps download names reasonable). */
export function labExportFilename(labName: string): string {
  const sanitized = labName.replace(/[^\w一-龥.-]+/g, '-').replace(/^-+|-+$/g, '');
  return `minilab-${sanitized || 'lab'}-${new Date().toISOString().slice(0, 10)}.md`;
}
