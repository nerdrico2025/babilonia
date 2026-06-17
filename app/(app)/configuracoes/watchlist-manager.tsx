"use client";

import { useActionState } from "react";
import { Plus, Star, TriangleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import {
  adicionarAtivo,
  removerAtivo,
  type EstadoConfig,
} from "./actions";

const initial: EstadoConfig = {};

/** Item da watchlist exibido. */
export interface AtivoView {
  id: number;
  symbol: string;
}

/**
 * Gerenciador da watchlist (tela 3, §7): lista os ativos-objeto acompanhados,
 * adiciona (com validação de ticker) e remove. As mutações são Server Actions.
 */
export function WatchlistManager({ ativos }: { ativos: AtivoView[] }) {
  const [state, formAction, pending] = useActionState(adicionarAtivo, initial);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Star className="size-4 text-dourado" aria-hidden />
          Watchlist de ativos-objeto
        </CardTitle>
        <CardDescription>
          Os ativos que você acompanha para analisar e montar operações.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Adicionar. */}
        <form action={formAction} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="symbol" className="text-sm font-medium">
              Adicionar ativo
            </label>
            <Input
              id="symbol"
              name="symbol"
              placeholder="PETR4"
              autoComplete="off"
              aria-invalid={state.erro ? true : undefined}
            />
          </div>
          <Button type="submit" disabled={pending}>
            <Plus className="size-4" aria-hidden />
            Adicionar
          </Button>
        </form>

        {state.erro && (
          <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-risco-perigo">
            <TriangleAlert className="size-4" aria-hidden />
            {state.erro}
          </p>
        )}

        {/* Lista. */}
        {ativos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum ativo na watchlist ainda. Adicione um ticker da B3 acima.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {ativos.map((a) => (
              <li
                key={a.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pr-1 pl-3 text-sm"
              >
                <span className="font-medium tabular">{a.symbol}</span>
                {/* Remoção: form com Server Action (sem estado, recarrega a lista). */}
                <form action={removerAtivo}>
                  <input type="hidden" name="symbol" value={a.symbol} />
                  <button
                    type="submit"
                    aria-label={`Remover ${a.symbol}`}
                    className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
