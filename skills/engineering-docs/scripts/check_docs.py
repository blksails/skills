#!/usr/bin/env python3
"""Read-only engineering Markdown checks. Python 3.9+, no dependencies."""

import argparse
from datetime import date
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit


def prose(text):
    """Ignore fenced examples so sample filenames are not treated as links."""
    lines = []
    fence = None
    for line in text.splitlines():
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if fence:
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= fence[1] and not marker[2].strip():
                fence = None
        elif marker:
            fence = (marker[1][0], len(marker[1]))
        else:
            lines.append(line)
    return "\n".join(lines)


def anchors(text):
    found = set()
    for heading in re.findall(r"^#{1,6}\s+(.+?)\s*#*\s*$", prose(text), re.M):
        base = "".join(c for c in heading.lower() if c.isalnum() or c in "_- ").replace(" ", "-")
        name = base
        number = 1
        while name in found:
            name = f"{base}-{number}"
            number += 1
        found.add(name)
    return found


def check(root):
    root = Path(root).resolve()
    entry = root / "README.md"
    docs = root / ".agents/docs"
    files = [entry, root / "AGENTS.md", docs / "README.md"]
    files = list(dict.fromkeys(files + sorted(docs.rglob("*.md"))))
    errors = []
    edges = {p: set() for p in files}
    count = 0
    texts = {}
    for path in files:
        try:
            texts[path] = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as error:
            errors.append(f"无法读取 {path.relative_to(root)}：{error}")
    for path, text in texts.items():
        for target in re.findall(r"(?<!!)\[[^\]\n]+\]\((<[^>]+>|[^)\s]+)\)", prose(text)):
            target = target.strip("<>")
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc:
                continue
            linked = (path.parent / unquote(parsed.path)).resolve() if parsed.path else path
            count += 1
            if not linked.exists():
                errors.append(f"{path.relative_to(root)}：链接不存在 {target}")
                continue
            if linked in edges:
                edges[path].add(linked)
            if parsed.fragment and linked.is_file() and linked.suffix == ".md":
                try:
                    if unquote(parsed.fragment) not in anchors(linked.read_text(encoding="utf-8")):
                        errors.append(f"{path.relative_to(root)}：标题不存在 {target}")
                except (OSError, UnicodeError) as error:
                    errors.append(f"无法读取链接目标 {target}：{error}")
        # Templates, research and archived evidence are not active feature designs.
        if path.parent == docs and path.name.startswith("feature-"):
            match = re.fullmatch(r"feature-[a-z0-9]+(?:-[a-z0-9]+)*-(\d{4}-\d{2}-\d{2})\.md", path.name)
            try:
                if not match:
                    raise ValueError("应为 feature-<name>-YYYY-MM-DD.md")
                date.fromisoformat(match[1])
            except ValueError as error:
                errors.append(f"{path.relative_to(root)}：无效 feature 名称或日期（{error}）")
    seen = set()
    pending = [entry]
    while pending:
        path = pending.pop()
        if path not in seen:
            seen.add(path)
            pending.extend(edges.get(path, set()) - seen)
    for path in sorted(set(files) - seen):
        errors.append(f"根 README 无法到达：{path.relative_to(root)}")
    return errors, len(files), count


def main():
    # Redirected Windows streams may default to a legacy code page.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path, help="项目根目录")
    args = parser.parse_args()
    errors, files, links = check(args.root)
    if errors:
        print("文档检查失败；修正以下问题后重跑：", file=sys.stderr)
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"通过：{files} 份文档、{links} 个本地链接；不代表技术设计或产品验收通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
