#!/usr/bin/env node
// 从一次 workflow 运行的 transcript 目录重建"谁做完了什么"的账本。
// 用途：workflow 被中断 / 崩溃 / 返回值已滚出上下文时，父层仍要回写 tasks.md——
// 子代理已经把代码写进磁盘了，账不回就是永久失账。
//
// 用法：node recover-run.mjs <transcriptDir> [--json]
//   transcriptDir 形如 ~/.claude/projects/<proj>/<session>/subagents/workflows/wf_xxx
//
// 数据来源（均已对真实 run 校验过，勿凭猜改）：
//   journal.jsonl        每行 {type:"started"|"result", key, agentId, result?}
//                        ★ 不含 label / 任务号，只能靠 agentId 关联
//   agent-<id>.jsonl     该子代理的完整消息流；首条 user 消息里有派单 prompt
//   agent-<id>.meta.json {agentType, worktreePath, spawnDepth}
//
// 任务号只能从 prompt 正文提取——这依赖 spec-exec.workflow.js 的 prompt 措辞。
// 改那边的模板时，这里的锚点要同步改，否则恢复会静默失配。
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node recover-run.mjs <transcriptDir> [--json]')
  process.exit(1)
}
const asJson = process.argv.includes('--json')

const readJsonl = (p) => existsSync(p)
  ? readFileSync(p, 'utf8').trim().split('\n').flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
  : []

// ── 1. journal：agentId → result ──
const journal = readJsonl(join(dir, 'journal.jsonl'))
const resultOf = new Map()
const startedIds = new Set()
for (const row of journal) {
  if (row.type === 'started' && row.agentId) startedIds.add(row.agentId)
  if (row.type === 'result' && row.agentId) resultOf.set(row.agentId, row.result)
}

// ── 2. 每个 agent：从 prompt 认领任务号与角色 ──
// 锚点对应 spec-exec.workflow.js 的三种 prompt：
//   implementer: "- 任务编号：1.1"
//   reviewer:    "- 任务：1.1 — 描述"        + "对抗性验收"
//   debugger:    "- 任务：1.1 — 描述"        + "根因优先地调查"
//   critic:      无任务号（整批）
const agents = []
for (const f of readdirSync(dir)) {
  const m = f.match(/^agent-([0-9a-f]+)\.jsonl$/)
  if (!m) continue
  const agentId = m[1]
  const rows = readJsonl(join(dir, f))
  const firstUser = rows.find(r => r.type === 'user')
  const prompt = firstUser ? JSON.stringify(firstUser.message ?? firstUser) : ''

  // 三种措辞都要认（实测：漏掉任何一种，恢复结果会表现成"这个任务根本没跑过"）：
  //   implementer 正常轮： "- 任务编号：1.1"
  //   reviewer / debugger："- 任务：1.1 — 描述"
  //   implementer dry-run："- 任务 1.1：描述"        ← 与正常轮不同的模板
  let taskId = (prompt.match(/任务编号：\s*(\d+(?:\.\d+)*)/) || [])[1]
    || (prompt.match(/任务[：:]\s*(\d+(?:\.\d+)*)/) || [])[1]
    || (prompt.match(/任务\s+(\d+(?:\.\d+)*)\s*[：:]/) || [])[1]
    || null

  let role = 'unknown'
  if (/对抗性验收/.test(prompt)) role = 'review'
  else if (/根因优先地调查/.test(prompt)) role = 'debug'
  else if (/还缺什么/.test(prompt) || /critic/i.test(prompt)) role = 'critic'
  else if (/AUTONOMOUS MODE|连通性测试（dry-run）/.test(prompt)) role = 'impl'

  const lens = (prompt.match(/验收覆盖视角|边界与设计视角|证据与回归视角/) || [])[0] || null

  let meta = {}
  const metaPath = join(dir, `agent-${agentId}.meta.json`)
  if (existsSync(metaPath)) { try { meta = JSON.parse(readFileSync(metaPath, 'utf8')) } catch {} }

  agents.push({
    agentId, role, taskId, lens,
    agentType: meta.agentType || null,
    worktreePath: meta.worktreePath || null,
    started: startedIds.has(agentId),
    result: resultOf.has(agentId) ? resultOf.get(agentId) : undefined,
  })
}

// ── 3. 按任务聚合 ──
const byTask = new Map()
const orphans = []
for (const a of agents) {
  if (!a.taskId) { orphans.push(a); continue }
  if (!byTask.has(a.taskId)) byTask.set(a.taskId, { taskId: a.taskId, impl: null, reviews: [], debug: null })
  const t = byTask.get(a.taskId)
  if (a.role === 'impl') t.impl = a
  else if (a.role === 'review') t.reviews.push(a)
  else if (a.role === 'debug') t.debug = a
}

