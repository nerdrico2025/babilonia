"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PontoPayoff } from "@/lib/options-math";
import { formatBRL, formatPreco } from "@/lib/format";

/**
 * `<GraficoPayoff>` — o gráfico de PAYOFF (§8.4 item 4) com Recharts.
 *
 * Mostra, para cada preço do ativo no vencimento, quanto a operação ganha ou
 * perde. Tudo vem da `curva` calculada pelo `options-math` — o gráfico só
 * desenha (nenhum número é inventado aqui):
 *  - área VERDE acima do zero (ganho) e VERMELHA abaixo (perda) — o "risco antes
 *    do ganho" do §2 também fala pela cor;
 *  - linha do zero (onde não ganha nem perde);
 *  - linhas tracejadas douradas nos `breakevens` (pontos de equilíbrio);
 *  - marcas suaves nos `strikes` da estrutura.
 */
export function GraficoPayoff({
  curva,
  breakevens,
  strikes,
}: {
  curva: PontoPayoff[];
  breakevens: number[];
  strikes: number[];
}) {
  const resultados = curva.map((p) => p.resultado);
  const max = Math.max(...resultados);
  const min = Math.min(...resultados);

  // Onde, de cima (max) para baixo (min), a curva cruza o zero — define o ponto
  // em que o gradiente troca de verde (ganho) para vermelho (perda).
  const offsetZero = max <= 0 ? 0 : min >= 0 ? 1 : max / (max - min);

  // Formata o eixo Y de forma compacta (ex.: "R$ 1,2 mil") para não poluir.
  const tickResultado = (valor: number): string => {
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
        <AreaChart data={curva} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <defs>
            {/* Gradiente que troca de cor exatamente no zero (ganho × perda). */}
            <linearGradient id="payoff-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor="var(--color-risco-ok)" stopOpacity={0.35} />
              <stop offset={offsetZero} stopColor="var(--color-risco-ok)" stopOpacity={0.12} />
              <stop offset={offsetZero} stopColor="var(--color-risco-perigo)" stopOpacity={0.12} />
              <stop offset={1} stopColor="var(--color-risco-perigo)" stopOpacity={0.35} />
            </linearGradient>
            <linearGradient id="payoff-stroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor="var(--color-risco-ok)" />
              <stop offset={offsetZero} stopColor="var(--color-risco-ok)" />
              <stop offset={offsetZero} stopColor="var(--color-risco-perigo)" />
              <stop offset={1} stopColor="var(--color-risco-perigo)" />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />

          <XAxis
            dataKey="preco"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v: number) => formatPreco(v)}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            stroke="var(--color-border)"
            tickMargin={8}
          />
          <YAxis
            tickFormatter={tickResultado}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            stroke="var(--color-border)"
            width={72}
          />

          <Tooltip
            cursor={{ stroke: "var(--color-muted-foreground)", strokeDasharray: "3 3" }}
            content={<ConteudoTooltip />}
          />

          {/* Strikes da estrutura: marcas discretas de referência. */}
          {strikes.map((s, i) => (
            <ReferenceLine
              key={`strike-${i}`}
              x={s}
              stroke="var(--color-muted-foreground)"
              strokeOpacity={0.35}
              strokeDasharray="2 4"
            />
          ))}

          {/* Linha do zero: nem ganha nem perde. */}
          <ReferenceLine y={0} stroke="var(--color-foreground)" strokeOpacity={0.5} />

          {/* Breakevens: pontos de equilíbrio, em dourado tracejado. */}
          {breakevens.map((be, i) => (
            <ReferenceLine
              key={`be-${i}`}
              x={be}
              stroke="var(--color-dourado)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              label={{
                value: `BE ${formatPreco(be)}`,
                position: "insideTopRight",
                fontSize: 10,
                fill: "var(--color-dourado)",
              }}
            />
          ))}

          <Area
            type="linear"
            dataKey="resultado"
            stroke="url(#payoff-stroke)"
            strokeWidth={2}
            fill="url(#payoff-fill)"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Tooltip em linguagem clara: preço do ativo + ganho/perda naquele cenário. */
function ConteudoTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: PontoPayoff }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const ponto = payload[0]!.payload;
  const ganho = ponto.resultado >= 0;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground">
        Se o ativo terminar em{" "}
        <span className="font-medium text-foreground">{formatPreco(ponto.preco)}</span>
      </p>
      <p className="mt-0.5 font-heading text-sm font-semibold">
        <span className={ganho ? "text-risco-ok" : "text-risco-perigo"}>
          {ganho ? "Ganho" : "Perda"} de {formatBRL(Math.abs(ponto.resultado))}
        </span>
      </p>
    </div>
  );
}
