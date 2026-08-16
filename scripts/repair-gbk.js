#!/usr/bin/env node
/**
 * 修复博士规划中文数据（GBK 污染 → 正确 UTF-8）。
 *
 * 背景：上一轮通过 shell/curl 内联中文参数创建 labs/agents/projects/tasks 时，
 * 中文被 Windows GBK 编码污染（部分字符不可逆地损坏为 U+FFFD）。原始正确数据
 * 完整保存在 Claude 会话 transcript 中。本脚本：
 *   1. 校验内嵌的正确值都能在 transcript 中找到（确认来源）；
 *   2. 备份 DB；
 *   3. 直接用 better-sqlite3 UPDATE（绕过 shell，杜绝再次污染）；
 *   4. 删除 API 测试残留的「中文测试实验室」；
 *   5. 读回自校验。
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const TRANSCRIPT = 'C:/Users/Jingkai Li/.claude/projects/E--MiniLab/ce3df75e-cb53-427a-a1d0-e2e2e4a4b3a7.jsonl';
const DB_PATH = path.join(__dirname, '..', 'data', 'minilab.db');

// ---- 修复数据（全部提取自 transcript 的正确 UTF-8 中文） ----
const FIX = {
  labs: [
    {
      id: 'c45d90e4-f0ae-438a-96a3-8fe796d893bc',
      name: '博士规划实验室',
      description:
        '为博士阶段科研方向与里程碑做长期/中期/短期规划（基于 E 盘现有研究素材），作为 MiniLab 的未来努力方向。',
    },
  ],
  agents: [
    {
      id: '614a69d2-26d0-4937-a577-ec0b2e27bd50',
      name: '规划师·初号机',
      role: '博士研究总规划师',
      specialization:
        '博士四年/学年度/周度规划；研究路线图、里程碑、论文发表路线设计；基于现有素材凝练研究方向',
      profile:
        '资深博士阶段规划专家。掌握认知神经科学（EEG/MEG/fMRI/MVPA）与 AI 对齐（LLM 道德表征、brain-AI alignment、steering/monitoring）两个领域，擅长把研究志趣落成可执行的长期-中期-短期路线。',
    },
    {
      id: '819d5492-dd30-44dc-8d39-1692193b248c',
      name: '方法顾问·认知神经',
      role: '认知神经科学方法顾问',
      specialization:
        '实验设计（行为/EEG/ELAN、MEG/FAVEE-HPP、fMRI、MVPA）；LLM 表征分析方法（探针、流形、干预、steering）；数据分析（R/Python/PCA/CiteSpace）',
      profile: null,
    },
    {
      id: '1b7eb0d8-c398-4e4b-86a4-f55e2c37569c',
      name: '周度执行官',
      role: '执行计划协调员',
      specialization: '把学年度规划拆解为本周可执行任务；时间管理、里程碑监控、产出清单',
      profile: null,
    },
  ],
  projects: [
    { id: '413a8235-5dfd-45e8-ab5e-acbe2d5087cb', title: '端到端链路验证', objective: '验证 真实LLM run 全链路' },
    {
      id: '11501cb9-d705-4939-b23e-1c4d6a4bfe79',
      title: '博士长期规划（四年）',
      objective:
        '2026秋-2030夏 博士四年研究路线图：方向凝练、三大研究里程碑、论文与发表路线、能力建设与时间分配。',
    },
    {
      id: 'a38d738e-ad62-4aac-b4f6-3271da23def2',
      title: '中期规划（2026-2027学年度）',
      objective:
        '把四年路线落成第一学年（2026-2027）的学年/学期级规划：课程、综述、预实验/正式实验、数据采集、论文投稿节奏。',
    },
    {
      id: '91fee242-2ead-4739-b818-b7c88a9b14b1',
      title: '短期规划（下周 8/17-8/23）',
      objective: '把学年度规划落成 2026-08-17 至 2026-08-23 这一周的具体可执行任务与产出清单。',
    },
  ],
  tasks: [
    { id: 'd8bf0ca5-5858-4277-baec-ca904443d7cc', title: '链路验证小任务', description: '用一段话介绍你自己。' },
    {
      id: 'f6417720-795c-446f-9bd1-f212eaab86bc',
      title: '盘点 E 盘素材并凝练博士研究方向',
      description: '归纳研究方向图谱，凝练博士总主题与 3 个可发表子研究问题。',
    },
    {
      id: '31d68ed4-54c9-4f4d-8302-5a527fdac427',
      title: '制定博士四年长期规划路线图',
      description: '基于方向凝练，产出 2026秋-2030夏 四年路线图。',
    },
    {
      id: 'e6f2d21f-26e5-4d15-afbf-8acecefeb684',
      title: '制定 2026-2027 学年度中期规划',
      description: '把四年路线落成第一学年的学期级规划。',
    },
    {
      id: '1f15477b-e7ef-4878-923c-812be8b209f0',
      title: '制定下周（8/17-8/23）执行计划',
      description: '把学年度规划落成下周可执行任务清单。',
    },
  ],
};

const TEST_LAB_ID = '00d3a395-8db3-4700-a81c-83f5ef1f8cb7';

// ---- 1. 校验来源：每个内嵌值都能在 transcript 中找到 ----
console.log('== 1. 校验 transcript 来源 ==');
const transcriptRaw = fs.readFileSync(TRANSCRIPT, 'utf8');
const values = [];
for (const rows of Object.values(FIX)) for (const r of rows) for (const [k, v] of Object.entries(r)) if (typeof v === 'string') values.push(v);
let missing = 0;
for (const v of values) {
  if (!transcriptRaw.includes(v)) {
    missing++;
    console.log('  ✗ transcript 中未找到: ' + v);
  }
}
if (missing > 0) {
  console.log('中止：有 ' + missing + ' 个值在 transcript 中不存在，可能来自记忆偏差，请人工核对。');
  process.exit(1);
}
console.log('  全部 ' + values.length + ' 个值均能在 transcript 中找到 ✓');

// ---- 2. 备份 DB ----
console.log('== 2. 备份 DB ==');
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const backupPath = path.join(__dirname, '..', 'data', `minilab.db.bak-${stamp}`);
fs.copyFileSync(DB_PATH, backupPath);
console.log('  备份: ' + backupPath);

// ---- 3. UPDATE ----
console.log('== 3. 写入修复 ==');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
const now = new Date().toISOString();

const updLab = db.prepare('UPDATE labs SET name=?, description=?, updated_at=? WHERE id=?');
const updAgent = db.prepare('UPDATE agents SET name=?, role=?, specialization=?, profile=?, updated_at=? WHERE id=?');
const updProject = db.prepare('UPDATE projects SET title=?, objective=?, updated_at=? WHERE id=?');
const updTask = db.prepare('UPDATE tasks SET title=?, description=?, updated_at=? WHERE id=?');

const tx = db.transaction(() => {
  for (const l of FIX.labs) updLab.run(l.name, l.description, now, l.id);
  for (const a of FIX.agents) updAgent.run(a.name, a.role, a.specialization, a.profile, now, a.id);
  for (const p of FIX.projects) updProject.run(p.title, p.objective, now, p.id);
  for (const t of FIX.tasks) updTask.run(t.title, t.description, now, t.id);
});
tx();
console.log(`  修复 ${FIX.labs.length} lab, ${FIX.agents.length} agents, ${FIX.projects.length} projects, ${FIX.tasks.length} tasks`);

// ---- 4. 删除测试 lab ----
console.log('== 4. 删除测试 lab ==');
const before = db.prepare('SELECT COUNT(*) c FROM labs WHERE id=?').get(TEST_LAB_ID).c;
if (before > 0) {
  db.prepare('DELETE FROM labs WHERE id=?').run(TEST_LAB_ID);
  console.log('  已删除: 中文测试实验室 (' + TEST_LAB_ID + ')');
} else {
  console.log('  测试 lab 不存在，跳过');
}

// ---- 5. 读回自校验 ----
console.log('== 5. 读回校验 ==');
let ok = 0, fail = 0;
function check(table, id, expected) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  for (const [k, v] of Object.entries(expected)) {
    const got = row[k] ?? null;
    if (got !== v) {
      fail++;
      console.log(`  ✗ ${table}.${id}.${k}\n    期望: ${v}\n    实际: ${got}`);
    } else ok++;
  }
}
for (const l of FIX.labs) check('labs', l.id, l);
for (const a of FIX.agents) check('agents', a.id, a);
for (const p of FIX.projects) check('projects', p.id, p);
for (const t of FIX.tasks) check('tasks', t.id, t);
db.close();

if (fail > 0) {
  console.log(`\n校验失败 ${fail} 处`);
  process.exit(1);
}
console.log(`  全部 ${ok} 个字段读回一致 ✓ 修复完成`);
