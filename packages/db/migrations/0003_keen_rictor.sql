ALTER TABLE `events` ADD `batch_id` text;--> statement-breakpoint
ALTER TABLE `events` ADD `undo_of` text;--> statement-breakpoint
CREATE INDEX `events_batch_idx` ON `events` (`batch_id`);--> statement-breakpoint
CREATE INDEX `events_undo_idx` ON `events` (`undo_of`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `agent_state` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `agent_claimed_by` text;