# Функциональная спецификация — Restaurant Guide Belarus (Nirivio)

*Версия 3.4 — Актуальная редакция*
*Последнее обновление: Апрель 2026*
*Синхронизировано со Стратегией монетизации v0.5 (24 марта 2026)*
*Синхронизировано с кодовой базой: апрель 2, 2026 (аудит-сверка)*

> **Структура документа:** Части I-IV — основная спецификация (бизнес-логика, flow, правила). Приложения A-C — справочные данные (схема БД, перечисления, планы). В Leaf/Code-сессиях приложения можно пропустить — данные доступны в коде.

---

## Часть I: Обзор проекта

**Проблема:** В Беларуси отсутствует единая современная платформа для поиска заведений общепита.

**Решение:** Мобильное приложение Nirivio — геолокационный поиск с честным ранжированием (без платных бустов), прозрачные отзывы, инструменты для партнёров (акции, бронирование).

**Три роли:** User (поиск, отзывы, избранное), Partner (управление заведениями, акции, аналитика), Admin (модерация, claiming, аудит).

**7 городов:** Минск, Гродно, Брест, Гомель, Витебск, Могилёв/Могилёв, Бобруйск.

---

## Часть II: Техническая архитектура

### 2.1 Стек

| Слой | Технологии |
|------|-----------|
| **Mobile** | Flutter 3.x, Provider/ChangeNotifier, Dio, Yandex MapKit, CachedNetworkImage |
| **Admin Web** | Flutter Web (PWA, desktop-first), `admin-web/`, Sidebar 363px + AdminShell, GoRouter + auth guard |
| **Backend** | Node.js/Express, PostgreSQL + PostGIS, Redis (кэш + rate limiting), JWT (access 15min / refresh 7d) |
| **Медиа** | Cloudinary (3 разрешения: original/preview/thumbnail), Multer (аватары → `backend/uploads/avatars/`) |
| **Инфра** | Railway (Backend + PostGIS + Redis, Hobby Plan), Docker (тесты), SendGrid (запланировано), CI/CD (запланировано) |

### 2.2 Архитектура данных

> Полная схема всех 12 таблиц с полями — см. **Приложение A**.
> Актуальное состояние БД: миграции 001-020 в `backend/migrations/`. Файл `production_schema.sql` — стартовый snapshot (февраль 2026), не содержит миграций 019-020.

**12 таблиц:** Users, Establishments, Reviews, EstablishmentMedia, Favorites, Promotions, Subscriptions, EstablishmentAnalytics, RefreshTokens, PartnerDocuments, Notifications, AuditLog.

**Ключевые бизнес-правила в схеме:**
- `moderation_notes`: TEXT, не JSONB — JSON.stringify на запись, JSON.parse на чтение
- `status` заведения: draft → pending → active / rejected / suspended / archived
- `is_seed` + `claimed_at` — инфраструктура claiming (миграция 019)
- Promotions: `status` (active/expired/hidden_by_admin), max 3 активных, lazy expiry (миграция 020)
- Subscriptions: таблица создана, код не активен (Phase 1 = всё бесплатно)
- EstablishmentAnalytics: UPSERT per day, включает `call_count` и `promotion_view_count`

### 2.3 Оптимизация

- Lazy loading + прогрессивная загрузка изображений (миниатюра → полное)
- Пагинация (20 элементов), Redis-кэширование
- Cron-агрегация метрик (запланировано), офлайн-кэширование (запланировано)

---

## Часть III: Функциональная спецификация

### 3.1 Пользовательский Flow

#### 3.1.1 Стартовый экран

- Кнопка выбора города (7 городов), поисковая строка, кнопка «Фильтр», кнопка «Далее»
- **Нижняя навигация (5 вкладок):** Поиск, Новости *(stub, Horizon 3-4)*, Карта, Избранное, Профиль
- С геолокацией: автоопределение города, дефолтная сортировка по расстоянию
- Без геолокации: выбор города вручную, сортировка по рейтингу, расстояния скрыты
- Мягкий запрос геолокации — баннер, один раз за сессию

