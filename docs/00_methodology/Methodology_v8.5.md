# Distributed Intelligence Methodology v8.5
## The Agentic Framework for Restaurant Guide

**Version:** 8.5
**Date:** February 2026
**Status:** Active Operational Standard
**Core Paradigm:** Human Coordination of Autonomous Agents

---

## Part I: The Agentic Architecture

### 1.1 Core Concept: Distributed Intelligence System

The methodology implements a two-tier Agentic Model where strategic planning and autonomous execution operate as distinct but connected layers. Human vision coordinates with AI capabilities through structured protocols.

**Architecture Summary:** Trunk (strategic planning, web interface) coordinates Leaf sessions (autonomous execution, CLI). Trunk maintains coherence and long-term vision; Leaves perform focused implementation with direct codebase access.

### 1.2 Two-Tier Execution Architecture

**Tier 1 — Strategic Trunk (Web Interface)**

Role: The Architect and Planner.

Environment: Claude.ai Project Interface (browser-based).

Responsibilities:
- Maintains global context and long-term architectural vision
- Analyzes session reports and accumulated project knowledge
- Formulates high-level directives for Leaf execution
- Coordinates cross-domain integration and phase transitions
- Evolves methodology based on operational learnings
- Manages project documentation and specifications

Constraint: Does not write implementation code directly. Focuses on *what* needs to be accomplished and *why*, leaving *how* to the autonomous Leaf.

**Tier 2 — Autonomous Leaf (Local Execution)**

Role: The Builder, Tester, and Integrator.

Environment: VS Code Terminal via Claude Code Extension.

Responsibilities:
- Direct codebase access: reads actual file structure and current state
- Planning: proposes implementation approach based on directive
- Execution: creates files, edits code, manages dependencies
- Verification: runs local tests to validate functionality
- Integration: commits changes to Git with descriptive messages
- Reporting: generates completion report for Trunk analysis

Key Capability: Leaf sessions iterate autonomously with direct codebase access, enabling rapid feedback loops and self-correction.

### 1.3 The Human Coordinator Role

Role: The Bridge, Guardian, Vision Keeper, and Session Auditor.

**Core Responsibilities:**

Strategic Vision Keeper: Maintains long-term architectural coherence across sessions. Ensures individual session outputs align with overall project direction. Makes final decisions when agent proposals conflict with project principles.

Context Bridge: Transfers directives from Trunk (Web) to Leaf (CLI) and reports from Leaf back to Trunk. Manages the information flow between systems with different interfaces and capabilities.

Safety Gate: Approves or rejects file operations proposed by Leaf agents. Validates that proposed changes align with project intent before execution. Ensures backups exist before complex refactoring operations.

Resource Manager: Monitors context utilization across sessions. Plans session continuity and handoffs. Selects appropriate tools (Trunk vs Leaf, browser vs CLI) based on task requirements.

Scope Authority: Authorizes proactive scope extension when Leaf identifies high-value opportunities beyond strict directive boundaries.

Proactive Information Provider: In practice, the coordinator proactively provides relevant information (log fragments, test results, infrastructure status) without waiting for Leaf to request it. This observed pattern reflects the coordinator's real-time visibility into systems that Leaf cannot access.

#### 1.3.1 Session Auditor Role

Before launching any Leaf session, the coordinator performs a pre-flight audit ensuring optimal conditions for autonomous execution.

**Pre-Session Audit Checklist:**

Environment Preparation:
- Clear caches and temporary files that could consume context
- Verify Git working directory is clean (no uncommitted changes)
- Confirm backend/emulator services are running in coordinator's terminal (not agent's)
- Prepare log filters for critical-only output

Information Preparation:
- Verify handoff data is current and accurate
- Confirm directive is complete and appropriately scoped
- Prepare Semantic Handoff from previous session if continuing work (see Section 5.2)
- Clear any stale context from previous debugging sessions

Launch Package Assembly:
- Directive document (scoped appropriately)
- Previous Semantic Handoff (if continuation)
- Session Execution Header with mode and segment specification
- Log filter configuration commands
- Discovery Report from Librarian session (if Complexity Gate triggered)

**Coordinator Terminal Ownership:** Heavy processes (backend server, Flutter emulator, database connections) run in coordinator's terminal, not in agent's context. Agent accesses results through filtered queries, preserving context for implementation work.

#### 1.3.2 Pre-scan and Librarian Discovery Protocol

For all tasks, the Leaf begins with a Semantic Pre-scan using subagents to map task scope. For complex tasks identified through the Complexity Gate, the coordinator initiates a Librarian session before proceeding with implementation.

**Phase 1 — Semantic Pre-scan (every session):**

At session start, Leaf launches 2-3 targeted Explore subagents to create a mini-Discovery Map. Cost: 2-5% of context. This provides both coordinator and Leaf with data to assess task complexity.

**Phase 2 — Complexity Gate (joint decision):**

| Pre-scan Result | Decision | Rationale |
|----------------|----------|-----------|
| 2-3 files, single module | Proceed in main context | Discovery Tax will be manageable |
| 4-6 files, two modules | Proceed with caution | Borderline — monitor discovery cost |
| 5+ files, 3+ modules, cross-layer | Launch Librarian session | Discovery Tax will predictably consume 70%+ |
| Unclear picture even after scan | Launch Librarian session | Complexity of discovery itself is confirmed |

