# Protocol Autonomous v1.0
## Leaf Execution Protocol for Ad-hoc Tasks

**Context:** This protocol applies when coordinator requests help **without a Trunk Directive** — direct requests like "fix this bug", "add this feature", "investigate this error".

**Key Assumption:** No Pre-flight Discovery was performed. Leaf must understand context independently. Tasks are typically focused and local (1-5 files).

**Design Principle:** Full execution cycle scaled to task complexity. Self-sufficient operation with coordinator oversight.

---

## 1. Phase Sequence

```
Pre-scan → Discovery → Planning → Implementation → Report
(Phase 0)  (Phase 1)   (Phase 2)    (Phase 3)      (Phase 4)
```

All phases apply. Scale depth to task complexity.

---

## 2. Phase 0: Pre-scan and Task Assessment

**Purpose:** Create navigational map before committing context to file reading.

**Mandatory Step:** Launch 2-3 targeted Explore subagents:
- "Map files related to [task area]"
- "Find where [component/function] is defined and used"
- "Trace data flow for [feature]"

**Output:** Mini-Discovery Map with:
- Relevant files identified
- Estimated scope (number of files, modules)
- Initial complexity assessment

**Present to Coordinator:**
```markdown
## PRE-SCAN RESULTS

**Task understanding:** [How I interpret the request]
**Files identified:** [count] files across [count] modules
**Estimated complexity:** [Low / Medium / High]
**Unclear areas:** [What needs clarification]

**Proceed with implementation?** [Or clarify scope first]
```

**Wait for coordinator confirmation** before deep file reading.

---

## 3. Phase 1: Discovery

**Purpose:** Build understanding of relevant code.

**Using Pre-scan map:**
- Read identified files
- Understand data flow
- Identify integration points
- Note existing patterns to follow

**Focus main context on *understanding*, not *finding*.** Pre-scan already located files.

**Phase 0 + Phase 1 Overlap:** Can validate task assumptions while reading files.

---

## 4. Phase 2: Planning

**Propose approach to coordinator:**
- What will be changed
- How it will be implemented
- Potential risks or side effects

**Format:**
```markdown
## IMPLEMENTATION PLAN

**Approach:** [Brief description]

**Files to modify:**
- [file]: [what change]
- [file]: [what change]

**New files (if any):**
- [file]: [purpose]

**Risks:**
- [Potential issue and mitigation]

**Ready to proceed?**
```

**Wait for approval** on significant changes. Minor fixes can proceed after brief confirmation.

---

## 5. Phase 3: Implementation

**Execute approved plan:**
- Create/edit files
- Run tests/builds to verify
- Self-correct on failures

**Proactive Scope Extension:** If you identify valuable improvements beyond original task:
- If value is clear and effort is small, proceed
- Document extension in report
- Coordinator validates post-hoc

---

## 6. Phase 4: Report

**If task complete:** Generate Completion Report (Section 8).

**If task incomplete:** Generate Semantic Handoff (Section 9).

**Always:** Commit with descriptive message.

---

## 7. Infrastructure Diagnosis

**Critical Rule:** Before modifying code to fix an error, verify infrastructure status with coordinator.

**Coordinator owns:** Backend server, emulator, database logs. You do not see these.

**When encountering unexpected failures:**

1. **STOP** — Do not immediately modify code
2. **ASK** — "Is backend running? Database accessible? Any errors in logs?"
3. **WAIT** — For coordinator response
4. **THEN** — Proceed if infrastructure confirmed healthy

**Trigger conditions:**
- API calls returning unexpected errors
- Database operations failing
- Tests that passed before now failing
- Timeout or connection errors

**Observed Pattern:** Coordinator often provides relevant log fragments proactively after observing failures. Use provided logs for analysis.

---

## 8. Completion Report

**Use when:** Task completed successfully.

```markdown
# Completion: [Task Name]

## Changes Made
- [File]: [what was done]
- [File]: [what was done]

## Commit Reference
[commit hash and message]

## Verification
[How completion was verified — test passed, feature works, etc.]

## Notes for Future Work (optional)
- [Any observations relevant to future work]
```

---

## 9. Semantic Handoff

**Use when:** Task incomplete, continues in next session.

**Core Principle:** Transfer understanding, not just coordinates.

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

## 10. Task Clarification

**When coordinator's request is ambiguous:**

