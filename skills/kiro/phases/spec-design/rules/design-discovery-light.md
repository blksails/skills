# Light Discovery Process for Extensions

## Objective
Quickly analyze existing system and integration requirements for feature extensions.

## Concurrent Execution Plan

Light discovery is small enough that fan-out is optional — but it is not zero. Steps 1–3 are independent:

- **1 & 2 together** (`Explore`): extension points + dependency compatibility, one subagent — they read the same code
- **3 separately** (`general-purpose`): technology verification for new libraries, one subagent per new library — this is the part that goes to the network and dominates the wall clock
- **4 in the parent**: risk assessment needs both results

With no new libraries, step 3 disappears and there is nothing to parallelize — do it all inline. Two subagents is the realistic ceiling here; dispatching more costs more than it saves. See `../../../rules/parallel-dispatch.md`.

## Focused Discovery Steps

### 1. Extension Point Analysis
**Identify Integration Approach**:
- Locate existing extension points or interfaces
- Determine modification scope (files, components)
- Check for existing patterns to follow
- Identify backward compatibility requirements

### 2. Dependency Check
**Verify Compatibility**:
- Check version compatibility of new dependencies
- Validate API contracts haven't changed
- Ensure no breaking changes in pipeline

### 3. Quick Technology Verification
**For New Libraries Only**:
- Use WebSearch for official documentation
- Verify basic usage patterns
- Check for known compatibility issues
- Confirm licensing compatibility
- Record key findings in `research.md` (technology alignment section)

### 4. Integration Risk Assessment
**Quick Risk Check**:
- Impact on existing functionality
- Performance implications
- Security considerations
- Testing requirements

## When to Escalate to Full Discovery

Escalation means running the **full** dimension fan-out (`design-discovery-full.md`), not adding a few more inline searches. Discard nothing already found — feed it to the full sweep as prior context so those dimensions start informed.

Switch to full discovery if you find:
- Significant architectural changes needed
- Complex external service integrations
- Security-sensitive implementations
- Performance-critical components
- Unknown or poorly documented dependencies

## Output Requirements
- Clear integration approach (note boundary impacts in `research.md`)
- List of files/components to modify
- New dependencies with versions
- Integration risks and mitigations
- Testing focus areas