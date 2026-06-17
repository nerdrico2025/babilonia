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
  },
});