// 判定：只认结构化字段，不从散文猜——与 impl SKILL.md 的 Strict Handoff Parsing 同一条规矩
const tasks = [...byTask.values()].map(t => {
  const implStatus = t.impl?.result?.status ?? null
  const votes = t.reviews.map(r => r.result?.verdict).filter(Boolean)
  const rejects = votes.filter(v => v === 'reject').length
  const reviewed = votes.length > 0
  const passed = reviewed && rejects < Math.floor(votes.length / 2) + 1

  let verdict
  if (implStatus === null) verdict = 'INCOMPLETE'          // 派了但没回结果 = 中断点
  else if (implStatus === 'blocked') verdict = 'BLOCKED'
  else if (!reviewed) verdict = 'UNREVIEWED'               // 实现完成但复查未跑完
  else verdict = passed ? 'OK' : 'REJECTED'

  return {
    taskId: t.taskId,
    verdict,
    implStatus,
    filesChanged: t.impl?.result?.files_changed ?? [],
    learnings: t.impl?.result?.learnings ?? [],
    needsManualVerify: t.impl?.result?.needs_manual_verify ?? false,
    blocker: t.impl?.result?.blocker ?? null,
    reviewVotes: t.reviews.map(r => ({ lens: r.lens, verdict: r.result?.verdict ?? '(未返回)' })),
    rejectReasons: t.reviews.flatMap(r => (r.result?.reasons ?? [])),
    debugNextAction: t.debug?.result?.next_action ?? null,
  }
}).sort((a, b) => a.taskId.localeCompare(b.taskId, undefined, { numeric: true }))

const critic = agents.find(a => a.role === 'critic')?.result ?? null
const summary = {
  agentsStarted: startedIds.size,
  agentsReturned: resultOf.size,
  // started 却无 result = 中断时正在飞的子代理。它们可能已经写了一半文件。
  agentsInFlightAtInterrupt: [...startedIds].filter(id => !resultOf.has(id)).length,
}

if (asJson) {
  console.log(JSON.stringify({ dir, summary, tasks, critique: critic, orphans: orphans.length }, null, 2))
} else {
  console.log(`\n[recover-run] ${dir}`)
  console.log(`子代理：派出 ${summary.agentsStarted}｜返回 ${summary.agentsReturned}｜中断时在飞 ${summary.agentsInFlightAtInterrupt}\n`)
  // 失配必须吵——静默漏掉一个任务，看起来和"它本来就没跑"一模一样
  const unclaimed = orphans.filter(o => o.role !== 'critic')
  if (!tasks.length) {
    console.log('  ⚠️  未能从 prompt 认领出任何任务号——prompt 模板可能已改，见文件头注释\n')
  } else if (unclaimed.length) {
    console.log(`  ⚠️  有 ${unclaimed.length} 个子代理未能认领任务号（角色：${[...new Set(unclaimed.map(o => o.role))].join(', ')}）`)
    console.log(`      下面的清单是不完整的。多半是 spec-exec 的 prompt 措辞变了而这里的锚点没跟着改。\n`)
  }
  for (const t of tasks) {
    const mark = { OK: '✅', REJECTED: '❌', BLOCKED: '⛔', UNREVIEWED: '⚠️ ', INCOMPLETE: '🔶' }[t.verdict]
    console.log(`  ${mark} ${t.taskId}  ${t.verdict}${t.needsManualVerify ? '（需人工验证）' : ''}`)
    if (t.filesChanged.length) console.log(`      改动：${t.filesChanged.join(', ')}`)
    if (t.reviewVotes.length) console.log(`      复查：${t.reviewVotes.map(v => `${v.lens || '?'}=${v.verdict}`).join(' / ')}`)
    if (t.blocker) console.log(`      受阻：${t.blocker}`)
    if (t.debugNextAction) console.log(`      调试结论：${t.debugNextAction}`)
    for (const l of t.learnings) console.log(`      经验：${l}`)
  }
  if (critic) console.log(`\n完整性批评：${critic.overall}（${(critic.gaps || []).length} 条缺口）`)
  console.log(`
下一步（父层串行做，逐条来）：
  1. ✅ OK      → 亲自跑一次测试复核 → 勾 [x] → 选择性提交
  2. ⚠️  UNREVIEWED → 实现已落盘但复查没跑完：**先别勾**，补一轮复查再定
  3. 🔶 INCOMPLETE → 中断时在飞：git status 看它写了多少，判断是回滚重做还是接着修
  4. ❌ REJECTED / ⛔ BLOCKED → 按 reasons 走 sequential 档重做
  5. learnings → 追加到 tasks.md 的 ## Implementation Notes
  6. critique.gaps → 单独落盘为新任务，别混进"完成"
`)
}
