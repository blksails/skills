#!/usr/bin/env python3
"""BlackSail policy and update checks; installation is delegated to npx skills."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Optional


REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = REPO_ROOT / "catalog.json"
CHECK_FILE = REPO_ROOT / ".git" / "team-skills-update-check.json"
VALID_STABILITY = {"experimental", "beta", "stable", "deprecated"}
AGENT_ALIASES = {
    "codex": "codex",
    "claude": "claude-code",
    "claude-code": "claude-code",
    "gemini": "gemini-cli",
    "gemini-cli": "gemini-cli",
    "opencode": "opencode",
}


class TeamSkillsError(RuntimeError):
    pass


def configure_console() -> None:
    """Use UTF-8 for Chinese CLI output on Windows and redirected streams."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise TeamSkillsError(f"找不到文件：{path}") from exc
    except json.JSONDecodeError as exc:
        raise TeamSkillsError(f"JSON 格式错误：{path}:{exc.lineno}:{exc.colno}") from exc
    if not isinstance(value, dict):
        raise TeamSkillsError(f"文件顶层必须是对象：{path}")
    return value


def load_catalog() -> dict[str, Any]:
    return load_json(CATALOG_PATH)


def catalog_index(catalog: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {item["id"]: item for item in catalog.get("skills", []) if isinstance(item, dict) and "id" in item}


def policy_lists(catalog: dict[str, Any]) -> dict[str, list[str]]:
    policy = catalog.get("policy")
    if not isinstance(policy, dict):
        return {"required": [], "recommended": [], "deprecated": []}
    return {
        group: list(policy.get(group, [])) if isinstance(policy.get(group), list) else []
        for group in ("required", "recommended", "deprecated")
    }


def validate_catalog(catalog: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if catalog.get("schema_version") != 1:
        errors.append("catalog.json: schema_version 必须为 1")
    skills = catalog.get("skills")
    if not isinstance(skills, list):
        return errors + ["catalog.json: skills 必须是数组"]

    seen: set[str] = set()
    for offset, skill in enumerate(skills):
        prefix = f"catalog.json: skills[{offset}]"
        if not isinstance(skill, dict):
            errors.append(f"{prefix} 必须是对象")
            continue
        skill_id = skill.get("id")
        if not isinstance(skill_id, str) or not skill_id:
            errors.append(f"{prefix}.id 不能为空")
            continue
        if skill_id in seen:
            errors.append(f"{prefix}.id 重复：{skill_id}")
        seen.add(skill_id)
        if any(char not in "abcdefghijklmnopqrstuvwxyz0123456789-" for char in skill_id):
            errors.append(f"{skill_id}: id 只能包含小写字母、数字和连字符")
        path_value = skill.get("path")
        source = skill.get("source")
        if bool(path_value) == bool(source):
            errors.append(f"{skill_id}: 必须且只能设置 path 或 source")
        elif path_value:
            relative = Path(path_value)
            if relative.is_absolute() or ".." in relative.parts:
                errors.append(f"{skill_id}: path 必须是仓库内相对路径")
            else:
                skill_file = REPO_ROOT / relative / "SKILL.md"
                if not skill_file.is_file():
                    errors.append(f"{skill_id}: 缺少 {relative}/SKILL.md")
        elif not isinstance(source, dict) or source.get("kind") != "git":
            errors.append(f"{skill_id}: source.kind 目前只支持 git")
        else:
            for field in ("url", "ref", "ref_type", "subpath", "license"):
                if not isinstance(source.get(field), str) or not source[field]:
                    errors.append(f"{skill_id}: source.{field} 不能为空")
            if source.get("ref_type") not in {"tag", "commit"}:
                errors.append(f"{skill_id}: source.ref_type 必须是 tag 或 commit")
            subpath = Path(str(source.get("subpath", "")))
            if subpath.is_absolute() or ".." in subpath.parts:
                errors.append(f"{skill_id}: source.subpath 必须是安全相对路径")
        owners = skill.get("owners")
        if not isinstance(owners, list) or not owners or not all(isinstance(item, str) and item for item in owners):
            errors.append(f"{skill_id}: owners 必须是非空字符串数组")
        if skill.get("stability") not in VALID_STABILITY:
            errors.append(f"{skill_id}: stability 值无效")

    policy = catalog.get("policy")
    if not isinstance(policy, dict):
        return errors + ["catalog.json: policy 必须是对象"]
    classified: dict[str, str] = {}
    for group in ("required", "recommended", "deprecated"):
        members = policy.get(group)
        if not isinstance(members, list) or not all(isinstance(item, str) and item for item in members):
            errors.append(f"catalog.json: policy.{group} 必须是字符串数组")
            continue
        for skill_id in members:
            if skill_id not in seen:
                errors.append(f"catalog.json: policy.{group} 引用了未知 Skill：{skill_id}")
            if skill_id in classified:
                errors.append(f"catalog.json: {skill_id} 同时属于 {classified[skill_id]} 和 {group}")
            classified[skill_id] = group
            if group == "deprecated" and skill_id in catalog_index(catalog):
                if catalog_index(catalog)[skill_id].get("stability") != "deprecated":
                    errors.append(f"{skill_id}: 位于废弃列表时 stability 必须为 deprecated")
    for skill_id, skill in catalog_index(catalog).items():
        if skill.get("stability") == "deprecated" and classified.get(skill_id) != "deprecated":
            errors.append(f"{skill_id}: stability=deprecated 时必须加入 policy.deprecated")
    return errors


def npx_source(skill: dict[str, Any]) -> str:
    if "path" in skill:
        return str(REPO_ROOT)
    source = skill["source"]
    url = source["url"].removesuffix(".git")
    if source["ref_type"] in {"tag", "commit"} and url.startswith("https://github.com/"):
        return f"{url}/tree/{source['ref']}/{source['subpath']}"
    raise TeamSkillsError(f"npx skills 暂不支持该锁定来源：{skill['id']}")


def selected_agent(raw: Optional[str]) -> str:
    value = raw or os.environ.get("TEAM_SKILLS_AGENT") or "codex"
    if value not in AGENT_ALIASES:
        raise TeamSkillsError(f"未知 Agent：{value}")
    return AGENT_ALIASES[value]


def npx_executable() -> str:
    """Resolve the executable name that subprocess can launch on this platform."""
    candidates = ("npx.cmd", "npx") if os.name == "nt" else ("npx",)
    for candidate in candidates:
        executable = shutil.which(candidate)
        if executable:
            return executable
    raise TeamSkillsError("找不到 npx；需要 Node.js 22.20+")


def run_npx_list(timeout: float) -> list[dict[str, Any]]:
    try:
        result = subprocess.run(
            [npx_executable(), "--yes", "skills", "list", "-g", "--json"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=True,
        )
        value = json.loads(result.stdout)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise TeamSkillsError(f"npx skills list 失败：{exc}") from exc
    if not isinstance(value, list):
        raise TeamSkillsError("npx skills list 返回格式异常")
    return [item for item in value if isinstance(item, dict)]


def policy_findings(catalog: dict[str, Any], installed_names: set[str]) -> dict[str, list[str]]:
    policy = policy_lists(catalog)
    return {
        "required": [name for name in policy["required"] if name not in installed_names],
        "recommended": [name for name in policy["recommended"] if name not in installed_names],
        "deprecated": [name for name in policy["deprecated"] if name in installed_names],
    }


def install_command(skill: dict[str, Any], agent: str) -> str:
    return f'npx skills add "{npx_source(skill)}" -g -a {agent} -s {skill["id"]} -y'


def command_check_policy(args: argparse.Namespace, catalog: dict[str, Any]) -> None:
    agent = selected_agent(args.agent)
    installed = run_npx_list(float(os.environ.get("TEAM_SKILLS_NPX_TIMEOUT", "10")))
    names = {
        str(item.get("name"))
        for item in installed
        if not item.get("agents") or any(str(agent_name).lower().replace(" ", "-") == agent for agent_name in item["agents"])
    }
    findings = policy_findings(catalog, names)
    index = catalog_index(catalog)
    for group, label in (("required", "必装项缺失"), ("recommended", "推荐安装")):
        if findings[group]:
            print(f"Team Skills {label}：{', '.join(findings[group])}")
            for skill_id in findings[group]:
                print(f"  {install_command(index[skill_id], agent)}")
    if findings["deprecated"]:
        names_text = " ".join(findings["deprecated"])
        print(f"Team Skills 已废弃，请移除：{', '.join(findings['deprecated'])}")
        print(f"  npx skills remove {names_text} -g -a {agent} -y")


def run_git(*arguments: str, timeout: Optional[float] = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(REPO_ROOT), *arguments],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=True,
    )


def check_is_due(interval: int) -> bool:
    if interval <= 0 or not CHECK_FILE.exists():
        return True
    try:
        return time.time() - float(load_json(CHECK_FILE).get("checked_at", 0)) >= interval
    except (TeamSkillsError, TypeError, ValueError):
        return True


def command_check_update(args: argparse.Namespace) -> None:
    interval = int(os.environ.get("TEAM_SKILLS_CHECK_INTERVAL", "21600"))
    timeout = float(os.environ.get("TEAM_SKILLS_FETCH_TIMEOUT", "3"))
    if not args.force and not check_is_due(interval):
        return
    try:
        run_git("fetch", "--quiet", "--prune", timeout=timeout)
        if CHECK_FILE.parent.is_dir():
            CHECK_FILE.write_text(json.dumps({"checked_at": int(time.time())}) + "\n", encoding="utf-8")
        upstream = run_git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}").stdout.strip()
        behind = int(run_git("rev-list", "--count", f"HEAD..{upstream}").stdout.strip())
        if behind:
            print(f"Team Skills 有 {behind} 个新提交。更新仓库后运行：npx skills update -g -y")
    except (OSError, ValueError, subprocess.SubprocessError, TeamSkillsError) as exc:
        if args.verbose:
            print(f"Team Skills 更新检查跳过：{exc}", file=sys.stderr)


def command_list(catalog: dict[str, Any]) -> None:
    categories = {name: group for group, members in policy_lists(catalog).items() for name in members}
    print(f"{'NAME':24} {'SOURCE':10} {'POLICY':12} DESCRIPTION")
    for skill in catalog["skills"]:
        source = "external" if "source" in skill else "internal"
        print(f"{skill['id'][:23]:24} {source:10} {categories.get(skill['id'], 'optional'):12} {skill.get('description', '')}")


def command_doctor(catalog: dict[str, Any]) -> None:
    errors = validate_catalog(catalog)
    try:
        npx_executable()
    except TeamSkillsError as exc:
        errors.append(str(exc))
    if errors:
        raise TeamSkillsError("检查失败：\n- " + "\n- ".join(errors))
    print(f"OK: 目录中 {len(catalog['skills'])} 个 Skill 有效，安装由 npx skills 管理")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="team-skills", description="BlackSail Skill 策略与更新检查")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="列出企业目录")
    commands.add_parser("doctor", help="校验企业目录和 npx 环境")
    policy = commands.add_parser("check-policy", help="通过 npx skills 检查团队策略")
    policy.add_argument("--agent", choices=sorted(AGENT_ALIASES))
    update = commands.add_parser("check-update", help="检查团队仓库更新")
    update.add_argument("--force", action="store_true")
    update.add_argument("--verbose", action="store_true")
    return parser


def main() -> int:
    configure_console()
    args = build_parser().parse_args()
    try:
        if args.command == "check-update":
            command_check_update(args)
            return 0
        catalog = load_catalog()
        errors = validate_catalog(catalog)
        if errors and args.command != "doctor":
            raise TeamSkillsError("目录校验失败：\n- " + "\n- ".join(errors))
        if args.command == "list":
            command_list(catalog)
        elif args.command == "doctor":
            command_doctor(catalog)
        elif args.command == "check-policy":
            command_check_policy(args, catalog)
        return 0
    except TeamSkillsError as exc:
        print(f"team-skills: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
