#!/usr/bin/env node
// 解析 kiro tasks.md → spec-exec.workflow.js 的 args
// 用法：node parse-tasks.mjs <.kiro/specs/<feature>/ 目录> [--parallel] [--review] [--ultracode] [--include-done]
//   输出：JSON（specPath/feature/phases[带分组]/...）打印到 stdout
import { readFileSync } from 'node:fs'
import { basename, join, resolve, dirname, sep } from 'node:path'

const specDir = process.argv[2]
if (!specDir) { console.error('usage: node parse-tasks.mjs <specDir> [--parallel] [--review] [--ultracode] [--include-done]'); process.exit(1) }
const wantParallel = process.argv.includes('--parallel')
const wantUltra = process.argv.includes('--ultracode')
const wantReview = process.argv.includes('--review') || wantUltra   // ultracode 必然要复查
const includeDone = process.argv.includes('--include-done')

const feature = basename(specDir.replace(/\/+$/, ''))

// ── 项目根：spec 所在项目的根目录，= <projectRoot>/.kiro/specs/<feature> 往上三层 ──
// 编排层必须显式知道它。子代理继承的是**主会话的 cwd**，未必是 spec 所在的项目；
// 任务里的相对路径 `src/foo.js` 若不绝对化，会落进主会话仓库而不是目标项目。
const absSpecDir = resolve(specDir.replace(/\/+$/, ''))
const projectRoot = dirname(dirname(dirname(absSpecDir)))   // …/<root>/.kiro/specs/<feature>

// worktree 隔离由 harness 建在**主会话仓库**下。当目标项目不是主会话仓库时，
// 子代理用绝对路径写的是 worktree 外面——隔离层还在，却没有任何改动经过它（实测：worktree 空且被自动回收）。
// 这种"看着有保护、实际没有"比没有保护更危险，所以跨项目时显式关掉，改为完全依赖分组的写入集不相交。
const cwd = resolve(process.cwd())
const sameRepo = projectRoot === cwd || projectRoot.startsWith(cwd + sep)
const isolation = sameRepo ? 'worktree' : null

const md = readFileSync(join(specDir, 'tasks.md'), 'utf8')
const lines = md.split('\n')

// ── 分 Phase 与任务 ──
// kiro tasks.md 的真实结构：主任务 `- [ ] 1. 标题`（分组头，不是执行单元）
//                            子任务 `- [ ] 1.1 标题`（执行单元）
// 兼容旧结构：`## 标题` 也当 Phase；只有子任务、没有主任务时兜底进「Tasks」Phase。
const phases = []
let curPhase = null
let curTask = null
const pushTask = () => { if (curTask && curPhase) curPhase.tasks.push(curTask); curTask = null }
const openPhase = (name) => { pushTask(); if (curPhase) phases.push(curPhase); curPhase = { name, tasks: [] } }

