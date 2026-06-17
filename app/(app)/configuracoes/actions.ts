"use server";

/**
 * Server Actions da tela de Configurações (tela 3, §7, §14).
 *
 * Persistem em `settings` (capital total + preferências de exibição) e na
 * `watchlist` (ativos-objeto acompanhados). Tudo server-only: as chaves de API
 * NUNCA passam por aqui nem chegam ao cliente (§5.1).
 *
 * Como o capital total é a base de TODAS as regras de risco (§10), ao salvá-lo
 * revalidamos o dashboard (`/`) para os indicadores do book recalcularem.
 *
 * Degradação graciosa (§2.6): falha de banco vira `{ ok:false, erro }` legível.
 */

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { settings, watchlist } from "@/db/schema";
import { capitalSchema, tickerAtivoSchema, TEMAS } from "@/lib/settings";

/** Estado devolvido às telas (mensagem de sucesso/erro para o usuário). */
export interface EstadoConfig {
  ok?: boolean;
  erro?: string;
  mensagem?: string;
}

// Aceita capital em pt-BR ("50.000,00") ou simples ("50000.5").
function parseCapital(bruto: string): number | null {
  const t = bruto.trim();
  if (t === "") return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const salvarSchema = z.object({
  capital: z.number(),
  tema: z.enum(TEMAS),
});

/**
 * Salva capital total + preferências de exibição. Faz upsert na linha única de
 * `settings` (app mono-usuário), grava o tema também num cookie (para o layout
 * aplicar sem tocar no banco) e revalida o dashboard.
 */
export async function salvarConfiguracoes(
  _prev: EstadoConfig,
  formData: FormData,
): Promise<EstadoConfig> {
  const capital = parseCapital(String(formData.get("capital") ?? ""));
  const tema = String(formData.get("tema") ?? "");

  // Validação (Zod) — risco antes de gravar.
  const capValid = capitalSchema.safeParse(capital);
  const parsed = salvarSchema.safeParse({ capital: capValid.success ? capValid.data : NaN, tema });
  if (!capValid.success) {
    return { ok: false, erro: capValid.error.issues[0]?.message ?? "Capital inválido." };
  }
  if (!parsed.success) {
    return { ok: false, erro: "Preferências inválidas." };
  }

  try {
    const db = getDb();
    const linhas = await db.select({ id: settings.id }).from(settings).limit(1);
    const valores = {
      totalCapital: parsed.data.capital.toFixed(2),
      displayPreferences: { tema: parsed.data.tema },
      updatedAt: new Date(),
    };

    if (linhas[0]) {
      await db.update(settings).set(valores).where(eq(settings.id, linhas[0].id));
    } else {
      await db.insert(settings).values(valores);
    }

    // Cookie lido pelo root layout para aplicar o tema (sem depender do banco).
    (await cookies()).set("tema", parsed.data.tema, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });

    // Capital mudou → indicadores do book recalculam no dashboard.
    revalidatePath("/");
    revalidatePath("/configuracoes");

    return { ok: true, mensagem: "Configurações salvas. Os indicadores do book foram recalculados." };
  } catch {
    return {
      ok: false,
      erro: "Não foi possível salvar agora (banco indisponível). Tente novamente.",
    };
  }
}

/** Adiciona um ativo à watchlist (ignora duplicado — símbolo é único). */
export async function adicionarAtivo(
  _prev: EstadoConfig,
  formData: FormData,
): Promise<EstadoConfig> {
  const parsed = tickerAtivoSchema.safeParse(String(formData.get("symbol") ?? ""));
  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? "Ticker inválido." };
  }

  try {
    const db = getDb();
    await db
      .insert(watchlist)
      .values({ symbol: parsed.data })
      .onConflictDoNothing({ target: watchlist.symbol });
    revalidatePath("/configuracoes");
    return { ok: true, mensagem: `${parsed.data} adicionado à watchlist.` };
  } catch {
    return { ok: false, erro: "Não foi possível adicionar o ativo agora." };
  }
}

/** Remove um ativo da watchlist pelo símbolo. */
export async function removerAtivo(formData: FormData): Promise<void> {
  const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) return;
  try {
    const db = getDb();
    await db.delete(watchlist).where(eq(watchlist.symbol, symbol));
    revalidatePath("/configuracoes");
  } catch {
    // Falha silenciosa: a tela permanece; o usuário pode tentar de novo.
  }
}
