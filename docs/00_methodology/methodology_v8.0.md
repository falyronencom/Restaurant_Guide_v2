# Distributed Intelligence Methodology v8.0
## The Agentic Framework for Restaurant Guide

**Version:** 8.0
**Date:** November 2025
**Status:** Active Operational Standard
**Core Paradigm:** Human Coordination of Autonomous Agents

---

## Part I: The Agentic Architecture

### 1.1 Core Concept: Distributed Intelligence System

The methodology implements a two-tier Agentic Model where strategic planning and autonomous execution operate as distinct but connected layers. Human vision coordinates with AI capabilities through structured protocols, creating an efficient system where each component focuses on its strengths.

**The Trunk and Leaves Metaphor:** The system operates like a tree where the trunk (strategic layer) provides stability and architectural direction while leaves (execution layer) transform directives into working code. The trunk maintains coherence and long-term vision; leaves perform focused implementation directly in the development environment.

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

Key Capability: Leaf sessions iterate autonomously — running code, observing failures, correcting errors, and re-testing without human intervention for each cycle. This direct access to the development environment enables rapid feedback loops and self-correction.

### 1.3 The Human Coordinator Role

Role: The Bridge, Guardian, and Vision Keeper.

The human coordinator cannot be automated because this role requires judgment, context persistence across AI system boundaries, and accountability that current AI systems cannot provide.

**Core Responsibilities:**

Strategic Vision Keeper: Maintains long-term architectural coherence across sessions. Ensures individual session outputs align with overall project direction. Makes final decisions when agent proposals conflict with project principles.

Context Bridge: Transfers directives from Trunk (Web) to Leaf (CLI) and reports from Leaf back to Trunk. Manages the information flow between systems with different interfaces and capabilities.

Safety Gate: Approves or rejects file operations proposed by Leaf agents. Validates that proposed changes align with project intent before execution. Ensures backups exist before complex refactoring operations.

Resource Manager: Monitors context utilization across sessions. Plans session continuity and handoffs. Selects appropriate tools (Trunk vs Leaf, browser vs CLI) based on task requirements.

Scope Authority: Authorizes proactive scope extension when Leaf identifies high-value opportunities beyond strict directive boundaries.

---

## Part II: Operational Workflows

### 2.1 The Directive Structure

Since the Leaf can read the codebase directly, directives focus on Intent and Constraints rather than exhaustive specifications. Trust Leaf competence for implementation details.

**Standard Directive Format:**

