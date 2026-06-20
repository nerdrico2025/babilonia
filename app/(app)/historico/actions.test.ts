import { describe, expect, it } from "vitest";

import { valoresPosition, type TicketPayload } from "../ticket/operacao";
import { encerrarPosition, rolarPosition, type CtxTx, type ExecutarTx } from "./actions";
import { planejarEncerramento, type StatusPosition } from "./dominio";

/**
 * Testa os Server Actions de ciclo de vida (H2) SEM banco: injeta um `ExecutarTx`
 * em MEMÓRIA com semântica de transação (snapshot no início; rollback se a `fn`
 * lançar). Cobre P&L correto, transições de status, erros tipados, atomicidade da
 * rolagem e o reuso da lógica de criação de `persistirTicket` (mappers).
 */

// ── Store + transação em memória ──────────────────────────────────────────────

interface PosRec {
  id: number;
  status: StatusPosition;
  closedAt: Date | null;
  exitPrice: number | null;
  realizedPnl: number | null;
  rolledIntoPositionId: number | null;
  /** O que a criação gravou (para conferir o reuso do mapper). */
  valores?: ReturnType<typeof valoresPosition>;
  legs: { id: number; side: "compra" | "venda"; quantity: number; premium: number }[];
}
interface Store {
  positions: Map<number, PosRec>;
  next: number;
}

function novaStore(): Store {
  return { positions: new Map(), next: 1 };
}

function seed(store: Store, over: Partial<PosRec> & Pick<PosRec, "legs">): number {
  const id = store.next++;
  store.positions.set(id, {
    id,
    status: "aberta",
    closedAt: null,
    exitPrice: null,
    realizedPnl: null,
    rolledIntoPositionId: null,
    ...over,
  });
  return id;
}

type Falha = "criarOperacao" | "marcarRolada" | "encerrar";

/** Ctx em memória; `falharEm` faz a operação indicada lançar (simula erro de escrita). */
function ctxMemoria(store: Store, falharEm?: Falha): CtxTx {
  return {
    async buscarPositionComLegs(id) {
      const p = store.positions.get(id);
      if (!p) return null;
      return {
        position: { id: p.id, status: p.status },
        legs: p.legs.map((l) => ({ ...l })),
      };
    },
    async encerrar(id, dados) {
      if (falharEm === "encerrar") throw new Error("falha simulada (encerrar)");
      const p = store.positions.get(id)!;
      p.status = "encerrada";
      p.closedAt = dados.closedAt;
      p.exitPrice = dados.exitPrice;
      p.realizedPnl = dados.realizedPnl;
    },
    async criarOperacao(payload) {
      if (falharEm === "criarOperacao") throw new Error("falha simulada (criar)");
      const id = store.next++;
      store.positions.set(id, {
        id,
        status: "aberta",
        closedAt: null,
        exitPrice: null,
        realizedPnl: null,
        rolledIntoPositionId: null,
        valores: valoresPosition(payload), // MESMO mapper de persistirTicket
        legs: payload.pernas.map((pp, i) => ({
          id: id * 100 + i,
          side: pp.side,
          quantity: pp.quantity,
          premium: pp.premium,
        })),
      });
      return id;
    },
    async marcarRolada(id, novaPositionId, closedAt) {
      if (falharEm === "marcarRolada") throw new Error("falha simulada (rolar)");
      const p = store.positions.get(id)!;
      p.status = "rolada";
      p.closedAt = closedAt;
      p.rolledIntoPositionId = novaPositionId;
    },
  };
}