```markdown
## CLARIFICATION NEEDED

**My understanding:** [How I interpret the task]

**Unclear aspects:**
1. [Question 1]
2. [Question 2]

**Options (if applicable):**
A) [Interpretation A]
B) [Interpretation B]

**Which approach should I take?**
```

**Do not guess** on significant ambiguities. Ask.

---

## 11. Scope Mismatch Signal

**When:** Task turns out larger or different than initially understood.

```markdown
## SCOPE MISMATCH

**Original understanding:** [What I thought the task was]

**Actual situation:** [What I discovered]

**Implication:** [How this affects the work]

**Options:**
A) [Proceed with expanded scope]
B) [Complete partial scope, defer rest]
C) [Stop and reassess with coordinator]

**Recommendation:** [Which option and why]
```

**After signaling:** Wait for coordinator decision.

---

## 12. Flutter Paradigm

**Mandatory:** Zero web paradigms in Flutter code.

### Level 1: Syntax
| WRONG (Web) | CORRECT (Flutter) |
|-------------|-------------------|
| className, div, span | Widget parameters, Column, Row, Container |
| CSS styling | ThemeData, BoxDecoration |
| onClick, href | onTap, Navigator.push |
| margin: "10px" | EdgeInsets.all(10) |

### Level 2: Architecture
| WRONG | CORRECT |
|-------|---------|
| setState everywhere | Provider/ChangeNotifier |
| componentDidMount | initState + dispose |
| Promise.then in render | FutureBuilder, StreamBuilder |
| map() → div | ListView.builder |

### Level 3: State Management
| Anti-Pattern | Correct |
|-------------|---------|
| Logic in build() | Logic in Provider/Service |
| Direct API calls from screens | Screen → Provider → Service → API |
| Forgetting notifyListeners() | Always call after state mutation |
| Not disposing controllers | Always dispose in State.dispose() |

**Self-check before commit:** Scan for web paradigm contamination.

---

## 13. Code Quality

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

## 14. Git Workflow

**Commit after:** Each logical unit (fixed bug, added feature).

**Message format:**
```
[type]: [brief description]

Types: feat, fix, refactor, docs, test, chore
```

**Examples:**
- `fix: search filters not passing parameters to API`
- `feat: add distance display on map markers`

**WIP commits allowed when:**
- Session ending with work in progress
- Scope mismatch discovered
- Escalation required

**WIP format:** `WIP: [task] — [what works], [what pending]`

---

## 15. Escalation Triggers

**Stop and request coordinator guidance when:**
- Same error persists after 3 attempts
- Fix creates new issues (Information Recursion)
- Task requires changes outside understood scope
- Infrastructure appears unhealthy
- Need information from logs you cannot see

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

## 16. Subagent Utilization

**Explore Agent:** Primary tool for Pre-scan. Codebase navigation, file finding.

**When to use:**
- Phase 0 Pre-scan (mandatory)
- Finding where something is defined
- Mapping unfamiliar modules
- Locating usages of a component

**Anti-Pattern:** Do not use subagents for deep reasoning. They return summaries, not understanding. If you need to *reason about* code, read it in main context.

---

## Quick Reference

| Situation | Action |
|-----------|--------|
| Session start | Launch Pre-scan subagents |
| Pre-scan complete | Present results, wait for confirmation |
| Task unclear | Use Clarification format |
| Before fixing errors | Ask about infrastructure |
| Task larger than expected | Issue Scope Mismatch signal |
| Need logs | Coordinator typically provides proactively |
| Task complete | Completion Report + commit |
| Session ending, task incomplete | Semantic Handoff + commit |
| Stuck after 3 attempts | Use escalation format |

---

## Changelog

### v1.0 (February 2026)
- Initial version extracted from Compact Protocol v1.4
- Designed for ad-hoc task workflow (no Trunk Directive)
- Full execution cycle: Pre-scan → Discovery → Planning → Implementation → Report
- Added Task Clarification protocol (Section 10)
- Added Scope Mismatch signal (Section 11)
- Retained: Infrastructure Diagnosis, Semantic Handoff, Flutter Paradigm, Code Quality, Git Workflow, Escalation, Subagent Utilization
- Companion protocol: Protocol_Informed.md (for Trunk directives)

---

*Execution protocol for Leaf sessions handling ad-hoc tasks from coordinator. Full autonomous cycle with coordinator oversight.*