#### 3.1.2 Фильтры

> Полные перечисления категорий, кухонь и атрибутов — см. **Приложение B**.

- **Расстояние:** 500м / 1км / 3км / 5км / 10км / Весь город (неактивно без геолокации)
- **Средний чек:** $ / $$ / $$$
- **Время работы:** До 22:00 / До утра / 24 часа
- **Категории:** 15 значений (Ресторан, Кафе, Кофейня, Фаст-фуд, Бар...)
- **Кухни:** 12 значений (Народная, Авторская, Азиатская, Европейская...)
- **Атрибуты:** 8 значений (Wi-Fi, Парковка, Терраса, Доставка...)
- **Логика:** OR внутри группы, AND между группами
- Кнопка «Применить» зафиксирована внизу при скролле

#### 3.1.3 Список заведений

- Верхняя панель: локация, фильтр, поиск, назад, сортировка, карта
- **Сортировка:** По расстоянию (недоступна без геолокации), По рейтингу, По увеличению/уменьшению чека
- Счётчик результатов + вертикальный список карточек с пагинацией
- **Карточка:** изображение, название, рейтинг, чек, категория/кухня, часы + «Открыто/Закрыто», расстояние, адрес, кнопка «В избранное»
- **Бейдж «АКЦИЯ»** на карточках с активной акцией (визуальный, без влияния на позицию)

**Ранжирование (честная выдача):**
- С геолокацией: PostGIS ST_Distance, тайбрейкеры: completeness → рейтинг → имя
- Без геолокации: по weighted_rating (байесовский средний, m=5, C=3.5), тайбрейкеры: review_count → completeness → имя
- По цене: $→1, $$→2, $$$→3, NULL→4

#### 3.1.4 Детальная карточка заведения

- **Галерея** — свайп/тап, полноэкранный просмотр. Кнопки: Назад, В избранное, Поделиться
- **Info overlay:** название, рейтинг, кол-во отзывов, чек, категория/кухня, часы + статус, телефон (кликабельный), email
- **Секция «Меню»:** режим работы по дням, спецпредложения, галерея фото меню (горизонтальный скролл)
- **Атрибуты:** иконки с подписями, горизонтальный скролл
- **Карта:** адрес, расстояние, Yandex Map с маркером (тап → полноэкранная)
- **Секция «Акции»:** триггер-баннер → bottom sheet с каруселью (PageView), индикатор-точки, аналитика `POST /analytics/promotion-view` (fire-and-forget)
- **Отзывы:** общий рейтинг, карусель отзывов (горизонтальный скролл), кнопка «Написать отзыв» (только авторизованные)

### 3.2 Личный кабинет пользователя

**Неавторизованный:** Войти, Зарегистрироваться, Настройки, Политика, Техподдержка. Отдельного flow «Для партнёров» нет — любой зарегистрированный пользователь становится партнёром, создав заведение и пройдя модерацию.

**Регистрация:** email, телефон (SMS-верификация), Google OAuth, Yandex OAuth. После — имя + фото (опционально).

**Авторизованный профиль:** Фото (загрузка через `POST /auth/avatar`), имя, счётчики отзывов/оценок. Секция «Ваши отзывы» — удаление, редактирование (24 часа).

**Избранное:** список с сортировкой, упрощённые фильтры, batch-проверка (`POST /favorites/check-batch`, до 50 ID).

### 3.3 Личный кабинет партнера

#### 3.3.1 Регистрация заведения (7 шагов)

1. Категория (до 2) → 2. Кухня (до 3) → 3. Основная инфо (название, описание, телефон, часы, чек, атрибуты) → 4. Медиа (интерьер/экстерьер + меню, до 20+20, выбор главного) → 5. Адрес (город, улица, дом) → 6. Юридическая инфо (УНП 9 цифр, юрлицо, контакт) → 7. Summary + отправка

