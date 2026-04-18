# Применение миграций на Railway (production)

Скрипт `apply-migration-production.js` применяет SQL-миграцию к production-базе, читая credentials из локального файла `backend/.env.production` — пароль никогда не покидает ваш ноутбук.

## Первичная настройка (один раз)

### 1. Получить DATABASE_URL из Railway

1. Откройте [Railway dashboard](https://railway.app/) → проект Restaurant_Guide_v2
2. Кликните на сервис **Postgres**
3. Перейдите на вкладку **Variables** (или **Connect**)
4. Скопируйте значение переменной `DATABASE_URL` (выглядит как `postgresql://postgres:<password>@turntable.proxy.rlwy.net:<port>/railway`)

### 2. Создать файл `backend/.env.production`

В папке `backend/` создайте файл с именем `.env.production` (точка в начале, без расширения) и вставьте туда одну строку:

```
DATABASE_URL=postgresql://postgres:<ваш_пароль>@turntable.proxy.rlwy.net:<порт>/railway
```

**Важно:**
- Файл **не попадёт в git** — он в `.gitignore` (`.env.*`).
- Файл лежит только на вашем компьютере.
- Если вы пересядете на другой ноутбук, процесс повторяется — никакой синхронизации credentials через репозиторий.

### 3. Проверить что работает

Запустите в корне проекта:

```bash
cd backend
node scripts/apply-migration-production.js
```

Должно вывести подсказку по использованию. Если вместо этого видите `❌ Missing backend/.env.production` — файл не создан либо создан не в той папке.

---

## Применение миграции

Из папки `backend/`:

```bash
node scripts/apply-migration-production.js <имя-миграции>
```

**Пример:**

```bash
node scripts/apply-migration-production.js 023_add_file_type_to_media
```

(имя — без расширения `.sql`)

### Что делает скрипт

1. **Показывает summary:** host, пользователь, имя файла, кол-во строк SQL, первые 40 строк миграции — для визуальной проверки
2. **Спрашивает подтверждение:** нужно ввести `yes` вручную — защита от случайного запуска
3. **Применяет миграцию** и выводит ✅ либо ошибку

### Пример вывода

```
════════════════════════════════════════════════════════
  PRODUCTION MIGRATION — review before confirming
════════════════════════════════════════════════════════
  Host:     turntable.proxy.rlwy.net:44099/railway
  User:     postgres
  File:     023_add_file_type_to_media.sql
  Lines:    19
════════════════════════════════════════════════════════

--- SQL preview (first 19 lines) ---
-- Migration 023: Add file_type column to establishment_media
...
---

Apply this migration? Type "yes" to confirm: yes
✓ Connected to production DB
→ Applying migration...

✅ Migration applied successfully.
```

---

## Типовой workflow разработки

1. Claude создаёт миграцию в `backend/migrations/NNN_name.sql`
2. Claude применяет её локально на `pg-test` для тестирования
3. Когда всё готово и сессия закончена — вы запускаете `node scripts/apply-migration-production.js NNN_name` на своём ноутбуке
4. Пароль от production не попадает в чат, не попадает в git

---

## Безопасность

- `backend/.env.production` **никогда не коммитится** (покрыт `.env.*` в `.gitignore`)
- Пароль существует только локально и в Railway
- Если вы случайно закоммитили `.env.production` — немедленно ротируйте `POSTGRES_PASSWORD` в Railway и удалите файл из истории git через `git-filter-repo`
- При смене ноутбука — создайте файл заново из Railway, старый не копируйте через небезопасные каналы

## Troubleshooting

**`❌ Missing backend/.env.production`**
Файл не создан или создан не в папке `backend/`. Проверьте путь.

**`❌ DATABASE_URL is not set`**
Файл пустой или содержит не тот ключ. Должна быть строка `DATABASE_URL=postgresql://...`.

**`❌ Migration failed: ... already exists`**
Миграция уже была применена. Наши миграции используют `IF NOT EXISTS` где возможно, но некоторые DDL-операции не идемпотентны. Проверьте текущую схему в Railway через `psql` или Railway dashboard.

**`❌ Migration failed: SSL connection required`**
Обновите скрипт — в `apply-migration-production.js` должна быть строка `ssl: { rejectUnauthorized: false }`.

**Timeout / connection error**
Проверьте, что Railway Postgres сервис запущен (dashboard → Postgres → статус). Проверьте интернет-соединение.
