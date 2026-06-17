ALTER TABLE "leg" ALTER COLUMN "side" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."leg_side";--> statement-breakpoint
CREATE TYPE "public"."leg_side" AS ENUM('compra', 'venda');--> statement-breakpoint
ALTER TABLE "leg" ALTER COLUMN "side" SET DATA TYPE "public"."leg_side" USING "side"::"public"."leg_side";--> statement-breakpoint
ALTER TABLE "leg" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."option_kind";--> statement-breakpoint
CREATE TYPE "public"."option_kind" AS ENUM('call', 'put');--> statement-breakpoint
ALTER TABLE "leg" ALTER COLUMN "kind" SET DATA TYPE "public"."option_kind" USING "kind"::"public"."option_kind";