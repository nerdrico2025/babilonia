/**
 * book — agregação do BOOK aberto para o Dashboard (tela 2, §8.1).
 *
 * Módulo PURO e testável. Recebe as posições abertas (persistidas) + o capital
 * total e devolve os indicadores de gestão de risco com SEMÁFORO (§10): % do
 * capital em risco, concentração por ativo e por vencimento, vencimento mais
 * próximo e alertas de proximidade de vencimento.
 *
 * Reaproveita o que já é fonte da verdade em `lib/risk-rules`: os limites do §10
 * (`RISK_LIMITS`) e a contagem de dias úteis (`diasUteisEntre`). Risco antes do
 * ganho (§2): o foco é a exposição, não o lucro.
 *
 * Convenção de EXPOSIÇÃO (peso no book), igual à do `risk-rules`: risco definido
 * pesa pelo risco máximo; risco indefinido pesa pela margem comprometida. Como a
 * persistência já grava `maxRisk` finito (margem quando indefinido), usamos
 * `maxRisk` diretamente como exposição.
 */

import { TAMANHO_LOTE_PADRAO, type LadoOperacao } from "@/lib/options-math";
import {
  RISK_LIMITS,
  diasUteisEntre,
  type OpcoesAvaliacao,
  type Semaforo,
} from "@/lib/risk-rules";

/**
 * Teto de portfólio do MVP para o % do capital em risco somando o book inteiro.
 *
 * ⚠️ Heurística do MVP (ajustável, §15): o §10 define limites POR OPERAÇÃO (5%
 * definido / 10% indefinido) e de CONCENTRAÇÃO (20%/30% do book). Não há, no PRD,
 * um teto explícito para a SOMA do capital em risco do book — então adotamos um
 * orçamento de portfólio conservador aqui, documentado, para alimentar o semáforo
 * do §8.1 sem inventar regra escondida.
 */
export const BOOK_LIMITES = {
  /** Acima disto, o capital total em risco fica "vermelho" (repense). */
  capitalEmRiscoMaximo: 0.25,
} as const;

/** Banda de alerta: ao atingir 80% do limite, o semáforo já fica amarelo. */
const BANDA_ALERTA = 0.8;
const EPS = 1e-9;

/** Uma posição aberta do book (campos persistidos relevantes ao risco). */
export interface PosicaoAberta {
  id: number;
  /** Ativo-objeto (ex.: "PETR4"). */
  underlying: string;
  /** Família da estrutura (§7). */
  structure: string;
  /** Vencimento da posição. */
  expiresAt: Date;
  /** Risco máximo em BRL, sempre finito (margem quando indefinido). */
  maxRisk: number;
  /** Ganho máximo em BRL, ou null quando ilimitado. */
  maxGain: number | null;
  /** `true` = risco DEFINIDO; `false` = INDEFINIDO (§2). */
  riskDefined: boolean;
  /** Ponto(s) de equilíbrio. */
  breakevens: number[];
}

/** Concentração de um grupo (ativo ou vencimento) no book. */
export interface Concentracao<T> {
  chave: T;
  /** Fração do book aberto (0..1). */
  fracao: number;
}

/** Resumo agregado do book — base dos cartões do dashboard (§8.1). */
export interface ResumoBook {
  /** Nº de posições abertas. */
  quantidade: number;
  /** Soma das exposições (BRL). */
  riscoTotal: number;
  /** `true` se há ao menos uma posição de risco indefinido (atenção redobrada). */
  temIndefinido: boolean;
  /** Capital total considerado (BRL). */
  capitalTotal: number;
  /** Fração do capital em risco; `null` se o capital não foi configurado. */
  fracaoCapital: number | null;
  semaforoCapital: Semaforo;
  /** Pior concentração por ativo-objeto; `null` se o book está vazio. */
  concentracaoAtivo: Concentracao<string> | null;
  semaforoConcentracaoAtivo: Semaforo;
  /** Pior concentração por vencimento; `null` se o book está vazio. */
  concentracaoVencimento: Concentracao<Date> | null;
  semaforoConcentracaoVencimento: Semaforo;
  /** Vencimento mais próximo entre as posições; `null` se vazio. */
  vencimentoMaisProximo: Date | null;
  /** Dias úteis até o vencimento mais próximo; `null` se vazio. */
  diasAteVencimentoMaisProximo: number | null;
}