**Phase 3 — Librarian Session (when triggered):**

Coordinator launches a separate Librarian Leaf session. Task is to investigate codebase for directive scope. Output is Discovery Report. Then close Librarian session.

**Phase 4 — Main Session with Discovery Report:**

Main Leaf receives Directive + Discovery Report. Implementation begins with analytical map, not raw navigation.

**Discovery Report Format (produced by Librarian):**

```markdown
# Discovery Report: [Task Name]

## Relevant Files
- [path]: [role in the task — 1 line]
- [path]: [role in the task — 1 line]

## Data Flow
[component A] → [component B] → [component C]
Key transformation points: [list]

## Probable Fault Locations (if debugging)
1. [file:area]: [why suspect — 1 line]
2. [file:area]: [why suspect — 1 line]

## Dependencies and Side Effects
- [what else might be affected]

## Recommended Reading Order
1. [file] — start here
2. [file] — then this
```

**Length Guideline:** 15-30 lines. Discovery Report is GPS coordinates for the main session, not a codebase tour.

**Why Pre-scan solves the Librarian deadlock:** In v8.4, neither coordinator nor Leaf had sufficient data to decide when Librarian was needed. The coordinator lacked technical context; the Leaf discovered the need only after spending 70%+ on discovery. Pre-scan provides this data at 2-5% cost, making the Librarian decision informed rather than intuitive.

### 1.4 Specialized Leaf Roles

Leaf sessions can serve different purposes depending on the task. Role specialization enables context-efficient workflows by separating investigation from implementation.

**Available Roles:**

| Role | Purpose | Output | Context Usage |
|------|---------|--------|---------------|
| **Implementer** (default) | Execute directive, write code, run tests | Commits + Semantic Handoff | Full session |
| **Librarian** | Investigate codebase, produce analytical map | Discovery Report | Disposable — close after report |

**Librarian Role Details:**

The Librarian is a short-lived Leaf session focused exclusively on codebase investigation. It reads files, traces data flows, and produces a compressed Discovery Report for the main Implementer session.

Key properties:
- Does not write code or make commits
- Context is disposable — session closes after report delivery
- Coordinator transfers only the report to the main session
- Reduces main session's Discovery Tax significantly

**When Coordinator Should Launch Librarian:**
- When Complexity Gate (Section 1.3.2) indicates complex scope after Pre-scan
- If active Implementer session has consumed significant context on file reading without starting implementation, consider stopping, extracting findings, and relaunching with Librarian support

**Implementer Role Details:**

The standard Leaf session. Receives directive (and optionally Discovery Report), executes phases 0-4, produces commits and Semantic Handoff.

When Discovery Report is provided, the Implementer should read it before Phase 1 and use it as navigation map rather than independently exploring the codebase.

---

## Part II: Operational Workflows

### 2.1 The Directive Structure

Since the Leaf can read the codebase directly, directives focus on Intent and Constraints rather than exhaustive specifications. Trust Leaf competence for implementation details.

**Standard Directive Format:**

```
DIRECTIVE: [Feature/Task Name]

Objective: One-sentence summary of the goal.

Paradigm: [Flutter Mobile / Node.js Backend / etc.] — No Web Paradigms for mobile.

Execution Mode: [Standard / Multi-Session Roadmap (N Segments)]
Current Segment: [A / B / C] (if multi-session)

Scope:
- Feature or screen to implement
- Files likely to be touched
- Integration points with existing code

Constraints:
- What must not break
- Performance or security requirements
- Patterns that must be followed

Reference:
- Links to similar patterns in codebase (e.g., "Follow auth_service.dart structure")
- Relevant documentation paths

Success Criteria:
- How to verify completion
- Tests that must pass
```

**Context-Aware Sizing Guidelines:**

Standard features (CRUD operations, established patterns): 1-2 pages. Complex features (new patterns, significant integration): 2-3 pages. Architectural initiatives (system-wide changes): 3-4 pages maximum.

Brevity is intentional — Leaf discovers details autonomously.

### 2.2 The Autonomous Execution Cycle

The Leaf session follows a structured phase sequence:

**Phase 0: Pre-scan and Validation**

Leaf launches Explore subagents for navigational map. Validates directive assumptions against reality. Presents complexity assessment to coordinator. If Complexity Gate indicates high complexity, coordinator launches Librarian session before proceeding.

Rule: Do not commit main context to deep file reading until Pre-scan map is available.

**Phase 1: Discovery (Read-Only)**

Using Pre-scan map (or Discovery Report if provided), agent reads relevant files to build understanding. Focus main context on *understanding*, not *finding*.

Phase 0 + Phase 1 can overlap — validate assumptions while simultaneously reading relevant files.

Rule: Do not write code until you have understood the landscape.

**Phase 2: Planning and Approval**

Agent proposes an implementation plan in plain language. Plan includes: files to create/modify, approach, potential risks. Coordinator Checkpoint: Validates that the plan makes logical sense before granting execution permission.

**Phase 3: Implementation and Local Verification**

Agent creates and edits files according to approved plan. Mandatory Step: Agent must attempt to run the code or tests (flutter test, npm test, etc.) to verify syntax and logic. Self-Correction: If tests fail, agent iterates autonomously using accumulated troubleshooting knowledge. Continues until tests pass or blocking issue is identified.

**Phase 4: Delivery and Handoff**

