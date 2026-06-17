import { CalendarClock, Inbox, PieChart, TrendingUp, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { DisclaimerNota } from "@/components/disclaimer";
import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import { Pagina, PaginaCabecalho } from "@/components/layout/pagina";
import { Semaforo, type NivelRisco } from "@/components/risco/semaforo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { carregarBook, type ResultadoBook } from "@/db/queries";
import { avaliarVencimento, diasUteisAteVencimento, resumirBook } from "@/lib/book";
import { formatBRL, formatPct } from "@/lib/format";
import type { Semaforo as SemaforoCor } from "@/lib/risk-rules";

import { PosicoesLista, type PosicaoView } from "./posicoes-lista";

// O ramo de sucesso da leitura do book (posições + capital).
type BookOk = Extract<ResultadoBook, { ok: true }>;

// Converte a cor do semáforo (risk-rules) no nível visual do componente.
const NIVEL_POR_COR: Record<SemaforoCor, NivelRisco> = {
  verde: "ok",
  amarelo: "alerta",
  vermelho: "perigo",
};

function fmtData(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * Tela 2 (§8.1): Dashboard / Book. Server Component — lê o book persistido e o
 * capital, computa os indicadores de risco com `lib/book` (que reusa `risk-rules`)
 * e os apresenta com semáforo. Risco antes do ganho (§2). Degrada com aviso se o
 * banco não estiver disponível, e mostra um estado inicial amigável se o book
 * estiver vazio.
 */
export default async function DashboardPage() {
  const book = await carregarBook();

  return (
    <Pagina>
      <PaginaCabecalho
        sobretitulo="Tela 2 · Book"
        titulo="Seu painel"
        descricao="A visão geral das suas operações com opções: quanto do capital está em risco, concentração e os vencimentos que se aproximam — sempre com o risco em primeiro plano."
      />

      {!book.ok ? (
        // Banco indisponível: não quebra a tela (§2.6/§6.3).
        <div className="flex items-start gap-2 rounded-lg border border-risco-alerta/40 bg-risco-alerta-suave px-3.5 py-3 text-sm text-risco-alerta">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Não foi possível carregar o book agora. Verifique a conexão com o banco
            e recarregue a página.
          </span>
        </div>
      ) : (
        <ConteudoBook book={book} />
      )}

      <div className="mt-6">
        <DisclaimerNota />
      </div>
    </Pagina>
  );
}

function ConteudoBook({ book }: { book: BookOk }) {
  const { capitalTotal, posicoes } = book;
  const resumo = resumirBook(posicoes, capitalTotal);

  // Book vazio: estado inicial amigável (§8.1 item 5).
  if (resumo.quantidade === 0) {
    return (
      <Card className="mt-2">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Inbox className="size-6" aria-hidden />
          </span>
          <div>
            <p className="font-heading text-lg font-semibold">Seu book está vazio</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Quando você montar e registrar uma operação, ela aparece aqui com o{" "}
              <strong className="text-foreground">risco em primeiro lugar</strong>, a
              concentração e os alertas de{" "}
              <TermoTecnico termo="vencimento">vencimento</TermoTecnico>.
            </p>
          </div>
          <Button render={<Link href="/montador" />}>Montar a primeira operação</Button>
        </CardContent>
      </Card>
    );
  }

  // Posições serializáveis para o client (datas em ISO, dias úteis calculados).
  const posicoesView: PosicaoView[] = posicoes.map((p) => ({
    id: p.id,
    underlying: p.underlying,
    structure: p.structure,
    expiresAtISO: p.expiresAt.toISOString(),
    diasUteis: diasUteisAteVencimento(p),
    maxRisk: p.maxRisk,
    maxGain: p.maxGain,
    riskDefined: p.riskDefined,
    breakevens: p.breakevens,
    pernas: p.pernas,
  }));

  // Posições com vencimento próximo (semáforo não-verde), para o bloco de alertas.
  const alertas = posicoesView
    .map((p) => ({ p, venc: avaliarVencimento(p.diasUteis) }))
    .filter((x) => x.venc.semaforo !== "verde")
    .sort((a, b) => a.p.diasUteis - b.p.diasUteis);

  return (
    <div className="flex flex-col gap-6">
      {/* Visão geral rápida do book. */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10">
        <span>
          <strong>{resumo.quantidade}</strong> posição(ões) aberta(s)
        </span>
        <span className="text-muted-foreground">
          Risco total em aberto:{" "}
          <strong className="text-foreground tabular">{formatBRL(resumo.riscoTotal)}</strong>
          {resumo.temIndefinido && " (inclui risco indefinido)"}
        </span>
        {resumo.vencimentoMaisProximo && (
          <span className="text-muted-foreground">
            Vencimento mais próximo:{" "}
            <strong className="text-foreground">{fmtData(resumo.vencimentoMaisProximo)}</strong>
            {resumo.diasAteVencimentoMaisProximo != null &&
              ` (${resumo.diasAteVencimentoMaisProximo} dia(s) úteis)`}
          </span>
        )}
      </div>

      {/* Cartões de indicadores de risco com semáforo (§8.1, §10). */}
      <div className="grid gap-4 sm:grid-cols-3">
        <CartaoIndicador
          icone={<PieChart className="size-4" />}
          titulo="Capital em risco"
          valor={resumo.fracaoCapital != null ? formatPct(resumo.fracaoCapital) : "—"}
          detalhe={
            resumo.fracaoCapital != null
              ? `${formatBRL(resumo.riscoTotal)} do seu capital`
              : "Configure o capital total em Configurações."
          }
          nivel={NIVEL_POR_COR[resumo.semaforoCapital]}
        />
        <CartaoIndicador
          icone={<TrendingUp className="size-4" />}
          titulo="Concentração por ativo"
          valor={resumo.concentracaoAtivo ? formatPct(resumo.concentracaoAtivo.fracao) : "—"}
          detalhe={
            resumo.concentracaoAtivo
              ? `Maior peso: ${resumo.concentracaoAtivo.chave} (limite 20%)`
              : "Sem posições."
          }
          nivel={NIVEL_POR_COR[resumo.semaforoConcentracaoAtivo]}
        />
        <CartaoIndicador
          icone={<CalendarClock className="size-4" />}
          titulo="Concentração por vencimento"
          valor={
            resumo.concentracaoVencimento ? formatPct(resumo.concentracaoVencimento.fracao) : "—"
          }
          detalhe={
            resumo.concentracaoVencimento
              ? `Maior peso: ${fmtData(resumo.concentracaoVencimento.chave)} (limite 30%)`
              : "Sem posições."
          }
          nivel={NIVEL_POR_COR[resumo.semaforoConcentracaoVencimento]}
        />
      </div>

      {/* Alertas de vencimento (§8.1 item 3). */}
      {alertas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-risco-alerta" aria-hidden />
              Alertas de <TermoTecnico termo="vencimento">vencimento</TermoTecnico>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {alertas.map(({ p, venc }) => (
              <div key={p.id} className="flex items-start gap-2.5 text-sm">
                <Semaforo
                  nivel={NIVEL_POR_COR[venc.semaforo]}
                  mostrarRotulo={false}
                  className="mt-0.5"
                />
                <span>
                  <strong>{p.underlying}</strong> · vence {fmtData(new Date(p.expiresAtISO))} —{" "}
                  <span className="text-muted-foreground">{venc.sugestao}</span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Lista de posições (interativa: expandir + revisar). */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Posições abertas</h2>
        <PosicoesLista posicoes={posicoesView} capitalTotal={capitalTotal} />
      </section>
    </div>
  );
}

function CartaoIndicador({
  icone,
  titulo,
  valor,
  detalhe,
  nivel,
}: {
  icone: React.ReactNode;
  titulo: string;
  valor: string;
  detalhe: string;
  nivel: NivelRisco;
}) {
  return (
    <Card>
      <CardHeader className="gap-1.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted-foreground">
            {icone}
            <CardTitle className="text-sm font-medium">{titulo}</CardTitle>
          </span>
          <Semaforo nivel={nivel} mostrarRotulo={false} />
        </div>
      </CardHeader>
      <CardContent>
        <p className="font-heading text-2xl font-semibold tabular">{valor}</p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{detalhe}</p>
      </CardContent>
    </Card>
  );
}
