# Distributed Intelligence Methodology v8.1
## The Agentic Framework for Restaurant Guide

**Version:** 8.1
**Date:** December 2025
**Status:** Active Operational Standard
**Core Paradigm:** Human Coordination of Autonomous Agents

**Changelog v8.1:**
- Added Section 2.6: Figma MCP Integration Protocols
- Updated Section 3.3: Context Thresholds (added Figma-specific budgets)
- Updated Section 4.2: Semantic Gap Mitigation (added Figma MCP Paradigm Declaration)
- Updated Appendix: Quick Reference (added Figma MCP tables)

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

### 2.6 Figma MCP Integration Protocols

**Added in v8.1** — Based on experimental validation (December 2025).

Figma MCP enables direct design-to-code workflows within Leaf sessions. These protocols establish optimal patterns for context-efficient design analysis and Flutter code generation.

#### 2.6.1 Design Analysis Workflow

**Prerequisite Setup:**
1. Figma Desktop app installed and running
2. Design file open with target screens
3. Claude Code session initiated with Figma MCP enabled

**Standard Analysis Process:**

**Phase 1: Frame Selection**
- User selects target frame/node in Figma Desktop (single selection for screenshots, multi-selection supported for metadata)
- Frame highlighted with blue border confirms active selection

**Phase 2: Agent Invocation**

For Flutter projects, ALWAYS specify target framework:

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

**Phase 4: Selective Deep-Dive (if needed)**

For large screens returned as metadata, request full code for specific sections:
```typescript
mcp__figma__get_design_context({
  fileKey: "[file-key]",
  nodeId: "[sublayer-id]",  // e.g., "1:69904" for specific section
  clientLanguages: "dart",
  clientFrameworks: "flutter"
})
```

#### 2.6.2 Context Budget Guidelines

**Experimentally Validated Costs (December 2025):**

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
1. **Metadata-first approach:** Analyze all screens as metadata, generate code only for approved designs
2. **Sublayer targeting:** For complex screens, request full code for specific sections by ID
3. **Batch similar screens:** Redundancy optimization reduces per-screen cost in flows
4. **Defer exploration:** If context tight, prioritize implementation over survey

#### 2.6.3 Workflow Protocols

**Protocol A: Iterative Design Review**

Use Case: Reviewing Figma designs during development, providing feedback to designer.

```
DIRECTIVE: Figma Design Review — [Feature Name]

Objective: Analyze new Figma designs for [Feature], identify implementation
challenges, provide feedback on technical feasibility.

Scope:
- Screens: [List frame names or Figma URL with node IDs]
- Focus areas: Layout complexity, state variations, animations

Output:
- Technical feasibility assessment
- Implementation complexity estimate
- Feedback for designer (simplification opportunities)
- Preliminary widget structure (if straightforward)
```

Context Budget: ~20-30% (5-8 screens analyzed)

**Protocol B: Implementation Preparation**

Use Case: Design finalized, preparing to implement in Flutter.

```
DIRECTIVE: Flutter Implementation Prep — [Screen Name]

Objective: Generate production-ready Flutter widget for [Screen] based on
finalized Figma design.

Paradigm: Flutter Mobile (Dart). NO web paradigms.

Scope:
- Screen: [Figma URL with node-id=X:Y]
- Interactivity: [List expected behaviors]
- Animations: [Specify transitions]
- State: [Initial state, error states, loading states]

Constraints:
- Follow existing widget patterns in lib/screens/
- Use project ThemeData (colors, fonts)
- Maintain accessibility standards

Success Criteria:
- Widget compiles without errors
- Matches design pixel-perfect
- All interactive states implemented
- Animations smooth (60fps)
```

Context Budget: ~15-25% (1-2 screens with full code)

**Protocol C: Design System Extraction**

Use Case: Extracting reusable components, colors, typography from Figma.

