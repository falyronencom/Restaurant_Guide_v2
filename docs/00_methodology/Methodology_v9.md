# Distributed Intelligence Methodology v9.4

**Version:** 9.4
**Date:** April 2026
**Status:** Active Operational Standard
**Core Paradigm:** Co-Creative Partnership Between Human Coordination and Autonomous Agents

---

## Part 0: Operational Kernel

*This is your pre-flight orientation. These protocols represent the shared agreements that keep the co-creative process coherent. Everything beyond this section is reference material — consult when the situation calls for it.*

---

### The Eight Protocols

**Protocol 1 — Thinking and Action Have Different Homes**

Trunk thinks and plans (browser). Leaf builds and tests (CLI). Each environment enables what the other cannot: Trunk has strategic breadth without codebase access; Leaf has direct code interaction without strategic memory. The Coordinator bridges them — routing artifacts, providing operational context, and applying human judgment where neither environment alone is sufficient.

**Protocol 2 — Reality Before Plan**

Before creating an implementation directive, verify the actual state of code. Standard flow: Trunk formulates Discovery Directive (targeted questions) → Librarian investigates codebase → Discovery Report (verified answers) → Trunk creates Informed Directive grounded in facts.

Verification standard: a finding of "NOT FOUND" is valid only after semantic reading of the relevant entry point — keyword search alone is insufficient to confirm absence.

Skipping Pre-flight Discovery means Trunk plans on assumptions, and Implementer spends 50-80% of context rediscovering reality. For simple ad-hoc tasks that don't require Trunk involvement, use Mode B directly (see Protocol 6).

**Protocol 3 — Artifacts Pass Through Unaltered**

All technical artifacts — Discovery Directives, Discovery Reports, Informed Directives, Semantic Handoffs — pass through the Coordinator without editing, filtering, or summarizing their content. The Coordinator's contribution is different in nature: routing artifacts to the correct recipient, appending operational context from the environment ("backend returns error X", "emulator shows Y"), and making strategic decisions about next steps. The artifact itself remains as created by its author.

**Protocol 4 — Transfer Understanding, Not Coordinates**

When a session ends with incomplete work, the Semantic Handoff must transfer *why* the problem exists (Problem Model), *what was confirmed* (Verified Facts), and *what was ruled out* (Eliminated Hypotheses). This is the difference between giving someone a map pin and explaining the terrain. Without Problem Model and Eliminated Hypotheses, the next session re-discovers what was already known — a system failure in collective memory.

Mandatory sections: Problem Model, Verified Facts, Eliminated Hypotheses, Current State, Continuation Point.

**Protocol 5 — Trust the Signal**

The Coordinator often senses when a session is approaching its productive limit before explicit indicators confirm it. This intuition is a valid signal and should be acted on immediately — not deferred for "one more message."

Observable patterns that reinforce this signal: rising uncertainty in agent responses, repetition of previously attempted approaches, increasing ambiguity in proposed solutions. When any of these appear, or when the Coordinator's instinct says "it's time" — initiate handoff without delay.

**Protocol 6 — Three Ways to Launch an Implementer**

Every Implementer session begins in one of three modes. The Coordinator's decision follows one question and one empirical measurement:

*Do I have a Discovery Report (or Discovery Directive) for this task?*

No → **Mode B (Autonomous Execution).** Implementer receives task description from Coordinator. Performs full cycle: Pre-scan → Discovery → Planning → Implementation. Context-intensive — agent builds understanding independently. For complex tasks (5+ files, 3+ modules), consider pausing and escalating to Trunk for proper Pre-flight Discovery.

Yes → **Mode C (Unified Execution) is the default path.** The session starts as Librarian (with Directive Coherence Check — Step 0), performs investigation, delivers Discovery Report, receives Informed Directive from Trunk, and continues as Implementer. After Discovery Report delivery, the Coordinator checks `/context`. If context consumption is within normal range (< 25% for Low-Medium tasks at 1M), the session continues. The agent retains full context from discovery — no re-reading, no orientation phase. Key caution: preserved context from Librarian phase creates an "already know" effect — the agent must maintain critical attitude toward its own findings.

Mode A escalation → **Mode A (Informed Execution)** is activated when the Context Checkpoint after Discovery reveals anomalous consumption (> 40%), signaling High+ complexity where Cognitive Tax may degrade implementation quality. Also activated when independent double-verification is critical: production-breaking changes, data-loss migrations, security-sensitive code — where fresh eyes on the Discovery Report catch what the "already know" effect may miss. In Mode A, a new Implementer session receives Informed Directive + Discovery Report and performs Quick Sanity Check before implementation.

This inverts the previous logic: instead of "estimate complexity → choose mode → launch," the flow is "launch Mode C → measure reality → escalate if needed." This mirrors Protocol 2 (Reality Before Plan) applied to the process itself.

**Protocol 7 — Recognize When a Session Has Lost Its Way**

