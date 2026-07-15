ALTER TABLE `event_log` ADD `updated_at` integer;
--> statement-breakpoint
-- C1: backfill existing rows so updated_at starts equal to timestamp ("not edited since creation").
-- createEvent/updateEvent (event.service) stamp it going forward; the unclosed derivation reads it.
UPDATE `event_log` SET `updated_at` = `timestamp`;
