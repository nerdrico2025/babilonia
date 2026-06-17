/**
 * Testes da análise técnica. Cobrem o parse da série colada, os indicadores e a
 * leitura de iniciante (sem recomendação). Casos numéricos verificáveis à mão.
 */
import { describe, expect, it } from "vitest";

import { analisarTecnico, parseSerie } from "./tecnico";

describe("parseSerie", () => {
  it("aceita espaços, vírgulas, quebras de linha e decimal pt-BR", () => {
    expect(parseSerie("10 11,5\n12;13")).toEqual([10, 11.5, 12, 13]);
  });
  it("ignora tokens não numéricos", () => {
    expect(parseSerie("10 abc 12")).toEqual([10, 12]);
  });
});

describe("analisarTecnico", () => {
  it("RSI = 100 numa série só de altas", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 10 + i);
    const a = analisarTecnico(closes);
    expect(a.rsi14).toBe(100);
    expect(a.precoAtual).toBe(39);
  });

  it("calcula SMA20 corretamente", () => {
    const closes = Array.from({ length: 20 }, () => 10); // tudo 10
    expect(analisarTecnico(closes).sma20).toBe(10);
  });

  it("suporte e resistência são mín/máx da janela", () => {
    const closes = [5, 8, 3, 9, 7];
    const a = analisarTecnico(closes);
    expect(a.suporte).toBe(3);
    expect(a.resistencia).toBe(9);
  });

  it("preço acima das médias gera leitura de alta (sem recomendar)", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 10 + i * 0.5);
    const a = analisarTecnico(closes);
    const texto = a.leitura.join(" ");
    expect(texto).toMatch(/viés de curto prazo de alta/);
    expect(texto).not.toMatch(/compre|venda /i);
  });

  it("usa o precoAtual informado (cotação ao vivo) no lugar do último fechamento", () => {
    const closes = Array.from({ length: 25 }, () => 20);
    const a = analisarTecnico(closes, { precoAtual: 25 });
    expect(a.precoAtual).toBe(25);
  });

  it("poucos pontos pedem mais dados", () => {
    const a = analisarTecnico([10, 11, 12]);
    expect(a.sma20).toBeNull();
    expect(a.macd).toBeNull();
    expect(a.leitura.join(" ")).toMatch(/Cole mais fechamentos/);
  });

  it("lê volume acima da média", () => {
    const closes = Array.from({ length: 20 }, () => 10);
    const volumes = [...Array(19).fill(100), 1000];
    expect(analisarTecnico(closes, { volumes }).leitura.join(" ")).toMatch(/Volume bem acima/);
  });
});
