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
