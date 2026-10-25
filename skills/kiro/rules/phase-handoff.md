# 阶段交接契约（Phase Handoff）

本文件定义 kiro 各阶段之间**怎么衔接**：谁产出什么、下一阶段消费什么、什么条件下才算可以往下走。路径：`~/.claude/skills/kiro/rules/phase-handoff.md`。

## 0. 唯一原则：工件即接口

**阶段之间只通过磁盘上的工件交接，不通过对话记忆。**

这不是洁癖，是三个硬约束逼出来的：

1. **子代理看不见对话**。各阶段已默认 fan-out（`parallel-dispatch.md`），派出去的子代理只有你 prompt 里写的东西和它自己能读到的文件。上一阶段的结论若只存在于对话里，对它就不存在。
2. **会话会断**。`/kiro resume` 必须能从磁盘重建状态。凭记忆推进的阶段，换个会话就接不上。
3. **转述会失真**。把 design 的结论概括给 tasks 阶段，等于让下游基于你的摘要而非原文工作——摘要里丢掉的约束，下游永远找不回来。

推论（最常犯的错）：**给下游路径，不要给下游摘要**。派单 prompt 里写 `设计见 .kiro/specs/x/design.md 的 §3`，不要粘贴 design.md 的内容或你对它的概括。

## 1. 交接契约表

| 阶段 | 消费（输入工件） | 产出（输出工件） | 就绪判据（机械可判） |
|------|-----------------|-----------------|---------------------|
| `discovery` | 用户想法 + 代码库 | `brief.md`、多 spec 时 `.kiro/steering/roadmap.md` | brief.md 存在 |
| `steering` | 代码库 | `.kiro/steering/{product,tech,structure}.md` | 三份核心文件存在 |
| `spec-init` | brief.md（可选） | `spec.json`、`requirements.md` 骨架 | `spec.json.phase` 已设 |
| `spec-requirements` | requirements 骨架 + steering | `requirements.md`（EARS，带编号 ID） | 每条需求有数字 ID；`approvals.requirements.generated=true` |
| `validate-gap`（可选） | requirements.md + 代码库 | `research.md`（现状与选项） | research.md 存在 |
| `spec-design` | requirements.md + research.md + steering | `design.md`、追加 `research.md` | 每条需求 ID 在 design 中有对应；`approvals.design.generated=true` |
| `validate-design`（可选） | design.md + requirements.md | GO/NO-GO 结论（对话） | — |
| `spec-tasks` | requirements.md + design.md | `tasks.md`（带 `_Requirements:_`/`_Depends:_`/`_Boundary:_`/`(P)`） | 每条需求 ID 至少被一个任务覆盖；`ready_for_implementation=true` |
| `impl` | tasks.md + requirements.md + design.md + steering | 代码 + `tasks.md` 勾选 + `## Implementation Notes` | 无未勾选且未 `_Blocked:_` 的任务 |
| `validate-impl` | tasks.md + requirements.md + design.md + 代码 | GO/NO-GO + 缺口清单 | 全量测试通过、冒烟通过 |
| `verify-completion` | 上一步的断言 + 新鲜证据 | 证据或驳回 | — |

**闸门叠加在就绪判据之上**：机械判据满足 ≠ 可以往下走。规划三阶段还需 `spec.json.approvals.<x>.approved === true`（§4 闸门规则）。就绪判据管「做完了没」，闸门管「批了没」，两者都要过。

## 2. 进入任何阶段前：交接检查

三步，不可省：

1. **读 `spec.json`** —— `phase` 与 `approvals` 是权威，不是你的记忆。
2. **验前置工件存在**（按上表）。缺了就回到产出它的阶段，不要用「我记得需求是……」补位。
3. **验上游批准**（规划阶段）。`approved !== true` 就停在闸门。

前置工件存在但**内容对不上**（例如 tasks.md 引用了 requirements.md 里没有的 ID）时：这是上游漂移，回上游修，不要在下游打补丁。下游悄悄兼容上游的错，是 spec 流程失效最常见的起点。

## 3. 链式衔接（多阶段连跑）

连跑的阶段之间**仍然走磁盘交接**，只是不停下来问人。

