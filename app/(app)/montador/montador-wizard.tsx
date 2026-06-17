"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Link2,
  Pencil,
  Table2,
  TicketCheck,
  TriangleAlert,
  X,
} from "lucide-react";

import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import { RotuloRisco } from "@/components/risco/rotulo-risco";
import { Semaforo, type NivelRisco } from "@/components/risco/semaforo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatBRL, formatPct, formatPreco } from "@/lib/format";
import {
  CATALOGO,
  GRUPOS,
  getEstrutura,
  type EstruturaDef,
  type EstruturaId,
} from "@/lib/montador/catalogo";
import { prefillDaCadeia } from "@/lib/montador/prefill";
import { salvarRascunho } from "@/lib/montador/rascunho";
import {
  lerSelecaoCadeia,
  limparSelecaoCadeia,
  type SelecaoCadeia,
} from "@/lib/montador/selecao-cadeia";
import type { ResultadoEstrutura } from "@/lib/options-math";
import { avaliarRisco, type AvaliacaoRisco, type Semaforo as SemaforoCor } from "@/lib/risk-rules";
import { cn } from "@/lib/utils";

import { GraficoPayoff } from "./grafico-payoff";

// Converte o semáforo das risk-rules (cor) no nível visual do componente <Semaforo>.
const NIVEL_POR_COR: Record<SemaforoCor, NivelRisco> = {
  verde: "ok",
  amarelo: "alerta",
  vermelho: "perigo",
};

// Aceita vírgula decimal (pt-BR) e devolve número (NaN se vazio/ inválido).
function paraNumero(texto: string | undefined): number {
  if (texto == null || texto.trim() === "") return NaN;
  return Number(texto.trim().replace(/\./g, "").replace(",", "."));
}

type Passo = 1 | 2 | 3;

/**
 * `<MontadorWizard>` — o coração da tela 6 (§8.4): um passo a passo guiado que
 * leva o iniciante de "qual estrutura?" até o resumo com risco, ganho, breakevens
 * e o gráfico de payoff. TODOS os números vêm do `lib/options-math` (via
 * `catalogo`) e as checagens de risco do `lib/risk-rules` — a tela só coleta e
 * apresenta, na ordem do §2 (risco antes do ganho).
 */
