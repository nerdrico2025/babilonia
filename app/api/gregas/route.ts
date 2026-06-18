/**
 * GET /api/gregas — gregas + IV de UMA opção via Black-Scholes próprio (COTAHIST, §6.4 #2).
 *
 * As gregas/IV NÃO vêm na cadeia (§6.4 #2): são calculadas por opção, sob demanda,
 * pelo NOSSO Black-Scholes (`lib/dados-opcoes/gregas` → `lib/options-math`), a partir
 * do prêmio de fechamento + spot (COTAHIST) + SELIC (BCB-SGS). Esta rota é o
 * consumidor — último a sair da OpLab (passo 4.5).
 *
 * Query:
 *  - `symbol`   (obrigatório) — ticker exato da opção (ex.: PETRK221);
 *  - `irate`    (OPCIONAL)    — Meta Selic % a.a. (override). EM BRANCO, o módulo
 *                               auto-preenche a SELIC do BCB-SGS na data-base (§4.3).
 *                               É convertida aqui para a taxa CONTÍNUA (`ln(1+i/100)`)
 *                               que o Black-Scholes espera — a mesma forma do auto.
 *  - `vol`, `spotprice`, `strike`, `premium`, `dtm` (opcionais, números);
 *  - `tipo`     (opcional) — call | put.
 *
 * Frescor: derivado do `as-of` (trade_date da série), como na rota da cadeia (EOD).
 */
import { z } from "zod";

import { getGregasCotahist } from "@/lib/dados-opcoes/gregas";
import { taxaContinua } from "@/lib/integrations/bcb-sgs";

import {
  erroIntegracao,
  exigirSessao,
  frescorEod,
  erroParametro,
} from "../_lib/http";

/** Número vindo da query string (texto → number). */
const numeroQuery = z.coerce.number().finite();

const gregasQuerySchema = z.object({
  symbol: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{5,12}$/, "símbolo de opção inválido")),
  irate: numeroQuery.optional(), // opcional: em branco → auto-SELIC do BCB-SGS (§4.3).
  vol: numeroQuery.optional(),
  spotprice: numeroQuery.optional(),
  strike: numeroQuery.optional(),
  premium: numeroQuery.optional(),
  dtm: numeroQuery.optional(),
  tipo: z.enum(["call", "put"]).optional(),
});

export async function GET(request: Request) {
  const negado = await exigirSessao();
  if (negado) return negado;

  // Lê e valida a query (Zod). Só `symbol` é obrigatório; `irate` é override.
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = gregasQuerySchema.safeParse(params);
  if (!parsed.success) {
    return erroParametro(
      "parâmetros da calculadora de gregas inválidos",
      parsed.error.issues,
    );
  }

  const { symbol, irate, vol, spotprice, strike, premium, dtm, tipo } = parsed.data;
  // Override: Meta Selic % a.a. → taxa contínua. Ausente → o módulo busca a SELIC.
  const r = irate != null ? taxaContinua(irate) : undefined;

  try {
    const { gregas, asOf } = await getGregasCotahist(symbol, {
      r,
      vol,
      spotprice,
      strike,
      premium,
      dtm,
      tipo,
    });
    return Response.json({
      symbol,
      gregas,
      frescor: frescorEod(asOf),
    });
  } catch (e) {
    return erroIntegracao(e);
  }
}
