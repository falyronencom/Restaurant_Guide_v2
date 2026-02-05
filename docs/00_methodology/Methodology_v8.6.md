# Distributed Intelligence Methodology v8.6
## The Agentic Framework for Restaurant Guide

**Version:** 8.6
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
- Formulates Discovery Directives for Pre-flight investigation
- Creates Informed Directives based on Discovery Reports
- Coordinates cross-domain integration and phase transitions
- Evolves methodology based on operational learnings
- Manages project documentation and specifications

Constraint: Does not write implementation code directly. Does not have direct access to codebase — relies on Discovery Reports for current state. Focuses on *what* needs to be accomplished and *why*, leaving *how* to the autonomous Leaf.

**Tier 2 — Autonomous Leaf (Local Execution)**

Role: The Builder, Tester, and Integrator.

Environment: VS Code Terminal via Claude Code Extension.

Responsibilities:
- Direct codebase access: reads actual file structure and current state
- Librarian role: investigates codebase, produces Discovery Reports
- Implementer role: executes directives, creates files, edits code
- Verification: runs local tests to validate functionality
- Integration: commits changes to Git with descriptive messages
- Reporting: generates Semantic Handoff or Completion Report

Key Capability: Leaf sessions iterate autonomously with direct codebase access, enabling rapid feedback loops and self-correction.

### 1.3 The Human Coordinator Role

Role: The Bridge, Guardian, Vision Keeper, and Session Auditor.

**Core Responsibilities:**

Strategic Vision Keeper: Maintains long-term architectural coherence across sessions. Ensures individual session outputs align with overall project direction. Makes final decisions when agent proposals conflict with project principles.

Context Bridge: Transfers Discovery Directives from Trunk to Librarian, Discovery Reports from Librarian to Trunk, and Informed Directives from Trunk to Implementer. Manages the information flow between systems with different interfaces and capabilities.

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
- Confirm directive or task description is complete and appropriately scoped
- Prepare Semantic Handoff from previous session if continuing work (see Section 5.2)
- Clear any stale context from previous debugging sessions

Launch Package Assembly:

For Librarian sessions:
- Discovery Directive from Trunk

For Implementer sessions (Mode A — Informed Execution):
- Informed Directive from Trunk
- Discovery Report from Librarian session

For Implementer sessions (Mode B — Autonomous Execution):
- Task description from Coordinator
- Previous Semantic Handoff (if continuation)

**Rule — Coordinator Terminal Ownership:** Heavy processes (backend server, Flutter emulator, database connections) run in coordinator's terminal, not in agent's context. Agent accesses results through filtered queries, preserving context for implementation work.

#### 1.3.2 Pre-flight Discovery Protocol

Trunk creates directives based on architectural understanding from Project Knowledge and Semantic Handoffs, but does not have direct access to the current state of code. Pre-flight Discovery inverts the information flow — Librarian investigates reality first, then Trunk creates directive based on verified facts.

**Standard Flow for Trunk Directives:**

**Phase 1 — Discovery Directive (Trunk → Coordinator → Librarian)**

Trunk formulates a Discovery Directive — a compact document with 5-10 targeted questions about the current state of code (see Section 2.2 for format). This is not an implementation directive, but focused guidance for investigation. Coordinator transfers Discovery Directive to a new Librarian session.

**Phase 2 — Investigation (Librarian)**

Librarian investigates the codebase, answers each question with concrete evidence (file:line, code snippets, or NOT FOUND). Adds "Additional Findings" section for relevant discoveries beyond the questions. Forms "Navigation for Implementer" section with file paths, data flow, and reading order. Produces Discovery Report (see Section 2.2 for format). Session closes — Librarian context is disposable.

**Phase 3 — Informed Directive (Coordinator → Trunk)**

Coordinator transfers Discovery Report to Trunk session. Trunk analyzes answers and creates Informed Directive — a directive grounded in the real picture of code, not architectural assumptions.

**Phase 4 — Informed Execution (Implementer)**

Implementer receives Informed Directive + Discovery Report. Performs Quick Sanity Check (not full Pre-scan) to verify no critical changes occurred since Discovery. Proceeds to Planning and Implementation.

**Double Context Savings:**

| Without Pre-flight | With Pre-flight |
|--------------------|-----------------|
| Trunk creates directive on assumptions | Trunk creates directive on facts |
| Leaf spends 50-80% on discovery | Implementer receives ready coordinates |
| Possible Scope Correction Signals | Mismatches detected before directive |

**When Pre-flight Discovery is NOT Required:**

Pre-flight Discovery is the standard flow for Trunk directives. However, for simple tasks that the coordinator resolves directly with Leaf without involving Trunk, use Autonomous Execution mode (Mode B) — see Section 2.3.

**Information Flow Diagram:**

