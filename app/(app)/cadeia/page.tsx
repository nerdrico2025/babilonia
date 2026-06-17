import { Pagina, PaginaCabecalho } from "@/components/layout/pagina";

import { CadeiaCliente } from "./cadeia-cliente";

/** Tela 5 (§14, §8.3): Cadeia de opções — tabela com filtro de liquidez. */
export default function CadeiaPage() {
  return (
    <Pagina>
      <PaginaCabecalho
        sobretitulo="Tela 5 · Cadeia"
        titulo="Cadeia de opções"
        descricao="Calls e puts por strike e vencimento, com alerta de liquidez para garantir que a ordem seja executável no home broker. Selecione séries e leve direto ao montador."
      />
      <CadeiaCliente />
    </Pagina>
  );
}