Agent runs git commit with message referencing directive origin. If session ending, agent generates Semantic Handoff (Section 5.2) transferring understanding to next session.

Checkpoint: All artifacts saved before session concludes.

### 2.3 Mobile Paradigm and Semantic Gap Mitigation

Every Flutter directive must explicitly declare mobile paradigm and exclude web patterns. AI models exhibit bias toward web development; active countermeasures are required.

**Required Paradigm Declaration:**
- State clearly: "This is Flutter mobile development using Dart and Flutter widgets"
- Explicitly exclude: "Do not use HTML, CSS, or web paradigms"

**Three-Level Anti-Pattern System:**

The semantic gap operates at three distinct levels. Level 1 (syntax) produces visible errors. Level 2 (architecture) produces code that compiles but follows wrong paradigms. Level 3 (state management) produces project-specific anti-patterns.

**Level 1: Syntax Mapping**

| Wrong (Web) | Correct (Flutter) |
|-------------|-------------------|
| className | Widget parameters |
| div, span | Column, Row, Stack, Container |
| CSS styling, style={{}} | ThemeData, BoxDecoration, widget properties |
| href, Link | Navigator.push/pop, named routes |
| onClick | onTap, onPressed, GestureDetector |
| DOM manipulation | Widget trees and state management |
| margin/padding as strings | EdgeInsets |

**Level 2: Architectural Patterns**

| Wrong (Web Thinking) | Correct (Flutter Thinking) | Risk |
|----------------------|---------------------------|------|
| setState everywhere, prop drilling | Provider/ChangeNotifier | Uncontrolled rebuilds |
| componentDidMount / useEffect | initState + dispose | Resource leaks |
| Promise.then in render | FutureBuilder, StreamBuilder | Unresponsive UI |
| map() → div for lists | ListView.builder (lazy) | Performance collapse |
| React Router, URL-based | Navigator 2.0, GoRouter | Broken navigation |
| controlled input + onChange | TextEditingController + dispose | Memory leaks |
| flexbox, grid, media queries | LayoutBuilder, MediaQuery, Expanded | Overflow errors |
| CSS variables | ThemeData, Theme.of(context) | Inconsistent theming |

**Level 3: State Management (Project-Specific)**

| Anti-Pattern | Correct Pattern |
|-------------|-----------------|
| Business logic in Widget build() | Logic in Provider/Service, Widget only renders |
| Direct API calls from screens | Screen → Provider → Service → API |
| Local state for shared data | ChangeNotifierProvider at appropriate scope |
| Forgetting notifyListeners() | Always call after state mutation |
| Not disposing controllers | Always dispose in State.dispose() |

**Directive Integration:** When creating directives that involve UI work, reference the appropriate level of anti-pattern awareness. For new screens: emphasize all three levels. For bug fixes in existing screens: Level 3 is most relevant.

**Pattern Anchoring:** Include reference to existing Flutter implementations in codebase. Level 3 patterns reference project-specific files (providers/, services/, main.dart).

### 2.4 Proactive Scope Extension

When the Leaf identifies high-value opportunities beyond strict directive scope:

1. If value is clear and effort is small, proceed
2. Document the extension and rationale in session report
3. Coordinator validates the extension post-hoc

This protocol encourages initiative while maintaining accountability.

### 2.5 Session Planning and Calibration

Before each Leaf session, estimate expected duration based on directive complexity. After completion, record actual duration in session_report.md. Accumulate data to improve future estimation accuracy.

**Duration Categories:** Quick Fix (under 30 minutes) for single bug fix or minor adjustment. Standard Feature (1-2 hours) for new screen or service implementation. Complex Integration (3+ hours) for multi-file refactoring or new system.

### 2.6 Figma MCP Integration Protocols

Figma MCP enables direct design-to-code workflows within Leaf sessions. These protocols establish optimal patterns for context-efficient design analysis and Flutter code generation.

#### 2.6.1 Design Analysis Workflow

**Prerequisite Setup:**
1. Figma Desktop app installed and running
2. Design file open with target screens
3. Claude Code session initiated with Figma MCP enabled

**Standard Analysis Process:**

**Phase 1: Frame Selection** — User selects target frame/node in Figma Desktop (single selection for screenshots, multi-selection supported for metadata). Frame highlighted with blue border confirms active selection.

**Phase 2: Agent Invocation** — For Flutter projects, ALWAYS specify target framework:

```typescript
// Screenshot capture (single selection only)
mcp__figma__get_screenshot({
  fileKey: "[extracted-from-url]",
  nodeId: "[frame-id]",
  clientLanguages: "dart",
  clientFrameworks: "flutter"
})

// Design context retrieval (supports multi-selection)
mcp__figma__get_design_context({
  fileKey: "[extracted-from-url]",
  nodeId: "[frame-id]",
  clientLanguages: "dart",
  clientFrameworks: "flutter"
})
```

**Critical:** Without clientLanguages and clientFrameworks parameters, Figma MCP returns React + Tailwind code requiring transformation. With parameters, it returns metadata enabling zero-semantic-gap Flutter generation.

**Phase 3: Response Handling**

Two response types possible:

*Full Code Response:* Complete React + Tailwind code returned. Requires transformation to Flutter. Higher semantic gap risk.

