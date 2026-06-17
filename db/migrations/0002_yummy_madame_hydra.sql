CREATE TABLE "opcao_cotahist" (
	"id" serial PRIMARY KEY NOT NULL,
	"option_symbol" text NOT NULL,
	"underlying" text,
	"kind" "option_kind" NOT NULL,
	"strike" numeric(16, 2) NOT NULL,
	"trade_date" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"preco_abertura" numeric(16, 2) NOT NULL,
	"preco_minimo" numeric(16, 2) NOT NULL,
	"preco_medio" numeric(16, 2) NOT NULL,
	"preco_maximo" numeric(16, 2) NOT NULL,
	"preco_fechamento" numeric(16, 2) NOT NULL,
	"bid" numeric(16, 2) NOT NULL,
	"ask" numeric(16, 2) NOT NULL,
	"volume_financeiro" numeric(18, 2) NOT NULL,
	"numero_negocios" integer NOT NULL,
	"quantidade_titulos" numeric(18, 0) NOT NULL,
	"fator_cotacao" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "opcao_cotahist_symbol_data_uq" ON "opcao_cotahist" USING btree ("option_symbol","trade_date");