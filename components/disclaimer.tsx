import { Info } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Disclaimer recorrente (§2 princípio 3, §13): o Babilônia NÃO é consultoria,
 * não recomenda e não executa ordens — toda ordem é digitada manualmente pelo
 * usuário, sob sua responsabilidade.
 *
 * Duas formas, para o aviso ser "persistente mas não intrusivo":
 *  - `DisclaimerBar`: faixa fina e fixa no rodapé do app (sempre visível, discreta);
 *  - `DisclaimerNota`: bloco um pouco mais explícito, para telas de decisão
 *    (montador, ticket), onde o lembrete pesa mais.
 */

const TEXTO_CURTO =
  "O Babilônia não é consultoria e não recomenda operações. A execução das ordens é manual e de responsabilidade do usuário.";

/** Faixa fina, fixa no rodapé do conteúdo. Sempre presente, sem roubar a cena. */
export function DisclaimerBar({ className }: { className?: string }) {
  return (
    <aside
      role="note"
      aria-label="Aviso importante"
      className={cn(
        "sticky bottom-0 z-30 border-t border-border/70 bg-background/85 px-4 py-2 backdrop-blur-sm",
        className,
      )}
    >
      <p className="mx-auto flex max-w-6xl items-center gap-2 text-center text-xs leading-snug text-muted-foreground">
        <Info className="size-3.5 shrink-0 text-dourado" aria-hidden />
        <span>{TEXTO_CURTO}</span>
      </p>
    </aside>
  );
}

/** Bloco de aviso para telas de decisão (montador/ticket) — um pouco mais forte. */
export function DisclaimerNota({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-dourado/40 bg-dourado/10 px-3.5 py-3 text-sm leading-snug text-foreground/80",
        className,
      )}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-dourado" aria-hidden />
      <p>
        <strong className="font-semibold text-foreground">
          Decisão é sua.
        </strong>{" "}
        Os cenários abaixo são informativos. O Babilônia não recomenda nem envia
        ordens — você confere e digita a ordem no home broker, por sua conta e
        risco.
      </p>
    </div>
  );
}