*Sparse Metadata Response:* XML structure with element IDs, types, positions, dimensions. Agent generates Flutter from blueprint. Minimal semantic gap risk. Triggered automatically for large designs (>~2000px height observed).

System message indicates metadata mode:
```
IMPORTANT: The design was too large to fit into context with
get_design_context. Instead you have received a sparse metadata
response, you MUST call get_design_context on the IDs of the
sublayers to get the full code.
```

**Phase 4: Selective Deep-Dive (if needed)** — For large screens returned as metadata, request full code for specific sections using sublayer nodeId.

#### 2.6.2 Context Budget Guidelines

| Operation | Context Cost | Notes |
|-----------|--------------|-------|
| Simple screen metadata | ~3-4% | Standard analysis |
| Complex screen metadata | ~3-4% | Auto-optimized via sparse response |
| Multi-screen batch (7 frames) | ~5% | ~0.7% per screen average |
| Full Flutter code generation | ~6-7% | Metadata + code generation |
| Design system extraction | ~10-20% | Depends on scope |

**Session Capacity Planning:**

| Session Type | Screens Analyzed | Code Generated | Expected Context |
|--------------|------------------|----------------|------------------|
| Design Survey | 10-15 | 0 | 30-60% (Green) |
| Selective Implementation | 5-8 | 3-5 | 40-60% (Green) |
| Deep Dive Single Screen | 1-2 | 1-2 (with animations) | 15-25% (Green) |

**Optimization Tactics:**
1. Metadata-first approach: Analyze all screens as metadata, generate code only for approved designs
2. Sublayer targeting: For complex screens, request full code for specific sections by ID
3. Batch similar screens: Redundancy optimization reduces per-screen cost in flows
4. Defer exploration: If context tight, prioritize implementation over survey

#### 2.6.3 Workflow Protocols

**Protocol A: Iterative Design Review** — Use for reviewing Figma designs during development, providing feedback to designer. Context Budget: ~20-30% (5-8 screens analyzed).

**Protocol B: Implementation Preparation** — Use when design is finalized, preparing to implement in Flutter. Context Budget: ~15-25% (1-2 screens with full code).

**Protocol C: Design System Extraction** — Use for extracting reusable components, colors, typography from Figma. Context Budget: ~10-20%.

#### 2.6.4 Multi-Screen User Flow Analysis

When analyzing complete interaction flows (onboarding, checkout, registration):

1. User selects all frames in flow (multi-select in Figma)
2. Agent calls get_design_context (screenshot will fail for multi-selection, metadata succeeds)
3. Agent receives sparse metadata for all frames
4. Agent traces logical sequence, identifies state progression, validation rules, error states, interactive elements, transition triggers

Context Cost: ~0.7% per screen (highly efficient for batch analysis).

---

## Part III: Safety and Risk Protocols

As a non-coder coordinator, you rely on these protocols to prevent damage to the codebase while enabling autonomous agent work.

### 3.1 The Dry Run Protocol

Before any destructive action (delete, overwrite, move, major refactor), the agent must explain the impact in non-technical language.

Coordinator Prompt: "Explain what will be lost or changed if we execute this action."

The agent must respond with files affected and how, data that could be lost, and rollback strategy if something goes wrong. Only after coordinator understanding and approval should the action proceed.

### 3.2 Backup and Recovery

**Pre-Flight Check:** Before starting a complex Leaf session, ensure the current branch is clean (git status shows no uncommitted changes).

**Safety Branch Strategy:** For architectural changes or risky refactoring, force the agent to create a temporary branch: `git checkout -b refactor/[feature-name]-safe-mode`

**Recovery Path:** If something breaks catastrophically: `git stash` (save current work), then `git checkout main` (return to stable state).

### 3.3 Context Management

**Observed Reality:** Discovery (reading files, understanding architecture, tracing data flows) consumes 50-80% of session context consistently. This is a systemic characteristic independent of task complexity. Optimizing context usage within a session yields marginal gains; optimizing handoff quality between sessions is the high-leverage intervention (see Section 5.2).

**Coordinator's Role:** The coordinator monitors context and signals handoff when the session approaches its limit and implementation is incomplete. This is a single binary decision point, not a graduated scale.

**Practical Pattern from Operational Experience:**

| Phase | Context Used | What Happens |
|-------|-------------|--------------|
| Pre-scan + Discovery | 50-80% | Leaf reads files, builds understanding of problem |
| Implementation + Testing | 10-40% | Leaf proposes fix, runs tests |
| Handoff or Commit | 5% | Semantic Handoff or commit with report |

**Coordinator Decision Matrix:**

| Observation | Action |
|-------------|--------|
| Leaf is actively building understanding | Do not interrupt — discovery cannot be accelerated by signals |
| Leaf proposes solution, tests pass | Allow commit and report |
| Leaf proposes solution, tests fail, context approaching limit | Signal handoff |
| Context at limit, no solution yet | Signal handoff immediately |

**Intuition Trigger Principle:** When the coordinator feels the need for handoff, this is a signal for immediate action, not for "one more message before that." The thought "time to do handoff" means it's already time.

#### 3.3.1 Figma MCP Context Budgets

| Session Phase | Screens Analyzed | Code Generated | Action |
|--------------|------------------|----------------|--------|
| Early session | 10-15 | 6-8 | Normal operation |
| Context approaching limit | Complete current | 1-2 max | Prepare handoff |
| Context at limit | Commit metadata | 0 | Handoff |