```
DIRECTIVE: Design System Extraction — [Component Category]

Objective: Extract [Buttons / Typography / Colors / Icons] from Figma design
system and generate Flutter theme code.

Scope:
- Figma file: [Design System URL]
- Components: [List specific components or "All in category"]

Output:
- ThemeData extension or component library
- Constants file for colors/spacing
- Reusable widget classes
```

Context Budget: ~10-20%

#### 2.6.4 Multi-Screen User Flow Analysis

When analyzing complete interaction flows (onboarding, checkout, registration):

**Process:**
1. User selects all frames in flow (multi-select in Figma)
2. Agent calls get_design_context (screenshot will fail for multi-selection, metadata succeeds)
3. Agent receives sparse metadata for all frames
4. Agent traces logical sequence, identifies:
   - State progression
   - Validation rules
   - Error states
   - Interactive elements
   - Transition triggers

**Expected Output:**
- Flow diagram (textual or structural)
- State management requirements
- Validation logic specifications
- Error handling patterns

**Context Cost:** ~0.7% per screen (highly efficient for batch analysis)

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

#### 3.3.1 Figma MCP Context Budgets (Added in v8.1)

**Standard Allocation:**
- Single screen analysis: 3-4% context
- Multi-screen batch (7-10 screens): 5-8% context
- Full code generation per screen: +3-4% additional

**Session Planning with Figma Work:**

| Context Zone | Screens Analyzed | Code Generated | Action |
|--------------|------------------|----------------|--------|
| Green (<70%) | 10-15 | 6-8 | Normal operation |
| Yellow (70-85%) | Complete current | 1-2 max | Prepare handoff |
| Orange (85-90%) | Commit metadata | 0 | Emergency stop |

**Emergency Protocol for Mid-Session Overflow:**

If context exceeds 70% with Figma work incomplete:
1. Commit analyzed metadata to documentation
2. Generate handoff report with sublayer IDs for next session
3. Prioritize critical screens for code generation
4. Defer exploratory analysis to future session

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

#### 4.2.1 Figma MCP Paradigm Declaration (Added in v8.1)

When using Figma MCP for design-to-code workflows, semantic gap risk is **CRITICAL** without proper parameter specification.

**Default Behavior (Dangerous):**
- Figma MCP returns React + Tailwind CSS code
- Requires manual transformation to Flutter
- High probability of web pattern contamination during translation

**Correct Configuration:**
```typescript
get_design_context({
  fileKey: "[file-key]",
  nodeId: "[node-id]",
  clientLanguages: "dart",
  clientFrameworks: "flutter"
})
```

**Impact of Correct Configuration:**
- Returns sparse metadata instead of web code
- Agent generates Flutter from structural blueprint
- Zero web paradigm exposure

**Validation Checklist (Post-Generation):**

Before committing Figma-derived Flutter code, verify ZERO presence of:

| Anti-Pattern | Check | Correct Flutter Alternative |
|--------------|-------|----------------------------|
| className | ❌ Must be absent | Widget parameters |
| style={{}} | ❌ Must be absent | BoxDecoration, ThemeData |
| div, span, button | ❌ Must be absent | Container, Text, ElevatedButton |
| onClick | ❌ Must be absent | onTap, onPressed |
| href, Link | ❌ Must be absent | Navigator.push/pop |
| margin/padding as strings | ❌ Must be absent | EdgeInsets |
| CSS properties | ❌ Must be absent | Flutter styling classes |

**Experimental Evidence (December 2025):**
- Without parameters: React code returned, transformation required
- With parameters: Metadata returned, zero semantic gap detected in generated Flutter
- Context cost: Similar (~3-4%) regardless of response format

**Recommendation:** ALWAYS specify clientLanguages and clientFrameworks in Figma MCP calls for Flutter projects.

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
- Golf: Figma MCP integration issues (Added in v8.1)

### 5.2 The Handoff Report (Forward-Looking Structure)

When a session ends, the agent produces a continuation document for the next session. The handoff report is not a retrospective narrative — it functions as GPS coordinates for immediate forward progress. The fact that a handoff exists already signals that previous questions are resolved; the new session inherits results, not the process of achieving them.

