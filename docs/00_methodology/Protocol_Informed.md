# Protocol Informed v1.1
## Leaf Execution Protocol for Trunk Directives

**Context:** This protocol applies when Leaf receives an **Informed Directive** from Trunk — a directive created after Pre-flight Discovery, based on real codebase state via Semantic Map from Librarian.

**Key Assumption:** Discovery phase is already complete. Trunk has seen reality through Librarian's report. Directive reflects actual codebase state.

**Input Package:**
- Informed Directive from Trunk (based on Discovery Report)
- Discovery Report from Librarian (use Navigation section for coordinates)

**Design Principle:** Skip redundant discovery. Focus context on implementation.

---

## 1. Session Start: Quick Sanity Check

**Purpose:** Verify nothing changed since Librarian session AND confirm key gap claims before implementing.

**Duration:** 1-3 minutes (not full Pre-scan, but more than trivial check).

**Part A — Freshness Check:**
- [ ] Files mentioned in directive still exist
- [ ] No obvious breaking changes since Discovery Report
- [ ] Integration points still accessible

**Part B — Gap Verification (critical addition from v8.6):**
- [ ] For each item marked as "missing" or "gap" in Discovery Report that drives implementation scope, perform a targeted read of the relevant code section (e.g., build() method for UI gaps)
- [ ] Confirm the gap actually exists before implementing

**Guideline — Proportional Verification:** Verify the 2-3 highest-impact gaps that determine the largest portion of implementation work. Full re-verification of all findings is not required.

**If Mismatch Found:** Signal coordinator immediately. Do not proceed with stale directive or false gaps.

```markdown
## SANITY CHECK FAILED

**Type:** [Freshness Issue / False Gap Detected]

**Expected:** [What directive assumes]
**Found:** [What actually exists]

**Impact:** [How this affects implementation scope]

**Recommendation:** [Update directive / Proceed with reduced scope / Re-run Librarian]
```

**Rule:** If Sanity Check reveals that a key gap does not exist (code already implements the expected behavior), signal to Coordinator before proceeding with directive as written.

**If Check Passes:** Proceed to Phase 2 (Planning).

---

## 2. Phase Sequence

```
Quick Sanity Check → Planning → Implementation → Report
    (1-3 min)         (Phase 2)    (Phase 3)      (Phase 4)
```

**Phase 0 (Pre-scan) and Phase 1 (Discovery): SKIPPED** — Librarian already completed these.

### Phase 2: Planning

Propose implementation approach to coordinator:
- Files to create/modify
- Approach summary
- Potential risks identified

**Wait for coordinator approval** on significant changes.

### Phase 3: Implementation

Execute approved plan:
- Use Navigation section from Discovery Report as primary map
- Create/edit files according to plan
- Run tests/builds to verify
- Self-correct on failures

### Phase 4: Report

**If task complete:** Generate Completion Report (Section 4).

**If task incomplete (session ending):** Generate Semantic Handoff (Section 5).

**Always:** Commit with descriptive message referencing directive.

---

## 3. Infrastructure Diagnosis

**Critical Rule:** Before modifying code to fix an error, verify infrastructure status with coordinator.

**Coordinator owns:** Backend server, emulator, database logs.

**When encountering unexpected failures:**

1. **STOP** — Do not immediately modify code
2. **ASK** — "Is backend running? Database accessible? Emulator healthy?"
3. **WAIT** — For coordinator response
4. **THEN** — Proceed with code investigation if infrastructure confirmed healthy

**Trigger conditions:** API errors, database failures, timeouts, connection refused, tests failing without code changes.

---

## 4. Completion Report

**Use when:** Task completed successfully.

```markdown
# Completion: [Task Name]

## Changes Made
- [File]: [what was done]
- [File]: [what was done]

## Commit Reference
[commit hash and message]

## Notes for Future Work (optional)
- [Any observations relevant to future work in this area]
```

---

## 5. Semantic Handoff

**Use when:** Task incomplete, continues in next session.

**Core Principle:** Transfer understanding, not just coordinates. Every session that re-discovers what the previous session already knew represents a system failure.

```markdown
# Handoff: [Task Name]

## Problem Model
[WHY the problem exists — causal chain, not just symptom]

## Verified Facts
- [Fact 1]: confirmed by [evidence]
- [Fact 2]: confirmed by [evidence]

## Eliminated Hypotheses
- [Hypothesis 1]: eliminated because [evidence]
- [Hypothesis 2]: eliminated because [evidence]

## Dependency Graph
[File A] → [File B] → [File C]
Key transformation point: [where data changes]

## Semantic Anchors
- [Variable/function]: [why it matters]
- [Pattern]: [how it's used]

## Current State
Files modified: [list]
What works: [specific functionality]
What doesn't: [specific failure]

## Continuation Point
Open: [file]
First action: [action]
Expected outcome: [result if correct]
```

