-- Тестовые данные стенда Maestro: владелец карточек и шесть заведений Минска.
--
-- Накатывается скриптом e2e.sh (шаг `db`) на отдельную локальную базу
-- maestro_e2e поверх схемы прода — тот же рецепт, что у CI. Ни прод, ни снимок
-- прода стенд не трогает: тестовые брони и отзывы увидели бы настоящие
-- заведения.
--
-- Почему своими строками, а не scripts/seed-establishments.js: тот загружает
-- фото в Cloudinary, а локальный backend/.env смотрит в боевое облако. Здесь
-- фото нет вовсе — приложение показывает заглушку, сценариям фото не нужны.
--
-- Названия, которые сценарии набирают в поиске, — латиницей: ввод кириллицы
-- через adb на Android ненадёжен. Остальные — по-русски, как в жизни.
--
-- Слово «Maestro» — только у двух заведений «Maestro …»: сценарий 02 сверяет
-- «Результаты: 2» — так видно, что поиск отбирает, а не показывает всё
-- подряд. Поиск ищет и по описаниям: в описания остальных это слово не
-- вписывать (в первой версии стенда оно стояло во всех шести, и поиск
-- честно находил все шесть).
--
-- Тестового пользователя здесь нет намеренно: пароль в репозиторий не кладём.
-- Его заводит e2e.sh (шаг `user`) запросом регистрации к локальному серверу,
-- почта и пароль — из локального файла .maestro/.env.local (в git не попадает).
--
-- Идентификаторы постоянные: повторный прогон шага `db` пересоздаёт базу
-- целиком, а по постоянным id проще сверять запросы в журнале сервера.

BEGIN;

INSERT INTO users (id, email, password_hash, name, role, auth_method,
                   email_verified, is_active)
VALUES ('e2e00000-0000-4000-8000-000000000001', 'maestro-partner@example.com',
        NULL, 'Maestro Partner', 'partner', 'email', true, true);

-- Часы работы — круглые сутки каждый день: сценарий не должен зависеть от
-- того, в котором часу его запустили («Закрыто» поверх карточки).
CREATE TEMP TABLE e2e_hours AS
SELECT jsonb_build_object(
  'monday',    jsonb_build_object('open', '00:00', 'close', '23:59'),
  'tuesday',   jsonb_build_object('open', '00:00', 'close', '23:59'),
  'wednesday', jsonb_build_object('open', '00:00', 'close', '23:59'),
  'thursday',  jsonb_build_object('open', '00:00', 'close', '23:59'),
  'friday',    jsonb_build_object('open', '00:00', 'close', '23:59'),
  'saturday',  jsonb_build_object('open', '00:00', 'close', '23:59'),
  'sunday',    jsonb_build_object('open', '00:00', 'close', '23:59')
) AS hours;

INSERT INTO establishments (
  id, partner_id, name, slug, description, city, address,
  latitude, longitude, location, phone, categories, cuisines, price_range,
  working_hours, status, published_at
)
SELECT v.id::uuid, 'e2e00000-0000-4000-8000-000000000001', v.name, v.slug,
       v.description, 'Минск', v.address, v.lat, v.lon,
       ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326)::geography,
       '+375291234567', v.categories, v.cuisines, v.price_range,
       (SELECT hours FROM e2e_hours), 'active', CURRENT_TIMESTAMP
FROM (VALUES
  ('e2e00000-0000-4000-8000-000000000101', 'Maestro Bistro', 'maestro-bistro',
   'Тестовое заведение стенда Maestro: европейская и итальянская кухня.',
   'пр. Независимости, 1', 53.89380000, 27.54710000,
   ARRAY['Ресторан']::varchar[], ARRAY['Европейская', 'Итальянская']::varchar[], '$$'),
  ('e2e00000-0000-4000-8000-000000000102', 'Maestro Coffee', 'maestro-coffee',
   'Тестовая кофейня стенда сквозных проверок.',
   'ул. Ленина, 5', 53.89750000, 27.55590000,
   ARRAY['Кофейня']::varchar[], ARRAY['Европейская']::varchar[], '$'),
  ('e2e00000-0000-4000-8000-000000000103', 'Тестовая столовая', 'testovaya-stolovaya',
   'Тестовая столовая стенда сквозных проверок.',
   'ул. Немига, 3', 53.90300000, 27.55100000,
   ARRAY['Столовая']::varchar[], ARRAY['Народная']::varchar[], '$'),
  ('e2e00000-0000-4000-8000-000000000104', 'Пробный паб', 'probnyy-pab',
   'Тестовый паб стенда сквозных проверок.',
   'ул. Зыбицкая, 9', 53.90620000, 27.55580000,
   ARRAY['Паб']::varchar[], ARRAY['Европейская']::varchar[], '$$'),
  ('e2e00000-0000-4000-8000-000000000105', 'Демо-пиццерия', 'demo-pizzeriya',
   'Тестовая пиццерия стенда сквозных проверок.',
   'пр. Победителей, 7', 53.90810000, 27.54830000,
   ARRAY['Пиццерия']::varchar[], ARRAY['Итальянская']::varchar[], '$$'),
  ('e2e00000-0000-4000-8000-000000000106', 'Учебное кафе', 'uchebnoe-kafe',
   'Тестовое кафе стенда сквозных проверок.',
   'ул. Карла Маркса, 12', 53.89870000, 27.56050000,
   ARRAY['Кафе']::varchar[], ARRAY['Смешанная']::varchar[], '$$$')
) AS v(id, name, slug, description, address, lat, lon, categories, cuisines, price_range);

COMMIT;
