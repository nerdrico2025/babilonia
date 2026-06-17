/**
 * ticket — geração e formatação do TICKET DE OPERAÇÃO (§11 e §8.6 do PRD).
 *
 * Gera o ticket padronizado, pronto para copiar e digitar no home broker. Risco
 * máximo SEMPRE antes do ganho (§2). Validações: vencimento, liquidez da série,
 * eventos próximos. Faltando dado essencial, o ticket APONTA o que falta em vez
 * de inventar (§2, princípio 4) — nada de preencher número que não veio.
 *
 * Módulo de formatação puro: recebe a estrutura (de `options-math`), as
 * avaliações de risco (de `risk-rules`) e os dados de execução das pernas, e
 * devolve texto.
 */

import type { Leg, ResultadoEstrutura } from "@/lib/options-math";
import { type AvaliacaoRisco, diasUteisEntre } from "@/lib/risk-rules";

// ── Tipos de entrada ─────────────────────────────────────────────────────────

/** A ordem abre ou encerra posição (§11). */
export type AberturaEncerramento = "abertura" | "encerramento";

/** Tipo de ordem no home broker (§11). */
export type TipoOrdem = "mercado" | "limitada" | "stop";

/** Validade da ordem (§11). */
export type Validade = "dia" | "ate_cancelar";

/** Preço como faixa (mín–máx), para ordens com intervalo de preço. */
export interface FaixaPreco {
  min: number;
  max: number;
}

/** Status de liquidez da série (§5 princípio 5, §11). */
export interface Liquidez {
  status: "ok" | "baixa";
  /** Observação opcional (ex.: "spread largo, sem market maker"). */
  observacao?: string;
}

/** Eventos próximos do ativo-objeto que pesam na decisão (§8.6). */
export interface EventosProximos {
  /** Data do próximo resultado (balanço), se houver. */
  resultados?: Date;
  /** Data do próximo provento (dividendo/JCP), se houver. */
  proventos?: Date;
}

/**
 * Dados de execução de UMA perna (o que o home broker precisa). Combina a perna
 * matemática (`leg`, de `options-math`) com o ticker exato e os parâmetros de
 * ordem — dados que o usuário informa, nunca inventados.
 */
export interface PernaTicket {
  /** Perna matemática (tipo/lado/strike/prêmio/quantidade). */
  leg: Leg;
  /** Ticker EXATO da opção na B3 (ex.: "PETRK221") — obrigatório (§11). */
  tickerOpcao: string;
  /** Abre ou encerra posição. */
  aberturaEncerramento: AberturaEncerramento;
  /** Tipo de ordem. */
  tipoOrdem: TipoOrdem;
  /** Preço-limite (BRL) ou faixa. Dispensável só em ordem a mercado. */
  precoLimite?: number | FaixaPreco;
  /** Validade da ordem. */
  validade: Validade;
}

/** Tudo que o gerador de ticket precisa (§11). */
export interface EntradaTicket {
  /** Resultado da estrutura (nome, rótulo, risco/ganho/breakevens). */
  estrutura: ResultadoEstrutura;
  /** Avaliações de risco do §10 (semáforo + texto). */
  avaliacoes: AvaliacaoRisco[];
  /** Ativo-objeto (ex.: "PETR4"). */
  ativoObjeto: string;
  /** Capital total do usuário (BRL) — para o "% do capital" do risco. */
  capitalTotal: number;
  /** Pernas com dados de execução (uma por perna da estrutura). */
  pernas: PernaTicket[];
  /** Vencimento da operação — essencial (§8.6). */
  vencimento?: Date;
  /** Liquidez da série — essencial (§8.6). */
  liquidez?: Liquidez;
  /** Eventos próximos (resultados/proventos). */
  eventos?: EventosProximos;
  /** Stop de perda em BRL, se aplicável (§11). */
  stop?: number;
  /** Alvo em BRL, se aplicável (§11). */
  alvo?: number;
  /** "Hoje" para a contagem de dias úteis. Default: data atual. */
  hoje?: Date;
  /** Feriados B3 para a contagem de dias úteis (ver `risk-rules`). */
  feriados?: Date[];
}

// ── Formatadores ─────────────────────────────────────────────────────────────

const FALTA = "⚠️ FALTA";
const LINHA = "═".repeat(35);

