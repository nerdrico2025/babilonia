"use client";

import { Info, LineChart, TrendingDown, TrendingUp } from "lucide-react";

import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AnaliseTecnica, DirecaoCruzamento } from "@/lib/analise-tecnica/tipos";
import { formatPreco } from "@/lib/format";
import { cn } from "@/lib/utils";

import { FrescorBadge, fmtNum, Indicador, LeituraBox } from "./analise-ui";
import type { Frescor, PrecoAtivoEod } from "./tipos";

/** Data ISO → "DD/MM/AAAA" (UTC, para não escorregar de dia por fuso). */
function fmtDataPregao(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).format(d);
}

/** ISO → "DD/MM" curto (para datar um nível de suporte/resistência). */
function fmtDiaMes(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "UTC",
      }).format(d);
}

const preco = (v: number | null) => (v == null ? "—" : formatPreco(v));

/** Chip colorido de cruzamento (alta = verde, baixa = vermelho). */
function CruzamentoChip({
  par,
  dir,
}: {
  par: string;
  dir: DirecaoCruzamento | null;
}) {
  if (!dir) return null;
  const alta = dir === "cima";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        alta ? "bg-risco-ok/15 text-risco-ok" : "bg-risco-perigo/15 text-risco-perigo",
      )}
    >
      {alta ? (
        <TrendingUp className="size-3" aria-hidden />
      ) : (
        <TrendingDown className="size-3" aria-hidden />
      )}
      {par}: cruzamento de {alta ? "alta" : "baixa"}
    </span>
  );
}

/** Uma subseção de indicador: título, métricas e leitura didática. */
function SubBloco({
  titulo,
  children,
  leitura,
}: {
  titulo: React.ReactNode;
  children: React.ReactNode;
  leitura: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {children}
      <LeituraBox>{leitura}</LeituraBox>
    </section>
  );
}

// ── Leituras didáticas (explicam o indicador ANTES de interpretar o valor) ─────
// Regra §2: nunca "compre/venda/é hora de" — só cenário ("tende a", "costuma").

function leituraMedias(t: AnaliseTecnica): React.ReactNode {
  const { medias, precoAtual } = t;
  const rel = (mm: number | null, nome: string) =>
    mm == null ? null : `${precoAtual > mm ? "acima" : "abaixo"} da ${nome}`;
  const curto = rel(medias.mm21, "média de 21");
  const longo = rel(medias.mm200, "média de 200");
  const partes = [curto, longo].filter(Boolean).join(" e ");

  return (
    <>
      <p>
        Uma <TermoTecnico termo="media-movel">média móvel</TermoTecnico> é a média
        dos fechamentos dos últimos N pregões: ela suaviza o vaivém do dia a dia e
        ajuda a enxergar a tendência. As curtas (9 e 21 pregões) reagem rápido ao
        preço; as longas (50 e 200) mostram o rumo de fundo.
      </p>
      {partes && (
        <p>
          Hoje o preço ({formatPreco(precoAtual)}) está {partes} — quando o preço se
          mantém acima das médias, costuma indicar predomínio de força compradora; o
          contrário sugere fraqueza. Não é uma garantia de continuidade.
        </p>
      )}
      <p>
        Um{" "}
        <TermoTecnico termo="cruzamento-medias">cruzamento de alta</TermoTecnico>{" "}
        acontece quando uma média curta passa acima de uma mais longa (os preços
        recentes superaram a referência mais lenta); o de baixa, o contrário.{" "}
        {medias.cruzamento9x21 || medias.cruzamento50x200 ? (
          <>
            Aqui houve um cruzamento recente
            {medias.cruzamento9x21
              ? ` de ${medias.cruzamento9x21 === "cima" ? "alta" : "baixa"} entre a 9 e a 21`
              : ""}
            {medias.cruzamento9x21 && medias.cruzamento50x200 ? " e" : ""}
            {medias.cruzamento50x200
              ? ` de ${medias.cruzamento50x200 === "cima" ? "alta" : "baixa"} entre a 50 e a 200`
              : ""}
            . Historicamente esse padrão tende a chamar atenção para uma possível
            mudança de tendência, mas falha com frequência.
          </>
        ) : (
          "No momento não há cruzamento recente entre as médias acompanhadas."
        )}
      </p>
    </>
  );
}

