/**
 * Job de INGESTÃO do COTAHIST (B3) — download, descompactação em stream e upsert
 * no Postgres da cadeia de opções (registro tipo 01). Ver `docs/apis/b3-cotahist.md`.
 *
 * Operação BATCH (manual/agendada), NÃO um Route Handler nem código de request
 * (§5.1). Roda via `tsx`:
 *
 *   npx tsx scripts/ingestao-cotahist.ts 2025                 # baixa o ano
 *   npx tsx scripts/ingestao-cotahist.ts ./COTAHIST_A2025.ZIP # zip local
 *   npx tsx scripts/ingestao-cotahist.ts ./COTAHIST_A2025.TXT # txt já extraído
 *
 * Fronteira de efeitos colaterais: a função PURA `processarLinhas` (filtra +
 * parseia + decide o que vai pro upsert) não conhece rede, disco nem banco —
 * recebe um iterável de linhas e callbacks injetados, e é o que os testes
 * exercitam. Todo o I/O (fetch, unzip, Drizzle) mora nos helpers do final e no
 * `main()`.
 *
 * ⚠️ DEPENDÊNCIA DE SISTEMA: a leitura de `.ZIP` usa o utilitário `unzip` (lido
 * em stream via `unzip -p`, sem carregar o arquivo anual de centenas de MB em
 * memória). Em ambiente sem `unzip`, extraia manualmente e passe o `.TXT`.
 *
 * ⚠️ ENCODING: o COTAHIST é largura-fixa em ASCII/Latin-1. Lemos os streams como
 * `latin1` para garantir 1 byte = 1 caractere — é o que mantém as posições do
 * parser corretas (um acento decodificado como UTF-8 deslocaria a linha).
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { sql } from "drizzle-orm";

import {
  isOpcaoDeInteresse,
  isAcaoVistaLotePadrao,
  parseLinhaCotahist,
  parseRegistroAcao,
  CotahistCampoInvalidoError,
} from "@/lib/integrations/b3-cotahist";
import type {
  RegistroCotahist,
  RegistroAcaoCotahist,
} from "@/lib/integrations/b3-cotahist";
import { getDb } from "@/db";
import { opcaoCotahist, acaoCotahist, watchlist } from "@/db/schema";
import type { NewOpcaoCotahist, NewAcaoCotahist } from "@/db/schema";

// ── Tipos do núcleo ──────────────────────────────────────────────────────────

/**
 * Máximo de TRECHOS de exemplo guardados POR motivo de rejeição. As rejeições são
 * AGREGADAS por motivo (não logadas linha-a-linha): num arquivo anual, um
 * deslocamento de byte rejeitaria centenas de milhares de linhas — logar cada uma
 * trava a ingestão. Guardamos a CONTAGEM + estas poucas amostras para depurar.
 */
export const MAX_AMOSTRAS_POR_MOTIVO = 10;

/** Rejeições de um mesmo motivo: quantas foram e até 10 trechos de exemplo. */
export interface RejeicaoAgregada {
  /** Quantas linhas foram rejeitadas por este motivo. */
  count: number;
  /** Até `MAX_AMOSTRAS_POR_MOTIVO` trechos (`linha N: "…"`) para depuração. */
  amostras: string[];
}

/** Contagens reportadas ao fim da ingestão (§ "robustez" do prompt). */
export interface RelatorioIngestao {
  /** Total de linhas lidas do arquivo (todas, incl. header/trailer). */
  linhasLidas: number;
  /** Opções (070/080) cujo ativo-objeto está na watchlist e foram ao upsert. */
  opcoesIngeridas: number;
  /**
   * Opções válidas DESCARTADAS por terem ativo-objeto FORA da watchlist (§6.4:
   * vínculo restrito à watchlist no MVP — não armazenamos a B3 inteira). Contado
   * à parte de `linhasPuladas` porque é esperado e costuma ser ALTO; se vier
   * gigante e `opcoesIngeridas` = 0, a watchlist provavelmente está vazia.
   */
  opcoesForaWatchlist: number;
  /** Ações à vista lote-padrão (010 + 02) enviadas ao upsert. */
  acoesIngeridas: number;
  /** Linhas descartadas SEM erro: nem opção nem ação (header, trailer, frac…). */
  linhasPuladas: number;
  /** Linhas que o parser REJEITOU por corrupção (lançou) — não fatais. */
  erros: number;
  /**
   * Rejeições AGREGADAS por motivo (chave = motivo legível, ex.:
   * `"campo PREEXE inválido"`). Substitui o log por-linha — a impressão acontece
   * só no resumo final do `main()`.
   */
  rejeicoes: Map<string, RejeicaoAgregada>;
}

