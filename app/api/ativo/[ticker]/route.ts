/**
 * GET /api/ativo/{ticker} — preço (COTAHIST/EOD) + fundamentos (bolsai) do ativo.
 *
 * Proxy do §5.1: a tela NUNCA chama as fontes direto. Duas fontes, DUAS datas de
 * referência distintas — por isso o frescor é por bloco:
 *  - `preco`: fechamento (EOD) do ativo-objeto em `acao_cotahist` + variação
 *    derivada do pregão anterior (§6.2). Frescor = data-base do pregão.
 *  - `fundamentos`: múltiplos/retornos da bolsai via `obterFundamentos` (frescor
 *    pela tabela `fundamentos`, 5.4). Best-effort: se faltar, degrada para `null`.
 *
 * Preço EOD é o dado ESSENCIAL da tela (Bloco Técnico): sem fechamento ingerido
 * (fora da watchlist / sem COTAHIST) → 503. Fundamentos NÃO derrubam a rota.
 */
import { analisarTecnico } from "@/lib/analise-tecnica/analise-completa";
import { buscarCotacaoEodAtivo } from "@/lib/dados-opcoes/comum";
import { obterFundamentos } from "@/lib/fundamentos/repositorio";

import {
  erroIntegracao,
  exigirSessao,
  frescorDe,
  frescorEod,
  lerForcar,
  tickerSchema,
  erroParametro,
  type Frescor,
} from "../../_lib/http";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ ticker: string }> },
) {
  // 1) Sessão (§13) — 401 JSON se não autenticado.
  const negado = await exigirSessao();
  if (negado) return negado;

  // 2) Valida o parâmetro de entrada (Zod) antes de tocar no banco/rede.
  const { ticker: bruto } = await ctx.params;
  const parsed = tickerSchema.safeParse(bruto);
  if (!parsed.success) {
    return erroParametro("ticker inválido", parsed.error.issues);
  }
  const ticker = parsed.data;
  const forcar = lerForcar(request.url);

  try {
    // 3) Preço EOD (acao_cotahist) é essencial. Sem fechamento → 503.
    const preco = await buscarCotacaoEodAtivo(ticker);
    if (preco === null) {
      return Response.json(
        {
          erro: "sem dados de fechamento para este ativo",
          mensagem:
            "Ainda não há fechamento (COTAHIST) ingerido para este ativo. " +
            "Ele pode estar fora da watchlist ou sem dados de pregão.",
        },
        { status: 503 },
      );
    }

    // 4) Fundamentos (bolsai) são best-effort — não derrubam a tela.
    let fundamentos = null;
    let frescorFundamentos: Frescor | null = null;
    try {
      const r = await obterFundamentos(ticker, { forcarAtualizacao: forcar });
      fundamentos = r.dado;
      frescorFundamentos = frescorDe(r);
    } catch {
      // Indisponíveis (sem cobertura/sem linha) não quebram a tela (§6.3).
      fundamentos = null;
      frescorFundamentos = null;
    }

    // 5) Indicadores técnicos (T3) — best-effort também. Calculados sobre o MESMO
    // fechamento EOD do bloco de preço; `null` quando falta histórico suficiente
    // (ativo novo/sem ingestão). Nunca derrubam a tela.
    let tecnica = null;
    try {
      tecnica = await analisarTecnico(ticker);
    } catch {
      tecnica = null;
    }

    return Response.json({
      ticker,
      preco: {
        preco: preco.preco,
        variacao: preco.variacao,
        variacaoPercent: preco.variacaoPercent,
        volume: preco.volume,
        dataPregao: preco.dataPregao.toISOString(),
      },
      fundamentos,
      tecnica,
      frescor: {
        preco: frescorEod(preco.dataPregao),
        fundamentos: frescorFundamentos,
      },
    });
  } catch (e) {
    // Falha de banco/rede no preço essencial (§6.3).
    return erroIntegracao(e);
  }
}
