"use client";

import { Clock, Lightbulb } from "lucide-react";

import { cn } from "@/lib/utils";

import type { Frescor } from "./tipos";

/** "HH:MM" no fuso de São Paulo a partir de um ISO. */
export function fmtHora(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

/** Número genérico em pt-BR (até 2 casas). */
export function fmtNum(v: number | null, casas = 2): string {
  return v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: casas });
}

/** Linha discreta de frescor do dado (§6.3): de quando é e de onde veio. */
export function FrescorBadge({ frescor }: { frescor: Frescor | null }) {
  if (!frescor) return null;
  const rotulo =
    frescor.origem === "rede"
      ? "atualizado agora"
      : frescor.origem === "cache"
        ? "em cache"
        : "cache (fonte indisponível)";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        frescor.desatualizado ? "text-risco-alerta" : "text-muted-foreground",
      )}
    >
      <Clock className="size-3" aria-hidden />
      {frescor.aviso ?? `Dado de ${fmtHora(frescor.geradoEm)} · ${rotulo}`}
    </span>
  );
}

/**
 * Caixa-base da "leitura de iniciante" (§8.2/§9): mesmo visual dourado, mas aceita
 * conteúdo arbitrário (ReactNode) — assim a prosa pode embrulhar jargão em
 * `<TermoTecnico>` inline, sem perder o estilo. SEM recomendação: só descreve.
 */
export function LeituraBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 flex gap-2.5 rounded-lg border border-dourado/40 bg-dourado/10 px-3.5 py-3">
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-dourado" aria-hidden />
      <div className="flex flex-col gap-1 text-sm leading-relaxed text-foreground/85">
        <p className="text-[11px] font-semibold tracking-wide text-foreground/70 uppercase">
          Leitura para iniciante
        </p>
        {children}
      </div>
    </div>
  );
}

/**
 * Callout que encerra cada bloco (§8.2): a "leitura de iniciante" a partir de
 * linhas de texto simples. Em linguagem simples e SEM recomendação (§9).
 */
export function LeituraIniciante({ linhas }: { linhas: string[] }) {
  if (linhas.length === 0) return null;
  return (
    <LeituraBox>
      {linhas.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </LeituraBox>
  );
}

/** Campo de texto (textarea) estilizado, para colar dados (§2.4). */
export function AreaColar({
  id,
  rotulo,
  valor,
  onChange,
  placeholder,
  ajuda,
}: {
  id: string;
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ajuda?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {rotulo}
      </label>
      <textarea
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
      {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

/** Pequeno indicador rotulado (valor grande + rótulo). */
export function Indicador({
  rotulo,
  valor,
}: {
  rotulo: React.ReactNode;
  valor: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{rotulo}</p>
      <p className="mt-0.5 font-medium tabular">{valor}</p>
    </div>
  );
}
