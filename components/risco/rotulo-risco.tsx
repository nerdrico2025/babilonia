import { ShieldCheck, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * `<RotuloRisco>` — o selo DEFINIDO / INDEFINIDO (§2, princípio 2).
 *
 * Toda estrutura precisa ser rotulada e o rótulo tem que ser BEM destacado e
 * aparecer antes do ganho. Por isso é um selo grande, com ícone e texto:
 *  - DEFINIDO  → perda máxima conhecida e limitada (tom lápis, ícone de escudo);
 *  - INDEFINIDO → perda pode superar o prêmio recebido (tom vermelho de risco,
 *    ícone de alerta) — o caso que mais exige atenção do leigo.
 *
 * Componente puro. Para a explicação do termo, acompanhe com `<TermoTecnico>`.
 */
export function RotuloRisco({
  tipo,
  className,
}: {
  tipo: "definido" | "indefinido";
  className?: string;
}) {
  const definido = tipo === "definido";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 rounded-lg border px-3 py-2",
        definido
          ? "border-primary/25 bg-accent text-accent-foreground"
          : "border-risco-perigo/40 bg-risco-perigo-suave text-risco-perigo",
        className,
      )}
    >
      {definido ? (
        <ShieldCheck className="size-5 shrink-0" aria-hidden />
      ) : (
        <TriangleAlert className="size-5 shrink-0" aria-hidden />
      )}
      <span className="flex flex-col leading-tight">
        <span className="text-[11px] font-medium tracking-wide uppercase opacity-70">
          Risco
        </span>
        <span className="font-heading text-base font-bold tracking-tight">
          {definido ? "DEFINIDO" : "INDEFINIDO"}
        </span>
      </span>
      <span className="ml-1 max-w-[16rem] text-xs leading-snug opacity-80">
        {definido
          ? "A perda máxima é conhecida e limitada."
          : "A perda pode superar — e muito — o prêmio recebido."}
      </span>
    </span>
  );
}