**Emergency Protocol for Mid-Session Overflow:** If context approaching limit with Figma work incomplete: commit analyzed metadata to documentation, generate Semantic Handoff with sublayer IDs for next session, prioritize critical screens for code generation, defer exploratory analysis to future session.

#### 3.3.2 Discovery Tax Management

**The Pattern:** Across multiple Leaf sessions, 50-80% of context is consistently consumed by codebase investigation before implementation begins. This repeating pattern is independent of task complexity and represents a systemic characteristic of the current workflow.

**Two Components:**

| Component | Description | Mitigation |
|-----------|-------------|------------|
| **Navigational Tax** | Finding relevant files, mapping structure | Subagent Pre-scan reduces; Librarian session offloads entirely |
| **Semantic Tax** | Reading, understanding, correlating code logic | Cannot be delegated — requires main context |

**The Fresh Session Effect:**

When a session reaches its limit with an unresolved problem and produces a handoff, the next session typically resolves the problem using less context — but only when the handoff quality is sufficient.

**Critical Observation (v8.5):** Operational data shows that GPS-style handoffs (files modified, next action, known issues) do NOT significantly reduce Discovery Tax in subsequent sessions. Sessions 2 and 3 on the same problem can spend 70-80% on re-discovery when the handoff stripped out reasoning and eliminated hypotheses. The Semantic Handoff format (Section 5.2) addresses this by transferring understanding, not just coordinates.

**Mitigation Strategy — Two-Level:**

Level 1 — Pre-scan (every session): Subagent-based navigational map at 2-5% context cost. Reduces navigational component of Discovery Tax.

Level 2 — Librarian (when Complexity Gate triggers): Separate session pays full Discovery Tax in disposable context. Main session receives compressed Discovery Report.

**Coordinator Monitoring:**

The coordinator should note when discovery is consuming context without producing implementation progress. If the Leaf has been reading files extensively without proposing a solution, this is expected behavior up to a point — but if the coordinator senses the session is approaching its limit, signal handoff.

### 3.4 The Blocking Issue Protocol

When the agent encounters an issue it cannot resolve autonomously:

1. Document the issue with full technical context
2. List attempted solutions and their results
3. Propose hypotheses for root cause
4. Request coordinator decision: escalate to Trunk, seek external help, or defer

Do not spin endlessly on unsolvable problems — recognize when human judgment is needed.

### 3.5 Information Recursion Prevention

Information Recursion: Agent decisions based on degraded context create cascading problems that cannot reach stable state. Recognize by signs below; recover via protocol.

**Recognition Signs:**

| Signal | Severity | Action |
|--------|----------|--------|
| Repeated solution proposals | Warning | Review session history |
| Fixes creating new bugs | Critical | Prepare for session termination |
| Contradictory code patterns | Critical | Stop and reassess |
| Second Compact activation | Terminal | End session, reassemble in Trunk |

**Prevention Strategies:**

Scope Discipline: Limit task scope to what fits comfortably in fresh context. For complex phases (3+ hours estimated), use Multi-Session Segmentation rather than attempting completion in single session.

Semantic Handoff: Transfer work to fresh session before degradation occurs using Semantic Handoff format (Section 5.2). The handoff must transfer understanding, not just coordinates — this is the key to preventing re-discovery in subsequent sessions.

Context Hygiene: Prevent "garbage" accumulation in context through filtered log access and coordinator terminal ownership of heavy processes.

**Degradation Recognition Rule:** If a bug is not resolved before second Compact activation, the session is considered degraded. Coordinator must terminate current session, reassemble task in Trunk with fresh analysis, and launch new "clean" Leaf session with refined directive.

**Recovery Protocol:**
1. Commit current state with WIP label
2. Generate Semantic Handoff with emphasis on Eliminated Hypotheses section
3. Note which solutions were attempted and why they failed
4. Trunk creates new directive with explicit "avoid these approaches" guidance
5. Fresh Leaf session starts with clean context and Semantic Handoff

### 3.6 Active Context Hygiene

Unfiltered logs consume context rapidly. Use Passive Observation Pattern: coordinator owns heavy processes, agent receives filtered access.

**Observed Initiative Pattern:** In practice, the coordinator proactively provides relevant log fragments after observing failed tests, rather than waiting for the Leaf to request them. This is the natural distribution — coordinator has real-time log visibility, Leaf does not.

**Toxic Log Categories:** Full authentication tokens (JWT, refresh tokens), complete API response bodies with nested data, duplicate error messages from retry loops, verbose framework debug output, unfiltered emulator/simulator logs.

**Filtered Log Access Commands:**

For Flutter development:
```bash
flutter run 2>&1 | grep -Ei "error|exception|fail|warning|conflict"
```

For backend debugging:
```bash
tail -f backend.log | grep -Ei "error|exception|fail|status:[45]"
```

For specific error investigation:
```bash
grep -A 5 "ErrorClassName" logfile.log
```

**When Agent Needs Full Logs:** If filtered output insufficient for debugging, agent requests specific log segment from coordinator. Coordinator extracts relevant portion (e.g., last 50 lines around error), pastes extracted segment to agent. This manual handoff prevents automatic context pollution while maintaining debugging capability.

---

## Part IV: Technical Standards and Quality

### 4.1 Pragmatism Over Purity

Principle: A working feature with "good enough" code is better than a broken feature with "perfect" architecture.

