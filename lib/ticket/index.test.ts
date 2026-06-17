import { describe, it, expect } from "vitest";

import {
  travaAltaCallDebito,
  straddleVendido,
  type ResultadoEstrutura,
} from "@/lib/options-math";
import { avaliarRisco, type OperacaoCandidata } from "@/lib/risk-rules";
import {
  gerarTicket,
  validarTicket,
  type EntradaTicket,
  type PernaTicket,
} from "@/lib/ticket";

/**
 * Testes do gerador de ticket (§11, §8.6). Um ticket de risco DEFINIDO e um
 * INDEFINIDO, conferindo a ORDEM (risco antes do ganho), a presença do rótulo
 * e dos campos obrigatórios do §11, e as validações de dado faltante (§2.4).
 */

const CAPITAL = 10_000;
const HOJE = new Date(Date.UTC(2026, 5, 15)); // segunda 15/06/2026
const VENC = new Date(Date.UTC(2026, 6, 17)); // 17/07/2026

// Book "saudável" (outro ativo/vencimento) p/ a concentração não distorcer.
const BOOK = [
  {
    ativoObjeto: "VALE3",
    vencimento: new Date(Date.UTC(2026, 8, 18)),
    exposicao: 10_000,
  },
];

function operacao(
  estrutura: ResultadoEstrutura,
  margemRequerida?: number,
): OperacaoCandidata {
  return { estrutura, ativoObjeto: "PETR4", vencimento: VENC, margemRequerida };
}

/** Constrói as pernas de execução a partir das pernas matemáticas. */
function pernasDe(
  estrutura: ResultadoEstrutura,
  tickers: string[],
  precos: number[],
): PernaTicket[] {
  return estrutura.legs.map((leg, i) => ({
    leg,
    tickerOpcao: tickers[i]!,
    aberturaEncerramento: "abertura",
    tipoOrdem: "limitada",
    precoLimite: precos[i]!,
    validade: "dia",
  }));
}

describe("Ticket de risco DEFINIDO (trava de alta)", () => {
  const estrutura = travaAltaCallDebito({
    k1: 20, k2: 22, premioK1: 1.0, premioK2: 0.2,
  }); // lote 100 → risco 80, ganho 120, breakeven 20,80

  const entrada: EntradaTicket = {
    estrutura,
    avaliacoes: avaliarRisco(operacao(estrutura), CAPITAL, BOOK, { hoje: HOJE }),
    ativoObjeto: "PETR4",
    capitalTotal: CAPITAL,
    pernas: pernasDe(estrutura, ["PETRG200", "PETRV220"], [1.05, 0.18]),
    vencimento: VENC,
    liquidez: { status: "ok" },
    eventos: { resultados: new Date(Date.UTC(2026, 6, 30)) },
    stop: 60,
    alvo: 120,
    hoje: HOJE,
  };

  const texto = gerarTicket(entrada);

  it("traz o cabeçalho, a estrutura e o rótulo DEFINIDO", () => {
    expect(texto).toContain("TICKET DE OPERAÇÃO");
    expect(texto).toContain("Estrutura: Trava de alta (débito, calls)");
    expect(texto).toContain("Risco: DEFINIDO");
  });

  it("apresenta o RISCO MÁXIMO ANTES do GANHO MÁXIMO (§2)", () => {
    const iRisco = texto.indexOf("RISCO MÁXIMO");
    const iGanho = texto.indexOf("GANHO MÁXIMO");
    expect(iRisco).toBeGreaterThanOrEqual(0);
    expect(iGanho).toBeGreaterThan(iRisco);
  });

  it("mostra risco em R$ e % do capital, ganho e breakeven", () => {
    expect(texto).toContain("RISCO MÁXIMO:  R$ 80,00");
    expect(texto).toContain("(0,8% do capital)");
    expect(texto).toContain("GANHO MÁXIMO:  R$ 120,00");
    expect(texto).toContain("BREAKEVEN(S):  R$ 20,80");
  });

  it("traz todos os campos obrigatórios das PERNAS (§11)", () => {
    expect(texto).toContain("PETR4 | PETRG200"); // ativo-objeto + ticker exato
    expect(texto).toContain("PETR4 | PETRV220");
    expect(texto).toContain("Compra Abertura"); // compra/venda + abertura/encerramento
    expect(texto).toContain("Venda Abertura");
    expect(texto).toContain("Qtd: 1 contratos"); // quantidade em contratos
    expect(texto).toContain("Tipo de ordem: Limitada"); // tipo de ordem
    expect(texto).toContain("Preço-limite/faixa: R$ 1,05"); // preço-limite
    expect(texto).toContain("Validade: Dia"); // validade
  });

  it("traz STOP/ALVO e as OBSERVAÇÕES (vencimento + dias úteis, liquidez, eventos)", () => {
    expect(texto).toContain("STOP DE PERDA: R$ 60,00");
    expect(texto).toContain("ALVO: R$ 120,00");
    expect(texto).toMatch(/Vencimento: 17\/07\/2026 \(faltam \d+ dias úteis\)/);
    expect(texto).toContain("Liquidez da série: OK");
    expect(texto).toContain("Eventos próximos: resultados em 30/07/2026");
  });

  it("não tem pendências de validação", () => {
    expect(validarTicket(entrada)).toEqual([]);
  });
});

