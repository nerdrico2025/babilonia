/**
 * Validação de variáveis de ambiente com Zod (§13 do PRD).
 *
 * Todas as chaves são SERVER-ONLY (§5.1): nunca expor no cliente. Por isso este
 * módulo só deve ser importado em código de servidor (Route Handlers, Server
 * Actions). A validação é feita sob demanda via `getServerEnv()` para não
 * quebrar o build quando as variáveis ainda não existirem.
 */
import { z } from "zod";

const serverEnvSchema = z.object({
  BRAPI_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(1),
  AUTH_USERNAME: z.string().min(1),
  AUTH_PASSWORD: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/** Lê e valida o ambiente do servidor (lança erro claro se faltar variável). */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  cached = serverEnvSchema.parse(process.env);
  return cached;
}