/** Dependências injetadas no núcleo (tudo que toca o mundo externo). */
export interface OpcoesProcessamento {
  /** Resolve o ativo-objeto (ou `null`) a partir do ticker da opção. */
  resolverObjeto: (optionSymbol: string) => string | null;
  /** Persiste um lote de OPÇÕES (upsert). Erro aqui é FATAL (aborta o job). */
  upsertOpcoes: (registros: NewOpcaoCotahist[]) => Promise<void>;
  /** Persiste um lote de AÇÕES (upsert). Erro aqui é FATAL (aborta o job). */
  upsertAcoes: (registros: NewAcaoCotahist[]) => Promise<void>;
  /** Tamanho do lote de upsert (default 500). */
  tamanhoLote?: number;
}

const TAMANHO_LOTE_PADRAO = 500;

/** Trecho da linha (com nº) usado como amostra de rejeição — sem o log por-linha. */
function trechoDaLinha(linha: string, numeroLinha: number): string {
  return `linha ${numeroLinha}: "${linha.slice(0, 60)}"`;
}

/** Registra uma rejeição agregada por motivo (conta sempre; guarda ≤ 10 amostras). */
function registrarRejeicao(
  relatorio: RelatorioIngestao,
  motivo: string,
  amostra: string,
): void {
  relatorio.erros++;
  let agg = relatorio.rejeicoes.get(motivo);
  if (!agg) {
    agg = { count: 0, amostras: [] };
    relatorio.rejeicoes.set(motivo, agg);
  }
  agg.count++;
  if (agg.amostras.length < MAX_AMOSTRAS_POR_MOTIVO) {
    agg.amostras.push(amostra);
  }
}

// ── Núcleo PURO (testável sem rede/disco/banco) ──────────────────────────────

/**
 * Varre as linhas UMA vez e ROTEIA cada uma: opção (070/080) → `opcao_cotahist`,
 * ação à vista lote-padrão (010 + 02) → `acao_cotahist`. Os filtros baratos
 * (`isOpcaoDeInteresse` / `isAcaoVistaLotePadrao`, mutuamente exclusivos) decidem
 * o destino ANTES do parse completo. Envia em lotes separados e retorna o
 * relatório de contagens (opções vs ações discriminadas).
 *
 * Política de robustez (decisão documentada — prompt §5):
 *  - linha que não é opção NEM ação à vista lote-padrão → PULA (header `00`,
 *    trailer `99`, fracionário, direitos…). Conta em `linhasPuladas`.
 *  - opção cujo ativo-objeto NÃO está na watchlist (`resolverObjeto` → `null`) →
 *    DESCARTA (§6.4: não armazenamos a B3 inteira, só o vínculo da watchlist).
 *    Conta em `opcoesForaWatchlist`. É o que mantém o `opcao_cotahist` enxuto.
 *  - parser LANÇA (`CotahistCampoInvalidoError`) → corrupção/byte-shift numa
 *    linha já roteada: LOGA o trecho e CONTINUA (não aborta o arquivo por uma
 *    linha ruim); conta em `erros`.
 *  - parser retorna `null` após o filtro (não deveria ocorrer) → pulo defensivo.
 *  - opção sem `DATVEN` (anômalo) → conta como `erro` e pula (tabela exige
 *    vencimento). Ação NÃO tem vencimento, então não há checagem equivalente.
 *  - falha no `upsert` (banco) → PROPAGA: é sistêmica, não "uma linha ruim".
 *
 * Aceita iterável SÍncrono (array, nos testes) ou ASSÍNCrono (readline, no job):
 * `for await` cobre os dois.
 */
