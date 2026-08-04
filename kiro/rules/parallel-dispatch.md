# 并发派单规则（Fan-out Protocol）

本文件是 kiro 全阶段共享的**子代理并发派单**规范。任何阶段写「并发派单，遵守 `rules/parallel-dispatch.md`」时，指的就是这份文件。路径：`~/.claude/skills/kiro/rules/parallel-dispatch.md`。

## 0. 默认姿态

**能并发就并发。** kiro 的默认执行姿态是 fan-out：只要一个阶段里存在两块及以上**互不依赖**的工作，就把它们拆成子代理，在**同一条消息里同时发出**多个 `Agent` 调用。串行只在下面「何时必须串行」列出的情形里保留。

判据不是「工作量大不大」，而是「**这两块的输入是否互相依赖**」。互不依赖 = 并发；后者要吃前者的产出 = 串行。

## 1. 并发的机械写法（最容易做错的一点）

同一条助手消息里发出多个 `Agent` 工具调用 → 它们真正并发。分成多条消息逐个发 → 退化成串行，白派。

```
（一条消息内）
Agent(prompt=…, subagent_type="Explore",         description="产品面调研")
Agent(prompt=…, subagent_type="Explore",         description="技术栈调研")
Agent(prompt=…, subagent_type="general-purpose", description="外部依赖调研")
```

派单前先在正文写一行 fan-out 声明，让用户看得见规模：

> 🚀 并发派单 3 个子代理：产品面 / 技术栈 / 外部依赖

## 2. 选哪种 subagent_type

| 工作性质 | 类型 | 说明 |
|---|---|---|
| 只读调研、搜代码、找约定、扫 steering | `Explore` | 无写权限，最安全最快，**调研默认选它** |
| 需要跑命令、装依赖、联网、写文件的调研 | `general-purpose` | 只在确实要写/要执行时用 |
| 实施单个 spec 任务 | `task-executor` | impl 的 implementer |
| 对抗性验收单个任务 | `spec-task-reviewer` | impl 的 reviewer，**绝不写代码** |
| 规划类（需求/设计/任务草案） | `strategic-planner` | 不写实现代码 |
| steering 生成/同步 | `steering-architect` | — |

## 3. 派单 prompt 必备五件套

每个子代理的 prompt 都要显式包含，缺一项就会拿回废话：

1. **唯一目标**——一句话说清只做这一件事，并明确「不要做 X」。
2. **输入路径**——给文件路径让它自己读，**不要**把大段文件内容塞进 prompt。
3. **返回格式与长度上限**——例如「返回不超过 120 行的发现摘要，禁止贴原始文件内容」。调研类子代理必须回**结论摘要**，不是原始数据。
4. **结构化字段**（有判定语义时）——`STATUS` / `VERDICT` / `NEXT_ACTION` 等，父层只从精确字段解析，不从散文里猜。
5. **skill 调用时机**——参见 `kiro/SKILL.md` §8：判定达标调 `kiro-review`、修不好调 `kiro-debug`、宣称完成前调 `kiro-verify-completion`；宿主没注册就读 `~/.claude/skills/kiro/phases/<x>/SKILL.md`。

## 4. 并发写盘的三条硬约束

1. **状态回写归父层独占**。子代理**禁止**改 `tasks.md`、`spec.json` 以及任何共享清单文件——并发会互相覆盖。子代理只返回结果，勾选 `[x]`、写 `## Implementation Notes`、置 `approved` 一律由父层在 fan-out 收敛后串行执行。
2. **同一批并发子代理的写入文件集必须互不相交**。做不到就 `isolation:'worktree'`，或干脆降级串行。
3. **git 操作归父层**。并发子代理不得 commit、不得 `git add -A`、不得任何 `git checkout .` / `git reset --hard` 类恢复操作（本机常有多个会话共用工作树）。

## 5. 收敛与容错

- fan-out 后**必须有一步合成**：父层把各摘要合并、消重、消解冲突，再进入下一步。不要把多份摘要原样堆给用户。
- 某个子代理返回 `null` / 空 / 缺结构化字段 → 只重派**那一个**，最多一次；仍失败则记为该维度缺口，在汇报里显式说明，**不要**假装覆盖到了。
- 子代理之间**互相看不见**。有交叉的判断（例如"这两个发现是不是同一件事"）只能由父层做。
- 并发调研拿回来的结论仍是二手信息。做出「完成/通过/GO」宣称前照走 `verify-completion`，父层亲自取新鲜证据。

## 6. 何时必须串行（别硬并发）

- 后一步的**输入**就是前一步的产出（requirements → design → tasks 这条主链）。
- 需要用户在中间做决策的闸门。
- 会写同一批文件且无法 worktree 隔离。
- 任务总量很小（1–2 块），派单开销大于收益——直接在主对话做。
- 需要跨块整体判断的合成步骤（例如 GO/NO-GO 裁定）——留在主对话。

## 7. 规模建议

单批并发 3–6 个是舒适区；超过 8 个先问自己是不是拆碎了。一个子代理该覆盖「一个能独立讲清楚的维度」，不是「一个文件」。
