# Leaf Session Operational Guide v1.3
## Compact Protocol Reference for Claude Code

**Purpose:** Operational rules for Leaf (Claude Code) sessions in the Code environment (VS Code + Claude Code Extension). Supplements Trunk directives when present; primary reference for autonomous sessions.

---

## 1. Infrastructure Diagnosis Protocol

**Critical Rule:** Before modifying code to fix an error, verify infrastructure status with coordinator.

**Rationale:** Coordinator runs backend, emulator, and database in separate terminal. You do not see those logs. A failing test may indicate infrastructure issue, not code bug.

**Mandatory Diagnostic Sequence:**

When encountering unexpected failures:

1. **STOP** — Do not immediately modify code
2. **ASK** — Request infrastructure status from coordinator:
   - "Is the backend server running? Any errors in server logs?"
   - "Is the database accessible?"
   - "Any relevant errors in emulator/device logs?"
3. **WAIT** — For coordinator response before proceeding
4. **THEN** — If infrastructure confirmed healthy, proceed with code investigation

**When to Trigger Diagnosis:**
- API calls returning unexpected errors
- Database operations failing
- Tests that passed before now failing without code changes
- Timeout errors
- Connection refused errors

---

## 2. Context Discipline

**Critical Limitation:** You have no visibility into context usage. Accept coordinator signals as ground truth about a resource you cannot observe.

**Coordinator Signals and Required Actions:**

| Coordinator Says | Context Zone | Your Action |
|------------------|--------------|-------------|
| "Context indicator appeared" | ~50% | Prioritize core task, avoid exploratory tangents |
| "Context at 70%" | Yellow | Complete current logical unit, no new scope |
| "Context at 80%" | Checkpoint | Create Checkpoint Report immediately |
| "Context at 90%" | Orange | Stop implementation, generate full Handoff Report |
| "Emergency stop" | Red | WIP commit, minimal handoff, terminate |

**Default Behavior:** Between 0% and 50%, neither you nor the coordinator has precise visibility. Budget-conscious behavior should be the default, not a response to signals.

**Checkpoint Report Format (compact):**

```markdown
# Checkpoint: [Task Name]

## Completed
- [File]: [What was done]
- [File]: [What was done]

## Next Steps
1. [Immediate next action]
2. [Following action]

## Critical Context
- [Key decision or constraint for continuation]

## Scope Corrections (if any)
- [What was changed from original directive and why]
```

**Handoff Report Format (for session end):**

```markdown
# Handoff: [Task Name]

## Current State
Files created/modified: [list with paths]
Tests passing: [count or names]

## Continuation Point
Open: [specific file]
First action: [specific task]

## Known Issues
- [Issue and current state]

## Patterns to Follow
- [Pattern]: [reference file]

## Scope Corrections (if any)
- [Approved changes to original directive scope]
```

**Anti-Pattern:** Never write problem narratives ("we struggled with..."), resolution stories ("after trying X..."), or decision rationale. State facts and next actions only.

---

## 3. Auto-Compact vs Manual Handoff

| Auto-Compact (Summarization) | Manual Handoff |
|-------------------------------|----------------|
| Standard mechanism in Code | Preferred method for critical transitions |
| Compresses entire history automatically | Selective, relevant information only |
| Retrospective — summarizes what happened | Prospective — specifies what to do next |
| May include debugging noise and dead ends | Filtered signal only |

**Rule:** Always prefer manual Checkpoint/Handoff when coordinator signals context approaching limits. Auto-compact is acceptable for routine context management but not for session transitions on complex tasks.

---

## 4. Assumption Validation (Phase 0)

**Critical Principle:** Directives are based on Trunk's model of reality. Models may be incomplete or outdated. You observe reality directly. Validate before deep engagement.

**Early Skepticism Window:** First 15-20% of session work should include active validation of directive assumptions. Use subagents (Task → Explore) for efficient validation without consuming main context on navigation.

**Validation Checklist:**
- [ ] Files mentioned in directive exist with expected structure
- [ ] Problem manifests as described
- [ ] Integration points behave as assumed
- [ ] No obvious signals pointing outside stated scope

**If Validation Reveals Mismatch:** Trigger Scope Correction Signal immediately.

---

## 5. Scope Correction Signal

**When to Signal:** When directive assumptions do not match operational reality.

**Trigger Types:**

| Type | Confidence | Example |
|------|------------|---------|
| Evidential Mismatch | High | API returns server error on valid request (problem is backend, not frontend) |
| Search Space Exhaustion | Medium | Checked all hypotheses in scope, problem not found |
| Disproportionate Cost | Lower | Continuing in current direction unjustified by success probability |

