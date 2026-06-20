ALTER TABLE "position" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "position" ADD COLUMN "exit_price" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "position" ADD COLUMN "realized_pnl" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "position" ADD COLUMN "rolled_into_position_id" integer;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_rolled_into_position_id_position_id_fk" FOREIGN KEY ("rolled_into_position_id") REFERENCES "public"."position"("id") ON DELETE set null ON UPDATE no action;