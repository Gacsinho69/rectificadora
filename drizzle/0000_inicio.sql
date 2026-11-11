CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"actor_id" text,
	"actor_type" text NOT NULL,
	"user_id" text,
	"event_type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"target_id" text,
	"target_type" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"number" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"amount" integer NOT NULL,
	"status" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"failure_reason" text,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"target" text NOT NULL,
	"status" text NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impersonations" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"admin_ip" text,
	"user_agent" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"custom_domain" text,
	"region" text NOT NULL,
	"status" text NOT NULL,
	"plan" text NOT NULL,
	"limits_override" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"feature_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"billing_email" text NOT NULL,
	"billing_status" text NOT NULL,
	"mrr" integer DEFAULT 0 NOT NULL,
	"next_billing_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"support_access" boolean DEFAULT true NOT NULL,
	"mfa_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"tenant_id" text NOT NULL,
	"day" date NOT NULL,
	"api_calls" integer DEFAULT 0 NOT NULL,
	"storage_mb" integer DEFAULT 0 NOT NULL,
	"work_orders" integer DEFAULT 0 NOT NULL,
	"quotes" integer DEFAULT 0 NOT NULL,
	"documents" integer DEFAULT 0 NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "usage_daily_tenant_id_day_pk" PRIMARY KEY("tenant_id","day")
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_login_ip" text,
	"invited_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_tenantId_email_unique" UNIQUE("tenant_id","email")
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonations" ADD CONSTRAINT "impersonations_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonations" ADD CONSTRAINT "impersonations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonations" ADD CONSTRAINT "impersonations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_tenant_id_created_at_index" ON "events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "events_event_type_created_at_index" ON "events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "events_user_id_created_at_index" ON "events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "events_created_at_index" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "invoices_tenant_id_issued_at_index" ON "invoices" USING btree ("tenant_id","issued_at");--> statement-breakpoint
CREATE INDEX "api_keys_tenant_id_index" ON "api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "integrations_tenant_id_index" ON "integrations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "impersonations_tenant_id_started_at_index" ON "impersonations" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "impersonations_admin_id_index" ON "impersonations" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "tenants_status_index" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tenants_created_at_index" ON "tenants" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_tenant_id_last_login_at_index" ON "users" USING btree ("tenant_id","last_login_at");