/** Formata BRL determinístico (pt-BR): 1234.5 → "R$ 1.234,50". */
function brl(valor: number): string {
  const fixo = Math.abs(valor).toFixed(2);
  const [inteiro, dec] = fixo.split(".");
  const comMilhar = inteiro!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${valor < 0 ? "-" : ""}${comMilhar},${dec}`;
}

/** Formata uma fração como percentual em pt-BR (0.075 → "7,5%"). */
function pct(fracao: number): string {
  const v = Math.round(fracao * 1000) / 10;
  const txt = Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ",");
  return `${txt}%`;
}

/** Formata uma data como DD/MM/AAAA a partir do dia UTC (sem deslocar fuso). */
function data(d: Date): string {
  const dia = String(d.getUTCDate()).padStart(2, "0");
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getUTCFullYear()}`;
}

const ROTULO_COMPRA_VENDA: Record<Leg["lado"], string> = {
  compra: "Compra",
  venda: "Venda",
};
const ROTULO_ABRE_ENCERRA: Record<AberturaEncerramento, string> = {
  abertura: "Abertura",
  encerramento: "Encerramento",
};
const ROTULO_ORDEM: Record<TipoOrdem, string> = {
  mercado: "Mercado",
  limitada: "Limitada",
  stop: "Stop",
};
const ROTULO_VALIDADE: Record<Validade, string> = {
  dia: "Dia",
  ate_cancelar: "Até cancelar",
};

/** Texto do preço-limite/faixa da perna (aponta falta quando exigido). */
function precoDaPerna(perna: PernaTicket): string {
  if (perna.tipoOrdem === "mercado") return "A mercado";
  if (perna.precoLimite == null) return `${FALTA}: informe o preço-limite`;
  if (typeof perna.precoLimite === "number") return brl(perna.precoLimite);
  return `${brl(perna.precoLimite.min)} a ${brl(perna.precoLimite.max)}`;
}

// ── Validação (§8.6 / §2 princípio 4) ────────────────────────────────────────

/**
 * Lista as pendências do ticket (dados essenciais ausentes). Vazio = pronto.
 * Não inventa nada: só aponta o que falta para o usuário preencher.
 */
export function validarTicket(entrada: EntradaTicket): string[] {
  const pendencias: string[] = [];

  if (!entrada.vencimento) pendencias.push("Vencimento não informado.");
  if (!entrada.liquidez) pendencias.push("Liquidez da série não informada.");
  if (!entrada.eventos) {
    pendencias.push(
      "Eventos próximos (resultados/proventos) não verificados.",
    );
  }
  if (entrada.pernas.length === 0) {
    pendencias.push("Nenhuma perna informada.");
  }

  entrada.pernas.forEach((perna, i) => {
    const n = i + 1;
    if (!perna.tickerOpcao.trim()) {
      pendencias.push(`Perna ${n}: ticker exato da opção não informado.`);
    }
    if (perna.tipoOrdem !== "mercado" && perna.precoLimite == null) {
      pendencias.push(`Perna ${n}: preço-limite não informado.`);
    }
  });

  return pendencias;
}

// ── Geração do ticket (§11) ──────────────────────────────────────────────────

/** Bloco RISCO MÁXIMO — risco antes do ganho (§2). */
function linhaRiscoMaximo(entrada: EntradaTicket): string {
  const { estrutura, capitalTotal } = entrada;
  if (estrutura.rotulo_risco === "INDEFINIDO") {
    return "RISCO MÁXIMO:  INDEFINIDO — a perda real pode superar o prêmio recebido";
  }
  const valor = brl(estrutura.risco_maximo);
  const percentual =
    capitalTotal > 0
      ? `(${pct(estrutura.risco_maximo / capitalTotal)} do capital)`
      : `(${FALTA}: configure o capital total)`;
  return `RISCO MÁXIMO:  ${valor}   ${percentual}`;
}

/** Bloco GANHO MÁXIMO. */
function linhaGanhoMaximo(estrutura: ResultadoEstrutura): string {
  const ganho =
    estrutura.ganho_maximo === "ilimitado"
      ? "Ilimitado"
      : brl(estrutura.ganho_maximo);
  return `GANHO MÁXIMO:  ${ganho}`;
}

