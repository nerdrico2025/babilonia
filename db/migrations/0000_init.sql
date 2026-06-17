CREATE TYPE "public"."leg_side" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."option_kind" AS ENUM('CALL', 'PUT');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('aberta', 'encerrada', 'rolada');--> statement-breakpoint
CREATE TYPE "public"."structure_type" AS ENUM('trava_alta', 'trava_baixa', 'borboleta', 'condor', 'straddle', 'strangle', 'venda_coberta');--> statement-breakpoint
CREATE TABLE "api_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_cache_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "leg" (
	"id" serial PRIMARY KEY NOT NULL,
	"position_id" integer NOT NULL,
	"option_symbol" text NOT NULL,
	"kind" "option_kind" NOT NULL,
	"side" "leg_side" NOT NULL,
	"strike" numeric(16, 2) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"quantity" integer NOT NULL,
	"premium" numeric(16, 2) NOT NULL,
	"delta" numeric(14, 6),
	"gamma" numeric(14, 6),
	"theta" numeric(14, 6),
	"vega" numeric(14, 6),
	"rho" numeric(14, 6),
	"iv" numeric(14, 6),
	"greeks_source_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position" (
	"id" serial PRIMARY KEY NOT NULL,
	"underlying" text NOT NULL,
	"structure" "structure_type" NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "position_status" DEFAULT 'aberta' NOT NULL,
	"max_risk" numeric(16, 2) NOT NULL,
	"max_gain" numeric(16, 2),
	"risk_defined" boolean NOT NULL,
	"breakevens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"total_capital" numeric(16, 2) DEFAULT '0' NOT NULL,
	"display_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket" (
	"id" serial PRIMARY KEY NOT NULL,
	"position_id" integer NOT NULL,
	"content" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
ALTER TABLE "leg" ADD CONSTRAINT "leg_position_id_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."position"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_position_id_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."position"("id") ON DELETE cascade ON UPDATE no action;