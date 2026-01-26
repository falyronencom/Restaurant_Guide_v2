# Distributed Intelligence Methodology v8.3
## The Agentic Framework for Restaurant Guide

**Version:** 8.3  
**Date:** January 2026  
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
- Prepare Checkpoint Report from previous session if continuing work
- Clear any stale context from previous debugging sessions

Launch Package Assembly:
- Directive document (scoped appropriately)
- Previous Checkpoint Report (if continuation)
- Session Execution Header with mode and segment specification
- Log filter configuration commands

**Coordinator Terminal Ownership:** Heavy processes (backend server, Flutter emulator, database connections) run in coordinator's terminal, not in agent's context. Agent accesses results through filtered queries, preserving context for implementation work.

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
Context Anchor: Checkpoint Report Required at 80% Context or Segment End.

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

The Leaf session follows a strict four-phase loop ensuring safety and quality:

**Phase 1: Discovery (Read-Only)**

Agent explores current state using file system commands (ls, cat, grep, find). Maps the territory before proposing any modifications. Identifies existing patterns, dependencies, and potential conflicts.

Rule: Do not write code until you have understood the landscape.

**Phase 2: Planning and Approval**

Agent proposes an implementation plan in plain language. Plan includes: files to create/modify, approach, potential risks. Coordinator Checkpoint: Validates that the plan makes logical sense before granting execution permission.

**Phase 3: Implementation and Local Verification**

Agent creates and edits files according to approved plan. Mandatory Step: Agent must attempt to run the code or tests (flutter test, npm test, etc.) to verify syntax and logic. Self-Correction: If tests fail, agent iterates autonomously using accumulated troubleshooting knowledge. Continues until tests pass or blocking issue is identified.

**Phase 4: Delivery and Handoff**

Agent runs git commit with message referencing directive origin. Agent generates session_report.md documenting what was completed, issues encountered and resolved, what remains for next session, and specific context the next Trunk should know.

Checkpoint: All artifacts saved before session concludes.

### 2.3 Mobile Paradigm and Semantic Gap Mitigation

Every Flutter directive must explicitly declare mobile paradigm and exclude web patterns. AI models exhibit bias toward web development; active countermeasures are required.

**Required Paradigm Declaration:**
- State clearly: "This is Flutter mobile development using Dart and Flutter widgets"
- Explicitly exclude: "Do not use HTML, CSS, or web paradigms"

**Anti-Pattern Identification:**

| Wrong (Web) | Correct (Flutter) |
|-------------|-------------------|
| className | Widget parameters |
| div, span | Column, Row, Stack, Container |
| CSS styling, style={{}} | ThemeData, BoxDecoration, widget properties |
| href, Link | Navigator.push/pop, named routes |
| onClick | onTap, onPressed, GestureDetector |
| DOM manipulation | Widget trees and state management |
| margin/padding as strings | EdgeInsets |

**Pattern Anchoring:** Include reference to existing Flutter implementations in codebase. Provide concrete widget examples demonstrating correct approach. Reinforce paradigm at transition points within complex directives.

### 2.4 Proactive Scope Extension

When the Leaf identifies high-value opportunities beyond strict directive scope:

1. Assess remaining context budget
2. Estimate effort required for the opportunity
3. If budget permits and value is clear, proceed with extension
4. Document the extension and rationale in session report
5. Coordinator validates the extension post-hoc

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

### 3.3 Context Management (The Threshold System)

| Zone | Utilization | Action |
|------|-------------|--------|
| Green | Under 70% | Normal operation, full creative freedom within directive scope |
| Yellow | 70-85% | Warning state: complete current logical unit, no new features or scope expansion, prepare for potential handoff |
| **Checkpoint** | **80%** | **Mandatory Checkpoint Report creation — hard trigger** |
| Orange | 85-90% | Mandatory preservation: commit current state immediately, generate handoff report with maximum detail |
| Red | Over 90% | Emergency stop: cease all implementation, WIP commit, complete handoff report mandatory, session terminates |

#### 3.3.1 Figma MCP Context Budgets

| Context Zone | Screens Analyzed | Code Generated | Action |
|--------------|------------------|----------------|--------|
| Green (<70%) | 10-15 | 6-8 | Normal operation |
| Yellow (70-85%) | Complete current | 1-2 max | Prepare handoff |
| Orange (85-90%) | Commit metadata | 0 | Emergency stop |

**Emergency Protocol for Mid-Session Overflow:** If context exceeds 70% with Figma work incomplete: commit analyzed metadata to documentation, generate handoff report with sublayer IDs for next session, prioritize critical screens for code generation, defer exploratory analysis to future session.

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

Checkpoint Continuation: Transfer work to fresh session before degradation occurs. The 80% trigger ensures handoff happens while context quality remains high.

Context Hygiene: Prevent "garbage" accumulation in context through filtered log access and coordinator terminal ownership of heavy processes.

**Degradation Recognition Rule:** If a bug is not resolved before second Compact activation, the session is considered degraded. Coordinator must terminate current session, reassemble task in Trunk with fresh analysis, and launch new "clean" Leaf session with refined directive.

