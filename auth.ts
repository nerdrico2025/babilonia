/**
 * Auth.js (NextAuth) — definição completa, runtime Node (§13 do PRD).
 *
 * App mono-usuário: um único par usuário/senha vindo de env vars server-only
 * (`AUTH_USERNAME` / `AUTH_PASSWORD`). Sem cadastro, sem banco de usuários —
 * o mais simples e seguro para 1 pessoa.
 *
 * A comparação é feita em tempo constante (`timingSafeEqual`) para não vazar
 * informação por timing. O segredo de sessão vem de `AUTH_SECRET` (lido
 * automaticamente pelo NextAuth).
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { authConfig } from "@/auth.config";

/** Comparação em tempo constante; falsa de imediato se os tamanhos diferem. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Usuário e senha",
      credentials: {
        username: { label: "Usuário", type: "text" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const expectedUser = process.env.AUTH_USERNAME ?? "";
        const expectedPass = process.env.AUTH_PASSWORD ?? "";
        // Sem credenciais configuradas no servidor → ninguém entra.
        if (!expectedUser || !expectedPass) return null;

        const { username, password } = parsed.data;
        // Avalia as duas comparações sempre (sem short-circuit) p/ não vazar
        // por timing qual dos campos estava errado.
        const userOk = safeEqual(username, expectedUser);
        const passOk = safeEqual(password, expectedPass);
        if (!userOk || !passOk) return null;

        // Identidade única do dono do app.
        return { id: "owner", name: expectedUser };
      },
    }),
  ],
});