/** Bloco PERNAS (§11). */
function blocoPernas(entrada: EntradaTicket): string {
  if (entrada.pernas.length === 0) {
    return `PERNAS:\n ${FALTA}: nenhuma perna informada`;
  }
  const linhas = entrada.pernas.map((perna, i) => {
    const n = i + 1;
    const ticker = perna.tickerOpcao.trim() || `${FALTA}: ticker da opção`;
    return [
      ` ${n}) ${entrada.ativoObjeto} | ${ticker}`,
      `    ${ROTULO_COMPRA_VENDA[perna.leg.lado]} ${ROTULO_ABRE_ENCERRA[perna.aberturaEncerramento]}`,
      `    Qtd: ${perna.leg.quantidade} contratos`,
      `    Tipo de ordem: ${ROTULO_ORDEM[perna.tipoOrdem]}`,
      `    Preço-limite/faixa: ${precoDaPerna(perna)}`,
      `    Validade: ${ROTULO_VALIDADE[perna.validade]}`,
    ].join("\n");
  });
  return `PERNAS:\n${linhas.join("\n")}`;
}

/** Bloco OBSERVAÇÕES (§11) + alertas de risco não-verdes (§2). */
function blocoObservacoes(entrada: EntradaTicket): string {
  // Vencimento + dias úteis.
  let venc: string;
  if (!entrada.vencimento) {
    venc = `${FALTA}: vencimento não informado`;
  } else {
    const dias = diasUteisEntre(
      entrada.hoje ?? new Date(),
      entrada.vencimento,
      entrada.feriados ?? [],
    );
    const sufixo =
      dias <= 0
        ? "(vence hoje ou já passou — atenção)"
        : `(faltam ${dias} ${dias === 1 ? "dia útil" : "dias úteis"})`;
    venc = `${data(entrada.vencimento)} ${sufixo}`;
  }

  // Liquidez.
  let liq: string;
  if (!entrada.liquidez) {
    liq = `${FALTA}: liquidez não informada`;
  } else if (entrada.liquidez.status === "ok") {
    liq = "OK";
  } else {
    const obs = entrada.liquidez.observacao ? ` (${entrada.liquidez.observacao})` : "";
    liq = `baixa — atenção${obs}`;
  }

  // Eventos.
  let eventos: string;
  if (!entrada.eventos || (!entrada.eventos.resultados && !entrada.eventos.proventos)) {
    eventos = "nenhum informado — verifique antes de operar";
  } else {
    const partes: string[] = [];
    if (entrada.eventos.resultados) {
      partes.push(`resultados em ${data(entrada.eventos.resultados)}`);
    }
    if (entrada.eventos.proventos) {
      partes.push(`proventos em ${data(entrada.eventos.proventos)}`);
    }
    eventos = partes.join(" / ");
  }

  const linhas = [
    "OBSERVAÇÕES:",
    ` - Vencimento: ${venc}`,
    ` - Liquidez da série: ${liq}`,
    ` - Eventos próximos: ${eventos}`,
  ];

  // Alertas de risco (§10): inclui só os semáforos não-verdes, com destaque.
  for (const a of entrada.avaliacoes) {
    if (a.semaforo !== "verde") {
      linhas.push(` - ⚠️ [${a.semaforo.toUpperCase()}] ${a.texto}`);
    }
  }

  return linhas.join("\n");
}

/**
 * Gera o TICKET DE OPERAÇÃO no formato EXATO do §11, pronto para copiar.
 * Dados essenciais ausentes aparecem como "⚠️ FALTA: ..." (nunca inventados).
 * Use `validarTicket` para checar pendências antes de exibir.
 */
export function gerarTicket(entrada: EntradaTicket): string {
  const { estrutura } = entrada;

  const stop = entrada.stop != null ? brl(entrada.stop) : "—";
  const alvo = entrada.alvo != null ? brl(entrada.alvo) : "—";
  const breakevens =
    estrutura.breakevens.length > 0
      ? estrutura.breakevens.map((b) => brl(b)).join(" / ")
      : "—";

  return [
    LINHA,
    "        TICKET DE OPERAÇÃO",
    LINHA,
    `Estrutura: ${estrutura.nome}`,
    `Risco: ${estrutura.rotulo_risco}`,
    "",
    // Risco SEMPRE antes do ganho (§2).
    linhaRiscoMaximo(entrada),
    linhaGanhoMaximo(estrutura),
    `BREAKEVEN(S):  ${breakevens}`,
    "",
    blocoPernas(entrada),
    "",
    `STOP DE PERDA: ${stop}      ALVO: ${alvo}`,
    "",
    blocoObservacoes(entrada),
    LINHA,
  ].join("\n");
}
