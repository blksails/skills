#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  collectChangedFiles,
  detectRules,
  identifyProject,
  loadRegistry,
  policyForSource,
} from "./human-acceptance-lib.mjs";

function safeSegment(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const args = process.argv.slice(2);
if (!args.includes("--staged") && !args.includes("--range")) {
  throw new Error(
    "Usage: generate-test-request.mjs <--staged|--range BASE..HEAD>",
  );
}

const project = identifyProject();
const registry = loadRegistry();
const policy = policyForSource(registry, project.source);
if (!policy) {
  throw new Error(
    `No human-acceptance policy is registered for ${project.source}`,
  );
}

const change = collectChangedFiles(project.root, args);
const rules = detectRules(registry, policy, change.files);
if (rules.length === 0) {
  throw new Error(
    "No mandatory human-acceptance flow was detected; no report created",
  );
}

const uniqueRules = [...new Map(rules.map((rule) => [rule.id, rule])).values()];
const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, "-");
const reportDirectory = path.resolve(
  project.root,
  registry.defaults?.reportDirectory ?? ".human-acceptance/reports",
);
const filename = `${timestamp}-${uniqueRules.map((rule) => safeSegment(rule.id)).join("-")}.md`;
const reportPath = path.join(reportDirectory, filename);
const branch = project.branch ?? "(detached HEAD)";
const head = project.head ?? "(no HEAD)";
const remoteName = project.selectedRemote?.name ?? "(local repository)";

const flowSections = uniqueRules
  .map((rule) => {
    const roles = [
      ...new Set(
        rules
          .filter((candidate) => candidate.id === rule.id)
          .map(({ role }) => role),
      ),
    ];
    return `- [ ] ${rule.label}（\`${rule.id}\`）\n  - 当前仓库角色：${roles.join(", ")}\n  - 验收文档：${rule.docs}\n  - 验收结果：待执行\n  - 证据：待执行`;
  })
  .join("\n");
const changedFileLines = change.files.map((file) => `- \`${file}\``).join("\n");

const report = `# 人类验收测试申请

> 本文件是提交前生成的测试申请，状态为“待人类验收”。它不表示测试已经执行或通过。

## 申请信息

- 状态：待人类验收
- Git 项目：\`${project.source}\`
- 远端：\`${remoteName}\`
- 分支：\`${branch}\`
- 基准 HEAD：\`${head}\`
- 变更范围：\`${change.mode}\`
- 申请时间：${now.toISOString()}
- 申请人：待填写
- 目标环境：待填写
- 指定验收人：待填写

## 必测流程

${flowSections}

## 涉及文件

${changedFileLines}

## 风险与回滚

- 风险说明：待填写
- 回滚方案：待填写

## 人类验收结果

- 实际环境：待执行
- 验收人：待执行
- 执行时间：待执行
- 结论：待执行
- 截图或日志证据：待执行
- 备注：待执行
`;

mkdirSync(reportDirectory, { recursive: true });
writeFileSync(reportPath, report, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${path.relative(project.root, reportPath)}\n`);