/** ExecutarTx em memória: snapshot no início, ROLLBACK (restore) se `fn` lançar. */
function execMemoria(store: Store, falharEm?: Falha): ExecutarTx {
  return async (fn) => {
    const snapshot = new Map(
      [...store.positions].map(([k, v]) => [k, { ...v, legs: v.legs.map((l) => ({ ...l })) }]),
    );
    const nextAntes = store.next;
    try {
      return await fn(ctxMemoria(store, falharEm));
    } catch (e) {
      store.positions = snapshot; // rollback
      store.next = nextAntes;
      throw e;
    }
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Trava de débito (H1): compra @2,00 + venda @0,80; fechada @3,50/@1,30 → +100. */
function seedTravaDebito(store: Store): { id: number; idCompra: number; idVenda: number } {
  const id = store.next; // será o id atribuído por seed
  const idCompra = id * 100 + 1;
  const idVenda = id * 100 + 2;
  const real = seed(store, {
    legs: [
      { id: idCompra, side: "compra", quantity: 1, premium: 2.0 },
      { id: idVenda, side: "venda", quantity: 1, premium: 0.8 },
    ],
  });
  return { id: real, idCompra, idVenda };
}

function payloadNovo(over: Partial<TicketPayload> = {}): TicketPayload {
  return {
    underlying: "PETR4",
    structure: "trava_alta",
    expiresAtISO: "2026-08-21T00:00:00.000Z",
    maxRisk: 120,
    maxGain: 280,
    riskDefined: true,
    breakevens: [41.2],
    pernas: [
      { optionSymbol: "PETRH40", kind: "call", side: "compra", strike: 40, quantity: 1, premium: 2.5 },
      { optionSymbol: "PETRH44", kind: "call", side: "venda", strike: 44, quantity: 1, premium: 1.0 },
    ],
    content: "TICKET …",
    data: { origem: "teste" },
    ...over,
  };
}

// Dados de fechamento VÁLIDOS (legIds positivos) — usados nos casos cujo erro
// esperado vem DEPOIS da validação (não-encontrada / não-aberta).
const FECHAMENTO_LUCRO = {
  exitPrice: 2.2,
  pernasFechamento: [
    { legId: 1, premioFechamento: 3.5 },
    { legId: 2, premioFechamento: 1.3 },
  ],
};

// ── planejarEncerramento (puro) ───────────────────────────────────────────────

describe("planejarEncerramento", () => {
  it("apura o P&L casando cada leg ao seu fechamento (trava lucro → +100)", () => {
    const r = planejarEncerramento(
      [
        { id: 11, side: "compra", quantity: 1, premium: 2.0 },
        { id: 12, side: "venda", quantity: 1, premium: 0.8 },
      ],
      {
        exitPrice: 2.2,
        pernasFechamento: [
          { legId: 11, premioFechamento: 3.5 },
          { legId: 12, premioFechamento: 1.3 },
        ],
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.realizedPnl).toBeCloseTo(100, 6);
  });

  it("erro tipado quando falta o fechamento de alguma perna", () => {
    const r = planejarEncerramento(
      [
        { id: 11, side: "compra", quantity: 1, premium: 2.0 },
        { id: 12, side: "venda", quantity: 1, premium: 0.8 },
      ],
      { exitPrice: 2.2, pernasFechamento: [{ legId: 11, premioFechamento: 3.5 }] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.codigo).toBe("fechamento_incompleto");
  });
});

// ── encerrarPosition ──────────────────────────────────────────────────────────

describe("encerrarPosition", () => {
  it("caminho feliz: status → encerrada, P&L correto, closedAt setado", async () => {
    const store = novaStore();
    const { id, idCompra, idVenda } = seedTravaDebito(store);
    const r = await encerrarPosition(
      id,
      {
        exitPrice: 2.2,
        pernasFechamento: [
          { legId: idCompra, premioFechamento: 3.5 },
          { legId: idVenda, premioFechamento: 1.3 },
        ],
      },
      { executarTx: execMemoria(store) },
    );

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.realizedPnl).toBeCloseTo(100, 6);
    const p = store.positions.get(id)!;
    expect(p.status).toBe("encerrada");
    expect(p.exitPrice).toBe(2.2);
    expect(p.realizedPnl).toBeCloseTo(100, 6);
    expect(p.closedAt).toBeInstanceOf(Date);
  });

  it("já encerrada → erro tipado, sem alterar nada", async () => {
    const store = novaStore();
    const id = seed(store, { status: "encerrada", legs: [] });
    const r = await encerrarPosition(id, FECHAMENTO_LUCRO, { executarTx: execMemoria(store) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.codigo).toBe("nao_aberta");
    expect(store.positions.get(id)!.status).toBe("encerrada"); // intacta
  });

  it("position inexistente → erro tipado", async () => {
    const store = novaStore();
    const r = await encerrarPosition(999, FECHAMENTO_LUCRO, { executarTx: execMemoria(store) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.codigo).toBe("nao_encontrada");
  });

  it("fechamento incompleto → erro tipado ANTES de qualquer escrita", async () => {
    const store = novaStore();
    const { id, idCompra } = seedTravaDebito(store);
    const r = await encerrarPosition(
      id,
      { exitPrice: 2.2, pernasFechamento: [{ legId: idCompra, premioFechamento: 3.5 }] },
      { executarTx: execMemoria(store) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.codigo).toBe("fechamento_incompleto");
    // Nada foi escrito: segue aberta.
    expect(store.positions.get(id)!.status).toBe("aberta");
    expect(store.positions.get(id)!.realizedPnl).toBeNull();
  });
});

// ── rolarPosition ─────────────────────────────────────────────────────────────

describe("rolarPosition", () => {
  it("caminho feliz: cria a nova e marca a antiga 'rolada' com o vínculo", async () => {
    const store = novaStore();
    const idAntiga = seed(store, { legs: [{ id: 1, side: "compra", quantity: 1, premium: 1 }] });
    const r = await rolarPosition(idAntiga, payloadNovo(), { executarTx: execMemoria(store) });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const antiga = store.positions.get(idAntiga)!;
    expect(antiga.status).toBe("rolada");
    expect(antiga.rolledIntoPositionId).toBe(r.novaPositionId);
    expect(antiga.closedAt).toBeInstanceOf(Date);
    // Rolagem não apura P&L da antiga (decisão documentada).
    expect(antiga.realizedPnl).toBeNull();
    expect(antiga.exitPrice).toBeNull();
    // A nova existe e está aberta.
    expect(store.positions.get(r.novaPositionId)!.status).toBe("aberta");
  });

  it("atomicidade: falha ao marcar a antiga → NADA persiste (sem 'rolada' órfã)", async () => {
    const store = novaStore();
    const idAntiga = seed(store, { legs: [{ id: 1, side: "compra", quantity: 1, premium: 1 }] });
    const r = await rolarPosition(idAntiga, payloadNovo(), {
      executarTx: execMemoria(store, "marcarRolada"),
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.codigo).toBe("persistencia");
    // Rollback: antiga segue aberta e a nova NÃO ficou no store.
    expect(store.positions.get(idAntiga)!.status).toBe("aberta");
    expect(store.positions.get(idAntiga)!.rolledIntoPositionId).toBeNull();
    expect(store.positions.size).toBe(1);
  });

  it("position já rolada → erro tipado", async () => {
    const store = novaStore();
    const id = seed(store, { status: "rolada", legs: [] });
    const r = await rolarPosition(id, payloadNovo(), { executarTx: execMemoria(store) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.codigo).toBe("nao_aberta");
  });

  it("reuso: a nova position é criada com a MESMA lógica de persistirTicket (mapper)", async () => {
    const store = novaStore();
    const idAntiga = seed(store, { legs: [{ id: 1, side: "compra", quantity: 1, premium: 1 }] });
    const payload = payloadNovo({ underlying: "VALE3", maxRisk: 333 });
    const r = await rolarPosition(idAntiga, payload, { executarTx: execMemoria(store) });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const nova = store.positions.get(r.novaPositionId)!;
    // O que foi gravado == o que `valoresPosition` (compartilhado) produz.
    expect(nova.valores).toEqual(valoresPosition(payload));
  });
});
