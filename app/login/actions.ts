"use server";

/**
 * Server Action de login (§14, tela 1). Roda só no servidor — as credenciais
 * nunca passam por código de cliente além do POST do formulário.
 */
import { AuthError } from "next-auth";

import { signIn } from "@/auth";

export type LoginState = { error?: string };

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  try {
    // Em sucesso, `signIn` lança um redirect (NEXT_REDIRECT) para "/".
    await signIn("credentials", {
      username: formData.get("username"),
      password: formData.get("password"),
      redirectTo: "/",
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      // Mensagem genérica para leigos (§2) — não revela qual campo falhou.
      return { error: "Usuário ou senha inválidos. Tente novamente." };
    }
    // Redirect e demais erros do framework devem propagar.
    throw error;
  }
}