function leituraRsi(t: AnaliseTecnica): React.ReactNode {
  const v = t.rsi14;
  const zona =
    v == null
      ? null
      : v >= 70
        ? "na zona de sobrecompra — o preço subiu rápido e o movimento pode estar esticado, ficando mais sujeito a uma pausa ou correção"
        : v <= 30
          ? "na zona de sobrevenda — a queda pode ter ido longe demais, e o movimento também pode estar esticado para baixo"
          : "na faixa neutra (entre 30 e 70), sem indício de exagero para cima nem para baixo";
  return (
    <>
      <p>
        O <TermoTecnico termo="rsi">RSI</TermoTecnico> mede a velocidade e a força
        dos movimentos de preço numa escala de 0 a 100. Acima de 70 costuma indicar
        uma fase de "sobrecompra"; abaixo de 30, de "sobrevenda"; no meio, equilíbrio.
        Nada disso é garantia — é um termômetro de contexto, não um gatilho.
      </p>
      {v != null && (
        <p>
          Agora o RSI está em {fmtNum(v, 0)}, {zona}.
        </p>
      )}
    </>
  );
}

function leituraMacd(t: AnaliseTecnica): React.ReactNode {
  const { macd } = t;
  const h = macd.histograma;
  const estado =
    h == null
      ? null
      : h > 0
        ? "positivo, indicando momentum de curto prazo comprador (a média rápida está acima da lenta)"
        : h < 0
          ? "negativo, indicando momentum de curto prazo vendedor (a média rápida está abaixo da lenta)"
          : "praticamente zerado, com momentum neutro";
  return (
    <>
      <p>
        O <TermoTecnico termo="macd">MACD</TermoTecnico> mede o{" "}
        <TermoTecnico termo="momentum">momentum</TermoTecnico> — a força e a direção
        do movimento — comparando duas médias exponenciais (de 12 e 26 pregões). A
        linha de sinal (9) serve de gatilho de comparação, e o histograma mostra a
        distância entre as duas.
      </p>
      {estado && (
        <p>
          Agora o histograma está {estado}.
          {macd.cruzamento
            ? ` Houve um cruzamento recente da linha com o sinal para ${
                macd.cruzamento === "cima" ? "cima" : "baixo"
              }, o que costuma marcar uma troca de momentum — sem garantia de que se confirme.`
            : ""}
        </p>
      )}
    </>
  );
}

function leituraSuporteResistencia(t: AnaliseTecnica): React.ReactNode {
  const { suporte, resistencia } = t.suporteResistencia;
  return (
    <>
      <p>
        <TermoTecnico termo="suporte-resistencia">Suporte e resistência</TermoTecnico>{" "}
        são faixas de preço observadas no histórico recente (até cerca de 1 ano):
        suporte é onde a queda costuma encontrar compradores; resistência, onde a
        alta costuma encontrar vendedores. São referências de onde o preço "respira",
        não barreiras mágicas.
      </p>
      <p>
        Em relação ao preço atual ({formatPreco(t.precoAtual)}):{" "}
        {suporte
          ? `o suporte mais próximo abaixo está em ${formatPreco(suporte.preco)} (pico de ${fmtDiaMes(suporte.data)})`
          : "não há suporte identificado abaixo no histórico recente"}
        {"; "}
        {resistencia
          ? `a resistência mais próxima acima está em ${formatPreco(resistencia.preco)} (pico de ${fmtDiaMes(resistencia.data)})`
          : "não há resistência identificada acima no histórico recente"}
        .
      </p>
    </>
  );
}

/**
 * Bloco 1 — Técnico (§8.2). O preço/variação/volume vêm do COTAHIST (fechamento
 * EOD), não de cotação ao vivo — por isso o aviso datado (§6.2). Os indicadores
 * (médias, RSI, MACD, suporte/resistência) vêm PRONTOS de `analisarTecnico` (T3),
 * calculados sobre o MESMO fechamento — a UI só formata e explica, não recalcula.
 */
