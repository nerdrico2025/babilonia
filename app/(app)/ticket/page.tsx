import { Pagina, PaginaCabecalho } from "@/components/layout/pagina";

import { TicketCliente } from "./ticket-cliente";

/** Tela 7 (§14, §8.6, §11): Ticket — preview + copiar + validações + registro. */
export default function TicketPage() {
  return (
    <Pagina>
      <PaginaCabecalho
        sobretitulo="Tela 7 · Ticket"
        titulo="Ticket de operação"
        descricao="O resumo padronizado da operação, pronto para você conferir e digitar a ordem manualmente no home broker."
      />
      <TicketCliente />
    </Pagina>
  );
}
