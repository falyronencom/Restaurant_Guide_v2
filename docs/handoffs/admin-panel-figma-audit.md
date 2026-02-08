# Discovery Report: Admin Panel — Figma Design Audit

**Date:** 2026-02-07
**Role:** Librarian (Investigation Only)
**Source:** Figma DevMode MCP + functional_spec_v3.md (Section 3.4)
**Auditor:** Claude (Opus 4.6) + Coordinator: Vsevolod

---

## Answers to Discovery Questions

### Q1: How many distinct frames/screens exist for the admin panel in Figma?

**Answer: 7 frames on a dedicated Figma page.**

| # | Frame Name | nodeId | Size | Role |
|---|-----------|--------|------|------|
| 1 | Log in | `100:288` | 1920x1117 | Login screen |
| 2 | Модерация/ ожидают просмотра (tab: Данные) | `93:1092` | 1920x1117 | Moderation — pending, Data tab |
| 3 | Модерация/ ожидают просмотра (tab: О заведении) | `93:1292` | 1920x1117 | Moderation — pending, About tab |
| 4 | Модерация/ ожидают просмотра (tab: Медиа) | `93:1599` | 1920x1117 | Moderation — pending, Media tab |
| 5 | Модерация/ ожидают просмотра (tab: Адрес) | `93:1746` | 1920x1117 | Moderation — pending, Address tab |
| 6 | Настройки/Статистика и аналитика/Заведения | `93:696` | 1920x1256 | Statistics — Establishments tab |
| 7 | Настройки/Статистика и аналитика/Пользователи | `93:752` | 1920x1953 | Statistics — Users tab |
| 8* | Настройки/Статистика и аналитика/Отзывы-оценки | `93:917` | 1920x1953 | Statistics — Reviews tab |

> *Note: Frames 2-5 represent 4 tabs of one logical screen. Frames 6-8 represent 3 tabs of another logical screen. Frame for "Продвижение" tab was not designed.*
> *Note: Frames for "Одобренные" and "Отказанные" do NOT exist physically — they were planned but not designed. Recommendations provided below.*

**Verification:** SR — all frames enumerated via Figma MCP get_metadata + get_screenshot.

---

### Q2: Is there a dedicated Dashboard/Home screen?

**Answer: NO DASHBOARD SCREEN FOUND (SR).**

After login, there is no dedicated dashboard with summary metric cards. The first screen after login is not defined — the moderation queue ("Ожидают просмотра") appears to be the de facto landing page based on sidebar structure.

The specification (3.4.2) requires:
- Cards with key metrics: pending moderation count, active users today, new registrations, active establishments
- List of recent actions requiring attention

**Gap:** Missing. Needs design and implementation.

**Verification:** SR — checked all frame names, no "Dashboard", "Главная", "Home" found.

---

### Q3: Complete sidebar navigation structure

**Answer: Full sidebar navigation tree:**

```
{N}YAMA (logo)

Модерация
  ├── Ожидают просмотра  (→ with chevron icon)
  ├── Одобренные
  └── Отказанные

Настройки
  ├── Статистика и аналитика  (→ with chevron icon on active)
  ├── Отзывы *
  ├── История платежей
  └── Уведомления
```

**Inconsistency found:** The "Отзывы" item is **missing from the sidebar** on the Statistics/Заведения frame (`93:696`) but **present** on all other frames. This is a design inconsistency that should be corrected.

**Verification:** SR — sidebar metadata extracted from frames `93:1160`, `93:697`, `93:753`, `93:918`.

---

### Q4: Moderation flow — detail sections for pending establishment

**Answer: 4 tabs with 14 moderable blocks + 2 informational blocks.**

Each field has individual Approve (✅) / Reject (✕) / Comment (💬) buttons — granular per-field moderation.

**Tab 1: Данные (Data)**
| Field | Required | Moderable |
|-------|:--------:|:---------:|
| Полное название заведения | * | ✅ ✕ 💬 |
| УНП (tax ID) | * | ✅ ✕ 💬 |
| Регистрация (PDF) | * | ✅ ✕ 💬 |
| Номер контактного лица | * | ✅ ✕ 💬 |
| E-mail | * | ✅ ✕ 💬 |

