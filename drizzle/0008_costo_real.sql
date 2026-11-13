ALTER TABLE "purchase_order_supplies" ADD COLUMN "real_cost" integer;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD COLUMN "unit_price" integer;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD COLUMN "real_cost" integer;