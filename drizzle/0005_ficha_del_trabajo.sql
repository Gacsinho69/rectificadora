ALTER TABLE "work_order_parts" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD COLUMN "part_number" text;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD COLUMN "size" text;--> statement-breakpoint
ALTER TABLE "work_order_tasks" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "work_order_tasks" ADD COLUMN "result" text;