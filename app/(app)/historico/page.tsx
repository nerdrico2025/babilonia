import { Inbox, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Pagina, PaginaCabecalho } from "@/components/layout/pagina";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { carregarHistorico } from "@/db/queries";
import { diasUteisAteVencimento } from "@/lib/book";

import { HistoricoCliente, type PosicaoHistoricoView } from "./historico-cliente";

/**
 * Tela 8 (§8, §3.1): Histórico / Diário. Server Component — lê TODAS as operações
 * persistidas (qualquer status) e o capital, calcula os dias úteis até o
 * vencimento (para a situação atual) e entrega a lista interativa ao cliente.
 * Degrada com aviso se o banco cair; estado inicial amigável se não houver nada.
 */
export default async function HistoricoPage() {
  const historico = await carregarHistorico();

  return (
    <Pagina>
      <PaginaCabecalho
        sobretitulo="Tela 8 · Diário"
        titulo="Histórico"
        descricao="O diário das suas operações montadas: o que foi aberto, encerrado ou rolado, com os tickets correspondentes. Reabra qualquer uma para gerar um ticket de ajuste."
      />

      {!historico.ok ? (
        <div className="flex items-start gap-2 rounded-lg border border-risco-alerta/40 bg-risco-alerta-suave px-3.5 py-3 text-sm text-risco-alerta">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Não foi possível carregar o histórico agora. Recarregue a página.</span>
        </div>
      ) : historico.posicoes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Inbox className="size-6" aria-hidden />
            </span>
            <div>
              <p className="font-heading text-lg font-semibold">Nenhuma operação no diário ainda</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Cada operação que você montar e registrar no ticket aparece aqui — com
                status, risco, ganho e o ticket gerado.
              </p>
            </div>
            <Button render={<Link href="/montador" />}>Montar uma operação</Button>
          </CardContent>
        </Card>
      ) : (
        <HistoricoCliente
          posicoes={historico.posicoes.map(
            (p): PosicaoHistoricoView => ({
              id: p.id,
              underlying: p.underlying,
              structure: p.structure,
              status: p.status,
              expiresAtISO: p.expiresAt.toISOString(),
              createdAtISO: p.createdAt.toISOString(),
              diasUteis: diasUteisAteVencimento({
                id: p.id,
                underlying: p.underlying,
                structure: p.structure,
                expiresAt: p.expiresAt,
                maxRisk: p.maxRisk,
                maxGain: p.maxGain,
                riskDefined: p.riskDefined,
                breakevens: p.breakevens,
              }),
              maxRisk: p.maxRisk,
              maxGain: p.maxGain,
              riskDefined: p.riskDefined,
              breakevens: p.breakevens,
              pernas: p.pernas,
              ticketContent: p.ticketContent,
              realizedPnl: p.realizedPnl,
              rolledIntoPositionId: p.rolledIntoPositionId,
            }),
          )}
          capitalTotal={historico.capitalTotal}
        />
      )}
    </Pagina>
  );
}
