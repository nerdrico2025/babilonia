import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar — Babilônia",
};

/**
 * Tela 1 (§14): Login — acesso único. Layout simples e centralizado; toda a
 * lógica de autenticação fica na Server Action `login` (server-only).
 */
export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-6 dark:bg-black">
      <LoginForm />
    </main>
  );
}