```
Trunk                    Coordinator          Leaf (Librarian)
  │                           │                    │
  │── Discovery Directive ───>│──────────────────> │
  │   (5-10 questions)        │                    │
  │                           │                    │── investigates
  │                           │                    │
  │<── Discovery Report ──────│<───────────────────│
  │   (answers + findings)    │                    │
  │                           │                    │
  │── Informed Directive ────>│──────────────────> │ (Implementer)
  │   (based on reality)      │                    │
```

#### 1.3.3 Pass-Through Principle

**Rule:** The coordinator transfers all technical artifacts — Discovery Directives, Discovery Reports, Informed Directives, Semantic Handoffs — without editing, filtering, or interpreting their content. Artifacts are passed as-is between sender and recipient.

**Rationale:** The coordinator operates as a non-technical bridge between digital intelligence instances. Any intermediate editing risks distorting the semantic content that the recipient depends on. The coordinator's value lies in routing artifacts to the correct recipient and managing session logistics, not in modifying technical content.

**What the coordinator DOES with artifacts:**
- Routes to the correct recipient (Trunk, Librarian, or Implementer)
- Confirms receipt and readability
- Provides operational context ("backend is running", "emulator shows error X")
- Makes strategic decisions (proceed, pause, escalate)

**What the coordinator does NOT do with artifacts:**
- Edit, summarize, or reformat technical content
- Filter out sections that seem "less important"
- Add interpretive commentary inside the artifact
- Merge or split artifacts without explicit instruction from Trunk

### 1.4 Specialized Leaf Roles

Leaf sessions serve different purposes depending on the task. Role specialization enables context-efficient workflows by separating investigation from implementation.

**Available Roles:**

| Role | Purpose | Output | Context Usage |
|------|---------|--------|---------------|
| **Implementer** (default) | Execute directive, write code, run tests | Commits + Semantic Handoff | Full session |
| **Librarian** | Investigate codebase, produce analytical map | Discovery Report | Disposable — close after report |

**Librarian Role Details:**

The Librarian is a short-lived Leaf session focused exclusively on codebase investigation. It reads files, traces data flows, and produces a Discovery Report for Trunk (to create Informed Directive) and for Implementer (navigation coordinates).

Key properties:
- Does not write code or make commits
- Context is disposable — session closes after report delivery
- Coordinator transfers Discovery Report to both Trunk and Implementer (see Pass-Through Principle, Section 1.3.3)
- Standard part of Pre-flight Discovery flow for all Trunk directives

**When Librarian is Launched:**
- Always as Phase 2 of Pre-flight Discovery Protocol (Section 1.3.2)
- When Trunk needs to understand current codebase state before creating directive

**Implementer Role Details:**

The standard Leaf session for code execution. Operates in two modes:

**Mode A — Informed Execution:** Receives Informed Directive + Discovery Report. Skips Pre-scan and Discovery phases (Librarian already did this work). Performs Quick Sanity Check, then proceeds to Planning and Implementation.

**Mode B — Autonomous Execution:** Receives ad-hoc task from Coordinator without Trunk directive. Performs full cycle: Pre-scan → Discovery → Planning → Implementation. See Section 2.3 for details.

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

**Informed Directive:**

An Informed Directive is a standard directive created by Trunk after receiving a Discovery Report. The difference from a regular directive — it is based on verified facts about the code state, not architectural assumptions.

**Marking:** The directive header indicates:

```
DIRECTIVE: [Feature Name]
Based on: Discovery Report [date]
```

**What Trunk includes from Discovery Report:**
- Specific files for modification (from Navigation section)
- Existing patterns to follow (from Additional Findings)
- Known constraints and risks
- Integration points with current code

**What Trunk does NOT copy:**
- Full answers to questions (Implementer receives Discovery Report separately)
- Reading order (this is in Discovery Report for Implementer)

**Guideline — Context-Aware Sizing:**

Standard features (CRUD operations, established patterns): 1-2 pages. Complex features (new patterns, significant integration): 2-3 pages. Architectural initiatives (system-wide changes): 3-4 pages maximum.

Brevity is intentional — Leaf discovers details autonomously, and for Informed Directives, Librarian has already mapped the territory.

### 2.2 Pre-flight Discovery Artifacts

Pre-flight Discovery uses two specialized artifacts: Discovery Directive (Trunk → Librarian) and Discovery Report (Librarian → Trunk + Implementer).

#### 2.2.1 Discovery Directive Format

Discovery Directive is a compact artifact for Pre-flight Discovery. It is not an implementation directive; it is focused guidance for Librarian investigation.

**Structure:**

