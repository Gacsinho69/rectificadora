CREATE TABLE "service_specialists" (
	"tenant_id" text NOT NULL,
	"service_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_specialists_service_id_user_id_pk" PRIMARY KEY("service_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "task_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"task_id" text NOT NULL,
	"work_order_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "cylinders" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "valves_per_cylinder" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "heads" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "criterion" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "piece" text DEFAULT 'motor' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "step" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "typical" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_tasks" ADD COLUMN "piece" text DEFAULT 'motor' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_tasks" ADD COLUMN "step" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_tasks" ADD COLUMN "advanced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_order_tasks" ADD COLUMN "advanced_by" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "cylinders" integer;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "valves_per_cylinder" integer;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "heads" integer;--> statement-breakpoint
ALTER TABLE "service_specialists" ADD CONSTRAINT "service_specialists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_specialists" ADD CONSTRAINT "service_specialists_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_specialists" ADD CONSTRAINT "service_specialists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_holds" ADD CONSTRAINT "task_holds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_holds" ADD CONSTRAINT "task_holds_task_id_work_order_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."work_order_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_holds" ADD CONSTRAINT "task_holds_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_specialists_tenant_id_index" ON "service_specialists" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "task_holds_work_order_id_index" ON "task_holds" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "task_holds_tenant_id_index" ON "task_holds" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_holds_task_id_index" ON "task_holds" USING btree ("task_id") WHERE "task_holds"."resolved_at" is null;--> statement-breakpoint
-- Para las rectificadoras que ya existían: cada actividad con su pieza, su paso y si va en el desglose, según su código.
-- El criterio sale de la unidad que ya tenía (su precio ya era por esa unidad), y los trabajos de sus OT toman la
-- pieza y el paso de la actividad de la que vienen.
UPDATE "services" AS s SET "piece" = r.pieza, "step" = r.paso, "typical" = r.tipico
FROM (VALUES
  ('D-01', 'motor', 10, true),
  ('D-02', 'motor', 20, true),
  ('D-03', 'motor', 30, false),
  ('D-04', 'culata', 30, true),
  ('T-01', 'culata', 110, false),
  ('C-01', 'culata', 120, true),
  ('C-04', 'culata', 130, false),
  ('C-05', 'culata', 140, false),
  ('C-02', 'culata', 150, true),
  ('C-03', 'culata', 150, true),
  ('C-06', 'culata', 160, true),
  ('B-05', 'block', 110, false),
  ('B-03', 'block', 120, false),
  ('B-04', 'block', 130, true),
  ('B-01', 'block', 140, true),
  ('B-02', 'block', 150, true),
  ('B-06', 'block', 160, false),
  ('G-04', 'cigüeñal', 110, false),
  ('T-03', 'cigüeñal', 120, false),
  ('G-01', 'cigüeñal', 130, true),
  ('T-02', 'cigüeñal', 140, false),
  ('G-02', 'cigüeñal', 150, true),
  ('G-03', 'cigüeñal', 160, false),
  ('G-06', 'bielas', 110, false),
  ('G-05', 'bielas', 120, true),
  ('A-02', 'motor', 200, false),
  ('A-01', 'motor', 210, true),
  ('A-03', 'motor', 220, true),
  ('Q-01', 'motor', 300, true)
) AS r(codigo, pieza, paso, tipico)
WHERE s."code" = r.codigo;--> statement-breakpoint
UPDATE "services" SET "criterion" = CASE
  WHEN "unit" = 'cilindro' THEN 'per_cylinder'
  WHEN "unit" IN ('válvula', 'asiento', 'guía') THEN 'per_valve'
  WHEN "unit" = 'biela' THEN 'per_rod'
  WHEN "unit" = 'culata' THEN 'per_head'
  ELSE 'fixed'
END;--> statement-breakpoint
UPDATE "work_order_tasks" AS t SET "piece" = s."piece", "step" = s."step"
FROM "services" AS s
WHERE t."service_id" = s."id";
