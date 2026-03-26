# Protocol Unified v1.0
## Leaf Execution Protocol for Unified Sessions (Mode C)

**Context:** This protocol applies when a Leaf session performs both **Librarian** (investigation) and **Implementer** (execution) roles within a single session. This is the **default execution path** when a Discovery Directive exists and the Coordinator has not pre-selected Mode A.

**Applies to:** Mode C (Unified Execution). For Mode A (separate Implementer session), see Protocol_Informed.md. For Mode B (ad-hoc tasks without Trunk), see Protocol_Autonomous.md.

**Key Assumption:** The session has sufficient context (typically 1M) to accommodate both Discovery and Implementation phases. Context Checkpoints verify this assumption empirically at each transition point.

**Input Package:**
- Discovery Directive from Trunk
- PROJECT_MAP.md (if exists) — navigational context

**Design Principle:** Unified cognitive thread — one session discovers and implements, eliminating the information loss at session boundaries. Context Checkpoints replace upfront complexity estimates with empirical measurement.

---

## 1. Phase Sequence

```
Directive Coherence Check → Investigation → Discovery Report → [pause for Trunk]
     (Step 0, 2-3 min)        (Phase 1)       (output)

→ Context Checkpoint → Receive Informed Directive → Continuity Check → Planning → Implementation → Report
   (decision point)                                   (Phase 2)         (Phase 3)    (Phase 4)      (Phase 5)
```

---

## 2. Step 0: Directive Coherence Check

**Purpose:** Verify that the Discovery Directive is internally coherent before investing context in investigation. This step catches gaps between Trunk's intent (Mission) and instrumentation (Questions) that arise from the context gap between planning and execution environments.

**Duration:** 2-3 minutes.

**Checklist:**

1. **Mission ↔ Questions coverage** — every entity, concept, or capability mentioned in the Mission must map to at least one Investigation Question. If the Mission mentions "views, favorites, calls" but no Question covers call tracking — that's a gap.

2. **Search scope completeness** — all relevant directories listed in search guidance. Check that providers/, middleware/, services/, models/ are included where applicable, not just screens/ or routes/.

3. **Absence verification instructions** — for "does X exist?" questions, confirm the directive requires full endpoint/method read (SR — Semantic Read), not just keyword search (KW). Absence claims that drive implementation scope require SR verification.

4. **Cross-question gaps** — no blind spots between adjacent questions. If Q3 asks about a service and Q5 asks about a screen, but no question covers the provider that connects them — that's a gap.

**When to apply:**
- Medium+ directives (5+ questions, 2+ modules) — always
- Simple directives (2-3 questions, single module) — skip, overhead exceeds value

**Output:** Report findings to Coordinator before proceeding. Propose additions (new questions, expanded search scopes) for approval. Then execute the amended directive.

**If no gaps found:** Proceed to Phase 1.

---

## 3. Phase 1: Investigation (Librarian Role)

**Purpose:** Investigate the codebase, answering each question from the Discovery Directive with concrete evidence.

**Constraints during this phase:**
- Do NOT modify any files
- Do NOT create commits
- Do NOT implement solutions
- ONLY investigate and document findings

**Using PROJECT_MAP.md:** Read Layer 2 (Module Flow Maps) to identify the relevant module chain. Use bug hints for likely starting points. Skip Explore subagents for well-mapped modules.

**Investigation standards:**
- Each answer includes concrete evidence: file:line, code snippet, or NOT FOUND
- Absence claims use SR (Semantic Read) for any finding that determines implementation scope
- Additional Findings section captures relevant discoveries beyond the questions
- Navigation for Implementer section provides file paths, data flow, and reading order

**Output:** Discovery Report (see Methodology v9.3 Section 1.4 for format). Deliver to Coordinator for transfer to Trunk.

**After delivery:** Session pauses. Coordinator transfers Discovery Report to Trunk. Trunk creates Informed Directive. Coordinator transfers Informed Directive back to this session.

---

## 4. Context Checkpoint (Decision Point)

**Purpose:** Empirically verify that the session has sufficient remaining context for implementation, replacing upfront complexity guesses with measured data.

**Action:** Coordinator requests `/context` measurement after Discovery Report delivery.

**Decision matrix:**

