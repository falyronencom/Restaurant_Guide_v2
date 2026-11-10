-- Rollback 042: the moved photos get their former type back.
--
-- Only rows still of the venue's kind go back (a photo the partner has since
-- deleted is gone, and its line went with it). The code keeps working: it
-- reads `exterior` and `dishes` as photos of the venue
-- (backend/src/constants/mediaKinds.js). Look first:
--   SELECT type, count(*) FROM establishment_media_kinds_042 GROUP BY 1;

BEGIN;

-- As in 042: wait for the locks at most 5 s; on a timeout nothing is changed.
SET LOCAL lock_timeout = '5s';

UPDATE establishment_media m
   SET type = k.type
  FROM establishment_media_kinds_042 k
 WHERE m.id = k.media_id AND m.type = 'interior';

DROP TABLE IF EXISTS establishment_media_kinds_042;

COMMIT;
