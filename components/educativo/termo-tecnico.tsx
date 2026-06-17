"use client";

import Link from "next/link";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getTermo } from "@/lib/glossario";
import { cn } from "@/lib/utils";

/**
 * `<TermoTecnico>` — envolve QUALQUER jargão (gregas, IV Rank, skew, breakeven…)
 * com a infraestrutura educativa do §2/§8.7:
 *  - sublinhado pontilhado discreto que sinaliza "tem explicação";
 *  - tooltip com a definição curta (1 linha) ao passar o mouse / focar;
 *  - o próprio termo é um LINK para a entrada completa em `/glossario#slug`.
 *
 * Uso: `<TermoTecnico termo="iv-rank">IV Rank</TermoTecnico>`. Se `children` for
 * omitido, usa o nome do termo do glossário. Se o slug não existir, degrada para
 * texto puro (e avisa no console em dev) — nunca quebra a tela.
 */
export function TermoTecnico({
  termo: slug,
  children,
  className,
}: {
  /** Slug do termo no glossário (ex.: "iv-rank"). */
  termo: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const t = getTermo(slug);

  // Slug inexistente: não inventamos definição (§2.4). Degrada para texto.
  if (!t) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `<TermoTecnico>: o termo "${slug}" não está no glossário (lib/glossario.ts).`,
      );
    }
    return <span className={className}>{children}</span>;
  }

  const rotulo = children ?? t.termo;

  return (
    <Tooltip>
      <TooltipTrigger
        // O termo É o link: hover/foco mostra a explicação curta; clique leva
        // ao glossário. `render` troca o <button> padrão por um <Link> inline.
        render={
          <Link
            href={`/glossario#${t.slug}`}
            aria-label={`${t.termo}. ${t.curto} Abrir no glossário.`}
          />
        }
        className={cn(
          "cursor-help font-medium text-foreground underline decoration-dotted decoration-primary/50 decoration-1 underline-offset-[3px] transition-colors hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-xs",
          className,
        )}
      >
        {rotulo}
      </TooltipTrigger>
      <TooltipContent className="flex max-w-xs flex-col items-start gap-1 text-left">
        <span className="font-heading text-sm font-semibold">{t.termo}</span>
        <span className="text-xs leading-snug opacity-90">{t.curto}</span>
        <span className="mt-0.5 text-[10px] font-medium tracking-wide uppercase opacity-70">
          Clique para ver no glossário →
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