export function MontadorWizard() {
  const router = useRouter();

  const [passo, setPasso] = useState<Passo>(1);
  const [estruturaId, setEstruturaId] = useState<EstruturaId | null>(null);

  // Campos da estrutura (strikes/prêmios) e contexto da operação.
  const [valores, setValores] = useState<Record<string, string>>({});
  const [quantidade, setQuantidade] = useState("1");
  const [ativoObjeto, setAtivoObjeto] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [capitalTotal, setCapitalTotal] = useState("");
  const [margem, setMargem] = useState("");

  // Séries trazidas da cadeia (tela 5), lidas uma vez na montagem. Pré-preenchem
  // as pernas quando uma estrutura é escolhida (Prompt 12 / §8.3 item 3).
  const [selecao, setSelecao] = useState<SelecaoCadeia | null>(() => lerSelecaoCadeia());
  const [avisoPrefill, setAvisoPrefill] = useState<string | null>(null);

  const def: EstruturaDef | null = estruturaId ? getEstrutura(estruturaId) : null;

  // ── Montagem (números 100% do options-math) ─────────────────────────────────
  const numericos = useMemo(() => {
    const r: Record<string, number> = {};
    if (def) for (const campo of def.campos) r[campo.chave] = paraNumero(valores[campo.chave]);
    return r;
  }, [def, valores]);

  const camposCompletos = def
    ? def.campos.every((c) => !Number.isNaN(numericos[c.chave]))
    : false;
  const qtd = paraNumero(quantidade);
  const qtdValida = Number.isInteger(qtd) && qtd >= 1;

  // Resultado da estrutura: só monta quando os campos estão completos. Erros de
  // domínio (strikes não crescentes etc.) viram mensagem amigável, sem quebrar.
  const { resultado, erro } = useMemo<{
    resultado: ResultadoEstrutura | null;
    erro: string | null;
  }>(() => {
    if (!def || !camposCompletos || !qtdValida) return { resultado: null, erro: null };
    try {
      return { resultado: def.montar({ valores: numericos, quantidade: qtd }), erro: null };
    } catch (e) {
      return {
        resultado: null,
        erro: e instanceof Error ? e.message : "Não foi possível montar a estrutura.",
      };
    }
  }, [def, camposCompletos, qtdValida, numericos, qtd]);

  // Checagem de risco/capital (§10) — só faz sentido com estrutura + vencimento.
  const capitalNum = Math.max(0, paraNumero(capitalTotal) || 0);
  const margemNum = margem.trim() === "" ? undefined : paraNumero(margem);
  const avaliacoes: AvaliacaoRisco[] = useMemo(() => {
    if (!resultado || !vencimento) return [];
    return avaliarRisco(
      {
        estrutura: resultado,
        ativoObjeto: ativoObjeto.trim() || "—",
        vencimento: new Date(vencimento), // input date → meia-noite UTC (§ risk-rules)
        margemRequerida: margemNum,
      },
      capitalNum,
      [], // book vazio no MVP — a concentração entra com a persistência (Fase 1)
      {},
    );
  }, [resultado, vencimento, ativoObjeto, margemNum, capitalNum]);

  const contextoCompleto = ativoObjeto.trim() !== "" && vencimento !== "" && qtdValida;
  const podeAvancar = resultado != null && contextoCompleto;

  function escolher(id: EstruturaId) {
    setEstruturaId(id);
    setMargem("");
    setAvisoPrefill(null);

    // Se há séries trazidas da cadeia, pré-preenche as pernas (e ativo/vencimento).
    if (selecao && selecao.series.length > 0) {
      const pf = prefillDaCadeia(id, selecao.series);
      setValores(pf.valores);
      if (selecao.ativo) setAtivoObjeto(selecao.ativo);
      const venc = selecao.series[0]?.vencimento;
      if (venc) setVencimento(venc.slice(0, 10)); // ISO → yyyy-mm-dd p/ <input type=date>
      if (pf.aviso) setAvisoPrefill(pf.aviso);
    } else {
      setValores({}); // pernas dependem da estrutura escolhida
    }
    setPasso(2);
  }

  function descartarSelecao() {
    limparSelecaoCadeia();
    setSelecao(null);
    setAvisoPrefill(null);
  }

  function gerarTicket() {
    if (!def || !resultado || !vencimento) return;
    salvarRascunho({
      estruturaId: def.id,
      familia: def.familia,
      estrutura: resultado,
      ativoObjeto: ativoObjeto.trim(),
      vencimentoISO: new Date(vencimento).toISOString(),
      capitalTotal: capitalNum,
      margemRequerida: margemNum,
      avaliacoes,
    });
    router.push("/ticket");
  }

  return (
    <div className="flex flex-col gap-6">
      <Passos passo={passo} />

      {/* Séries trazidas da cadeia (tela 5): banner com o que veio + descartar. */}
      {selecao && selecao.series.length > 0 && (
        <BannerSelecao selecao={selecao} aviso={avisoPrefill} onDescartar={descartarSelecao} />
      )}

      {passo === 1 && <PassoEstrutura onEscolher={escolher} selecionado={estruturaId} />}

      {passo === 2 && def && (
        <PassoPernas
          def={def}
          valores={valores}
          setValores={setValores}
          quantidade={quantidade}
          setQuantidade={setQuantidade}
          ativoObjeto={ativoObjeto}
          setAtivoObjeto={setAtivoObjeto}
          vencimento={vencimento}
          setVencimento={setVencimento}
          capitalTotal={capitalTotal}
          setCapitalTotal={setCapitalTotal}
          margem={margem}
          setMargem={setMargem}
          erro={erro}
          qtdValida={qtdValida}
          quantidadePreenchida={quantidade.trim() !== ""}
          onVoltar={() => setPasso(1)}
          onAvancar={() => setPasso(3)}
          podeAvancar={podeAvancar}
        />
      )}

      {passo === 3 && def && resultado && (
        <PassoResumo
          def={def}
          resultado={resultado}
          avaliacoes={avaliacoes}
          ativoObjeto={ativoObjeto}
          capitalNum={capitalNum}
          onVoltar={() => setPasso(2)}
          onGerarTicket={gerarTicket}
        />
      )}
    </div>
  );
}