```
DISCOVERY DIRECTIVE: [Task Name]

Role: Librarian (Investigation Only)
Output: Discovery Report
Complexity Estimate: [Low / Medium / High] — [brief rationale: N files, M modules]

## Mission
[One paragraph describing what Trunk needs to understand before creating
implementation directive. What uncertainties need to be resolved.]

## Investigation Questions

Q1: [Specific question]
Search in: [specific paths or patterns]
Expected answer format: [found with details / NOT FOUND]

Q2: [Specific question]
Search in: [specific paths]
Expected answer format: [description of what to report]

...

[5-10 questions total]

## Discovery Report Format
[Template for Librarian to follow — ensures consistent output structure]

## Constraints
- Do NOT modify any files
- Do NOT create commits
- Do NOT implement solutions
- Do NOT estimate implementation effort (that's Trunk's job)
- ONLY investigate and document findings
```

**Rule — Gap Verification:**

For any investigation question where the answer determines whether implementation work is needed (e.g., "does screen X handle error states?"), Librarian must verify by reading the complete build() method or equivalent entry point of the component — not only by searching for expected keyword patterns.

A finding of "NOT FOUND" is only valid when the Librarian has read the relevant code section in full and confirmed the absence, not merely when a keyword search returned no results.

Rationale: Code may implement the expected behavior through patterns different from those specified in the search guidance. Keyword search identifies known patterns; semantic reading identifies any pattern.

**Rule — Question Design Principles:**

Each question must be binary-answerable — either found with concrete details, or NOT FOUND. Questions include WHERE to search (specific paths, grep patterns). Each question addresses one specific Trunk uncertainty.

**Examples of Good Questions:**

- "Is `geolocator` package in `mobile/pubspec.yaml`? If yes, provide version."
- "Does `EstablishmentsProvider` have fields for user coordinates? Check `mobile/lib/providers/establishments_provider.dart`."
- "Where is distance '0.3 km' hardcoded in UI? Search in `mobile/lib/screens/` and `mobile/lib/widgets/`. Provide file, line number, and 5 lines of surrounding code."
- "How does the API expect to receive user location? Check `establishments_service.dart` for parameter names."

**Examples of Bad Questions:**

- "How does geolocation work?" — too open-ended
- "Is the code good?" — subjective
- "What should we implement?" — this is Trunk's job, not Librarian's
- "Tell me everything about the search system" — no focus

**Complexity Estimate** replaces "Estimated Duration" from earlier versions. Time-based estimates are irrelevant for digital intelligence. Instead, indicate complexity in terms that affect session planning:

- **Low:** 2-3 files, single module
- **Medium:** 4-6 files, two modules
- **High:** 5+ files, 3+ modules, cross-layer investigation

#### 2.2.2 Discovery Report Format

Discovery Report serves two audiences: Trunk (to create Informed Directive) and Implementer (for navigation). The format explicitly separates these sections.

```markdown
# Discovery Report: [Task Name]

## Answers to Discovery Questions

Q1: [Question from Discovery Directive]
→ [Answer with concrete evidence: file:line, code snippet, or NOT FOUND]

Q2: [Question]
→ [Answer with evidence]

Q3: [Question]
→ [Answer]

...

## Additional Findings

- [Relevant discovery beyond the questions]
- [Potential risk or constraint discovered]
- [Existing pattern worth noting]
- [Dependency that might be affected]

## Navigation for Implementer

### Relevant Files
- [path]: [role in the task — 1 line]
- [path]: [role in the task — 1 line]
- [path]: [role in the task — 1 line]

### Data Flow
[Component A] → [Component B] → [Component C]
Key transformation point: [where data changes shape or format]

### Recommended Reading Order
1. [file] — start here because [reason]
2. [file] — then this for [reason]
3. [file] — finally [reason]
```

**Section Usage:**

| Section | Audience | How Used |
|---------|----------|----------|
| Answers to Questions | Trunk | Informs directive creation |
| Additional Findings | Trunk + Implementer | Risks and context for both |
| Navigation for Implementer | Implementer | Coordinates for quick start |

**Rule:** Coordinator transfers the entire document to both Trunk and Implementer without editing (see Pass-Through Principle, Section 1.3.3). Trunk focuses on the first two sections, Implementer on the last.

**Rule — Absence Verification Confidence:**

When a Discovery Report finding determines that something is "missing," "absent," or "NOT FOUND," and this absence directly creates implementation scope, Librarian must indicate how the absence was verified:

- **KW (Keyword Search)** — finding based on pattern/keyword search only. Acceptable for presence checks ("does file X contain import Y?") but insufficient for absence claims that drive implementation.
- **SR (Semantic Read)** — finding confirmed by reading the complete relevant code section (e.g., full build() method, entire service class). Required for any absence claim that determines implementation scope.

**Rule:** Any finding of "missing" or "NOT FOUND" that drives implementation work MUST have SR confidence. A keyword search that finds nothing is insufficient to confirm absence — code may implement the expected behavior through patterns different from those specified in the search guidance.