| Context consumed | Signal | Decision |
|-----------------|--------|----------|
| < 25% | Normal for Low-Medium tasks at 1M | Continue as Implementer (default) |
| 25-40% | Moderate — monitor during implementation | Continue with awareness, checkpoint again after planning |
| > 40% | Anomalously heavy Discovery — High+ complexity | Coordinator considers Mode A transition |

**Mode A transition:** If Coordinator decides to transition to Mode A, the session ends after delivering the Discovery Report. A new Implementer session receives the Informed Directive + Discovery Report and follows Protocol_Informed.md.

**If continuing:** Proceed to Phase 2.

**Recording:** Note `Context: X% after Discovery` in the session's final report (Completion Report or Semantic Handoff). This data calibrates future decision thresholds.

---

## 5. Phase 2: Continuity Check

**Purpose:** Confirm working directory is unchanged since the Librarian phase. Since the agent just completed Discovery in the same session, full re-verification (Mode A's Sanity Check) is unnecessary.

**Action:**
- Run `git status` and `git diff`
- Confirm no files were modified during the Librarian phase
- Confirm no external commits appeared

**If no changes detected:** Proceed to Planning with full context from Discovery.

**If changes detected:** Re-read affected files before continuing.

**Key cognitive note:** The Informed Directive from Trunk serves not as a "map of territory" (the agent already knows the territory from its own investigation) but as a **checklist and scope limiter** — "do this, don't touch that."

---

## 6. Phase 3: Planning

**Propose implementation approach to Coordinator:**
- Files to create/modify
- Approach summary
- Potential risks identified
- How the plan maps to the Informed Directive's scope

**Wait for Coordinator approval** on significant changes.

---

## 7. Phase 4: Implementation

**Execute approved plan:**
- Use Navigation section from own Discovery as primary map (already internalized)
- Create/edit files according to plan
- Run tests/builds to verify
- Self-correct on failures

**Context Checkpoint (mid-implementation):** For multi-segment tasks, Coordinator may request `/context` after completing a segment to decide whether to continue or handoff.

---

## 8. Phase 5: Report

**If task complete:** Generate Completion Report (Section 12).

**If task incomplete (session ending):** Generate Semantic Handoff (Section 13).

**Always:** Commit with descriptive message referencing directive.

**Context recording:** Include `Context: X% final` in the report.

**Documentation Updates (mandatory on task completion):**

| What | When | Where |
|------|------|-------|
| Changelog entry | After each significant task/phase | `CHANGELOG.md` (root) — add new entry at top |
| Session report | After each implementation session | `mobile/session_reports/` or `admin-web/session_reports/` |
| Roadmap status | When entire phase completes | `docs/ROADMAP.md` — update phase status |
| README latest update | Optional, periodic | `README.md` section "Последнее обновление" |
| Claude Code memory | When project status changes or new lessons discovered | Auto-memory: typed files (see rules below) |
| Project Map | When new modules, migrations, or schema changes added | `PROJECT_MAP.md` — update affected layers (migrations table, module maps, test counts) |

**Rules:**
- CHANGELOG.md: 5-10 lines per entry, reverse chronological, date + task name + key results
- Session reports: detailed technical report following `phase_N_name_report.md` naming
- README.md: do NOT expand beyond current structure. Only refresh "Последнее обновление" section
- Roadmap: change status markers (planned -> in progress -> completed) when a full phase finishes
- Claude Code memory (auto-memory directory, typed file architecture):
  - `MEMORY.md` is a lean index (~40 lines) — only links to memory files, no content
  - Update `project_current_phase.md` when project status changes (new features deployed, phase transitions)
  - Create new `feedback_*.md` when a non-obvious lesson is discovered (with frontmatter: name, description, type: feedback)
  - Update `reference_*.md` when infrastructure config changes (deploy URLs, credentials, env vars)
  - Do NOT store information derivable from code, git log, or PROJECT_MAP.md

---

## 9. Infrastructure Diagnosis

**Critical Rule:** Before modifying code to fix an error, verify infrastructure status with Coordinator.

**Coordinator owns:** Backend server, emulator, database logs.

**When encountering unexpected failures:**

1. **STOP** — Do not immediately modify code
2. **ASK** — "Is backend running? Database accessible? Emulator healthy?"
3. **WAIT** — For Coordinator response
4. **THEN** — Proceed with code investigation if infrastructure confirmed healthy

**Trigger conditions:** API errors, database failures, timeouts, connection refused, tests failing without code changes.

### 9.1 Local Environment Requirements

**Current setup:** No local PostgreSQL / Docker. Backend runs only on Railway (production). Local environment supports unit tests (mocked DB) but NOT integration tests with a real database.

**Decision rule — when local DB is required:**

| Safe to deploy directly (unit tests + push) | Requires local backend + DB first |
|----------------------------------------------|-----------------------------------|
| Business logic changes in services | New migrations / ALTER TABLE / new columns |
| Validation rule changes | New or modified SQL queries (especially PostGIS) |
| Response format changes | New indexes / constraints / triggers |
| Refactoring without behavior change | New table creation or schema redesign |
| Middleware / auth logic changes | Integration with new services (Redis, queues) |

**When a task falls in the right column:**
1. **STOP** — Do not push directly to production
2. **INFORM** Coordinator: "This change requires local database testing before deploy"
3. **GUIDE** Coordinator through Docker + local PostgreSQL setup (one-time)
4. **TEST** locally, verify migrations apply cleanly, then push

**Note:** Coordinator is not a programmer. Leaf must proactively identify when local testing is needed — Coordinator will not flag this independently.

---

## 10. Scope Correction Signal

**When:** Directive assumptions do not match operational reality discovered during investigation or implementation.

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

**After signaling:** Wait for Coordinator response. Do not continue in questioned scope.

---

## 11. Flutter Paradigm

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

## 12. Completion Report

**Use when:** Task completed successfully.

```markdown
# Completion: [Task Name]

## Changes Made
- [File]: [what was done]
- [File]: [what was done]

## Commit Reference
[commit hash and message]

## Context Telemetry
- After Discovery: [X%]
- Final: [Y%]

## Notes for Future Work (optional)
- [Any observations relevant to future work in this area]

## Process Reflection (optional — for experimental or non-standard sessions)
- Cognitive load assessment: [how demanding was the task on focus and working memory]
- Positive/negative transfer between phases: [did earlier phases help or hinder later ones]
- Mode recommendation for similar tasks: [Mode A / B / C and why]
```

---

## 13. Semantic Handoff

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

## Context Telemetry
- After Discovery: [X%]
- Final: [Y%]

## Continuation Point
Open: [file]
First action: [action]
Expected outcome: [result if correct]
```

**Mandatory sections:** Problem Model, Verified Facts, Eliminated Hypotheses, Current State, Context Telemetry, Continuation Point.

---

## 14. Code Quality

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

## 15. Git Workflow

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

## 16. Escalation Triggers

**Stop and request Coordinator guidance when:**
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

Request: [What you need from Coordinator]
```

---

## Quick Reference

| Situation | Action |
|-----------|--------|
| Session start | Read this protocol, then Step 0 (Directive Coherence Check) |
| Directive has gaps | Report to Coordinator, propose additions, wait for approval |
| Investigation complete | Deliver Discovery Report, wait for Informed Directive |
| Discovery Report delivered | Coordinator requests /context checkpoint |
| Context < 25% | Continue as Implementer (default path) |
| Context > 40% | Coordinator considers Mode A transition |
| Before fixing errors | Ask about infrastructure status |
| Assumptions don't match | Issue Scope Correction Signal |
| Task complete | Completion Report + commit (include Context Telemetry) |
| Session ending, task incomplete | Semantic Handoff + commit (include Context Telemetry) |
| Stuck after 3 attempts | Use escalation format |

---

## Changelog

### v1.0 (March 2026)
- Initial version for Mode C (Unified Execution) — default path when Discovery Directive exists
- **Step 0: Directive Coherence Check** formalized from empirical discovery (Partner Analytics session, March 2026). Checks Mission↔Questions coverage, search scope completeness, absence verification instructions, and cross-question gaps
- **Context Checkpoint** integrated as standard decision point between Discovery and Implementation phases. Replaces upfront complexity estimation with empirical measurement
- **Context Telemetry** added to Completion Report and Semantic Handoff formats — accumulates calibration data for methodology evolution
- Sections carried from Protocol_Informed v1.4: Documentation Updates, Infrastructure Diagnosis, Flutter Paradigm, Code Quality, Git Workflow, Escalation Triggers, Scope Correction Signal
- Companion protocols: Protocol_Informed.md (Mode A), Protocol_Autonomous.md (Mode B)

---

*Execution protocol for Leaf sessions performing unified Discovery→Implementation workflow. Default path for Mode C — start here, measure context, continue or transition to Mode A based on data.*
