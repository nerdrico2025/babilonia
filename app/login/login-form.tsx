"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">Babilônia</CardTitle>
        <CardDescription>
          Acesso pessoal. Entre com seu usuário e senha para montar e analisar
          suas operações com opções.
        </CardDescription>
      </CardHeader>

      <form action={formAction}>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="username" className="text-sm font-medium">
              Usuário
            </label>
            <Input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              autoFocus
              aria-invalid={state.error ? true : undefined}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Senha
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={state.error ? true : undefined}
            />
          </div>

          {state.error ? (
            <p
              role="alert"
              className="text-sm font-medium text-destructive"
            >
              {state.error}
            </p>
          ) : null}
        </CardContent>

        <CardFooter className="mt-4 flex-col items-stretch gap-3">
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Entrando..." : "Entrar"}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            O Babilônia é uma ferramenta pessoal de análise. Não é consultoria,
            não recomenda e não executa ordens — toda decisão é sua.
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
