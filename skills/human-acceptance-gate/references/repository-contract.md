# Registry contract

## Ownership

The global skill owns `references/project-registry.json`. Application repositories do not need a policy file, detector, hook, package script, PR template, or CI workflow for agent-side detection.

Normalize `git@host:owner/repo.git`, `ssh://git@host/owner/repo.git`, and `https://host/owner/repo.git` to `host/owner/repo`. Prefer `origin`; if it is absent, expose the selected remote. Never choose a project from its local folder name.

## JSON shape

```json
{
  "version": 1,
  "defaults": {
    "excludeGlobs": ["**/*.test.*", "**/*.md"],
    "reportDirectory": ".human-acceptance/reports"
  },
  "projects": [
    {
      "source": "github.com/example/project",
      "rules": [
        {
          "id": "critical-callback",
          "role": "implementer",
          "target": "external-platform-or-repository-when-applicable",
          "label": "人类验收关键回调闭环",
          "docs": "https://example.com/docs/critical-callback",
          "match": {
            "files": ["src/api/callback.ts"],
            "directories": ["src/callback/"],
            "globs": ["migrations/*callback*.sql"]
          }
        }
      ]
    }
  ]
}
```

Allowed roles are `caller`, `implementer`, `upstream`, `downstream`, and `data-contract`.
For callers, `target` identifies the repository or external boundary called directly. This prevents an indirect UI caller from being described as a direct caller of the terminal service.

## Match semantics

A rule triggers only when both conditions are true:

1. the normalized Git source equals `project.source`;
2. at least one changed repository-relative file matches that rule.

`files` are exact paths. `directories` are explicit path prefixes ending in `/`. `globs` support `*`, `**`, `?`, and comma-separated braces such as `migrations/*{push,tracks}*.sql`.

Apply `defaults.excludeGlobs` before positive matching. Documentation, screenshots, snapshots, and tests do not trigger. Never use a repository root, `**`, or another catch-all positive match. Registration means “known project,” not “all changes are risky.”

Prefer exact files. Use a directory only when the whole cohesive module can affect the terminal behavior. Use globs for controlled file families whose names vary, such as timestamped migrations.

## Stable flows

| ID                  | Terminal evidence                                                                   |
| ------------------- | ----------------------------------------------------------------------------------- |
| `ablink`            | Management configuration reread, public redirect result, matching access trace      |
| `feedback`          | Configuration reread, landing-page execution, same test click ID in tracking data   |
| `wxwork-autoconfig` | Apply-version terminal state, BlackSail resources, WeCom platform resources         |
| `workflow-pushback` | Workflow terminal state, pushback row, advertising platform event, operating metric |

Treat IDs as an interface consumed by commit history. Add a new ID rather than repurposing an old one for a different business chain.

## Test-request report

The report is optional by user choice, but the agent's offer is mandatory whenever staged code triggers a rule. Its initial status is always `待人类验收`. It records source, role, branch, base HEAD, changed files, triggered flows, procedure links, requested environment and tester, risk/rollback notes, and empty evidence fields. It must not contain fabricated execution times, screenshots, platform outcomes, or approval.

## Commit and PR evidence

Use stable commit trailers:

```text
Manual-Acceptance-Required: yes
Manual-Acceptance: <stable-id[, stable-id...]>
Manual-Acceptance-Docs: <docs URL[, docs URL...]>
```

For each affected flow, the PR body keeps an unchecked item until a real person provides environment, tester, time, and reviewable evidence. `无`, `暂无`, `todo`, `n/a`, and `-` are not evidence.
