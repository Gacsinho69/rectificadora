CREATE TABLE "purchase_order_supplies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"purchase_order_id" text NOT NULL,
	"supply_id" text NOT NULL,
	"quantity" real NOT NULL,
	"unit_cost" integer,
	"status" text NOT NULL,
	"received_at" timestamp with time zone,
	"received_by" text
);
--> statement-breakpoint
CREATE TABLE "supplies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"brand" text,
	"part_number" text,
	"supplier_id" text,
	"min_stock" real DEFAULT 0 NOT NULL,
	"stock" real DEFAULT 0 NOT NULL,
	"unit_cost" integer,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"supply_id" text NOT NULL,
	"quantity" real NOT NULL,
	"kind" text NOT NULL,
	"work_order_id" text,
	"purchase_order_id" text,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_order_supplies" ADD CONSTRAINT "purchase_order_supplies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_supplies" ADD CONSTRAINT "purchase_order_supplies_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_supplies" ADD CONSTRAINT "purchase_order_supplies_supply_id_supplies_id_fk" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_movements" ADD CONSTRAINT "supply_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_movements" ADD CONSTRAINT "supply_movements_supply_id_supplies_id_fk" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_movements" ADD CONSTRAINT "supply_movements_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_movements" ADD CONSTRAINT "supply_movements_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_supplies_purchase_order_id_index" ON "purchase_order_supplies" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_supplies_tenant_id_status_index" ON "purchase_order_supplies" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "supplies_tenant_id_index" ON "supplies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "supply_movements_supply_id_index" ON "supply_movements" USING btree ("supply_id");--> statement-breakpoint
CREATE INDEX "supply_movements_tenant_id_index" ON "supply_movements" USING btree ("tenant_id");