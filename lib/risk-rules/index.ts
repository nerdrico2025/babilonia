/**
 * risk-rules — gestão de risco e capital (§10 do PRD).
 *
 * Módulo PURO: recebe o resultado de uma estrutura (de `options-math`), o
 * capital total (de `settings`) e o book aberto; devolve uma avaliação por regra
 * com SEMÁFORO (verde/amarelo/vermelho) + texto claro para iniciante (§2).
 *
 * Comportamento (§2, princípio 3 — "a decisão é do usuário"): estas regras
 * ALERTAM com força, mas NUNCA impedem. `vermelho` significa "muito acima do
 * limite, repense" — não é um bloqueio.
 *
 * Capital total vem de `settings`; é a base das regras de risco (não das de
 * concentração, que usam o tamanho do book).
 */

import type { ResultadoEstrutura } from "@/lib/options-math";

// ── Limites do §10 (frações do capital / do book) ────────────────────────────

/** Limites de risco/capital do §10 do PRD. */
export const RISK_LIMITS = {
  /** Risco definido (travas, borboletas, condores): até 5% do capital. */
  definedRiskMaxFraction: 0.05,
  /** Risco indefinido (venda nua, straddle/strangle vendido): margem até 10%. */
  undefinedRiskMaxFraction: 0.1,
  /** Concentração por ativo-objeto: máx. 20% do book aberto. */
  concentrationPerUnderlying: 0.2,
  /** Concentração por vencimento: máx. 30% do book aberto. */
  concentrationPerExpiry: 0.3,
  /** Proximidade de vencimento: alertar nos últimos ~5 dias úteis. */
  expiryWarningBusinessDays: 5,
} as const;

/**
 * Banda de alerta: quando o uso atinge ≥ 80% do limite (mas ainda dentro dele),
 * o semáforo fica AMARELO — um aviso de que se está chegando perto do teto.
 */
const BANDA_ALERTA = 0.8;

// Tolerância para comparações de ponto flutuante (percentuais).
const EPS = 1e-9;

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Semáforo de risco (§10). */
export type Semaforo = "verde" | "amarelo" | "vermelho";

/** Identificador de cada regra avaliada. */
export type RegraRisco =
  | "risco_capital"
  | "concentracao_ativo"
  | "concentracao_vencimento"
  | "proximidade_vencimento";

/** Uma posição do book de opções aberto. */
export interface PosicaoBook {
  /** Ativo-objeto (ex.: "PETR4"). */
  ativoObjeto: string;
  /** Vencimento da posição. */
  vencimento: Date;
  /**
   * Exposição em BRL usada para medir concentração: capital em risco (risco
   * definido) ou margem comprometida (risco indefinido). É o "peso" da posição
   * no book.
   */
  exposicao: number;
}

/** A operação candidata sendo avaliada antes de virar ticket. */
export interface OperacaoCandidata {
  /** Resultado da estrutura, vindo de `options-math`. */
  estrutura: ResultadoEstrutura;
  /** Ativo-objeto da operação. */
  ativoObjeto: string;
  /** Vencimento da operação. */
  vencimento: Date;
  /**
   * Margem requerida pela corretora em BRL — OBRIGATÓRIA para risco INDEFINIDO
   * (o risco máximo é ilimitado; a margem é o que dá para medir contra os 10%).
   * Ignorada para risco definido (lá o peso é o próprio risco máximo).
   */
  margemRequerida?: number;
}

/** Avaliação de UMA regra: semáforo + texto claro. */
export interface AvaliacaoRisco {
  regra: RegraRisco;
  semaforo: Semaforo;
  texto: string;
}

