import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { AnaliseTecnica } from "@/lib/analise-tecnica/tipos";

import { BlocoTecnico } from "./bloco-tecnico";
import type { Frescor, PrecoAtivoEod } from "./tipos";

/**
 * Testa o Bloco Técnico rico (T4): consome `analisarTecnico` (T3) e só FORMATA +
 * EXPLICA — não recalcula. Cobre render completo, histórico insuficiente (mensagem
 * neutra), todo termo técnico envolto em <TermoTecnico> (link p/ glossário) e
 * AUSÊNCIA de linguagem de recomendação (§2 princípio 3).
 */

const PRECO: PrecoAtivoEod = {
  preco: 38.57,
  variacao: 0.42,
  variacaoPercent: 1.1,
  volume: 1_200_000,
  dataPregao: "2026-06-17T00:00:00.000Z",
};

const FRESCOR: Frescor = {
  origem: "rede",
  geradoEm: "2026-06-17T21:00:00.000Z",
  desatualizado: false,
  podeForcarAtualizacao: false,
};

const TEC: AnaliseTecnica = {
  ticker: "PETR4",
  dataReferencia: "2026-06-17T00:00:00.000Z",
  pontos: 260,
  precoAtual: 38.57,
  medias: {
    mm9: 38.1,
    mm21: 37.5,
    mm50: 36.8,
    mm200: 34.2,
    cruzamento9x21: "cima",
    cruzamento50x200: null,
  },
  rsi14: 72,
  macd: { linha: 0.42, sinal: 0.3, histograma: 0.12, cruzamento: "cima" },
  suporteResistencia: {
    suporte: { preco: 36.0, data: "2026-05-20T00:00:00.000Z", tipo: "suporte" },
    resistencia: { preco: 40.0, data: "2026-06-02T00:00:00.000Z", tipo: "resistencia" },
  },
};

function montar(tecnica: AnaliseTecnica | null) {
  return render(
    <TooltipProvider>
      <BlocoTecnico preco={PRECO} tecnica={tecnica} frescor={FRESCOR} />
    </TooltipProvider>,
  );
}

describe("<BlocoTecnico> — indicadores completos (T4)", () => {
  it("mostra as 4 médias, RSI, MACD, suporte/resistência e o cruzamento recente", () => {
    const { container } = montar(TEC);
    const txt = container.textContent ?? "";

    // Seções presentes.
    expect(txt).toContain("Médias móveis");
    expect(txt).toContain("RSI (14)");
    expect(txt).toContain("MACD (12, 26, 9)");
    expect(txt).toContain("Suporte e resistência");

    // Cruzamento recente sinalizado visualmente (chip).
    expect(txt).toContain("9×21: cruzamento de alta");

    // Leituras didáticas explicam ANTES de interpretar o valor atual.
    expect(txt).toContain("Uma média móvel é a média dos fechamentos");
    expect(txt).toContain("RSI está em 72");
    expect(txt).toContain("zona de sobrecompra");
    expect(txt).toContain("momentum de curto prazo comprador");

    // Frescor coerente: indicadores datados no mesmo fechamento do preço.
    expect(txt).toContain("Indicadores calculados sobre o fechamento de 17/06/2026");
    expect(txt).toContain("Preço de fechamento de 17/06/2026");
  });

  it("envolve todo termo técnico em <TermoTecnico> (link para o glossário)", () => {
    const { container } = montar(TEC);
    const hrefs = Array.from(
      container.querySelectorAll('a[href^="/glossario#"]'),
    ).map((a) => a.getAttribute("href"));

    for (const slug of [
      "media-movel",
      "rsi",
      "macd",
      "momentum",
      "cruzamento-medias",
      "suporte-resistencia",
      "volume",
    ]) {
      expect(hrefs).toContain(`/glossario#${slug}`);
    }
  });

  it("NÃO usa linguagem de recomendação direta (compre/venda/é hora de)", () => {
    const { container } = montar(TEC);
    const txt = (container.textContent ?? "").toLowerCase();
    // Limites de palavra: "sobrecompra"/"sobrevenda" são termos técnicos legítimos
    // (e aparecem nos tooltips do glossário) — só o IMPERATIVO de ordem é proibido.
    for (const re of [/\bcompre\b/, /\bvenda\b/, /\bcomprar\b/, /\bvender\b/, /é hora de/]) {
      expect(txt).not.toMatch(re);
    }
  });
});

describe("<BlocoTecnico> — histórico insuficiente", () => {
  it("mostra mensagem neutra, não esconde a seção nem mostra erro genérico", () => {
    const { container } = montar(null);
    const txt = container.textContent ?? "";

    expect(txt).toContain("Ainda não há histórico de fechamentos suficiente");
    // Preço EOD continua visível (degradação por bloco).
    expect(txt).toContain("Preço de fechamento de 17/06/2026");
    // Sem indicadores fantasma.
    expect(txt).not.toContain("Médias móveis");
    expect(txt).not.toContain("RSI está em");
  });
});