**Двухшаговое создание:** POST → 'draft', POST /:id/submit → 'pending'.
**Верификация:** Claiming и верификация — независимые процессы. Документы отложенно, обязательны для платных функций. Проверка: формат УНП + egr.gov.by.

#### 3.3.2 Кабинет партнера

- Виньетки заведений (горизонтальный скролл): статус, фото, название, метрики (просмотры, избранное, отзывы)
- Действия: просмотр как пользователь, редактирование (без повторной модерации), добавление нового

#### 3.3.2a Акции (экран «Продвижение»)

- Секция «Активные (N/3)» — заголовок, дата окончания, просмотры. Действия: редактировать, деактивировать
- Секция «Завершённые»
- **Лимит:** max 3 активных на заведение (ошибка 400 при 4-й)
- **Создание:** название (макс 80), описание, изображение (Cloudinary), даты начала/окончания (null = бессрочная)
- **Phase 1:** акции бесплатны для всех партнёров, никакого UI оплаты

#### 3.3.3 Аналитика партнера

- Периоды: 7 / 30 / 90 дней + произвольный
- Метрики: просмотры, избранное, отзывы/оценки, completeness score, просмотры акций
- Графики с динамикой, % сравнение с предыдущим периодом
- Авто-агрегация: по дням (≤30), по неделям (31-90), по месяцам (>90)

#### 3.3.4 Управление отзывами

- Список отзывов с фильтрацией по периоду
- Ответ на отзыв (partner_response)
- Индикация: с ответом / без ответа

#### 3.3.5 Уведомления

**Backend:** Типы: `establishment_approved/rejected/suspended/unsuspended`, `review_received/response`, `system`. API: `GET /notifications` (пагинация + фильтр), `GET /unread-count`, `PUT /:id/read`, `PUT /read-all`.

**Mobile:** 30-сек polling, красная точка на «Профиль», колокольчик с счётчиком. Экран: группировка (Новые / Сегодня / На этой неделе / Ранее), фильтры (Все / Заведения / Отзывы), тап → навигация, pull-to-refresh + scroll pagination.

### 3.4 Административная панель (Web)

**Платформа:** Flutter Web (PWA, desktop-first). Sidebar 363px + content. GoRouter + auth guard.

#### 3.4.2 Реализовано (MVP)

**Дашборд:** 4 метрических карточки (пользователи, новые за месяц, активные заведения, ожидают модерации). 3 аналитических вкладки (Пользователи/Заведения/Отзывы) с графиками. Периоды: 7/30/90/произвольный. % сравнение. Авто-агрегация.

**Модерация (4 вкладки):**
- «Ожидающие» — очередь по времени, пагинация
- «Активные» — поиск, сортировка (дата/рейтинг/просмотры), фильтр по городу
- «Отклонённые» — история с причинами (read-only)
- «Приостановленные» — список с причинами, кнопка «Снять блокировку»
- Трёхпанельный layout: sidebar + карточки (400px) + детали (4 вкладки: Данные, О заведении, Медиа, Адрес)
- Действия: одобрить / отклонить (с причиной, per-field заметки) / заблокировать / разблокировать
- Коррекция координат: `PATCH /admin/establishments/:id/coordinates`
- Кросс-статусный поиск

**Отзывы:** Все отзывы (вкл. скрытые/удалённые). Фильтры: статус, рейтинг, период, текст. Действия: скрыть/показать, мягкое удаление.

**Claiming:** Кнопка «Передать партнёру» → диалог поиска пользователя → смена partner_id + role upgrade + claimed_at. Альтернатива: `POST /admin/users/:id/upgrade-to-partner`. Аудит-лог.

**Журнал действий:** Хронологический лог. Фильтры: действие, тип объекта, пользователь, период. Пагинация.

---

## Часть IV: Монетизация

> Основной документ: `docs/strategy/monetization_strategy_v0.5.md`. При расхождениях — приоритет у стратегии.

### 4.1 Философия

