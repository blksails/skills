# Full Discovery Process for Technical Design

## Objective
Conduct comprehensive research and analysis to ensure the technical design is based on complete, accurate, and up-to-date information.

## Concurrent Execution Plan (read this before starting)

The six steps below are **research dimensions, not a sequence**. Steps 2–4 share no inputs and are where nearly all the wall clock goes — run them as **concurrent subagents dispatched in a single message**, per `../../../rules/parallel-dispatch.md`.

| Step | Where it runs | Why |
|---|---|---|
| 1. Requirements Analysis | Parent, first | Produces the technical-needs list that shapes every other dimension's prompt |
| 2. Existing Implementation | Concurrent (`Explore`) | Independent — split further, one subagent per subsystem, when the feature spans several |
| 3. Technology Research | Concurrent (`general-purpose`, needs WebSearch/WebFetch) | Independent |
| 4. External Dependencies | Concurrent (`general-purpose`) — **one subagent per external service/library** | Each dependency is a self-contained verification; serializing them is the single biggest waste in this phase |
| 5. Architecture & Boundary | Parent, after convergence | Requires the full picture; cannot be judged from one dimension |
| 6. Risk Assessment | Parent, after convergence | Same — risks emerge from the *combination* of findings |

Dispatch rules for this phase:
- Each subagent returns a **findings summary under ~150 lines** with concrete sources (file paths, doc URLs, version numbers) — never raw search results or file dumps.
- Every dimension must report what it **could not** establish. A dimension that returns only positive findings has not been asked the right question, and "no news" silently becomes "no risk" in the design.
- Steps 5 and 6 stay in the parent because subagents cannot see each other's findings. Choosing a pattern from one dimension's view is exactly how a design ships a decision that a second dimension already refuted.

## Discovery Steps

### 1. Requirements Analysis
**Map Requirements to Technical Needs**
- Extract all functional requirements from EARS format
- Identify non-functional requirements (performance, security, scalability)
- Determine technical constraints and dependencies
- List core technical challenges

### 2. Existing Implementation Analysis
**Understand Current System** (if modifying/extending):
- Analyze codebase structure and architecture patterns
- Map reusable components, services, utilities
- Identify domain boundaries and data flows
- Document integration points and dependencies
- Determine approach: extend vs refactor vs wrap

### 3. Technology Research
**Investigate Best Practices and Solutions**:
- **Use WebSearch** to find:
  - Latest architectural patterns for similar problems
  - Industry best practices for the technology stack
  - Recent updates or changes in relevant technologies
  - Common pitfalls and solutions

- **Use WebFetch** to analyze:
  - Official documentation for frameworks/libraries
  - API references and usage examples
  - Migration guides and breaking changes
  - Performance benchmarks and comparisons

### 4. External Dependencies Investigation
**For Each External Service/Library**:
- Search for official documentation and GitHub repositories
- Verify API signatures and authentication methods
- Check version compatibility with existing stack
- Investigate rate limits and usage constraints
- Find community resources and known issues
- Document security considerations
- Note any gaps requiring implementation investigation

### 5. Architecture Pattern & Boundary Analysis
**Evaluate Architectural Options**:
- Compare relevant patterns (MVC, Clean, Hexagonal, Event-driven)
- Assess fit with existing architecture and steering principles
- Identify domain boundaries and ownership seams required to avoid team conflicts
- Consider scalability implications and operational concerns
- Evaluate maintainability and team expertise
- Document preferred pattern and rejected alternatives in `research.md`

### 6. Risk Assessment
**Identify Technical Risks**:
- Performance bottlenecks and scaling limits
- Security vulnerabilities and attack vectors
- Integration complexity and coupling
- Technical debt creation vs resolution
- Knowledge gaps and training needs

## Research Guidelines

### When to Search
**Always search for**:
- External API documentation and updates
- Security best practices for authentication/authorization
- Performance optimization techniques for identified bottlenecks
- Latest versions and migration paths for dependencies

**Search if uncertain about**:
- Architectural patterns for specific use cases
- Industry standards for data formats/protocols
- Compliance requirements (GDPR, HIPAA, etc.)
- Scalability approaches for expected load

### Search Strategy
1. Start with official sources (documentation, GitHub)
2. Check recent blog posts and articles (last 6 months)
3. Review Stack Overflow for common issues
4. Investigate similar open-source implementations

## Output Requirements

Record the **research coverage** first — which dimensions were dispatched, which returned findings, and which came back empty or failed. A concurrent sweep that silently dropped a dimension looks exactly like a thorough one from the outside; the coverage note is what tells them apart. See the Research Coverage section of the `research.md` template.

Then capture all findings that impact design decisions in `research.md` using the shared template:
- Key insights affecting architecture, technology alignment, and contracts
- Constraints discovered during research
- Recommended approaches and selected architecture pattern with rationale
- Rejected alternatives and trade-offs (documented in the Design Decisions section)
- Updated domain boundaries that inform Components & Interface Contracts
- Risks and mitigation strategies
- Gaps requiring further investigation during implementation