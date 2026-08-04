export const meta = {
  name: 'kiro-spec-exec',
  description: '执行一个已就绪的 kiro spec：Phase 间串行 + 组内按文件冲突并行 + 每任务 implement→多视角对抗复查→debug 流水 + 收尾完整性批评',
  whenToUse: '当一个 kiro spec 已 ready_for_implementation，要用 subagents 批量完成 tasks.md 里的开发任务时',
  phases: [
    { title: 'Implement', detail: '实现每个任务（遵循 kiro impl 规范）' },
    { title: 'Review', detail: '多视角对抗性验收（kiro-review 协议，多数决）' },
    { title: 'Debug', detail: '打回/受阻任务的根因调查（kiro-debug 协议）' },
    { title: 'Critic', detail: '收尾完整性批评：整批交付里还漏了什么' },
  ],
}

// ── 从主对话传入的 args 读取执行计划 ──────────────────────────────
// args 可能以对象或 JSON 字符串形式到达，统一归一化
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const specPath = A.specPath                        // 例：.kiro/specs/agent-slash-completion
const feature = A.feature                          // 例：agent-slash-completion
const taskPhases = A.phases || []                  // [{ name, groups: [[task,...],...] }]
// { test, scopedTest, typecheck, lint }
// test = 全量套件，只发给 evidence 视角复查者和（workflow 之外的）父层；
// scopedTest = 按文件跑的命令模式，发给实现者，运行时拼上本任务的目标文件。
// 两者分发对象不同是有意的：实现者跑全量既不构成复查者会采信的证据，
// 并发时看到的红还有一半来自兄弟任务——它会去"修"不属于自己的东西。
const commands = A.commands || {}
const par = A.parallel === true                    // 组内并行开关
const review = A.review === true                   // 复查阶段开关
const debugOn = A.debug !== false                  // 打回/受阻后的调试轮（默认开）
const dryRun = A.dryRun === true                   // 连通性空跑（不改代码）
const projectRoot = A.projectRoot || null          // spec 所在项目根（子代理的 cwd 未必是它）
// 'worktree' | null。parse-tasks 在跨项目时置 null：harness 的 worktree 建在主会话仓库下，
// 子代理用绝对路径写的是它外面，隔离形同虚设。未提供该字段时退回旧行为（并行且非空跑则隔离）。
const isolation = A.isolation !== undefined ? A.isolation : ((par && !dryRun) ? 'worktree' : null)
const ultra = A.ultracode === true                 // ultracode：多视角对抗复查 + 收尾完整性批评

// 复查视角：ultracode 下每个任务并发派多名视角不同的复查者，多数决
// 单票复查看的是"同一个人问三遍"，多视角看的是"三种失败方式各查一遍"——后者才抓得住冗余抓不到的漏洞
const LENSES = {
  acceptance: '**验收覆盖视角**：逐条比对 requirements.md 里被引用的 EARS 验收标准，只认可观测行为，不认「代码看起来实现了」。任何一条标准没有对应的可观测证据即 reject。',
  boundary: '**边界与设计视角**：比对 design.md 的边界承诺与 `_Boundary:_` 范围。越界改动、提前使用未来任务的代码、悄悄引入的跨模块耦合或共享所有权，一律 reject。',
  evidence: '**证据与回归视角**：亲自跑测试/类型检查/lint（命令见下），不信实现者自述。测试是否真能在实现被破坏时失败？是否有占位符、TODO、硬编码密钥、只在 happy path 成立的实现？证据不足即 reject。',
}
const lenseKeys = Array.isArray(A.reviewLenses) && A.reviewLenses.length
  ? A.reviewLenses.filter((k) => LENSES[k])
  : (ultra ? ['acceptance', 'boundary', 'evidence'] : ['acceptance'])
