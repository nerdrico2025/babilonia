"use client";

import { useState } from "react";
import {
  CalendarClock,
  History,
  Loader2,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";

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
import type {
  PernaBacktestParam,
  RespostaBacktest,
} from "@/lib/integrations/quant-service";
import { formatBRL } from "@/lib/format";

import { GraficoBacktest } from "./grafico-backtest";

/** Erro tratado para a UI: categoria (estilo) + mensagem + o que faltou (422). */
interface ErroBacktest {
  categoria: "indisponivel" | "dados" | "inesperado";
  mensagem: string;
  faltam?: string[];
}

/**
 * `<BacktestHistorico>` — a seção de SIMULAÇÃO HISTÓRICA dentro do montador (§15).
 *
 * Recebe as pernas JÁ resolvidas para tickers exatos (vindas da cadeia) e deixa o
 * usuário só escolher a data de entrada — nada é redigitado. Chama `/api/backtest`
 * (proxy do microserviço) e desenha o resultado na ordem do §2: disclaimer de
 * simulação, RISCO MÁXIMO antes do P&L, gráfico da série e avisos. Nenhum número é
 * recalculado aqui — tudo vem do serviço.
 *
 * Indisponibilidade (§6.3) e dado insuficiente (§2.4) viram mensagem clara, sem
 * quebrar a tela.
 */
export function BacktestHistorico({
  pernas,
  ativo,
}: {
  pernas: PernaBacktestParam[];
  ativo: string;
}) {
  const [dataEntrada, setDataEntrada] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<ErroBacktest | null>(null);
  const [resultado, setResultado] = useState<RespostaBacktest | null>(null);

  const podeRodar = dataEntrada !== "" && !carregando;

  async function rodar() {
    if (!podeRodar) return;
    setCarregando(true);
    setErro(null);
    setResultado(null);
    try {
      const resp = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pernas, dataEntrada }),
      });
      const corpo: unknown = await resp.json().catch(() => null);
      if (!resp.ok) {
        setErro(traduzErro(resp.status, corpo));
        return;
      }
      setResultado(corpo as RespostaBacktest);
    } catch {
      // Falha de rede no próprio Next (não chegou nem na rota) — trata como indisponível.
      setErro({
        categoria: "indisponivel",
        mensagem:
          "Não foi possível falar com a simulação agora. Verifique a conexão e tente de novo.",
      });
    } finally {
      setCarregando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-primary" aria-hidden />
          Testar historicamente
        </CardTitle>
        <CardDescription>
          Veja como esta estrutura teria evoluído se fosse montada numa data passada,
          com os preços de fechamento reais até o vencimento.{" "}
          <TermoTecnico termo="simulacao-historica">Simulação histórica</TermoTecnico>{" "}
          é análise, não recomendação.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* Controles: data de entrada + rodar. */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="backtest-entrada" className="text-sm font-medium">
              Data de entrada
            </label>
            <div className="relative">
              <CalendarClock
                className="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="backtest-entrada"
                type="date"
                value={dataEntrada}
                onChange={(e) => setDataEntrada(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <Button onClick={rodar} disabled={!podeRodar}>
            {carregando ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <History className="size-4" aria-hidden />
            )}
            {carregando ? "Simulando…" : "Rodar simulação"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A operação é levada até o vencimento ({pernas.length} perna(s) ·{" "}
          {ativo || "—"}). Escolha um pregão em que as séries tinham negócio.
        </p>

        {/* Estados: carregando, erro, resultado. */}
        {carregando && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Rodando a simulação… o serviço pode estar iniciando (pode levar alguns
            segundos).
          </p>
        )}

        {erro && <AvisoErro erro={erro} />}

        {resultado && <ResultadoBacktest resultado={resultado} />}
      </CardContent>
    </Card>
  );
}

// ── Resultado ────────────────────────────────────────────────────────────────