```
DIRECTIVE: [Feature/Task Name]

Objective: One-sentence summary of the goal.

Paradigm: [Flutter Mobile / Node.js Backend / etc.] — No Web Paradigms for mobile.

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

Standard features (CRUD operations, established patterns): 1-2 pages
Complex features (new patterns, significant integration): 2-3 pages
Architectural initiatives (system-wide changes): 3-4 pages maximum

Brevity is intentional — Leaf sessions have direct codebase access and discover details autonomously. Over-specification wastes Trunk context and constrains Leaf creativity.

### 2.2 The Autonomous Execution Cycle

The Leaf session follows a strict four-phase loop ensuring safety and quality:

**Phase 1: Discovery (Read-Only)**

Agent explores current state using file system commands (ls, cat, grep, find).
Maps the territory before proposing any modifications.
Identifies existing patterns, dependencies, and potential conflicts.

Rule: Do not write code until you have understood the landscape.

**Phase 2: Planning and Approval**

Agent proposes an implementation plan in plain language.
Plan includes: files to create/modify, approach, potential risks.
Coordinator Checkpoint: Validates that the plan makes logical sense before granting execution permission.

**Phase 3: Implementation and Local Verification**

Agent creates and edits files according to approved plan.
Mandatory Step: Agent must attempt to run the code or tests (flutter test, npm test, etc.) to verify syntax and logic.
Self-Correction: If tests fail, agent iterates autonomously using accumulated troubleshooting knowledge.
Continues until tests pass or blocking issue is identified.

**Phase 4: Delivery and Handoff**

Agent runs git commit with message referencing directive origin.
Agent generates session_report.md documenting:
- What was completed
- What issues were encountered and how resolved
- What remains for next session
- Specific context the next Trunk should know

Checkpoint: All artifacts saved before session concludes.

### 2.3 Paradigm Establishment for Mobile Development

AI models exhibit strong bias toward web development paradigms. Every Flutter directive must explicitly counter this tendency:

**Required Paradigm Declaration:**
- State clearly: "This is Flutter mobile development using Dart and Flutter widgets"
- Explicitly exclude: "Do not use HTML, CSS, or web paradigms"

**Anti-Pattern Identification:**
- No "className" — use widget parameters instead
- No "div" thinking — use Column, Row, Stack for layout
- No CSS-like styling — use ThemeData and widget properties
- No "href" navigation — use Navigator and named routes
- No DOM manipulation — think in widget trees and state

**Pattern Anchoring:**
- Include reference to existing Flutter implementations in codebase
- Provide concrete widget examples demonstrating correct approach
- Reinforce paradigm at transition points within complex directives

### 2.4 Proactive Scope Extension

When the Leaf identifies high-value opportunities beyond strict directive scope:

1. Assess remaining context budget
2. Estimate effort required for the opportunity
3. If budget permits and value is clear, proceed with extension
4. Document the extension and rationale in session report
5. Coordinator validates the extension post-hoc

This protocol encourages initiative while maintaining accountability. Proactive work that delivers exceptional additional value should be encouraged, not constrained.

### 2.5 Session Planning and Calibration

Before each Leaf session, estimate expected duration based on directive complexity.
After completion, record actual duration in session_report.md.
Accumulate data to improve future estimation accuracy.

**Duration Categories:**
- Quick Fix: Under 30 minutes — single bug fix, minor adjustment
- Standard Feature: 1-2 hours — new screen, service implementation
- Complex Integration: 3+ hours — multi-file refactoring, new system

Tracking estimated versus actual duration creates calibration data for increasingly realistic planning.

---

## Part III: Safety and Risk Protocols

As a non-coder coordinator, you rely on these protocols to prevent damage to the codebase while enabling autonomous agent work.

### 3.1 The Dry Run Protocol

Before any destructive action (delete, overwrite, move, major refactor), the agent must explain the impact in non-technical language.

Coordinator Prompt: "Explain what will be lost or changed if we execute this action."

The agent must respond with:
- Files affected and how
- Data that could be lost
- Rollback strategy if something goes wrong

Only after coordinator understanding and approval should the action proceed.

### 3.2 Backup and Recovery

**Pre-Flight Check:** Before starting a complex Leaf session, ensure the current branch is clean (git status shows no uncommitted changes).

**Safety Branch Strategy:** For architectural changes or risky refactoring, force the agent to create a temporary branch:
```
git checkout -b refactor/[feature-name]-safe-mode
```

**Recovery Path:** If something breaks catastrophically:
```
git stash (save current work)
git checkout main (return to stable state)
```

### 3.3 Context Management (The Threshold System)

**Green Zone (under 70%):** Normal operation. Full creative freedom within directive scope.

**Yellow Zone (70-85%):** Warning state.
- Agent must alert coordinator
- Complete current logical unit of work
- No new features or scope expansion
- Prepare for potential handoff

**Orange Zone (85-90%):** Mandatory preservation.
- Commit current state immediately (even if incomplete)
- Generate handoff report with maximum detail
- Document exactly where work stopped
- List specific next steps for continuation

**Red Zone (over 90%):** Emergency stop.
- Cease all implementation work
- WIP commit with clear labeling
- Complete handoff report is mandatory
- Session terminates immediately

Never approach 95% utilization where context overflow creates quality degradation risk.

### 3.4 The Blocking Issue Protocol

When the agent encounters an issue it cannot resolve autonomously:

1. Document the issue with full technical context
2. List attempted solutions and their results
3. Propose hypotheses for root cause
4. Request coordinator decision: escalate to Trunk, seek external help, or defer

Do not spin endlessly on unsolvable problems — recognize when human judgment is needed.

---

## Part IV: Technical Standards and Quality

### 4.1 Pragmatism Over Purity

Principle: A working feature with "good enough" code is better than a broken feature with "perfect" architecture.

When a refactor hits unexpected complexity:
- Revert to the simplest working solution
- Document the technical debt in the session report
- Note the ideal architecture for future consideration
- Do not stall progress for theoretical elegance

Creative use of existing infrastructure often beats elegant solutions requiring migrations or extensive refactoring.

### 4.2 Semantic Gap Mitigation

**The Problem:** AI models trained heavily on web content exhibit strong bias toward HTML/CSS/JavaScript patterns even when working on mobile applications.

**Detection Signs:**
- Code that "looks like" a webpage
- References to DOM, events, or CSS properties
- Layout thinking in terms of divs and spans
- Navigation using URLs or links

**Mitigation Strategies:**

Explicit Paradigm Declaration at directive start.

Anti-Pattern Cross-Reference: Leaf agent must compare new code against existing mobile patterns. If structural similarity to web code is detected, pause and reconsider.

Pattern Anchoring: Reference existing correct implementations as templates.

Immediate Correction: If web concepts appear in output, correct immediately rather than letting drift accumulate.

**Flutter-Specific Correct Patterns:**
- Widget trees, not DOM
- ThemeData and widget parameters, not CSS
- Column/Row/Stack composition, not div layout
- setState or state management, not DOM manipulation
- Navigator with routes, not href links

### 4.3 Code Quality Expectations

All code must be production-ready:

**Error Handling:** Proper try-catch with appropriate recovery strategies. User-facing error messages that are helpful without exposing internals.

**Security:** Input validation at controller level. Authentication checks on protected routes. Sanitization of user-provided content.

**Performance:** Database queries with appropriate indexing. Avoiding N+1 query patterns. Lazy loading for expensive operations.

**Maintainability:** Clear naming that reveals intent. Logical file organization following established patterns. Comments for complex logic, not obvious operations.

**Consistency:** Follow patterns established elsewhere in codebase. Use existing utilities rather than reimplementing. Match code style of surrounding files.

### 4.4 Documentation Hygiene

Cleanup Responsibility: Leaf sessions must remove temporary analysis files, debug logs, and scratch work before closing.

Dual Sync Requirement: Any update to methodology documentation must be:
1. Committed to the Git repository
2. Updated in Claude Project Knowledge

This ensures both Trunk sessions (browser) and Leaf sessions (IDE) operate from synchronized methodology understanding.

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

**Pattern Categories:**
- Alpha: Authentication and session errors
- Bravo: Database and query issues
- Charlie: API integration problems
- Delta: State management bugs
- Echo: Build and dependency conflicts
- Foxtrot: Test infrastructure issues

### 5.2 The Handoff Report

When a session ends — whether from successful completion, context limits, or blocking issues — the agent produces a structured report for Trunk continuity.

**Required Sections:**

```
# Session Report: [Date] - [Brief Description]

