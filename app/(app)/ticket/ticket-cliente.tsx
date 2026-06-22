"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleAlert,
  ClipboardCopy,
  Loader2,
  Repeat,
  Save,
} from "lucide-react";

import { DisclaimerNota } from "@/components/disclaimer";
import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import { RotuloRisco } from "@/components/risco/rotulo-risco";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { lerRascunho, limparRascunho, type RascunhoOperacao } from "@/lib/montador/rascunho";
import {
  gerarTicket,
  validarTicket,
  type EntradaTicket,
  type PernaTicket,
  type TipoOrdem,
  type Validade,
} from "@/lib/ticket";
import { cn } from "@/lib/utils";

import { persistirTicket, type TicketPayload } from "./actions";
import { rolarPosition } from "../historico/actions";

// Aceita vírgula decimal (pt-BR); devolve número ou null.
function paraNumero(texto: string): number | null {
  const t = texto.trim();
  if (t === "") return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Estado de execução de cada perna que o usuário preenche (ticker, ordem, preço).
interface PernaForm {
  tickerOpcao: string;
  tipoOrdem: TipoOrdem;
  precoLimite: string;
  validade: Validade;
}

/**
 * `<TicketCliente>` — a tela 7 (§8.6, §11). Lê o rascunho deixado pelo montador,
 * deixa o usuário completar os dados de execução (ticker exato, liquidez, eventos)
 * e mostra o TICKET no formato EXATO do §11 (risco antes do ganho, §2). Só libera
 * "copiar" e "confirmar" quando não há pendências. Ao confirmar, persiste a
 * operação no book (§7) via Server Action.
 */
export function TicketCliente() {
  // Rascunho vindo do montador (sessionStorage), lido uma vez.
  const [rascunho] = useState<RascunhoOperacao | null>(() => lerRascunho());

  // Dados de execução por perna (inicializados a partir das pernas da estrutura).
  const [pernasForm, setPernasForm] = useState<PernaForm[]>(() =>
    (rascunho?.estrutura.legs ?? []).map((leg, i) => ({
      // Ticker pré-preenchido quando vem do dashboard (revisar); vazio do montador.
      tickerOpcao: rascunho?.simbolos?.[i] ?? "",
      tipoOrdem: "limitada" as TipoOrdem,
      precoLimite: String(leg.premio).replace(".", ","),
      validade: "dia" as Validade,
    })),
  );

  // Validações obrigatórias (§8.6): liquidez e eventos.
  const [liquidezStatus, setLiquidezStatus] = useState<"" | "ok" | "baixa">("");
  const [liquidezObs, setLiquidezObs] = useState("");
  const [eventosVerificado, setEventosVerificado] = useState(false);
  const [resultados, setResultados] = useState("");
  const [proventos, setProventos] = useState("");

  // Opcionais (§11).
  const [stop, setStop] = useState("");
  const [alvo, setAlvo] = useState("");

  // Rolagem: quando o rascunho veio do histórico marcado, esta operação SUBSTITUI
  // a position de origem (chama rolarPosition em vez de persistirTicket).
  const rolagemDe = rascunho?.rolagemDePositionId ?? null;

  const [copiado, setCopiado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState<{ positionId: number; rolouDe: number | null } | null>(null);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  function atualizarPerna(i: number, campo: Partial<PernaForm>) {
    setPernasForm((arr) => arr.map((p, idx) => (idx === i ? { ...p, ...campo } : p)));
    setCopiado(false);
  }

  // Monta a EntradaTicket a partir do rascunho + formulário (memoizada).
  const entrada = useMemo<EntradaTicket | null>(() => {
    if (!rascunho) return null;

    const pernas: PernaTicket[] = rascunho.estrutura.legs.map((leg, i) => {
      const f = pernasForm[i]!;
      const preco = paraNumero(f.precoLimite);
      return {
        leg,
        tickerOpcao: f.tickerOpcao.trim(),
        aberturaEncerramento: "abertura", // montando nova operação
        tipoOrdem: f.tipoOrdem,
        // A mercado não leva preço; nas demais, o preço-limite informado.
        precoLimite: f.tipoOrdem === "mercado" ? undefined : (preco ?? undefined),
        validade: f.validade,
      };
    });

    const eventos = eventosVerificado
      ? {
          ...(resultados ? { resultados: new Date(resultados) } : {}),
          ...(proventos ? { proventos: new Date(proventos) } : {}),
        }
      : undefined;

    const stopN = paraNumero(stop);
    const alvoN = paraNumero(alvo);

    return {
      estrutura: rascunho.estrutura,
      avaliacoes: rascunho.avaliacoes,
      ativoObjeto: rascunho.ativoObjeto,
      capitalTotal: rascunho.capitalTotal,
      pernas,
      vencimento: new Date(rascunho.vencimentoISO),
      liquidez: liquidezStatus
        ? { status: liquidezStatus, observacao: liquidezObs.trim() || undefined }
        : undefined,
      eventos,
      ...(stopN != null ? { stop: stopN } : {}),
      ...(alvoN != null ? { alvo: alvoN } : {}),
    };
  }, [
    rascunho,
    pernasForm,
    liquidezStatus,
    liquidezObs,
    eventosVerificado,
    resultados,
    proventos,
    stop,
    alvo,
  ]);

  const pendencias = useMemo(() => (entrada ? validarTicket(entrada) : []), [entrada]);
  const texto = useMemo(() => (entrada ? gerarTicket(entrada) : ""), [entrada]);
  const pronto = entrada != null && pendencias.length === 0;

  // Sem rascunho: nada a fazer aqui — manda montar uma operação.
  if (!rascunho || !entrada) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 pt-1">
          <p className="text-sm text-muted-foreground">
            Nenhuma operação montada ainda. Monte uma estrutura no montador para
            gerar o <TermoTecnico termo="ticket">ticket</TermoTecnico>.
          </p>
          <Button render={<Link href="/montador" />}>
            <ArrowLeft className="size-4" aria-hidden />
            Ir para o montador
          </Button>
        </CardContent>
      </Card>
    );
  }

  const indefinido = rascunho.estrutura.rotulo_risco === "INDEFINIDO";

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setCopiado(false);
    }
  }

  async function confirmar() {
    if (!pronto || !entrada) return;
    setSalvando(true);
    setErroSalvar(null);

    // Risco sempre FINITO no banco: definido → risco da estrutura; indefinido →
    // margem requerida (não há perda máxima finita). `riskDefined` guarda a verdade.
    const maxRisk = indefinido
      ? (rascunho!.margemRequerida ?? 0)
      : rascunho!.estrutura.risco_maximo;
    const maxGain =
      rascunho!.estrutura.ganho_maximo === "ilimitado"
        ? null
        : (rascunho!.estrutura.ganho_maximo as number);

    const payload: TicketPayload = {
      underlying: rascunho!.ativoObjeto,
      structure: rascunho!.familia,
      expiresAtISO: rascunho!.vencimentoISO,
      maxRisk,
      maxGain,
      riskDefined: !indefinido,
      breakevens: rascunho!.estrutura.breakevens,
      pernas: entrada.pernas.map((p) => ({
        optionSymbol: p.tickerOpcao,
        kind: p.leg.tipo,
        side: p.leg.lado,
        strike: p.leg.strike,
        quantity: p.leg.quantidade,
        premium: p.leg.premio,
      })),
      content: texto,
      data: {
        estruturaId: rascunho!.estruturaId ?? null,
        ativoObjeto: rascunho!.ativoObjeto,
        rotuloRisco: rascunho!.estrutura.rotulo_risco,
        capitalTotal: rascunho!.capitalTotal,
      },
    };

    // Rolagem → rolarPosition (cria a nova + marca a antiga "rolada", atômico);
    // operação nova → persistirTicket. Mesmo payload nos dois caminhos.
    if (rolagemDe != null) {
      const r = await rolarPosition(rolagemDe, payload);
      setSalvando(false);
      if (r.ok) {
        setSalvo({ positionId: r.novaPositionId, rolouDe: rolagemDe });
        limparRascunho();
      } else {
        setErroSalvar(r.erro.mensagem);
      }
      return;
    }

    const r = await persistirTicket(payload);
    setSalvando(false);
    if (r.ok) {
      setSalvo({ positionId: r.positionId, rolouDe: null });
      limparRascunho(); // consumido: evita salvar duas vezes a mesma operação
    } else {
      setErroSalvar(r.erro);
    }
  }

  // Estado de sucesso: operação salva no book.
  if (salvo) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 pt-1">
          <div className="inline-flex items-center gap-2 rounded-full bg-risco-ok-suave px-3 py-1 text-sm font-medium text-risco-ok">
            <Check className="size-4" aria-hidden />
            {salvo.rolouDe != null ? "Rolagem registrada no book" : "Operação registrada no book"}
          </div>
          <p className="text-sm text-muted-foreground">
            {salvo.rolouDe != null ? (
              <>
                A posição #{salvo.rolouDe} foi marcada como{" "}
                <strong className="text-foreground">rolada</strong> e a nova entrou no seu book.
              </>
            ) : (
              "O ticket foi salvo e a posição entrou no seu book."
            )}{" "}
            Lembre-se: a ordem ainda precisa ser{" "}
            <strong className="text-foreground">digitada por você</strong> no home broker — o
            Babilônia não envia ordens.
          </p>
          <div className="flex gap-2">
            <Button render={<Link href="/" />}>Ver o book</Button>
            <Button variant="outline" render={<Link href="/montador" />}>
              Montar outra
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <DisclaimerNota />

      {/* Aviso de ROLAGEM: deixa claro que esta operação substitui a antiga. */}
      {rolagemDe != null && (
        <div className="flex items-start gap-2 rounded-lg border border-risco-alerta/40 bg-risco-alerta-suave px-3.5 py-3 text-sm text-risco-alerta">
          <Repeat className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Esta é uma <strong>rolagem da posição #{rolagemDe}</strong>. Ao confirmar, a posição
            #{rolagemDe} será marcada como <strong>rolada</strong> e esta nova operação entra no book
            no lugar dela — não é uma operação nova do zero.
          </span>
        </div>
      )}

      {/* Cabeçalho com a estrutura e o rótulo de risco em destaque (§2). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            {rascunho.estrutura.nome}
          </h2>
          <p className="text-sm text-muted-foreground">Sobre {rascunho.ativoObjeto}</p>
        </div>
        <RotuloRisco tipo={indefinido ? "indefinido" : "definido"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Coluna de preenchimento. */}
        <div className="flex flex-col gap-5">
          {/* Pernas: ticker exato + ordem. */}
          <Card>
            <CardHeader>
              <CardTitle>Dados de execução das pernas</CardTitle>
              <CardDescription>
                Informe o <TermoTecnico termo="ticker">ticker</TermoTecnico> exato de cada
                opção, como aparece no home broker.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {rascunho.estrutura.legs.map((leg, i) => {
                const f = pernasForm[i]!;
                return (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <p className="mb-2 text-sm font-medium capitalize">
                      {leg.lado} de {leg.tipo} · strike {formatBRLleve(leg.strike)} ·{" "}
                      {leg.quantidade} contrato(s)
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <CampoTexto
                        id={`ticker-${i}`}
                        rotulo="Ticker exato da opção"
                        valor={f.tickerOpcao}
                        onChange={(v) => atualizarPerna(i, { tickerOpcao: v.toUpperCase() })}
                        placeholder="PETRK221"
                      />
                      <CampoSelect
                        id={`ordem-${i}`}
                        rotulo="Tipo de ordem"
                        valor={f.tipoOrdem}
                        onChange={(v) => atualizarPerna(i, { tipoOrdem: v as TipoOrdem })}
                        opcoes={[
                          { valor: "limitada", rotulo: "Limitada" },
                          { valor: "mercado", rotulo: "A mercado" },
                          { valor: "stop", rotulo: "Stop" },
                        ]}
                      />
                      {f.tipoOrdem !== "mercado" && (
                        <CampoTexto
                          id={`preco-${i}`}
                          rotulo="Preço-limite (R$)"
                          valor={f.precoLimite}
                          onChange={(v) => atualizarPerna(i, { precoLimite: v })}
                          placeholder="0,00"
                          inputMode="decimal"
                        />
                      )}
                      <CampoSelect
                        id={`validade-${i}`}
                        rotulo="Validade"
                        valor={f.validade}
                        onChange={(v) => atualizarPerna(i, { validade: v as Validade })}
                        opcoes={[
                          { valor: "dia", rotulo: "Dia" },
                          { valor: "ate_cancelar", rotulo: "Até cancelar" },
                        ]}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Validações obrigatórias: liquidez + eventos (§8.6). */}
          <Card>
            <CardHeader>
              <CardTitle>Conferências antes de operar (§8.6)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <CampoSelect
                id="liquidez"
                rotulo="Liquidez da série"
                valor={liquidezStatus}
                onChange={(v) => {
                  setLiquidezStatus(v as "" | "ok" | "baixa");
                  setCopiado(false);
                }}
                opcoes={[
                  { valor: "", rotulo: "Selecione…" },
                  { valor: "ok", rotulo: "OK — volume e spread aceitáveis" },
                  { valor: "baixa", rotulo: "Baixa — atenção" },
                ]}
              />
              {liquidezStatus === "baixa" && (
                <CampoTexto
                  id="liquidez-obs"
                  rotulo="Observação da liquidez"
                  valor={liquidezObs}
                  onChange={setLiquidezObs}
                  placeholder="ex.: spread largo, sem market maker"
                />
              )}

              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={eventosVerificado}
                  onChange={(e) => {
                    setEventosVerificado(e.target.checked);
                    setCopiado(false);
                  }}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  Verifiquei os eventos próximos (resultados/proventos) do ativo.
                </span>
              </label>
              {eventosVerificado && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <CampoData
                    id="resultados"
                    rotulo="Próximo resultado (opcional)"
                    valor={resultados}
                    onChange={setResultados}
                  />
                  <CampoData
                    id="proventos"
                    rotulo="Próximo provento (opcional)"
                    valor={proventos}
                    onChange={setProventos}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Opcionais. */}
          <Card>
            <CardHeader>
              <CardTitle>Stop e alvo (opcionais)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <CampoTexto id="stop" rotulo="Stop de perda (R$)" valor={stop} onChange={setStop} placeholder="—" inputMode="decimal" />
              <CampoTexto id="alvo" rotulo="Alvo (R$)" valor={alvo} onChange={setAlvo} placeholder="—" inputMode="decimal" />
            </CardContent>
          </Card>
        </div>

        {/* Coluna do preview + ações. */}
        <div className="flex flex-col gap-4">
          {/* Pendências bloqueiam a cópia/confirmação. */}
          {pendencias.length > 0 ? (
            <div className="rounded-lg border border-risco-alerta/40 bg-risco-alerta-suave px-3.5 py-3 text-sm text-risco-alerta">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                Falta preencher antes de copiar:
              </p>
              <ul className="mt-1.5 ml-6 list-disc space-y-1">
                {pendencias.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="inline-flex w-fit items-center gap-1.5 rounded-full bg-risco-ok-suave px-3 py-1 text-sm font-medium text-risco-ok">
              <Check className="size-4" aria-hidden />
              Ticket completo — pronto para copiar
            </div>
          )}

          {/* Preview no formato exato do §11. */}
          <pre className="overflow-x-auto rounded-xl bg-card p-4 font-mono text-xs leading-relaxed text-card-foreground ring-1 ring-foreground/10">
            {texto}
          </pre>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={copiar} disabled={!pronto} variant="outline">
              {copiado ? <Check className="size-4" aria-hidden /> : <ClipboardCopy className="size-4" aria-hidden />}
              {copiado ? "Copiado!" : "Copiar ticket"}
            </Button>
            <Button onClick={confirmar} disabled={!pronto || salvando}>
              {salvando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
              Confirmar e salvar no book
            </Button>
          </div>

          {erroSalvar && (
            <div className="flex items-start gap-2 rounded-lg border border-risco-perigo/40 bg-risco-perigo-suave px-3.5 py-3 text-sm text-risco-perigo">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{erroSalvar}</span>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Confirmar apenas <strong>registra</strong> a operação no seu book — o
            Babilônia nunca envia ordens. A execução é manual, no home broker.
          </p>
        </div>
      </div>
    </div>
  );
}

// Formata um preço de forma leve (sem depender do formatador do ticket).
function formatBRLleve(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ── Campos de formulário ────────────────────────────────────────────────────────

function CampoTexto({
  id,
  rotulo,
  valor,
  onChange,
  placeholder,
  inputMode = "text",
}: {
  id: string;
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "text" | "decimal";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{rotulo}</label>
      <Input
        id={id}
        value={valor}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function CampoData({
  id,
  rotulo,
  valor,
  onChange,
}: {
  id: string;
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{rotulo}</label>
      <Input id={id} type="date" value={valor} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function CampoSelect({
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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{rotulo}</label>
      <select
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
        )}
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