function ResultadoBacktest({ resultado }: { resultado: RespostaBacktest }) {
  const { resumo, serie } = resultado;
  const indefinido = resumo.rotulo_risco === "INDEFINIDO";
  const riscoFinito = Number.isFinite(resumo.risco_maximo);
  const ganhoFinal = resumo.pl_final >= 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Disclaimer reforçado de SIMULAÇÃO HISTÓRICA (§2) — destacado, não texto corrido. */}
      <div
        role="note"
        className="flex items-start gap-2.5 rounded-lg border border-dourado/40 bg-dourado/10 px-3.5 py-3 text-sm leading-snug text-foreground/85"
      >
        <History className="mt-0.5 size-4 shrink-0 text-dourado" aria-hidden />
        <p>
          <strong className="font-semibold text-foreground">
            Simulação histórica com dados passados.
          </strong>{" "}
          Desempenho passado NÃO garante resultado futuro. Os números vêm da{" "}
          <TermoTecnico termo="mark-to-market">marcação a mercado</TermoTecnico> dos
          fechamentos reais — é análise, não recomendação. A decisão é sua.
        </p>
      </div>

      {/* Aviso de evento corporativo (§ ajuste por provento), se houve. */}
      {resumo.ajustes_provento.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-risco-alerta/40 bg-risco-alerta/10 px-3.5 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-risco-alerta">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            <TermoTecnico termo="ajuste-provento">Ajuste por provento</TermoTecnico> na
            janela
          </p>
          {resumo.ajustes_provento.map((a) => (
            <div key={a.data_ex} className="text-sm text-foreground/85">
              <p>
                <span className="font-medium">{formatarData(a.data_ex)}</span> — strike
                reduzido em{" "}
                <span className="font-medium tabular">
                  {formatBRL(a.valor_ajuste_por_acao)}
                </span>{" "}
                por ação ({a.pernas_afetadas.join(", ")}).
              </p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                {a.explicacao}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* (1) RISCO MÁXIMO + rótulo — ANTES do P&L (§2/§10). */}
      <Card className="border-2 border-risco-perigo/30">
        <CardContent className="flex flex-col gap-4 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Risco máximo (a perda que você aceita)
            </p>
            <p className="mt-1 font-heading text-3xl font-bold tracking-tight text-risco-perigo">
              {indefinido || !riscoFinito
                ? "INDEFINIDO"
                : formatBRL(resumo.risco_maximo)}
            </p>
            {(indefinido || !riscoFinito) && (
              <p className="mt-1 max-w-md text-sm text-risco-perigo/90">
                A perda pode superar — e muito — o prêmio recebido.
              </p>
            )}
          </div>
          <RotuloRisco tipo={indefinido ? "indefinido" : "definido"} />
        </CardContent>
      </Card>

      {/* (2) P&L final + dias até o vencimento. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-1">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Resultado no vencimento (P&amp;L final)
            </p>
            <p
              className={cnValor(ganhoFinal)}
            >
              {ganhoFinal ? "+" : "−"}
              {formatBRL(Math.abs(resumo.pl_final))}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {resumo.liquidado_no_vencimento
                ? "Levada até o vencimento (payoff da estrutura)."
                : "Encerrada na última marcação a mercado."}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-1">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Dias até o vencimento
            </p>
            <p className="mt-1 font-heading text-2xl font-bold tracking-tight">
              {resumo.dias_ate_vencimento}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              De {formatarData(resultado.data_entrada)} a{" "}
              {formatarData(resultado.vencimento)}.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* (3) Gráfico da série temporal (P&L acumulado dia a dia). */}
      <Card>
        <CardHeader>
          <CardTitle>Evolução dia a dia</CardTitle>
          <CardDescription>
            Lucro/prejuízo acumulado a cada fechamento, da entrada ao vencimento. Dias
            com <TermoTecnico termo="ajuste-provento">ajuste de provento</TermoTecnico>{" "}
            aparecem marcados em âmbar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GraficoBacktest serie={serie} />
        </CardContent>
      </Card>

      {/* (4) Avisos do backend (dias sem negócio, sem spot no vencimento etc.). */}
      {resumo.avisos.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {resumo.avisos.map((aviso, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0 text-risco-alerta"
                aria-hidden
              />
              <span>{aviso}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Erro ─────────────────────────────────────────────────────────────────────

function AvisoErro({ erro }: { erro: ErroBacktest }) {
  const indisponivel = erro.categoria === "indisponivel";
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-risco-alerta/40 bg-risco-alerta/10 px-3.5 py-3 text-sm text-foreground/85"
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-risco-alerta" aria-hidden />
      <div>
        <p className="font-medium text-foreground">
          {indisponivel
            ? "Simulação indisponível no momento"
            : erro.categoria === "dados"
              ? "Não dá para simular com esses dados"
              : "Não foi possível simular"}
        </p>
        <p className="mt-0.5">{erro.mensagem}</p>
        {erro.faltam && erro.faltam.length > 0 && (
          <ul className="mt-1.5 list-inside list-disc text-xs text-muted-foreground">
            {erro.faltam.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Classe do valor de P&L: cor por sinal + tamanho de destaque. */
function cnValor(ganho: boolean): string {
  return [
    "mt-1 font-heading text-2xl font-bold tracking-tight",
    ganho ? "text-risco-ok" : "text-risco-perigo",
  ].join(" ");
}

/** Mapeia o status/corpo da rota para um erro tratado pela UI. */
function traduzErro(status: number, corpo: unknown): ErroBacktest {
  const c = (corpo ?? {}) as { mensagem?: string; faltam?: string[] };
  if (status === 503) {
    return {
      categoria: "indisponivel",
      mensagem:
        c.mensagem ??
        "A simulação está indisponível. O serviço pode estar iniciando — tente de novo em alguns segundos.",
    };
  }
  if (status === 422 || status === 400) {
    return {
      categoria: "dados",
      mensagem:
        c.mensagem ??
        "Escolha uma data de entrada em que todas as séries tinham negócio.",
      faltam: c.faltam,
    };
  }
  return {
    categoria: "inesperado",
    mensagem:
      c.mensagem ?? "Ocorreu um erro inesperado ao rodar a simulação. Tente de novo.",
  };
}

/** ISO datetime → "DD/MM/AAAA" (UTC, casa com o trade_date EOD). */
function formatarData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}
