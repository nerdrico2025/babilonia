/**
 * dados-opcoes/skew — ORQUESTRADOR de skew automático put/call (Fase 2-V1).
 *
 * A peça intermediária que faltava: dado um ativo + vencimento, seleciona um par
 * put OTM / call OTM COMPARÁVEL a partir da cadeia, resolve a IV de cada lado e
 * alimenta a leitura pura `lerSkew` (§8.2/§9). Hoje isso é 100% manual na UI (dois
 * inputs no bloco de volatilidade) — este módulo só cria o caminho AUTOMÁTICO; a UI
 * manual permanece como fallback (V2). NÃO conecta a rota/UI ainda.
 *
 * Server-only: COMPÕE `getCadeiaCotahist` (mesma função da /api/cadeia — sem
 * duplicar query) e `getGregasCotahist` (mesmo solver de IV por opção — sem
 * reimplementar), e delega a interpretação a `lerSkew` (pura). A seleção do par é
 * PURA e testável (`selecionarParOtm`).
 *
 * Critério "comparável" = DISTÂNCIA PERCENTUAL DO SPOT (geométrico): não depende de
 * resolver a IV antes de selecionar (o delta exigiria isso — dependência circular).
 */

import { lerSkew } from "@/lib/analise/volatilidade";
import type { CadeiaOpcoes } from "@/lib/opcoes/tipos";

import {
  getCadeiaCotahist,
  type LinhaOpcaoCadeia,
  type ResultadoCadeiaCotahist,
} from "./cadeia";
import { getGregasCotahist } from "./gregas";

/** Alvo de distância OTM (em % do spot) para escolher os strikes do par. */
export const DISTANCIA_OTM_PADRAO = 5;

/**
 * Largura da faixa "comparável" ao redor do alvo, RELATIVA ao alvo. Com 0,6 e alvo
 * 5%, conta como candidato razoável todo strike entre 2% e 8% OTM (5%·[1−0,6, 1+0,6]).
 * Relativa para escalar junto com o alvo. Strikes fora da faixa NÃO são forçados —
 * preferimos `null` a um par ruim (cadeia rala).
 */
const TOLERANCIA_RELATIVA = 0.6;

/** Par OTM selecionado (linhas cruas da cadeia, para transparência a jusante). */
export interface ParOtm {
  put: LinhaOpcaoCadeia;
  call: LinhaOpcaoCadeia;
}

/** Dia (UTC) de um vencimento, para casar linhas com o vencimento-alvo. */
function diaUtc(d: Date | string): string {
  return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
}

/**
 * Seleciona o par put OTM / call OTM COMPARÁVEL de um vencimento, por distância
 * percentual do spot. FUNÇÃO PURA (sem banco/rede).
 *
 * Para cada lado, considera só os strikes do lado OTM correspondente (put abaixo do
 * spot, call acima) cuja distância% caia DENTRO da faixa comparável (alvo ±
 * `TOLERANCIA_RELATIVA`); entre esses, escolhe o MAIS PRÓXIMO do alvo. Devolve
 * `null` explicitamente quando falta candidato razoável em QUALQUER lado (cadeia
 * rala, vencimento sem strikes dos dois lados, spot inválido) — nunca força um par.
 */
export function selecionarParOtm(
  linhas: readonly LinhaOpcaoCadeia[],
  spot: number,
  vencimento: Date | string,
  distanciaPercentual: number = DISTANCIA_OTM_PADRAO,
): ParOtm | null {
  if (!(spot > 0) || !(distanciaPercentual > 0)) return null;

  const alvoDia = diaUtc(vencimento);
  const banda = distanciaPercentual * TOLERANCIA_RELATIVA;
  const min = distanciaPercentual - banda;
  const max = distanciaPercentual + banda;
  const doVenc = linhas.filter((l) => diaUtc(l.expiresAt) === alvoDia);

  /** O candidato com distância dentro da faixa MAIS PRÓXIMO do alvo (ou `null`). */
  const melhor = (
    candidatos: LinhaOpcaoCadeia[],
    distancia: (l: LinhaOpcaoCadeia) => number,
  ): LinhaOpcaoCadeia | null => {
    let escolhido: LinhaOpcaoCadeia | null = null;
    let menorDelta = Infinity;
    for (const l of candidatos) {
      const d = distancia(l);
      if (d < min || d > max) continue; // fora da faixa "comparável"
      const delta = Math.abs(d - distanciaPercentual);
      if (delta < menorDelta) {
        menorDelta = delta;
        escolhido = l;
      }
    }
    return escolhido;
  };

  const put = melhor(
    doVenc.filter((l) => l.kind === "put" && l.strike > 0 && l.strike < spot),
    (l) => ((spot - l.strike) / spot) * 100,
  );
  const call = melhor(
    doVenc.filter((l) => l.kind === "call" && l.strike > spot),
    (l) => ((l.strike - spot) / spot) * 100,
  );

  if (!put || !call) return null;
  return { put, call };
}

/** Metadado de um lado do par usado (transparência: não é caixa-preta). */
export interface LadoSkew {
  symbol: string;
  strike: number;
  /** IV resolvida (percentual, ex.: 28.16). */
  iv: number;
  /** Distância% do spot (positiva: quão OTM o strike está). */
  distanciaPercentual: number;
}