When a refactor hits unexpected complexity: revert to the simplest working solution, document the technical debt in the session report, note the ideal architecture for future consideration, do not stall progress for theoretical elegance.

Creative use of existing infrastructure often beats elegant solutions requiring migrations or extensive refactoring.

### 4.2 Code Quality Expectations

All code must be production-ready:

**Error Handling:** Proper try-catch with appropriate recovery strategies. User-facing error messages that are helpful without exposing internals.

**Security:** Input validation at controller level. Authentication checks on protected routes. Sanitization of user-provided content.

**Performance:** Database queries with appropriate indexing. Avoiding N+1 query patterns. Lazy loading for expensive operations.

**Maintainability:** Clear naming that reveals intent. Logical file organization following established patterns. Comments for complex logic, not obvious operations.

**Consistency:** Follow patterns established elsewhere in codebase. Use existing utilities rather than reimplementing. Match code style of surrounding files.

### 4.3 Documentation Hygiene

Cleanup Responsibility: Leaf sessions must remove temporary analysis files, debug logs, and scratch work before closing.

Dual Sync Requirement: Any update to methodology documentation must be committed to the Git repository AND updated in Claude Project Knowledge. This ensures both Trunk sessions (browser) and Leaf sessions (IDE) operate from synchronized methodology understanding.

Documentation Standard: Write for practitioners familiar with the technology stack. Focus on unique aspects of this implementation. Trust reader competence for standard patterns.

---

## Part V: Knowledge Management

### 5.1 The Bank of Failures

When a complex bug is solved or a non-obvious solution is discovered, the Leaf agent must update the troubleshooting knowledge base.

**Location:** docs/troubleshooting_bank.md

**Entry Format:**
```
## [Descriptive Title]

**Symptom:** What the error looked like or how the bug manifested.

**Root Cause:** Why the error actually occurred.

**Solution:** Specific steps that resolved the issue.

**Prevention:** How to avoid this in future code.
```

**Usage Protocol:** Before requesting human help for debugging, future Leaf sessions must query this file for similar symptoms.

**Pattern Categories:** Alpha (Authentication and sessions), Bravo (Database and queries), Charlie (API integration), Delta (State management), Echo (Build and dependencies), Foxtrot (Test infrastructure), Golf (Figma MCP integration), Hotel (Information Recursion incidents).

### 5.2 The Semantic Handoff

When a session ends, the agent produces a Semantic Handoff — a document that transfers understanding to the next session. The handoff functions as a semantic map that enables the next session to continue without re-discovering what was already known.

**Core Principle:** Every session that re-discovers what the previous session already knew represents a system failure in memory transfer. The handoff must transfer understanding, not just coordinates.

**Critical Design Decision (v8.5):** The v8.4 anti-pattern "never write problem narratives or decision rationale" is reversed. Operational data shows that stripping reasoning from handoffs forces subsequent sessions to re-pay Discovery Tax in full (70-80% of context on re-discovery). Decision rationale IS the semantic map.

**Semantic Handoff Format:**

```markdown
# Handoff: [Task Name]

## Problem Model
[How I understand WHY the problem exists — the causal chain,
not just the symptom. This is the most valuable section.]

## Verified Facts
- [Fact 1]: confirmed by [evidence — file:line or test result]
- [Fact 2]: confirmed by [evidence]

## Eliminated Hypotheses
- [Hypothesis 1]: eliminated because [concrete evidence]
- [Hypothesis 2]: eliminated because [concrete evidence]

## Dependency Graph (task-specific)
[File A] → calls → [File B] → depends on → [File C]
Key transformation point: [where data changes shape or format]

## Semantic Anchors
- [Variable/function/class]: [why it matters for this task]
- [Pattern or convention]: [how it's used in this context]

## Current State
Files created/modified: [list with paths]
What works: [specific functionality confirmed]
What doesn't: [specific failure with observed behavior]

## Continuation Point
Open: [specific file]
First action: [specific action]
Expected outcome: [what should happen if the action is correct]

## Scope Corrections (if any)
- [What was changed from original directive and why]
```

**Handoff Quality Rules:**

- **Problem Model** is mandatory. A handoff without a problem model is incomplete.
- **Eliminated Hypotheses** prevent the next session from re-testing failed approaches.
- **Semantic Anchors** give the next session immediate vocabulary for the problem domain.
- **Verified Facts** distinguish confirmed knowledge from assumptions.
- Manual Semantic Handoff is always preferred over auto-compact for session transitions.

**Length Guideline:** 25-50 lines. Longer than GPS-style handoffs, but the investment pays for itself in reduced Discovery Tax for the next session.

### Format Selection by Scenario

| Scenario | Format | Rationale |
|----------|--------|-----------|
| Task incomplete, continues in next session | Semantic Handoff (full) | Transfer understanding to prevent re-discovery |
| Task completed successfully | Completion Report (brief) | Document result, not transfer process |

**Completion Report (for finished tasks):**

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

Semantic Handoff is a tool for transferring **unfinished understanding**. It should not be used for successfully completed tasks — Completion Report is sufficient.

#### 5.2.1 Checkpoint Continuation Protocol

For complex phases requiring multiple Leaf sessions (estimated 3+ hours), use the Checkpoint Continuation Protocol.

**Session Execution Header** (added to directive for multi-session work):

