import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Fundamentos } from "@/lib/fundamentos/tipos";

import { BlocoFundamentalista } from "./bloco-fundamentalista";

/**
 * Testa o consumidor da rota /api/calendario depois do desligamento (5.6): a seção
 * de proventos mostra a MENSAGEM NEUTRA (motivo + fonte alternativa), não uma lista
 * vazia silenciosa nem um erro genérico. A ausência de dado automático fica
 * visualmente distinta de "não há provento previsto".
 */

const FUND: Fundamentos = {
  ticker: "PETR4",
  precoLucro: 4.65,
  evEbitda: 3.81,
  precoValorPatrimonial: 1.12,
  margemLiquida: 21.69,
  roe: 24.17,
  roic: 16.7,
  roa: 8.67,
  lpa: 8.35,
  vpa: 34.54,
  marketCap: 500727267764.85,
  lucroLiquido: 107583000,
  ebitda: 216231000,
  dataReferencia: "2026-03-31",
  nomeEmpresa: "PETRÓLEO BRASILEIRO S.A.",
};

const PROVENTOS_INFO = {
  motivo: "O calendário de proventos não é obtido automaticamente.",
  fonteAlternativa: "Confira na sua corretora ou use o campo de data manual ao montar o ticket.",
};
const RESULTADOS_INFO = {
  motivo: "O calendário de divulgação de resultados não é obtido automaticamente (§6.4).",
  fonteAlternativa: "Informe a data manualmente (RI da empresa, B3, Status Invest).",
};

function montar(fundamentos: Fundamentos | null) {
  return render(
    <TooltipProvider>
      <BlocoFundamentalista
        fundamentos={fundamentos}
        proventosInfo={PROVENTOS_INFO}
        resultadosInfo={RESULTADOS_INFO}
        frescorFundamentos={null}
      />
    </TooltipProvider>,
  );
}

describe("<BlocoFundamentalista> — proventos indisponíveis (5.6)", () => {
  it("renderiza a mensagem neutra de proventos, não uma lista vazia silenciosa", () => {
    montar(FUND);
    expect(
      screen.getByText(/calendário de proventos não é obtido automaticamente/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/use o campo de data manual ao montar o ticket/i)).toBeInTheDocument();
    // Distinto de "não há provento" — não usamos mais o texto de lista vazia antigo.
    expect(screen.queryByText(/nenhum provento informado/i)).not.toBeInTheDocument();
  });

  it("renderiza os retornos novos (ROE/ROIC/ROA) ao lado dos múltiplos", () => {
    montar(FUND);
    expect(screen.getByText("ROE")).toBeInTheDocument();
    expect(screen.getByText("ROIC")).toBeInTheDocument();
    expect(screen.getByText("ROA")).toBeInTheDocument();
    // Margem em PONTOS, sem dupla conversão (21,69 → "21,7%", não 2169%).
    expect(screen.getByText("21,7%")).toBeInTheDocument();
  });

  it("sem fundamentos da fonte, a mensagem neutra de proventos continua visível", () => {
    montar(null);
    expect(
      screen.getByText(/calendário de proventos não é obtido automaticamente/i),
    ).toBeInTheDocument();
  });
});