Three escalating signals: repeated proposal of similar solutions (early warning — review what's happening), fixes that introduce new problems (critical — prepare to end session), contradictory patterns emerging in code (critical — stop immediately).

A degraded session cannot recover by trying harder. The productive response: commit current state with WIP label, generate a Semantic Handoff with thorough Eliminated Hypotheses, and start a fresh session with clean context. The next session, armed with a quality handoff, typically resolves the problem more efficiently.

**Protocol 8 — Strategic Continuity Across Trunk Sessions**

Trunk sessions have finite context, just like Leaf sessions. The strategic thread must be preserved explicitly. Two transfer mechanisms serve different purposes:

**Continuation Handoff** is used when the next session continues the strategic thread (Component N → Component N+1). It carries architectural decisions, context, priorities, and open questions. This is the coupling between train cars — each main Trunk session is a car in the train (the project).

**Task Brief** is used for self-contained sessions that serve the project but don't continue the strategic thread. It carries only the minimum context needed for the specific task. Examples: methodology update (receives insight text), documentation hygiene (receives standard checklist), parallel brainstorm session (receives specific questions), ad-hoc fixes (receives bug description). A Task Brief is typically 5-15 lines vs 50-80 lines for a full Handoff — the cognitive tax difference is significant.

**Decision criterion:** Does the next session need to understand the strategic trajectory of the project, or does it need to accomplish a specific bounded task? If strategic trajectory → Continuation Handoff. If bounded task → Task Brief.

*When closing a Trunk session:*
1. Update Project Status Briefing (current state of the project — what works, what's in progress)
2. Create Continuation Handoff or Task Brief(s) as needed for planned next sessions

*When opening a new Trunk session:*
1. New Trunk reads updated Project Status Briefing automatically from Instructions
2. Coordinator provides the Continuation Handoff from the previous session (or Task Brief if the session is bounded)
3. Trunk orients, confirms understanding, and continues the strategic thread

---

### Coordinator's Session Checklists

#### Starting a Trunk Session

- [ ] Previous Continuation Handoff or Task Brief ready to provide (see Protocol 8 for selection criteria)
- [ ] Project Status Briefing in Instructions reflects current state
- [ ] Are business decisions crystallized, or is Pre-flight Conceptual Resolution needed? (see §1.2.1)
- [ ] Clear objective for this session (what strategic work needs to happen)

#### Starting a Leaf Session

- [ ] Path decided: **Mode C** (default — Discovery Directive exists) or **Mode B** (ad-hoc task, no Trunk) or **Mode A** (pre-selected for critical double-verification)
- [ ] Active paradigm confirmed: **Flutter mobile**, not web
- [ ] Git working directory clean (`git status` — no uncommitted changes)
- [ ] Backend / emulator running in Coordinator's terminal (not in agent's context)
- [ ] Effort level set: `/effort [level]` per role table:

| Role / Mode | Effort Level |
|-------------|-------------|
| Mode C — Librarian phase | Max |
| Mode C — Implementer phase | High |
| Implementer Mode A | High |
| Mode B — discovery phase | Max |
| Mode B — implementation phase | High |
| Simple fixes | Medium |

- [ ] Launch package prepared:
  - *Mode C (default):* Discovery Directive from Trunk + Protocol_Unified.md (Informed Directive provided mid-session after Discovery Report)
  - *Mode A:* Informed Directive + Discovery Report + Protocol_Informed.md
  - *Mode B:* Task description + Protocol_Autonomous.md + previous Semantic Handoff (if continuation)
- [ ] Context Checkpoints planned: after Discovery Report delivery, after each Implementation Segment

#### Closing a Trunk Session

- [ ] Project Status Briefing updated with current state
- [ ] Continuation Handoff and/or Task Briefs created for planned next sessions (see Protocol 8)
- [ ] Any methodology or documentation changes noted for synchronization
- [ ] Documentation Hygiene Checkpoint needed? (phase completed / transient artifacts accumulating)

---

### Continuation Handoff Format

Used when the next session continues the strategic thread (see Protocol 8).

```markdown
# Trunk Handoff: Session [N] → Session [N+1]

## Session Accomplishments
- [What was planned, analyzed, or decided]
- [Directives created and their status]

## Key Decisions
- [Decision]: [rationale]

## Current Project Focus
[What the project is actively working on]

## Recommended Next Priorities
1. [Most important strategic task]
2. [Secondary task]

## Open Questions (if any)
- [Unresolved question for future consideration]
```

Task Brief format: see §1.4 Artifact Formats.

---

### Quick Orientation: The Co-Creative Roles

| Participant | Environment | Contributes | Relies on Others For |
|-------------|-------------|-------------|----------------------|
| **Trunk** | Browser (Claude.ai) | Strategic vision, directive creation, cross-session analysis | Current codebase state (via Discovery Reports) |
| **Librarian** | CLI (Claude Code) | Codebase investigation, verified facts, navigation maps | Focused questions (via Discovery Directive) |
| **Implementer** | CLI (Claude Code) | Code creation, testing, integration, problem-solving | Strategic direction (via Directives), verified starting point (via Discovery Report) |
| **Coordinator** | Both | Human judgment, artifact routing, operational context, intuitive signals | Technical execution (via Leaf agents), strategic analysis (via Trunk) |

---

*End of Operational Kernel. Everything below is reference material for specific situations.*

---
---

## Part I: Operational Workflows

*This is the flight manual. It details the procedures, artifact formats, and safety practices that support the Kernel's protocols. Read the relevant section at session start, or consult when handling non-routine situations.*

---

### 1.1 Role Details

#### Trunk: The Strategic Partner

Trunk operates in the Claude.ai Project Interface (browser), maintaining global context and long-term architectural vision. Trunk's contributions include analyzing session reports and accumulated project knowledge, formulating Discovery Directives for Pre-flight investigation, creating Informed Directives based on Discovery Reports, coordinating cross-domain integration and phase transitions, evolving methodology based on operational learnings, and managing project documentation and specifications.

Trunk works with strategic breadth rather than codebase detail. It does not write implementation code directly and relies on Discovery Reports for current code state. Directives focus on *what* needs to be accomplished and *why*, leaving *how* to the Implementer's judgment and direct codebase access.

#### Leaf Roles: Librarian and Implementer

Leaf sessions operate in VS Code Terminal via Claude Code Extension, with direct access to the codebase. Two specialized roles serve different purposes, and role specialization enables context-efficient workflows by separating investigation from implementation.

**Librarian** is a role focused exclusively on codebase investigation. The Librarian reads files, traces data flows, and produces a Discovery Report that serves both Trunk (for directive creation) and Implementer (for navigation). Key properties: the Librarian does not write code or make commits, and the Coordinator transfers the Discovery Report to both Trunk and Implementer following Protocol 3 (Pass-Through). In Mode C (default), the Librarian role is the first phase of a unified session that continues as Implementer. In standalone use, the Librarian is launched as Phase 2 of Pre-flight Discovery (see Section 1.2) and context is disposable.

**Implementer** is the standard Leaf role for code execution. The Implementer reads the codebase, creates and edits files, runs tests for verification, iterates autonomously on failures, and commits changes to Git with descriptive messages. Operates in Mode C (unified, default), Mode A (informed, separate session), or Mode B (autonomous) as described in Protocol 6 and detailed in Section 1.3.

#### Coordinator: Practices and Patterns

The Coordinator bridges Trunk and Leaf environments, contributing human judgment that neither AI participant can provide independently.

**Strategic Vision Keeping** means maintaining long-term architectural coherence across sessions, ensuring individual session outputs align with overall project direction, and making final decisions when agent proposals conflict with project principles.

**Context Bridging** involves transferring Discovery Directives from Trunk to Librarian, Discovery Reports from Librarian to Trunk, and Informed Directives from Trunk to Implementer — managing the information flow between systems with different interfaces and capabilities, always following Protocol 3.

**Safety Oversight** requires approving or rejecting file operations proposed by Leaf agents, validating that proposed changes align with project intent before execution, and ensuring backups exist before complex refactoring operations.

**Resource Management** encompasses monitoring context utilization across sessions, planning session continuity and handoffs, and selecting appropriate tools (Trunk vs Leaf, browser vs CLI) based on task requirements.

**Scope Authority** means authorizing proactive scope extension when Leaf identifies high-value opportunities beyond strict directive boundaries (see Section 1.3 on Proactive Scope Extension).

**Proactive Information Provision** is an observed operational pattern where the Coordinator provides relevant information (log fragments, test results, infrastructure status) without waiting for Leaf to request it. This reflects the Coordinator's real-time visibility into systems that Leaf cannot access — particularly when processes run in the Coordinator's terminal (see Kernel checklist: "Backend / emulator running in Coordinator's terminal").

**Observed Initiative Distribution** across the co-creative system:

| Action | Typical Initiator |
|--------|-------------------|
| Provide logs after failed test | Coordinator (proactive) |
| Request infrastructure status | Leaf |
| Signal scope mismatch | Leaf |
| Signal handoff needed | Coordinator |
| Subagent discovery (Mode B) | Leaf (autonomous) |
| Complexity assessment | Joint |

---

### 1.2 Pre-flight Discovery in Detail

Pre-flight Discovery implements Protocol 2 (Reality Before Plan). This section provides the detailed procedures for each phase.

#### The Four Phases

**Phase 1 — Discovery Directive (Trunk → Coordinator → Librarian)**

Trunk formulates a Discovery Directive — a compact document with 5-10 targeted questions about the current state of code (see Section 1.4 for format). This is not an implementation directive but focused guidance for investigation. The Coordinator transfers the Discovery Directive to a new Librarian session.

**Phase 2 — Investigation (Librarian)**

The Librarian investigates the codebase, answering each question with concrete evidence (file:line, code snippets, or NOT FOUND). The Librarian adds an "Additional Findings" section for relevant discoveries beyond the questions and forms a "Navigation for Implementer" section with file paths, data flow, and reading order. The session produces a Discovery Report (see Section 1.4 for format) and then closes — Librarian context is disposable.

**Phase 3 — Informed Directive (Coordinator → Trunk)**

The Coordinator transfers the Discovery Report to Trunk session following Protocol 3. Trunk analyzes the answers and creates an Informed Directive — a directive grounded in verified facts rather than architectural assumptions.

**Phase 4 — Informed Execution (Implementer)**

The Implementer receives the Informed Directive plus Discovery Report and proceeds according to Mode A (see Section 1.3).

**Information Flow:**

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

#### When Pre-flight Discovery is Not Required

Pre-flight Discovery is the standard flow for all Trunk directives. However, for simple tasks that the Coordinator resolves directly with Leaf without involving Trunk, use Mode B (Autonomous Execution) — see Section 1.3. The Coordinator's judgment determines when a task is straightforward enough for Mode B versus when the strategic grounding of Pre-flight Discovery is warranted.

#### Discovery Beyond Code

Pre-flight Discovery's value extends beyond codebase investigation. Any resource that requires "coordinates" for autonomous access benefits from Librarian collecting those coordinates in advance. Figma frame nodeIds are GPS coordinates for design, just as file paths are GPS coordinates for code. When a feature involves external resources (Figma designs, API endpoints, configuration files), the Discovery Directive should include investigation questions that collect access coordinates for the Implementer. This transforms resources that would otherwise require Coordinator mediation into autonomously accessible assets.

#### 1.2.1 Pre-flight Conceptual Resolution

Pre-flight Discovery resolves uncertainties about *code state*. Pre-flight Conceptual Resolution resolves uncertainties about *business decisions*. Both feed into Trunk, which synthesizes facts and decisions into an Informed Directive.

```
Pre-flight Discovery:       Trunk → Discovery Directive → Librarian → code facts
Conceptual Resolution:      Coordinator → brainstorm session → business decisions

Both feed into Trunk → Informed Directive (synthesizes facts + decisions)
```

**Rationale:** Business-conceptual work ("what do we want?") and operational-architectural work ("how do we build it?") require different modes of thinking. When both arrive at Trunk simultaneously, cognitive competition degrades both. Separating them into dedicated spaces allows each to receive full attention. This extends the Cognitive Tax framework (§1.5) — conceptual tax is a third distinct type alongside navigational and intellectual. See §1.5 for the complete taxonomy.

**Trigger:** The Coordinator arrives at Trunk with open questions about the same feature — formulations like "I was thinking about this as..." or "there could be another option." Business decisions are still fluid.

**Output:** A **Business Brief** — a compact document (1-3 pages) with decisions as table (parameter → decision → rationale), lifecycle rules, UI/UX sketches if relevant, phasing, and explicit "open questions deferred to later."

**Empirical validation:** Component 4 (Promotions, v9.4). Business Brief → Discovery Report → Informed Directive with zero ambiguity, zero mid-implementation clarification requests.

---

### 1.3 Execution Cycle Details

This section details the phase sequences for all three execution modes described in Protocol 6.

#### Mode A: Informed Execution

Activated when the Implementer receives an Informed Directive plus Discovery Report from Trunk.

**Phase sequence:** Quick Sanity Check → Planning → Implementation → Delivery

**Quick Sanity Check** (not a full Pre-scan) serves to confirm that conditions haven't changed since the Discovery Report was created. The Implementer checks whether files from the Navigation section still exist and weren't modified, verifies no new commits that might affect the task, and confirms integration points are still as described. Additionally, for each item marked as "missing" or "gap" in the Discovery Report that drives implementation scope, the Implementer performs a targeted read of the relevant code section (e.g., build() method for UI gaps) to confirm the gap exists before implementing. Proportional verification means checking the 2-3 highest-impact gaps that determine the largest portion of implementation work — full re-verification of all findings is not required, as that would duplicate the Librarian's role. If the Sanity Check reveals significant changes or that a key gap does not exist, the Implementer signals to the Coordinator before proceeding.

**Planning and Approval** involves the Implementer proposing an implementation plan in plain language, including files to create or modify, approach, and potential risks. The Navigation section from the Discovery Report serves as the primary map. The Coordinator validates that the plan makes logical sense before granting execution permission.

**Implementation and Local Verification** is where the Implementer creates and edits files according to the approved plan, runs code or tests (flutter test, npm test, etc.) to verify syntax and logic, and iterates autonomously if tests fail using accumulated troubleshooting knowledge. This continues until tests pass or a blocking issue is identified.

**Delivery** means the Implementer runs git commit with a message referencing the directive origin. If the session ends with incomplete work, the Implementer generates a Semantic Handoff (see Section 1.4). If the task is completed, a Completion Report is generated instead.

#### Mode B: Autonomous Execution

Activated when the Coordinator initiates an ad-hoc task directly with Leaf, without a Trunk directive.

**Phase sequence:** Pre-scan → Discovery → Planning → Implementation → Delivery

**Pre-scan** involves the Implementer launching 2-3 targeted Explore subagents to create a mini-Discovery Map: mapping all files related to the task domain, tracing data flow from entry point to endpoint, and listing all providers or services interacting with the component. Cost is approximately 2-5% of context, providing data to assess task complexity.

**Complexity Assessment** after Pre-scan:

| Pre-scan Result | Decision | Rationale |
|----------------|----------|-----------|
| 2-3 files, single module | Proceed in main context | Discovery will be manageable |
| 4-6 files, two modules | Proceed with caution | Monitor discovery cost |
| 5+ files, 3+ modules | Signal to Coordinator | Consider escalating to Trunk for Pre-flight Discovery |

**Discovery (Read-Only)** uses the Pre-scan map to read relevant files and build understanding. Focus main context on *understanding*, not *finding*. Pre-scan and Discovery can overlap — validate assumptions while simultaneously reading relevant files. The essential discipline: do not write code until the landscape is understood.

**Planning, Implementation, and Delivery** follow the same procedures as Mode A.

#### Mode C: Unified Execution (Default Path)

**Mode C is the default execution path** when a Discovery Directive exists. The decision to use Mode C is not made upfront based on complexity estimates — the session starts as Mode C, and the Coordinator decides whether to escalate to Mode A based on empirical context measurement after Discovery.

Introduced in v9.2 based on the Twin Task experiment. Elevated to default in v9.3 based on empirical data from Partner Analytics session, which demonstrated that at 1M context, Discovery + full Implementation consistently fits within a single session for Low-Medium complexity tasks.

**Phase sequence:** Directive Coherence Check (Step 0) → Discovery (as Librarian) → Discovery Report → Context Checkpoint → *pause for Trunk* → Receive Informed Directive → Continuity Check → Planning → Implementation → Delivery

**Directive Coherence Check (Step 0)** is performed before investigation begins. The agent analyzes the Discovery Directive for internal coherence: Mission↔Questions coverage, search scope completeness, absence verification instructions, and cross-question gaps. Findings are reported to Coordinator with proposed additions before proceeding. For simple directives (2-3 questions, single module), this step is skipped. Full protocol in Protocol_Unified.md Section 2.

**Discovery (as Librarian)** follows the standard Librarian protocol — investigating the codebase, answering Discovery Directive questions, and producing a Discovery Report. The agent operates under Librarian constraints: no file modifications, no commits. Discovery Report is delivered to the Coordinator for transfer to Trunk.

**Context Checkpoint** is the empirical decision point. The Coordinator requests `/context` after Discovery Report delivery. If context consumption is within normal range (< 25% at 1M for Low-Medium tasks), the session continues as Implementer. If consumption is anomalous (> 40%), this signals High+ complexity where Cognitive Tax may degrade implementation quality — the Coordinator considers transitioning to Mode A. Context measurement is recorded in the session's final report for calibration data.

**Pause for Trunk:** The session waits while the Coordinator transfers the Discovery Report to Trunk and receives back an Informed Directive.

**Continuity Check** replaces Mode A's Quick Sanity Check. Since the agent just completed discovery in the same session, full re-verification is unnecessary. Instead, the agent runs `git status` and `git diff` to confirm the working directory is unchanged since the Librarian phase. If no changes detected — proceed with implementation using the full context from discovery. If changes detected — re-read affected files before continuing.

**Planning, Implementation, and Delivery** follow Mode A procedures. The key difference: the Informed Directive serves not as a "map of territory" (the agent already knows the territory from its own investigation) but as a **checklist and scope limiter** — "do this, don't touch that." The Navigation section of the Discovery Report is already internalized.

**When Mode A is activated instead:**

| Trigger | Rationale |
|---------|-----------|
| Context Checkpoint > 40% after Discovery | High Cognitive Tax — fresh session preserves implementation quality |
| Production-breaking changes, data-loss migrations | Independent double-verification catches what "already know" effect may miss |
| Security-sensitive code modifications | Fresh eyes on Discovery Report provide structural safety |

#### Proactive Scope Extension

When the Implementer identifies high-value opportunities beyond strict directive scope: if value is clear and effort is small, proceed; document the extension and rationale in the session report; and the Coordinator validates the extension post-hoc. This encourages initiative while maintaining accountability.

---

### 1.4 Artifact Formats

This section collects all artifact templates used in the co-creative workflow.

#### Standard Directive Format

Since the Leaf can read the codebase directly, directives focus on intent and constraints rather than exhaustive specifications. Trust Leaf competence for implementation details.

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

**Context-Aware Sizing:** Standard features (CRUD operations, established patterns) fit in 1-2 pages. Complex features (new patterns, significant integration) need 2-3 pages. Architectural initiatives (system-wide changes) should not exceed 3-4 pages. Brevity is intentional — Leaf discovers details autonomously, and for Informed Directives the Librarian has already mapped the territory.

#### Informed Directive

An Informed Directive is a standard directive created by Trunk after receiving a Discovery Report. It follows the same format but is grounded in verified facts rather than architectural assumptions, and is marked accordingly:

```
DIRECTIVE: [Feature Name]
Based on: Discovery Report [date]
```

Trunk includes from the Discovery Report specific files for modification (from the Navigation section), existing patterns to follow (from Additional Findings), known constraints and risks, and integration points with current code. Trunk does not copy full answers to questions or the reading order — the Implementer receives the Discovery Report separately.

#### Discovery Directive Format

A Discovery Directive is a compact artifact for Pre-flight Discovery. It guides investigation, not implementation.

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

## Peripheral Scan

QP1: [Test coverage question — what tests cover the affected area?]
Search in: [test directories]

QP2: [Adjacent module question — what neighboring modules might be affected?]
Search in: [related paths]

QP3: [Seed/fixture question — do test fixtures or seed data need updating?]
Search in: [seed/fixture paths]

QP4: [PROJECT_MAP.md navigation — what does the map say about this module's flow?]
Search in: PROJECT_MAP.md

[3-5 peripheral questions total]

## Discovery Report Format
[Template for Librarian to follow — ensures consistent output structure]

## Constraints
- Do NOT modify any files
- Do NOT create commits
- Do NOT implement solutions
- Do NOT estimate implementation effort (that is Trunk's responsibility)
- ONLY investigate and document findings
```

**Complexity Estimate** indicates scope in terms affecting session planning: Low means 2-3 files within a single module, Medium means 4-6 files across two modules, and High means 5+ files spanning 3+ modules requiring cross-layer investigation.

**Question Design Principles:** Each question should be binary-answerable (found with details, or NOT FOUND), include WHERE to search (specific paths, grep patterns), and address one specific uncertainty.

Well-crafted questions look like: "Is `geolocator` package in `mobile/pubspec.yaml`? If yes, provide version." Or: "Does `EstablishmentsProvider` have fields for user coordinates? Check `mobile/lib/providers/establishments_provider.dart`." Or: "Where is distance '0.3 km' hardcoded in UI? Search in `mobile/lib/screens/` and `mobile/lib/widgets/`. Provide file, line number, and 5 lines of surrounding code."

Questions to avoid: "How does geolocation work?" (too open-ended), "Is the code good?" (subjective), "What should we implement?" (that's Trunk's job), "Tell me everything about the search system" (no focus).

**Peripheral Scan** is a mandatory section of the Discovery Directive (introduced in v9.2). It extends investigation beyond the direct task scope to identify tests covering the affected area, adjacent modules that might be impacted, seed/fixture data requiring updates, and PROJECT_MAP.md navigation hints. The Peripheral Scan was validated by the Twin Task experiment, where it excluded unnecessary work (admin panel already ready, seed data already present, migration not needed) and included necessary work (test on line 415 listing all categories). Without Peripheral Scan, the Informed Directive would have been either broader (including unnecessary edits) or incomplete (missing test updates).

**Gap Verification:** For any investigation question where the answer determines whether implementation work is needed (e.g., "does screen X handle error states?"), the Librarian verifies by reading the complete build() method or equivalent entry point — not only by searching for expected keyword patterns. Code may implement expected behavior through patterns different from those specified in the search guidance. Keyword search identifies known patterns; semantic reading identifies any pattern.

#### Discovery Report Format

The Discovery Report serves two audiences: Trunk (for creating the Informed Directive) and Implementer (for navigation coordinates).

```markdown
# Discovery Report: [Task Name]

## Answers to Discovery Questions

Q1: [Question from Discovery Directive]
→ [Answer with concrete evidence: file:line, code snippet, or NOT FOUND]

Q2: [Question]
→ [Answer with evidence]

...

## Additional Findings

- [Relevant discovery beyond the questions]
- [Potential risk or constraint discovered]
- [Existing pattern worth noting]
- [Dependency that might be affected]

## Navigation for Implementer

### Relevant Files
- [path]: [role in the task — 1 line]

### Data Flow
[Component A] → [Component B] → [Component C]
Key transformation point: [where data changes shape or format]

### Recommended Reading Order
1. [file] — start here because [reason]
2. [file] — then this for [reason]
3. [file] — finally [reason]
```

| Section | Audience | Purpose |
|---------|----------|---------|
| Answers to Questions | Trunk | Informs directive creation |
| Additional Findings | Trunk + Implementer | Risks and context for both |
| Navigation for Implementer | Implementer | Coordinates for quick start |

The Coordinator transfers the entire document to both recipients without editing (Protocol 3). Trunk focuses on the first two sections; Implementer focuses on the last.

**Absence Verification Confidence:** When a finding determines that something is "missing," "absent," or "NOT FOUND," and this absence directly creates implementation scope, the Librarian indicates how the absence was verified: **KW (Keyword Search)** means the finding is based on pattern/keyword search only, which is acceptable for presence checks but insufficient for absence claims that drive implementation. **SR (Semantic Read)** means the finding was confirmed by reading the complete relevant code section (e.g., full build() method, entire service class), and this is required for any absence claim that determines implementation scope.

**Length:** 20-40 lines. The Discovery Report provides GPS coordinates, not a codebase tour.

#### Semantic Handoff Format

The Semantic Handoff transfers understanding when a session ends with incomplete work (Protocol 4).

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

Problem Model, Verified Facts, Eliminated Hypotheses, Current State, and Continuation Point are mandatory. Dependency Graph and Semantic Anchors are recommended — they provide structural navigation and immediate vocabulary for the problem domain. Manual Semantic Handoff is always preferred over auto-compact for session transitions.

**The Fresh Session Effect:** When a session reaches its limit with an unresolved problem, the next session typically resolves the problem using less context — but only when the Semantic Handoff quality is sufficient. GPS-style handoffs (files modified, next action) do NOT produce this effect; Semantic Handoffs with Problem Model and Eliminated Hypotheses do.

**Length:** 25-50 lines. Longer than GPS-style handoffs, but the investment pays for itself in reduced rediscovery for the next session.

#### Completion Report Format

For tasks that finish successfully, a brief Completion Report replaces the Semantic Handoff. The Semantic Handoff is a tool for transferring unfinished understanding — it should not be used for successfully completed tasks.

```markdown
# Completion: [Task Name]

## Changes Made
- [File]: [what was done]

## Commit Reference
[commit hash and message]

## Notes for Future Work (optional)
- [Any observations relevant to future work in this area]

## Process Reflection (optional — for experimental or non-standard sessions)
- Cognitive load assessment: [how demanding was the task on focus and working memory]
- Positive/negative transfer between phases: [did earlier phases help or hinder later ones]
- Mode recommendation for similar tasks: [Mode A / B / C and why]
```

**Process Reflection** is not required for every session. It is recommended when the Coordinator wants to calibrate methodological decisions — for example, after using a new mode, after an unusually complex task, or when comparing approaches. The reflection helps build empirical evidence for mode selection over time.

#### Checkpoint Report Format

For mid-session checkpoints during multi-session work (see Section 1.5):

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

#### Task Brief Format

A Task Brief is a lightweight inter-session transfer for self-contained tasks that don't continue the strategic thread (see Protocol 8). It carries only the minimum context needed, avoiding cognitive overload from irrelevant strategic context.

```markdown
# Task Brief: [Task Name]

## Context
[2-3 sentences: why this task exists and what triggered it]

## Specific Input
[The actual content needed — insight text, checklist, questions,
bug description. This is the payload.]

## Expected Output
[What the session should produce]

## Constraints (if any)
[Boundaries or things to avoid]
```

**Length:** 5-15 lines. Contrast with Continuation Handoff (50-80 lines). The receiving agent processes only what it needs.

**Examples of Task Brief use:** methodology update (receives insight text), documentation hygiene checkpoint (receives standard checklist), parallel brainstorm session (receives specific questions), ad-hoc operational fixes (receives bug description).

---

### 1.5 Session Management

#### Trunk Session Lifecycle

Trunk sessions follow a three-phase lifecycle that ensures strategic continuity across the project's development arc.

**Opening Phase:** The new Trunk session reads the Project Status Briefing from Project Instructions (this happens automatically as part of the project context). The Coordinator provides the Continuation Handoff from the previous session (or a Task Brief if the session is bounded — see Protocol 8). Trunk orients by confirming understanding of current project state, reviewing key decisions from the previous session, and identifying the strategic work ahead. This orientation can be brief — a few sentences confirming readiness — or detailed if the handoff raises questions.

**Working Phase:** Trunk performs its strategic contributions: analyzing Discovery Reports, creating directives, evolving methodology, coordinating cross-domain integration. Throughout this phase, the Coordinator monitors context usage. Trunk sessions are subject to the same context limitations as Leaf sessions, though they tend to be more efficient since they don't perform codebase discovery.

**Closing Phase:** Before ending, the Trunk session updates the Project Status Briefing with the current state of the project and creates a Continuation Handoff and/or Task Briefs as needed (see Kernel, Protocol 8 for formats and selection criteria). Any methodology or documentation changes are noted for synchronization between Project Instructions and Git repository.

#### Session Planning and Complexity Calibration

Before each Leaf session, estimating expected complexity helps in choosing the right execution mode and planning for session continuity.

| Category | Indicators | Typical Context Usage (Mode B) |
|----------|------------|--------------------------------|
| Low | 2-3 files, single module, established pattern | 30-50% |
| Medium | 4-6 files, two modules, minor integration | 50-70% |
| High | 5+ files, 3+ modules, cross-layer changes | 70-90% |

For High complexity tasks, consider Multi-Session Segmentation — but at 1M context, the reasons for segmentation have fundamentally changed (see below).

#### Multi-Session Work (Checkpoint Continuation Protocol)

For complex phases requiring multiple Leaf sessions, the Checkpoint Continuation Protocol provides structured segmentation.

**Segmentation rationale at 1M context:** With 200K context, segmentation was a survival necessity — Discovery + Implementation physically did not fit in one session for Medium+ tasks. With 1M context, the navigational constraint is largely eliminated. Segmentation becomes an **architectural choice**, not a forced measure. Valid reasons to segment at 1M:

| Reason | Example | Why it matters |
|--------|---------|---------------|
| Independent verification between layers | Backend → curl test → Mobile | Catches integration issues before building on them |
| Different technology stacks | Node.js backend → Flutter mobile | Different "cognitive mode" benefits from fresh context |
| Strategic review point | Trunk analyzes Segment A before formulating Segment B | Coordinator maintains architectural control |
| Empirical: Context Checkpoint > 50% | `/context` shows high consumption mid-task | Cognitive Tax risk — fresh session for remaining work |

If the **only** reason for segmentation is "won't fit in context," at 1M this reason almost always disappears. If the reason is quality-driven (verification, review, cognitive mode switching), segmentation is justified regardless of context availability.

**Session Execution Header** (added to directives for multi-session work):

```markdown
---
## Execution Mode: Multi-Session Roadmap

**Total Segments:** [N]
**Current Segment:** [A / B / C / ...]
**Assigned Phases:** [List specific phases for this segment]
**Segmentation Rationale:** [Why this task is segmented — verification / stack switch / strategic review]

### Segment Execution Rules

1. **Scope Discipline:** Execute ONLY phases assigned to current segment.
2. **Continuation Awareness:** If segment B or later, read previous Semantic Handoff FIRST.
3. **Naming Consistency:** Use EXACTLY the names specified in directive and previous reports.
---
```

**Segmentation guidance:**

| Complexity | Segments | Phases per Segment |
|------------|----------|-------------------|
| Medium-High | 2 | 3-4 phases each |
| High | 2-3 | 2-4 phases each |
| Very High | 3+ | 2-3 phases each |

#### Context Management Patterns

**Discovery Tax** is the context consumed by codebase investigation before implementation begins. It has two distinct components that behave differently as context windows scale:

**Discovery Tax (Navigational)** — tokens spent on finding and reading files, mapping directory structure, locating entry points. In Mode B sessions with 200K context, this consistently amounts to 50-80% of available context. With 1M context, this component ceases to be a critical constraint — the same navigational work consumes only 10-16% of available context.

**Cognitive Tax (Intellectual)** — cognitive resources spent on holding discovered relationships, patterns, and dependencies in active focus. This component does not scale with context window size — it depends on the inherent complexity of the code being analyzed, not the amount of context available. A session analyzing 20 interconnected files experiences the same Cognitive Tax whether the context window is 200K or 1M.

**Conceptual Tax (Business-Decisional)** — cognitive resources spent on resolving uncrystallized business decisions within a strategic session. When the Coordinator arrives at Trunk with open questions about subscription models, feature lifecycles, or pricing, Trunk must simultaneously resolve "what do we want?" and "how do we build it?" This creates cognitive competition between business-conceptual and operational-architectural work. Pre-flight Conceptual Resolution (§1.2.1) addresses this by giving business decisions a dedicated resolution space before Trunk begins architectural planning.

The three taxes form a complete taxonomy of cognitive costs in the co-creative system:

| Tax Type | Where It Occurs | Addressed By |
|----------|----------------|-------------|
| Navigational | Leaf (finding code) | Pre-flight Discovery |
| Intellectual | Leaf (holding complexity) | Mode A escalation |
| Conceptual | Trunk (unresolved business questions) | Pre-flight Conceptual Resolution |

In Mode A (classic protocol), the Librarian absorbs navigational and intellectual taxes, and the Implementer begins with full cognitive capacity in a clean session. In Mode C (unified), the navigational tax transforms into an advantage (the agent already "knows" the territory), but the Cognitive Tax persists in the session. This distinction is the primary factor when choosing between continuing in Mode C and escalating to Mode A at the Context Checkpoint.

Pre-flight Discovery addresses navigational and intellectual taxes structurally — the Librarian pays them in disposable context, and the Implementer receives compressed results. In Mode C, navigational tax is paid once and retained as an asset; Cognitive Tax is the factor to monitor. Pre-flight Conceptual Resolution addresses conceptual tax at the Coordinator/Trunk boundary — the brainstorm session pays it in a separate context, and Trunk receives crystallized decisions.

#### Context Checkpoints (Standard Practice)

Context Checkpoints replace intuitive context management with data-driven decisions. The Coordinator requests `/context` at three defined points:

1. **After Discovery Report delivery** — decides Mode C continuation vs Mode A escalation
2. **After each Implementation Segment** — decides whether to continue in the same session or open a new one
3. **After task completion** — calibration data for methodology tables

Each measurement is recorded in the session's final report (Completion Report or Semantic Handoff) as Context Telemetry. Over time, accumulated measurements refine the calibration tables below.

#### Calibration Tables

**End-to-end session context (empirical):**

| Category | 200K (legacy data) | 1M (empirical, v9.3) | Empirical Source |
|----------|-------------------|----------------------|------------------|
| Low complexity (Discovery + Implementation) | 60-80% | 5-10% | Twin Task "Клуб" |
| Low-Medium complexity (Discovery + Implementation) | Does not fit | ~15% | Claiming Infrastructure |
| Medium complexity (Discovery + 2 Segments) | Two sessions required | 15% in one session | Partner Analytics |
| High complexity (Discovery + 2 Segments) | Three+ sessions | 22% | Ranking Core |

**Important:** These figures reflect navigational consumption (Discovery Tax), not Cognitive Tax. A task consuming only 15% of context may still be cognitively demanding if it involves 20 interconnected files. The Coordinator must separately assess cognitive complexity — Context Checkpoints measure the navigational dimension only.

**Calibration data sources:** Twin Task "Клуб" (v9.2), Partner Analytics, Ranking Core, Claiming Infrastructure (v9.3), Promotions (v9.4). All four complexity categories now have empirical measurements. High complexity (Ranking Core, 22%) came in significantly below the initial estimate of 30-50%, suggesting that 1M context handles even complex multi-segment tasks efficiently. Promotions (21%) is the first measurement where Pre-flight Conceptual Resolution was used, confirming that crystallized business decisions improve directive quality.

**Raw empirical data (individual sessions):**

| Task | Complexity | Context Used | Session Type | Version |
|------|-----------|-------------|--------------|---------|
| Twin Task "Клуб" | Low | ~5-8% | Mode C | v9.2 |
| Partner Analytics (Disc+2Seg) | Medium | 15% | Mode C | v9.3 |
| Ranking Core (Disc+2Seg) | High | 22% | Mode C | v9.3 |
| Claiming (Disc+Impl) | Low-Medium | 15% | Mode C | v9.3 |
| Promotions (Disc+2Seg+Docs) | Medium | 21% | Mode C | v9.4 |

**Per-phase context patterns:**

| Scenario | Context Used | What Happens |
|----------|-------------|--------------|
| Mode A: Sanity Check + Planning | 10-20% | Implementer uses Discovery Report |
| Mode B: Pre-scan + Discovery | 50-80% (200K) / 10-16% (1M) | Full autonomous discovery |
| Mode C: Discovery + Implementation | 5-22% (1M, Low→High) | Unified workflow, context retained |
| Implementation + Testing | 10-20% (1M) | Code changes and verification |
| Handoff or Commit | 5% | Semantic Handoff or commit |

**Coordinator Decision Matrix:**

| Observation | Action |
|-------------|--------|
| Context Checkpoint after Discovery: < 25% | Continue as Implementer (default) |
| Context Checkpoint after Discovery: 25-40% | Continue with awareness, checkpoint again after planning |
| Context Checkpoint after Discovery: > 40% | Consider Mode A escalation |
| Context Checkpoint after Segment: < 50% total | Continue with next segment |
| Context Checkpoint after Segment: > 50% total | Handoff to new session |
| Solution proposed, tests pass | Allow commit and report |
| Solution proposed, tests fail, context approaching limit | Signal handoff |

---

### 1.6 Safety Practices

These practices protect the codebase while enabling autonomous agent work. Safety protocols retain directive tone where codebase protection requires it.

#### Dry Run Protocol

Before any destructive action (delete, overwrite, move, major refactor), the agent must explain the impact in non-technical language. The Coordinator asks: "Explain what will be lost or changed if we execute this action." The agent responds with files affected and how, data that could be lost, and rollback strategy if something goes wrong. Only after Coordinator understanding and approval should the action proceed.

#### Backup and Recovery

Before starting a complex Leaf session, the current branch must be clean (`git status` shows no uncommitted changes). For architectural changes or risky refactoring, a temporary safety branch is created: `git checkout -b refactor/[feature-name]-safe-mode`. If something breaks catastrophically, recovery follows: `git stash` (save current work), then `git checkout main` (return to stable state).

#### Blocking Issue Protocol

When the agent encounters an issue it cannot resolve autonomously, the productive response is to document the issue with full technical context, list attempted solutions and their results, propose hypotheses for root cause, and request Coordinator decision: escalate to Trunk, seek external help, or defer. Spinning endlessly on unsolvable problems is not productive — recognizing when human judgment is needed is part of effective collaboration.

#### Information Recursion: Prevention and Recovery

Information Recursion occurs when agent decisions based on degraded context create cascading problems that cannot reach a stable state. Protocol 7 covers the recognition signals. This section details prevention and recovery.

**Prevention Strategies:**

Scope Discipline means limiting task scope to what fits comfortably in fresh context. For High complexity tasks, Multi-Session Segmentation (Section 1.5) is preferred over attempting completion in a single session.

Context Hygiene prevents "garbage" accumulation through filtered log access and Coordinator terminal ownership of heavy processes (see Reference Library, Section 2.3).

**Recovery Protocol when degradation is detected:**

1. Commit current state with WIP label
2. Generate Semantic Handoff with emphasis on the Eliminated Hypotheses section
3. Note which solutions were attempted and why they failed
4. Trunk creates new directive with explicit "avoid these approaches" guidance
5. Fresh Leaf session starts with clean context and the Semantic Handoff

If a bug is not resolved by the time the session shows terminal degradation signals (contradictory patterns, second compact activation), the session must end. The Coordinator terminates the current session, reassembles the task in Trunk with fresh analysis, and launches a new Leaf session with a refined directive.

---

### 1.7 Development Principles

**Pragmatism Over Purity.** A working feature with "good enough" code is better than a broken feature with "perfect" architecture. When a refactor hits unexpected complexity: revert to the simplest working solution, document the technical debt in the session report, and note the ideal architecture for future consideration. Do not stall progress for theoretical elegance. Creative use of existing infrastructure often beats elegant solutions requiring migrations or extensive refactoring.

**Documentation Hygiene.** Leaf sessions remove temporary analysis files, debug logs, and scratch work before closing. Any update to methodology documentation must be committed to the Git repository AND updated in Claude Project Knowledge — this dual sync ensures both Trunk (browser) and Leaf (IDE) sessions operate from synchronized understanding.

**Living Document.** This methodology evolves through operational practice. Changes address real problems encountered in actual development and are tested on real features before permanent adoption. Theoretical protocols that are not used in practice get simplified or removed. As the project grows, the methodology scales: specialized directive templates, domain-specific troubleshooting patterns, and reusable component libraries emerge from practice, not from pre-planning.

**Calibration Data Expires With Infrastructure.** All empirical measurements in this methodology (context consumption percentages, session capacity estimates, segmentation thresholds) are calibrated against specific infrastructure: model version, context window size, tooling capabilities. When infrastructure changes — a new model, a larger context window (2M, 5M), different tooling — calibration data becomes unreliable and must be re-measured empirically before trusting the existing tables. The methodology architecture must support **recalibration without restructuring**: tables have clear data sources, measurements are recorded in session reports via Context Telemetry, and the Calibration Tables section (1.5) is designed for column addition rather than rewrite. The transition from 200K to 1M invalidated all context estimates in a single day — this will happen again.

---

### 1.8 Knowledge Practices

#### Bank of Failures

When a complex bug is solved or a non-obvious solution is discovered, the knowledge base is updated.

**Location:** `docs/troubleshooting_bank.md`

**Entry Format:**
```
## [Descriptive Title]

**Symptom:** What the error looked like or how the bug manifested.

**Root Cause:** Why the error actually occurred.

**Solution:** Specific steps that resolved the issue.

**Prevention:** How to avoid this in future code.
```

Before requesting human help for debugging, Leaf sessions query this file for similar symptoms.

**Pattern Categories:** Alpha (Authentication and sessions), Bravo (Database and queries), Charlie (API integration), Delta (State management), Echo (Build and dependencies), Foxtrot (Test infrastructure), Golf (Figma MCP integration), Hotel (Information Recursion incidents).

#### External Memory Continuity

The co-creative system relies on external memory to maintain coherence across sessions.

**GitHub as Primary Truth Source:** All code lives in the repository. Commit messages reference originating sessions. Version history enables tracking architectural decisions. Branch strategy enables safe experimentation.

**Claude Projects as Knowledge Layer:** Provides Project Knowledge search across sessions. Maintains methodology and specification access. Enables Trunk to analyze Leaf outputs through synced session reports.

**The Continuity Cycle:**

1. Trunk creates Discovery Directive based on task requirements
2. Coordinator transfers to Librarian; Librarian produces Discovery Report
3. Coordinator transfers Discovery Report to Trunk (Protocol 3)
4. Trunk receives Discovery Report, creates Informed Directive
5. Implementer executes, commits to GitHub, generates Semantic Handoff
6. GitHub syncs to Project Knowledge
7. Trunk queries Project Knowledge for session outputs
8. Trunk formulates next directive building on completed work
9. Cycle continues with accumulated context

---

### 1.9 Documentation Hygiene

The co-creative methodology generates documentation as a natural byproduct of every session: session reports, discovery reports, directives, handoffs, checkpoints. Over time, transient artifacts accumulate alongside permanent documentation, degrading both repository cleanliness and Project Knowledge search effectiveness.

Documentation Hygiene operates at two scales: session-level (Protocol updates in Autonomous v1.2 / Informed v1.3 already handle CHANGELOG, session_history, lessons_learned) and phase-level (the Documentation Hygiene Checkpoint described below).

#### Documentation Hygiene Checkpoint

**Triggers:**

Primary: completion of a major phase (Phase 5, Phase 8, etc.) — the natural boundary where a body of work is done and its transient artifacts are no longer needed.

Secondary: Coordinator observes that Project Knowledge search returns outdated documents above current ones, or that transient files are visibly accumulating in docs/ or project root.

**Executor:** Leaf session in Mode B (Autonomous Execution). No Trunk directive or Pre-flight Discovery required — the Coordinator provides the standardized checklist below as the task description.

**Checklist:**

Step 1 — Scan for Transient Artifacts.
Scan docs/discovery_reports/, docs/handoffs/, project root, outputs/, and any *checkpoint* files. Delete files where: (a) the task they were created for is complete, AND (b) the final session report captures the outcome. For handoffs, preserve any that relate to active (in-progress) work.

Step 2 — Verify Permanent Documentation.
CHANGELOG.md has entries for all phases completed since last checkpoint. docs/ROADMAP.md phase statuses are current. README.md "Последнее обновление" reflects latest work. All links in README.md resolve to existing files. PROJECT_MAP.md reflects current module structure (see Section 1.9.1).

Step 3 — Check for Accumulation Patterns.
backend/ root contains only essential docs (no session reports or implementation notes). Session report directories (mobile/session_reports/, admin-web/session_reports/) have complete series without orphaned checkpoints. docs/00_methodology/ contains only current protocol versions.

Step 4 — Git Hygiene.
No untracked .md files remain. No empty directories remain after deletions.

Step 5 — Hygiene Report.
Produce a brief report: files removed (count and total lines), files updated, issues flagged for Trunk attention, expected trigger for next checkpoint. Single commit with message: docs: documentation hygiene checkpoint — [phase/trigger name].

**Kernel Integration:** The Trunk session closing checklist includes a line: "Documentation Hygiene Checkpoint needed?" This ensures the practice is evaluated at every strategic boundary, not only when accumulation becomes visible.

#### 1.9.1 Semantic Project Map

PROJECT_MAP.md is a navigation document optimized for agent orientation at session start. Unlike architectural documentation (which explains *why* the system is designed as it is), the Project Map answers: *if I need to work on X, which files do I open?*

**Structure — Three Layers:**

Layer 1 — Directory Semantics. The role of each directory and when to look there. Not a file listing (README provides that), but a functional description: "this is where Y happens."

Layer 2 — Module Flow Maps. For each functional module (auth, establishments, reviews, search, moderation, media, admin, partner), the data flow from entry point to database: route → controller → service → model, with specific file paths and key function names. Includes "if bug in X, start at Y" navigation hints.

Layer 3 — Cross-Cutting Concerns. Middleware chain, error handling pattern, audit logging, Provider architecture on frontend — patterns that span multiple modules.

**Location:** PROJECT_MAP.md in project root (same level as README.md and CHANGELOG.md — the three "lobby documents" that orient anyone entering the project).

**Maintenance:** Updated during every Documentation Hygiene Checkpoint (Step 2 of the checklist). When new modules are added or existing modules are significantly restructured, the corresponding flow map is updated. An outdated map is worse than no map — it creates false confidence in navigation.

**Design Principles:** Optimized for scanning, not reading. Consistent format across all modules. File paths are exact (copy-pasteable). Function names included for key entry points. No explanations of *why* — only *where* and *what*.

**Discovery Tax Impact:** The Project Map directly addresses the Discovery Tax (Section 1.5) by converting navigational cost from per-session (each session rediscovers structure) to per-change (map updated only when structure changes). Expected reduction: Mode B navigational tax from 50-80% to 20-30% of context, preserving cognitive resources for problem-solving.

---
---

## Part II: Reference Library

*These are technical appendices for specific domains. Consult only when working with the relevant technology or situation.*

---

### 2.1 Flutter Semantic Gap Mitigation

*Consult when creating or reviewing Flutter directives and implementations.*

AI models exhibit bias toward web development patterns. Every Flutter directive must explicitly declare mobile paradigm and actively counter this tendency.

**Paradigm Declaration** for every Flutter directive: state clearly "This is Flutter mobile development using Dart and Flutter widgets" and explicitly exclude "Do not use HTML, CSS, or web paradigms."

The semantic gap operates at three distinct levels. Level 1 (syntax) produces visible errors. Level 2 (architecture) produces code that compiles but follows wrong paradigms. Level 3 (state management) produces project-specific anti-patterns.

#### Level 1: Syntax Mapping

| Wrong (Web) | Correct (Flutter) |
|-------------|-------------------|
| className | Widget parameters |
| div, span | Column, Row, Stack, Container |
| CSS styling, style={{}} | ThemeData, BoxDecoration, widget properties |
| href, Link | Navigator.push/pop, named routes |
| onClick | onTap, onPressed, GestureDetector |
| DOM manipulation | Widget trees and state management |
| margin/padding as strings | EdgeInsets |

#### Level 2: Architectural Patterns

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

#### Level 3: State Management (Project-Specific)

| Anti-Pattern | Correct Pattern |
|-------------|-----------------|
| Business logic in Widget build() | Logic in Provider/Service, Widget only renders |
| Direct API calls from screens | Screen → Provider → Service → API |
| Local state for shared data | ChangeNotifierProvider at appropriate scope |
| Forgetting notifyListeners() | Always call after state mutation |
| Not disposing controllers | Always dispose in State.dispose() |

**Directive Integration:** When creating directives that involve UI work, reference the appropriate level. For new screens: emphasize all three levels. For bug fixes in existing screens: Level 3 is most relevant. Include reference to existing Flutter implementations in codebase — Level 3 patterns reference project-specific files (providers/, services/, main.dart).

---

### 2.2 Figma MCP Integration

*Consult when working with Figma designs in Leaf sessions.*

Figma MCP enables direct design-to-code workflows within Leaf sessions. These protocols establish optimal patterns for context-efficient design analysis and Flutter code generation.

#### Design Analysis Workflow

**Prerequisites:** Figma Desktop app installed and running, design file open with target screens, Claude Code session initiated with Figma MCP enabled.

**Phase 1 — Frame Selection:** Select the target frame/node in Figma Desktop (single selection for screenshots, multi-selection supported for metadata). A blue border confirms active selection.

**Phase 2 — Agent Invocation:** For Flutter projects, always specify target framework:

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

Without `clientLanguages` and `clientFrameworks` parameters, Figma MCP returns React + Tailwind code requiring transformation. Always specify these parameters for Flutter projects.

**Phase 3 — Response Handling:** Two response types are possible. A *Full Code Response* returns complete React + Tailwind code requiring transformation to Flutter (higher semantic gap risk). A *Sparse Metadata Response* returns XML structure with element IDs, types, positions, and dimensions — the agent generates Flutter from this blueprint (minimal semantic gap risk, triggered automatically for large designs). The system message indicates metadata mode when applicable.

**Phase 4 — Selective Deep-Dive:** For large screens returned as metadata, request full code for specific sections using sublayer nodeId.

#### Discovery-Informed Figma Access

Figma MCP supports two access modes that enable different levels of autonomy:

**Selection-Based Access** (implicit nodeId): When `get_design_context` or `get_screenshot` is called without a nodeId parameter, the tool reads whatever is currently selected in Figma Desktop. Each frame access requires a Coordinator action — selecting the frame in the Figma app. This creates N interaction points for N frames.

**Direct Access** (explicit nodeId): When a nodeId parameter is provided, the tool accesses that specific node regardless of the current Figma Desktop selection. No Coordinator action required. This enables fully autonomous design-to-code workflow.

**Connecting Pre-flight Discovery to Figma:** When Figma designs exist for a feature, the Discovery Directive should include an investigation question requesting nodeId collection:

```
Q: What are the Figma frame names and nodeIds for the [feature] screens?
Method: Extract from Figma file via MCP metadata scan or from URLs provided by Coordinator.
Expected answer: Table of frame name → nodeId mappings.
```

The Discovery Report includes these mappings in the Navigation for Implementer section:

```markdown
### Relevant Figma Frames
| nodeId | Screen Name | Role |
|--------|-------------|------|
| `93:1092` | Модерация (Данные) | Primary moderation — Data tab |
| `93:1292` | Модерация (О заведении) | About tab |
```

When the Discovery Report contains nodeId mappings, direct access is preferred — the Implementer calls Figma MCP with explicit nodeIds from the report, achieving the same level of autonomy as codebase access. Selection-based access remains available for ad-hoc exploration where nodeIds are not known in advance.

#### Context Budget Guidelines

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
| Design Survey | 10-15 | 0 | 30-60% |
| Selective Implementation | 5-8 | 3-5 | 40-60% |
| Deep Dive Single Screen | 1-2 | 1-2 (with animations) | 15-25% |

**Optimization Tactics:** Use metadata-first approach (analyze all screens as metadata, generate code only for approved designs). Target sublayers for complex screens. Batch similar screens for redundancy optimization. Defer exploration if context is tight — prioritize implementation over survey.

#### Workflow Protocols

**Protocol A — Iterative Design Review:** Use for reviewing Figma designs during development and providing feedback. Context budget: ~20-30% (5-8 screens analyzed).

**Protocol B — Implementation Preparation:** Use when design is finalized, preparing to implement in Flutter. Context budget: ~15-25% (1-2 screens with full code).

**Protocol C — Design System Extraction:** Use for extracting reusable components, colors, typography from Figma. Context budget: ~10-20%.

#### Multi-Screen Flow Analysis

When analyzing complete interaction flows (onboarding, checkout, registration): select all frames in the flow (multi-select in Figma), call get_design_context (screenshot will fail for multi-selection, metadata succeeds), receive sparse metadata for all frames, and trace the logical sequence including state progression, validation rules, error states, interactive elements, and transition triggers. Context cost is approximately 0.7% per screen, making this highly efficient for batch analysis.

**Emergency Protocol for Mid-Session Overflow:** If context approaches the limit with Figma work incomplete: commit analyzed metadata to documentation, generate Semantic Handoff with sublayer IDs for the next session, prioritize critical screens for code generation, and defer exploratory analysis to a future session.

---

### 2.3 Context Hygiene

*Consult when setting up debugging workflows or when context pollution is suspected.*

Unfiltered logs consume context rapidly. The Passive Observation Pattern distributes responsibility: the Coordinator owns heavy processes and has real-time log visibility; the agent receives filtered access, preserving context for implementation work.

**Toxic Log Categories** to keep out of agent context: full authentication tokens (JWT, refresh tokens), complete API response bodies with nested data, duplicate error messages from retry loops, verbose framework debug output, and unfiltered emulator/simulator logs.

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

When filtered output is insufficient for debugging, the agent requests a specific log segment from the Coordinator. The Coordinator extracts the relevant portion (e.g., last 50 lines around the error) and provides it. This manual handoff prevents automatic context pollution while maintaining debugging capability.

---

### 2.4 Code Quality Standards

*Consult when reviewing code or establishing quality expectations for a directive.*

All code produced in the co-creative process is expected to be production-ready.

**Error Handling:** Proper try-catch with appropriate recovery strategies. User-facing error messages that are helpful without exposing internals.

**Security:** Input validation at controller level. Authentication checks on protected routes. Sanitization of user-provided content.

**Performance:** Database queries with appropriate indexing. Avoiding N+1 query patterns. Lazy loading for expensive operations.

**Maintainability:** Clear naming that reveals intent. Logical file organization following established patterns. Comments for complex logic, not obvious operations.

**Consistency:** Follow patterns established elsewhere in the codebase. Use existing utilities rather than reimplementing. Match code style of surrounding files.

---

*Methodology v9.4 — Version history tracked in git: `git log docs/00_methodology/Methodology_v9.md`*

*This methodology serves as the operational reference for all Trunk and Leaf sessions in the Restaurant Guide project. It establishes the co-creative partnership architecture enabling efficient collaboration between strategic planning and autonomous execution.*

**Synchronization Requirement:** This document must exist in both Claude Project Instructions (for Trunk session runtime access) and the Git repository docs/ directory (for Leaf session reference). Updates to either location must be synchronized immediately.