// 多数决门槛：过半 reject 即判定 reject。按**实际派出的票数**算，不能按 lenseKeys 固定死——
// 三视角要 2 票才打回，单名复查者 1 票就该打回；用固定值会让降档后的复查形同虚设。
// 注意 2 票制是这条公式下最差的取值（floor(2/2)+1 = 2 = 全票才打回，比三视角更宽松），
// 所以下面的降档只在 3 和 1 之间切，不取 2。
const rejectThreshold = (n) => Math.floor(n / 2) + 1

// 三视角是按需升级的，不是默认。理由是并发预算而非质量取舍：
// harness 同时最多跑 min(16, 核数-2) 个子代理（10 核机器 = 8）。组宽 3 时，
// 3 任务 × 3 视角 = 9 个复查者恰好越过 8 —— 多出来的那一个独占一整批，
// 让 review 阶段的墙钟翻倍，而那一批里另外 7 个槽全是空转。
// 单名复查者跑的是 kiro-review 的完整 12 项协议（该协议本身认可这种形态），
// 只有下列机械判据命中时才值得为一个任务花三倍的复查预算。
const RISK = Object.assign({ files: 3, reqs: 3 }, A.riskThresholds || {})
function highRisk(task, impl) {
  if (!ultra) return false
  if (impl.needs_manual_verify) return true
  if (Array.isArray(impl.concerns) && impl.concerns.length) return true
  if ((task.files || []).length >= RISK.files) return true      // 改动面宽
  if ((task.reqs || []).length >= RISK.reqs) return true        // 一个任务背了多条需求
  return false
}