export async function processarLinhas(
  linhas: AsyncIterable<string> | Iterable<string>,
  opts: OpcoesProcessamento,
): Promise<RelatorioIngestao> {
  const tamanhoLote = opts.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const relatorio: RelatorioIngestao = {
    linhasLidas: 0,
    opcoesIngeridas: 0,
    opcoesForaWatchlist: 0,
    acoesIngeridas: 0,
    linhasPuladas: 0,
    erros: 0,
    rejeicoes: new Map(),
  };

  let loteOpcoes: NewOpcaoCotahist[] = [];
  const descarregarOpcoes = async () => {
    if (loteOpcoes.length === 0) return;
    await opts.upsertOpcoes(loteOpcoes);
    loteOpcoes = [];
  };
  let loteAcoes: NewAcaoCotahist[] = [];
  const descarregarAcoes = async () => {
    if (loteAcoes.length === 0) return;
    await opts.upsertAcoes(loteAcoes);
    loteAcoes = [];
  };

  for await (const linha of linhas) {
    relatorio.linhasLidas++;

    const ehOpcao = isOpcaoDeInteresse(linha);
    const ehAcao = !ehOpcao && isAcaoVistaLotePadrao(linha);

    // Nem opção nem ação à vista lote-padrão: descarta (caso comum).
    if (!ehOpcao && !ehAcao) {
      relatorio.linhasPuladas++;
      continue;
    }

    // ⚠️ FRONTEIRA CRÍTICA: só o PARSE entra no try/catch por-linha. Parse é o
    // único passo cuja falha é RECUPERÁVEL ("uma linha ruim" → conta e segue). O
    // FLUSH (`descarregar*` → upsert) fica DE FORA: erro de upsert é SISTÊMICO e
    // deve PROPAGAR (abortar o job). Misturá-los (versão antiga) tinha um bug
    // grave: um flush que falhava era engolido como "linha ruim" E o lote não era
    // limpo (a limpeza vinha depois do `await` que lançou), então o lote crescia
    // a cada linha seguinte (500, 501, 502…) — floodando o log "linha após linha"
    // e, ao passar de ~milhares de linhas, estourando a pilha do builder de SQL
    // do Drizzle ("Maximum call stack size exceeded"), que mascarava o erro real.
    let opcaoRow: NewOpcaoCotahist | null = null;
    let acaoRow: NewAcaoCotahist | null = null;
    try {
      if (ehOpcao) {
        const reg: RegistroCotahist | null = parseLinhaCotahist(linha);
        // Defensivo: após o filtro, o parser não deveria devolver null.
        if (reg === null) {
          relatorio.linhasPuladas++;
          continue;
        }
        // Opção sem vencimento é anômalo (a tabela exige `expiresAt`).
        if (reg.datVen === null) {
          registrarRejeicao(
            relatorio,
            "opção sem DATVEN",
            trechoDaLinha(linha, relatorio.linhasLidas),
          );
          continue;
        }
        // §6.4: só armazenamos opções da WATCHLIST. Sem ativo-objeto resolvido
        // (raiz fora da watchlist), descarta — é o que evita ingerir a B3 inteira
        // (~2M linhas/473 MB) e estourar o tier do Postgres.
        const underlying = opts.resolverObjeto(reg.codNeg);
        if (underlying === null) {
          relatorio.opcoesForaWatchlist++;
          continue;
        }
        opcaoRow = registroParaUpsert(reg, underlying);
      } else {
        const reg: RegistroAcaoCotahist | null = parseRegistroAcao(linha);
        if (reg === null) {
          relatorio.linhasPuladas++;
          continue;
        }
        acaoRow = registroAcaoParaUpsert(reg);
      }
    } catch (erro) {
      // Corrupção/byte-shift numa linha já roteada: agrega por motivo e segue
      // (não aborta o arquivo). Motivo = nome do campo p/ erros do parser.
      const motivo =
        erro instanceof CotahistCampoInvalidoError
          ? `campo ${erro.campo} inválido`
          : erro instanceof Error
            ? erro.message
            : String(erro);
      registrarRejeicao(relatorio, motivo, trechoDaLinha(linha, relatorio.linhasLidas));
      continue;
    }

    // Acúmulo + flush FORA do try: um upsert que falhar PROPAGA (ver acima).
    if (opcaoRow) {
      loteOpcoes.push(opcaoRow);
      relatorio.opcoesIngeridas++;
      if (loteOpcoes.length >= tamanhoLote) await descarregarOpcoes();
    } else if (acaoRow) {
      loteAcoes.push(acaoRow);
      relatorio.acoesIngeridas++;
      if (loteAcoes.length >= tamanhoLote) await descarregarAcoes();
    }
  }

  await descarregarOpcoes();
  await descarregarAcoes();
  return relatorio;
}

