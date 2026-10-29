import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/engineering-docs/scripts/check_docs.py"
SPEC = importlib.util.spec_from_file_location("engineering_docs_check", SCRIPT)
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


class EngineeringDocsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="engineering-docs-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.docs = self.root / ".agents/docs"
        self.docs.mkdir(parents=True)
        (self.root / "README.md").write_text(
            "# Demo\n[Docs](.agents/docs/README.md) [Rules](AGENTS.md)\n", encoding="utf-8"
        )
        (self.root / "AGENTS.md").write_text("# Rules\n", encoding="utf-8")
        (self.docs / "README.md").write_text("# Docs\n", encoding="utf-8")

    def expose(self, name, content):
        path = self.docs / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        with (self.docs / "README.md").open("a", encoding="utf-8") as index:
            index.write(f"\n[Design]({name})\n")
        return path

    def test_readable_feature_needs_no_fixed_headings(self):
        self.expose("feature-messages-2026-10-29.md", "# 消息\n需求：发送消息。目标：收到。非目标：远程传输。\n")
        self.assertEqual(checker.check(self.root)[0], [])

    def test_cli_failure_then_repair_leaves_files_unchanged(self):
        path = self.expose("feature-messages-2026-10-29.md", "[Source](missing.rs)\n")
        before = path.read_bytes()
        result = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.root)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing.rs", result.stderr)
        self.assertEqual(path.read_bytes(), before)
        (self.docs / "missing.rs").write_text("", encoding="utf-8")
        repaired = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.root)], capture_output=True)
        self.assertEqual(repaired.returncode, 0)

    def test_orphan_document_is_detected(self):
        (self.docs / "orphan.md").write_text("# Orphan\n", encoding="utf-8")
        self.assertTrue(any("orphan.md" in error for error in checker.check(self.root)[0]))

    def test_dates_and_names_are_validated(self):
        for name in ("feature-messages.md", "feature-messages-2026-02-30.md"):
            with self.subTest(name=name):
                path = self.expose(name, "# Design\n")
                errors = checker.check(self.root)[0]
                self.assertTrue(any("日期" in error for error in errors))
                path.unlink()

    def test_unicode_percent_encoded_paths_and_anchors(self):
        self.expose("需求 说明.md", "# 目标\n# 目标\n")
        self.expose("links.md", "[Goal](%E9%9C%80%E6%B1%82%20%E8%AF%B4%E6%98%8E.md#目标-1)\n")
        self.assertEqual(checker.check(self.root)[0], [])

    def test_broken_anchor_is_detected(self):
        self.expose("design.md", "# Goal\n[Missing](#other)\n")
        self.assertTrue(any("标题不存在" in error for error in checker.check(self.root)[0]))

    def test_fenced_examples_are_not_links_or_headings(self):
        self.expose("design.md", "# Goal\n```md\n[Example](not-real.md)\n# Fake\n```\n")
        self.assertEqual(checker.check(self.root)[0], [])
        self.assertNotIn("fake", checker.anchors((self.docs / "design.md").read_text(encoding="utf-8")))

    def test_missing_project_is_an_error(self):
        self.assertTrue(checker.check(self.root / "does-not-exist")[0])


if __name__ == "__main__":
    unittest.main()