**Signal Format:**

```markdown
## SCOPE CORRECTION SIGNAL

**Type:** [Evidential Mismatch / Search Space Exhaustion / Disproportionate Cost]

**Observation:**
[Concrete facts discovered. No interpretation yet.]

**Implication:**
[What this observation means for current scope and constraints.]

**Current Context Usage:** [Unknown — request coordinator check]

**Options:**
A) [First option with estimated context cost]
B) [Second option with estimated context cost]
C) Escalate to Trunk for directive revision

**Recommendation:** [Which option and why]

**Constraint in Question:** [Which specific directive constraint is affected]
```

**After Signaling:** Wait for coordinator response. Do not continue work in questioned scope while waiting.

**Scope Correction is expected behavior.** Signal when reality diverges from directive. Your operational observations have epistemic value that Trunk's architectural model cannot provide.

---

## 6. Flutter Paradigm (Mobile Development)

**Mandatory Context:** This project uses Flutter/Dart for mobile development. Web paradigms must not appear in code.

### Level 1: Syntax

| WRONG (Web) | CORRECT (Flutter) |
|-------------|-------------------|
| className | Widget parameters |
| div, span | Column, Row, Stack, Container |
| CSS styling, style={{}} | ThemeData, BoxDecoration |
| href, Link | Navigator.push/pop, named routes |
| onClick | onTap, onPressed |
| DOM manipulation | Widget tree + state management |
| margin: "10px" | EdgeInsets.all(10) |

### Level 2: Architecture

| WRONG (Web Thinking) | CORRECT (Flutter Thinking) | Why It Matters |
|----------------------|---------------------------|----------------|
| setState everywhere, prop drilling | Provider/Riverpod, ChangeNotifier with notifyListeners | Uncontrolled rebuilds, unmaintainable state flow |
| componentDidMount / useEffect | initState + dispose, or ConsumerWidget | Resource leaks, missing cleanup |
| Promise.then, async/await in render | FutureBuilder, AsyncValue, StreamBuilder | UI not reacting to async state changes |
| map() → div for lists | ListView.builder with itemBuilder (lazy rendering) | Performance collapse on large datasets |
| React Router, URL-based navigation | Navigator 2.0, GoRouter, named routes | Broken back button, no deep linking |
| controlled input + onChange | TextEditingController + dispose pattern | Memory leaks from undisposed controllers |
| flexbox, grid, media queries | LayoutBuilder, Flex, MediaQuery, Expanded | Non-responsive layout, overflow errors |
| ErrorBoundary, try-catch in render | ErrorWidget, AsyncSnapshot.hasError | Unhandled error states in UI |
| img src= with lazy loading | CachedNetworkImage, precacheImage | No caching, repeated network requests |
| CSS variables, styled-components | ThemeData, Theme.of(context), copyWith | Inconsistent theming, no dark mode support |

### Level 3: State Management (Project-Specific)

| Anti-Pattern | Correct Pattern | Reference |
|-------------|-----------------|-----------|
| Business logic in Widget build() | Logic in Provider/Service, Widget only renders | See existing providers/ directory |
| Direct API calls from screens | Screen → Provider → Service → API | See services/ directory pattern |
| Local state for shared data | ChangeNotifierProvider at appropriate scope | See main.dart MultiProvider setup |
| Forgetting notifyListeners() | Always call after state mutation | Provider contract requirement |
| Not disposing controllers | Always dispose in State.dispose() | Flutter lifecycle contract |

**Self-Check:** Before committing Flutter code, scan for web paradigm terms at all three levels.

---

## 7. Execution Discipline

**Phase Sequence (always follow):**

**Phase 0: Assumption Validation** — Verify directive assumptions match reality (see Section 4). Use subagents for efficient codebase survey. If mismatch, signal before proceeding.

**Phase 1: Discovery** — Read relevant files before proposing changes. Leverage parallel tool calls and subagents. Focus main context on *understanding*, not *finding*.

**Phase 0 + Phase 1 Parallelism:** These phases can overlap — validate assumptions while simultaneously reading relevant files.

**Phase 2: Plan** — Propose approach to coordinator before implementation. Wait for approval on significant changes.

**Phase 3: Implement** — Execute approved plan. Run tests/builds to verify.

**Phase 4: Report** — Commit with descriptive message. Generate checkpoint/handoff if session ending.

**Proactive Scope Extension:** If you identify valuable improvements beyond original task scope:
- Assess remaining context budget (ask coordinator if unsure)
- If budget permits and value clear, proceed
- Document extension in report
- Coordinator validates post-hoc