/**
 * Converte um `RegistroCotahist` (já com decimais corrigidos) na linha de upsert.
 * Numéricos do Drizzle (`numeric`) são strings → `toFixed`/`toString`. `kind`
 * vem do `tipoOpcao` (garantido não-nulo aqui, pois só opções chegam até aqui).
 */
export function registroParaUpsert(
  reg: RegistroCotahist,
  underlying: string | null,
): NewOpcaoCotahist {
  if (reg.tipoOpcao === null || reg.datVen === null) {
    // Guard de tipo: `processarLinhas` já garante ambos, mas deixamos explícito.
    throw new Error(
      `registroParaUpsert: ${reg.codNeg} sem tipoOpcao/datVen — não deveria chegar aqui`,
    );
  }
  return {
    optionSymbol: reg.codNeg,
    underlying,
    kind: reg.tipoOpcao === "CALL" ? "call" : "put",
    strike: reg.preExe.toFixed(2),
    tradeDate: reg.dataPregao,
    expiresAt: reg.datVen,
    precoAbertura: reg.preAbe.toFixed(2),
    precoMinimo: reg.preMin.toFixed(2),
    precoMedio: reg.preMed.toFixed(2),
    precoMaximo: reg.preMax.toFixed(2),
    precoFechamento: reg.preUlt.toFixed(2),
    bid: reg.preOfc.toFixed(2),
    ask: reg.preOfv.toFixed(2),
    volumeFinanceiro: reg.volTot.toFixed(2),
    numeroNegocios: reg.totNeg,
    quantidadeTitulos: Math.round(reg.quaTot).toString(),
    fatorCotacao: reg.fatCot,
  };
}

/**
 * Converte um `RegistroAcaoCotahist` na linha de upsert de `acao_cotahist`. Sem
 * strike/vencimento/kind/objeto — o ticker já É o ativo-objeto (espelha o
 * `registroParaUpsert`, na sua versão de ação).
 */
export function registroAcaoParaUpsert(
  reg: RegistroAcaoCotahist,
): NewAcaoCotahist {
  return {
    ticker: reg.codNeg,
    tradeDate: reg.dataPregao,
    precoAbertura: reg.preAbe.toFixed(2),
    precoMinimo: reg.preMin.toFixed(2),
    precoMedio: reg.preMed.toFixed(2),
    precoMaximo: reg.preMax.toFixed(2),
    precoFechamento: reg.preUlt.toFixed(2),
    bid: reg.preOfc.toFixed(2),
    ask: reg.preOfv.toFixed(2),
    volumeFinanceiro: reg.volTot.toFixed(2),
    numeroNegocios: reg.totNeg,
    quantidadeTitulos: Math.round(reg.quaTot).toString(),
    fatorCotacao: reg.fatCot,
  };
}

// ── Heurística de vínculo opção → ativo-objeto (raiz + watchlist, §6.4) ──────