/** Classifica uma fração contra um limite (verde/amarelo/vermelho), §10. */
function classificar(fracao: number, limite: number): Semaforo {
  if (fracao > limite + EPS) return "vermelho";
  if (fracao >= BANDA_ALERTA * limite - EPS) return "amarelo";
  return "verde";
}

/** Chave AAAA-M-D (UTC) de uma data, para agrupar vencimentos. */
function chaveDia(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/**
 * Pior concentração do book por uma chave (ativo ou vencimento): soma a
 * exposição de cada grupo e devolve o grupo de maior fração. `null` se vazio.
 */
function piorConcentracao<T>(
  posicoes: PosicaoAberta[],
  chaveDe: (p: PosicaoAberta) => string,
  valorDe: (p: PosicaoAberta) => T,
): Concentracao<T> | null {
  const total = posicoes.reduce((acc, p) => acc + p.maxRisk, 0);
  if (posicoes.length === 0 || total <= 0) return null;

  const somas = new Map<string, { soma: number; valor: T }>();
  for (const p of posicoes) {
    const k = chaveDe(p);
    const atual = somas.get(k);
    if (atual) atual.soma += p.maxRisk;
    else somas.set(k, { soma: p.maxRisk, valor: valorDe(p) });
  }

  let pior: Concentracao<T> | null = null;
  for (const { soma, valor } of somas.values()) {
    const fracao = soma / total;
    if (!pior || fracao > pior.fracao) pior = { chave: valor, fracao };
  }
  return pior;
}

/**
 * Resume o book aberto em indicadores com semáforo (§8.1, §10). Não impede nada
 * (§2): é leitura de risco, não bloqueio.
 */
export function resumirBook(
  posicoes: PosicaoAberta[],
  capitalTotal: number,
  opcoes: OpcoesAvaliacao = {},
): ResumoBook {
  const hoje = opcoes.hoje ?? new Date();
  const feriados = opcoes.feriados ?? [];

  const riscoTotal = posicoes.reduce((acc, p) => acc + p.maxRisk, 0);
  const temIndefinido = posicoes.some((p) => !p.riskDefined);

  // % do capital em risco (book inteiro) — orçamento de portfólio (heurística MVP).
  let fracaoCapital: number | null = null;
  let semaforoCapital: Semaforo;
  if (capitalTotal <= 0) {
    semaforoCapital = "amarelo"; // sem capital configurado, não dá para medir
  } else {
    fracaoCapital = riscoTotal / capitalTotal;
    semaforoCapital = classificar(fracaoCapital, BOOK_LIMITES.capitalEmRiscoMaximo);
  }

  const concentracaoAtivo = piorConcentracao(
    posicoes,
    (p) => p.underlying,
    (p) => p.underlying,
  );
  const concentracaoVencimento = piorConcentracao(
    posicoes,
    (p) => chaveDia(p.expiresAt),
    (p) => p.expiresAt,
  );

  // Vencimento mais próximo (menor data) e dias úteis até ele.
  let vencimentoMaisProximo: Date | null = null;
  for (const p of posicoes) {
    if (!vencimentoMaisProximo || p.expiresAt.getTime() < vencimentoMaisProximo.getTime()) {
      vencimentoMaisProximo = p.expiresAt;
    }
  }
  const diasAteVencimentoMaisProximo = vencimentoMaisProximo
    ? diasUteisEntre(hoje, vencimentoMaisProximo, feriados)
    : null;

  return {
    quantidade: posicoes.length,
    riscoTotal,
    temIndefinido,
    capitalTotal,
    fracaoCapital,
    semaforoCapital,
    concentracaoAtivo,
    semaforoConcentracaoAtivo: concentracaoAtivo
      ? classificar(concentracaoAtivo.fracao, RISK_LIMITS.concentrationPerUnderlying)
      : "verde",
    concentracaoVencimento,
    semaforoConcentracaoVencimento: concentracaoVencimento
      ? classificar(concentracaoVencimento.fracao, RISK_LIMITS.concentrationPerExpiry)
      : "verde",
    vencimentoMaisProximo,
    diasAteVencimentoMaisProximo,
  };
}

// ── P&L realizado (encerramento) ──────────────────────────────────────────────

/** Uma perna para apurar o resultado realizado: lado + prêmios de abertura/fechamento. */
export interface PernaRealizada {
  /** Lado da perna na ABERTURA (`compra` = long, `venda` = short). */
  side: LadoOperacao;
  /** Quantidade em contratos (lotes). */
  quantity: number;
  /** Prêmio unitário de ABERTURA (BRL por ação). */
  premioAbertura: number;
  /** Prêmio unitário de FECHAMENTO (BRL por ação) — para zerar a perna. */
  premioFechamento: number;
}

/**
 * P&L REALIZADO de uma operação ao fechar, em BRL. FUNÇÃO PURA.
 *
 * Fórmula (mesma convenção de sinal do payoff em `lib/options-math`, trocando o
 * intrínseco no vencimento pelo PRÊMIO DE FECHAMENTO):
 *
 *     resultado = Σ  sinal · (premioFechamento − premioAbertura) · quantity · lote
 *     sinal = +1 (compra)   ·   −1 (venda)
 *
 * Lendo por lado (= "valor recebido na abertura − valor pago no fechamento, ou o
 * inverso"):
 *  - COMPRA (long): pagou na abertura, recebe ao vender no fechamento →
 *    resultado = (fechamento − abertura) · qtd · lote (sinal +1).
 *  - VENDA (short): recebeu na abertura, paga ao recomprar no fechamento →
 *    resultado = (abertura − fechamento) · qtd · lote (sinal −1).
 *
 * Valores POR AÇÃO; multiplica por `quantity` (contratos) × `tamanhoLote` (100 na
 * B3, default `TAMANHO_LOTE_PADRAO`) — igual ao resto do `options-math`.
 */
export function plRealizado(
  pernas: readonly PernaRealizada[],
  tamanhoLote: number = TAMANHO_LOTE_PADRAO,
): number {
  return pernas.reduce((acc, p) => {
    const sinal = p.side === "compra" ? 1 : -1;
    return acc + sinal * (p.premioFechamento - p.premioAbertura) * p.quantity * tamanhoLote;
  }, 0);
}

/** Avaliação de proximidade de vencimento de UMA posição (§10, ~5 dias úteis). */
export interface AvaliacaoVencimento {
  diasUteis: number;
  semaforo: Semaforo;
  /** `true` quando o vencimento é iminente (≤1 dia útil) ou já passou. */
  urgente: boolean;
  /** Sugestão clara para o leigo (encerrar/rolar). */
  sugestao: string;
}

/**
 * Dias úteis até o vencimento de uma posição (conveniência para a UI).
 */
export function diasUteisAteVencimento(
  posicao: PosicaoAberta,
  opcoes: OpcoesAvaliacao = {},
): number {
  return diasUteisEntre(opcoes.hoje ?? new Date(), posicao.expiresAt, opcoes.feriados ?? []);
}

/**
 * Classifica a proximidade de vencimento e sugere ação (§8.1 item 3, §10):
 * ≤0 ou ≤1 dia útil → vermelho/urgente; ≤5 dias úteis → amarelo; senão verde.
 */
export function avaliarVencimento(diasUteis: number): AvaliacaoVencimento {
  const limite = RISK_LIMITS.expiryWarningBusinessDays;
  if (diasUteis <= 0) {
    return {
      diasUteis,
      semaforo: "vermelho",
      urgente: true,
      sugestao: "Vence hoje ou já passou — encerre ou role a posição com urgência.",
    };
  }
  if (diasUteis <= 1) {
    return {
      diasUteis,
      semaforo: "vermelho",
      urgente: true,
      sugestao: `Falta ${diasUteis} dia útil — considere encerrar ou rolar já.`,
    };
  }
  if (diasUteis <= limite) {
    return {
      diasUteis,
      semaforo: "amarelo",
      urgente: false,
      sugestao: `Faltam ${diasUteis} dias úteis — pense em encerrar ou rolar para evitar exercício/atribuição.`,
    };
  }
  return {
    diasUteis,
    semaforo: "verde",
    urgente: false,
    sugestao: `Faltam ${diasUteis} dias úteis — sem urgência.`,
  };
}
