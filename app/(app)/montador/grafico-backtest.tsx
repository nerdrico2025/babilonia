"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PontoSerieBacktest } from "@/lib/integrations/quant-service";
import { formatBRL } from "@/lib/format";

/**
 * `<GraficoBacktest>` — a série temporal da SIMULAÇÃO HISTÓRICA (§15) com Recharts.
 *
 * Desenha o P&L acumulado (marcação a mercado) dia a dia, do pregão de entrada até
 * a liquidação no vencimento. Todos os números vêm do microserviço (nada é
 * recalculado aqui). Os dias de EVENTO CORPORATIVO (`evento === "ajuste_provento"`)
 * ganham uma linha vertical âmbar + um ponto destacado, para o "salto" não parecer
 * oscilação normal de mercado — o tooltip explica que é ajuste de provento.
 */
export function GraficoBacktest({ serie }: { serie: PontoSerieBacktest[] }) {
  // Dias com evento corporativo (data-ex): viram linha vertical de referência.
  const diasEvento = serie.filter((p) => p.evento === "ajuste_provento");

  const valores = serie.map((p) => p.pl_acumulado);
  const max = Math.max(0, ...valores);
  const min = Math.min(0, ...valores);

  // Eixo Y compacto (ex.: "R$ 1,2 mil") para não poluir.
  const tickValor = (valor: number): string => {
    const abs = Math.abs(valor);
    if (abs >= 1000) {
      return `${valor < 0 ? "-" : ""}R$ ${(abs / 1000).toLocaleString("pt-BR", {
        maximumFractionDigits: 1,
      })} mil`;
    }
    return formatBRL(valor);
  };

  return (
    <div className="h-72 w-full sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={serie} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />

          <XAxis
            dataKey="data"
            tickFormatter={formatarDiaMes}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            stroke="var(--color-border)"
            tickMargin={8}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={tickValor}
            domain={[Math.floor(min), Math.ceil(max)]}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            stroke="var(--color-border)"
            width={72}
          />

          <Tooltip
            cursor={{ stroke: "var(--color-muted-foreground)", strokeDasharray: "3 3" }}
            content={<ConteudoTooltip />}
          />

          {/* Linha do zero: nem ganha nem perde (entrada). */}
          <ReferenceLine y={0} stroke="var(--color-foreground)" strokeOpacity={0.5} />

          {/* Dias de evento corporativo (data-ex): linha vertical âmbar de aviso. */}
          {diasEvento.map((p) => (
            <ReferenceLine
              key={`ev-${p.data}`}
              x={p.data}
              stroke="var(--color-risco-alerta)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              label={{
                value: "ajuste",
                position: "insideTopRight",
                fontSize: 10,
                fill: "var(--color-risco-alerta)",
              }}
            />
          ))}

          <Line
            type="monotone"
            dataKey="pl_acumulado"
            stroke="var(--color-primary)"
            strokeWidth={2}
            isAnimationActive={false}
            dot={<PontoSerie />}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Ponto da linha: invisível em pregão comum (a linha já basta), mas destacado nos
 * dias de EVENTO CORPORATIVO (âmbar) para chamar o olho ao ajuste de provento.
 */
function PontoSerie(props: {
  cx?: number;
  cy?: number;
  payload?: PontoSerieBacktest;
}) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || payload?.evento !== "ajuste_provento") return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="var(--color-risco-alerta)"
      stroke="var(--color-background)"
      strokeWidth={1.5}
    />
  );
}

/** ISO datetime → "DD/MM" (eixo X compacto). */
function formatarDiaMes(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}

/** Tooltip: data + P&L acumulado naquele fechamento + aviso de evento corporativo. */
function ConteudoTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: PontoSerieBacktest }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const ponto = payload[0]!.payload;
  const ganho = ponto.pl_acumulado >= 0;
  const dataLonga = new Date(ponto.data).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground">
        Fechamento de <span className="font-medium text-foreground">{dataLonga}</span>
        {ponto.fonte === "vencimento" && " (vencimento)"}
      </p>
      <p className="mt-0.5 font-heading text-sm font-semibold">
        <span className={ganho ? "text-risco-ok" : "text-risco-perigo"}>
          {ganho ? "Ganho" : "Perda"} de {formatBRL(Math.abs(ponto.pl_acumulado))}
        </span>
      </p>
      {ponto.evento === "ajuste_provento" && (
        <p className="mt-1 max-w-[15rem] leading-snug text-risco-alerta">
          Ajuste por provento (evento corporativo) — não é movimento normal de mercado.
        </p>
      )}
      {ponto.sem_negociacao && ponto.evento !== "ajuste_provento" && (
        <p className="mt-1 max-w-[15rem] leading-snug text-muted-foreground">
          Sem negócio neste pregão: mantido o último preço conhecido.
        </p>
      )}
    </div>
  );
}