/** Raiz = 4 primeiras LETRAS do ticker da opção (PETRF336 → PETR). */
export function raizDoTicker(ticker: string): string | null {
  const m = ticker.match(/^([A-Za-z]{4})/);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Constrói o mapa raiz → ativo-objeto a partir da watchlist. Se duas entradas
 * colidem na mesma raiz (ex.: PETR3 e PETR4 → "PETR"), a raiz é considerada
 * AMBÍGUA e fica de fora — preferimos `null` a chutar o objeto errado (§6.4: o
 * vínculo é heurístico e restrito à watchlist no MVP).
 */
export function construirMapaRaizes(
  simbolosWatchlist: readonly string[],
): Map<string, string> {
  const porRaiz = new Map<string, string[]>();
  for (const simbolo of simbolosWatchlist) {
    const raiz = raizDoTicker(simbolo);
    if (!raiz) continue;
    const lista = porRaiz.get(raiz) ?? [];
    lista.push(simbolo);
    porRaiz.set(raiz, lista);
  }
  const mapa = new Map<string, string>();
  for (const [raiz, simbolos] of porRaiz) {
    if (simbolos.length === 1) mapa.set(raiz, simbolos[0]!);
  }
  return mapa;
}

/** Resolve o ativo-objeto de uma opção pelo mapa de raízes; `null` se não casar. */
export function derivarAtivoObjeto(
  optionSymbol: string,
  mapaRaizes: Map<string, string>,
): string | null {
  const raiz = raizDoTicker(optionSymbol);
  if (!raiz) return null;
  return mapaRaizes.get(raiz) ?? null;
}

// ── Camada de I/O (efeitos colaterais) ───────────────────────────────────────

/** Erro de download — instrui o fallback manual (captcha), sem tentar burlá-lo. */
export class ErroDownloadCotahist extends Error {
  constructor(
    public readonly url: string,
    public readonly ano: string,
    detalhe: string,
  ) {
    super(
      `Falha ao baixar o COTAHIST do ano ${ano} (${detalhe}).\n` +
        `URL tentada: ${url}\n` +
        `Fallback MANUAL (a B3 pode ter mudado o host ou exigido captcha):\n` +
        `  1. Acesse a página de Cotações Históricas da B3 e baixe o .ZIP do ano.\n` +
        `  2. Rode novamente apontando para o arquivo local:\n` +
        `     npx tsx scripts/ingestao-cotahist.ts ./COTAHIST_A${ano}.ZIP`,
    );
    this.name = "ErroDownloadCotahist";
  }
}

/** Baixa o ZIP anual para um arquivo temporário (stream, sem carregar em RAM). */
async function baixarAno(ano: string): Promise<string> {
  const url = `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A${ano}.ZIP`;
  console.error(`Baixando ${url} …`);

  let resposta: Response;
  try {
    resposta = await fetch(url);
  } catch (erro) {
    throw new ErroDownloadCotahist(url, ano, String(erro));
  }
  if (!resposta.ok || !resposta.body) {
    throw new ErroDownloadCotahist(url, ano, `HTTP ${resposta.status}`);
  }

  const destino = path.join(os.tmpdir(), `cotahist_a${ano}_${Date.now()}.zip`);
  await pipeline(
    Readable.fromWeb(resposta.body as Parameters<typeof Readable.fromWeb>[0]),
    fs.createWriteStream(destino),
  );
  return destino;
}

/** Lê um `.TXT` de COTAHIST linha a linha (stream, latin1). */
async function* lerTexto(arquivo: string): AsyncGenerator<string> {
  const entrada = fs.createReadStream(arquivo, { encoding: "latin1" });
  const rl = readline.createInterface({ input: entrada, crlfDelay: Infinity });
  for await (const linha of rl) yield linha;
}

/**
 * Lê um `.ZIP` de COTAHIST linha a linha via `unzip -p` (stream para stdout,
 * sem extrair para disco). Erro do `unzip` (incl. ausente no sistema) vira uma
 * mensagem clara.
 */
async function* lerZip(arquivo: string): AsyncGenerator<string> {
  const proc = spawn("unzip", ["-p", arquivo]);
  let erroSpawn: Error | null = null;
  proc.on("error", (e) => {
    erroSpawn = e;
  });
  proc.stdout.setEncoding("latin1");

  const rl = readline.createInterface({
    input: proc.stdout,
    crlfDelay: Infinity,
  });
  try {
    for await (const linha of rl) yield linha;
  } finally {
    proc.kill();
  }

  if (erroSpawn) {
    const e = erroSpawn as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new Error(
        `Utilitário 'unzip' não encontrado no sistema. Instale-o ou extraia o ` +
          `arquivo manualmente e passe o .TXT:\n` +
          `  npx tsx scripts/ingestao-cotahist.ts ${arquivo.replace(/\.zip$/i, ".TXT")}`,
      );
    }
    throw e;
  }
}

