import type { Metadata } from "next";

import { Pagina, PaginaCabecalho } from "@/components/layout/pagina";
import { CATEGORIAS_ORDEM, termosPorCategoria } from "@/lib/glossario";

export const metadata: Metadata = {
  title: "Glossário — Babilônia",
};

/**
 * Tela 9 (§14): Glossário / Modo educativo. É o destino dos links de todo
 * `<TermoTecnico>` (âncora `#slug`). Conteúdo vindo da fonte única
 * `lib/glossario.ts`, em português claro (§2, §8.7).
 */
export default function GlossarioPage() {
  const grupos = termosPorCategoria();

  return (
    <Pagina>
      <PaginaCabecalho
        sobretitulo="Tela 9 · Modo educativo"
        titulo="Glossário"
        descricao="Todo termo técnico do app explicado em linguagem simples. Em qualquer tela, passe o mouse sobre uma palavra sublinhada para ver a versão curta — e clique para cair aqui."
      />

      {/* Atalhos por categoria. */}
      <nav className="mb-10 flex flex-wrap gap-2" aria-label="Categorias do glossário">
        {CATEGORIAS_ORDEM.map((cat) => (
          <a
            key={cat}
            href={`#cat-${slug(cat)}`}
            className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            {cat}
          </a>
        ))}
      </nav>

      <div className="space-y-12">
        {grupos.map(({ categoria, termos }) => (
          <section key={categoria} id={`cat-${slug(categoria)}`} className="scroll-mt-24">
            <h2 className="mb-5 flex items-center gap-3 font-heading text-xl font-semibold tracking-tight">
              <span aria-hidden className="h-px w-6 bg-dourado" />
              {categoria}
            </h2>
            <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
              {termos.map((t) => (
                <div
                  key={t.slug}
                  id={t.slug}
                  className="scroll-mt-24 bg-card p-5"
                >
                  <dt className="font-heading text-base font-semibold tracking-tight">
                    {t.termo}
                  </dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {t.longo}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Pagina>
  );
}

/** Slug simples para as âncoras de categoria (sem acento, minúsculo). */
function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}
