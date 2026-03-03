# Handoff: Memory Reorganization for Claude Code

**Date:** 2026-03-03
**From:** Claude Code (Leaf session)
**To:** Trunk (browser Claude)
**Commit:** `c903cc7`

---

## What Was Done

Claude Code's auto-memory file (`MEMORY.md`) reached 190/200 lines — 10 lines from the hard truncation limit. A dedicated session reorganized it into a 3-file architecture.

## New Architecture

```
~/.claude/projects/<project-hash>/memory/
  MEMORY.md              78 lines  (was 191)  — auto-loaded every session
  session_history.md     65 lines  (new)      — read on demand
  lessons_learned.md    118 lines  (new)      — read on demand
```

### MEMORY.md (≤150 lines, auto-loaded)
Contains only what every session needs:
- Project Overview, Production Deployment, TestFlight
- Key Patterns (backend/frontend architecture)
- Database Notes (critical gotchas)
- **Current Phase** (new section — project stage, what's done, what's planned)
- **Extended Memory Files** (pointers to sub-files)
- **Top 10 Critical Lessons** (most impactful, frequently-hit)

Budget: 78/150 lines used → 72 lines of buffer (~7+ sessions of growth).

### session_history.md (read on demand)
Full session log moved here:
- Admin Panel MVP (Segments A-E)
- Testing Sessions 1-10
- Design & Consolidation Sessions
- Deployment Session
- Figma Snapshots Archive
- Server Preview Config

### lessons_learned.md (read on demand)
All 70+ lessons organized by 10 categories:
- Backend/API, Database/SQL, Mobile/Flutter, Admin-web
- YandexMap, Могилёв ё/е, Moderation/Suspend Logic
- Testing/Jest, Deployment/Railway, Tooling/Dev Environment
- Notifications (unimplemented — Segment F)

## Cleanup Applied

**Deleted (7 obsolete entries):**
- Trivial factoids (intl/multer in deps)
- Already-fixed issues (fl_chart deprecation, Avenir Next migration, geocoding)
- Basic knowledge (git checkout for untracked files)
- One-time decisions (arc vs cubicBezier marker shape)

**Consolidated (5 duplicate sets):**
- `moderation_notes` TEXT parsing (3 entries → 1)
- Могилёв/Могилев ё (2 → 1 comprehensive section)
- Provider stale selection (2 → 1 with template)
- `const` removal for AppTheme refs (2 → 1)
- `rejected` status CHECK constraint (merged into Database)

## Protocol Updates

Both execution protocols updated to include memory maintenance rules:

| Protocol | Version | Change |
|----------|---------|--------|
| Protocol Autonomous | v1.1 → **v1.2** | Added Claude Code memory to Documentation Updates |
| Protocol Informed | v1.2 → **v1.3** | Added Claude Code memory to Documentation Updates |

New rules in Documentation Updates (Phase 4: Report):
- `MEMORY.md`: update Current Phase only. Do NOT add sessions or lessons here
- `session_history.md`: append one bullet per session
- `lessons_learned.md`: append by category, check for duplicates first
- If MEMORY.md approaches 150 lines, move content to sub-files first

## Impact on Trunk

**What Trunk should know:**
1. When creating directives that reference session history — the canonical source is now `session_history.md`, not MEMORY.md
2. Protocol versions bumped — if Trunk references protocol versions, use Autonomous v1.2 / Informed v1.3
3. Memory files are LOCAL to Claude Code (`~/.claude/projects/...`) — they are NOT in the git repo and contain sensitive data (credentials, Railway config)
4. The directive file (`docs/discovery_reports/memory_reorganization_directive.md`) was NOT committed — it was a working document for this session only

## No Action Required from Trunk

This is an informational handoff. No Trunk directive revision needed. The protocols in the git repo are already updated and will be used by future Leaf sessions automatically.
