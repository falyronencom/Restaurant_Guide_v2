-- Fix city CHECK constraint: add Могилёв (with ё) alongside Могилев
ALTER TABLE establishments DROP CONSTRAINT IF EXISTS establishments_city_check;
ALTER TABLE establishments ADD CONSTRAINT establishments_city_check
  CHECK (city IN ('Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Могилев', 'Могилёв', 'Бобруйск'));

-- Clean partial seed data from failed run
DELETE FROM establishment_media;
DELETE FROM establishments;
DELETE FROM users WHERE email = 'seed.data.generator@restaurantguide.by';
