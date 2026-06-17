import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * `<Semaforo>` — indicador de risco verde/amarelo/vermelho (§10).
 *
 * É o vocabulário visual do "risco antes do ganho" (§2). As três cores carregam
 * SIGNIFICADO (não enfeite): verde = dentro do limite, âmbar = atenção, vermelho
 * = acima do limite. Componente puro e reutilizável (sem estado, sem rede).
 *
 * Acessibilidade: além da cor, há sempre um rótulo de texto (ou `aria-label`)
 * para não depender só de cor.
 */

const NIVEIS = {
  ok: { rotulo: "Dentro do limite", classe: "bg-risco-ok", texto: "text-risco-ok" },
  alerta: { rotulo: "Atenção", classe: "bg-risco-alerta", texto: "text-risco-alerta" },
  perigo: { rotulo: "Acima do limite", classe: "bg-risco-perigo", texto: "text-risco-perigo" },
} as const;

export type NivelRisco = keyof typeof NIVEIS;

const pontoVariants = cva("inline-block shrink-0 rounded-full", {
  variants: {
    size: {
      sm: "size-2",
      md: "size-2.5",
      lg: "size-3.5",
    },
  },
  defaultVariants: { size: "md" },
});

export function Semaforo({
  nivel,
  rotulo,
  mostrarRotulo = true,
  size,
  className,
}: {
  nivel: NivelRisco;
  /** Texto ao lado do ponto (default: o rótulo padrão do nível). */
  rotulo?: string;
  /** Esconde o texto e mostra só o ponto (o rótulo vira `aria-label`). */
  mostrarRotulo?: boolean;
  className?: string;
} & VariantProps<typeof pontoVariants>) {
  const n = NIVEIS[nivel];
  const texto = rotulo ?? n.rotulo;

  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      // Sem texto visível, o leitor de tela ainda anuncia o significado.
      aria-label={mostrarRotulo ? undefined : texto}
      role={mostrarRotulo ? undefined : "img"}
    >
      <span className="relative inline-flex">
        {/* Halo suave da cor do nível, para o ponto "respirar". */}
        <span
          aria-hidden
          className={cn(pontoVariants({ size }), n.classe, "opacity-25 absolute inset-0 scale-[1.8] blur-[1px]")}
        />
        <span aria-hidden className={cn(pontoVariants({ size }), n.classe, "relative")} />
      </span>
      {mostrarRotulo && (
        <span className={cn("text-sm font-medium", n.texto)}>{texto}</span>
      )}
    </span>
  );
}

/**
 * Legenda das três cores — útil onde o semáforo aparece pela primeira vez
 * (ex.: dashboard), para o leigo aprender a ler o sinal.
 */
export function SemaforoLegenda({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-2", className)}>
      <Semaforo nivel="ok" size="sm" />
      <Semaforo nivel="alerta" size="sm" />
      <Semaforo nivel="perigo" size="sm" />
    </div>
  );
}