```markdown
---
## Execution Mode: Multi-Session Roadmap

**Total Segments:** [N]
**Current Segment:** [A / B / C / ...]
**Assigned Phases:** [List specific phases for this segment]

### Segment Execution Rules

1. **Scope Discipline:** Execute ONLY phases assigned to current segment.
2. **Continuation Awareness:** If segment B or later, read previous Semantic Handoff FIRST.
3. **Naming Consistency:** Use EXACTLY the names specified in directive and previous reports.
---
```

**Checkpoint Report Structure (mid-session):**

```markdown
# Checkpoint: [Task Name]

## Completed
- [File]: [What was done]

## Problem Model (current understanding)
[Brief causal chain]

## Next Steps
1. [Immediate next action]
2. [Following action]

## Critical Context
- [Key decision or constraint for continuation]
```

**Multi-Session Segmentation Guide:**

| Estimated Duration | Segments | Phases per Segment |
|--------------------|----------|-------------------|
| 3-4 hours | 2 | 3-4 phases each |
| 5-6 hours | 3 | 2-3 phases each |
| 7+ hours | 4+ | 2 phases each |

### 5.3 External Memory Continuity

The distributed intelligence system relies on external memory to maintain coherence across sessions.

**GitHub as Primary Truth Source:** All code lives in the repository. Commit messages reference originating sessions. Version history enables tracking architectural decisions. Branch strategy enables safe experimentation.

**Claude Projects as Knowledge Layer:** Syncs with GitHub repository automatically. Provides Project Knowledge search across sessions. Maintains methodology and specification access. Enables Trunk to analyze Leaf outputs.

**The Continuity Cycle:**
1. Trunk creates directive based on current project state
2. Coordinator transfers directive to Leaf environment
3. Leaf executes, commits to GitHub, generates Semantic Handoff
4. GitHub syncs to Project Knowledge
5. Trunk queries Project Knowledge for session outputs
6. Trunk formulates next directive building on completed work
7. Cycle continues with accumulated context

---

## Part VI: Evolution and Adaptation

### 6.1 Operational Principles

**Intuition Trigger Principle:** When the coordinator feels the need for checkpoint or handoff, this is a signal for immediate action, not for "one more message before that." The thought "time to do handoff" means it's already time — do not delay even one exchange.

**Practice Over Theory:** Changes to methodology must address real problems encountered in actual development. Test proposed changes on real features before permanent adoption. Theoretical protocols that are not used in practice should be simplified or removed.

**Simplicity Over Complexity:** Resist adding layers for edge cases. If a principle cannot be explained simply, reconsider its formulation.

**Reflective Analysis in Operational Environment:** Methodology evolves primarily in the Trunk environment (browser), but applies primarily in the Leaf environment (CLI). Periodic reflective sessions in the Leaf environment ensure that protocol changes reflect operational reality, not just theoretical ideals.

### 6.2 Continuous Improvement Process

After each significant feature implementation:
1. Document lessons learned in session report
2. Identify patterns in recurring issues
3. Propose methodology amendments based on evidence
4. Test amendments on next feature
5. Adopt successful amendments permanently

The methodology is a living document that improves through operational feedback.

### 6.3 Scaling Considerations

As the project grows, the methodology scales accordingly: add specialized Trunk roles if domain complexity increases, create domain-specific directive templates (mobile, backend, infrastructure), establish feature-specific troubleshooting patterns, build reusable component libraries with integration guides, maintain architectural consistency through explicit principle documentation.

---

## Appendix: Quick Reference

### Context Management Quick Reference

| Observation | Coordinator Action |
|-------------|-------------------|
| Leaf building understanding (reading files) | Do not interrupt |
| Leaf proposes solution, tests pass | Allow commit |
| Leaf proposes solution, tests fail, context approaching limit | Signal handoff |
| Context at limit, no solution | Signal handoff immediately |

### Information Recursion Indicators

| Signal | Severity | Action |
|--------|----------|--------|
| Repeated solution proposals | Warning | Review session history |
| Fixes creating new bugs | Critical | Prepare for session termination |
| Contradictory code patterns | Critical | Stop and reassess |
| Second Compact activation | Terminal | End session, reassemble in Trunk |

### Multi-Session Segmentation Guide

| Estimated Duration | Segments | Phases per Segment |
|--------------------|----------|-------------------|
| 3-4 hours | 2 | 3-4 phases each |
| 5-6 hours | 3 | 2-3 phases each |
| 7+ hours | 4+ | 2 phases each |

### Pre-scan Complexity Gate

| Pre-scan Result | Decision |
|----------------|----------|
| 2-3 files, single module | Proceed in main context |
| 4-6 files, two modules | Proceed with caution |
| 5+ files, 3+ modules, cross-layer | Launch Librarian |
| Unclear after scan | Launch Librarian |

### Observed Initiative Distribution

| Action | Actual Initiator |
|--------|-----------------|
| Provide logs after failed test | Coordinator (proactive) |
| Request infrastructure status | Leaf |
| Signal scope mismatch | Leaf |
| Signal handoff needed | Coordinator |
| Subagent discovery | Leaf (autonomous) |
| Complexity assessment | Joint |

### File Locations (Trunk Environment)

| Purpose | Path |
|---------|------|
| Working directory | /home/claude |
| User uploads | /mnt/user-data/uploads |
| Output artifacts | /mnt/user-data/outputs |
| Project knowledge | /mnt/project/ |