/** Resultado do skew automático: disponível (com par e leitura) ou não (com motivo). */
export type ResultadoSkewAutomatico =
  | {
      disponivel: true;
      /** IV(put) − IV(call), em pontos de % (de `lerSkew`). */
      diferenca: number;
      /** Leitura de iniciante (de `lerSkew`, pura). */
      leitura: string;
      /** Qual par embasou o skew (o usuário deve poder ver). */
      parUsado: {
        vencimento: string;
        spot: number;
        put: LadoSkew;
        call: LadoSkew;
      };
    }
  | { disponivel: false; motivo: string };

/** Reconstrói as linhas cruas a partir da `CadeiaOpcoes` (inverso de `mapearLinha`). */
function cadeiaParaLinhas(cadeia: CadeiaOpcoes): LinhaOpcaoCadeia[] {
  const linhas: LinhaOpcaoCadeia[] = [];
  for (const v of cadeia.vencimentos) {
    const expiresAt = new Date(v.vencimento);
    for (const s of v.strikes) {
      for (const op of [s.call, s.put]) {
        if (!op) continue;
        linhas.push({
          optionSymbol: op.symbol,
          kind: op.tipo,
          strike: op.strike,
          expiresAt,
          // `OpcaoCadeia` normaliza "0 = sem oferta" → null; aqui o inverso. Os
          // campos de volume não entram na seleção (por strike) — coalesce a 0.
          bid: op.bid ?? 0,
          ask: op.ask ?? 0,
          quantidadeTitulos: op.volume ?? 0,
          volumeFinanceiro: op.volumeFinanceiro ?? 0,
          numeroNegocios: op.negocios ?? 0,
        });
      }
    }
  }
  return linhas;
}

/** Resolve a IV (percentual) de UMA opção pelo símbolo; `null` se inviável. */
async function resolverIvPadrao(symbol: string): Promise<number | null> {
  try {
    const { gregas } = await getGregasCotahist(symbol);
    return gregas.iv;
  } catch {
    // Símbolo inexistente / prêmio inviável: degradação coerente (§2.4/§2.6).
    return null;
  }
}

/** Dependências injetáveis (default = funções reais; sobrescritas em teste). */
export interface DepsSkew {
  buscarCadeia?: (ativo: string) => Promise<ResultadoCadeiaCotahist>;
  resolverIv?: (symbol: string) => Promise<number | null>;
}

/**
 * Skew automático do ativo num vencimento. Busca a cadeia (reaproveita
 * `getCadeiaCotahist`), seleciona o par OTM comparável, resolve a IV de cada lado
 * (reaproveita `getGregasCotahist`) e interpreta com `lerSkew`. Nunca lança:
 * ausência de par, falta de spot ou IV inviável viram `{ disponivel: false, motivo }`.
 */
export async function calcularSkewAutomatico(
  ativo: string,
  vencimento: Date | string,
  opcoes: { distanciaPercentual?: number; deps?: DepsSkew } = {},
): Promise<ResultadoSkewAutomatico> {
  const distancia = opcoes.distanciaPercentual ?? DISTANCIA_OTM_PADRAO;
  const buscarCadeia = opcoes.deps?.buscarCadeia ?? ((a: string) => getCadeiaCotahist(a));
  const resolverIv = opcoes.deps?.resolverIv ?? resolverIvPadrao;

  const { cadeia } = await buscarCadeia(ativo);
  const spot = cadeia.precoAtivo;
  if (spot == null || !(spot > 0)) {
    return {
      disponivel: false,
      motivo: "Sem preço do ativo-objeto neste pregão para situar os strikes OTM.",
    };
  }

  const par = selecionarParOtm(cadeiaParaLinhas(cadeia), spot, vencimento, distancia);
  if (!par) {
    return {
      disponivel: false,
      motivo:
        "Não há strikes OTM comparáveis disponíveis para este vencimento " +
        "(cadeia rala ou sem strikes nos dois lados do spot).",
    };
  }

  const [ivPut, ivCall] = await Promise.all([
    resolverIv(par.put.optionSymbol),
    resolverIv(par.call.optionSymbol),
  ]);
  if (ivPut == null || ivCall == null) {
    return {
      disponivel: false,
      motivo:
        "Não foi possível resolver a volatilidade implícita de um dos lados do par " +
        "(prêmio inviável ou sem oferta nos dois lados).",
    };
  }

  const { diferenca, leitura } = lerSkew(ivPut, ivCall);
  return {
    disponivel: true,
    diferenca,
    leitura,
    parUsado: {
      vencimento: par.put.expiresAt.toISOString(),
      spot,
      put: {
        symbol: par.put.optionSymbol,
        strike: par.put.strike,
        iv: ivPut,
        distanciaPercentual: ((spot - par.put.strike) / spot) * 100,
      },
      call: {
        symbol: par.call.optionSymbol,
        strike: par.call.strike,
        iv: ivCall,
        distanciaPercentual: ((par.call.strike - spot) / spot) * 100,
      },
    },
  };
}
