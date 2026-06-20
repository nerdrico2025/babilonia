"use client";

import { useState } from "react";
import { ListTree, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

import { CadeiaCliente } from "./cadeia-cliente";
import { ScreeningCliente } from "./screening-cliente";

type Aba = "cadeia" | "screening";

/**
 * Abas da tela 5: a CADEIA manual (tabela por strike/vencimento) e a TRIAGEM
 * automática (screening da cadeia inteira no microserviço de quant, §15). Ficam
 * na mesma tela porque partem do mesmo lugar (a cadeia de opções) — mais simples
 * que uma tela nova. As duas são independentes: uma fora não afeta a outra (§6.3).
 */
export function CadeiaTabs() {
  const [aba, setAba] = useState<Aba>("cadeia");

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label="Modo da cadeia de opções"
        className="inline-flex w-fit rounded-lg border border-border p-0.5"
      >
        <BotaoAba
          ativo={aba === "cadeia"}
          onClick={() => setAba("cadeia")}
          icone={<ListTree className="size-4" aria-hidden />}
        >
          Cadeia
        </BotaoAba>
        <BotaoAba
          ativo={aba === "screening"}
          onClick={() => setAba("screening")}
          icone={<Sparkles className="size-4" aria-hidden />}
        >
          Triagem automática
        </BotaoAba>
      </div>

      {aba === "cadeia" ? <CadeiaCliente /> : <ScreeningCliente />}
    </div>
  );
}

function BotaoAba({
  ativo,
  onClick,
  icone,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativo}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        ativo
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icone}
      {children}
    </button>
  );
}
