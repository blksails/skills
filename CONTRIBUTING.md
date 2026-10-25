# 贡献指南

新增 Skill 时，从 `templates/skill/` 复制最小模板；不要直接复制一个无关的复杂 Skill。完成后更新 `catalog.json`，阅读 `best-practices/authoring.md`，并按 `best-practices/review-checklist.md` 自查。

提交 PR 前运行：

```bash
./bin/team-skills doctor
python3 -m unittest discover -s tests
```

PR 说明至少包含：使用场景、非适用场景、负责人、稳定性、验证证据，以及是否涉及外部写入或敏感数据。

团队特有检查代码须兼容 Python 3.9+，优先使用标准库；安装生命周期统一委托 `npx skills`。仓库通过 Node.js 22.20、Linux、macOS、Windows CI 矩阵验证。
