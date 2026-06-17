import { Pagina, PaginaCabecalho } from "@/components/layout/pagina";

import { AnaliseCliente } from "./analise-cliente";

/** Tela 4 (§14, §8.2, §9): Análise de ativo — técnico, fundamentalista, volatilidade. */
export default function AnalisePage() {
  return (
    <Pagina>
      <PaginaCabecalho
        sobretitulo="Tela 4 · Ativo-objeto"
        titulo="Análise de ativo"
        descricao="Busque um ticker para ver preço, fundamentos e o quadro de volatilidade — a base para escolher uma estrutura com opções. É informação, nunca recomendação."
      />
      <AnaliseCliente />
    </Pagina>
  );
}