**Guideline — Length:** 20-40 lines. Discovery Report is GPS coordinates, not a codebase tour.

### 2.3 The Autonomous Execution Cycle

The Leaf session follows different phase sequences depending on execution mode.

#### Mode A: Informed Execution

Activated when: Implementer receives Informed Directive + Discovery Report from Trunk.

**Phase Sequence:**

```
Quick Sanity Check → Planning → Implementation → Semantic Handoff
```

**Quick Sanity Check (not full Pre-scan):**

Verify that no critical changes occurred since Discovery Report was created:
- Check if files from Navigation section still exist and weren't modified
- Verify no new commits that might affect the task
- Confirm integration points are still as described

Verify key gap claims: For each item marked as "missing" or "gap" in Discovery Report that drives implementation scope, perform a targeted read of the relevant code section (e.g., build() method for UI gaps) to confirm the gap exists before implementing.

**Guideline — Proportional Verification:** Verify the 2-3 highest-impact gaps that determine the largest portion of implementation work. Full re-verification of all findings is not required — that would duplicate the Librarian's role.

**Rule:** If Sanity Check reveals significant changes or that a key gap does not exist, signal to Coordinator before proceeding with directive as written.

**Phase 2: Planning and Approval**

Agent proposes an implementation plan in plain language. Plan includes: files to create/modify, approach, potential risks. Uses Navigation section from Discovery Report as primary map. Coordinator Checkpoint: Validates that the plan makes logical sense before granting execution permission.

**Phase 3: Implementation and Local Verification**

Agent creates and edits files according to approved plan. **Rule:** Agent must attempt to run the code or tests (flutter test, npm test, etc.) to verify syntax and logic. Self-Correction: If tests fail, agent iterates autonomously using accumulated troubleshooting knowledge. Continues until tests pass or blocking issue is identified.

**Phase 4: Delivery and Handoff**

Agent runs git commit with message referencing directive origin. If session ending with incomplete work, agent generates Semantic Handoff (Section 5.2). If task completed, generates Completion Report.

#### Mode B: Autonomous Execution

Activated when: Coordinator initiates ad-hoc task directly with Leaf, without Trunk directive.

**Phase Sequence:**

```
Pre-scan → Discovery → Planning → Implementation → Completion Report
```

**Phase 0: Pre-scan**

Agent launches 2-3 targeted Explore subagents to create a mini-Discovery Map:
- "Map all files related to [task domain]"
- "Trace data flow from [entry point] to [endpoint]"
- "List all providers/services interacting with [component]"

**Guideline — Cost:** 2-5% of context. Provides data to assess task complexity.

**Complexity Assessment:**

| Pre-scan Result | Decision | Rationale |
|----------------|----------|-----------|
| 2-3 files, single module | Proceed in main context | Discovery will be manageable |
| 4-6 files, two modules | Proceed with caution | Monitor discovery cost |
| 5+ files, 3+ modules | Signal to Coordinator | Consider escalating to Trunk for proper Pre-flight Discovery |

**Phase 1: Discovery (Read-Only)**

Using Pre-scan map, agent reads relevant files to build understanding. Focus main context on *understanding*, not *finding*.

Phase 0 + Phase 1 can overlap — validate assumptions while simultaneously reading relevant files.

**Rule:** Do not write code until you have understood the landscape.

**Phase 2-4:** Same as Mode A.

#### Mode Selection Guide

| Received from Coordinator | Mode | Phases Executed |
|---------------------------|------|-----------------|
| Informed Directive + Discovery Report | A (Informed) | Sanity Check → Plan → Implement |
| Ad-hoc task without directive | B (Autonomous) | Pre-scan → Discovery → Plan → Implement |

### 2.4 Mobile Paradigm and Semantic Gap Mitigation

Every Flutter directive must explicitly declare mobile paradigm and exclude web patterns. AI models exhibit bias toward web development; active countermeasures are required.

**Rule — Paradigm Declaration:**
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

**Guideline — Directive Integration:** When creating directives that involve UI work, reference the appropriate level of anti-pattern awareness. For new screens: emphasize all three levels. For bug fixes in existing screens: Level 3 is most relevant.

**Guideline — Pattern Anchoring:** Include reference to existing Flutter implementations in codebase. Level 3 patterns reference project-specific files (providers/, services/, main.dart).

### 2.5 Proactive Scope Extension

When the Leaf identifies high-value opportunities beyond strict directive scope:

1. If value is clear and effort is small, proceed
2. Document the extension and rationale in session report
3. Coordinator validates the extension post-hoc

This protocol encourages initiative while maintaining accountability.

### 2.6 Session Planning and Calibration