### Paradigm Quick Check — Three Levels (Flutter)

| Level | What It Catches | Check Method |
|-------|----------------|--------------|
| Level 1: Syntax | div, className, CSS | Text search in code |
| Level 2: Architecture | setState abuse, missing dispose | Code review |
| Level 3: State Management | Logic in build(), direct API calls | Architectural review |

### Semantic Handoff Quick Structure

| Section | Purpose | Priority |
|---------|---------|----------|
| Problem Model | WHY the problem exists | Mandatory |
| Verified Facts | What is confirmed | Mandatory |
| Eliminated Hypotheses | What was ruled out | Mandatory |
| Dependency Graph | How files relate | Recommended |
| Semantic Anchors | Key vocabulary | Recommended |
| Current State | What works/doesn't | Mandatory |
| Continuation Point | Next action | Mandatory |

### Figma MCP Quick Reference

**Mandatory Parameters for Flutter:**
```typescript
{
  clientLanguages: "dart",
  clientFrameworks: "flutter"
}
```

**Context Costs:**

| Operation | Cost |
|-----------|------|
| Single screen analysis | ~3-4% |
| Multi-screen batch | ~0.7% per screen |
| Full code generation | ~6-7% per screen |

### Leaf Roles Quick Reference

| Role | Purpose | Output |
|------|---------|--------|
| Implementer (default) | Execute directive | Commits + Semantic Handoff |
| Librarian | Investigate codebase | Discovery Report |

---

## Changelog

### v8.5 (February 2026)

**Practice-driven revision** synchronized with Compact Protocol v1.4. Based on reflective analysis of 10+ operational sessions, identifying gaps between theoretical protocols and observed patterns.

**Key Insight:** The high-leverage optimization point is handoff quality between sessions, not context management within sessions. Discovery Tax (50-80% of context) is a systemic constant; reducing re-discovery through better handoffs is the path to efficiency.

**Major Changes:**

- **Section 1.3:** Added "Proactive Information Provider" to coordinator responsibilities, reflecting observed pattern where coordinator provides logs without being asked
- **Section 1.3.2:** Replaced "Experimental Pre-flight Discovery" with "Pre-scan and Librarian Discovery Protocol". Pre-scan (subagent-based) is now mandatory for every session; Librarian is triggered through Complexity Gate based on Pre-scan results. This solves the Librarian deadlock where neither party had data to decide
- **Section 2.2:** Phase 0 now explicitly includes Pre-scan and Complexity Gate
- **Section 3.3:** Replaced graduated 5-zone context threshold system with binary coordinator decision model. Operational data showed intermediate signals (50%, 70%) were not actionable — coordinator intervenes only when context approaches limit and solution is incomplete
- **Section 3.3.2:** Added critical observation that GPS-style handoffs do NOT reduce Discovery Tax in subsequent sessions. Documented the pattern where sessions 2-3 re-spend 70-80% on discovery despite handoff
- **Section 3.5:** Recovery Protocol updated to emphasize Semantic Handoff with Eliminated Hypotheses
- **Section 3.6:** Documented observed initiative pattern for log provision
- **Section 5.2:** Replaced GPS-style Handoff Report with Semantic Handoff format. Reversed anti-pattern "never write decision rationale". New format includes Problem Model, Verified Facts, Eliminated Hypotheses, Dependency Graph, and Semantic Anchors
- **Section 6.1:** Added "Reflective Analysis in Operational Environment" principle
- **Appendix:** Replaced context threshold tables with Context Management Quick Reference, Pre-scan Complexity Gate, Observed Initiative Distribution, and Semantic Handoff Quick Structure. Removed "Handoff Anti-Patterns to Avoid" (reversed in v8.5)

### v8.4 (January 2026)

**New Sections:**
- Section 1.3.2: Pre-flight Discovery Protocol (Experimental) — separates codebase investigation from implementation via Librarian sessions
- Section 1.4: Specialized Leaf Roles — formalizes Implementer and Librarian roles
- Section 3.3.2: Discovery Tax Management — documents the pattern of context consumption during codebase investigation

**Updated Sections:**
- Section 2.3: Three-Level Anti-Pattern System — expanded from single syntax table to three levels (Syntax, Architecture, State Management)
- Section 3.3: Context Thresholds — corrected for Claude Code visibility (blind zone below 50%, 50% as diagnostic moment)
- Section 1.3.1: Launch Package Assembly — now includes Discovery Report when Pre-flight Discovery is used
- Appendix: Added quick references for Leaf Roles, Pre-flight Discovery criteria, 50% diagnostic decisions

**Origin:** Reflective analysis conducted in Claude Code environment (Leaf perspective), producing insights about Discovery Tax patterns and the Fresh Session Effect.

### v8.3 (January 2026)

Initial version with two-tier agentic architecture, Figma MCP integration protocols, and comprehensive safety systems.

---

*This methodology serves as the authoritative operational reference for all Trunk and Leaf sessions in the Restaurant Guide project. It establishes the two-tier agentic architecture enabling efficient collaboration between strategic planning and autonomous execution.*

**Synchronization Requirement:** This document must exist in both Claude Project Instructions (for Trunk session runtime access) and the Git repository docs/ directory (for Leaf session reference). Updates to either location must be synchronized immediately.
