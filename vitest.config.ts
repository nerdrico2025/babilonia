import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Configuração de testes do Babilônia.
 *
 * Foco principal: o módulo `lib/options-math` (núcleo puro e testável — ver §5.1
 * do PRD). Ambiente jsdom + plugin React já ficam prontos para testes de
 * componentes na Fase 2, sem reconfiguração.
 */
export default defineConfig({
  plugins: [react()],
  // Resolução nativa do Vite para os paths do tsconfig (alias "@/").
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
    // Timeout global de 15 s: os testes de "banco real" (Neon serverless) sofrem
    // com cold start e latência de rede — 5 s estoura sem haver falha de lógica.
    testTimeout: 15000,
    // Isola cada arquivo em seu próprio processo (fork): o cold start da conexão
    // Neon de um arquivo não bloqueia os outros.
    pool: "forks",
  },
});