Before each Leaf session, estimate expected complexity based on task scope. After completion, record observations in session report. Accumulate data to improve future estimation accuracy.

**Complexity Categories:**

| Category | Indicators | Typical Context Usage (Mode B) |
|----------|------------|--------------------------------|
| Low | 2-3 files, single module, established pattern | 30-50% |
| Medium | 4-6 files, two modules, minor integration | 50-70% |
| High | 5+ files, 3+ modules, cross-layer changes | 70-90% |

**Guideline:** For High complexity tasks, consider Multi-Session Segmentation (Section 5.2.1).

### 2.7 Figma MCP Integration Protocols

*Reference section — consult when working with Figma designs. Not required reading for non-Figma tasks.*

Figma MCP enables direct design-to-code workflows within Leaf sessions. These protocols establish optimal patterns for context-efficient design analysis and Flutter code generation.

#### 2.7.1 Design Analysis Workflow

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

**Rule:** Without clientLanguages and clientFrameworks parameters, Figma MCP returns React + Tailwind code requiring transformation. Always specify these parameters for Flutter projects.

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

#### 2.7.2 Context Budget Guidelines

| Operation | Context Cost | Notes |
|-----------|--------------|-------|
| Simple screen metadata | ~3-4% | Standard analysis |
| Complex screen metadata | ~3-4% | Auto-optimized via sparse response |
| Multi-screen batch (7 frames) | ~5% | ~0.7% per screen average |
| Full Flutter code generation | ~6-7% | Metadata + code generation |
| Design system extraction | ~10-20% | Depends on scope |

**Guideline — Session Capacity Planning:**

| Session Type | Screens Analyzed | Code Generated | Expected Context |
|--------------|------------------|----------------|------------------|
| Design Survey | 10-15 | 0 | 30-60% |
| Selective Implementation | 5-8 | 3-5 | 40-60% |
| Deep Dive Single Screen | 1-2 | 1-2 (with animations) | 15-25% |

**Guideline — Optimization Tactics:**
1. Metadata-first approach: Analyze all screens as metadata, generate code only for approved designs
2. Sublayer targeting: For complex screens, request full code for specific sections by ID
3. Batch similar screens: Redundancy optimization reduces per-screen cost in flows
4. Defer exploration: If context tight, prioritize implementation over survey

#### 2.7.3 Workflow Protocols

**Protocol A: Iterative Design Review** — Use for reviewing Figma designs during development, providing feedback to designer. Context Budget: ~20-30% (5-8 screens analyzed).

**Protocol B: Implementation Preparation** — Use when design is finalized, preparing to implement in Flutter. Context Budget: ~15-25% (1-2 screens with full code).

**Protocol C: Design System Extraction** — Use for extracting reusable components, colors, typography from Figma. Context Budget: ~10-20%.

#### 2.7.4 Multi-Screen User Flow Analysis

When analyzing complete interaction flows (onboarding, checkout, registration):

1. User selects all frames in flow (multi-select in Figma)
2. Agent calls get_design_context (screenshot will fail for multi-selection, metadata succeeds)
3. Agent receives sparse metadata for all frames
4. Agent traces logical sequence, identifies state progression, validation rules, error states, interactive elements, transition triggers

**Guideline — Context Cost:** ~0.7% per screen (highly efficient for batch analysis).

---

## Part III: Safety and Risk Protocols

As a non-coder coordinator, you rely on these protocols to prevent damage to the codebase while enabling autonomous agent work.

### 3.1 The Dry Run Protocol

**Rule:** Before any destructive action (delete, overwrite, move, major refactor), the agent must explain the impact in non-technical language.

Coordinator Prompt: "Explain what will be lost or changed if we execute this action."

The agent must respond with files affected and how, data that could be lost, and rollback strategy if something goes wrong. Only after coordinator understanding and approval should the action proceed.

### 3.2 Backup and Recovery

**Rule — Pre-Flight Check:** Before starting a complex Leaf session, ensure the current branch is clean (git status shows no uncommitted changes).

**Safety Branch Strategy:** For architectural changes or risky refactoring, force the agent to create a temporary branch: `git checkout -b refactor/[feature-name]-safe-mode`

**Recovery Path:** If something breaks catastrophically: `git stash` (save current work), then `git checkout main` (return to stable state).

### 3.3 Context Management

**Observed Reality:** In Mode B (Autonomous Execution), discovery consumes 50-80% of session context consistently. This is a systemic characteristic independent of task complexity. Pre-flight Discovery (Section 1.3.2) addresses this by moving discovery to a disposable Librarian session, so Implementer in Mode A starts with ready coordinates.

**Coordinator's Role:** The coordinator monitors context and signals handoff when the session approaches its limit and implementation is incomplete. This is a single binary decision point, not a graduated scale.

**Guideline — Practical Context Patterns:**