**Mandatory sections:** Problem Model, Verified Facts, Eliminated Hypotheses, Current State, Continuation Point.

---

## 6. Scope Correction Signal

**When:** Directive assumptions do not match operational reality (despite Informed Directive status).

```markdown
## SCOPE CORRECTION SIGNAL

**Type:** [Evidential Mismatch / Search Space Exhaustion / Disproportionate Cost]

**Observation:** [Concrete facts discovered]

**Implication:** [What this means for current scope]

**Options:**
A) [First option]
B) [Second option]
C) Escalate to Trunk for directive revision

**Recommendation:** [Which option and why]
```

**After signaling:** Wait for coordinator response. Do not continue in questioned scope.

---

## 7. Flutter Paradigm

**Mandatory:** Zero web paradigms in Flutter code.

### Level 1: Syntax
| WRONG (Web) | CORRECT (Flutter) |
|-------------|-------------------|
| className, div, span | Widget parameters, Column, Row, Container |
| CSS styling | ThemeData, BoxDecoration |
| onClick, href | onTap, Navigator.push |

### Level 2: Architecture
| WRONG | CORRECT |
|-------|---------|
| setState everywhere | Provider/ChangeNotifier |
| Promise.then in render | FutureBuilder, StreamBuilder |
| map() → div | ListView.builder |

### Level 3: State Management
| Anti-Pattern | Correct |
|-------------|---------|
| Logic in build() | Logic in Provider/Service |
| Direct API calls from screens | Screen → Provider → Service → API |
| Forgetting notifyListeners() | Always call after state mutation |

**Self-check before commit:** Scan for web paradigm contamination at all levels.

---

## 8. Code Quality

**All code must be production-ready:**
- Error handling: try-catch with appropriate recovery
- Security: Input validation, auth checks
- Performance: Avoid N+1 queries, lazy loading
- Consistency: Follow existing codebase patterns
- Naming: Clear, reveals intent

**Before Commit:**
- [ ] Code compiles without errors
- [ ] No web paradigm contamination
- [ ] Follows existing patterns
- [ ] Temporary debug code removed

---

## 9. Git Workflow

**Commit after:** Each logical unit (fixed bug, added feature, completed refactor).

**Message format:**
```
[type]: [brief description]

Types: feat, fix, refactor, docs, test, chore
```

**WIP commits allowed when:**
- Session ending with work in progress
- Escalation required
- Scope Correction Signal issued

**WIP format:** `WIP: [task] — [what works], [what pending]`

---

## 10. Escalation Triggers

**Stop and request coordinator guidance when:**
- Same error persists after 3 attempts
- Fix creates new issues (Information Recursion)
- Unclear which approach to choose
- Task requires files outside stated scope
- Infrastructure appears unhealthy

**Format:**
```
BLOCKED: [Brief description]

Attempted:
1. [Approach 1] — [Result]
2. [Approach 2] — [Result]

Hypothesis: [Best guess at root cause]

Request: [What you need from coordinator]
```

---

## Quick Reference

| Situation | Action |
|-----------|--------|
| Session start | Quick Sanity Check (1-3 min): freshness + gap verification |
| Key gap doesn't exist | Signal coordinator — False Gap Detected |
| Sanity check fails | Signal coordinator, do not proceed |
| Before fixing errors | Ask about infrastructure status |
| Need logs | Coordinator typically provides proactively |
| Assumptions don't match | Issue Scope Correction Signal |
| Task complete | Completion Report + commit |
| Session ending, task incomplete | Semantic Handoff + commit |
| Stuck after 3 attempts | Use escalation format |

---

## Changelog

### v1.1 (February 2026)
- **Quick Sanity Check expanded** to include Gap Verification (Part B)
- Added "False Gap Detected" type to Sanity Check Failed signal
- Duration increased from 30 sec to 1-3 min to accommodate gap verification
- Aligned with Methodology v8.6 amendments (Gap Verification Rule, Absence Verification Confidence)
- Added Proportional Verification guideline (verify 2-3 highest-impact gaps)

### v1.0 (February 2026)
- Initial version extracted from Compact Protocol v1.4
- Designed for Informed Directive workflow (post Pre-flight Discovery)
- Removed Pre-scan and Discovery phases (completed by Librarian)
- Added Quick Sanity Check as lightweight validation
- Retained: Infrastructure Diagnosis, Semantic Handoff, Flutter Paradigm, Code Quality, Git Workflow, Escalation
- Companion protocol: Protocol_Autonomous.md (for ad-hoc tasks)

---

*Execution protocol for Leaf sessions receiving Informed Directives from Trunk. Discovery already complete — focus on implementation.*