/** Decide a fonte (ano para download, ou caminho local .zip/.txt) e itera linhas. */
async function* abrirFonte(arg: string): AsyncGenerator<string> {
  if (/^\d{4}$/.test(arg)) {
    const zipTemp = await baixarAno(arg);
    try {
      yield* lerZip(zipTemp);
    } finally {
      await fs.promises.rm(zipTemp, { force: true });
    }
    return;
  }
  if (arg.toLowerCase().endsWith(".zip")) {
    yield* lerZip(arg);
    return;
  }
  yield* lerTexto(arg);
}

/** Upsert de um lote: re-rodar o mesmo pregão atualiza em vez de duplicar. */
async function upsertLote(
  db: ReturnType<typeof getDb>,
  registros: NewOpcaoCotahist[],
): Promise<void> {
  if (registros.length === 0) return;
  await db
    .insert(opcaoCotahist)
    .values(registros)
    .onConflictDoUpdate({
      target: [opcaoCotahist.optionSymbol, opcaoCotahist.tradeDate],
      set: {
        underlying: sql`excluded.underlying`,
        kind: sql`excluded.kind`,
        strike: sql`excluded.strike`,
        expiresAt: sql`excluded.expires_at`,
        precoAbertura: sql`excluded.preco_abertura`,
        precoMinimo: sql`excluded.preco_minimo`,
        precoMedio: sql`excluded.preco_medio`,
        precoMaximo: sql`excluded.preco_maximo`,
        precoFechamento: sql`excluded.preco_fechamento`,
        bid: sql`excluded.bid`,
        ask: sql`excluded.ask`,
        volumeFinanceiro: sql`excluded.volume_financeiro`,
        numeroNegocios: sql`excluded.numero_negocios`,
        quantidadeTitulos: sql`excluded.quantidade_titulos`,
        fatorCotacao: sql`excluded.fator_cotacao`,
        updatedAt: new Date(),
      },
    });
}

/** Upsert de um lote de AÇÕES: idempotente por (ticker, trade_date). */
async function upsertLoteAcoes(
  db: ReturnType<typeof getDb>,
  registros: NewAcaoCotahist[],
): Promise<void> {
  if (registros.length === 0) return;
  await db
    .insert(acaoCotahist)
    .values(registros)
    .onConflictDoUpdate({
      target: [acaoCotahist.ticker, acaoCotahist.tradeDate],
      set: {
        precoAbertura: sql`excluded.preco_abertura`,
        precoMinimo: sql`excluded.preco_minimo`,
        precoMedio: sql`excluded.preco_medio`,
        precoMaximo: sql`excluded.preco_maximo`,
        precoFechamento: sql`excluded.preco_fechamento`,
        bid: sql`excluded.bid`,
        ask: sql`excluded.ask`,
        volumeFinanceiro: sql`excluded.volume_financeiro`,
        numeroNegocios: sql`excluded.numero_negocios`,
        quantidadeTitulos: sql`excluded.quantidade_titulos`,
        fatorCotacao: sql`excluded.fator_cotacao`,
        updatedAt: new Date(),
      },
    });
}