for (const raw of lines) {
  const line = raw.replace(/\s+$/, '')
  const mHeading = line.match(/^##\s+(.+)$/)
  const mBox = line.match(/^\s*-\s*\[([ xX])\]\s*(\d+(?:\.\d+)*)\.?\s+(.+)$/)
  if (mHeading) {
    // Implementation Notes / Rules & Tips 之类的尾部段落不是 Phase
    if (/implementation notes|rules|tips|notes/i.test(mHeading[1])) { pushTask(); if (curPhase) { phases.push(curPhase); curPhase = null } ; continue }
    openPhase(mHeading[1].trim())
    continue
  }
  // 主任务（单段编号，如 "1"）= Phase 头
  if (mBox && !mBox[2].includes('.')) {
    openPhase(`${mBox[2]}. ${mBox[3].trim()}`)
    continue
  }
  if (mBox && !curPhase) openPhase('Tasks')
  const mTask = mBox
  if (mTask && curPhase) {
    pushTask()
    const done = mTask[1].toLowerCase() === 'x'
    let title = mTask[3].trim()
    // (P) 并行标记：kiro 写在编号之后（`1.1 (P) 标题`），也兼容写在行尾
    const parallelHint = /(^|\s)\(P\)(\s|$)/.test(title)
    title = title.replace(/(^|\s)\(P\)(\s|$)/, ' ').trim()
    curTask = { id: mTask[2], desc: title, done, parallelHint, files: [], reqs: [], depends: [], boundary: null, _body: [] }
    continue
  }
  if (curTask) {
    curTask._body.push(line)
    const mReq = line.match(/_Requirements?:\s*(.+?)_/i)
    const mDep = line.match(/_Depends:\s*(.+?)_/i)
    const mBnd = line.match(/_Boundary:\s*(.+?)_/i)
    if (mReq) curTask.reqs = mReq[1].split(/[,，]/).map(s => s.trim()).filter(Boolean)
    if (mDep) curTask.depends = mDep[1].split(/[,，]/).map(s => s.trim()).filter(Boolean)
    if (mBnd) curTask.boundary = mBnd[1].trim()
  }
}
pushTask(); if (curPhase) phases.push(curPhase)

// ── 提取任务的写入集合（并行安全判定的唯一依据）──
// 两个来源，都认：
//   1. `_Boundary: AuthService — `src/auth/`_` —— 规范写法，tasks-generation.md 要求 (P) 任务必须这样写
//   2. 任务正文里的反引号路径 —— 兜底，适配没按规范标注的老 spec
// 只认后者会漏掉规范写法（boundary 行不在 _body 里），那会让"按规范写的 spec"反而并发不起来。
const looksLikePath = (s) => /[\w./-]+\/[\w./-]+/.test(s) && !/\s/.test(s)
const extractPaths = (text, into) => {
  for (const m of (text || '').matchAll(/`([^`]+)`/g)) {
    const tok = m[1].trim()
    // 只取看起来是路径的（含目录分隔、无空格），过滤命令/代码片段
    // 去尾部标点，再去尾斜杠——否则目录写法 `src/auth/` 与其下文件比较时会变成 `src/auth//`，前缀判定失效
    if (looksLikePath(tok) && !tok.includes('(') && !tok.includes('=')) {
      into.add(tok.replace(/[):,;]+$/, '').replace(/\/+$/, ''))
    }
  }
}
for (const ph of phases) for (const t of ph.tasks) {
  const set = new Set()
  extractPaths(t.boundary, set)          // 规范来源优先
  extractPaths(t._body.join('\n'), set)  // 正文兜底
  // 一律绝对化：子代理的 cwd 不保证是本项目，相对路径会写错地方
  t.files = [...set].map(f => f.startsWith('/') ? f : join(projectRoot, f))
  // boundary 写了组件名但没给路径时，退而用组件名做冲突判定：
  // 名字相同即视为冲突，比"文件未知 → 一律冲突"宽松，仍然保守
  t.boundaryTokens = t.boundary && !t.files.length
    ? t.boundary.split(/[,，;；]/).map(s => s.trim().toLowerCase()).filter(Boolean)
    : []
  delete t._body
}

// ── Phase 内自动分组：拓扑分层 + 层内文件冲突拆分 ──
// 保守判据：只有「双方都标了 (P)」或「双方都声明了目标文件且互不重叠」才敢并行。
// 文件未知（任务正文没写反引号路径）时一律视为冲突 —— 否则会把改同一批文件的任务放进同组。
const filesOverlap = (a, b) =>
  a.files.some(f => b.files.some(g => f === g || f.startsWith(g + '/') || g.startsWith(f + '/')))
const tokensOverlap = (a, b) =>
  a.boundaryTokens.some(x => b.boundaryTokens.some(y => x === y))
const overlaps = (a, b) => {
  // 机械证据优先于人工标注：双方都声明了写入集时以写入集为准，(P) 不能推翻它。
  // (P) 是作者的判断，写入集是事实；作者给 `src/auth/` 和 `src/auth/session.ts` 都标 (P)
  // 是很常见的疏忽，短路掉文件检查就会让两个 implementer 同时写同一个文件。
  if (a.files.length && b.files.length) return filesOverlap(a, b)
  if (a.parallelHint && b.parallelHint) return false
  // 双方都只有组件名边界：名字不同就当作不冲突（比"未知即冲突"宽松，但仍要求显式声明过边界）
  if (a.boundaryTokens.length && b.boundaryTokens.length) return tokensOverlap(a, b)
  return true   // 任一方写入集完全未知 → 保守判冲突
}

function groupPhase(tasks) {
  const ids = new Set(tasks.map(t => t.id))
  const inPhaseDeps = (t) => t.depends.filter(d => ids.has(d)) // 只看 phase 内依赖（跨 phase 由串行保证）
  const placed = new Set()
  const groups = []
  let guard = 0
  while (placed.size < tasks.length && guard++ < 100) {
    // 本层：phase 内依赖都已放置的未放置任务
    const layer = tasks.filter(t => !placed.has(t.id) && inPhaseDeps(t).every(d => placed.has(d)))
    if (!layer.length) { // 兜底：剩余全部串行
      for (const t of tasks) if (!placed.has(t.id)) { groups.push([t]); placed.add(t.id) }
      break
    }
    // 层内按文件冲突拆：冲突的拆到不同子组（串行）
    const sub = []
    for (const t of layer) {
      let slot = sub.find(g => !g.some(x => overlaps(x, t)))
      if (!slot) { slot = []; sub.push(slot) }
      slot.push(t)
    }
    for (const g of sub) groups.push(g)
    for (const t of layer) placed.add(t.id)
  }
  return groups
}