**Tab 2: О заведении (About)**
| Field | Required | Moderable |
|-------|:--------:|:---------:|
| Описание (205/450 chars) | * | ✅ ✕ 💬 |
| Название | * | ✅ ✕ 💬 |
| Номер для связи с клиентом | * | ✅ ✕ 💬 |
| Ссылка на соц. сеть/сайт | | ✅ ✕ 💬 |
| Время работы (будни + выходные) | * | ✅ ✕ 💬 |
| Средний чек | * | ✅ ✕ 💬 |
| Время дополнительного меню | | Info only |
| Атрибуты заведения (toggles) | | Info only |

**Tab 3: Медиа (Media)**
| Field | Required | Moderable |
|-------|:--------:|:---------:|
| Фото (up to 50, PNG/JPG, 150mb) | * | ✅ ✕ 💬 |
| Меню (PDF, 60mb) | * | ✅ ✕ 💬 |

**Tab 4: Адрес (Address)**
| Field | Required | Moderable |
|-------|:--------:|:---------:|
| Адрес целиком (город, улица, дом, корпус) | * | ✅ ✕ 💬 (one block) |

**Comparison with partner registration steps:**
- Category/cuisine type: NOT shown in moderation detail (visible only in card list as tags like "{европейская}")
- Info (name, UNP, contacts): ✅ Covered in "Данные" tab
- Description, hours, attributes: ✅ Covered in "О заведении" tab
- Media (photos, menu): ✅ Covered in "Медиа" tab
- Address: ✅ Covered in "Адрес" tab
- Legal (registration PDF): ✅ Covered in "Данные" tab

**Spec gap:** "Запросить уточнение" (request clarification) action from spec is not explicitly designed — the Comment (💬) button may serve this purpose but needs confirmation.

**Spec gap:** "Автоматическая проверка на дубликаты по адресу" — no visual indication of duplicate checking in the design.

---

### Q5: Audit Log / Action History

**Answer: NOT FOUND (SR).**

No frame, no sidebar item, no component found for:
- "история действий"
- "журнал"
- "лог"
- "audit"
- "history" (of actions)

Searched all frame names and sidebar navigation elements across all 8 frames. The "История платежей" (payment history) in the sidebar is NOT an audit log — it relates to subscription payments.

The specification (3.4.2) explicitly requires:
- Logging of all administrative actions
- Who, when, what action, on which object

**Gap:** Missing. Critical for security and accountability. Needs design and implementation.

**Verification:** SR — all frame names and sidebar elements checked via MCP metadata.

---

### Q6: Content Management screen separate from Moderation

**Answer: NOT FOUND as separate screen (SR).**

The specification (3.4.2) requires:
- Search any establishment by name → hide/delete/view history
- Search and hide problematic reviews

The sidebar has "Отзывы" (Reviews) as a separate item, but NO corresponding Figma frame exists for it. There is no "Управление контентом" or "Content" frame.

The only content interaction designed is through the moderation flow (approve/reject pending submissions). No mechanism to manage already-published content (hide/delete/suspend).

**Recommendation:** The "Одобренные" (Approved) screen should include a "Приостановить" (Suspend) action — this partially addresses the content management need for establishments. A separate review management screen linked to the "Отзывы" sidebar item is also needed.

**Verification:** SR — all frame names and sidebar items checked.

---

### Q7: Login screen — 2FA flow

**Answer: Single-step login only. NO 2FA.**

The login screen (`100:288`) contains:
- Input field: "Как звать" (nickname/email)
- Input field: "Пароль" (password)
- Button: "Войти" (Sign in)

No second step, no code input, no authenticator setup, no QR code.

The specification (3.4.1) requires: "Email + пароль + обязательная 2FA"

**Gap:** 2FA flow is missing. Needs at least a second screen for code verification.

**Verification:** SR — login frame `100:288` metadata shows exactly 2 input fields + 1 button.

---

### Q8: Statistics & Analytics — chart types and visualizations

**Answer: Mixed level of detail. Some real charts, many placeholders.**

**Tab: Заведения** (`93:696`)
- NO charts or visualizations
- Only text-based Top-10 ranked lists (Просмотры, Продвижение, 3rd list without header)
- Summary metrics: "Всего заведений: {528}", "Новые за период: {+25}"
- Detail level: LOW (placeholder data, missing chart types)