| Scenario | Context Used | What Happens |
|----------|-------------|--------------|
| Mode A: Sanity Check + Planning | 10-20% | Implementer uses Discovery Report |
| Mode B: Pre-scan + Discovery | 50-80% | Full autonomous discovery |
| Implementation + Testing | 20-40% | Code changes and verification |
| Handoff or Commit | 5% | Semantic Handoff or commit |

**Coordinator Decision Matrix:**

| Observation | Action |
|-------------|--------|
| Implementer working from Discovery Report (Mode A) | Normal operation — context efficient |
| Implementer in Mode B, building understanding | Do not interrupt — discovery cannot be accelerated |
| Solution proposed, tests pass | Allow commit and report |
| Solution proposed, tests fail, context approaching limit | Signal handoff |
| Context at limit, no solution yet | Signal handoff immediately |

**Rule — Intuition Trigger Principle:** When the coordinator feels the need for handoff, this is a signal for immediate action, not for "one more message before that." The thought "time to do handoff" means it's already time.

#### 3.3.1 Figma MCP Context Budgets

*Reference — consult when working with Figma designs.*

| Session Phase | Screens Analyzed | Code Generated | Action |
|--------------|------------------|----------------|--------|
| Early session | 10-15 | 6-8 | Normal operation |
| Context approaching limit | Complete current | 1-2 max | Prepare handoff |
| Context at limit | Commit metadata | 0 | Handoff |

**Emergency Protocol for Mid-Session Overflow:** If context approaching limit with Figma work incomplete: commit analyzed metadata to documentation, generate Semantic Handoff with sublayer IDs for next session, prioritize critical screens for code generation, defer exploratory analysis to future session.

#### 3.3.2 Discovery Tax Management

**The Canonical Definition:** Discovery Tax is the context consumed by codebase investigation before implementation begins. In Mode B sessions, this consistently amounts to 50-80% of available context, independent of task complexity. This is a systemic characteristic of the LLM workflow, not a failure of any particular session.

**Two Components:**

| Component | Description | Mitigation |
|-----------|-------------|------------|
| **Navigational Tax** | Finding relevant files, mapping structure | Mode B: Subagent Pre-scan. Mode A: eliminated by Librarian |
| **Semantic Tax** | Reading, understanding, correlating code logic | Mode B: requires main context. Mode A: partially transferred via Discovery Report |

**The Solution — Pre-flight Discovery:**

Pre-flight Discovery (Section 1.3.2) addresses Discovery Tax structurally. Librarian pays the tax in disposable context. Implementer receives compressed results. The tax is paid once, not repeated across sessions.

**The Fresh Session Effect:**

When a session reaches its limit with an unresolved problem, the next session typically resolves the problem using less context — but only when the Semantic Handoff (Section 5.2) quality is sufficient. GPS-style handoffs (files modified, next action) do NOT produce this effect; Semantic Handoffs (with Problem Model and Eliminated Hypotheses) do.

### 3.4 The Blocking Issue Protocol

When the agent encounters an issue it cannot resolve autonomously:

1. Document the issue with full technical context
2. List attempted solutions and their results
3. Propose hypotheses for root cause
4. Request coordinator decision: escalate to Trunk, seek external help, or defer

**Rule:** Do not spin endlessly on unsolvable problems — recognize when human judgment is needed.

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

Scope Discipline: Limit task scope to what fits comfortably in fresh context. For High complexity tasks, use Multi-Session Segmentation rather than attempting completion in single session.

Semantic Handoff: Transfer work to fresh session before degradation occurs using Semantic Handoff format (Section 5.2).

Context Hygiene: Prevent "garbage" accumulation in context through filtered log access and coordinator terminal ownership of heavy processes (Section 3.6).

**Rule — Degradation Recognition:** If a bug is not resolved before second Compact activation, the session is considered degraded. Coordinator must terminate current session, reassemble task in Trunk with fresh analysis, and launch new "clean" Leaf session with refined directive.

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

**Guideline:** When filtered output is insufficient for debugging, agent requests specific log segment from coordinator. Coordinator extracts relevant portion (e.g., last 50 lines around error) and pastes extracted segment to agent. This manual handoff prevents automatic context pollution while maintaining debugging capability.

---

## Part IV: Technical Standards and Quality

### 4.1 Pragmatism Over Purity

**Rule:** A working feature with "good enough" code is better than a broken feature with "perfect" architecture.

When a refactor hits unexpected complexity: revert to the simplest working solution, document the technical debt in the session report, note the ideal architecture for future consideration, do not stall progress for theoretical elegance.

Creative use of existing infrastructure often beats elegant solutions requiring migrations or extensive refactoring.

### 4.2 Code Quality Expectations

**Rule:** All code must be production-ready.

