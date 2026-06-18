/**
 * GET /api/gregas — gregas + IV de UMA opção via calculadora BS (OpLab, §6.4 #2).
 *
 * As gregas/IV NÃO vêm na cadeia ao vivo (§6.4 #2): são calculadas por opção na
 * calculadora Black-Scholes da OpLab, passando a SELIC em `irate`. Esta rota é o
 * proxy disso (esconde o token, usa cache da camada `lib/integrations/oplab`).
 *
 * Query:
 *  - `symbol`   (obrigatório) — ticker exato da opção (ex.: PETRK221);
 *  - `irate`    (obrigatório) — taxa de juros % (SELIC), de `GET /market/interest_rates`;
 *  - `vol`, `spotprice`, `strike`, `premium`, `dtm` (opcionais, números);
 *  - `tipo`     (opcional) — call | put;
 *  - `forcar=true` (opcional) — ignora o cache válido.
 */
import { z } from "zod";

import { getGregas } from "@/lib/integrations/oplab";
import type { ParamsGregas } from "@/lib/opcoes/tipos";

import {
  erroIntegracao,
  exigirSessao,
  frescorDe,
  lerForcar,
  erroParametro,
} from "../_lib/http";

/** Número vindo da query string (texto → number), opcional. */
const numeroQuery = z.coerce.number().finite();

const gregasQuerySchema = z.object({
  symbol: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{5,12}$/, "símbolo de opção inválido")),
  irate: numeroQuery, // obrigatório: sem juros não há cálculo BS confiável.
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

  // Lê e valida a query (Zod). `irate`/`symbol` são obrigatórios.
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = gregasQuerySchema.safeParse(params);
  if (!parsed.success) {
    return erroParametro(
      "parâmetros da calculadora de gregas inválidos",
      parsed.error.issues,
    );
  }

  const forcar = lerForcar(request.url);
  const args: ParamsGregas = parsed.data;

  try {
    const r = await getGregas(args, { forcar });
    return Response.json({
      symbol: args.symbol,
      gregas: r.dado,
      frescor: frescorDe(r),
    });
  } catch (e) {
    return erroIntegracao(e);
  }
}