// ── 组装 args ──
const outPhases = []
for (const ph of phases) {
  let tasks = ph.tasks
  if (!includeDone) tasks = tasks.filter(t => !t.done)
  if (!tasks.length) continue
  const groups = wantParallel ? groupPhase(tasks) : tasks.map(t => [t])
  outPhases.push({
    name: ph.name,
    groups: groups.map(g => g.map(t => ({ id: t.id, desc: t.desc, files: t.files, reqs: t.reqs }))),
  })
}

// ── 并发度诊断 ──
// 分组器是保守的：没有 (P) 标记、又没在正文里写明目标文件的任务，一律当作互相冲突。
// 所以"全是单任务组"通常不代表任务真的互相依赖，而是 tasks.md 的标注不足。
// 不报出来的话，编排层会以为自己在并行，实际跑了一场全串行的 workflow。
const allTasks = phases.flatMap(p => p.tasks).filter(t => includeDone || !t.done)
const groupsAll = outPhases.flatMap(p => p.groups)
const concurrentGroups = groupsAll.filter(g => g.length > 1)
const maxWidth = groupsAll.reduce((m, g) => Math.max(m, g.length), 0)
const noMarker = allTasks.filter(t => !t.parallelHint && !t.files.length && !t.boundaryTokens.length)

const diagnostics = {
  totalTasks: allTasks.length,
  groups: groupsAll.length,
  concurrentGroups: concurrentGroups.length,
  maxGroupWidth: maxWidth,
  tasksWithoutParallelEvidence: noMarker.map(t => t.id),
  // 计划出来是全串行时，编排层该先回去补标注，而不是照跑
  serialFallback: wantParallel && !concurrentGroups.length,
}

const out = {
  specPath: absSpecDir,
  feature,
  // 子代理据此定位项目；所有 files 已绝对化到该根下
  projectRoot,
  // 'worktree' | null —— 跨项目时为 null，因为 harness 的 worktree 建在主会话仓库下，对本项目无效
  isolation,
  parallel: wantParallel,
  review: wantReview,
  // ultracode：三视角对抗复查（多数决）+ 收尾完整性批评。隐含开启 review
  ultracode: wantUltra,
  dryRun: false,
  phases: outPhases,
  diagnostics,
}
console.log(JSON.stringify(out, null, 2))

// ── 人类可读的分组摘要到 stderr（不污染 stdout 的 JSON）──
const totalTasks = outPhases.reduce((n, p) => n + p.groups.flat().length, 0)
console.error(`\n[parse-tasks] feature=${feature}  任务=${totalTasks}  Phase=${outPhases.length}  parallel=${wantParallel}  ultracode=${wantUltra}`)
for (const p of outPhases) {
  console.error(`  ${p.name}`)
  p.groups.forEach((g, i) => console.error(`    组${i + 1}${g.length > 1 ? ' [并行×' + g.length + ']' : ''}: ${g.map(t => t.id).join(', ')}`))
}
console.error(`\n[项目根] ${projectRoot}`)
if (!sameRepo) {
  console.error(`⚠ 目标项目不在当前工作目录（${cwd}）下。`)
  console.error(`  已关闭 worktree 隔离——harness 的 worktree 建在主会话仓库下，子代理用绝对路径写的是它外面，`)
  console.error(`  隔离层存在却没有任何改动经过它（"看着有保护、实际没有"比没有保护更危险）。`)
  console.error(`  并发安全此时**完全依赖**分组的写入集不相交，所以下面的分组必须可信：写入集未知的任务已被判为互相冲突。`)
}
console.error(`\n[并发度] 组=${groupsAll.length}  可并发组=${concurrentGroups.length}  最大组宽=${maxWidth}`)
if (diagnostics.serialFallback) {
  console.error(`⚠ 计划是全串行——开了 --parallel 也没有任何一组能并发。`)
  console.error(`  ${noMarker.length}/${allTasks.length} 个任务既无 (P) 标记、正文也没写明目标文件（反引号路径），分组器只能保守地判定它们互相冲突。`)
  console.error(`  受影响任务：${noMarker.map(t => t.id).join(', ') || '（无）'}`)
  console.error(`  处理：给真正独立的任务补 (P) 与 _Boundary:_ / 反引号目标文件，再重新生成计划；或接受串行、直接用 impl 的 sequential 档（跑 workflow 无收益）。`)
}
