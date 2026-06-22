import { cn } from "@/lib/utils";

/**
 * Placeholder pulsante para estados de carregamento (shadcn/ui). É só um bloco
 * com `animate-pulse` — dê altura/largura via `className` para casar com o
 * conteúdo real e evitar layout shift.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
