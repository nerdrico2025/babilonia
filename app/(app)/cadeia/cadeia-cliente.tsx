"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatPreco } from "@/lib/format";
import {
  avaliarLiquidez,
  precoReferencia,
  type AvaliacaoLiquidez,
} from "@/lib/liquidez";
import {
  salvarSelecaoCadeia,
  type SerieSelecionada,
} from "@/lib/montador/selecao-cadeia";
import type {
  CadeiaOpcoes,
  GregasOpcao,
  OpcaoCadeia,
  TipoOpcao,
  VolatilidadeAtivo,
} from "@/lib/opcoes/tipos";
import { cn } from "@/lib/utils";

// Metadado de frescor do dado (§6.3) — espelha `Frescor` do Route Handler.
interface Frescor {
  origem: "rede" | "cache" | "cache_fallback";
  geradoEm: string;
  desatualizado: boolean;
  podeForcarAtualizacao: boolean;
  aviso?: string;
}

// Resposta de GET /api/cadeia/{ativo}.
interface RespostaCadeia {
  ativo: string;
  cadeia: CadeiaOpcoes;
  volatilidade: VolatilidadeAtivo | null;
  frescor: { cadeia: Frescor; volatilidade: Frescor | null };
}

// Estado das gregas por opção (carregadas sob demanda via /api/gregas).
type EstadoGregas = GregasOpcao | "carregando" | "erro";

// ── Formatadores curtos ─────────────────────────────────────────────────────