Честная выдача + монетизация через инструменты. Nirivio не продаёт позиции в выдаче. Все сортировки отражают реальные данные. На карточке заведения никогда не рекламируются конкуренты.

### 4.2 Два уровня

**Бесплатный — «Присутствие»:** полная карточка, полная аналитика, ответы на отзывы, честная позиция.

**Платный — «Продвижение»:** акции (бейдж + карусель, без влияния на позицию, **реализовано**, в Phase 1 бесплатно), бронирование (запланировано), push из «Избранного» (будущее).

**Подписка на уровне establishment**, не user.

### 4.3 Три фазы

- **Фаза 1** (запуск → 6-12 мес.): всё бесплатно, наполнение базы ← *текущая фаза*
- **Фаза 2** (6-12 → 1.5-2 года): один платный тариф, акции+бронирование в подписку
- **Фаза 3** (данные): дифференциация тарифов, раздел акций в «Новостях»

### 4.4 Claiming

Seed-карточки + claiming workflow:
- **Фаза 1:** ручной claiming через админку ← *реализовано*
- **Фаза 1.5:** invite-link claiming (когда seed > 50)
- **Фаза 3:** full self-service с верификацией

Claiming и верификация — независимые процессы.

### 4.5 Completeness Score

`base_score` — полнота карточки. Тайбрейкер в ранжировании + мотиватор (прогресс-бар). Поля: описание, price_range, атрибуты, телефон, email, website.

---
---

## Приложение A: Схема данных (справочное)

> Актуальное состояние: миграции 001-020 в `backend/migrations/`.

```
Users {
  id: UUID
  email: string (unique), phone: string (unique, optional)
  password_hash: string, name: string, avatar_url: string
  role: enum (user, partner, admin)
  auth_method: enum (email, phone, google, yandex)
  oauth_provider_id: string (nullable)
  email_verified: boolean, phone_verified: boolean
  is_active: boolean, last_login_at: timestamp (nullable)
  created_at, updated_at: timestamp
}

Establishments {
  id: UUID, partner_id: UUID (FK Users)
  name: string, description: text (nullable)
  city: varchar(50) — CHECK: 7 городов (Могилев + Могилёв)
  address: string, latitude: decimal, longitude: decimal
  location: geography(Point) — auto-computed
  phone, email, website: string (nullable)
  categories: array[varchar] (1-2, 15 значений)
  cuisines: array[varchar] (1-3, 12 значений)
  price_range: varchar(3) — $/$$/$$$ (nullable)
  working_hours: jsonb (NOT NULL), special_hours: jsonb (nullable)
  attributes: jsonb (default '{}'), is_24_hours: boolean
  status: enum (draft, pending, active, rejected, suspended, archived)
  moderation_notes: TEXT (NOT JSONB — stringify/parse)
  moderated_by: UUID, moderated_at: timestamp
  subscription_tier: varchar ('free'), subscription_started_at, subscription_expires_at
  base_score: integer (completeness), boost_score: integer (резерв, не используется)
  view_count, favorite_count, review_count: integer
  average_rating: decimal(3,2), primary_image_url: text
  average_check_byn: numeric(10,2) (nullable)
  is_seed: boolean — маркер seed-карточки (мигр. 019)
  claimed_at: timestamp — когда забрана партнёром (мигр. 019)
  created_at, updated_at, published_at: timestamp
}

Reviews {
  id: UUID, user_id, establishment_id: UUID
  rating: integer (1-5)
  text: text (legacy), content: text (мигр. 007)
  is_visible, is_edited, is_deleted: boolean
  partner_response: text, partner_response_at: timestamptz
  partner_responder_id: UUID
  created_at, updated_at: timestamp
}

EstablishmentMedia {
  id: UUID, establishment_id: UUID (CASCADE)
  type: enum (interior, exterior, menu, dishes)
  url: varchar(500), thumbnail_url (200x150), preview_url (800x600)
  caption: varchar(255), position: integer, is_primary: boolean
  created_at: timestamp
}

Favorites {
  id: UUID, user_id, establishment_id: UUID (CASCADE)
  created_at: timestamp
  UNIQUE(user_id, establishment_id)
}

Promotions {
  id: UUID, establishment_id: UUID (CASCADE)
  title: varchar(255), description: text
  terms_and_conditions: text (резерв)
  image_url, thumbnail_url, preview_url: varchar(500) (мигр. 020)
  valid_from: date, valid_until: date (nullable = бессрочная)
  status: varchar(20) — active/expired/hidden_by_admin (мигр. 020)
  position: integer, created_at, updated_at
  Лимит: max 3 активных, lazy expiry
}

Subscriptions {
  id: UUID, establishment_id: UUID (CASCADE)
  tier: enum (basic, standard, premium)
  duration_type: enum (day, three_days, week, month)
  started_at, expires_at: timestamp
  is_active, auto_renew: boolean
  Примечание: таблица создана, код не активен (Phase 1)
}

EstablishmentAnalytics {
  id: UUID, establishment_id: UUID (CASCADE), date: date
  view_count, detail_view_count, favorite_count, review_count: integer
  call_count: integer — клики на телефон
  promotion_view_count: integer
  UNIQUE(establishment_id, date) — UPSERT per day
}

RefreshTokens {
  id: UUID, user_id: UUID (CASCADE)
  token: varchar(500) (unique), expires_at: timestamp
  used_at: timestamp (ротация), replaced_by: UUID
}

PartnerDocuments {
  id: UUID, partner_id: UUID, establishment_id: UUID (nullable)
  document_type: varchar(50), document_url: varchar(500)
  company_name, tax_id (УНП 9 цифр), contact_person, contact_email
  verified: boolean, verified_by: UUID, verified_at: timestamp
}

Notifications {
  id: UUID, user_id: UUID (CASCADE)
  type: varchar(50), title: varchar(255), message: text
  establishment_id, review_id: UUID (nullable)
  is_read: boolean, created_at: timestamp
}

AuditLog {
  id: UUID, user_id: UUID
  action: varchar(100), entity_type: varchar(50), entity_id: UUID
  old_data, new_data: jsonb
  ip_address: inet, user_agent: text
  created_at: timestamp
}
```

