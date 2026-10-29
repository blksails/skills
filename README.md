# BlackSail Team Skills

BlackSail 团队 Skill 的统一目录与协作仓库。这里维护团队共同使用的 Skill、采用策略、外部来源锁定、质量门禁和成员更新提示。

安装、更新和卸载统一交给社区标准工具 `npx skills`。本仓库不重复实现包管理器，只补充企业团队需要的治理能力。

## 我们解决什么问题

- 为团队提供一份可评审、可追踪、可回滚的 Skill 目录。
- 让 Codex、Claude Code、Gemini CLI、OpenCode 等 Agent 使用一致的团队能力。
- 用 required、recommended、optional、deprecated 管理采用阶段。
- 将内部 Skill 与固定版本的外部 Skill 放在同一治理清单中。
- 在 Session Start 提醒成员更新、安装必装项和迁移废弃项。
- 通过 PR、跨平台 CI 和明确负责人维护长期质量。

## 一键安装

要求：Git、Node.js 22.20+。下面这条命令会通过标准 `npx skills` 一次安装团队必装项和推荐项，无需提前 clone 仓库：

```bash
npx --yes skills@1.7.4 add https://github.com/blksails/skills -g -a "*" \
  -s human-acceptance-gate -s deploy -s autoresearch-skill -y
```

其中：

- `human-acceptance-gate`、`deploy` 是团队必装项。
- `autoresearch-skill` 是团队推荐项。
- optional Skill 由成员按工作需要安装。

`-a "*"` 会安装到 `npx skills` 检测到的全部 Agent。只安装到单个 Agent 时，改为 `-a codex`、`-a claude-code`、`-a gemini-cli` 或 `-a opencode`。

## 启用团队更新提醒

只有 Session Start 更新检查是本仓库的扩展能力。需要该能力时，再保留一份本地 checkout：

```bash
git clone git@github.com:blksails/skills.git ~/.blacksail-skills
~/.blacksail-skills/hooks/session-start
```

首次执行第二行会立即检查仓库更新和团队采用策略；随后把对应入口配置为 Agent 的 Session Start Hook。

安装固定版本的外部 Skill：

```bash
npx skills add https://github.com/nicobailon/visual-explainer/tree/v0.14.0/plugins/visual-explainer \
  -g -a codex -s visual-explainer -y
```

`npx skills` 负责各 Agent 的目录、共享链接和 copy 降级。

## 日常更新

```bash
cd ~/.blacksail-skills
git pull --ff-only
npx skills update -g -y
```

手动检查团队仓库：

```bash
~/.blacksail-skills/bin/team-skills check-update --force --verbose
```

当前 npm 最新 `skills@1.7.4` 尚未发布文档中的 `skills check`，所以仓库更新检查暂由本项目提供。安装生命周期仍完全由 `npx skills` 管理。

## Session Start 团队提醒

把对应入口配置为 Agent 的 Session Start Hook：

```text
macOS/Linux: ~/.blacksail-skills/hooks/session-start
PowerShell:   %USERPROFILE%\.blacksail-skills\hooks\session-start.ps1
CMD:          %USERPROFILE%\.blacksail-skills\hooks\session-start.cmd
```

Hook 只检查和提示，不自动修改成员环境：

1. 最多每 6 小时检查一次企业仓库更新，默认 3 秒超时。
2. 通过 `npx skills list -g --json` 检查当前 Agent 的团队策略。
3. 为缺失必装项、推荐项和已安装废弃项输出标准 `npx skills` 命令。

通过 `TEAM_SKILLS_AGENT` 指定当前 Agent：`codex`、`claude`、`gemini` 或 `opencode`；默认是 `codex`。

## 团队采用策略

唯一策略来源是 `catalog.json`：

- `required`：所有团队成员必须安装，Session Start 强提示。
- `recommended`：大多数成员受益，Session Start 建议安装。
- `optional`：特定角色或任务按需安装。
- `deprecated`：停止新采用；已安装成员会收到迁移提示。

策略变更必须通过 PR。升级为 required 或进入 deprecated 时，PR 需要说明团队影响、迁移方式和负责人。

当前有效目录：

| Skill | 来源 | 策略 | 用途 |
|---|---|---|---|
| `human-acceptance-gate` | 内部 | required | 提交前识别人类验收流程与证据要求 |
| `deploy` | 内部 | required | 统一提交、PR、合并、发布和核验流程 |
| `autoresearch-skill` | 内部 | recommended | 可机械评估任务的自主研究与迭代 |
| `engineering-docs` | 内部 | optional / experimental | Feature 长期设计、独立里程碑与验证流程 |
| `visual-explainer` | 官方 `v0.14.0` | optional | HTML 图解、架构图、评审和演示文稿 |

按需安装工程文档 Skill：

```bash
npx --yes skills@1.7.4 add https://github.com/blksails/skills -g -a codex -s engineering-docs -y
```

它用于建立或维护 `.agents/docs/`，保持同一特性设计收敛在一份 feature；不会自动替项目增加 Rust、nsh 或其他技术依赖。使用说明见 [`engineering-docs`](skills/engineering-docs/SKILL.md)。

## 团队协作流程

### 新增内部 Skill

1. 从 `templates/skill/` 创建 `skills/<name>/SKILL.md`。
2. 只加入能改变 Agent 决策的团队知识、确定流程和风险约束。
3. 在 `catalog.json` 登记负责人、标签、稳定性和采用策略。
4. 运行本地验证并提交 PR。
5. 由非作者按照 `best-practices/review-checklist.md` 复核触发边界、权限和失败恢复。

### 引入外部 Skill

外部源码不复制进本仓库。在 `catalog.json` 记录：

- 官方 Git URL；
- 固定 tag 或完整 commit；
- Skill 子目录；
- 许可证；
- BlackSail 维护负责人。

升级外部版本时先复核上游 diff、依赖和许可证，再修改锁定版本。禁止使用 `main`、`latest` 等漂移引用。

### 调整团队策略

- optional → recommended：已有稳定使用证据，适用于多数成员。
- recommended → required：说明不安装会破坏的团队流程。
- 任意状态 → deprecated：提供替代方案和迁移窗口。
- 移除目录项：只能在废弃迁移完成后进行。

## 仓库结构

```text
.
├── catalog.json                 # Skill 元数据与团队采用策略
├── skills/                      # 内部维护的 Skill
├── best-practices/              # 编写规范与评审清单
├── templates/skill/             # 新 Skill 最小模板
├── hooks/                       # 跨平台 Session Start 检查
├── scripts/team_skills.py       # 企业策略与仓库更新检查
├── bin/                         # macOS/Linux、PowerShell、CMD 入口
└── tests/                       # 目录和策略测试
```

## 维护与验证

```bash
./bin/team-skills list
./bin/team-skills doctor
./bin/team-skills check-policy --agent codex
python3 -m unittest discover -s tests
node skills/human-acceptance-gate/scripts/validate-registry.mjs
npx --yes skills@1.7.4 add . --list
```

CI 会在 Linux、macOS 和 Windows 上验证目录结构、策略、Python 3.11 兼容性和 `npx skills` 发现结果。

## 卸载

安装记录由 `npx skills` 管理。成员可交互选择：

```bash
npx skills remove -g
```

也可以按名称或 Agent 精确卸载：

```bash
npx skills remove human-acceptance-gate deploy autoresearch-skill visual-explainer \
  -g -a codex -y
```

卸载 Skill 不会删除本仓库 checkout；保留 checkout 可继续接收团队策略和更新提醒。

贡献细则见 `CONTRIBUTING.md`，Skill 编写规范见 `best-practices/authoring.md`。
