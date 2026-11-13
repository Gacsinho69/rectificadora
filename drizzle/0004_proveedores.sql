CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"tax_id" text,
	"contact" text,
	"phone" text,
	"email" text,
	"address" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_tenantId_nameKey_unique" UNIQUE("tenant_id","name_key")
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "supplier_id" text;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD COLUMN "supplier_id" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD CONSTRAINT "work_order_parts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Los proveedores que se escribieron a mano antes de la lista pasan a ella: uno por nombre en cada rectificadora, sin
-- contar mayúsculas, tildes ni espacios (lo mismo que `claveDeProveedor`). Sus órdenes y repuestos quedan apuntándolos.
INSERT INTO "suppliers" ("id", "tenant_id", "name", "name_key")
SELECT 'prv_' || substr(md5(n."tenant_id" || ':' || n."clave"), 1, 12), n."tenant_id", min(n."nombre"), n."clave"
FROM (
	SELECT "tenant_id", btrim("supplier") AS "nombre", regexp_replace(lower(translate("supplier", 'ÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜÑÇáéíóúàèìòùâêîôûäëïöüñç', 'AEIOUAEIOUAEIOUAEIOUNCaeiouaeiouaeiouaeiounc')), '[^a-z0-9]', '', 'g') AS "clave" FROM "purchase_orders"
	UNION ALL
	SELECT "tenant_id", btrim("supplier"), regexp_replace(lower(translate("supplier", 'ÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜÑÇáéíóúàèìòùâêîôûäëïöüñç', 'AEIOUAEIOUAEIOUAEIOUNCaeiouaeiouaeiouaeiounc')), '[^a-z0-9]', '', 'g') FROM "work_order_parts" WHERE "supplier" IS NOT NULL
) n
WHERE length(n."clave") >= 2
GROUP BY n."tenant_id", n."clave";--> statement-breakpoint
UPDATE "purchase_orders" o SET "supplier_id" = s."id", "supplier" = s."name" FROM "suppliers" s
WHERE s."tenant_id" = o."tenant_id" AND s."name_key" = regexp_replace(lower(translate(o."supplier", 'ÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜÑÇáéíóúàèìòùâêîôûäëïöüñç', 'AEIOUAEIOUAEIOUAEIOUNCaeiouaeiouaeiouaeiounc')), '[^a-z0-9]', '', 'g');--> statement-breakpoint
UPDATE "work_order_parts" r SET "supplier_id" = s."id", "supplier" = s."name" FROM "suppliers" s
WHERE r."supplier" IS NOT NULL AND s."tenant_id" = r."tenant_id" AND s."name_key" = regexp_replace(lower(translate(r."supplier", 'ÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜÑÇáéíóúàèìòùâêîôûäëïöüñç', 'AEIOUAEIOUAEIOUAEIOUNCaeiouaeiouaeiouaeiounc')), '[^a-z0-9]', '', 'g');
