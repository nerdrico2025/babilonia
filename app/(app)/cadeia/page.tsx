import { Pagina, PaginaCabecalho } from "@/components/layout/pagina";

import { CadeiaTabs } from "./cadeia-tabs";

/** Tela 5 (§14, §8.3): Cadeia de opções — tabela com filtro de liquidez + triagem. */
export default function CadeiaPage() {
  return (
    <Pagina>
      <PaginaCabecalho
        sobretitulo="Tela 5 · Cadeia"
        titulo="Cadeia de opções"
        descricao="Calls e puts por strike e vencimento, com alerta de liquidez para garantir que a ordem seja executável no home broker. Selecione séries e leve direto ao montador, ou use a triagem automática para varrer a cadeia inteira."
      />
      <CadeiaTabs />
    </Pagina>
  );
}