// ── Indicador de passos ────────────────────────────────────────────────────────

const ROTULOS_PASSO = ["Estrutura", "Pernas e contexto", "Resumo e payoff"] as const;

function Passos({ passo }: { passo: Passo }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      {ROTULOS_PASSO.map((rotulo, i) => {
        const n = (i + 1) as Passo;
        const ativo = n === passo;
        const concluido = n < passo;
        return (
          <li key={rotulo} className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                ativo && "bg-primary text-primary-foreground",
                concluido && "bg-risco-ok/15 text-risco-ok",
                !ativo && !concluido && "bg-muted text-muted-foreground",
              )}
            >
              {concluido ? <Check className="size-3.5" aria-hidden /> : n}
            </span>
            <span className={cn("font-medium", ativo ? "text-foreground" : "text-muted-foreground")}>
              {rotulo}
            </span>
            {i < ROTULOS_PASSO.length - 1 && (
              <span aria-hidden className="mx-1 h-px w-6 bg-border sm:w-8" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Banner das séries trazidas da cadeia (Prompt 12) ────────────────────────────

function BannerSelecao({
  selecao,
  aviso,
  onDescartar,
}: {
  selecao: SelecaoCadeia;
  aviso: string | null;
  onDescartar: () => void;
}) {
  return (
    <div className="rounded-xl border border-primary/30 bg-accent/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Link2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="text-sm font-medium text-foreground">
              {selecao.series.length} série(s) trazida(s) da cadeia
              {selecao.ativo ? ` · ${selecao.ativo}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Escolha a estrutura abaixo e os campos (strikes e prêmios) serão
              pré-preenchidos automaticamente.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="xs" onClick={onDescartar}>
          <X className="size-3.5" aria-hidden />
          Descartar
        </Button>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2">
        {selecao.series.map((s) => (
          <li
            key={s.symbol}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs"
          >
            <span className="font-medium">{s.symbol}</span>
            <span className="text-muted-foreground capitalize">{s.tipo}</span>
            <span className="tabular">{formatPreco(s.strike)}</span>
            {s.premioRef != null && (
              <span className="text-muted-foreground tabular">· {formatPreco(s.premioRef)}</span>
            )}
          </li>
        ))}
      </ul>

      {aviso && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-risco-alerta">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {aviso}
        </p>
      )}
    </div>
  );
}

// ── Passo 1: escolher a estrutura ───────────────────────────────────────────────

function PassoEstrutura({
  onEscolher,
  selecionado,
}: {
  onEscolher: (id: EstruturaId) => void;
  selecionado: EstruturaId | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Escolha o tipo de operação. Cada uma já vem marcada como{" "}
        <TermoTecnico termo="risco-definido">risco definido</TermoTecnico> ou{" "}
        <TermoTecnico termo="risco-indefinido">risco indefinido</TermoTecnico> — o
        risco vem sempre antes do ganho.
      </p>

      {GRUPOS.map((grupo) => (
        <section key={grupo.titulo} className="flex flex-col gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-tight">{grupo.titulo}</h2>
            <p className="text-sm text-muted-foreground">{grupo.descricao}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {grupo.ids.map((id) => {
              const e = CATALOGO[id];
              const indefinido = e.riscoEsperado === "INDEFINIDO";
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onEscolher(id)}
                  aria-pressed={selecionado === id}
                  className={cn(
                    "group flex flex-col gap-2 rounded-xl border bg-card p-4 text-left ring-1 ring-foreground/10 transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selecionado === id && "border-primary ring-primary",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-heading text-base font-semibold">{e.nome}</span>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                        indefinido
                          ? "bg-risco-perigo-suave text-risco-perigo"
                          : "bg-risco-ok-suave text-risco-ok",
                      )}
                    >
                      {indefinido ? (
                        <TriangleAlert className="size-3" aria-hidden />
                      ) : (
                        <Check className="size-3" aria-hidden />
                      )}
                      {indefinido ? "Indefinido" : "Definido"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{e.resumo}</p>
                  <p className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
                    Escolher esta
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Passo 2: pernas + contexto ──────────────────────────────────────────────────

function PassoPernas(props: {
  def: EstruturaDef;
  valores: Record<string, string>;
  setValores: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  quantidade: string;
  setQuantidade: (v: string) => void;
  ativoObjeto: string;
  setAtivoObjeto: (v: string) => void;
  vencimento: string;
  setVencimento: (v: string) => void;
  capitalTotal: string;
  setCapitalTotal: (v: string) => void;
  margem: string;
  setMargem: (v: string) => void;
  erro: string | null;
  qtdValida: boolean;
  quantidadePreenchida: boolean;
  onVoltar: () => void;
  onAvancar: () => void;
  podeAvancar: boolean;
}) {
  const { def } = props;
  const indefinido = def.riscoEsperado === "INDEFINIDO";

  const setCampo = (chave: string, valor: string) =>
    props.setValores((v) => ({ ...v, [chave]: valor }));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>{def.nome}</CardTitle>
            <CardDescription>{def.resumoPernas}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Origem das pernas: manual agora; da cadeia chega com o Prompt 13. */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span>Preencha os strikes e prêmios manualmente.</span>
              <Button variant="outline" size="sm" disabled>
                <Table2 className="size-3.5" aria-hidden />
                Trazer da cadeia (em breve)
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {def.campos.map((campo) => (
                <Campo
                  key={campo.chave}
                  id={`campo-${campo.chave}`}
                  rotulo={campo.rotulo}
                  ajuda={campo.ajuda}
                  prefixo={campo.tipo === "strike" || campo.tipo === "premio" ? "R$" : undefined}
                  valor={props.valores[campo.chave] ?? ""}
                  onChange={(v) => setCampo(campo.chave, v)}
                  placeholder="0,00"
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              <TermoTecnico termo="strike">Strikes</TermoTecnico> e{" "}
              <TermoTecnico termo="premio">prêmios</TermoTecnico> são por ação, em
              BRL — como cotados na B3. A quantidade é em contratos (lote de 100).
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Contexto da operação (alimenta as regras de risco do §10). */}
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Contexto da operação</CardTitle>
            <CardDescription>Necessário para as checagens de risco (§10).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Campo
              id="campo-ativo"
              rotulo="Ativo-objeto"
              inputMode="text"
              valor={props.ativoObjeto}
              onChange={(v) => props.setAtivoObjeto(v.toUpperCase())}
              placeholder="PETR4"
            />
            <Campo
              id="campo-qtd"
              rotulo="Quantidade (contratos)"
              valor={props.quantidade}
              onChange={props.setQuantidade}
              placeholder="1"
              erro={
                props.quantidadePreenchida && !props.qtdValida
                  ? "Informe um número inteiro de contratos (1 ou mais)."
                  : undefined
              }
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="campo-venc" className="text-sm font-medium">
                <TermoTecnico termo="vencimento">Vencimento</TermoTecnico>
              </label>
              <Input
                id="campo-venc"
                type="date"
                value={props.vencimento}
                onChange={(e) => props.setVencimento(e.target.value)}
              />
            </div>
            <Campo
              id="campo-capital"
              rotulo="Capital total"
              prefixo="R$"
              valor={props.capitalTotal}
              onChange={props.setCapitalTotal}
              placeholder="0,00"
              ajuda="Normalmente vem de Configurações (§10). Serve para mostrar o % do capital em risco."
            />
            {indefinido && (
              <Campo
                id="campo-margem"
                rotulo="Margem requerida pela corretora"
                prefixo="R$"
                valor={props.margem}
                onChange={props.setMargem}
                placeholder="0,00"
                ajuda="Risco indefinido exige margem — base da regra dos 10% do capital."
              />
            )}
          </CardContent>
        </Card>

        {/* Erro de montagem (ex.: strikes não crescentes) — claro, não bloqueia a tela. */}
        {props.erro && (
          <div className="flex items-start gap-2 rounded-lg border border-risco-perigo/40 bg-risco-perigo-suave px-3 py-2.5 text-sm text-risco-perigo">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{props.erro}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={props.onVoltar}>
            <ArrowLeft className="size-4" aria-hidden />
            Trocar estrutura
          </Button>
          <Button onClick={props.onAvancar} disabled={!props.podeAvancar}>
            Ver resultado
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
        {!props.podeAvancar && !props.erro && (
          <p className="text-right text-xs text-muted-foreground">
            Preencha as pernas, o ativo-objeto, a quantidade e o vencimento.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Passo 3: resumo (risco antes do ganho) + payoff + checagens ─────────────────

function PassoResumo({
  def,
  resultado,
  avaliacoes,
  ativoObjeto,
  capitalNum,
  onVoltar,
  onGerarTicket,
}: {
  def: EstruturaDef;
  resultado: ResultadoEstrutura;
  avaliacoes: AvaliacaoRisco[];
  ativoObjeto: string;
  capitalNum: number;
  onVoltar: () => void;
  onGerarTicket: () => void;
}) {
  const indefinido = resultado.rotulo_risco === "INDEFINIDO";
  const strikes = Array.from(new Set(resultado.legs.map((l) => l.strike))).sort((a, b) => a - b);
  const ganhoIlimitado = resultado.ganho_maximo === "ilimitado";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold tracking-tight">{def.nome}</h2>
          {ativoObjeto && (
            <p className="text-sm text-muted-foreground">Sobre {ativoObjeto}</p>
          )}
        </div>
        <Button variant="ghost" onClick={onVoltar}>
          <Pencil className="size-4" aria-hidden />
          Ajustar pernas
        </Button>
      </div>

      {/* (1) RISCO MÁXIMO + rótulo — primeiro e em destaque (§2). */}
      <Card className="border-2 border-risco-perigo/30">
        <CardContent className="flex flex-col gap-4 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Risco máximo (a perda que você aceita)
            </p>
            <p className="mt-1 font-heading text-3xl font-bold tracking-tight text-risco-perigo">
              {indefinido ? "INDEFINIDO" : formatBRL(resultado.risco_maximo)}
            </p>
            {!indefinido && capitalNum > 0 && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {formatPct(resultado.risco_maximo / capitalNum)} do seu capital
              </p>
            )}
            {indefinido && (
              <p className="mt-1 max-w-md text-sm text-risco-perigo/90">
                A perda pode superar — e muito — o prêmio recebido. Exige margem e
                atenção redobrada.
              </p>
            )}
          </div>
          <RotuloRisco tipo={indefinido ? "indefinido" : "definido"} />
        </CardContent>
      </Card>

      {/* (2) Ganho máximo e (3) breakevens. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-1">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Ganho máximo
            </p>
            <p className="mt-1 font-heading text-2xl font-bold tracking-tight text-risco-ok">
              {ganhoIlimitado ? "Ilimitado" : formatBRL(resultado.ganho_maximo as number)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-1">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <TermoTecnico termo="breakeven">Breakeven(s)</TermoTecnico>
            </p>
            <p className="mt-1 font-heading text-2xl font-bold tracking-tight">
              {resultado.breakevens.length > 0
                ? resultado.breakevens.map((b) => formatPreco(b)).join(" · ")
                : "—"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Preço do ativo no vencimento em que a operação empata.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* (4) Gráfico de payoff. */}
      <Card>
        <CardHeader>
          <CardTitle>
            Gráfico de <TermoTecnico termo="payoff">payoff</TermoTecnico>
          </CardTitle>
          <CardDescription>
            Ganho (verde) ou perda (vermelho) para cada preço do ativo no vencimento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GraficoPayoff
            curva={resultado.curva}
            breakevens={resultado.breakevens}
            strikes={strikes}
          />
        </CardContent>
      </Card>

      {/* (5) Explicação em linguagem de iniciante. */}
      <Card>
        <CardHeader>
          <CardTitle>Como ler esta operação</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm leading-relaxed">
          <div>
            <p className="font-medium text-foreground">Quando costuma fazer sentido</p>
            <p className="text-muted-foreground">{def.quandoFazSentido}</p>
          </div>
          <div>
            <p className="font-medium text-foreground">O que pode dar errado</p>
            <p className="text-muted-foreground">{def.oQuePodeDarErrado}</p>
          </div>
          {resultado.avisos.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {resultado.avisos.map((aviso, i) => (
                <li key={i} className="flex items-start gap-2 text-muted-foreground">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-risco-alerta" aria-hidden />
                  <span>{aviso}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Checagem automática de risco/capital (§8.5, §10) — alerta, não impede. */}
      <Card>
        <CardHeader>
          <CardTitle>Checagem de risco e capital (§10)</CardTitle>
          <CardDescription>
            Verde = dentro do limite · âmbar = atenção · vermelho = acima do limite.
            O Babilônia alerta, mas a decisão é sua.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border">
          {avaliacoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Informe o vencimento para rodar as checagens.
            </p>
          ) : (
            avaliacoes.map((a) => (
              <div key={a.regra} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <Semaforo
                  nivel={NIVEL_POR_COR[a.semaforo]}
                  mostrarRotulo={false}
                  size="lg"
                  className="mt-0.5"
                />
                <p className="text-sm leading-snug text-foreground/90">{a.texto}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Ação: gerar ticket (leva à tela 7 com a estrutura montada). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onVoltar}>
          <ArrowLeft className="size-4" aria-hidden />
          Voltar
        </Button>
        <Button size="lg" onClick={onGerarTicket}>
          <TicketCheck className="size-4" aria-hidden />
          Gerar ticket
        </Button>
      </div>
      <p className="text-right text-xs text-muted-foreground">
        O <TermoTecnico termo="ticket">ticket</TermoTecnico> é só um resumo para você
        digitar a ordem no home broker — o Babilônia nunca envia ordens.
      </p>
    </div>
  );
}

// ── Campo de formulário reutilizável ────────────────────────────────────────────

function Campo({
  id,
  rotulo,
  valor,
  onChange,
  placeholder,
  ajuda,
  prefixo,
  erro,
  inputMode = "decimal",
}: {
  id: string;
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ajuda?: string;
  prefixo?: string;
  erro?: string;
  inputMode?: "decimal" | "text" | "numeric";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {rotulo}
      </label>
      <div className="relative">
        {prefixo && (
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground">
            {prefixo}
          </span>
        )}
        <Input
          id={id}
          inputMode={inputMode}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={erro ? true : undefined}
          className={cn(prefixo && "pl-9", "tabular")}
        />
      </div>
      {erro ? (
        <p className="text-xs text-risco-perigo">{erro}</p>
      ) : ajuda ? (
        <p className="text-xs text-muted-foreground">{ajuda}</p>
      ) : null}
    </div>
  );
}
