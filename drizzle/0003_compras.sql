CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"number" integer NOT NULL,
	"supplier" text NOT NULL,
	"driver_id" text,
	"expected_at" date,
	"notes" text,
	"status" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "purchase_orders_tenantId_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "work_order_parts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"work_order_id" text NOT NULL,
	"quote_id" text,
	"description" text NOT NULL,
	"quantity" real DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"supplier" text,
	"unit_cost" integer,
	"needed_by_task_id" text,
	"status" text NOT NULL,
	"purchase_order_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"received_by" text
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD CONSTRAINT "work_order_parts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD CONSTRAINT "work_order_parts_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD CONSTRAINT "work_order_parts_needed_by_task_id_work_order_tasks_id_fk" FOREIGN KEY ("needed_by_task_id") REFERENCES "public"."work_order_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD CONSTRAINT "work_order_parts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_id_status_index" ON "purchase_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_id_driver_id_index" ON "purchase_orders" USING btree ("tenant_id","driver_id");--> statement-breakpoint
CREATE INDEX "work_order_parts_work_order_id_index" ON "work_order_parts" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "work_order_parts_tenant_id_status_index" ON "work_order_parts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "work_order_parts_purchase_order_id_index" ON "work_order_parts" USING btree ("purchase_order_id");