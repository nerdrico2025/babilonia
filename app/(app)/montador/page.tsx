import { DisclaimerNota } from "@/components/disclaimer";
import { Pagina, PaginaCabecalho } from "@/components/layout/pagina";

import { MontadorWizard } from "./montador-wizard";

/** Tela 6 (§14, §8.4): Montador de estruturas — wizard, risco-first, payoff. */
export default function MontadorPage() {
  return (
    <Pagina>
      <PaginaCabecalho
        sobretitulo="Tela 6 · Montador"
        titulo="Montador de estruturas"
        descricao="Monte travas, borboletas, condores, straddle/strangle e venda coberta — com o risco máximo sempre em primeiro lugar e o payoff visual."
      />

      <DisclaimerNota className="mb-6" />

      <MontadorWizard />
    </Pagina>
  );
}
