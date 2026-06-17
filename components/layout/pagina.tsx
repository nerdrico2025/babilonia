import { Hammer } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Esqueleto comum das telas (§14): cabeçalho editorial + área de conteúdo com
 * largura confortável de leitura. Mantém todas as telas visualmente coerentes.
 */
export function Pagina({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10", className)}>
      {children}
    </div>
  );
}

/** Cabeçalho de tela: sobretítulo (nº da tela), título serifado e descrição. */
export function PaginaCabecalho({
  sobretitulo,
  titulo,
  descricao,
  acoes,
}: {
  sobretitulo?: string;
  titulo: string;
  descricao?: string;
  acoes?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {sobretitulo && (
          <p className="mb-1.5 flex items-center gap-2 text-xs font-medium tracking-[0.14em] text-primary uppercase">
            <span aria-hidden className="h-px w-6 bg-dourado" />
            {sobretitulo}
          </p>
        )}
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {titulo}
        </h1>
        {descricao && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
            {descricao}
          </p>
        )}
      </div>
      {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
    </header>
  );
}

/**
 * Painel "em construção" — esta entrega é só a CASCA (navegação + componentes
 * educativos). A lógica de dados de cada tela chega na Fase 1; este bloco diz
 * isso ao usuário em linguagem clara, sem deixar a tela vazia.
 */
export function EmConstrucao({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-border bg-card/50 p-6 sm:p-8",
        className,
      )}
    >
      <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-dourado/40 bg-dourado/10 px-3 py-1 text-xs font-medium text-foreground/70">
        <Hammer className="size-3.5 text-dourado" aria-hidden />
        Em construção — chega na Fase 1
      </div>
      <div className="prose-sm max-w-2xl space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}