**Recovery Protocol:**
1. Commit current state with WIP label
2. Document exact symptoms of degradation in session report
3. Note which solutions were attempted
4. Trunk creates new directive with explicit "avoid these approaches" guidance
5. Fresh Leaf session starts with clean context

### 3.6 Active Context Hygiene

Unfiltered logs consume context rapidly. Use Passive Observation Pattern: coordinator owns heavy processes, agent receives filtered access.

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

### 5.2 The Handoff Report (Forward-Looking Structure)

When a session ends, the agent produces a continuation document for the next session. The handoff report functions as GPS coordinates for immediate forward progress, not a retrospective narrative.

**Core Principle:** Every sentence in a handoff report occupies space in the next session's limited context window. Provide only what enables immediate continuation.

**Required Sections:**

```
# Handoff: [Feature/Task Name]

## Current State
What exists and works right now: files in place (with paths), tests that pass, functionality operational.

## Continuation Point
Exact coordinates: specific file to open first, specific function to work on next, the single next action, expected outcome.

## Dependencies (if any)
Services that must be running, environment variables, blocking issues (with owner).

## Context Anchors
Key variable/class names, architectural patterns (reference only), constraints to maintain.
```

**What to Exclude:** Problem narratives, resolution stories, alternative approaches considered, emotional/evaluative language, decision rationale — only state what was decided.

**Length Guideline:** 15-25 lines typical. If exceeding 40 lines, trim retrospective content.

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
2. **Checkpoint Trigger:** Create Checkpoint Report at 80% context or segment completion.
3. **Continuation Awareness:** If segment B or later, read previous Checkpoint Report FIRST.
4. **Naming Consistency:** Use EXACTLY the names specified in directive and previous reports.
---
```

**Checkpoint Report Structure:**

| Section | Content | Max Lines |
|---------|---------|-----------|
| Codebase Snapshot | Files created/modified, classes introduced, routes added | 10-15 |
| Continuation Coordinates | Next segment, entry point, first action | 5-8 |
| Known Issues | Bugs, workarounds | 3-5 |
| Patterns/Anti-patterns | What works, what doesn't | 4-6 |
| Validation Status | Build, analyze results | 3-4 |

**Total Target:** 25-40 lines.

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
3. Leaf executes, commits to GitHub, generates report
4. GitHub syncs to Project Knowledge
5. Trunk queries Project Knowledge for session outputs
6. Trunk formulates next directive building on completed work
7. Cycle continues with accumulated context

---

## Part VI: Evolution and Adaptation

### 6.1 Operational Principles

**Intuition Trigger Principle:** When the coordinator feels the need for checkpoint or handoff, this is a signal for immediate action, not for "one more message before that." The thought "time to do handoff" means it's already time — do not delay even one exchange.

**Practice Over Theory:** Changes to methodology must address real problems encountered in actual development. Test proposed changes on real features before permanent adoption.

**Simplicity Over Complexity:** Resist adding layers for edge cases. If a principle cannot be explained simply, reconsider its formulation.

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

### Context Thresholds

| Zone | Utilization | Action |
|------|-------------|--------|
| Green | Under 70% | Normal operation |
| Yellow | 70-85% | Warning, complete current unit, no expansion |
| **Checkpoint** | **80%** | **Mandatory Checkpoint Report creation** |
| Orange | 85-90% | Mandatory commit and handoff preparation |
| Red | Over 90% | Emergency stop, WIP commit, terminate |

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

### File Locations (Trunk Environment)

| Purpose | Path |
|---------|------|
| Working directory | /home/claude |
| User uploads | /mnt/user-data/uploads |
| Output artifacts | /mnt/user-data/outputs |
| Project knowledge | /mnt/project/ |

### Paradigm Quick Check (Flutter)

| Wrong (Web) | Correct (Flutter) |
|-------------|-------------------|
| className | Widget parameters |
| div | Column, Row, Stack |
| CSS styling | ThemeData, widget properties |
| href/link | Navigator, named routes |
| DOM events | GestureDetector, callbacks |
| state in DOM | setState, Provider, Riverpod |

### Checkpoint Report Quick Structure

| Section | Content | Max Lines |
|---------|---------|-----------|
| Codebase Snapshot | Files, classes, routes | 10-15 |
| Continuation Coordinates | Entry point, first action | 5-8 |
| Known Issues | Bugs, workarounds | 3-5 |
| Patterns/Anti-patterns | What works, what doesn't | 4-6 |
| Validation Status | Build, analyze results | 3-4 |

**Total Target:** 25-40 lines

### Handoff Anti-Patterns to Avoid

- Problem narratives ("we struggled with...")
- Resolution stories ("after trying X, Y worked")
- Decision rationale ("we chose A because...")
- Evaluative language ("challenging", "finally")

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

---

*This methodology serves as the authoritative operational reference for all Trunk and Leaf sessions in the Restaurant Guide project. It establishes the two-tier agentic architecture enabling efficient collaboration between strategic planning and autonomous execution.*

**Synchronization Requirement:** This document must exist in both Claude Project Instructions (for Trunk session runtime access) and the Git repository docs/ directory (for Leaf session reference). Updates to either location must be synchronized immediately.