-- Rollback for migration 029: Remove Могилёв (ё-variant) from city CHECK.
--
-- WARNING: Running this rollback on a database that contains 'Могилёв'
-- (with ё) rows will fail at constraint validation. Verify no such rows
-- exist before rolling back:
--   SELECT count(*) FROM establishments WHERE city = 'Могилёв';

ALTER TABLE establishments
  DROP CONSTRAINT IF EXISTS establishments_city_check;

ALTER TABLE establishments
  ADD CONSTRAINT establishments_city_check
  CHECK (city IN ('Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Могилев', 'Бобруйск'));
