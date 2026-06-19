"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Search } from "lucide-react";

import { DisclaimerNota } from "@/components/disclaimer";
import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { BlocoFundamentalista } from "./bloco-fundamentalista";
import { BlocoTecnico } from "./bloco-tecnico";
import { BlocoVolatilidade } from "./bloco-volatilidade";
import type { RespostaAtivo, RespostaCadeia, RespostaCalendario } from "./tipos";

// Texto padrão sobre resultados (espelha a sinalização honesta do §6.4).
const RESULTADOS_PADRAO = {
  motivo: "O brapi não fornece calendário de divulgação de resultados (§6.4).",
  fonteAlternativa: "Informe a data manualmente (RI da empresa, B3, Status Invest).",
};

async function buscarJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/**
 * `<AnaliseCliente>` — a tela 4 (§8.2, §9). Busca um ticker e reúne, em três
 * blocos (técnico, fundamentalista, volatilidade), os dados das rotas
 * `/api/ativo` (brapi), `/api/cadeia` (COTAHIST) e `/api/calendario` (brapi). Cada
 * bloco degrada sozinho: se uma fonte falhar, os outros blocos seguem, e o
 * usuário pode colar dados (§2.4). Nenhuma recomendação — só leitura (§9).
 */
export function AnaliseCliente() {
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [dadosAtivo, setDadosAtivo] = useState<RespostaAtivo | null>(null);
  const [dadosCadeia, setDadosCadeia] = useState<RespostaCadeia | null>(null);
  const [dadosCalendario, setDadosCalendario] = useState<RespostaCalendario | null>(null);
  const [proventoFuturo, setProventoFuturo] = useState(false);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    const tic = busca.trim().toUpperCase();
    if (!tic) return;

    setAtivo(tic);
    setCarregando(true);
    setErro(null);

    // As três fontes em paralelo; cada bloco degrada sozinho (§6.3).
    const [a, c, cal] = await Promise.all([
      buscarJson<RespostaAtivo>(`/api/ativo/${encodeURIComponent(tic)}`),
      buscarJson<RespostaCadeia>(`/api/cadeia/${encodeURIComponent(tic)}`),
      buscarJson<RespostaCalendario>(`/api/calendario/${encodeURIComponent(tic)}`),
    ]);

    setCarregando(false);
    if (!a) {
      // Cotação é o dado essencial; sem ela não há o que mostrar.
      setErro(`Não foi possível obter dados de ${tic}. Verifique o ticker e tente de novo.`);
      setDadosAtivo(null);
      setDadosCadeia(null);
      setDadosCalendario(null);
      return;
    }
    setDadosAtivo(a);
    setDadosCadeia(c);
    setDadosCalendario(cal);
    // Há provento com pagamento futuro? (calculado aqui, fora do render).
    const agora = Date.now();
    setProventoFuturo(
      cal?.proventos.some(
        (p) => p.dataPagamento != null && new Date(p.dataPagamento).getTime() >= agora,
      ) ?? false,
    );
  }

  // Evento próximo (provento futuro) reforça o alerta da leitura de volatilidade.
  // Calculado no submit (não no render, que deve ser puro) e guardado em estado.
  const eventoProximo = proventoFuturo;

  return (
    <div className="flex flex-col gap-6">
      <DisclaimerNota />

      <form onSubmit={buscar} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="busca-ticker" className="text-sm font-medium">
            Ativo-objeto
          </label>
          <Input
            id="busca-ticker"
            value={busca}
            onChange={(e) => setBusca(e.target.value.toUpperCase())}
            placeholder="PETR4"
            inputMode="text"
          />
        </div>
        <Button type="submit" disabled={carregando}>
          {carregando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
          Analisar
        </Button>
      </form>

      {!ativo && !dadosAtivo && (
        <p className="text-sm text-muted-foreground">
          Busque um ticker da B3 para ver os três blocos —{" "}
          <TermoTecnico termo="media-movel">técnico</TermoTecnico>,{" "}
          <TermoTecnico termo="preco-lucro">fundamentalista</TermoTecnico> e{" "}
          <TermoTecnico termo="volatilidade-implicita">volatilidade</TermoTecnico> — cada um com
          uma leitura em linguagem simples.
        </p>
      )}

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-risco-perigo/40 bg-risco-perigo-suave px-3.5 py-3 text-sm text-risco-perigo">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{erro}</span>
        </div>
      )}

      {dadosAtivo && (
        <>
          <BlocoTecnico cotacao={dadosAtivo.cotacao} frescor={dadosAtivo.frescor.cotacao} />

          <BlocoFundamentalista
            fundamentos={dadosAtivo.fundamentos}
            proventos={dadosCalendario?.proventos ?? []}
            resultadosInfo={dadosCalendario?.resultados ?? RESULTADOS_PADRAO}
            frescorFundamentos={dadosAtivo.frescor.fundamentos}
            frescorProventos={dadosCalendario?.frescor.proventos ?? dadosAtivo.frescor.cotacao}
          />

          <BlocoVolatilidade
            ivAtual={dadosCadeia?.cadeia.ivAtual ?? null}
            volatilidade={dadosCadeia?.volatilidade ?? null}
            eventoProximo={eventoProximo}
            frescor={dadosCadeia?.frescor.volatilidade ?? null}
          />
        </>
      )}
    </div>
  );
}
