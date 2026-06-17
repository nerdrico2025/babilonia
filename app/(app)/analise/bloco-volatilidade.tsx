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
import type { VolatilidadeAtivo } from "@/lib/integrations/oplab";

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
 * Bloco 3 — Volatilidade (§8.2, §9). IV e IV Rank/percentil vêm da OpLab (via
 * /api/cadeia). A regra do §9: IV Rank alto → tende a favorecer estruturas
 * vendidas; baixo → compradas — sempre como leitura, nunca ordem (§2.3). O skew
 * não vem na API (§6.4): o usuário cola a IV de uma put e de uma call OTM.
 */
export function BlocoVolatilidade({
  ivAtual,
  volatilidade,
  eventoProximo,
  frescor,
}: {
  ivAtual: number | null;
  volatilidade: VolatilidadeAtivo | null;
  eventoProximo: boolean;
  frescor: Frescor | null;
}) {
  const [ivPut, setIvPut] = useState("");
  const [ivCall, setIvCall] = useState("");

  const analise = useMemo(
    () =>
      lerVolatilidade(
        {
          ivAtual: ivAtual ?? volatilidade?.ivAtual ?? null,
          ivRank: volatilidade?.ivRank1a ?? null,
          ivPercentil: volatilidade?.ivPercentil1a ?? null,
        },
        { eventoProximo },
      ),
    [ivAtual, volatilidade, eventoProximo],
  );

  const put = parseNum(ivPut);
  const call = parseNum(ivCall);
  const skew = put != null && call != null ? lerSkew(put, call) : null;

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

        {/* Skew: input manual (a OpLab não entrega skew por opção, §6.4). */}
        <details className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">
            Calcular <TermoTecnico termo="skew">skew</TermoTecnico> (colar IV de put e call OTM)
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="iv-put" className="text-xs text-muted-foreground">IV da put OTM (%)</label>
              <Input id="iv-put" inputMode="decimal" value={ivPut} onChange={(e) => setIvPut(e.target.value)} placeholder="—" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="iv-call" className="text-xs text-muted-foreground">IV da call OTM (%)</label>
              <Input id="iv-call" inputMode="decimal" value={ivCall} onChange={(e) => setIvCall(e.target.value)} placeholder="—" />
            </div>
          </div>
          {skew && <p className="mt-2 text-sm text-muted-foreground">{skew.leitura}</p>}
        </details>

        <LeituraIniciante linhas={analise.leitura} />
      </CardContent>
    </Card>
  );
}