/** Formata uma grega (delta/gama/theta/vega) com 3 casas, em pt-BR. */
function fmtGrega(v: number | null): string {
  return v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/** Formata IV — a camada de dados já entrega em % (ex.: 54.08 → "54,1%"). */
function fmtIV(v: number | null): string {
  return v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/**
 * Data-base EOD → "DD/MM/AAAA". A cadeia é dado de FECHAMENTO (§6.2): o frescor
 * carimba o pregão, não a hora. `geradoEm` é o `trade_date` (meia-noite UTC), então
 * formata-se em UTC para não recuar um dia no fuso de São Paulo.
 */
function fmtDataEod(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** Vencimento ISO → "DD/MM" para os botões de série. */
function fmtVencCurto(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  }).format(d);
}

/**
 * `<CadeiaCliente>` — a tela 5 (§8.3). Busca a cadeia via `/api/cadeia` (camada de
 * dados COTAHIST, EOD), mostra calls/puts por vencimento e strike com prêmio,
 * volume, spread e liquidez, carrega as gregas sob demanda (`/api/gregas`, §6.4
 * #2), carimba o FRESCO do dado (fechamento de DD/MM) e permite enviar séries ao
 * montador.
 *
 * Degrada graciosamente: ativo sem cadeia ingerida (fora da watchlist / sem
 * COTAHIST) → a API devolve 503 e a tela mostra erro com botão de tentar de novo.
 */
export function CadeiaCliente() {
  const router = useRouter();

  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState<string | null>(null);
  const [dados, setDados] = useState<RespostaCadeia | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [vencimentoSel, setVencimentoSel] = useState<string | null>(null);
  const [lado, setLado] = useState<TipoOpcao>("call");
  const [soLiquidas, setSoLiquidas] = useState(false);

  const [selecionadas, setSelecionadas] = useState<Map<string, SerieSelecionada>>(new Map());

  const [selic, setSelic] = useState("");
  const [gregasMap, setGregasMap] = useState<Record<string, EstadoGregas>>({});
  const [carregandoGregas, setCarregandoGregas] = useState(false);

  // ── Busca da cadeia (com opção de forçar atualização — §6.3) ─────────────────
  const carregar = useCallback(async (tic: string, forcar = false) => {
    setCarregando(true);
    setErro(null);
    try {
      const url = `/api/cadeia/${encodeURIComponent(tic)}${forcar ? "?forcar=true" : ""}`;
      const resp = await fetch(url);
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        setErro(json?.mensagem ?? "Não foi possível carregar a cadeia.");
        setDados(null);
        return;
      }
      setDados(json as RespostaCadeia);
      // Gregas mudam com o dado: limpa o que estava carregado.
      setGregasMap({});
    } catch {
      setErro("Não foi possível conectar à fonte de dados. Tente novamente.");
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  // Vencimento "efetivo": o selecionado, se ainda válido; senão o primeiro da
  // cadeia. Derivado em render (sem efeito) — evita setState dentro de useEffect.
  const vencimentos = dados?.cadeia.vencimentos ?? [];
  const vencimentoEfetivo =
    vencimentoSel && vencimentos.some((v) => v.vencimento === vencimentoSel)
      ? vencimentoSel
      : (vencimentos[0]?.vencimento ?? null);

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    const tic = busca.trim().toUpperCase();
    if (!tic) return;
    setAtivo(tic);
    setVencimentoSel(null);
    setSelecionadas(new Map());
    void carregar(tic);
  }

  const serieSel = dados?.cadeia.vencimentos.find((v) => v.vencimento === vencimentoEfetivo) ?? null;

  // Linhas da tabela: strikes do vencimento selecionado, no lado escolhido.
  const linhas = (serieSel?.strikes ?? [])
    .map((st) => ({ strike: st.strike, op: lado === "call" ? st.call : st.put }))
    .filter((l): l is { strike: number; op: OpcaoCadeia } => l.op != null)
    .map((l) => ({ ...l, liq: avaliarLiquidez(l.op) }))
    .filter((l) => (soLiquidas ? l.liq.nivel === "ok" : true));

  // ── Gregas sob demanda (§6.4 #2: não vêm na cadeia; calculadas por opção) ─────
  const selicNum = (() => {
    const n = Number(selic.trim().replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  async function carregarGregas() {
    if (!dados || linhas.length === 0) return;
    const dtm = serieSel?.diasAteVencimento ?? undefined;
    const spot = dados.cadeia.precoAtivo ?? undefined;
    const alvos = linhas.map((l) => l.op);

    setGregasMap((m) => {
      const novo = { ...m };
      for (const op of alvos) novo[op.symbol] = "carregando";
      return novo;
    });
    setCarregandoGregas(true);

    await Promise.all(
      alvos.map(async (op) => {
        const p = new URLSearchParams({ symbol: op.symbol, tipo: op.tipo });
        // SELIC é opcional: em branco, a rota auto-preenche a do dia (BCB-SGS).
        if (selicNum != null) p.set("irate", String(selicNum));
        const mid = precoReferencia(op);
        if (mid != null) p.set("premium", String(mid));
        if (op.strike) p.set("strike", String(op.strike));
        if (dtm != null) p.set("dtm", String(dtm));
        if (spot != null) p.set("spotprice", String(spot));
        try {
          const r = await fetch(`/api/gregas?${p.toString()}`);
          const j = await r.json().catch(() => null);
          setGregasMap((m) => ({ ...m, [op.symbol]: r.ok && j ? (j.gregas as GregasOpcao) : "erro" }));
        } catch {
          setGregasMap((m) => ({ ...m, [op.symbol]: "erro" }));
        }
      }),
    );
    setCarregandoGregas(false);
  }

  // ── Seleção de séries → montador ─────────────────────────────────────────────
  function alternarSelecao(op: OpcaoCadeia, liq: AvaliacaoLiquidez) {
    setSelecionadas((prev) => {
      const next = new Map(prev);
      if (next.has(op.symbol)) next.delete(op.symbol);
      else {
        next.set(op.symbol, {
          symbol: op.symbol,
          tipo: op.tipo,
          strike: op.strike,
          vencimento: op.vencimento,
          premioRef: liq.precoReferencia,
          bid: op.bid,
          ask: op.ask,
        });
      }
      return next;
    });
  }

  function enviarAoMontador() {
    if (!dados || selecionadas.size === 0) return;
    salvarSelecaoCadeia({ ativo: dados.ativo, series: [...selecionadas.values()] });
    router.push("/montador");
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      {/* Busca por ticker. */}
      <form onSubmit={buscar} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="busca-ativo" className="text-sm font-medium">
            Ativo-objeto
          </label>
          <Input
            id="busca-ativo"
            value={busca}
            onChange={(e) => setBusca(e.target.value.toUpperCase())}
            placeholder="PETR4"
            inputMode="text"
          />
        </div>
        <Button type="submit" disabled={carregando}>
          {carregando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
          Ver cadeia
        </Button>
      </form>

      {/* Estados iniciais / de erro. */}
      {!ativo && !dados && (
        <p className="text-sm text-muted-foreground">
          Busque um ticker da B3 (ex.: PETR4) para ver as{" "}
          <TermoTecnico termo="strike">calls e puts</TermoTecnico> por vencimento e strike.
        </p>
      )}

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-risco-perigo/40 bg-risco-perigo-suave px-3.5 py-3 text-sm text-risco-perigo">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex flex-col gap-2">
            <span>{erro}</span>
            {ativo && (
              <Button variant="outline" size="sm" onClick={() => carregar(ativo)} className="w-fit">
                <RefreshCw className="size-3.5" aria-hidden />
                Tentar de novo
              </Button>
            )}
          </div>
        </div>
      )}

      {dados && (
        <>
          <CabecalhoAtivo dados={dados} />
          <BarraFrescor
            frescor={dados.frescor.cadeia}
            carregando={carregando}
            onAtualizar={() => ativo && carregar(ativo, true)}
          />

          {/* Seletor de vencimento. */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <TermoTecnico termo="vencimento">Vencimento</TermoTecnico>
            </span>
            <div className="flex flex-wrap gap-2">
              {dados.cadeia.vencimentos.map((v) => (
                <button
                  key={v.vencimento}
                  type="button"
                  onClick={() => setVencimentoSel(v.vencimento)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                    v.vencimento === vencimentoEfetivo
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-muted",
                  )}
                >
                  {fmtVencCurto(v.vencimento)}
                  {v.diasAteVencimento != null && (
                    <span className="ml-1.5 text-xs opacity-70">{v.diasAteVencimento}d</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Controles: lado, filtro de liquidez, SELIC/gregas. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {(["call", "put"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLado(l)}
                  className={cn(
                    "rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors",
                    lado === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {l === "call" ? "Calls" : "Puts"}
                </button>
              ))}
            </div>

            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={soLiquidas}
                onChange={(e) => setSoLiquidas(e.target.checked)}
                className="size-4 accent-primary"
              />
              Mostrar só séries com <TermoTecnico termo="liquidez">liquidez</TermoTecnico> ok
            </label>

            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="selic" className="text-xs text-muted-foreground">
                  SELIC (% a.a.) p/ gregas — opcional
                </label>
                <Input
                  id="selic"
                  value={selic}
                  onChange={(e) => setSelic(e.target.value)}
                  placeholder="deixe em branco p/ a Selic do dia"
                  inputMode="decimal"
                  className="h-8 w-56"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={carregarGregas}
                disabled={carregandoGregas || linhas.length === 0}
              >
                {carregandoGregas ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                Carregar gregas
              </Button>
            </div>
          </div>

          {/* Nota honesta sobre open interest (§6.4). */}
          <p className="text-xs text-muted-foreground">{dados.cadeia.notaLiquidez}</p>

          {/* Tabela da cadeia. */}
          <TabelaCadeia
            linhas={linhas}
            gregasMap={gregasMap}
            selecionadas={selecionadas}
            onAlternar={alternarSelecao}
          />

          {linhas.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma série para mostrar neste vencimento
              {soLiquidas ? " com liquidez ok (desligue o filtro para ver todas)" : ""}.
            </p>
          )}
        </>
      )}

      {/* Barra de ação da seleção (envia ao montador). */}
      {selecionadas.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <span className="text-sm">
              <strong>{selecionadas.size}</strong> série(s) selecionada(s) para montar
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelecionadas(new Map())}>
                <X className="size-4" aria-hidden />
                Limpar
              </Button>
              <Button onClick={enviarAoMontador}>
                Montar estrutura
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cabeçalho do ativo (preço + IV + IV Rank) ───────────────────────────────────

function CabecalhoAtivo({ dados }: { dados: RespostaCadeia }) {
  const { cadeia, volatilidade } = dados;
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <div>
        <p className="text-xs text-muted-foreground">Ativo</p>
        <p className="font-heading text-lg font-semibold">{cadeia.ativo}</p>
      </div>
      {cadeia.precoAtivo != null && (
        <div>
          <p className="text-xs text-muted-foreground">Preço</p>
          <p className="font-medium tabular">{formatPreco(cadeia.precoAtivo)}</p>
        </div>
      )}
      <div>
        <p className="text-xs text-muted-foreground">
          <TermoTecnico termo="volatilidade-implicita">IV</TermoTecnico> do ativo
        </p>
        <p className="font-medium tabular">{fmtIV(cadeia.ivAtual ?? volatilidade?.ivAtual ?? null)}</p>
      </div>
      {volatilidade && (
        <div>
          <p className="text-xs text-muted-foreground">
            <TermoTecnico termo="iv-rank">IV Rank</TermoTecnico> (1a / 6m)
          </p>
          <p className="font-medium tabular">
            {volatilidade.ivRank1a != null ? `${volatilidade.ivRank1a.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` : "—"}
            {" / "}
            {volatilidade.ivRank6m != null ? `${volatilidade.ivRank6m.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` : "—"}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Barra de frescor do dado (§6.3) ──────────────────────────────────────────────

function BarraFrescor({
  frescor,
  carregando,
  onAtualizar,
}: {
  frescor: Frescor;
  carregando: boolean;
  onAtualizar: () => void;
}) {
  const desatualizado = frescor.desatualizado;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs",
        desatualizado
          ? "border-risco-alerta/40 bg-risco-alerta-suave text-risco-alerta"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      <span className="flex items-center gap-1.5">
        {desatualizado && <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
        {frescor.aviso ?? `Dado de fechamento de ${fmtDataEod(frescor.geradoEm)}.`}
      </span>
      <Button variant="outline" size="xs" onClick={onAtualizar} disabled={carregando}>
        <RefreshCw className={cn("size-3", carregando && "animate-spin")} aria-hidden />
        Forçar atualização
      </Button>
    </div>
  );
}

// ── Tabela da cadeia ──────────────────────────────────────────────────────────

function TabelaCadeia({
  linhas,
  gregasMap,
  selecionadas,
  onAlternar,
}: {
  linhas: { strike: number; op: OpcaoCadeia; liq: AvaliacaoLiquidez }[];
  gregasMap: Record<string, EstadoGregas>;
  selecionadas: Map<string, SerieSelecionada>;
  onAlternar: (op: OpcaoCadeia, liq: AvaliacaoLiquidez) => void;
}) {
  if (linhas.length === 0) return null;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead><TermoTecnico termo="strike">Strike</TermoTecnico></TableHead>
          <TableHead><TermoTecnico termo="premio">Prêmio</TermoTecnico> (bid/ask)</TableHead>
          <TableHead className="text-right">Volume</TableHead>
          <TableHead className="text-right"><TermoTecnico termo="spread">Spread</TermoTecnico></TableHead>
          <TableHead className="text-right"><TermoTecnico termo="open-interest">OI</TermoTecnico></TableHead>
          <TableHead><TermoTecnico termo="liquidez">Liquidez</TermoTecnico></TableHead>
          <TableHead className="text-right"><TermoTecnico termo="delta">Δ</TermoTecnico></TableHead>
          <TableHead className="text-right"><TermoTecnico termo="gama">Γ</TermoTecnico></TableHead>
          <TableHead className="text-right"><TermoTecnico termo="theta">Θ</TermoTecnico></TableHead>
          <TableHead className="text-right"><TermoTecnico termo="vega">Vega</TermoTecnico></TableHead>
          <TableHead className="text-right"><TermoTecnico termo="volatilidade-implicita">IV</TermoTecnico></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {linhas.map(({ strike, op, liq }) => {
          const ilíquida = liq.nivel === "baixa";
          const g = gregasMap[op.symbol];
          const gregas = g && g !== "carregando" && g !== "erro" ? g : null;
          const selecionada = selecionadas.has(op.symbol);
          return (
            <TableRow
              key={op.symbol}
              data-state={selecionada ? "selected" : undefined}
              className={cn(ilíquida && "border-l-2 border-l-risco-alerta")}
            >
              <TableCell>
                <input
                  type="checkbox"
                  checked={selecionada}
                  onChange={() => onAlternar(op, liq)}
                  className="size-4 accent-primary"
                  aria-label={`Selecionar ${op.symbol}`}
                />
              </TableCell>
              <TableCell className="font-medium tabular">{formatPreco(strike)}</TableCell>
              <TableCell className="tabular text-muted-foreground">
                {op.bid != null && op.bid > 0 ? formatPreco(op.bid) : "—"}
                {" / "}
                {op.ask != null && op.ask > 0 ? formatPreco(op.ask) : "—"}
              </TableCell>
              <TableCell className="text-right tabular">{op.volume ?? "—"}</TableCell>
              <TableCell className="text-right tabular">
                {op.spread != null ? formatPreco(op.spread) : "—"}
              </TableCell>
              <TableCell className="text-right">
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="cursor-help text-xs text-muted-foreground underline decoration-dotted" />}
                  >
                    n/d
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Open interest não é fornecido pelo COTAHIST/B3 (§6.4). A liquidez usa volume, número de negócios e spread.
                  </TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell>
                <BadgeLiquidez liq={liq} />
              </TableCell>
              <CelulaGrega estado={g} valor={gregas?.delta ?? null} formato="grega" />
              <CelulaGrega estado={g} valor={gregas?.gamma ?? null} formato="grega" />
              <CelulaGrega estado={g} valor={gregas?.theta ?? null} formato="grega" />
              <CelulaGrega estado={g} valor={gregas?.vega ?? null} formato="grega" />
              <CelulaGrega estado={g} valor={gregas?.iv ?? null} formato="iv" />
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Célula de grega: mostra "—" até carregar, spinner durante, valor depois. */
function CelulaGrega({
  estado,
  valor,
  formato,
}: {
  estado: EstadoGregas | undefined;
  valor: number | null;
  formato: "grega" | "iv";
}) {
  let conteudo: React.ReactNode;
  if (estado === "carregando") conteudo = <Loader2 className="ml-auto size-3 animate-spin" aria-hidden />;
  else if (estado === "erro") conteudo = <span className="text-risco-perigo">—</span>;
  else if (estado == null) conteudo = <span className="text-muted-foreground/50">—</span>;
  else conteudo = formato === "iv" ? fmtIV(valor) : fmtGrega(valor);
  return <TableCell className="text-right tabular">{conteudo}</TableCell>;
}

/** Selo de liquidez com tooltip explicando os motivos (§9). */
function BadgeLiquidez({ liq }: { liq: AvaliacaoLiquidez }) {
  const ok = liq.nivel === "ok";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              ok ? "bg-risco-ok-suave text-risco-ok" : "bg-risco-alerta-suave text-risco-alerta",
            )}
          />
        }
      >
        {ok ? "OK" : <><AlertTriangle className="size-3" aria-hidden /> Baixa</>}
      </TooltipTrigger>
      <TooltipContent className="flex max-w-xs flex-col items-start gap-1 text-left">
        {liq.motivos.map((m, i) => (
          <span key={i} className="text-xs leading-snug">{m}</span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
