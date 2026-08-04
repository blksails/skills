# Research & Design Decisions Template

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale that inform the technical design.

**Usage**:
- Log research activities and outcomes during the discovery phase.
- Document design decision trade-offs that are too detailed for `design.md`.
- Provide references and evidence for future audits or reuse.
---

## Summary
- **Feature**: `<feature-name>`
- **Discovery Scope**: New Feature / Extension / Simple Addition / Complex Integration
- **Key Findings**:
  - Finding 1
  - Finding 2
  - Finding 3

## Research Coverage
Which dimensions were investigated, by whom, and what came back. Fill this in **before** the findings — it is what separates "we looked and found nothing" from "nobody looked", which are indistinguishable in a findings list.

| Dimension | Dispatched | Outcome | Notes |
|-----------|-----------|---------|-------|
| Existing implementation — `<subsystem>` | concurrent subagent | findings | — |
| External dependency — `<library>` | concurrent subagent | findings | version verified against official docs |
| Technology / best practices | concurrent subagent | **nothing conclusive** | searched, no authoritative source found |
| `<dimension>` | **not dispatched** | — | out of scope because … |

**Open unknowns** (carried into design or implementation — never silently dropped):
- Unknown 1 — who or what would resolve it
- Unknown 2 — …

## Research Log
Document notable investigation steps and their outcomes. Group entries by topic for readability.

### [Topic or Question]
- **Context**: What triggered this investigation?
- **Sources Consulted**: Links, documentation, API references, benchmarks
- **Findings**: Concise bullet points summarizing the insights
- **Implications**: How this affects architecture, contracts, or implementation

_Repeat the subsection for each major topic._

## Architecture Pattern Evaluation
List candidate patterns or approaches that were considered. Use the table format where helpful.

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Hexagonal | Ports & adapters abstraction around core domain | Clear boundaries, testable core | Requires adapter layer build-out | Aligns with existing steering principle X |

## Design Decisions
Record major decisions that influence `design.md`. Focus on choices with significant trade-offs.

### Decision: `<Title>`
- **Context**: Problem or requirement driving the decision
- **Alternatives Considered**:
  1. Option A — short description
  2. Option B — short description
- **Selected Approach**: What was chosen and how it works
- **Rationale**: Why this approach fits the current project context
- **Trade-offs**: Benefits vs. compromises
- **Follow-up**: Items to verify during implementation or testing

_Repeat the subsection for each decision._

## Risks & Mitigations
- Risk 1 — Proposed mitigation
- Risk 2 — Proposed mitigation
- Risk 3 — Proposed mitigation

## References
Provide canonical links and citations (official docs, standards, ADRs, internal guidelines).
- [Title](https://example.com) — brief note on relevance
- ...