export function BlocoTecnico({
  preco: p,
  tecnica,
  frescor,
}: {
  preco: PrecoAtivoEod;
  tecnica: AnaliseTecnica | null;
  frescor: Frescor;
}) {
  const subiu = (p.variacao ?? 0) >= 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LineChart className="size-4 text-primary" aria-hidden />
          Técnico
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>Preço, médias, momentum e zonas-chave.</span>
          <FrescorBadge frescor={frescor} />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* Preço de FECHAMENTO (COTAHIST/EOD). */}
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="font-heading text-2xl font-semibold tabular">
            {formatPreco(p.preco)}
          </span>
          {p.variacao != null && (
            <span className={subiu ? "text-risco-ok" : "text-risco-perigo"}>
              {subiu ? "+" : ""}
              {fmtNum(p.variacao)}
              {p.variacaoPercent != null ? ` (${fmtNum(p.variacaoPercent)}%)` : ""}
            </span>
          )}
          <span className="text-sm text-muted-foreground">
            <TermoTecnico termo="volume">Volume</TermoTecnico> do pregão:{" "}
            {p.volume != null ? p.volume.toLocaleString("pt-BR") : "—"}
          </span>
        </div>

        {/* Aviso EOD (§6.2): o dado é do fechamento, não ao vivo. */}
        <div className="flex items-start gap-2 rounded-lg border border-risco-alerta/40 bg-risco-alerta/10 px-3 py-2 text-sm text-risco-alerta">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Preço de fechamento de {fmtDataPregao(p.dataPregao)} — confira a cotação
            atual na sua corretora antes de montar a operação.
          </span>
        </div>

        {tecnica == null ? (
          /* Histórico insuficiente: mensagem neutra (não esconde, não erra). */
          <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3 text-sm text-muted-foreground">
            Ainda não há histórico de fechamentos suficiente para calcular os
            indicadores técnicos (médias móveis, RSI, MACD e zonas de
            suporte/resistência) deste ativo. Conforme mais pregões forem ingeridos,
            eles aparecem aqui automaticamente.
          </div>
        ) : (
          <>
            <p className="-mt-2 text-xs text-muted-foreground">
              Indicadores calculados sobre o fechamento de{" "}
              {fmtDataPregao(tecnica.dataReferencia)} ({tecnica.pontos} pregões de
              histórico) — a mesma data do preço acima.
            </p>

            {/* Médias móveis. */}
            <SubBloco
              titulo="Médias móveis"
              leitura={leituraMedias(tecnica)}
            >
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Indicador
                    rotulo={<TermoTecnico termo="media-movel">MM 9</TermoTecnico>}
                    valor={preco(tecnica.medias.mm9)}
                  />
                  <Indicador
                    rotulo={<TermoTecnico termo="media-movel">MM 21</TermoTecnico>}
                    valor={preco(tecnica.medias.mm21)}
                  />
                  <Indicador
                    rotulo={<TermoTecnico termo="media-movel">MM 50</TermoTecnico>}
                    valor={preco(tecnica.medias.mm50)}
                  />
                  <Indicador
                    rotulo={<TermoTecnico termo="media-movel">MM 200</TermoTecnico>}
                    valor={preco(tecnica.medias.mm200)}
                  />
                </div>
                {(tecnica.medias.cruzamento9x21 || tecnica.medias.cruzamento50x200) && (
                  <div className="flex flex-wrap gap-2">
                    <CruzamentoChip par="9×21" dir={tecnica.medias.cruzamento9x21} />
                    <CruzamentoChip par="50×200" dir={tecnica.medias.cruzamento50x200} />
                  </div>
                )}
              </div>
            </SubBloco>

            {/* RSI. */}
            <SubBloco
              titulo={<TermoTecnico termo="rsi">RSI (14)</TermoTecnico>}
              leitura={leituraRsi(tecnica)}
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Indicador rotulo="RSI (14)" valor={fmtNum(tecnica.rsi14, 0)} />
              </div>
            </SubBloco>

            {/* MACD. */}
            <SubBloco
              titulo={<TermoTecnico termo="macd">MACD (12, 26, 9)</TermoTecnico>}
              leitura={leituraMacd(tecnica)}
            >
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Indicador rotulo="Linha" valor={fmtNum(tecnica.macd.linha, 3)} />
                  <Indicador rotulo="Sinal" valor={fmtNum(tecnica.macd.sinal, 3)} />
                  <Indicador
                    rotulo="Histograma"
                    valor={fmtNum(tecnica.macd.histograma, 3)}
                  />
                </div>
                {tecnica.macd.cruzamento && (
                  <div className="flex flex-wrap gap-2">
                    <CruzamentoChip par="linha×sinal" dir={tecnica.macd.cruzamento} />
                  </div>
                )}
              </div>
            </SubBloco>

            {/* Suporte / resistência. */}
            <SubBloco
              titulo={
                <TermoTecnico termo="suporte-resistencia">
                  Suporte e resistência
                </TermoTecnico>
              }
              leitura={leituraSuporteResistencia(tecnica)}
            >
              <div className="grid grid-cols-2 gap-2">
                <Indicador
                  rotulo="Resistência acima"
                  valor={preco(tecnica.suporteResistencia.resistencia?.preco ?? null)}
                />
                <Indicador
                  rotulo="Suporte abaixo"
                  valor={preco(tecnica.suporteResistencia.suporte?.preco ?? null)}
                />
              </div>
            </SubBloco>
          </>
        )}
      </CardContent>
    </Card>
  );
}