// 边界预筛：把实现者自述的改动文件与任务声明的写入集做差集。
// 这是纯数据比对，不值得花一个子代理的推理去做，而且它比 agent 更可靠——
// 不做判定，只做定位：结果直接塞进复查提示，省掉复查者自己 git diff + 逐个比对的往返。
// 不能据此直接 reject：design 要求改测试文件而边界漏列它，是**边界标注的错**，
// 实现者照 design 改是对的（见 implementPrompt 铁律 2.5）。所以越界只提升复查强度，不代替判定。
function boundaryDiff(task, impl) {
  const declared = task.files || []
  if (!declared.length) return null                              // 没标边界，无从比对
  const abs = (f) => (f.startsWith('/') ? f : `${projectRoot || '.'}/${f}`.replace(/\/\.\//g, '/'))
  const outside = (impl.files_changed || [])
    .map(abs)
    .filter((f) => !declared.some((d) => f === d || f.startsWith(d + '/')))
  return outside.length ? outside : null
}

// agentType 可覆盖；置 null 则不指定（用默认 workflow subagent）
const AT = Object.assign(
  { impl: 'task-executor', review: 'spec-task-reviewer', debug: null },
  A.agentTypes || {},
)

// 每类子代理的模型。implementer 默认 sonnet：实现是量大、规格已经写死的活，
// 用便宜快的档；判定类（复查/调试/批评）不降档——对抗复查降档等于放弃这道闸门。
// 置 null 表示继承主循环模型。
const MODELS = Object.assign(
  { impl: 'sonnet', review: null, debug: null, critic: null },
  A.models || {},
)

// 每类子代理的推理档位（'low'|'medium'|'high'|'xhigh'|'max'）。默认全部继承会话档位。
// 这是给「任务批量大、单个任务机械」的 spec 用的旋钮：把 impl 压到 low 通常安全，
// review 不要轻易压——判定质量正是这道闸门的全部价值。压之前先看清楚这个 spec 的任务
// 是不是真的只是照着 design 誊写；如果需要设计判断，降档省下的时间会在 debug 轮里还回去。
const EFFORTS = Object.assign({ impl: null, review: null, debug: null, critic: null }, A.efforts || {})

// ── skill 调用规约（注入每个子代理的 prompt）──────────────────────
// 子代理有 Skill 工具；宿主未注册项目级 kiro-* 时，回退读 kiro skill 自带的阶段规范。
const SKILL_HOME = '~/.claude/skills/kiro/phases'
function skillRule(pairs) {
  const lines = pairs.map(([sk, dir, when]) =>
    `- ${when} → \`Skill(${sk})\`；宿主未注册该 skill 时，改读 \`${SKILL_HOME}/${dir}/SKILL.md\` 并照其协议执行。`)
  return `## 可用 skill（必须按时机调用）
你拥有 \`Skill\` 工具。
${lines.join('\n')}
其余 kiro 阶段同理：先试 \`Skill(kiro-<x>)\`，不存在就读 \`${SKILL_HOME}/<x>/SKILL.md\`。`
}

// ── 结构化输出契约 ────────────────────────────────────────────────
const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    files_changed: { type: 'array', items: { type: 'string' } },
    verification: { type: 'string' },
    learnings: { type: 'array', items: { type: 'string' } },
    // 实现者自己觉得复查者该重点看的地方。非空是升级到三视角复查的触发条件之一，
    // 所以它不是可有可无的礼貌字段——诚实填写会换来更严格的复查，隐瞒则相反。
    concerns: { type: 'array', items: { type: 'string' } },
    needs_manual_verify: { type: 'boolean' },
    status: { type: 'string', enum: ['done', 'blocked'] },
    blocker: { type: 'string' },
  },
  required: ['status'],
}
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'reject'] },
    reasons: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict'],
}
const DEBUG_SCHEMA = {
  type: 'object',
  properties: {
    root_cause: { type: 'string' },
    next_action: { type: 'string', enum: ['RETRY_TASK', 'BLOCK_TASK', 'STOP_FOR_HUMAN'] },
    fix_plan: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['root_cause', 'next_action'],
}

// ── prompt 模板（运行时注入动态上下文）──────────────────────────────
// 项目根块：子代理继承的是主会话的 cwd，未必是本项目。不说清楚，相对路径会写进别的仓库。
const rootBlock = projectRoot
  ? `## ⚠ 项目根目录（先读这条）
本任务的项目根是 **${projectRoot}**。

- 你的 cwd **不保证**是这里——动手前先确认，需要时显式 \`cd\`。
- 所有路径一律用绝对路径。**禁止**在项目根之外创建或修改任何文件。
- 跑命令请在项目根下跑（下方"可用命令"已含 cd）。
`
  : ''

// 按角色分发命令：谁跑全量套件是有意收窄的，见文件头 commands 注释。
// role: 'implement' | 'review' | 'debug' | 'critic'
function commandBlock(task, role) {
  const tc = `- 类型检查：${commands.typecheck || '（未提供，自行从 tech.md 查）'}
- Lint：${commands.lint || '（未提供）'}`

  if (role === 'implement') {
    const files = (task.files || []).join(' ')
    const scoped = commands.scopedTest
      ? `${commands.scopedTest} ${files}`.trim()
      : '（未提供按文件跑的命令，自行从 tech.md 查出如何只跑指定测试文件）'
    return `## 可用命令（你的验证预算就这三条）
- 本任务范围内的测试：\`${scoped}\`
  拼上的是你的目标文件；测试文件在别处时替换成对应的测试路径。
${tc}

**禁止跑全量测试套件 / e2e / 构建 / 冒烟命令。** 回归安全由复查者判定、由父层在合并结果上复核，各跑一次全量；你跑的那次两边都不采信，纯属重复成本。并发波次里全量套件的红有一半来自兄弟任务的半成品，你去"修"只会越界。担心本任务会破坏范围外的东西，就写进 concerns 点名要查什么。`
  }

  if (role === 'review') {
    return `## 可用命令
- 全量测试套件：${commands.test || '（未提供，自行从 tech.md 查）'}
${tc}

跑全量是**你的**职责：实现者只跑了自己边界内的测试，本任务的回归结论由你这一次运行给出。`
  }

  // debug / critic：诊断与收尾需要看全貌，两条都给
  return `## 可用命令（来自 tech.md）
- 全量测试套件：${commands.test || '（未提供，自行从 tech.md 查）'}
- 按文件跑测试：${commands.scopedTest || '（未提供）'}
${tc}`
}

function contextBlock(task, role = 'debug') {
  const st = projectRoot ? `${projectRoot}/.kiro/steering` : '.kiro/steering'
  return `## 上下文（自行按需读取，不要猜目录结构）
- 需求全文：${specPath}/requirements.md（重点看 Requirements ${(task.reqs || []).join(', ') || '（未标注，通读）'}）
- 技术设计：${specPath}/design.md
- 任务清单与既往经验：${specPath}/tasks.md 的 \`## Implementation Notes\` / "Rules & Tips" 段（若存在，先读）
- 测试/构建命令与技术约定：${st}/tech.md
- 目录/命名约定：${st}/structure.md

${commandBlock(task, role)}`
}

function implementPrompt(task, repair) {
  const files = (task.files || []).join(', ')
  if (dryRun) {
    return `连通性测试（dry-run）。你在 kiro 执行流水线中收到一个任务。**请勿读取或修改任何文件**，仅回显以确认调度链路：
- Spec：${feature}
- 任务 ${task.id}：${task.desc}
- 目标文件：${files}

返回结构化结果：files_changed=目标文件；verification="dry-run 跳过"；status="done"；learnings=[]；needs_manual_verify=false`
  }
  const repairBlock = repair
    ? `\n## ⚠ 这是修复轮
上一轮失败的根因与修复方案（由调试者给出，按它执行，不要另起炉灶）：
- 根因：${repair.root_cause}
- 修复方案：${repair.fix_plan || '（未给出，按根因自行拟定最小修复）'}
- 备注：${(repair.notes || []).join('；') || '无'}
工作树保留了上一轮的改动，**用显式编辑修复**，禁止 \`git checkout .\` / \`git reset --hard\` 之类的破坏性回滚。\n`
    : ''
  return `你在一条自动化执行流水线中，以 AUTONOMOUS MODE 实现 kiro spec 的【单个】任务。

${rootBlock}
## 本次任务
- Spec：${feature}（目录 ${specPath}）
- 任务编号：${task.id}
- 任务描述：${task.desc}
- 目标文件：${files}
- 覆盖的需求：Requirements ${(task.reqs || []).join(', ')}
${repairBlock}
${contextBlock(task, 'implement')}

${skillRule([
  ['kiro-verify-completion', 'verify-completion', '在把 status 置为 done、宣称「完成/通过」之前'],
  ['kiro-debug', 'debug', '同一处失败连续修 2 次仍不过时'],
])}

## 铁律
1. 只实现【本条任务】。不得实现、引用、调用任何"未来任务"才引入的代码。
2. 改动范围严格限制在目标文件；确需改动其他文件时在结果里说明理由。
2.5 **若 design.md 要求本任务同时改某个测试文件，而"目标文件"里没有它**——这是边界标注漏了，不是叫你跳过它。照 design 把测试一起改掉，并在 learnings 里明确写"边界漏列了 <文件>"。反过来也要警觉：如果你的实现无法被现有测试区分（改回旧写法测试照样绿），那测试对本任务零区分度，等于没有验证——必须补到能区分为止。
3. **不要修改 tasks.md、不要勾选复选框、不要改 spec.json**——状态回写由编排层统一处理，你并发写会撞车。
4. 也不要 commit；提交由编排层在 workflow 之外按任务粒度做。
5. 实现后自行验证：类型检查 + **本任务边界内的测试文件** + lint，失败最多修复 3 次。不跑全量套件（理由见「可用命令」）。若红明显来自边界之外，写进 concerns 别动手。
6. 若需人工手测而无法自动验证，不要阻塞：标记 needs_manual_verify=true 并说明验收方法。
7. 卡死时 status="blocked" 并在 blocker 里写清现象与已试过的手段，不要假装完成。

## 返回（结构化）
files_changed / verification / learnings / concerns / needs_manual_verify / status(done|blocked) / blocker

\`concerns\`：你希望复查者重点看的地方——边界外可能被影响的东西、你没能验证的假设、绕过的坑。
非空会让本任务从单名复查者升级为三视角对抗复查，所以照实写；隐瞒换来的是更弱的复查，不是更快的通过。`
}

function reviewPrompt(task, impl, lens, breach) {
  const lensBlock = lens
    ? `\n## 你的复查视角（只从这个视角挖，挖深挖透，别面面俱到）
${LENSES[lens]}
其他视角有别的复查者并发负责，你不必兼顾；发现越界问题可在 reasons 里附一句，但判定只依据你的视角。\n`
    : `\n## 你是本任务**唯一**的复查者
按 kiro-review 协议把 12 项检查全部跑一遍——验收覆盖、边界、证据三类都归你，没有人并发兜底。
（高风险任务才拆三视角；本任务经机械判据判定为常规任务，所以由你一人独立完成完整复查。）\n`
  // 边界预筛结果由编排层用纯数据比对得出，直接给你，省掉自己逐个比对的往返。
  // 注意它只是定位，不是判定：design 要求改的文件而 tasks.md 边界漏列，责任在标注不在实现者。
  const breachBlock = breach && breach.length
    ? `\n## ⚠ 边界预筛：有改动落在声明的写入集之外
${breach.map((f) => `- ${f}`).join('\n')}
声明的写入集：${(task.files || []).join(', ') || '（未声明）'}

判断它属于哪一种，不要默认第一种：
1. 实现者跑偏／越权改了别人的东西 → reject
2. design 要求本任务改这个文件（常见于测试文件），而 tasks.md 的 \`_Boundary:_\` 漏列了它
   → **不 reject**，在 reasons 里写明"边界标注漏列 <文件>"，修的是标注不是代码\n`
    : ''
  return `对抗性验收一个已实现的 kiro 任务。**你不写代码、不修改任何文件**，只读、只判定。
${lensBlock}
${rootBlock}
## 复查对象
- Spec：${feature}（${specPath}）
- 任务：${task.id} — ${task.desc}
- 须满足的验收标准：${specPath}/requirements.md 中 Requirements ${(task.reqs || []).join(', ')}（自行读取核对）
- 设计约束：${specPath}/design.md 相关部分
- 实现者产出（仅供参考，必须独立核实）：
  - 改动文件：${JSON.stringify(impl.files_changed || [])}
  - 自测结果：${impl.verification || '（无）'}

${breachBlock}
## 首要证据
自己跑 \`git diff\`（必要时 \`git status --porcelain\`）读真实改动，以 diff 为准，不以实现者的自述为准。
${(!lens || lens === 'evidence') ? `
${commandBlock(task, 'review')}

注意：实现者按约定**只跑了本任务边界内的测试**，它的自测结果不覆盖回归。全量套件必须由你跑，且要跑到项目的每一个测试面——只跑根命令而漏掉子包套件，等于没跑。
` : ''}
${skillRule([
  ['kiro-review', 'review', '开始判定前（按该协议逐条核对边界、验收标准与证据）'],
])}

## 判定（默认怀疑，宁可打回）
1. 是否完整覆盖每一条 EARS 验收标准？
2. 是否越界或提前用了未来任务的代码？
3. 是否符合 design.md？
4. 自测是否真通过、覆盖关键路径？（证据不足即 reject）

输出 VERDICT：verdict(pass|reject) / reasons / suggestions`
}

function debugPrompt(task, failure) {
  return `根因优先地调查一次 kiro 任务失败。你在**全新上下文**里工作，没有失败过程的记忆——这正是为了避免陷入重试循环。

${rootBlock}
## 失败对象
- Spec：${feature}（${specPath}）
- 任务：${task.id} — ${task.desc}
- 失败信息：${failure}

## 证据
自己跑 \`git diff\`（必要时 \`git status --porcelain\`）看当前未提交改动；按需复现失败（跑测试/构建/冒烟命令）。

${contextBlock(task)}

${skillRule([
  ['kiro-debug', 'debug', '开始调查前（按该协议做根因分析，禁止症状级 workaround）'],
])}

## 铁律
- **不写业务代码、不改文件**，只诊断并给修复方案；修复由下一轮实现者执行。
- 找到根因才给方案；找不到就 next_action=STOP_FOR_HUMAN，别猜。
- 若根因属于上游 spec / 依赖契约，不要在本任务里绕过：next_action=BLOCK_TASK 并写清归属。

## 返回（结构化）
root_cause / next_action(RETRY_TASK|BLOCK_TASK|STOP_FOR_HUMAN) / fix_plan / notes`
}

// ── 单任务流水：implement →（可选）review →（可选）debug + 一次重做 ──
const MAX_DEBUG_ROUNDS = 1   // 每任务最多一轮 debug + 一次重做

async function runOnce(task, repair) {
  const implOpts = {
    label: `impl:${task.id}${repair ? ':retry' : ''}`,
    phase: 'Implement',
    schema: IMPL_SCHEMA,
  }
  if (AT.impl) implOpts.agentType = AT.impl
  if (MODELS.impl) implOpts.model = MODELS.impl
  if (EFFORTS.impl) implOpts.effort = EFFORTS.impl
  if (par && !dryRun && isolation) implOpts.isolation = isolation

  const impl = await agent(implementPrompt(task, repair), implOpts)
  if (!impl) return { impl: null, verdict: null, failure: 'implementer 子代理异常退出' }

  if (impl.status === 'blocked') {
    return { impl, verdict: null, failure: `implementer BLOCKED：${impl.blocker || '未说明'}` }
  }
  if (!review || dryRun || impl.needs_manual_verify) return { impl, verdict: null, failure: null }

  // 复查强度按任务风险定：默认一名全项复查者，高风险才上三视角。
  // 越界（边界预筛命中）本身就是风险信号——它要么是实现者跑偏，要么是 tasks.md 的边界漏标，
  // 两种都需要 boundary 视角亲自判，所以强制升级。
  const breach = boundaryDiff(task, impl)
  const escalate = highRisk(task, impl) || !!breach
  const lenses = escalate ? lenseKeys : [null]   // null → 单名复查者跑完整 12 项协议

  const votes = (await parallel(lenses.map((lens) => () => {
    const vOpts = {
      label: lens ? `review:${task.id}:${lens}` : `review:${task.id}`,
      phase: 'Review',
      schema: VERDICT_SCHEMA,
    }
    if (AT.review) vOpts.agentType = AT.review
    if (MODELS.review) vOpts.model = MODELS.review
    if (EFFORTS.review) vOpts.effort = EFFORTS.review
    return agent(reviewPrompt(task, impl, lens, breach), vOpts)
      .then((v) => (v ? Object.assign({ lens: lens || 'full' }, v) : null))
  }))).filter(Boolean)

  if (!votes.length) return { impl, verdict: null, failure: null }   // 复查者全挂掉不算任务失败

  const rejects = votes.filter((v) => v.verdict === 'reject')
  const verdict = {
    lenses: votes.map((v) => v.lens),
    escalated: escalate,
    boundaryBreach: breach,
    verdict: rejects.length >= rejectThreshold(votes.length) ? 'reject' : 'pass',
    reasons: rejects.flatMap((v) => (v.reasons || []).map((r) => `[${v.lens}] ${r}`)),
    suggestions: votes.flatMap((v) => (v.suggestions || []).map((s) => `[${v.lens}] ${s}`)),
    votes: votes.map((v) => ({ lens: v.lens, verdict: v.verdict })),
  }
  if (verdict.verdict === 'reject') {
    return { impl, verdict, failure: `reviewer REJECT（${rejects.length}/${votes.length} 票）：${verdict.reasons.join('；') || '未说明'}` }
  }
  // 少数派 reject 不阻断，但要留痕——它常常是对的，只是没到门槛
  if (rejects.length) {
    verdict.minorityConcerns = verdict.reasons
  }
  return { impl, verdict, failure: null }
}

async function runTask(task) {
  let r = await runOnce(task, null)
  if (!r.failure || dryRun || !debugOn) {
    return { task, impl: r.impl, verdict: r.verdict, status: r.failure ? 'failed' : 'ok', failure: r.failure }
  }

  let lastDebug = null
  for (let round = 0; round < MAX_DEBUG_ROUNDS; round++) {
    const dOpts = { label: `debug:${task.id}`, phase: 'Debug', schema: DEBUG_SCHEMA }
    if (AT.debug) dOpts.agentType = AT.debug
    if (MODELS.debug) dOpts.model = MODELS.debug
    if (EFFORTS.debug) dOpts.effort = EFFORTS.debug
    const dbg = await agent(debugPrompt(task, r.failure), dOpts)
    if (!dbg) break
    lastDebug = dbg
    if (dbg.next_action !== 'RETRY_TASK') {
      return {
        task, impl: r.impl, verdict: r.verdict, debug: dbg,
        status: dbg.next_action === 'STOP_FOR_HUMAN' ? 'stop-for-human' : 'blocked',
        failure: r.failure,
      }
    }
    r = await runOnce(task, dbg)
    if (!r.failure) return { task, impl: r.impl, verdict: r.verdict, debug: dbg, status: 'ok', failure: null }
  }
  return { task, impl: r.impl, verdict: r.verdict, debug: lastDebug, status: 'failed', failure: r.failure }
}

// ── 主编排：Phase 串行 → 组内并行 ────────────────────────────────
log(`kiro-spec-exec｜${feature}｜parallel=${par} review=${review}(${ultra ? `默认单名全项 · 高风险升级 ${lenseKeys.join('+')}` : lenseKeys.join('+')}) debug=${debugOn} ultracode=${ultra} dryRun=${dryRun} model.impl=${MODELS.impl || '(继承)'} isolation=${isolation || '关闭'}`)
if (projectRoot) log(`项目根：${projectRoot}`)

const results = []
let stopForHuman = null
for (const ph of taskPhases) {
  if (stopForHuman) break
  log(`▶ ${ph.name}`)
  // 并行档用预分好的 groups；串行档把该 Phase 所有任务拍平成"每任务一组"
  const groups = par ? ph.groups : ph.groups.flat().map((t) => [t])
  for (const group of groups) {
    const gr = await parallel(group.map((task) => () => runTask(task)))
    const ok = gr.filter(Boolean)
    results.push(...ok)
    const halt = ok.find((r) => r.status === 'stop-for-human')
    if (halt) {
      stopForHuman = halt
      log(`⛔ 任务 ${halt.task.id} 需要人工介入，停止后续调度`)
      break
    }
  }
}

// ── 分类汇总（回写 tasks.md / spec.json 由主对话在 workflow 外统一做）─
const done = results.filter((r) => r.status === 'ok')
const rejected = results.filter((r) => r.status === 'failed' && r.verdict && r.verdict.verdict === 'reject')
const manual = results.filter((r) => r.impl && r.impl.needs_manual_verify)
const blocked = results.filter((r) =>
  r.status === 'blocked' || r.status === 'stop-for-human' ||
  (r.status === 'failed' && !(r.verdict && r.verdict.verdict === 'reject')))

log(`完成 ${done.length}｜打回 ${rejected.length}｜待人工 ${manual.length}｜受阻 ${blocked.length}`)

// 复查预算实况：升级了几个、总共派了多少复查者。低升级率说明判据可能过松，
// 高升级率（>半数）说明这批任务本身粒度偏大，该回头看 tasks.md 而不是调判据。
if (review && !dryRun) {
  const reviewed = results.filter((r) => r.verdict && r.verdict.lenses)
  const escalated = reviewed.filter((r) => r.verdict.escalated)
  const breached = reviewed.filter((r) => r.verdict.boundaryBreach)
  const agents = reviewed.reduce((n, r) => n + r.verdict.lenses.length, 0)
  log(`复查：${reviewed.length} 个任务派出 ${agents} 名复查者（升级三视角 ${escalated.length}，其中边界预筛命中 ${breached.length}）；全上三视角本会是 ${reviewed.length * lenseKeys.length} 名`)
}

// ── 收尾完整性批评（ultracode）───────────────────────────────────
// 逐任务复查只看得见单个任务；跨任务的接缝、集成漏洞、"整体上还差什么"没人负责。
// 这一步就是补这个盲区——它找到的东西是下一轮工作，不是本轮的判定。
const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['missing-integration', 'unverified-claim', 'requirement-uncovered', 'seam-risk', 'other'] },
          detail: { type: 'string' },
          evidence: { type: 'string' },
          suggested_action: { type: 'string' },
        },
        required: ['kind', 'detail'],
      },
    },
    overall: { type: 'string', enum: ['coherent', 'gaps-found'] },
  },
  required: ['overall'],
}

