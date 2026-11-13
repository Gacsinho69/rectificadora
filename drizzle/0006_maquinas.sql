CREATE TABLE "machine_services" (
	"tenant_id" text NOT NULL,
	"machine_id" text NOT NULL,
	"service_id" text NOT NULL,
	CONSTRAINT "machine_services_machine_id_service_id_pk" PRIMARY KEY("machine_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "machine_stops" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"machine_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"started_at" timestamp with time zone NOT NULL,
	"started_by" text,
	"ended_at" timestamp with time zone,
	"ended_by" text
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"section_id" text,
	"notes" text,
	"maintenance_every_days" integer,
	"last_maintenance_at" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "machine_services" ADD CONSTRAINT "machine_services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_services" ADD CONSTRAINT "machine_services_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_services" ADD CONSTRAINT "machine_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_stops" ADD CONSTRAINT "machine_stops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_stops" ADD CONSTRAINT "machine_stops_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_section_id_shop_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."shop_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "machine_services_tenant_id_index" ON "machine_services" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "machine_stops_tenant_id_index" ON "machine_stops" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "machine_stops_machine_id_index" ON "machine_stops" USING btree ("machine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "machine_stops_una_abierta" ON "machine_stops" USING btree ("machine_id") WHERE "machine_stops"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "machines_tenant_id_index" ON "machines" USING btree ("tenant_id");