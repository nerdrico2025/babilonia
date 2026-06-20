"use client";

import { useMemo, useState } from "react";
import { Activity } from "lucide-react";

import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { lerSkew, lerVolatilidade } from "@/lib/analise/volatilidade";
import type { ResultadoSkewAutomatico } from "@/lib/dados-opcoes/skew";
import type { VolatilidadeAtivo } from "@/lib/opcoes/tipos";
import { formatPreco } from "@/lib/format";

import { FrescorBadge, Indicador, LeituraIniciante } from "./analise-ui";
import type { Frescor } from "./tipos";

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function fmtPctNum(v: number | null): string {
  return v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/**
 * Bloco 3 — Volatilidade (§8.2, §9). IV e IV Rank/percentil são calculados por nós
 * (a partir do COTAHIST/`iv_history`) e chegam via /api/cadeia. A regra do §9: IV
 * Rank alto → tende a favorecer estruturas
 * vendidas; baixo → compradas — sempre como leitura, nunca ordem (§2.3). O skew
 * não vem na API (§6.4): o usuário cola a IV de uma put e de uma call OTM.
 */
export function BlocoVolatilidade({
  ivAtual,
  volatilidade,
  skew,
  frescor,
}: {
  ivAtual: number | null;
  volatilidade: VolatilidadeAtivo | null;
  skew: ResultadoSkewAutomatico | null;
  frescor: Frescor | null;
}) {
  const [ivPut, setIvPut] = useState("");
  const [ivCall, setIvCall] = useState("");
  // Toggle p/ revelar os inputs manuais quando o automático está disponível.
  const [mostrarManual, setMostrarManual] = useState(false);

  const analise = useMemo(
    () =>
      lerVolatilidade({
        ivAtual: ivAtual ?? volatilidade?.ivAtual ?? null,
        ivRank: volatilidade?.ivRank1a ?? null,
        ivPercentil: volatilidade?.ivPercentil1a ?? null,
      }),
    [ivAtual, volatilidade],
  );

  // Skew MANUAL (fallback colado): só quando o usuário preenche os DOIS inputs.
  const put = parseNum(ivPut);
  const call = parseNum(ivCall);
  const skewManual = put != null && call != null ? lerSkew(put, call) : null;

  // Skew AUTOMÁTICO (V1) já resolvido pela rota — a UI só formata/decide.
  const auto = skew && skew.disponivel ? skew : null;
  const motivoAuto = skew && !skew.disponivel ? skew.motivo : null;
  // Inputs manuais ficam SEMPRE visíveis quando não há automático (fallback);
  // com automático, ficam atrás do toggle "colar valores manualmente".
  const inputsVisiveis = auto === null || mostrarManual;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-primary" aria-hidden />
          Volatilidade
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <TermoTecnico termo="volatilidade-implicita">IV</TermoTecnico>,{" "}
            <TermoTecnico termo="iv-rank">IV Rank</TermoTecnico> e{" "}
            <TermoTecnico termo="skew">skew</TermoTecnico>.
          </span>
          <FrescorBadge frescor={frescor} />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Indicador
            rotulo={<TermoTecnico termo="volatilidade-implicita">IV atual</TermoTecnico>}
            valor={fmtPctNum(ivAtual ?? volatilidade?.ivAtual ?? null)}
          />
          <Indicador
            rotulo={<TermoTecnico termo="iv-rank">IV Rank 1a</TermoTecnico>}
            valor={fmtPctNum(volatilidade?.ivRank1a ?? null)}
          />
          <Indicador rotulo="IV Rank 6m" valor={fmtPctNum(volatilidade?.ivRank6m ?? null)} />
          <Indicador rotulo="IV percentil 1a" valor={fmtPctNum(volatilidade?.ivPercentil1a ?? null)} />
        </div>

        {/* Skew put/call: automático (V1) com fallback manual transparente (V2). */}
        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-3">
          <p className="text-sm font-medium">
            <TermoTecnico termo="skew">Skew</TermoTecnico> put/call
          </p>

          {skewManual ? (
            // Manual SOBREPÕE o automático quando o usuário cola os dois valores.
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">{skewManual.leitura}</p>
              <p className="text-xs text-muted-foreground/80">
                Valor colado manualmente — sobrepõe o cálculo automático.
              </p>
            </div>
          ) : auto ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">{auto.leitura}</p>
              <p className="text-xs text-muted-foreground/80">
                Calculado a partir da PUT {auto.parUsado.put.symbol} (strike{" "}
                {formatPreco(auto.parUsado.put.strike)}, {fmtPctNum(auto.parUsado.put.distanciaPercentual)} OTM)
                {" "}e da CALL {auto.parUsado.call.symbol} (strike{" "}
                {formatPreco(auto.parUsado.call.strike)}, {fmtPctNum(auto.parUsado.call.distanciaPercentual)} OTM),
                {" "}sobre o preço de {formatPreco(auto.parUsado.spot)}.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {motivoAuto ??
                "Não foi possível calcular o skew automático para este vencimento."}{" "}
              Cole os valores manualmente abaixo.
            </p>
          )}

          {inputsVisiveis ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="iv-put" className="text-xs text-muted-foreground">IV da put OTM (%)</label>
                <Input id="iv-put" inputMode="decimal" value={ivPut} onChange={(e) => setIvPut(e.target.value)} placeholder="—" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="iv-call" className="text-xs text-muted-foreground">IV da call OTM (%)</label>
                <Input id="iv-call" inputMode="decimal" value={ivCall} onChange={(e) => setIvCall(e.target.value)} placeholder="—" />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setMostrarManual(true)}
              className="self-start text-xs font-medium text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              Colar valores manualmente
            </button>
          )}
        </div>

        <LeituraIniciante linhas={analise.leitura} />
      </CardContent>
    </Card>
  );
}