## Status
What percentage of the directive was completed?
What is the overall state of the feature/task?

## Completed Work
- Specific files created or modified
- Tests added and their pass/fail status
- Documentation updated

## Issues Encountered
- Problems faced during implementation
- How they were resolved (or why they remain unresolved)
- Entries added to Bank of Failures if applicable

## Next Steps
Immediate next logical task for continuation.
Prerequisites that must be in place.
Estimated complexity of remaining work.

## Context Notes
Specific file names, variable names, or architectural decisions
that the next session must know about to continue effectively.
```

### 5.3 External Memory Continuity

The distributed intelligence system relies on external memory to maintain coherence across sessions.

**GitHub as Primary Truth Source:**
- All code lives in the repository
- Commit messages reference originating sessions
- Version history enables tracking architectural decisions
- Branch strategy enables safe experimentation

**Claude Projects as Knowledge Layer:**
- Syncs with GitHub repository automatically
- Provides Project Knowledge search across sessions
- Maintains methodology and specification access
- Enables Trunk to analyze Leaf outputs

**The Continuity Cycle:**
1. Trunk creates directive based on current project state
2. Coordinator transfers directive to Leaf environment
3. Leaf executes, commits to GitHub, generates report
4. GitHub syncs to Project Knowledge
5. Trunk queries Project Knowledge for session outputs
6. Trunk formulates next directive building on completed work
7. Cycle continues with accumulated context

Each session systematically builds on previous work through explicit references, committed code, documented patterns, and archived reports.

---

## Part VI: Evolution and Adaptation

### 6.1 Methodology Evolution Principles

**Practice Over Theory:** Changes to methodology must address real problems encountered in actual development. Avoid theoretical improvements without practical validation. Test proposed changes on real features before permanent adoption.

**Simplicity Over Complexity:** Resist adding layers for edge cases. Keep methodology accessible to newcomers. If a principle cannot be explained simply, reconsider its formulation.

**Measurement Over Intuition:** Track time from task definition to working code. Monitor iteration counts before acceptable solutions. Measure context overflow incidents. Use metrics to guide evolution rather than impressions.

### 6.2 Continuous Improvement Process

After each significant feature implementation:
1. Document lessons learned in session report
2. Identify patterns in recurring issues
3. Propose methodology amendments based on evidence
4. Test amendments on next feature
5. Adopt successful amendments permanently

The methodology is a living document that improves through operational feedback.

### 6.3 Coordinator Role Development

The human coordinator role encompasses multiple dimensions:

**Resource Management:** Monitoring context across sessions. Planning for session continuity and handoffs. Selecting appropriate tools (Trunk vs Leaf, browser vs CLI) based on task requirements.

**Strategic Trade-offs:** Deciding when to prioritize speed versus architectural purity. Choosing between completing current work or pivoting to higher-priority discoveries. Balancing technical debt against delivery timelines.

**External Memory Maintenance:** Ensuring GitHub and Project Knowledge remain synchronized. Managing documentation lifecycle (creation, updates, archival). Maintaining signal-to-noise ratio through periodic cleanup.

### 6.4 Scaling Considerations

As the project grows, the methodology scales accordingly:
- Add specialized Trunk roles if domain complexity increases
- Create domain-specific directive templates (mobile, backend, infrastructure)
- Establish feature-specific troubleshooting patterns
- Build reusable component libraries with integration guides
- Maintain architectural consistency through explicit principle documentation

---

## Appendix: Quick Reference

### Context Thresholds

| Zone | Utilization | Action |
|------|-------------|--------|
| Green | Under 70% | Normal operation |
| Yellow | 70-85% | Warning, complete current unit, no expansion |
| Orange | 85-90% | Mandatory commit and handoff preparation |
| Red | Over 90% | Emergency stop, WIP commit, terminate |

### Directive Sizing

| Complexity | Pages | Examples |
|------------|-------|----------|
| Standard | 1-2 | CRUD operations, single screen |
| Complex | 2-3 | New patterns, multi-file integration |
| Architectural | 3-4 | System-wide changes, major refactoring |

### Session Duration Categories

| Category | Duration | Scope |
|----------|----------|-------|
| Quick Fix | Under 30 min | Single bug, minor adjustment |
| Standard Feature | 1-2 hours | New screen, service implementation |
| Complex Integration | 3+ hours | Multi-file refactor, new system |

### Phase Checkpoints

| Phase | Checkpoint Action |
|-------|-------------------|
| Discovery | Map complete, plan ready |
| Planning | Coordinator approval received |
| Implementation | Tests passing, code committed |
| Delivery | Report generated, handoff complete |

### File Locations (Trunk Environment)

| Purpose | Path |
|---------|------|
| Working directory | /home/claude |
| User uploads | /mnt/user-data/uploads |
| Output artifacts | /mnt/user-data/outputs |
| Project knowledge | /mnt/project/ |

### Standard Git Workflow

```bash
# Before session
git status                    # Verify clean state
git checkout -b feature/name  # Create feature branch (if new)

# During session
git add .
git commit -m "Implement [feature] - Session [date]"

# After session
git push origin feature/name

# For risky operations
git checkout -b refactor/safe-mode  # Safety branch
```

### Paradigm Quick Check (Flutter)

| Wrong (Web) | Correct (Flutter) |
|-------------|-------------------|
| className | Widget parameters |
| div | Column, Row, Stack |
| CSS styling | ThemeData, widget properties |
| href/link | Navigator, named routes |
| DOM events | GestureDetector, callbacks |
| state in DOM | setState, Provider, Riverpod |

### Troubleshooting Pattern Categories

| Code | Domain |
|------|--------|
| Alpha | Authentication and sessions |
| Bravo | Database and queries |
| Charlie | API integration |
| Delta | State management |
| Echo | Build and dependencies |
| Foxtrot | Test infrastructure |

---

*This methodology serves as the authoritative operational reference for all Trunk and Leaf sessions in the Restaurant Guide project. It establishes the two-tier agentic architecture enabling efficient collaboration between strategic planning and autonomous execution.*

**Synchronization Requirement:** This document must exist in both Claude Project Instructions (for Trunk session runtime access) and the Git repository docs/ directory (for Leaf session reference). Updates to either location must be synchronized immediately.
