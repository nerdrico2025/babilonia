import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { lerSkew } from "@/lib/analise/volatilidade";
import type { ResultadoSkewAutomatico } from "@/lib/dados-opcoes/skew";
import type { VolatilidadeAtivo } from "@/lib/opcoes/tipos";

import { BlocoVolatilidade } from "./bloco-volatilidade";

/**
 * Testa o skew automático na UI (V2): mostra resultado + par usado (transparência),
 * cai no fallback manual com motivo quando indisponível, deixa o manual acessível
 * mesmo com o automático presente, e o manual SOBREPÕE a leitura quando usado.
 */

const VOL: VolatilidadeAtivo = {
  ativo: "PETR4",
  ivAtual: 28.16,
  ivRank1a: 45,
  ivPercentil1a: 50,
  ivRank6m: 40,
  ivPercentil6m: 48,
  ewmaAtual: null,
  ivRankPorContratoDisponivel: false,
};

const SKEW_OK: ResultadoSkewAutomatico = {
  disponivel: true,
  ...lerSkew(30, 25), // diferenca + leitura reais (skew de baixa)
  parUsado: {
    vencimento: "2026-07-17T00:00:00.000Z",
    spot: 38.57,
    put: { symbol: "PETRS36", strike: 36, iv: 30, distanciaPercentual: 6.66 },
    call: { symbol: "PETRG41", strike: 41, iv: 25, distanciaPercentual: 6.3 },
  },
};

const SKEW_INDISP: ResultadoSkewAutomatico = {
  disponivel: false,
  motivo:
    "Não há strikes OTM comparáveis disponíveis para este vencimento (cadeia rala ou sem strikes nos dois lados do spot).",
};

function montar(skew: ResultadoSkewAutomatico | null) {
  return render(
    <TooltipProvider>
      <BlocoVolatilidade ivAtual={28.16} volatilidade={VOL} skew={skew} frescor={null} />
    </TooltipProvider>,
  );
}

describe("<BlocoVolatilidade> — skew automático (V2)", () => {
  it("disponível: mostra leitura + o par usado de forma transparente", () => {
    const { container, queryByLabelText } = montar(SKEW_OK);
    const txt = container.textContent ?? "";

    expect(txt).toContain(lerSkew(30, 25).leitura);
    // Par usado explícito (símbolos, strikes, distâncias).
    expect(txt).toContain("PETRS36");
    expect(txt).toContain("PETRG41");
    expect(txt).toContain("6,7% OTM"); // 6.66 → "6,7%"
    expect(txt).toContain("6,3% OTM");

    // Com automático presente, os inputs manuais começam ESCONDIDOS (atrás do toggle).
    expect(queryByLabelText(/IV da put OTM/i)).toBeNull();
    expect(txt).toContain("Colar valores manualmente");
  });

  it("indisponível: mostra o motivo e os inputs manuais como fallback", () => {
    const { container, getByLabelText } = montar(SKEW_INDISP);
    const txt = container.textContent ?? "";

    expect(txt).toContain("strikes OTM comparáveis");
    expect(txt).toContain("Cole os valores manualmente abaixo");
    // Inputs manuais visíveis direto (fallback), funcionando como hoje.
    expect(getByLabelText(/IV da put OTM/i)).toBeInTheDocument();
    expect(getByLabelText(/IV da call OTM/i)).toBeInTheDocument();
  });

  it("skew null (rota não computou) também cai no fallback manual visível", () => {
    const { getByLabelText } = montar(null);
    expect(getByLabelText(/IV da put OTM/i)).toBeInTheDocument();
  });

  it("toggle revela os inputs manuais mesmo com automático presente", () => {
    const { getByText, queryByLabelText, getByLabelText } = montar(SKEW_OK);
    expect(queryByLabelText(/IV da put OTM/i)).toBeNull();
    fireEvent.click(getByText("Colar valores manualmente"));
    expect(getByLabelText(/IV da put OTM/i)).toBeInTheDocument();
    expect(getByLabelText(/IV da call OTM/i)).toBeInTheDocument();
  });

  it("manual SOBREPÕE o automático quando os dois valores são colados", () => {
    const { getByText, getByLabelText, container } = montar(SKEW_OK);
    fireEvent.click(getByText("Colar valores manualmente"));
    // put=20, call=40 → skew de ALTA (distinto do automático, que é de baixa).
    fireEvent.change(getByLabelText(/IV da put OTM/i), { target: { value: "20" } });
    fireEvent.change(getByLabelText(/IV da call OTM/i), { target: { value: "40" } });

    const txt = container.textContent ?? "";
    expect(txt).toContain(lerSkew(20, 40).leitura); // skew de alta
    expect(txt).toContain("Valor colado manualmente");
    // A base do automático some quando o manual assume.
    expect(txt).not.toContain("PETRS36");
  });
});
