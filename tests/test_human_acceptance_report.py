import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "skills" / "human-acceptance-gate" / "scripts" / "generate-test-request.mjs"


class HumanAcceptanceReportTests(unittest.TestCase):
    def test_generated_report_is_a_pending_manual_test_request(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
            subprocess.run(["git", "config", "user.name", "Test User"], cwd=repo, check=True)
            subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=repo, check=True)
            subprocess.run(
                ["git", "remote", "add", "origin", "git@github.com:blksails/ablink.git"],
                cwd=repo,
                check=True,
            )
            source = repo / "services" / "ablink" / "audit.go"
            source.parent.mkdir(parents=True)
            source.write_text("package ablink\n", encoding="utf-8")
            subprocess.run(["git", "add", str(source.relative_to(repo))], cwd=repo, check=True)

            result = subprocess.run(
                ["node", str(GENERATOR), "--staged"],
                cwd=repo,
                check=True,
                capture_output=True,
                text=True,
            )
            report = repo / result.stdout.strip()
            content = report.read_text(encoding="utf-8")

            self.assertTrue(content.startswith("# 申请人工测试\n"))
            self.assertIn("状态：待人类验收", content)
            self.assertIn("人类验收 Ablink 管理与跳转链路", content)


if __name__ == "__main__":
    unittest.main()
