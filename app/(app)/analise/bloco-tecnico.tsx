"use client";

import { useMemo, useState } from "react";
import { LineChart } from "lucide-react";

import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatPreco } from "@/lib/format";
import { analisarTecnico, parseSerie } from "@/lib/analise/tecnico";
import type { BrapiCotacao } from "@/lib/integrations/brapi";

import { AreaColar, FrescorBadge, fmtNum, Indicador, LeituraIniciante } from "./analise-ui";
import type { Frescor } from "./tipos";

/**
 * Bloco 1 — Técnico (§8.2). A cotação ao vivo (preço/variação/volume) vem da
 * brapi; os indicadores (médias, RSI, MACD, suporte/resistência) são calculados
 * a partir do HISTÓRICO COLADO pelo usuário (o brapi Free não fornece histórico,
 * §6.1, §2.4). Encerra com a leitura de iniciante (§9).
 */
export function BlocoTecnico({
  cotacao,
  frescor,
}: {
  cotacao: BrapiCotacao;
  frescor: Frescor;
}) {
  const [closesText, setClosesText] = useState("");
  const [volumesText, setVolumesText] = useState("");

  const analise = useMemo(() => {
    const closes = parseSerie(closesText);
    const volumes = parseSerie(volumesText);
    return analisarTecnico(closes, {
      volumes: volumes.length > 0 ? volumes : undefined,
      precoAtual: cotacao.preco,
    });
  }, [closesText, volumesText, cotacao.preco]);

  const subiu = cotacao.variacao >= 0;

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
      <CardContent className="flex flex-col gap-4">
        {/* Cotação ao vivo (brapi). */}
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="font-heading text-2xl font-semibold tabular">
            {formatPreco(cotacao.preco)}
          </span>
          <span className={subiu ? "text-risco-ok" : "text-risco-perigo"}>
            {subiu ? "+" : ""}
            {fmtNum(cotacao.variacao)} ({fmtNum(cotacao.variacaoPercent)}%)
          </span>
          <span className="text-sm text-muted-foreground">
            <TermoTecnico termo="volume">Volume</TermoTecnico> do dia:{" "}
            {cotacao.volume.toLocaleString("pt-BR")}
          </span>
        </div>

        {/* Colar histórico (§2.4). */}
        <div className="grid gap-3 sm:grid-cols-2">
          <AreaColar
            id="tec-closes"
            rotulo="Cole os fechamentos (mais antigo → mais recente)"
            valor={closesText}
            onChange={setClosesText}
            placeholder={"28,50\n28,90\n29,10\n…"}
            ajuda="Um por linha. ~20 para médias, ~35 para o MACD. O brapi Free não traz histórico (§6.1)."
          />
          <AreaColar
            id="tec-volumes"
            rotulo="Volumes (opcional, paralelo aos fechamentos)"
            valor={volumesText}
            onChange={setVolumesText}
            placeholder={"1200000\n980000\n…"}
          />
        </div>

        {/* Indicadores calculados. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Indicador
            rotulo={<TermoTecnico termo="media-movel">Média 20</TermoTecnico>}
            valor={analise.sma20 != null ? formatPreco(analise.sma20) : "—"}
          />
          <Indicador
            rotulo={<TermoTecnico termo="media-movel">Média 50</TermoTecnico>}
            valor={analise.sma50 != null ? formatPreco(analise.sma50) : "—"}
          />
          <Indicador
            rotulo={<TermoTecnico termo="rsi">RSI (14)</TermoTecnico>}
            valor={fmtNum(analise.rsi14, 0)}
          />
          <Indicador
            rotulo={<TermoTecnico termo="macd">MACD</TermoTecnico>}
            valor={
              analise.macd
                ? `${fmtNum(analise.macd.macd, 3)} / sinal ${fmtNum(analise.macd.sinal, 3)}`
                : "—"
            }
          />
          <Indicador
            rotulo={<TermoTecnico termo="suporte-resistencia">Suporte</TermoTecnico>}
            valor={analise.suporte != null ? formatPreco(analise.suporte) : "—"}
          />
          <Indicador
            rotulo={<TermoTecnico termo="suporte-resistencia">Resistência</TermoTecnico>}
            valor={analise.resistencia != null ? formatPreco(analise.resistencia) : "—"}
          />
        </div>

        <LeituraIniciante linhas={analise.leitura} />
      </CardContent>
    </Card>
  );
}
