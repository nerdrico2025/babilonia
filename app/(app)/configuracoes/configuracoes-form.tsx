"use client";

import { useActionState } from "react";
import { Check, Info, TriangleAlert } from "lucide-react";

import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TEMAS, type Tema } from "@/lib/settings";
import { cn } from "@/lib/utils";

import { salvarConfiguracoes, type EstadoConfig } from "./actions";

const ROTULO_TEMA: Record<Tema, string> = {
  claro: "Claro",
  escuro: "Escuro",
};

const initial: EstadoConfig = {};

/**
 * Formulário de capital total + preferências de exibição (tela 3). O capital é a
 * base de TODAS as regras de risco do §10 — por isso o aviso de recálculo. O
 * tema é aplicado na hora (preview) ao trocar e persiste ao salvar.
 */
export function ConfiguracoesForm({
  capitalInicial,
  temaInicial,
}: {
  capitalInicial: number;
  temaInicial: Tema;
}) {
  const [state, formAction, pending] = useActionState(salvarConfiguracoes, initial);

  // Aplica o tema imediatamente (preview), sem esperar o salvar.
  function preverTema(tema: Tema) {
    document.documentElement.classList.toggle("dark", tema === "escuro");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Capital e preferências</CardTitle>
        <CardDescription>
          O capital total é a base das regras de risco e concentração (§10).
        </CardDescription>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="capital" className="text-sm font-medium">
              Capital total (R$)
            </label>
            <Input
              id="capital"
              name="capital"
              inputMode="decimal"
              defaultValue={capitalInicial > 0 ? String(capitalInicial).replace(".", ",") : ""}
              placeholder="50.000,00"
              aria-invalid={state.erro ? true : undefined}
            />
            {/* Aviso explícito do §10: mudar o capital recalcula o book. */}
            <p className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0 text-dourado" aria-hidden />
              Mudar o capital recalcula os indicadores de risco do book — o{" "}
              <TermoTecnico termo="risco-definido">% de capital em risco</TermoTecnico> e a
              concentração no dashboard são atualizados.
            </p>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">Tema de exibição</legend>
            <div className="inline-flex w-fit rounded-lg border border-border p-0.5">
              {TEMAS.map((t) => (
                <label
                  key={t}
                  className="cursor-pointer rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors has-[:checked]:bg-primary has-[:checked]:text-primary-foreground"
                >
                  <input
                    type="radio"
                    name="tema"
                    value={t}
                    defaultChecked={t === temaInicial}
                    onChange={() => preverTema(t)}
                    className="sr-only"
                  />
                  {ROTULO_TEMA[t]}
                </label>
              ))}
            </div>
          </fieldset>

          {state.erro && (
            <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-risco-perigo">
              <TriangleAlert className="size-4" aria-hidden />
              {state.erro}
            </p>
          )}
          {state.ok && state.mensagem && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-risco-ok">
              <Check className="size-4" aria-hidden />
              {state.mensagem}
            </p>
          )}
        </CardContent>
        <div className={cn("flex justify-end px-4 pb-4")}>
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando..." : "Salvar configurações"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
