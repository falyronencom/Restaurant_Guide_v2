-- Rollback 038: forget the dishes hidden apart from the menu files.
--
-- The hidden rows of menu_items stay hidden; only the memory that outlives a
-- deleted file goes. The code keeps working (it checks for the table before
-- use) and follows a hidden dish only into files whose hidden rows remain.

BEGIN;

-- As in 038: wait for the locks at most 5 s; on a timeout nothing is dropped.
SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS menu_item_hidden_names;

COMMIT;