let critique = null
if (ultra && !dryRun && done.length) {
  critique = await agent(
    `审视一整批刚完成的 kiro 任务交付，回答一个问题：**还缺什么？**

${rootBlock}
## 交付范围
- Spec：${feature}（${specPath}）
- 本轮标记完成的任务：${done.map((r) => `${r.task.id} ${r.task.desc}`).join('\n  - ')}
- 打回/受阻/待人工：${[...rejected, ...blocked, ...manual].map((r) => r.task.id).join(', ') || '无'}

## 你要找的是逐任务复查看不见的东西
每个任务都被单独验收过了，所以**不要重复逐任务复查**。只找跨任务的缝：
1. 任务 A 与任务 B 之间的集成点是否真的接上了？（各自单测过，合起来没人跑过）
2. requirements.md 里有没有哪条需求，形式上被某个任务"覆盖"了，实质上没有端到端可观测的实现？
3. 有没有哪个"完成"的断言其实没有机械证据支撑（只有子代理自述）？
4. 本轮改动引入了什么新的运行时前置条件（迁移、配置、环境变量、构建产物）而没人处理？

## 证据
自己读 \`git diff\`/\`git log\`、跑测试与冒烟命令核实，别只读 tasks.md 的勾选状态——勾选是本流水线自己写的，不构成证据。

${contextBlock({ reqs: [] })}

${skillRule([
  ['kiro-verify-completion', 'verify-completion', '判断某个「已完成」断言是否有新鲜证据时'],
])}

## 铁律
- **不写代码、不改文件**，只诊断。
- 找不到缝就老实说 overall="coherent"，不要为凑数编造问题。
- 每条 gap 必须带证据（文件路径 / 命令输出），没有证据的直觉不要写。

## 返回（结构化）
gaps[{kind, detail, evidence, suggested_action}] / overall(coherent|gaps-found)`,
    Object.assign({ label: 'critic:completeness', phase: 'Critic', schema: CRITIC_SCHEMA },
      MODELS.critic ? { model: MODELS.critic } : {},
      EFFORTS.critic ? { effort: EFFORTS.critic } : {}),
  )
  if (critique) {
    log(`完整性批评：${critique.overall}${critique.gaps ? `（${critique.gaps.length} 条缺口）` : ''}`)
  }
}

return {
  feature,
  specPath,
  total: results.length,
  stoppedForHuman: stopForHuman ? stopForHuman.task.id : null,
  summary: { done: done.length, rejected: rejected.length, manual: manual.length, blocked: blocked.length },
  // 跨任务缺口：不是本轮判定，是下一轮工作输入。编排层要单独呈给用户，别混进「完成」里
  critique,
  // 编排层据此回写 tasks.md：ok 勾 [x]；blocked 追加 _Blocked:_；learnings 并入 Implementation Notes
  results,
}
