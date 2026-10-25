import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("team_skills", ROOT / "scripts" / "team_skills.py")
team_skills = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(team_skills)


class TeamSkillsTests(unittest.TestCase):
    def test_catalog_is_valid(self):
        self.assertEqual(team_skills.validate_catalog(team_skills.load_catalog()), [])

    def test_internal_source_uses_repository(self):
        skill = team_skills.catalog_index(team_skills.load_catalog())["deploy"]
        self.assertEqual(team_skills.npx_source(skill), str(ROOT))

    def test_external_source_is_pinned_github_tree(self):
        skill = team_skills.catalog_index(team_skills.load_catalog())["visual-explainer"]
        self.assertEqual(
            team_skills.npx_source(skill),
            "https://github.com/nicobailon/visual-explainer/tree/v0.14.0/plugins/visual-explainer",
        )

    def test_policy_findings(self):
        catalog = team_skills.load_catalog()
        findings = team_skills.policy_findings(catalog, {"kiro"})
        self.assertEqual(findings["required"], ["human-acceptance-gate", "deploy"])
        self.assertEqual(findings["recommended"], ["autoresearch-skill"])
        self.assertEqual(findings["deprecated"], ["kiro"])

    def test_agent_aliases(self):
        self.assertEqual(team_skills.selected_agent("codex"), "codex")
        self.assertEqual(team_skills.selected_agent("claude"), "claude-code")


if __name__ == "__main__":
    unittest.main()
