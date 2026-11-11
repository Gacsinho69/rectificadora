CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"contact" text,
	"phone" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"number" integer NOT NULL,
	"customer_id" text NOT NULL,
	"work_order_id" text,
	"engine" text NOT NULL,
	"lines" jsonb NOT NULL,
	"discount_pct" integer DEFAULT 0 NOT NULL,
	"net" integer NOT NULL,
	"tax" integer NOT NULL,
	"total" integer NOT NULL,
	"notes" text,
	"status" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "quotes_tenantId_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"section_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"price" integer,
	"std_hours" real DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "services_tenantId_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "shop_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"work_order_id" text NOT NULL,
	"section_id" text NOT NULL,
	"service_id" text,
	"name" text NOT NULL,
	"quantity" real DEFAULT 1 NOT NULL,
	"std_minutes" integer DEFAULT 0 NOT NULL,
	"position" integer NOT NULL,
	"status" text NOT NULL,
	"assigned_to" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"finished_by" text
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"number" integer NOT NULL,
	"customer_id" text NOT NULL,
	"quote_id" text,
	"engine" text NOT NULL,
	"engine_serial" text,
	"equipment" text,
	"pieces" text[] NOT NULL,
	"complaint" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"due_date" date,
	"status" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"qc_approved_at" timestamp with time zone,
	"qc_approved_by" text,
	"delivered_at" timestamp with time zone,
	"delivered_to" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "work_orders_tenantId_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_section_id_shop_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."shop_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_sections" ADD CONSTRAINT "shop_sections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_tasks" ADD CONSTRAINT "work_order_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_tasks" ADD CONSTRAINT "work_order_tasks_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_tasks" ADD CONSTRAINT "work_order_tasks_section_id_shop_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."shop_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_tenant_id_index" ON "customers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "quotes_tenant_id_status_index" ON "quotes" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "quotes_tenant_id_created_at_index" ON "quotes" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "shop_sections_tenant_id_index" ON "shop_sections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "work_order_tasks_work_order_id_index" ON "work_order_tasks" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "work_order_tasks_tenant_id_section_id_status_index" ON "work_order_tasks" USING btree ("tenant_id","section_id","status");--> statement-breakpoint
CREATE INDEX "work_order_tasks_tenant_id_assigned_to_index" ON "work_order_tasks" USING btree ("tenant_id","assigned_to");--> statement-breakpoint
CREATE INDEX "work_orders_tenant_id_status_index" ON "work_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "work_orders_tenant_id_created_at_index" ON "work_orders" USING btree ("tenant_id","created_at");