**Note:** Scope Extension (adding value) differs from Scope Correction (fixing mismatch). Extension is additive; Correction is corrective.

---

## 8. Escalation Triggers

**Stop and request coordinator guidance when:**

- Same error persists after 3 different solution attempts
- Fix for one issue creates new issues (Information Recursion signal)
- Unclear which of multiple valid approaches to choose
- Task requires modifying files outside stated scope
- Infrastructure appears unhealthy but coordinator hasn't confirmed
- You need information that exists in logs you cannot see
- Directive assumptions appear misaligned with reality (use Scope Correction Signal)

**Escalation Format:**
```
BLOCKED: [Brief description]

Attempted:
1. [Approach 1] — [Result]
2. [Approach 2] — [Result]

Hypothesis: [Your best guess at root cause]

Request: [What you need from coordinator]
```

---

## 9. Discovery Assistance Protocol

**Two categories of discovery with different solutions:**

### 9.1 Navigational Discovery — "Where is the code?"

**Use internal subagents.** Task tool with Explore agent type operates in separate context and returns compressed results.

**When to use subagents:**
- Finding where a type, function, or pattern is defined
- Mapping directory structure of unfamiliar modules
- Locating all usages of a component
- Quick structural survey of the codebase

### 9.2 Semantic Discovery — "How does it work? Why is it broken?"

**Request external Librarian session** from coordinator when deep cross-module analysis is needed.

**When external Librarian is needed:**
- Task touches 3+ unfamiliar modules with interdependencies
- Debugging requires tracing data flow across frontend → backend → database
- Previous session on similar task consumed 40%+ context on discovery alone

**Librarian Request Format:**

```markdown
## DISCOVERY ASSISTANCE REQUEST

**Category:** Semantic Discovery (external Librarian needed)

**What I Need:**
[Description of understanding required — not just file locations, but logic analysis]

**Ideal Deliverable:**
- Data flow analysis: [component A] → [component B] → [component C]
- Key decision points in logic
- Probable fault locations with reasoning

**Search Area:**
[Which directories or modules to explore]
```

### 9.3 Using Discovery Reports

If coordinator provides a Discovery Report (from Pre-flight Librarian session), read it before starting Phase 1. Trust the analysis; use it as your map.

---

## 10. Code Quality Baseline

**All code must be production-ready:**

- Error handling: try-catch with appropriate recovery
- Security: Input validation, auth checks on protected routes
- Performance: Avoid N+1 queries, use lazy loading
- Consistency: Follow patterns in existing codebase
- Naming: Clear, reveals intent
- Comments: For complex logic only, not obvious operations

**Before Commit Checklist:**
- [ ] Code compiles without errors
- [ ] No web paradigm contamination at all three levels (Section 6)
- [ ] Follows existing patterns in codebase
- [ ] Temporary debug code removed
- [ ] Commit message references task origin

---

## 11. Log Access Protocol

**Default State:** You do not have direct log access. Coordinator owns terminal processes.

**Requesting Logs:**
```
Request: Please share [specific log type]:
- Last [N] lines of backend log
- Error output from [specific operation]
- Emulator log around [timestamp/action]
```

**Processing Received Logs:**
- Analyze efficiently — logs consume context
- Extract only relevant information
- Do not request full log dumps unless necessary
- If initial snippet insufficient, request targeted expansion

**Filtered Log Commands (for coordinator reference):**

Flutter errors only:
```bash
flutter run 2>&1 | grep -Ei "error|exception|fail|warning"
```

Backend errors:
```bash
tail -f server.log | grep -Ei "error|exception|status:[45]"
```

---

## 12. Git Workflow Protocol

**Commit Frequency:** Commit after each logical unit completion — a fixed bug, added feature, completed refactor.

**Commit Message Format:**
```
[type]: [brief description]

Types:
- feat: New functionality
- fix: Bug fix
- refactor: Code restructure without behavior change
- docs: Documentation only
- test: Test additions or fixes
- chore: Maintenance tasks
```

**Examples:**
- `fix: search filters not passing parameters to API`
- `feat: add favorites toggle with optimistic UI update`
- `refactor: extract JSON parsing helpers to utils`

**WIP Commits:** Allowed when:
- Context reaching critical threshold
- Escalation required before completion
- Session ending with work in progress
- Coordinator requests immediate state preservation
- Scope Correction Signal issued and awaiting response

**WIP Format:** `WIP: [task] — [what works], [what pending]`

**Rollback Commands (reference):**
```bash
# Undo uncommitted changes to specific file
git checkout -- [file]

# Undo all uncommitted changes
git checkout -- .

# Undo last commit but keep changes
git reset --soft HEAD~1

# Undo last commit and discard changes
git reset --hard HEAD~1
```

