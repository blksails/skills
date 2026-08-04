# blksails/skills

> Two Claude Code skills for driving long-running work end to end:
> **`kiro`** — a spec-driven development pipeline with human approval gates and adversarial review.
> **`autoresearch`** — an autonomous experiment loop that keeps iterating while you sleep.

Both are heavyweight, multi-file skills: they carry their own phase specs, rules, templates, and scripts rather than being a single prompt file.

---

## kiro — spec-driven development pipeline

**55 files · 中文 · `/kiro`**

Kiro-style spec-driven development, run as one skill with all phase specs inside it. Work flows through `discovery → steering → requirements → design → tasks → impl → validate`, and **every phase stops at a human approval gate** before the next one starts.

### Directory contract

| Purpose | Path |
|---|---|
| Project steering (one per project, shared by all specs) | `.kiro/steering/{product,tech,structure}.md` |
| A single feature's spec | `.kiro/specs/<feature>/{spec.json,requirements.md,design.md,tasks.md}` |
| Multi-spec roadmap | `.kiro/steering/roadmap.md` |

### Subcommands

| Command | What it does |
|---|---|
| `/kiro` | Probe state, report, suggest the next step, wait for confirmation |
| `/kiro init` | Build or sync steering files from the existing codebase |
| `/kiro discovery "<idea>"` | Triage: new spec / amend an existing one / split into several / no spec needed |
| `/kiro spec <name>` | Create the spec directory, then flow into requirements |
| `/kiro requirements\|design\|tasks [feature]` | Enter that phase directly |
| `/kiro quick "<description>" [--auto]` | init → requirements → design → tasks in one run |
| `/kiro batch` | Create every spec on the roadmap, in parallel by dependency wave |
| `/kiro next` | Do exactly **one** unchecked task, in the main conversation |
| `/kiro run [feature] [task-numbers]` | Implementation. ≥3 pending tasks defaults to Workflow orchestration |
| `/kiro run --wave [feature]` | Concurrent waves that stay in the main conversation |
| `/kiro status [feature]` | Where the spec stands and what's next |
| `/kiro validate gap\|design\|impl <feature>` | Gap analysis / design review / feature-level acceptance |

### How implementation actually runs

`impl` never lets a task mark itself done. Each task goes **implementer → independent reviewer → (on failure) root-cause debugger**, with bounded rounds — max 2 review remediations, then max 2 debug rounds, then the task is blocked rather than looped on.

With ≥3 pending tasks it hands the whole task graph to a Workflow script: groups run concurrently by disjoint write set, each task is reviewed by **three adversarial lenses** (`acceptance` / `boundary` / `evidence`) voting by majority, and a completeness critic sweeps the finished batch for cross-task seams no per-task review can see.

**Test execution is split by role**, which is what keeps a wide run affordable:

| Actor | Runs |
|---|---|
| implementer | only the tests inside its own `_Boundary:_`, plus typecheck and lint |
| reviewer (`evidence` lens) | the canonical full suite — **this run is the regression verdict** |
| parent controller | the full suite once over the merged batch, then feature-level validation |

An implementer's full-suite run would prove nothing the reviewer accepts, and under concurrency it makes implementers chase sibling tasks' failures — so they don't get the command.

### Layout

```
kiro/
├── SKILL.md              # router: state detection, approval gates, execution modes
├── phases/<phase>/       # the full spec for each phase, plus its rules/ and templates/
│   ├── steering/  discovery/  spec-init/  spec-requirements/  spec-design/
│   ├── spec-tasks/  spec-batch/  spec-quick/  impl/  review/  debug/
│   └── validate-gap/  validate-design/  validate-impl/  verify-completion/
├── rules/                # parallel-dispatch.md, phase-handoff.md
├── workflows/            # parse-tasks.mjs, spec-exec.workflow.js, recover-run.mjs
└── assets/templates/     # bootstrap copies of .kiro/settings/templates/
```

Requires Node.js for the `workflows/` scripts, and a host with the Workflow tool for the concurrent execution mode. Everything else degrades to sequential dispatch.

---

## autoresearch — autonomous experiment loop

**44 files · EN · `/autoresearch:*`**

An autonomous research and experimentation toolkit: define a mechanical evaluation, then let the loop iterate — with overnight persistence and no external dependencies. Inspired by Karpathy's autoresearch, generalized to any domain where success can be measured mechanically.

| Command | What it does |
|---|---|
| `/autoresearch:plan` | 7-step setup wizard → produces `research.md` |
| `/autoresearch:debug` | Scientific bug hunting with falsifiable hypotheses |
| `/autoresearch:fix` | Iterative error crusher, auto-stops at zero errors |
| `/autoresearch:predict` | Multi-persona deliberation with anti-herd detection |
| `/autoresearch:security` | STRIDE + OWASP iterative audit |
| `/autoresearch:scenario` | 12-dimension scenario exploration |
| `/autoresearch:reason` | Adversarial refinement with a blind-judge panel |
| `/autoresearch:ship` | Universal shipping workflow (9 ship types) |
| `/autoresearch:learn` | Turn feedback and failures into an improvement plan + eval |

```
autoresearch-skill/
├── SKILL.md          # command routing + the inline core loop
├── skills/<cmd>/     # one sub-skill per command
├── guide/            # long-form guide per command, plus advanced patterns and chaining
├── scripts/          # autoresearch-loop.sh, check_progress.sh, init_research.py, release.sh
├── references/
└── assets/
```

Needs bash and Python 3 for the overnight loop scripts. Interactive use needs neither.

---

## Install

Symlink into your global skills directory:

```bash
git clone https://github.com/blksails/skills.git ~/src/blksails-skills
ln -s ~/src/blksails-skills/kiro              ~/.claude/skills/kiro
ln -s ~/src/blksails-skills/autoresearch-skill ~/.claude/skills/autoresearch-skill
```

Or per project, so the skill travels with the repo:

```bash
mkdir -p .claude/skills
cp -r ~/src/blksails-skills/kiro .claude/skills/
```

Restart Claude Code, then check `/context` to confirm the skill loaded. Invoke with `/kiro` or `/autoresearch:plan`, or just describe the task — both skills declare trigger conditions in their frontmatter and load themselves when your request matches.

---

## Notes

`kiro` is written in Chinese: its phase specs, prompts, and reports are all 中文. It drives an English-thinking agent fine, but read it before adapting.

Both skills assume a host that can dispatch subagents concurrently. On a host without that, `kiro` degrades to sequential single-task dispatch and says so explicitly instead of silently pretending to parallelize.

---

## Contributing

Please don't commit real personal data — names, phone numbers, credentials — in examples. Use obvious placeholders.

The `.gitignore` is a whitelist: nothing is tracked unless it's listed there. To publish another skill, add an explicit `!/your-skill/` line.

---

## License

MIT.

**Last updated:** 2026-08-04