/** Opções de avaliação (data de referência e feriados injetáveis). */
export interface OpcoesAvaliacao {
  /** "Hoje" para a contagem de dias úteis. Default: data atual do sistema. */
  hoje?: Date;
  /**
   * Feriados da B3 a excluir da contagem de dias úteis. Ver nota de
   * simplificação em `diasUteisEntre`.
   */
  feriados?: Date[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Classifica uma fração contra um limite (verde/amarelo/vermelho). */
function classificar(fracao: number, limite: number): Semaforo {
  if (fracao > limite + EPS) return "vermelho";
  if (fracao >= BANDA_ALERTA * limite - EPS) return "amarelo";
  return "verde";
}

/** Formata uma fração como percentual em pt-BR (0.075 → "7,5%"). */
function pct(fracao: number): string {
  const v = Math.round(fracao * 1000) / 10; // 1 casa decimal
  const txt = Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ",");
  return `${txt}%`;
}

/** Relação com o limite, para compor a frase do texto. */
function relacaoComLimite(semaforo: Semaforo): string {
  if (semaforo === "vermelho") return "acima do";
  if (semaforo === "amarelo") return "perto do";
  return "dentro do";
}

/** Chave AAAA-M-D (UTC) de uma data, para comparar dias e feriados. */
function chaveDia(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/** Meia-noite UTC de uma data (normaliza para evitar erros de fuso). */
function meiaNoiteUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Conta os DIAS ÚTEIS no intervalo (`de`, `ate`] — exclui `de`, inclui `ate`.
 * Exclui sábados e domingos e os `feriados` informados.
 *
 * ⚠️ SIMPLIFICAÇÃO documentada (§10): não há calendário de feriados da B3
 * embutido no MVP. Por padrão só fins de semana são excluídos; os feriados
 * nacionais/B3 devem ser injetados via `feriados` (lista de datas). Quando
 * houver fonte oficial (ANBIMA/B3), basta alimentar essa lista — o cálculo não
 * muda.
 *
 * 📅 Fuso: as datas são reduzidas ao DIA do calendário UTC (`meiaNoiteUTC`).
 * Vencimentos são datas (sem hora), então em BRT (UTC−3) a meia-noite local cai
 * às 03:00 UTC do MESMO dia — sem deslocamento. Só haveria off-by-one se um
 * chamador passasse um `Date` com hora tardia (ex.: 23h BRT já é o dia seguinte
 * em UTC); ao integrar, passe vencimentos como data pura.
 */
export function diasUteisEntre(de: Date, ate: Date, feriados: Date[] = []): number {
  const inicio = meiaNoiteUTC(de);
  const fim = meiaNoiteUTC(ate);
  if (fim.getTime() <= inicio.getTime()) return 0;

  const feriadosSet = new Set(feriados.map((f) => chaveDia(meiaNoiteUTC(f))));
  let count = 0;
  const cursor = new Date(inicio);
  // Avança dia a dia a partir do dia seguinte a `de`, até `ate` (inclusive).
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getTime() > fim.getTime()) break;
    const diaSemana = cursor.getUTCDay(); // 0 domingo … 6 sábado
    if (diaSemana === 0 || diaSemana === 6) continue;
    if (feriadosSet.has(chaveDia(cursor))) continue;
    count++;
  }
  return count;
}

// ── Regras ───────────────────────────────────────────────────────────────────

/** Regra de capital em risco (5% definido / 10% indefinido). */
function avaliarRiscoCapital(
  operacao: OperacaoCandidata,
  capitalTotal: number,
): AvaliacaoRisco {
  const { estrutura } = operacao;
  const indefinido = estrutura.rotulo_risco === "INDEFINIDO";

  if (capitalTotal <= 0) {
    return {
      regra: "risco_capital",
      semaforo: "amarelo",
      texto:
        "Configure seu capital total em Configurações para avaliar quanto " +
        "desta operação ficaria em risco.",
    };
  }

  if (!indefinido) {
    // Risco DEFINIDO: mede o risco máximo (em BRL) contra 5% do capital.
    const limite = RISK_LIMITS.definedRiskMaxFraction;
    const fracao = estrutura.risco_maximo / capitalTotal;
    const semaforo = classificar(fracao, limite);
    return {
      regra: "risco_capital",
      semaforo,
      texto:
        `Esta operação usaria ${pct(fracao)} do seu capital em risco — ` +
        `${relacaoComLimite(semaforo)} limite de ${pct(limite)} para risco definido.`,
    };
  }

  // Risco INDEFINIDO: usa a margem requerida contra 10%; SEMPRE alerta.
  const limite = RISK_LIMITS.undefinedRiskMaxFraction;
  const aviso =
    " Atenção: esta é uma operação de risco INDEFINIDO — a perda real pode " +
    "superar o prêmio recebido.";

  if (operacao.margemRequerida == null) {
    return {
      regra: "risco_capital",
      semaforo: "amarelo",
      texto:
        "Informe a margem requerida pela corretora para checar o limite de " +
        `${pct(limite)} do capital.${aviso}`,
    };
  }

  const fracao = operacao.margemRequerida / capitalTotal;
  // Risco indefinido NUNCA fica verde: no mínimo amarelo (sempre alertar).
  const bruto = classificar(fracao, limite);
  const semaforo: Semaforo = bruto === "verde" ? "amarelo" : bruto;
  return {
    regra: "risco_capital",
    semaforo,
    texto:
      `Esta operação usaria ${pct(fracao)} do seu capital em margem — ` +
      `${relacaoComLimite(semaforo)} limite de ${pct(limite)} para risco indefinido.${aviso}`,
  };
}