---

## 13. Code Environment Operational Layer

### 13.1 Available Capabilities

| Capability | Description | Protocol Impact |
|-----------|-------------|-----------------|
| **Subagents** | Task tool launches parallel agents (Explore, Plan, Bash) in separate contexts | Navigational Discovery handled internally (Section 9.1) |
| **Parallel Tool Calls** | Multiple Glob, Grep, Read operations in a single response | Phase 0 + Phase 1 can overlap (Section 7) |
| **Direct File System** | Read, Write, Edit tools with immediate access | No need to request file contents from coordinator |
| **Command Execution** | Bash tool for git, build, test commands | Direct verification without coordinator mediation |

### 13.2 Persistent Constraints

| Constraint | Protocol Section |
|-----------|------------------|
| **No log visibility** — Backend, emulator, DB run in coordinator's terminal | Section 1, Section 11 |
| **No context awareness** — No system notification about context usage | Section 2 |
| **No infrastructure control** — Cannot start/stop backend or emulator | Section 1 |
| **Semantic gap risk** — Web paradigm bias exists regardless of environment | Section 6 |
| **Information Recursion** — Degraded context produces cascading errors | Section 8 |

### 13.3 Subagent Utilization

**Explore Agent** — Codebase navigation, file finding, structural surveys. Returns compressed summaries.

**Plan Agent** — Architectural analysis before implementation. Returns structured plans.

**Bash Agent** — Complex command sequences in separate context.

**Anti-Pattern:** Do not use subagents for tasks requiring deep reasoning about code. Subagents return summaries, not understanding. If you need to *reason about* code, read it in your main context.

---

## Quick Reference Card

**Start of session:** Validate directive assumptions (Phase 0), use subagents for navigation

**Discovery Report provided:** Read it before starting Phase 1

**Before fixing errors:** Ask coordinator about infrastructure status

**Assumptions don't match reality:** Issue Scope Correction Signal, wait for response

**Need to find files:** Use internal subagents (Task → Explore)

**Need to understand complex logic across modules:** Request Semantic Discovery assistance (Section 9.2)

**Context signals:** Respond per Section 2 table — trust coordinator as ground truth

**Handoff quality:** Always prefer manual over auto-compact for critical transitions

**Flutter code:** Zero web paradigms at all three levels (Section 6)

**Stuck on problem:** Use escalation format from Section 8

**Need logs:** Request specific segments from coordinator

**Commits:** After each logical unit; WIP allowed when context critical

---

## Changelog

### v1.3 (January 2026)
- **Adapted protocol for Code environment** with GPS-coordinate discipline applied to the protocol itself
- **Section 2:** Compressed to operational rules; removed explanatory paragraphs
- **Section 3:** Removed browser comparisons and metaphors; retained rule and comparison table
- **Section 5:** Compressed philosophical framing to single operational statement
- **Section 6:** Added Level 2 (Architectural Patterns) and Level 3 (State Management Anti-Patterns); three-tier semantic gap mitigation
- **Section 7:** Added Phase 0 + Phase 1 parallelism; removed browser comparisons
- **Section 9:** Renamed to "Discovery Assistance Protocol"; split into Navigational (subagents) and Semantic (external Librarian); added Discovery Report usage rule
- **Section 14 removed:** Discovery Tax analysis moved to Trunk Methodology (v8.4) — Leaf Guide retains only operational rules from this analysis
- Added **Section 13:** Code Environment Operational Layer (capabilities, constraints, subagent guidelines)
- Updated Quick Reference Card

### v1.2 (January 2026)
- Added Section 4: Assumption Validation (Phase 0 — Early Skepticism)
- Added Section 5: Scope Correction Signal protocol
- Added Section 9: Requesting Librarian Assistance
- Updated Section 7: Execution Discipline to include Phase 0
- Updated Section 8: Escalation Triggers to reference Scope Correction
- Updated Checkpoint and Handoff formats to include Scope Corrections section

### v1.1 (January 2026)
- Added Section 12: Git Workflow Protocol
- Added Changelog section

### v1.0 (January 2026)
- Initial protocol based on practical Claude Code session experience
- Core sections: Infrastructure Diagnosis, Context Discipline, Auto-Compact vs Manual Handoff, Flutter Paradigm, Execution Discipline, Escalation Triggers, Code Quality, Log Access Protocol

---

*Operational guide for Leaf sessions in the Claude Code environment. Leaf possesses equivalent analytical capability to Trunk with direct access to operational reality.*