- `/kiro spec <name>` → `spec-init` 落盘 → `spec-requirements` 读盘。中间不靠内存传递。
- `/kiro quick`：四阶段串行，每阶段读上一阶段的**文件**。这条链天然不可并行（后一阶段的输入就是前一阶段的产出），并行点在每个阶段**内部**（见 `parallel-dispatch.md`）。
- `/kiro auto`：闸门收敛成一道，交接契约**不收敛**——每个阶段照样落盘、照样验前置。
- `/kiro batch`：波内多 spec 并发，波间屏障。跨 spec 的依赖靠 `roadmap.md` 的波次定义，不靠 spec 之间互相读对方的中间态。

## 4. 执行阶段的交接（最容易出错的一段）

`impl` 的三档（workflow / wave / sequential）都遵守同一条：**编排层独占状态回写**。

```
tasks.md ──读──> 编排层 ──派单──> 子代理（只读 spec，只写代码）
                    ↑                    │
                    └──结构化结果────────┘
                    │
                    └──写──> tasks.md 勾选 / Implementation Notes / git commit
```

- **workflow 档的交接面是 `args` 与返回值**：`parse-tasks.mjs` 把 `tasks.md` 编译成 `args`（含 `diagnostics`），workflow 返回 `results` / `critique`，父层据此回写。workflow **不碰** `tasks.md` / `spec.json`。
- **档之间可以互相接续**：workflow 打回的任务，父层回写完状态后交给 sequential 档重做——两档共用同一份 `tasks.md` 真相，所以能无缝接力。这正是「工件即接口」的收益。
- **跨阶段回流**：`validate-impl` 的 NO-GO 缺口、workflow 的 `critique.gaps`，都要落回 `tasks.md`（新任务或 `_Blocked:_`），不要只在对话里说一句。没落盘的缺口，下一个会话就消失了。

### 中断即失账（父层独占回写的代价）

「子代理写代码、父层写状态」在正常路径上是对的，但中断时代价立刻显形：**代码已经在磁盘上，`tasks.md` 却说什么都没发生**。workflow 被杀、崩溃、或返回值滚出上下文，结果一样——磁盘与账目分叉，之后每个判断都建立在假象上。

规矩：**中断过的 run，绝不假设它什么都没做**。先重建账本再动任何念头：

```bash
node ~/.claude/skills/kiro/workflows/recover-run.mjs <transcriptDir>
```

它从 `journal.jsonl` + 各 `agent-<id>.jsonl` 重建每个任务的判定（`OK` / `UNREVIEWED` / `INCOMPLETE` / `REJECTED` / `BLOCKED`）。之所以要专门的工具：**journal 只按 `agentId` 记结果，不含 label 与任务号**，任务归属只能从派单 prompt 里反解。

最危险的是 `UNREVIEWED`——代码落盘了、测试可能还是绿的，看起来就像做完了，但没有任何对抗性复查碰过它。这种状态最容易被顺手勾掉。

`INCOMPLETE` 是中断点：`git status` 看它写到哪一步，再决定回滚重做还是接着修。

## 5. 断点续跑（`/kiro resume`）

只从磁盘推断，不问「我们刚才做到哪了」：

1. `spec.json.phase` + `approvals` → 定位阶段
2. 工件存在性 → 校正（例如 `phase=design` 但 design.md 不存在 → 实际停在 requirements 之后）
3. `tasks.md` 的 `[x]`/`[ ]`/`_Blocked:_` 计数 → 定位执行进度
4. 三者矛盾时以**工件为准**，并把 `spec.json` 修正到与工件一致——`spec.json` 是索引，工件是事实。

## 6. 反模式

| 反模式 | 后果 |
|---|---|
| 把上一阶段结论概括后传给下游 | 摘要丢掉的约束下游再也找不回 |
| 子代理直接改 `tasks.md` / `spec.json` | 并发覆盖；编排层与磁盘状态失步 |
| 口头批准不回写 `approvals` | 换会话后闸门状态丢失，等于没批 |
| 下游兼容上游的错误（ID 对不上也照做） | 漂移被固化，最终验收才爆 |
| 缺口只在对话里汇报 | 下个会话归零 |
| 跳过前置工件检查，凭记忆推进 | 恰好在最需要可靠性的长任务里失效 |
