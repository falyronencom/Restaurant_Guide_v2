-- Normalize English cuisine and category values to Russian in establishments table
-- Run this once to fix test/seed data that was inserted with English values
--
-- Usage: psql -d restaurant_guide_belarus -f backend/scripts/normalize-cuisine-categories.sql

BEGIN;

-- ============================================
-- 1. Normalize cuisines (English → Russian)
-- ============================================

UPDATE establishments SET cuisines = array_replace(cuisines, 'belarusian', 'Народная')       WHERE 'belarusian' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'national', 'Народная')         WHERE 'national' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'european', 'Европейская')      WHERE 'european' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'italian', 'Итальянская')       WHERE 'italian' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'asian', 'Азиатская')           WHERE 'asian' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'american', 'Американская')     WHERE 'american' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'georgian', 'Грузинская')       WHERE 'georgian' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'japanese', 'Японская')         WHERE 'japanese' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'vegetarian', 'Вегетарианская') WHERE 'vegetarian' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'mixed', 'Смешанная')           WHERE 'mixed' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'international', 'Смешанная')   WHERE 'international' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'continental', 'Континентальная') WHERE 'continental' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'indian', 'Индийская')          WHERE 'indian' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'mediterranean', 'Средиземноморская') WHERE 'mediterranean' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'fusion', 'Авторская')          WHERE 'fusion' = ANY(cuisines);
UPDATE establishments SET cuisines = array_replace(cuisines, 'author', 'Авторская')          WHERE 'author' = ANY(cuisines);

-- ============================================
-- 2. Normalize categories (English → Russian)
-- ============================================

UPDATE establishments SET categories = array_replace(categories, 'restaurant', 'Ресторан')     WHERE 'restaurant' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'cafe', 'Кофейня')            WHERE 'cafe' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'bar', 'Бар')                 WHERE 'bar' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'fast_food', 'Фаст-фуд')     WHERE 'fast_food' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'pizzeria', 'Пиццерия')       WHERE 'pizzeria' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'bakery', 'Пекарня')          WHERE 'bakery' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'pub', 'Паб')                 WHERE 'pub' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'canteen', 'Столовая')        WHERE 'canteen' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'hookah_lounge', 'Кальянная') WHERE 'hookah_lounge' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'hookah_bar', 'Кальянная')    WHERE 'hookah_bar' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'bowling', 'Боулинг')         WHERE 'bowling' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'karaoke', 'Караоке')         WHERE 'karaoke' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'billiards', 'Бильярд')       WHERE 'billiards' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'nightclub', 'Клуб')          WHERE 'nightclub' = ANY(categories);
UPDATE establishments SET categories = array_replace(categories, 'confectionery', 'Кондитерская') WHERE 'confectionery' = ANY(categories);

-- ============================================
-- 3. Verification — check for remaining English values
-- ============================================

SELECT 'Remaining English cuisines:' AS check_type,
       unnest(cuisines) AS value,
       count(*) AS count
FROM establishments
WHERE cuisines::text ~ '[a-z]'
GROUP BY unnest(cuisines)
HAVING unnest(cuisines) ~ '^[a-z]'
ORDER BY count DESC;

SELECT 'Remaining English categories:' AS check_type,
       unnest(categories) AS value,
       count(*) AS count
FROM establishments
WHERE categories::text ~ '[a-z]'
GROUP BY unnest(categories)
HAVING unnest(categories) ~ '^[a-z]'
ORDER BY count DESC;

COMMIT;
