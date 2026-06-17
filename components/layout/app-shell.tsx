"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";

import { DisclaimerBar } from "@/components/disclaimer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { NAV, itemAtivo } from "./navegacao";

/**
 * Casca visual do app (§14): navegação entre as telas, identidade da marca e o
 * disclaimer sempre presente. É um Client Component porque precisa do pathname
 * (item ativo) e do estado do menu mobile.
 *
 * O `sair` é uma Server Action recebida do layout (server) — assim o logout
 * continua server-only, mas o botão vive aqui na casca.
 */
export function AppShell({
  userName,
  sair,
  children,
}: {
  userName: string | null;
  sair: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      {/* ── Sidebar (desktop) ─────────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Marca />
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV.map((item) => (
            <LinkNav
              key={item.href}
              item={item}
              ativo={itemAtivo(item.href, pathname)}
            />
          ))}
        </nav>
        <RodapeUsuario userName={userName} sair={sair} />
      </aside>

      {/* ── Top bar (mobile) ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-sidebar-border bg-sidebar/95 px-4 py-3 backdrop-blur-sm lg:hidden">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setMenuAberto(false)}>
          <Glifo />
          <span className="font-heading text-lg font-semibold tracking-tight">
            Babilônia
          </span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
          aria-expanded={menuAberto}
          onClick={() => setMenuAberto((v) => !v)}
        >
          {menuAberto ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </header>

      {/* Menu mobile (painel deslizante simples) */}
      {menuAberto && (
        <div className="border-b border-sidebar-border bg-sidebar px-3 py-3 lg:hidden">
          <nav className="space-y-1">
            {NAV.map((item) => (
              <LinkNav
                key={item.href}
                item={item}
                ativo={itemAtivo(item.href, pathname)}
                onClick={() => setMenuAberto(false)}
              />
            ))}
          </nav>
          <div className="mt-3 border-t border-sidebar-border pt-3">
            <RodapeUsuario userName={userName} sair={sair} compacto />
          </div>
        </div>
      )}

      {/* ── Conteúdo ──────────────────────────────────────────────────────── */}
      <div className="flex min-h-full flex-1 flex-col lg:pl-64">
        <main className="flex-1">{children}</main>
        <DisclaimerBar />
      </div>
    </div>
  );
}

/** Marca no topo da sidebar: glifo lápis/dourado + nome + tagline para leigos. */
function Marca() {
  return (
    <div className="border-b border-sidebar-border px-5 py-5">
      <Link href="/" className="flex items-center gap-3">
        <Glifo />
        <div className="flex flex-col leading-none">
          <span className="font-heading text-xl font-semibold tracking-tight">
            Babilônia
          </span>
          <span className="mt-1 text-[11px] text-muted-foreground">
            Opções da B3, explicado.
          </span>
        </div>
      </Link>
    </div>
  );
}

/** Glifo da marca: ladrilho lápis-lazúli com um ponto dourado (aceno babilônico). */
function Glifo() {
  return (
    <span
      aria-hidden
      className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary shadow-sm ring-1 ring-inset ring-white/10"
    >
      <span className="size-2.5 rounded-full bg-dourado" />
      <span className="absolute inset-0 rounded-md ring-1 ring-dourado/30" />
    </span>
  );
}

/** Um item de navegação com estado ativo (barra lápis à esquerda). */
function LinkNav({
  item,
  ativo,
  onClick,
}: {
  item: (typeof NAV)[number];
  ativo: boolean;
  onClick?: () => void;
}) {
  const Icone = item.icone;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={ativo ? "page" : undefined}
      title={item.descricao}
      className={cn(
        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        ativo
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
      )}
    >
      {/* Marcador lápis do item ativo. */}
      <span
        aria-hidden
        className={cn(
          "absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary transition-opacity",
          ativo ? "opacity-100" : "opacity-0",
        )}
      />
      <Icone className="size-4 shrink-0" aria-hidden />
      <span>{item.rotulo}</span>
    </Link>
  );
}

/** Rodapé com o usuário logado e o botão Sair (Server Action). */
function RodapeUsuario({
  userName,
  sair,
  compacto = false,
}: {
  userName: string | null;
  sair: () => Promise<void>;
  compacto?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", compacto ? "" : "border-t border-sidebar-border px-4 py-3")}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground uppercase">
          {(userName ?? "?").slice(0, 1)}
        </span>
        <span className="truncate text-sm font-medium">{userName ?? "Você"}</span>
      </div>
      <form action={sair}>
        <Button type="submit" variant="ghost" size="sm" aria-label="Sair">
          <LogOut className="size-4" />
          <span className="sr-only sm:not-sr-only">Sair</span>
        </Button>
      </form>
    </div>
  );
}