---

## Приложение B: Полные перечисления (справочное)

**15 категорий заведений:** Ресторан, Кафе, Кофейня, Фаст-фуд, Бар, Кондитерская, Пиццерия, Пекарня, Паб, Столовая, Кальянная, Боулинг, Караоке, Бильярд, Клуб

**12 типов кухни:** Народная, Авторская, Азиатская, Американская, Вегетарианская, Японская, Грузинская, Итальянская, Смешанная, Европейская, Китайская, Восточная

**8 атрибутов:** Доставка еды, Wi-Fi, Организация банкетов, Летняя терраса, Залы для курящих, Детская зона, С домашними животными, Есть парковка

---

## Приложение C: Планируемые функции (справочное)

> Подробный статус — см. `docs/ROADMAP.md`

**Admin-панель (после MVP):**
- 2FA при входе
- Множественные уровни доступа (модератор, старший модератор, супер-админ)
- Экспорт данных из аналитики
- Управление подписками и платежами (таблица plans, не enum)
- Система уведомлений администраторам (push/email)
- Invite-link claiming (Фаза 1.5, когда seed > 50)
- Полуавтоматическая верификация партнёров (формат УНП + egr.gov.by)
- AI-модерация отзывов
- Модерация акций (admin → status='hidden_by_admin', инфраструктура готова)

**Платформа:**
- Вкладка «Новости» — контент-направление (Horizon 3-4)
- Бронирование столиков (Фаза 2)
- Push-уведомления пользователям из «Избранного» (будущее)
- Cron-агрегация метрик
- Офлайн-кэширование и синхронизация
- SendGrid email-уведомления
- GitHub Actions CI/CD