// ── main() ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Carrega DATABASE_URL de .env.local (nativo do Node), como no db/seed.ts.
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // .env.local ausente — usa variáveis já presentes no ambiente.
  }

  const arg = process.argv[2];
  if (!arg) {
    console.error(
      "Uso: npx tsx scripts/ingestao-cotahist.ts <ano|arquivo.zip|arquivo.txt>\n" +
        "  ex.: npx tsx scripts/ingestao-cotahist.ts 2025\n" +
        "       npx tsx scripts/ingestao-cotahist.ts ./COTAHIST_A2025.ZIP",
    );
    process.exit(1);
  }

  const db = getDb();

  // Watchlist → mapa de raízes para o vínculo opção→objeto (heurística §6.4).
  const objetos = await db
    .select({ symbol: watchlist.symbol })
    .from(watchlist);
  const mapaRaizes = construirMapaRaizes(objetos.map((o) => o.symbol));
  console.error(
    `Watchlist: ${objetos.length} ativo(s); ${mapaRaizes.size} raiz(es) sem ambiguidade.`,
  );
  if (mapaRaizes.size === 0) {
    // Sem watchlist, o filtro §6.4 descarta TODAS as opções → opcao_cotahist
    // não recebe nada. Avisa alto em vez de "ingerir zero" silenciosamente.
    console.error(
      "⚠️  Watchlist VAZIA (ou só raízes ambíguas): NENHUMA opção será armazenada\n" +
        "    (§6.4: só ingerimos opções de ativos na watchlist). Popule a watchlist\n" +
        "    e rode de novo. As ações à vista são ingeridas normalmente.",
    );
  }

  const inicio = Date.now();
  const relatorio = await processarLinhas(abrirFonte(arg), {
    resolverObjeto: (symbol) => derivarAtivoObjeto(symbol, mapaRaizes),
    upsertOpcoes: (registros) => upsertLote(db, registros),
    upsertAcoes: (registros) => upsertLoteAcoes(db, registros),
  });

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  console.error(
    `\nIngestão concluída em ${seg}s:\n` +
      `  linhas lidas .............. ${relatorio.linhasLidas}\n` +
      `  opções ingeridas .......... ${relatorio.opcoesIngeridas}\n` +
      `  opções fora da watchlist .. ${relatorio.opcoesForaWatchlist}\n` +
      `  ações ingeridas ........... ${relatorio.acoesIngeridas}\n` +
      `  linhas puladas ............ ${relatorio.linhasPuladas}\n` +
      `  erros (linhas ruins) ...... ${relatorio.erros}`,
  );

  // Resumo AGREGADO das rejeições (sem log por-linha): contagem por motivo +
  // até MAX_AMOSTRAS_POR_MOTIVO trechos de exemplo de cada.
  if (relatorio.rejeicoes.size > 0) {
    console.error(`\nRejeições por motivo (amostras ≤ ${MAX_AMOSTRAS_POR_MOTIVO}):`);
    for (const [motivo, agg] of relatorio.rejeicoes) {
      console.error(`  • ${motivo}: ${agg.count}`);
      for (const amostra of agg.amostras) console.error(`      ${amostra}`);
    }
  }
}

// Executa só quando rodado direto (não em import de teste).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      // Erro de banco (NeonDbError/pg) traz o MOTIVO real em campos próprios
      // (code/detail/column/constraint), e o driver embrulha o erro do Postgres
      // em `.cause`. O `.message` do topo é só o SQL + params — imprimir só ele
      // (versão antiga) inundava a tela com o dump do lote e MASCARAVA a causa
      // real (ex.: "relation … does not exist", "project size limit exceeded").
      console.error("\nFalha na ingestão:", err instanceof Error ? err.message : err);
      // O Postgres real costuma estar em `.cause`; mostre a mensagem e os campos.
      const pg = (err as { cause?: unknown })?.cause ?? err;
      if (pg && typeof pg === "object") {
        const e = pg as Record<string, unknown>;
        if (e.message && e.message !== (err as { message?: unknown })?.message) {
          console.error("Causa:", e.message);
        }
        console.error("Detalhe Postgres:", {
          code: e.code,
          detail: e.detail,
          column: e.column,
          constraint: e.constraint,
          table: e.table,
          severity: e.severity,
        });
      }
      process.exit(1);
    });
}
