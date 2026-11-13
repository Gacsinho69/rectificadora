ALTER TABLE "supplies" ADD COLUMN "kind" text DEFAULT 'supply' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD COLUMN "supply_id" text;