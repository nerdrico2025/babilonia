/**
 * Configuração base do Auth.js (NextAuth) — parte EDGE-SAFE (§13 do PRD).
 *
 * Este arquivo NÃO importa o provider Credentials (que usa `node:crypto`), para
 * poder rodar no `proxy.ts` (middleware do Next 16, runtime edge). A definição
 * completa, com o provider, fica em `auth.ts` (runtime Node).
 *
 * App mono-usuário: o login só protege o ACESSO ao app. Nenhuma chave de API
 * trafega por aqui — elas permanecem server-only nas rotas `app/api/` (§5.1).
 */
import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  // Tela de login personalizada (§14, tela 1). Quem não está logado é
  // redirecionado para cá automaticamente pelo callback `authorized`.
  pages: {
    signIn: "/login",
  },
  // Sessão por JWT (sem tabela de sessão no banco): suficiente e simples para
  // um único usuário, e compatível com o runtime edge do proxy.
  session: {
    strategy: "jwt",
  },
  callbacks: {
    /**
     * Decide o acesso a cada rota que passa pelo proxy. Retornar `false` faz o
     * NextAuth redirecionar para `pages.signIn` (/login).
     */
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLogin = nextUrl.pathname.startsWith("/login");

      if (isOnLogin) {
        // Já logado tentando ver /login → manda para o dashboard.
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true; // Deslogado pode ver a tela de login.
      }

      // Qualquer outra rota (telas do app + api/) exige sessão.
      return isLoggedIn;
    },
  },
  providers: [], // Preenchido em `auth.ts` (Credentials, runtime Node).
} satisfies NextAuthConfig;
