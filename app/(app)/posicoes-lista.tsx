"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, FileText, TriangleAlert } from "lucide-react";

import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import { RotuloRisco } from "@/components/risco/rotulo-risco";
import { Semaforo, type NivelRisco } from "@/components/risco/semaforo";
import { Button } from "@/components/ui/button";
import { avaliarVencimento } from "@/lib/book";
import { formatBRL, formatPreco } from "@/lib/format";
import { salvarRascunho } from "@/lib/montador/rascunho";
import { NOME_FAMILIA, reconstruirRascunho } from "@/lib/montador/reconstruir";
import type { Semaforo as SemaforoCor } from "@/lib/risk-rules";
import { cn } from "@/lib/utils";

// Converte a cor do semáforo (risk-rules) no nível visual do componente.
const NIVEL_POR_COR: Record<SemaforoCor, NivelRisco> = {
  verde: "ok",
  amarelo: "alerta",
  vermelho: "perigo",
};

/** Perna serializável vinda do servidor. */
export interface PernaView {
  optionSymbol: string;
  kind: "call" | "put";
  side: "compra" | "venda";
  strike: number;
  quantity: number;
  premium: number;
}

/** Posição do book, serializável (datas em ISO) para o client. */
export interface PosicaoView {
  id: number;
  underlying: string;
  structure: string;
  expiresAtISO: string;
  /** Dias úteis até o vencimento (calculado no servidor). */
  diasUteis: number;
  maxRisk: number;
  maxGain: number | null;
  riskDefined: boolean;
  breakevens: number[];
  pernas: PernaView[];
}

function fmtData(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/**
 * Lista de posições do book (parte interativa do dashboard, §8.1). Cada posição
 * abre um resumo com risco/ganho/breakevens e um botão para "revisar" — que
 * reconstrói a operação e leva à tela de ticket para gerar um ticket de ajuste.
 */
export function PosicoesLista({
  posicoes,
  capitalTotal,
}: {
  posicoes: PosicaoView[];
  capitalTotal: number;
}) {
  const router = useRouter();
  const [aberta, setAberta] = useState<number | null>(null);

  // Reconstrói a estrutura (números do options-math) e leva ao ticket para
  // revisar/ajustar a posição. Os tickers vão pré-preenchidos (§12).
  function revisar(p: PosicaoView) {
    salvarRascunho(reconstruirRascunho(p, capitalTotal));
    router.push("/ticket");
  }

  return (
    <ul className="flex flex-col gap-3">
      {posicoes.map((p) => {
        const venc = avaliarVencimento(p.diasUteis);
        const expandida = aberta === p.id;
        return (
          <li key={p.id} className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            {/* Cabeçalho clicável da posição. */}
            <button
              type="button"
              onClick={() => setAberta(expandida ? null : p.id)}
              aria-expanded={expandida}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-heading text-base font-semibold">{p.underlying}</span>
                <span className="text-xs text-muted-foreground">
                  {NOME_FAMILIA[p.structure] ?? p.structure} · vence {fmtData(p.expiresAtISO)}
                </span>
              </div>

              {/* Vencimento com semáforo. */}
              <span className="hidden items-center gap-1.5 sm:inline-flex">
                <Semaforo nivel={NIVEL_POR_COR[venc.semaforo]} mostrarRotulo={false} />
                <span className="text-xs text-muted-foreground">
                  {p.diasUteis <= 0 ? "vencido/hoje" : `${p.diasUteis} dia(s) úteis`}
                </span>
              </span>

              {/* Risco máximo (sempre antes do ganho, §2). */}
              <span className="text-right">
                <span className="block text-[11px] tracking-wide text-muted-foreground uppercase">
                  Risco
                </span>
                <span
                  className={cn(
                    "font-medium tabular",
                    p.riskDefined ? "text-foreground" : "text-risco-perigo",
                  )}
                >
                  {p.riskDefined ? formatBRL(p.maxRisk) : "INDEFINIDO"}
                </span>
              </span>

              <ChevronDown
                className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expandida && "rotate-180")}
                aria-hidden
              />
            </button>

            {/* Detalhe expandido. */}
            {expandida && (
              <div className="border-t border-border px-4 py-4">
                {/* Alerta de vencimento, se houver urgência (§8.1 item 3). */}
                {venc.semaforo !== "verde" && (
                  <div
                    className={cn(
                      "mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                      venc.urgente
                        ? "border-risco-perigo/40 bg-risco-perigo-suave text-risco-perigo"
                        : "border-risco-alerta/40 bg-risco-alerta-suave text-risco-alerta",
                    )}
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{venc.sugestao}</span>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                      Risco máximo
                    </p>
                    <p className="mt-0.5 font-heading text-lg font-bold text-risco-perigo">
                      {p.riskDefined ? formatBRL(p.maxRisk) : "INDEFINIDO"}
                    </p>
                    <RotuloRisco tipo={p.riskDefined ? "definido" : "indefinido"} className="mt-2" />
                  </div>
                  <div>
                    <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                      Ganho máximo
                    </p>
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

                {/* Pernas da operação. */}
                <div className="mt-4">
                  <p className="mb-1.5 text-[11px] tracking-wide text-muted-foreground uppercase">
                    Pernas
                  </p>
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

                <div className="mt-4">
                  <Button variant="outline" size="sm" onClick={() => revisar(p)}>
                    <FileText className="size-4" aria-hidden />
                    Revisar (gerar ticket de ajuste)
                  </Button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
