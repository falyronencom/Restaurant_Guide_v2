# Leaf Session Operational Guide
## Compact Protocol Reference for Claude Code

**Purpose:** Operational rules for Leaf (Claude Code) sessions. This guide supplements Trunk directives when present, and serves as the primary reference for autonomous debugging/testing sessions.

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

**Critical Limitation:** You do not receive system notifications about context utilization. Coordinator monitors context externally and will signal when limits approach.

**Coordinator Signals and Required Actions:**

| Coordinator Says | Your Action |
|------------------|-------------|
| "Context at 70%" | Complete current logical unit, no new scope |
| "Context at 80%" | Create Checkpoint Report immediately |
| "Prepare for handoff" | Stop implementation, generate full Handoff Report |
| "Emergency stop" | WIP commit, minimal handoff, terminate |

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
```

**Anti-Pattern:** Never write problem narratives ("we struggled with..."), resolution stories ("after trying X..."), or decision rationale. State facts and next actions only.

---

## 3. Auto-Compact vs Manual Handoff

**Understanding the Difference:**

| Auto-Compact | Manual Handoff |
|--------------|----------------|
| Emergency fallback | Preferred method |
| Compresses entire history | Selective, relevant only |
| Retrospective (what happened) | Prospective (what to do) |
| Includes debugging noise | Filtered signal only |
| Chronological | Action-oriented |

**Rule:** Treat auto-compact as Plan B emergency measure. Always prefer creating manual Checkpoint/Handoff when coordinator signals context limits. Manual handoff produces dramatically better continuation quality.

---

## 4. Flutter Paradigm (Mobile Development)

**Mandatory Context:** This project uses Flutter/Dart for mobile development. Web paradigms must not appear in code.

**Anti-Pattern Reference:**

| WRONG (Web) | CORRECT (Flutter) |
|-------------|-------------------|
| className | Widget parameters |
| div, span | Column, Row, Stack, Container |
| CSS styling, style={{}} | ThemeData, BoxDecoration |
| href, Link | Navigator.push/pop, named routes |
| onClick | onTap, onPressed |
| DOM manipulation | Widget tree + state management |
| margin: "10px" | EdgeInsets.all(10) |

**Self-Check:** Before committing Flutter code, scan for any web paradigm terms. Their presence indicates semantic gap contamination.

---

## 5. Execution Discipline

**Phase Sequence (always follow):**

1. **Discovery** — Read relevant files before proposing changes. Use ls, cat, grep to understand current state.

2. **Plan** — Propose approach to coordinator before implementation. Wait for approval on significant changes.

3. **Implement** — Execute approved plan. Run tests/builds to verify.

4. **Report** — Commit with descriptive message. Generate checkpoint/handoff if session ending.

**Proactive Scope Extension:** If you identify valuable improvements beyond original task scope:
- Assess remaining context budget (ask coordinator if unsure)
- If budget permits and value clear, proceed
- Document extension in report
- Coordinator validates post-hoc

---

## 6. Escalation Triggers

**Stop and request coordinator guidance when:**

- Same error persists after 3 different solution attempts
- Fix for one issue creates new issues (Information Recursion signal)
- Unclear which of multiple valid approaches to choose
- Task requires modifying files outside stated scope
- Infrastructure appears unhealthy but coordinator hasn't confirmed
- You need information that exists in logs you cannot see

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

## 7. Code Quality Baseline

**All code must be production-ready:**

- Error handling: try-catch with appropriate recovery
- Security: Input validation, auth checks on protected routes
- Performance: Avoid N+1 queries, use lazy loading
- Consistency: Follow patterns in existing codebase
- Naming: Clear, reveals intent
- Comments: For complex logic only, not obvious operations

**Before Commit Checklist:**
- [ ] Code compiles without errors
- [ ] No web paradigm contamination (Flutter)
- [ ] Follows existing patterns in codebase
- [ ] Temporary debug code removed
- [ ] Commit message references task origin

---

## 8. Log Access Protocol

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

## Quick Reference Card

**Before fixing errors:** Ask coordinator about infrastructure status

**Context signals:** Coordinator will tell you; respond per Section 2 table

**Handoff quality:** Manual > Auto-compact (always prefer manual)

**Flutter code:** Zero web paradigms allowed (check Section 4 table)

**Stuck on problem:** Use escalation format from Section 6

**Need logs:** Request specific segments from coordinator

---

*This guide ensures consistent, high-quality Leaf session execution whether working from Trunk directive or in autonomous debugging mode.*