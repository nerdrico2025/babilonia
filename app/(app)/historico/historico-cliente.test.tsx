import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { HistoricoCliente, type PosicaoHistoricoView } from "./historico-cliente";

/**
 * Testa a UI de ciclo de vida (H3): abrir o formulário de encerrar e submeter
 * (chama o Server Action com os dados certos), erro tipado tratado na tela, fluxo
 * de rolar identificando a position de origem, e o P&L/link de rolagem na lista.
 */

const { encerrarMock, salvarMock, pushMock, refreshMock } = vi.hoisted(() => ({
  encerrarMock: vi.fn(),
  salvarMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));
vi.mock("./actions", () => ({ encerrarPosition: encerrarMock }));
vi.mock("@/lib/montador/rascunho", () => ({ salvarRascunho: salvarMock }));
vi.mock("@/lib/montador/reconstruir", () => ({
  NOME_FAMILIA: { trava_alta: "Trava de alta" },
  reconstruirRascunho: (p: { underlying: string }) => ({ ativoObjeto: p.underlying }),
}));

function view(over: Partial<PosicaoHistoricoView> = {}): PosicaoHistoricoView {
  return {
    id: 1,
    underlying: "PETR4",
    structure: "trava_alta",
    status: "aberta",
    expiresAtISO: "2026-08-21T00:00:00.000Z",
    createdAtISO: "2026-06-01T00:00:00.000Z",
    diasUteis: 10,
    maxRisk: 120,
    maxGain: 280,
    riskDefined: true,
    breakevens: [41.2],
    pernas: [
      { legId: 11, optionSymbol: "PETRH40", kind: "call", side: "compra", strike: 40, quantity: 1, premium: 2.5 },
      { legId: 12, optionSymbol: "PETRH44", kind: "call", side: "venda", strike: 44, quantity: 1, premium: 1.0 },
    ],
    ticketContent: null,
    realizedPnl: null,
    rolledIntoPositionId: null,
    ...over,
  };
}

function montar(posicoes: PosicaoHistoricoView[]) {
  return render(
    <TooltipProvider>
      <HistoricoCliente posicoes={posicoes} capitalTotal={50000} />
    </TooltipProvider>,
  );
}

/** Expande o card da position (clicando no cabeçalho — um button com o ticker). */
function expandir(underlying: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(underlying) }));
}

beforeEach(() => {
  encerrarMock.mockReset().mockResolvedValue({ ok: true, realizedPnl: 100 });
  salvarMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
});

describe("<HistoricoCliente> — encerrar", () => {
  it("abre o formulário e submete: chama o Server Action com os dados certos", async () => {
    montar([view()]);
    expandir("PETR4");
    fireEvent.click(screen.getByText("Encerrar"));

    fireEvent.change(screen.getByLabelText(/Prêmio de fechamento de PETRH40/), {
      target: { value: "3,5" },
    });
    fireEvent.change(screen.getByLabelText(/Prêmio de fechamento de PETRH44/), {
      target: { value: "1,3" },
    });
    fireEvent.click(screen.getByText("Confirmar encerramento"));

    await waitFor(() => expect(encerrarMock).toHaveBeenCalledTimes(1));
    const [id, dados] = encerrarMock.mock.calls[0]!;
    expect(id).toBe(1);
    // exitPrice DERIVADO: +3,5 (compra) − 1,3 (venda) = 2,2.
    expect(dados.exitPrice).toBeCloseTo(2.2, 6);
    expect(dados.pernasFechamento).toEqual([
      { legId: 11, premioFechamento: 3.5 },
      { legId: 12, premioFechamento: 1.3 },
    ]);
    // Sucesso → recarrega os dados do Server Component.
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("erro tipado do Server Action vira mensagem clara na tela (não quebra)", async () => {
    encerrarMock.mockResolvedValueOnce({
      ok: false,
      erro: { codigo: "persistencia", mensagem: "Não foi possível encerrar agora (rede)." },
    });
    montar([view()]);
    expandir("PETR4");
    fireEvent.click(screen.getByText("Encerrar"));
    fireEvent.change(screen.getByLabelText(/PETRH40/), { target: { value: "3,5" } });
    fireEvent.change(screen.getByLabelText(/PETRH44/), { target: { value: "1,3" } });
    fireEvent.click(screen.getByText("Confirmar encerramento"));

    expect(await screen.findByText(/Não foi possível encerrar agora/)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("bloqueia o envio com fechamento incompleto (sem chamar o Server Action)", async () => {
    montar([view()]);
    expandir("PETR4");
    fireEvent.click(screen.getByText("Encerrar"));
    // só uma perna preenchida
    fireEvent.change(screen.getByLabelText(/PETRH40/), { target: { value: "3,5" } });
    fireEvent.click(screen.getByText("Confirmar encerramento"));

    expect(await screen.findByText(/Informe o prêmio de fechamento de todas as pernas/)).toBeInTheDocument();
    expect(encerrarMock).not.toHaveBeenCalled();
  });
});

describe("<HistoricoCliente> — rolar", () => {
  it("marca o rascunho como rolagem da position de origem e vai ao ticket", () => {
    montar([view({ id: 7 })]);
    expandir("PETR4");
    fireEvent.click(screen.getByText("Rolar"));

    expect(salvarMock).toHaveBeenCalledTimes(1);
    expect(salvarMock.mock.calls[0]![0]).toMatchObject({ rolagemDePositionId: 7 });
    expect(pushMock).toHaveBeenCalledWith("/ticket");
  });
});

describe("<HistoricoCliente> — status na lista", () => {
  it("encerrada mostra o P&L como lucro/prejuízo", () => {
    montar([
      view({ id: 1, status: "encerrada", realizedPnl: 100 }),
      view({ id: 2, underlying: "VALE3", status: "encerrada", realizedPnl: -70 }),
    ]);
    expandir("PETR4");
    expect(screen.getByText(/Resultado realizado: lucro/)).toBeInTheDocument();
    expandir("VALE3");
    expect(screen.getByText(/Resultado realizado: prejuízo/)).toBeInTheDocument();
  });

  it("rolada mostra link para a nova position", () => {
    montar([view({ status: "rolada", rolledIntoPositionId: 9 })]);
    expandir("PETR4");
    expect(screen.getByText(/Ver a posição #9/)).toBeInTheDocument();
    // posição rolada não oferece encerrar/rolar
    expect(screen.queryByText("Encerrar")).toBeNull();
  });
});