describe("Ticket de risco INDEFINIDO (straddle vendido)", () => {
  const estrutura = straddleVendido({ k: 20, premioCall: 1.0, premioPut: 1.2 });
  // lote 100 → risco INDEFINIDO (Infinity), ganho 220, breakevens 17,8 e 22,2

  const entrada: EntradaTicket = {
    estrutura,
    avaliacoes: avaliarRisco(operacao(estrutura, 1500), CAPITAL, BOOK, { hoje: HOJE }),
    ativoObjeto: "PETR4",
    capitalTotal: CAPITAL,
    pernas: pernasDe(estrutura, ["PETRG200", "PETRS200"], [1.0, 1.2]),
    vencimento: VENC,
    liquidez: { status: "baixa", observacao: "spread largo" },
    eventos: {},
    hoje: HOJE,
  };

  const texto = gerarTicket(entrada);

  it("rotula como INDEFINIDO e avisa que a perda pode superar o prêmio", () => {
    expect(texto).toContain("Risco: INDEFINIDO");
    expect(texto).toContain(
      "RISCO MÁXIMO:  INDEFINIDO — a perda real pode superar o prêmio recebido",
    );
  });

  it("mantém RISCO antes do GANHO mesmo com risco indefinido", () => {
    const iRisco = texto.indexOf("RISCO MÁXIMO");
    const iGanho = texto.indexOf("GANHO MÁXIMO");
    expect(iGanho).toBeGreaterThan(iRisco);
    expect(texto).toContain("GANHO MÁXIMO:  R$ 220,00"); // soma dos prêmios
  });

  it("inclui o alerta de risco do §10 nas observações (superar o prêmio)", () => {
    expect(texto).toContain("superar o prêmio");
    expect(texto).toMatch(/⚠️ \[(AMARELO|VERMELHO)\]/);
  });

  it("mostra liquidez baixa com observação", () => {
    expect(texto).toContain("Liquidez da série: baixa — atenção (spread largo)");
  });
});

describe("Validações — aponta o que falta, não inventa (§2.4)", () => {
  const estrutura = travaAltaCallDebito({
    k1: 20, k2: 22, premioK1: 1.0, premioK2: 0.2,
  });

  // Entrada incompleta: sem vencimento, sem liquidez, sem eventos, perna sem
  // ticker e perna limitada sem preço-limite.
  const entrada: EntradaTicket = {
    estrutura,
    avaliacoes: [],
    ativoObjeto: "PETR4",
    capitalTotal: CAPITAL,
    pernas: [
      {
        leg: estrutura.legs[0]!,
        tickerOpcao: "  ", // em branco
        aberturaEncerramento: "abertura",
        tipoOrdem: "limitada",
        precoLimite: undefined, // limitada sem preço
        validade: "dia",
      },
      {
        leg: estrutura.legs[1]!,
        tickerOpcao: "PETRV220",
        aberturaEncerramento: "abertura",
        tipoOrdem: "mercado", // a mercado dispensa preço
        validade: "dia",
      },
    ],
  };

  it("validarTicket lista todas as pendências essenciais", () => {
    const p = validarTicket(entrada);
    expect(p).toContain("Vencimento não informado.");
    expect(p).toContain("Liquidez da série não informada.");
    expect(p).toContain("Eventos próximos (resultados/proventos) não verificados.");
    expect(p).toContain("Perna 1: ticker exato da opção não informado.");
    expect(p).toContain("Perna 1: preço-limite não informado.");
    // Perna 2 é a mercado → não exige preço-limite.
    expect(p).not.toContain("Perna 2: preço-limite não informado.");
  });

  it("o ticket aponta os faltantes com '⚠️ FALTA' em vez de inventar", () => {
    const texto = gerarTicket(entrada);
    expect(texto).toContain("⚠️ FALTA: vencimento não informado");
    expect(texto).toContain("⚠️ FALTA: liquidez não informada");
    expect(texto).toContain("⚠️ FALTA: ticker da opção");
    expect(texto).toContain("⚠️ FALTA: informe o preço-limite");
    // A perna a mercado mostra "A mercado", não um preço inventado.
    expect(texto).toContain("Preço-limite/faixa: A mercado");
  });
});
