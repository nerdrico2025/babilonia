"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ClipboardCopy,
  Check,
  FileText,
  XCircle,
  Repeat,
  AlertTriangle,
  ArrowRight,
  Info,
} from "lucide-react";

import { DisclaimerNota } from "@/components/disclaimer";
import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import { RotuloRisco } from "@/components/risco/rotulo-risco";
import { Button } from "@/components/ui/button";
import { avaliarVencimento } from "@/lib/book";
import { formatBRL, formatPreco } from "@/lib/format";
import { salvarRascunho } from "@/lib/montador/rascunho";
import { NOME_FAMILIA, reconstruirRascunho } from "@/lib/montador/reconstruir";
import { cn } from "@/lib/utils";

import { encerrarPosition } from "./actions";

/** Texto pt-BR (vírgula decimal) → número, ou null. */
function paraNumero(texto: string): number | null {
  const t = texto.trim();
  if (t === "") return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Perna serializável (vinda do servidor). */
export interface PernaView {
  /** Id da `leg` no banco — referência do fechamento por perna ao encerrar. */
  legId: number;
  optionSymbol: string;
  kind: "call" | "put";
  side: "compra" | "venda";
  strike: number;
  quantity: number;
  premium: number;
}

/** Operação do histórico, serializável (datas em ISO). */
export interface PosicaoHistoricoView {
  id: number;
  underlying: string;
  structure: string;
  status: "aberta" | "encerrada" | "rolada";
  expiresAtISO: string;
  createdAtISO: string;
  /** Dias úteis até o vencimento (calculado no servidor). */
  diasUteis: number;
  maxRisk: number;
  maxGain: number | null;
  riskDefined: boolean;
  breakevens: number[];
  pernas: PernaView[];
  ticketContent: string | null;
  /** P&L realizado ao encerrar (BRL), ou null enquanto aberta/rolada. */
  realizedPnl: number | null;
  /** Position nova que substituiu esta (rolagem), ou null. */
  rolledIntoPositionId: number | null;
}

const STATUS_ROTULO: Record<PosicaoHistoricoView["status"], string> = {
  aberta: "Aberta",
  encerrada: "Encerrada",
  rolada: "Rolada",
};
const STATUS_CLASSE: Record<PosicaoHistoricoView["status"], string> = {
  aberta: "bg-risco-ok-suave text-risco-ok",
  encerrada: "bg-muted text-muted-foreground",
  rolada: "bg-risco-alerta-suave text-risco-alerta",
};

function fmtData(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

const TODOS = "__todos__";

/**
 * `<HistoricoCliente>` — a tela 8 (§8, §3.1). Lista as operações montadas/passadas
 * com filtros simples (ativo, status, vencimento), abre o resumo de cada uma com
 * risco/ganho/breakeven e o ticket gerado, e oferece o fluxo de "revisão de
 * operação existente" (§12): reabrir e gerar um ticket de ajuste.
 */
export function HistoricoCliente({
  posicoes,
  capitalTotal,
}: {
  posicoes: PosicaoHistoricoView[];
  capitalTotal: number;
}) {
  const router = useRouter();
  const [aberta, setAberta] = useState<number | null>(null);
  const [copiado, setCopiado] = useState<number | null>(null);

  // Encerramento: qual position está em modo "encerrar", os prêmios de fechamento
  // por leg (texto), e o estado de envio/erro do Server Action.
  const [encerrando, setEncerrando] = useState<number | null>(null);
  const [fechamentos, setFechamentos] = useState<Record<number, string>>({});
  const [salvandoAcao, setSalvandoAcao] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  // Filtros.
  const [fAtivo, setFAtivo] = useState(TODOS);
  const [fStatus, setFStatus] = useState(TODOS);
  const [fVencimento, setFVencimento] = useState(TODOS);

  // Opções dos filtros (valores distintos presentes no histórico).
  const ativos = useMemo(
    () => [...new Set(posicoes.map((p) => p.underlying))].sort(),
    [posicoes],
  );
  const vencimentos = useMemo(
    () =>
      [...new Set(posicoes.map((p) => p.expiresAtISO))].sort((a, b) => (a < b ? -1 : 1)),
    [posicoes],
  );

  const filtradas = posicoes.filter(
    (p) =>
      (fAtivo === TODOS || p.underlying === fAtivo) &&
      (fStatus === TODOS || p.status === fStatus) &&
      (fVencimento === TODOS || p.expiresAtISO === fVencimento),
  );

  function revisar(p: PosicaoHistoricoView) {
    // Reabre a operação reconstruída e leva ao ticket para gerar o ajuste (§12).
    salvarRascunho(reconstruirRascunho(p, capitalTotal));
    router.push("/ticket");
  }

  function abrirEncerrar(p: PosicaoHistoricoView) {
    setEncerrando(p.id);
    setErroAcao(null);
    setFechamentos(Object.fromEntries(p.pernas.map((pr) => [pr.legId, ""])));
  }

  async function confirmarEncerrar(p: PosicaoHistoricoView) {
    const pernasFechamento = p.pernas.map((pr) => ({
      legId: pr.legId,
      premioFechamento: paraNumero(fechamentos[pr.legId] ?? ""),
    }));
    if (pernasFechamento.some((x) => x.premioFechamento == null)) {
      setErroAcao("Informe o prêmio de fechamento de todas as pernas.");
      return;
    }
    // exitPrice DERIVADO dos prêmios por perna (não pedimos um campo duplicado): o
    // valor líquido de fechamento por ação = Σ sinal·prêmio (compra +, venda −). O
    // P&L em si é calculado no servidor (plRealizado), não aqui.
    const exitPrice = p.pernas.reduce(
      (acc, pr) => acc + (pr.side === "compra" ? 1 : -1) * (paraNumero(fechamentos[pr.legId] ?? "") ?? 0),
      0,
    );
    setSalvandoAcao(true);
    setErroAcao(null);
    const r = await encerrarPosition(p.id, {
      exitPrice,
      pernasFechamento: pernasFechamento.map((x) => ({
        legId: x.legId,
        premioFechamento: x.premioFechamento!,
      })),
    });
    setSalvandoAcao(false);
    if (r.ok) {
      setEncerrando(null);
      router.refresh(); // recarrega os dados do Server Component (status/P&L novos)
    } else {
      setErroAcao(r.erro.mensagem);
    }
  }

  function rolar(p: PosicaoHistoricoView) {
    // Reaproveita o pipeline reconstruir→ticket (mesmo do "revisar"), marcando o
    // rascunho como ROLAGEM: ao confirmar no ticket, chama-se `rolarPosition`.
    salvarRascunho({ ...reconstruirRascunho(p, capitalTotal), rolagemDePositionId: p.id });
    router.push("/ticket");
  }

  function verPosicao(id: number) {
    setFStatus(TODOS); // garante que a posição-alvo não esteja filtrada
    setAberta(id);
  }

  async function copiar(p: PosicaoHistoricoView) {
    if (!p.ticketContent) return;
    try {
      await navigator.clipboard.writeText(p.ticketContent);
      setCopiado(p.id);
      setTimeout(() => setCopiado((atual) => (atual === p.id ? null : atual)), 2500);
    } catch {
      setCopiado(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Execução é manual: encerrar/rolar aqui é só registro no diário (§2). */}
      <DisclaimerNota />

      {/* Filtros simples. */}
      <div className="flex flex-wrap gap-3">
        <Filtro
          id="f-ativo"
          rotulo="Ativo"
          valor={fAtivo}
          onChange={setFAtivo}
          opcoes={[{ valor: TODOS, rotulo: "Todos" }, ...ativos.map((a) => ({ valor: a, rotulo: a }))]}
        />
        <Filtro
          id="f-status"
          rotulo="Status"
          valor={fStatus}
          onChange={setFStatus}
          opcoes={[
            { valor: TODOS, rotulo: "Todos" },
            { valor: "aberta", rotulo: "Aberta" },
            { valor: "encerrada", rotulo: "Encerrada" },
            { valor: "rolada", rotulo: "Rolada" },
          ]}
        />
        <Filtro
          id="f-venc"
          rotulo="Vencimento"
          valor={fVencimento}
          onChange={setFVencimento}
          opcoes={[
            { valor: TODOS, rotulo: "Todos" },
            ...vencimentos.map((v) => ({ valor: v, rotulo: fmtData(v) })),
          ]}
        />
      </div>

      {filtradas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma operação para os filtros escolhidos.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtradas.map((p) => {
            const expandida = aberta === p.id;
            const venc = avaliarVencimento(p.diasUteis);
            return (
              <li key={p.id} className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                <button
                  type="button"
                  onClick={() => setAberta(expandida ? null : p.id)}
                  aria-expanded={expandida}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="font-heading text-base font-semibold">{p.underlying}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                          STATUS_CLASSE[p.status],
                        )}
                      >
                        {STATUS_ROTULO[p.status]}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {NOME_FAMILIA[p.structure] ?? p.structure} · montada em {fmtData(p.createdAtISO)} ·
                      vence {fmtData(p.expiresAtISO)}
                    </span>
                  </div>

                  <span className="hidden text-right sm:block">
                    <span className="block text-[11px] tracking-wide text-muted-foreground uppercase">
                      Risco
                    </span>
                    <span className={cn("font-medium tabular", !p.riskDefined && "text-risco-perigo")}>
                      {p.riskDefined ? formatBRL(p.maxRisk) : "INDEFINIDO"}
                    </span>
                  </span>

                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      expandida && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>

                {expandida && (
                  <div className="border-t border-border px-4 py-4">
                    {/* Situação atual (proximidade de vencimento, §12) — só p/ abertas. */}
                    {p.status === "aberta" && (
                      <p
                        className={cn(
                          "mb-4 rounded-lg border px-3 py-2 text-sm",
                          venc.semaforo === "vermelho"
                            ? "border-risco-perigo/40 bg-risco-perigo-suave text-risco-perigo"
                            : venc.semaforo === "amarelo"
                              ? "border-risco-alerta/40 bg-risco-alerta-suave text-risco-alerta"
                              : "border-border bg-muted/40 text-muted-foreground",
                        )}
                      >
                        Situação atual: {venc.sugestao}
                      </p>
                    )}

                    {/* P&L realizado (encerrada) — sem espalhafato, mas claro. */}
                    {p.status === "encerrada" && p.realizedPnl != null && (
                      <p
                        className={cn(
                          "mb-4 rounded-lg border px-3 py-2 text-sm",
                          p.realizedPnl >= 0
                            ? "border-risco-ok/40 bg-risco-ok-suave text-risco-ok"
                            : "border-risco-perigo/40 bg-risco-perigo-suave text-risco-perigo",
                        )}
                      >
                        Resultado realizado: {p.realizedPnl >= 0 ? "lucro" : "prejuízo"} de{" "}
                        <span className="font-semibold">{formatBRL(Math.abs(p.realizedPnl))}</span>.
                      </p>
                    )}

                    {/* Rolagem: link para a nova position que substituiu esta. */}
                    {p.status === "rolada" && p.rolledIntoPositionId != null && (
                      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-risco-alerta/40 bg-risco-alerta-suave px-3 py-2 text-sm text-risco-alerta">
                        <Repeat className="size-4 shrink-0" aria-hidden />
                        <span>Esta operação foi rolada para uma nova posição.</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => verPosicao(p.rolledIntoPositionId!)}
                        >
                          Ver a posição #{p.rolledIntoPositionId}
                          <ArrowRight className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Risco máximo</p>
                        <p className="mt-0.5 font-heading text-lg font-bold text-risco-perigo">
                          {p.riskDefined ? formatBRL(p.maxRisk) : "INDEFINIDO"}
                        </p>
                        <RotuloRisco tipo={p.riskDefined ? "definido" : "indefinido"} className="mt-2" />
                      </div>
                      <div>
                        <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Ganho máximo</p>
                        <p className="mt-0.5 font-heading text-lg font-bold text-risco-ok">
                          {p.maxGain == null ? "Ilimitado" : formatBRL(p.maxGain)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                          <TermoTecnico termo="breakeven">Breakeven(s)</TermoTecnico>
                        </p>
                        <p className="mt-0.5 font-medium tabular">
                          {p.breakevens.length > 0
                            ? p.breakevens.map((b) => formatPreco(b)).join(" · ")
                            : "—"}
                        </p>
                      </div>
                    </div>

                    {/* Pernas. */}
                    <div className="mt-4">
                      <p className="mb-1.5 text-[11px] tracking-wide text-muted-foreground uppercase">Pernas</p>
                      <ul className="flex flex-col gap-1 text-sm">
                        {p.pernas.map((perna, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
                            <span className="font-medium text-foreground">{perna.optionSymbol}</span>
                            <span className="capitalize">{perna.side} {perna.kind}</span>
                            <span className="tabular">
                              strike {formatPreco(perna.strike)} · {perna.quantity} contrato(s) ·{" "}
                              <TermoTecnico termo="premio">prêmio</TermoTecnico> {formatPreco(perna.premium)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Ticket gerado (reabrir o ticket antigo). */}
                    {p.ticketContent && (
                      <details className="mt-4">
                        <summary className="cursor-pointer text-sm font-medium">
                          Ver o <TermoTecnico termo="ticket">ticket</TermoTecnico> gerado
                        </summary>
                        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                          {p.ticketContent}
                        </pre>
                        <Button variant="outline" size="sm" className="mt-2" onClick={() => copiar(p)}>
                          {copiado === p.id ? <Check className="size-3.5" aria-hidden /> : <ClipboardCopy className="size-3.5" aria-hidden />}
                          {copiado === p.id ? "Copiado!" : "Copiar ticket"}
                        </Button>
                      </details>
                    )}

                    {/* Ações. Revisar serve a qualquer status; encerrar/rolar só
                        às abertas (mover o estado é só do ciclo de vida ativo). */}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => revisar(p)}>
                        <FileText className="size-4" aria-hidden />
                        Revisar (gerar ticket de ajuste)
                      </Button>
                      {p.status === "aberta" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => (encerrando === p.id ? setEncerrando(null) : abrirEncerrar(p))}
                          >
                            <XCircle className="size-4" aria-hidden />
                            Encerrar
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => rolar(p)}>
                            <Repeat className="size-4" aria-hidden />
                            Rolar
                          </Button>
                        </>
                      )}
                    </div>

                    {/* Formulário de encerramento (expansível) da position aberta. */}
                    {p.status === "aberta" && encerrando === p.id && (
                      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-muted/30 px-4 py-4">
                        <p className="text-sm font-medium">
                          Encerrar a operação — informe o{" "}
                          <TermoTecnico termo="premio">prêmio</TermoTecnico> de fechamento de cada perna
                        </p>
                        <ul className="flex flex-col gap-2">
                          {p.pernas.map((perna) => (
                            <li
                              key={perna.legId}
                              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="font-medium text-foreground">{perna.optionSymbol}</span>{" "}
                                <span className="capitalize text-muted-foreground">
                                  {perna.side} {perna.kind}
                                </span>{" "}
                                <span className="tabular text-muted-foreground">
                                  · strike {formatPreco(perna.strike)} · {perna.quantity} contrato(s) ·
                                  abertura {formatPreco(perna.premium)}
                                </span>
                              </span>
                              <label className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">fechamento (R$)</span>
                                <input
                                  inputMode="decimal"
                                  aria-label={`Prêmio de fechamento de ${perna.optionSymbol}`}
                                  value={fechamentos[perna.legId] ?? ""}
                                  onChange={(e) =>
                                    setFechamentos((f) => ({ ...f, [perna.legId]: e.target.value }))
                                  }
                                  placeholder="—"
                                  className="w-24 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                                />
                              </label>
                            </li>
                          ))}
                        </ul>

                        {erroAcao && (
                          <p className="flex items-start gap-1.5 text-sm text-risco-perigo">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                            {erroAcao}
                          </p>
                        )}

                        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          Registrar o encerramento aqui é só o seu diário — a ordem de fechamento você
                          digita na corretora.
                        </p>

                        <div className="flex gap-2">
                          <Button size="sm" disabled={salvandoAcao} onClick={() => confirmarEncerrar(p)}>
                            {salvandoAcao ? "Salvando…" : "Confirmar encerramento"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={salvandoAcao}
                            onClick={() => setEncerrando(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Filtro({
  id,
  rotulo,
  valor,
  onChange,
  opcoes,
}: {
  id: string;
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  opcoes: { valor: string; rotulo: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">{rotulo}</label>
      <select
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </div>
  );
}
