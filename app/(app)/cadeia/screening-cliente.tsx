"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Info, Loader2, Search } from "lucide-react";

import { DisclaimerNota } from "@/components/disclaimer";
import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import { RotuloRisco } from "@/components/risco/rotulo-risco";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL, formatPct, formatPreco } from "@/lib/format";
import type {
  EstruturaScreening,
  RespostaScreening,
  TipoEstrutura,
} from "@/lib/integrations/quant-service";
import type { EstruturaId } from "@/lib/montador/catalogo";
import {
  salvarSelecaoCadeia,
  type SerieSelecionada,
} from "@/lib/montador/selecao-cadeia";
import { cn } from "@/lib/utils";

// Famílias de estrutura para os chips do filtro. Nenhuma marcada = todas (default
// do serviço). Rótulos em linguagem de iniciante.
const TIPOS: { id: TipoEstrutura; label: string }[] = [
  { id: "trava_alta", label: "Trava de alta" },
  { id: "trava_baixa", label: "Trava de baixa" },
  { id: "borboleta", label: "Borboleta" },
  { id: "condor", label: "Condor" },
  { id: "straddle", label: "Straddle" },
  { id: "strangle", label: "Strangle" },
];

// ── Formatadores ─────────────────────────────────────────────────────────────

/** ISO (datetime) → "DD/MM/AAAA" em UTC (o dado é EOD; não recuar fuso). */
function fmtData(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** ISO → "DD/MM" para o vencimento. */
function fmtVenc(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** Ganho: número em BRL, ou "Ilimitado". */
function fmtGanho(g: number | "ilimitado"): string {
  return g === "ilimitado" ? "Ilimitado" : formatBRL(g);
}

/** Razão ganho/risco: "1,67×" ou "—" (ganho ilimitado, sem razão finita). */
function fmtRazao(v: number | null): string {
  return v == null
    ? "—"
    : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`;
}

/**
 * Identifica o `EstruturaId` do montador a partir do tipo + composição das pernas
 * (calls vs puts), para o botão "usar esta estrutura" pré-selecionar a estrutura
 * certa. O screening só devolve formas de risco DEFINIDO (comprado/débito/crédito).
 */
function estruturaIdDe(e: EstruturaScreening): EstruturaId {
  const temCall = e.pernas.some((p) => p.tipo === "call");
  const temPut = e.pernas.some((p) => p.tipo === "put");
  switch (e.tipo_estrutura) {
    case "trava_alta":
      return temCall && !temPut ? "trava_alta_debito" : "trava_alta_credito";
    case "trava_baixa":
      return temPut && !temCall ? "trava_baixa_debito" : "trava_baixa_credito";
    case "borboleta":
      return "borboleta";
    case "condor":
      return "condor";
    case "straddle":
      return "straddle_comprado";
    case "strangle":
      return "strangle_comprado";
  }
}

/**
 * `<ScreeningCliente>` — aba de TRIAGEM da tela de Cadeia (§15 Fase 3). Varre a
 * cadeia inteira no microserviço de quant (`/api/screening`) e lista estruturas de
 * risco DEFINIDO ranqueadas por risco/retorno, com risco ANTES do ganho (§2) e o
 * botão "usar esta estrutura" que leva ao montador já pré-preenchido.
 *
 * NÃO recalcula nada: todos os números vêm do microserviço (mesmas fórmulas do §18).
 */
export function ScreeningCliente() {
  const router = useRouter();

  const [tickers, setTickers] = useState("");
  const [tipos, setTipos] = useState<Set<TipoEstrutura>>(new Set());
  const [vencMaxDias, setVencMaxDias] = useState("");
  const [capital, setCapital] = useState("");
  const [riscoMaxPct, setRiscoMaxPct] = useState("");

  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [dados, setDados] = useState<RespostaScreening | null>(null);

  function alternarTipo(id: TipoEstrutura) {
    setTipos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Texto livre "PETR4, VALE3" → lista de tickers (vazio = watchlist inteira).
  function parseTickers(): string[] {
    return tickers
      .split(/[\s,;]+/)
      .map((t) => t.trim().toUpperCase())
      .filter((t) => t.length > 0);
  }

  // Número opcional de um input pt-BR (vírgula decimal); inválido/vazio → undefined.
  function num(valor: string): number | undefined {
    const v = valor.trim().replace(",", ".");
    if (v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    setDados(null);

    const lista = parseTickers();
    const capitalNum = num(capital);
    const pctNum = num(riscoMaxPct); // o usuário digita em %, convertemos p/ fração
    const vencNum = num(vencMaxDias);

    const body: Record<string, unknown> = { topN: 12 };
    if (lista.length > 0) body.tickers = lista;
    if (tipos.size > 0) body.tipos = [...tipos];
    if (vencNum != null) body.vencimentoMaxDias = Math.round(vencNum);
    if (capitalNum != null && capitalNum > 0) body.capitalTotal = capitalNum;
    if (pctNum != null && pctNum > 0) body.riscoMaxPct = pctNum / 100;

    try {
      const resp = await fetch("/api/screening", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        setErro(json?.mensagem ?? "Não foi possível rodar a triagem agora.");
        return;
      }
      setDados(json as RespostaScreening);
    } catch {
      setErro(
        "Não foi possível falar com a ferramenta de triagem. Tente de novo em instantes.",
      );
    } finally {
      setCarregando(false);
    }
  }

  function usarEstrutura(e: EstruturaScreening) {
    // As pernas viram séries para o montador — com o ticker EXATO e o prêmio (mid)
    // que o serviço usou. Nada é recalculado nem redigitado (§2.4).
    const series: SerieSelecionada[] = e.pernas.map((p) => ({
      symbol: p.option_symbol,
      tipo: p.tipo,
      strike: p.strike,
      vencimento: e.vencimento,
      premioRef: p.premio,
      bid: p.bid,
      ask: p.ask,
    }));
    salvarSelecaoCadeia({
      ativo: e.ativo,
      series,
      estruturaSugerida: estruturaIdDe(e),
    });
    router.push("/montador");
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      {/* Formulário de triagem. */}
      <form onSubmit={buscar} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <label htmlFor="screening-tickers" className="text-sm font-medium">
              Ativo(s) — opcional
            </label>
            <Input
              id="screening-tickers"
              value={tickers}
              onChange={(ev) => setTickers(ev.target.value.toUpperCase())}
              placeholder="PETR4, VALE3 (em branco = sua watchlist inteira)"
            />
          </div>
          <div className="flex w-40 flex-col gap-1.5">
            <label htmlFor="screening-venc" className="text-sm font-medium">
              <TermoTecnico termo="vencimento">Vencimento</TermoTecnico> até (dias)
            </label>
            <Input
              id="screening-venc"
              value={vencMaxDias}
              onChange={(ev) => setVencMaxDias(ev.target.value)}
              placeholder="ex.: 45"
              inputMode="numeric"
            />
          </div>
        </div>

        {/* Tipos de estrutura (nenhum marcado = todas). */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            Tipos de estrutura — opcional (nenhum = todas)
          </span>
          <div className="flex flex-wrap gap-2">
            {TIPOS.map((t) => {
              const ativo = tipos.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => alternarTipo(t.id)}
                  aria-pressed={ativo}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    ativo
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-muted",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Filtro de capital/risco (§10) — opcional. */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex w-44 flex-col gap-1.5">
            <label htmlFor="screening-capital" className="text-sm font-medium">
              Capital total (R$) — opcional
            </label>
            <Input
              id="screening-capital"
              value={capital}
              onChange={(ev) => setCapital(ev.target.value)}
              placeholder="ex.: 50000"
              inputMode="decimal"
            />
          </div>
          <div className="flex w-44 flex-col gap-1.5">
            <label htmlFor="screening-risco" className="text-sm font-medium">
              Risco máx. (% do capital)
            </label>
            <Input
              id="screening-risco"
              value={riscoMaxPct}
              onChange={(ev) => setRiscoMaxPct(ev.target.value)}
              placeholder="ex.: 5"
              inputMode="decimal"
            />
          </div>
          <Button type="submit" disabled={carregando}>
            {carregando ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Search className="size-4" aria-hidden />
            )}
            Rodar triagem
          </Button>
        </div>
      </form>

      {/* Loading — avisa que o serviço pode estar "acordando" (Railway free). */}
      {carregando && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3.5 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          <span>
            Varrendo a cadeia e ranqueando estruturas… A ferramenta de triagem pode
            estar iniciando (pode levar alguns segundos na primeira chamada).
          </span>
        </div>
      )}

      {/* Erro / indisponibilidade — não quebra a aba de cadeia ao lado. */}
      {erro && !carregando && (
        <div className="flex items-start gap-2 rounded-lg border border-risco-alerta/40 bg-risco-alerta-suave px-3.5 py-3 text-sm text-risco-alerta">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{erro}</span>
        </div>
      )}

      {dados && !carregando && <Resultados dados={dados} onUsar={usarEstrutura} />}
    </div>
  );
}

// ── Resultados ────────────────────────────────────────────────────────────────

function Resultados({
  dados,
  onUsar,
}: {
  dados: RespostaScreening;
  onUsar: (e: EstruturaScreening) => void;
}) {
  // Frescor por ativo (só os que têm cadeia ingerida) — carimba a data-base.
  const comDado = dados.frescor.filter((f) => f.data_referencia != null);

  return (
    <div className="flex flex-col gap-4">
      {/* Disclaimer de TRIAGEM (além do global do rodapé) — texto vem do serviço. */}
      <DisclaimerNota />
      <div className="flex items-start gap-2 rounded-lg border border-dourado/40 bg-dourado/10 px-3.5 py-3 text-sm leading-snug text-foreground/80">
        <Info className="mt-0.5 size-4 shrink-0 text-dourado" aria-hidden />
        <span>{dados.aviso}</span>
      </div>

      {/* Frescor (data-base por ativo). */}
      {comDado.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Dados de fechamento:{" "}
          {comDado
            .map((f) => `${f.ativo} (${fmtData(f.data_referencia)})`)
            .join(" · ")}
        </p>
      )}

      {dados.ranking.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma estrutura de risco definido passou nos filtros (liquidez, capital,
          vencimento). Tente afrouxar os filtros ou outro ativo.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {dados.ranking.map((e, i) => (
            <CardEstrutura
              key={`${e.ativo}-${e.nome}-${i}`}
              estrutura={e}
              onUsar={() => onUsar(e)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Card de uma estrutura ranqueada. ORDEM do §2: risco máximo + rótulo DEFINIDO em
 * destaque ANTES do ganho. Todos os números vêm do microserviço.
 */
function CardEstrutura({
  estrutura: e,
  onUsar,
}: {
  estrutura: EstruturaScreening;
  onUsar: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      {/* Cabeçalho. */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-heading text-base font-semibold">{e.nome}</p>
          <p className="text-xs text-muted-foreground">
            {e.ativo} · vence em {fmtVenc(e.vencimento)}
            {e.data_referencia ? ` · fechamento de ${fmtData(e.data_referencia)}` : ""}
          </p>
        </div>
      </div>

      {/* RISCO ANTES DO GANHO (§2). */}
      <div className="flex flex-col gap-2">
        <RotuloRisco tipo={e.rotulo_risco === "DEFINIDO" ? "definido" : "indefinido"} />
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Risco máximo
            </p>
            <p className="font-heading text-lg font-bold tabular text-risco-perigo">
              {formatBRL(e.risco_maximo)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Ganho máximo
            </p>
            <p className="font-medium tabular">{fmtGanho(e.ganho_maximo)}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              <TermoTecnico termo="razao-ganho-risco">Razão ganho/risco</TermoTecnico>
            </p>
            <p className="font-medium tabular">{fmtRazao(e.razao_ganho_risco)}</p>
          </div>
        </div>
        {e.risco_pct_capital != null && (
          <p className="text-xs text-muted-foreground">
            Usaria {formatPct(e.risco_pct_capital)} do seu capital em risco.
          </p>
        )}
      </div>

      {/* Breakevens. */}
      <p className="text-xs text-muted-foreground">
        <TermoTecnico termo="breakeven">Equilíbrio</TermoTecnico>:{" "}
        {e.breakevens.length > 0
          ? e.breakevens.map((b) => formatPreco(b)).join(" e ")
          : "—"}
      </p>

      {/* Pernas (ticker exato + lado + strike + prêmio). */}
      <div className="flex flex-col gap-1 rounded-lg bg-muted/40 p-2 text-xs">
        {e.pernas.map((p) => (
          <div key={p.option_symbol} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 font-medium",
                  p.lado === "compra"
                    ? "bg-risco-ok-suave text-risco-ok"
                    : "bg-risco-alerta-suave text-risco-alerta",
                )}
              >
                {p.lado === "compra" ? "Compra" : "Venda"}
              </span>
              <span className="font-medium">{p.option_symbol}</span>
              <span className="text-muted-foreground capitalize">{p.tipo}</span>
            </span>
            <span className="tabular text-muted-foreground">
              {p.quantidade > 1 ? `${p.quantidade}× ` : ""}
              {formatPreco(p.strike)} · {formatPreco(p.premio)}
            </span>
          </div>
        ))}
      </div>

      {/* Disclaimer curto de triagem + ação. */}
      <p className="text-[11px] leading-snug text-muted-foreground">
        Ferramenta de triagem, não recomendação — a decisão é sua.
      </p>
      <Button onClick={onUsar} className="w-full" size="sm">
        Usar esta estrutura
        <ArrowRight className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