**Tab: Пользователи** (`93:752`) — most detailed
| Visualization | Type | Level of Detail |
|---|---|---|
| Посещаемость | Line chart | Medium — has axes, time labels (7am-12pm), Y-axis 0-1.5k |
| Длительность сессии | Donut chart | Low — placeholder labels (percentages don't add up: 115%) |
| Статистика | Bar chart | Medium — daily bars (8-14 Sep), Y-axis 0-1.5k |
| Активность | Text list | Low — Top-10 users, placeholder data |

Metrics: DAU (921), WAU (4 569), MAU (7 054), Retention (7 мин)

**Tab: Отзывы/оценки** (`93:917`)
| Visualization | Type | Level of Detail |
|---|---|---|
| Оценки (avg) | Donut chart | BROKEN — copy-pasted session duration labels instead of rating labels |
| Star distribution | Horizontal bar | Good — 5★:1500, 4★:2800, 3★:600, 2★:200, 1★:130 |
| Статистика | Bar chart | Low — identical to Пользователи tab (copy-paste) |
| Активность | Text list | Low — identical to Пользователи tab (copy-paste) |

**Tab: Продвижение** — NOT DESIGNED

**Overall assessment:** Charts exist as design patterns (line, bar, donut) but most contain placeholder/incorrect data. The star distribution chart is the only fully specified visualization. Implementation can use the chart types as guidance but will need proper data mapping.

---

## Coverage Matrix

| Spec Requirement (Section 3.4) | Figma Coverage | Gap Level | Notes |
|-------------------------------|----------------|-----------|-------|
| **Login** | Single-step designed | **Partial** | Missing 2FA second step |
| **2FA** | Not designed | **Missing** | Spec requires "обязательная 2FA" |
| **Main Dashboard** | Not designed | **Missing** | Spec requires metric cards + recent actions list |
| **Moderation Queue (pending)** | 4 tabs fully designed | **None** | Excellent granular per-field design |
| **Moderation (approved list)** | Not designed (planned) | **Partial** | Recommendation: read-only view + suspend action |
| **Moderation (rejected list)** | Not designed (planned) | **Partial** | Recommendation: read-only + rejection reason display |
| **Approve/Reject actions** | ✅ ✕ 💬 per field | **None** | Well designed |
| **Request clarification** | Partially via 💬 | **Partial** | Comment button exists, but "request clarification" flow not explicit |
| **Duplicate check by address** | Not designed | **Missing** | Spec requires auto-check |
| **Content Management** | Not designed | **Missing** | Search + hide/delete for establishments and reviews |
| **Basic Analytics** | 3 tabs designed | **Partial** | Charts exist but placeholder data; "Продвижение" tab missing |
| **Active subscriptions count** | Not designed | **Missing** | Spec requires, no visualization exists |
| **Action Log** | Not designed | **Missing** | Critical for accountability |
| **Notifications** | Sidebar item only | **Missing** | No frame designed |
| **Payment History** | Sidebar item only | **Missing** | No frame designed |
| **Reviews Management** | Sidebar item only | **Missing** | No frame designed |

**Summary: 3 fully covered, 4 partially covered, 9 missing.**

---

## Design Issues Found

### Critical
1. **Donut chart labels on Отзывы/оценки tab** — copy-pasted session duration labels ("До 2 мин – 40%") instead of rating distribution. Must be fixed before implementation.
2. **Session duration percentages** — 40+35+20+20 = 115%, should total 100%.

### Medium
3. **Sidebar inconsistency** — "Отзывы" item missing from sidebar on Заведения statistics frame (`93:696`) but present on all others.
4. **Frame naming** — Пользователи and Отзывы/оценки tabs are named "Заведения" in Figma layer names.
5. **DAU value contradiction** — Summary shows 10 467, Посещаемость section shows 921.
6. **Third Top-10 list** on Заведения tab has no header/title.
7. **Placeholder data duplication** — "Статистика" and "Активность" sections identical across Пользователи and Отзывы/оценки tabs.

### Low
8. **Login field label** — "Как звать" is informal for admin panel; should be "Email" or "Логин" for clarity.

---

## Additional Findings

### Design Patterns and Component Reuse
- **Sidebar** is consistent component across all screens (minus the Отзывы inconsistency)
- **Card list** pattern (left panel with establishment cards) is reused across moderation tabs — good for component extraction
- **Approve/Reject/Comment** button group is a reusable component (used 14 times)
- **Input field** pattern (rounded rectangle + text) is consistent
- **Tab navigation** pattern used in both Moderation (4 tabs) and Statistics (4 tabs)

### Responsive Considerations
- All frames designed at **1920x1117** (desktop full HD) or taller for scrollable content
- No mobile/tablet breakpoints designed
- Sidebar is **fixed width (363px)** — not collapsible in current design
- Spec mentions "Адаптирована для работы на desktop и tablet" in admin-web README — tablet layouts not designed

### Moderation Workflow Recommendations (agreed with coordinator)
- **"Одобренные" screen:** Read-only view of approved establishments, NO approve/reject buttons, add "Приостановить" (Suspend) action for policy violations
- **"Отказанные" screen:** Read-only view showing submitted data + rejection reasons per field, NO action buttons. When partner resubmits after corrections, card moves back to "Ожидают просмотра" and disappears from "Отказанные"
- **Flow:**
  ```
  Partner submits → [Ожидают просмотра]
                       ├── Approve → [Одобренные] (read-only, suspend option)
                       └── Reject  → [Отказанные] (read-only + reasons)
                                         └── Partner fixes → [Ожидают просмотра]
  ```

---

## Navigation for Implementer

### Relevant Figma Frames

| nodeId | Screen Name | Role |
|--------|-------------|------|
| `100:288` | Log in | Authentication entry point |
| `93:1092` | Модерация/ ожидают просмотра (Данные) | Primary moderation — Data tab |
| `93:1292` | Модерация/ ожидают просмотра (О заведении) | Primary moderation — About tab |
| `93:1599` | Модерация/ ожидают просмотра (Медиа) | Primary moderation — Media tab |
| `93:1746` | Модерация/ ожидают просмотра (Адрес) | Primary moderation — Address tab |
| `93:696` | Статистика/Заведения | Analytics — establishments rankings |
| `93:752` | Статистика/Пользователи | Analytics — user metrics + charts |
| `93:917` | Статистика/Отзывы-оценки | Analytics — ratings + reviews |

### Screen Flow

```
[Login] → [Dashboard*] → [Модерация: Ожидают просмотра]
              |                    ├── Tab: Данные
              |                    ├── Tab: О заведении
              |                    ├── Tab: Медиа
              |                    └── Tab: Адрес
              |
              ├── [Модерация: Одобренные*] (read-only)
              ├── [Модерация: Отказанные*] (read-only + reasons)
              |
              ├── [Статистика и аналитика]
              |        ├── Tab: Заведения
              |        ├── Tab: Пользователи
              |        ├── Tab: Продвижение*
              |        └── Tab: Отзывы/оценки
              |
              ├── [Отзывы*] (content management)
              ├── [История платежей*]
              └── [Уведомления*]

* = Not designed in Figma, needs implementation based on spec
```

### Recommended Implementation Order

1. **Login** — entry point, simple (1 screen). Skip 2FA for MVP-0, add in next iteration.
2. **Sidebar + Navigation shell** — shared layout component, needed by all screens.
3. **Модерация: Ожидают просмотра** — core functionality, best-designed screens, highest business value. Partner onboarding is blocked without this.
4. **Модерация: Одобренные + Отказанные** — extend moderation with read-only views. Low effort since layout is reused.
5. **Статистика: Пользователи** — most complete analytics design, use as template for other tabs.
6. **Статистика: Заведения** — add charts based on Пользователи patterns.
7. **Статистика: Отзывы/оценки** — fix donut chart labels, implement star distribution.
8. **Dashboard** — implement after analytics (reuses metric components).
9. **Action Log** — implement alongside moderation actions.
10. **Content Management, Reviews, Notifications** — post-MVP screens.

---

## Backend Readiness Assessment

Based on codebase analysis (backend/ directory):

| Component | Backend Status | Notes |
|-----------|---------------|-------|
| Auth + Roles | ✅ Ready | `authorize(['admin'])` middleware exists |
| Moderation workflow | ✅ Partial | `submitForModeration()` exists, approve/reject endpoints: NOT implemented |
| Admin routes | ❌ Placeholder only | `// router.use('/admin', adminRoutes)` commented out |
| Audit log | ✅ DB schema only | `audit_log` table defined, no endpoints |
| Analytics | ✅ DB schema only | `establishment_analytics` table defined, no endpoints |
| Subscriptions | ✅ DB schema only | `subscriptions` table defined, no endpoints |

**The backend infrastructure (roles, middleware, DB schema) is ready. Only the endpoints need to be created.**

---

*Report generated: 2026-02-07*
*Methodology: Figma DevMode MCP (metadata-first approach) + functional_spec_v3.md cross-reference*
*Verification markers: SR (Search Result) used for all absence claims*