**Core Principle:** Every sentence in a handoff report occupies space in the next session's limited context window. Retrospective elements ("we faced problem X", "after consideration we chose Y over Z") require the new agent to reconstruct mental states it cannot access. This creates cognitive noise. Instead, provide only what enables immediate continuation.

**Required Sections:**

```
# Handoff: [Feature/Task Name]

## Current State
What exists and works right now.
- Files that are in place (with paths)
- Tests that pass (with count or names)
- Functionality that is operational
- Current test coverage or completion percentage

## Continuation Point
Exact coordinates for immediate resumption.
- Specific file to open first
- Specific function or component to work on next
- The single next action to take
- Expected outcome of that action

## Dependencies (if any)
What must be in place before continuation.
- Services that must be running
- Environment variables required
- External resources needed
- Blocking issues awaiting resolution (with owner)

## Context Anchors
Minimal set of specific names and decisions the next session must know.
State as facts without explanation of reasoning.
- Key variable or class names introduced
- Architectural patterns being followed (reference only)
- Constraints that must be maintained
- If Bank of Failures was updated, reference the entry title
```

**What to Exclude:** Problem narratives and resolution stories. Alternative approaches that were considered. Emotional or evaluative language ("this was challenging", "finally resolved"). Explanation of why decisions were made — only state what was decided. Redundant context that exists in codebase or documentation.

**Length Guideline:** A well-formed handoff report is typically 15-25 lines. If it exceeds 40 lines, it likely contains retrospective content that should be trimmed.

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
| Golf | Figma MCP integration (v8.1) |

### Handoff Report Structure

| Section | Purpose | Content Type |
|---------|---------|--------------|
| Current State | What exists now | Files, tests, working functionality |
| Continuation Point | Where to resume | Specific file, function, next action |
| Dependencies | What must be ready | Services, environment, blockers |
| Context Anchors | Essential facts | Names, patterns, constraints (no rationale) |

**Handoff Anti-Patterns to Avoid:**
- Problem narratives ("we struggled with...")
- Resolution stories ("after trying X, Y worked")
- Decision rationale ("we chose A because...")
- Evaluative language ("challenging", "finally")

### Figma MCP Quick Reference (Added in v8.1)

**Context Costs:**

| Operation | Cost | Capacity per Session |
|-----------|------|---------------------|
| Single screen analysis | ~3-4% | 10-15 screens |
| Complex screen (auto-optimized) | ~3-4% | 10-15 screens |
| Multi-screen batch | ~0.7% per screen | 15-20 screens |
| Full code generation | ~6-7% per screen | 6-8 screens |

**Mandatory Parameters for Flutter:**

```typescript
{
  clientLanguages: "dart",
  clientFrameworks: "flutter"
}
```

**Response Types:**

| Type | Trigger | Action |
|------|---------|--------|
| Full Code | Small designs | Transform or use as reference |
| Sparse Metadata | Large designs (>~2000px) | Generate Flutter from structure |

**Semantic Gap Checklist:**

| Must NOT appear | Must appear instead |
|-----------------|---------------------|
| className | Widget parameters |
| div, span | Column, Row, Container |
| CSS properties | BoxDecoration, EdgeInsets |
| onClick, href | onTap, Navigator |
| style={{}} | ThemeData references |

---

*This methodology serves as the authoritative operational reference for all Trunk and Leaf sessions in the Restaurant Guide project. It establishes the two-tier agentic architecture enabling efficient collaboration between strategic planning and autonomous execution.*

**Synchronization Requirement:** This document must exist in both Claude Project Instructions (for Trunk session runtime access) and the Git repository docs/ directory (for Leaf session reference). Updates to either location must be synchronized immediately.

**Version History:**
- v8.0 (November 2025): Two-tier architecture consolidation
- v8.1 (December 2025): Figma MCP integration protocols based on experimental validation