/** Exposição (peso no book) da operação candidata. */
function exposicaoCandidata(operacao: OperacaoCandidata): number {
  if (operacao.estrutura.rotulo_risco === "INDEFINIDO") {
    return operacao.margemRequerida ?? 0;
  }
  return operacao.estrutura.risco_maximo;
}

/** Regra genérica de concentração (por ativo ou por vencimento). */
function avaliarConcentracao(
  regra: "concentracao_ativo" | "concentracao_vencimento",
  operacao: OperacaoCandidata,
  book: PosicaoBook[],
  limite: number,
  mesmoGrupo: (p: PosicaoBook) => boolean,
  rotuloGrupo: string,
): AvaliacaoRisco {
  const expoCand = exposicaoCandidata(operacao);
  const totalBook = book.reduce((acc, p) => acc + p.exposicao, 0) + expoCand;
  const totalGrupo =
    book.filter(mesmoGrupo).reduce((acc, p) => acc + p.exposicao, 0) + expoCand;

  if (totalBook <= 0) {
    return {
      regra,
      semaforo: "verde",
      texto: `Sem exposição no book ainda — concentração por ${rotuloGrupo} em 0%.`,
    };
  }

  const fracao = totalGrupo / totalBook;
  const semaforo = classificar(fracao, limite);
  const dimensao = regra === "concentracao_ativo" ? "ativo-objeto" : "vencimento";
  return {
    regra,
    semaforo,
    texto:
      `Depois desta operação, ${rotuloGrupo} representaria ${pct(fracao)} do seu ` +
      `book aberto — ${relacaoComLimite(semaforo)} limite de ${pct(limite)} por ${dimensao}.`,
  };
}

/** Regra de proximidade de vencimento (~5 dias úteis). */
function avaliarProximidadeVencimento(
  operacao: OperacaoCandidata,
  opcoes: OpcoesAvaliacao,
): AvaliacaoRisco {
  const hoje = opcoes.hoje ?? new Date();
  const dias = diasUteisEntre(hoje, operacao.vencimento, opcoes.feriados ?? []);
  const limite = RISK_LIMITS.expiryWarningBusinessDays;

  if (dias <= 0) {
    return {
      regra: "proximidade_vencimento",
      semaforo: "vermelho",
      texto:
        "O vencimento é hoje ou já passou — encerre ou role a posição com " +
        "urgência para evitar exercício/atribuição inesperado.",
    };
  }
  if (dias <= 1) {
    return {
      regra: "proximidade_vencimento",
      semaforo: "vermelho",
      texto:
        `Falta apenas ${dias} dia útil para o vencimento — considere encerrar ` +
        "ou rolar a posição já.",
    };
  }
  if (dias <= limite) {
    return {
      regra: "proximidade_vencimento",
      semaforo: "amarelo",
      texto:
        `Faltam ${dias} dias úteis para o vencimento (limite de alerta: ` +
        `${limite}) — pense em encerrar ou rolar para evitar exercício/atribuição.`,
    };
  }
  return {
    regra: "proximidade_vencimento",
    semaforo: "verde",
    texto: `Faltam ${dias} dias úteis para o vencimento — sem urgência.`,
  };
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Avalia uma operação candidata contra TODAS as regras do §10 e devolve uma
 * avaliação por regra (semáforo + texto claro). Não impede nada (§2).
 *
 * @param operacao     operação candidata (estrutura + ativo + vencimento)
 * @param capitalTotal capital total do usuário (de `settings`), em BRL
 * @param book         posições do book de opções aberto
 * @param opcoes       data de referência e feriados (opcionais)
 */
export function avaliarRisco(
  operacao: OperacaoCandidata,
  capitalTotal: number,
  book: PosicaoBook[] = [],
  opcoes: OpcoesAvaliacao = {},
): AvaliacaoRisco[] {
  return [
    avaliarRiscoCapital(operacao, capitalTotal),
    avaliarConcentracao(
      "concentracao_ativo",
      operacao,
      book,
      RISK_LIMITS.concentrationPerUnderlying,
      (p) => p.ativoObjeto === operacao.ativoObjeto,
      operacao.ativoObjeto,
    ),
    avaliarConcentracao(
      "concentracao_vencimento",
      operacao,
      book,
      RISK_LIMITS.concentrationPerExpiry,
      (p) =>
        chaveDia(meiaNoiteUTC(p.vencimento)) ===
        chaveDia(meiaNoiteUTC(operacao.vencimento)),
      "este vencimento",
    ),
    avaliarProximidadeVencimento(operacao, opcoes),
  ];
}