**Error Handling:** Proper try-catch with appropriate recovery strategies. User-facing error messages that are helpful without exposing internals.

**Security:** Input validation at controller level. Authentication checks on protected routes. Sanitization of user-provided content.

**Performance:** Database queries with appropriate indexing. Avoiding N+1 query patterns. Lazy loading for expensive operations.

**Maintainability:** Clear naming that reveals intent. Logical file organization following established patterns. Comments for complex logic, not obvious operations.

**Consistency:** Follow patterns established elsewhere in codebase. Use existing utilities rather than reimplementing. Match code style of surrounding files.

### 4.3 Documentation Hygiene

**Rule — Cleanup Responsibility:** Leaf sessions must remove temporary analysis files, debug logs, and scratch work before closing.

**Rule — Dual Sync Requirement:** Any update to methodology documentation must be committed to the Git repository AND updated in Claude Project Knowledge. This ensures both Trunk sessions (browser) and Leaf sessions (IDE) operate from synchronized methodology understanding.

**Guideline — Documentation Standard:** Write for practitioners familiar with the technology stack. Focus on unique aspects of this implementation. Trust reader competence for standard patterns.

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

**Rule:** Before requesting human help for debugging, future Leaf sessions must query this file for similar symptoms.

**Pattern Categories:** Alpha (Authentication and sessions), Bravo (Database and queries), Charlie (API integration), Delta (State management), Echo (Build and dependencies), Foxtrot (Test infrastructure), Golf (Figma MCP integration), Hotel (Information Recursion incidents).

### 5.2 The Semantic Handoff

When a session ends with incomplete work, the agent produces a Semantic Handoff — a document that transfers understanding to the next session. The handoff functions as a semantic map that enables the next session to continue without re-discovering what was already known.

**Rule — Core Principle:** Every session that re-discovers what the previous session already knew represents a system failure in memory transfer. The handoff must transfer understanding, not just coordinates. Decision rationale IS the semantic map.

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

- **Rule:** Problem Model is mandatory. A handoff without a problem model is incomplete.
- **Rule:** Eliminated Hypotheses are mandatory. They prevent the next session from re-testing failed approaches.
- **Rule:** Verified Facts are mandatory. They distinguish confirmed knowledge from assumptions.
- **Guideline:** Semantic Anchors give the next session immediate vocabulary for the problem domain.
- **Guideline:** Dependency Graph provides structural navigation for the task.
- **Rule:** Manual Semantic Handoff is always preferred over auto-compact for session transitions.

**Guideline — Length:** 25-50 lines. Longer than GPS-style handoffs, but the investment pays for itself in reduced Discovery Tax for the next session.

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

For complex phases requiring multiple Leaf sessions (High complexity), use the Checkpoint Continuation Protocol.

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

**Guideline — Multi-Session Segmentation:**

| Complexity | Segments | Phases per Segment |
|------------|----------|-------------------|
| Medium-High | 2 | 3-4 phases each |
| High | 3 | 2-3 phases each |
| Very High | 4+ | 2 phases each |

### 5.3 External Memory Continuity

The distributed intelligence system relies on external memory to maintain coherence across sessions.

**GitHub as Primary Truth Source:** All code lives in the repository. Commit messages reference originating sessions. Version history enables tracking architectural decisions. Branch strategy enables safe experimentation.

**Claude Projects as Knowledge Layer:** Syncs with GitHub repository automatically. Provides Project Knowledge search across sessions. Maintains methodology and specification access. Enables Trunk to analyze Leaf outputs.

**The Continuity Cycle:**
1. Trunk creates Discovery Directive based on task requirements
2. Coordinator transfers to Librarian; Librarian produces Discovery Report
3. Coordinator transfers Discovery Report to Trunk (Pass-Through Principle)
4. Trunk receives Discovery Report, creates Informed Directive
5. Implementer executes, commits to GitHub, generates Semantic Handoff
6. GitHub syncs to Project Knowledge
7. Trunk queries Project Knowledge for session outputs
8. Trunk formulates next directive building on completed work
9. Cycle continues with accumulated context

---

## Part VI: Evolution and Adaptation

### 6.1 Operational Principles

**Rule — Intuition Trigger Principle:** When the coordinator feels the need for checkpoint or handoff, this is a signal for immediate action, not for "one more message before that." The thought "time to do handoff" means it's already time — do not delay even one exchange.

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

### Pre-flight Discovery Flow

| Phase | Actor | Input | Output |
|-------|-------|-------|--------|
| 1 | Trunk | Task concept | Discovery Directive |
| 2 | Librarian | Discovery Directive | Discovery Report |
| 3 | Trunk | Discovery Report | Informed Directive |
| 4 | Implementer | Informed Directive + Discovery Report | Implementation |

### Discovery Directive Quick Structure

