"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Landmark } from "lucide-react";

import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  lerFundamentos,
  type FundamentosEntrada,
} from "@/lib/analise/fundamentos";
import { formatPreco } from "@/lib/format";
import type { BrapiFundamentos, BrapiProvento } from "@/lib/integrations/brapi";

import { FrescorBadge, Indicador, LeituraIniciante } from "./analise-ui";
import type { Frescor } from "./tipos";

// pt-BR → número, ou null se vazio/ inválido.
function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(d);
}

/**
 * Bloco 2 — Fundamentalista (§8.2). Usa os fundamentos da brapi quando o plano
 * fornece; quando não (Free, §6.1), o usuário COLA os múltiplos (§2.4). Mostra
 * também proventos (brapi) e o calendário de resultados (indisponível na API,
 * §6.4 — input manual). Encerra com leitura de iniciante (§9).
 */
export function BlocoFundamentalista({
  fundamentos,
  proventos,
  resultadosInfo,
  frescorFundamentos,
  frescorProventos,
}: {
  fundamentos: BrapiFundamentos | null;
  proventos: BrapiProvento[];
  resultadosInfo: { motivo: string; fonteAlternativa: string };
  frescorFundamentos: Frescor | null;
  frescorProventos: Frescor;
}) {
  // Edição manual (preenche/sobrescreve o que a API não trouxe).
  const [m, setM] = useState({ precoLucro: "", evEbitda: "", pvp: "", margemLiquida: "", dividendYield: "" });
  const [proximoResultado, setProximoResultado] = useState("");
  const set = (k: keyof typeof m) => (v: string) => setM((s) => ({ ...s, [k]: v }));

  // Mescla API + manual (manual tem prioridade quando preenchido).
  const entrada: FundamentosEntrada = useMemo(
    () => ({
      precoLucro: parseNum(m.precoLucro) ?? fundamentos?.precoLucro ?? null,
      evEbitda: parseNum(m.evEbitda) ?? fundamentos?.evEbitda ?? null,
      precoValorPatrimonial: parseNum(m.pvp) ?? fundamentos?.precoValorPatrimonial ?? null,
      margemBruta: fundamentos?.margemBruta ?? null,
      margemOperacional: fundamentos?.margemOperacional ?? null,
      margemLiquida: parseNum(m.margemLiquida) ?? fundamentos?.margemLiquida ?? null,
      dividendYield: parseNum(m.dividendYield) ?? fundamentos?.dividendYield ?? null,
      lucrosPorTrimestre: fundamentos?.lucrosPorTrimestre ?? [],
    }),
    [m, fundamentos],
  );

  const analise = useMemo(() => lerFundamentos(entrada), [entrada]);

  // Próximos proventos (ordena por data de pagamento desc, mostra até 4).
  const proventosOrdenados = [...proventos]
    .filter((p) => p.dataPagamento)
    .sort((a, b) => (a.dataPagamento! < b.dataPagamento! ? 1 : -1))
    .slice(0, 4);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="size-4 text-primary" aria-hidden />
          Fundamentalista
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>Múltiplos, margens, proventos e resultados.</span>
          <FrescorBadge frescor={frescorFundamentos} />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Múltiplos (valor efetivo: API ou colado). */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Indicador rotulo={<TermoTecnico termo="preco-lucro">P/L</TermoTecnico>} valor={fmtMult(entrada.precoLucro)} />
          <Indicador rotulo={<TermoTecnico termo="ev-ebitda">EV/EBITDA</TermoTecnico>} valor={fmtMult(entrada.evEbitda)} />
          <Indicador rotulo={<TermoTecnico termo="preco-valor-patrimonial">P/VP</TermoTecnico>} valor={fmtMult(entrada.precoValorPatrimonial)} />
          <Indicador rotulo={<TermoTecnico termo="margem-liquida">Margem líq.</TermoTecnico>} valor={fmtPctFlex(entrada.margemLiquida)} />
          <Indicador rotulo={<TermoTecnico termo="dividend-yield">Div. yield</TermoTecnico>} valor={fmtPctFlex(entrada.dividendYield)} />
        </div>

        {/* Colar/editar manualmente (§2.4) — útil no plano Free. */}
        <details className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Colar / editar manualmente</summary>
          <p className="mt-1 mb-3 text-xs text-muted-foreground">
            Preencha o que a fonte não trouxe (ex.: Status Invest, RI da empresa). O que você digitar tem prioridade.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <CampoMini id="f-pl" rotulo="P/L" valor={m.precoLucro} onChange={set("precoLucro")} />
            <CampoMini id="f-ev" rotulo="EV/EBITDA" valor={m.evEbitda} onChange={set("evEbitda")} />
            <CampoMini id="f-pvp" rotulo="P/VP" valor={m.pvp} onChange={set("pvp")} />
            <CampoMini id="f-ml" rotulo="Margem líq. (%)" valor={m.margemLiquida} onChange={set("margemLiquida")} />
            <CampoMini id="f-dy" rotulo="Div. yield (%)" valor={m.dividendYield} onChange={set("dividendYield")} />
          </div>
        </details>

        {/* Proventos (brapi) + resultados (input manual, §6.4). */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 flex items-center justify-between text-[11px] tracking-wide text-muted-foreground uppercase">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" aria-hidden /> Proventos
              </span>
              <FrescorBadge frescor={frescorProventos} />
            </p>
            {proventosOrdenados.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum provento informado pela fonte (pode exigir plano pago).
              </p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {proventosOrdenados.map((p, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">
                      {p.tipo ?? "Provento"} · {fmtData(p.dataPagamento)}
                    </span>
                    <span className="tabular">{p.valor != null ? formatPreco(p.valor) : "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-[11px] tracking-wide text-muted-foreground uppercase">
              Próximo resultado (balanço)
            </p>
            <Input type="date" value={proximoResultado} onChange={(e) => setProximoResultado(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">{resultadosInfo.motivo} {resultadosInfo.fonteAlternativa}</p>
          </div>
        </div>

        <LeituraIniciante linhas={analise.leitura} />
      </CardContent>
    </Card>
  );
}

function fmtMult(v: number | null): string {
  return v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}
function fmtPctFlex(v: number | null): string {
  if (v == null) return "—";
  const valor = Math.abs(v) <= 1 ? v * 100 : v;
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function CampoMini({
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
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">{rotulo}</label>
      <Input id={id} inputMode="decimal" value={valor} onChange={(e) => onChange(e.target.value)} placeholder="—" />
    </div>
  );
}
