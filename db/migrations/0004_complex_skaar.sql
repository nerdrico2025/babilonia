CREATE TABLE "iv_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"ativo" text NOT NULL,
	"trade_date" timestamp with time zone NOT NULL,
	"iv" numeric(14, 6) NOT NULL,
	"vencimento_usado" timestamp with time zone NOT NULL,
	"opcao_usada" text NOT NULL,
	"tipo_usado" "option_kind" NOT NULL,
	"spot_usado" numeric(16, 2) NOT NULL,
	"r_usado" numeric(14, 6) NOT NULL,
	"t_anos" numeric(14, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "iv_history_ativo_data_uq" ON "iv_history" USING btree ("ativo","trade_date");