| Section | Purpose |
|---------|---------|
| Mission | What Trunk needs to understand |
| Investigation Questions (5-10) | Specific, binary-answerable questions with search locations |
| Discovery Report Format | Template for Librarian to follow |
| Constraints | No modifications, no commits, only investigate |

### Discovery Report Quick Structure

| Section | Audience | Purpose |
|---------|----------|---------|
| Answers to Questions | Trunk | Verified facts for directive creation |
| Additional Findings | Both | Risks, patterns, discoveries |
| Navigation for Implementer | Implementer | Files, data flow, reading order |

### Leaf Execution Modes

| Trigger | Mode | Phases Executed |
|---------|------|-----------------|
| Informed Directive + Discovery Report | A (Informed) | Sanity Check → Plan → Implement |
| Ad-hoc task from Coordinator | B (Autonomous) | Pre-scan → Discovery → Plan → Implement |

### Leaf Execution Protocols

| Mode | Protocol Document |
|------|-------------------|
| A (Informed Execution) | Protocol_Informed.md |
| B (Autonomous Execution) | Protocol_Autonomous.md |

### Context Management Quick Reference

| Observation | Coordinator Action |
|-------------|-------------------|
| Implementer using Discovery Report (Mode A) | Normal operation — context efficient |
| Implementer in Mode B, building understanding | Do not interrupt |
| Solution proposed, tests pass | Allow commit |
| Solution proposed, tests fail, context approaching limit | Signal handoff |
| Context at limit, no solution | Signal handoff immediately |

### Information Recursion Indicators

| Signal | Severity | Action |
|--------|----------|--------|
| Repeated solution proposals | Warning | Review session history |
| Fixes creating new bugs | Critical | Prepare for session termination |
| Contradictory code patterns | Critical | Stop and reassess |
| Second Compact activation | Terminal | End session, reassemble in Trunk |

### Complexity Categories

| Category | Indicators | Typical Context (Mode B) |
|----------|------------|-------------------------|
| Low | 2-3 files, single module | 30-50% |
| Medium | 4-6 files, two modules | 50-70% |
| High | 5+ files, 3+ modules | 70-90% |

### Multi-Session Segmentation Guide

| Complexity | Segments | Phases per Segment |
|------------|----------|-------------------|
| Medium-High | 2 | 3-4 phases each |
| High | 3 | 2-3 phases each |
| Very High | 4+ | 2 phases each |

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

### v8.6 (February 2026)

**Practice-driven revision** based on first operational execution of Pre-flight Discovery flow under v8.5, revealing false-negative vulnerability in Discovery Reports.

**Key Insight:** Librarian keyword searches can produce false "NOT FOUND" findings when code implements expected behavior through different patterns. This inverts Pre-flight Discovery's value proposition — Trunk creates directive on "verified facts" that are actually incorrect.

**Major Changes:**

- **Section 1.3.3 (NEW):** Pass-Through Principle — coordinator transfers artifacts without editing
- **Section 2.2.1:** Added Gap Verification Rule — Librarian must semantically read code sections for absence claims, not rely on keyword search alone
- **Section 2.2.2:** Added Absence Verification Confidence (KW/SR) marking requirement for Discovery Report findings
- **Section 2.3 Mode A:** Quick Sanity Check expanded to include gap verification — Implementer confirms 2-3 key gaps before implementing
- **Appendix:** Added Leaf Execution Protocols reference (Protocol_Informed.md, Protocol_Autonomous.md)

**Amendments Origin:** Trunk v9 Segment A execution where Implementer discovered 90% of directive scope was already implemented due to Librarian false negatives.

### v8.5 (February 2026)

Practice-driven revision synchronized with Compact Protocol v1.4. Based on reflective analysis of 10+ operational sessions.

**Key Insight:** The high-leverage optimization point is handoff quality between sessions, not context management within sessions.

**Major Changes:**
- Replaced GPS-style Handoff Report with Semantic Handoff format
- Pre-scan and Librarian Discovery Protocol with Complexity Gate
- Binary coordinator decision model for context management

### v8.4 (January 2026)

- Pre-flight Discovery Protocol (Experimental)
- Specialized Leaf Roles (Implementer, Librarian)
- Discovery Tax Management documentation

### v8.3 (January 2026)

Initial version with two-tier agentic architecture, Figma MCP integration protocols, and comprehensive safety systems.

---

*This methodology serves as the authoritative operational reference for all Trunk and Leaf sessions in the Restaurant Guide project. It establishes the two-tier agentic architecture enabling efficient collaboration between strategic planning and autonomous execution.*

**Synchronization Requirement:** This document must exist in both Claude Project Instructions (for Trunk session runtime access) and the Git repository docs/ directory (for Leaf session reference). Updates to either location must be synchronized immediately.
