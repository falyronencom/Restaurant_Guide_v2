# Session Report: Smart Search — AI Intent Parser (Component 7)

**Date:** April 9, 2026
**Mode:** C (Unified Execution — Discovery + Implementation)
**Segments:** A (Backend) + B+C (Mobile, combined)

## Context Telemetry
- After Discovery: 5%
- After Segment A: ~14%
- Final: ~18%

## Changes Made

### Segment A — Backend (3 commits + 2 fixes)
| File | Action |
|------|--------|
| `backend/src/config/openrouter.js` | Created — OpenRouter config, lazy env reading |
| `backend/src/services/smartSearchService.js` | Created — AI parsing, Zod validation, Redis cache, filter builder |
| `backend/src/controllers/smartSearchController.js` | Created — POST handler, validation, sanitization |
| `backend/src/routes/v1/searchRoutes.js` | Modified — POST /search/smart + rate limiter (30/min) |
| `backend/.env.example` | Modified — OPENROUTER_API_KEY, AI_MODEL |
| `backend/src/tests/integration/smart-search.test.js` | Created — 28 tests |
| `backend/package.json` | Modified — zod dependency |

### Segments B+C — Mobile (1 commit + 2 fixes)
| File | Action |
|------|--------|
| `mobile/lib/services/smart_search_service.dart` | Created — API client for POST /search/smart |
| `mobile/lib/providers/smart_search_provider.dart` | Created — ChangeNotifier state management |
| `mobile/lib/widgets/smart_search_bar.dart` | Created — animated placeholder, dual-mode button |
| `mobile/lib/widgets/smart_search_suggestions.dart` | Created — suggestion chips |
| `mobile/lib/widgets/smart_search_preview.dart` | Created — top-3 preview cards |
| `mobile/lib/screens/search/search_home_screen.dart` | Modified — integrated all widgets |
| `mobile/lib/main.dart` | Modified — SmartSearchProvider registered |

## Key Decisions
1. **Lazy env reading** in openrouter.js — ESM import order means `process.env` is empty at module load time; `getConfig()` reads at call time after `dotenv.config()`
2. **20s API timeout** — Gemini Flash-Lite via OpenRouter cold starts take 7-11s
3. **Simplified prompt** — verbose prompt caused JSON parse errors; compact prompt with category/cuisine lists works reliably
4. **Zod `tags` nullable transform** — AI sometimes returns `tags: null` instead of `tags: []`; Zod `.nullable().transform(v => v ?? [])` handles both
5. **hintText instead of Stack** — TextField is opaque and covers overlay text; using TextField's own `hintText` with `AnimatedSwitcher` for cycling

## Verified Functionality
| Test | Result |
|------|--------|
| AI parsing "кофе рядом" | category: Кофейня, sort: distance, tags: ["кофе"] — 7s |
| Redis cache (repeat query) | Same intent — 97ms |
| AI parsing "итальянский ресторан в Минске" | category: Ресторан, cuisine: Итальянская, location: Минск |
| Fallback (invalid AI response) | fallback: true, ILIKE search results |
| Backend tests (28 new) | All passing |
| Existing search tests (20) | Zero regressions |
| Flutter analyze | No issues |
| Flutter build APK | Success |
| Mobile on emulator | Chips clickable, preview panel works |

## Known Issues
- AI response time 7-11s on cold start (cached: 97ms) — acceptable for Phase 1
- Production seed data uses English category IDs — AI-parsed cyrillic filters don't match until real data added
- `meal_type` parsed by AI but not applied as filter (logged, Phase 2)

## Process Reflection
- **Cognitive load**: Medium. Discovery straightforward (well-mapped codebase). Main complexity in runtime debugging (ESM import order, API timeout, JSON parse errors, Zod validation edge cases)
- **Positive transfer**: Discovery → Implementation was seamless in Mode C. No re-investigation needed
- **Mode recommendation**: Mode C optimal for this task — single session, three segments, 18% context used
