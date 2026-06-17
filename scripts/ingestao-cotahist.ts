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
  parseLinhaCotahist,
} from "@/lib/integrations/b3-cotahist";
import type { RegistroCotahist } from "@/lib/integrations/b3-cotahist";
import { getDb } from "@/db";
import { opcaoCotahist, watchlist } from "@/db/schema";
import type { NewOpcaoCotahist } from "@/db/schema";

// ── Tipos do núcleo ──────────────────────────────────────────────────────────

/** Contagens reportadas ao fim da ingestão (§ "robustez" do prompt). */
export interface RelatorioIngestao {
  /** Total de linhas lidas do arquivo (todas, incl. header/trailer/ações). */
  linhasLidas: number;
  /** Opções (070/080) parseadas com sucesso e enviadas ao upsert. */
  opcoesIngeridas: number;
  /** Linhas descartadas SEM erro: não-opção, header, trailer, registro≠01. */
  linhasPuladas: number;
  /** Linhas que o parser REJEITOU por corrupção (lançou) — logadas, não fatais. */
  erros: number;
}

/** Dependências injetadas no núcleo (tudo que toca o mundo externo). */
export interface OpcoesProcessamento {
  /** Resolve o ativo-objeto (ou `null`) a partir do ticker da opção. */
  resolverObjeto: (optionSymbol: string) => string | null;
  /** Persiste um lote de linhas (upsert). Erro aqui é FATAL (aborta o job). */
  upsert: (registros: NewOpcaoCotahist[]) => Promise<void>;
  /** Tamanho do lote de upsert (default 500). */
  tamanhoLote?: number;
  /** Para avisos de linha corrompida (default `console`). */
  logger?: Pick<Console, "warn">;
}

const TAMANHO_LOTE_PADRAO = 500;

// ── Núcleo PURO (testável sem rede/disco/banco) ──────────────────────────────

/**
 * Varre as linhas, filtra opções com `isOpcaoDeInteresse` ANTES do parse
 * completo, parseia as que passam e as envia ao `upsert` em lotes. Retorna o
 * relatório de contagens.
 *
 * Política de robustez (decisão documentada — prompt §5):
 *  - `isOpcaoDeInteresse(linha) === false` → PULA (não-opção, header `00`,
 *    trailer `99`, ação à vista). Conta em `linhasPuladas`. É o caso comum.
 *  - parser LANÇA (`CotahistCampoInvalidoError`) → corrupção/byte-shift numa
 *    linha que parecia opção: LOGA o trecho e CONTINUA (não aborta o arquivo
 *    por uma linha ruim); conta em `erros`.
 *  - parser retorna `null` após o filtro (não deveria ocorrer) → trata como
 *    pulo defensivo (`linhasPuladas`).
 *  - opção sem `DATVEN` (anômalo: opção sem vencimento) → conta como `erro` e
 *    pula (a tabela exige vencimento).
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
  const logger = opts.logger ?? console;
  const relatorio: RelatorioIngestao = {
    linhasLidas: 0,
    opcoesIngeridas: 0,
    linhasPuladas: 0,
    erros: 0,
  };

  let lote: NewOpcaoCotahist[] = [];
  const descarregar = async () => {
    if (lote.length === 0) return;
    await opts.upsert(lote);
    lote = [];
  };

  for await (const linha of linhas) {
    relatorio.linhasLidas++;

    // Filtro barato: descarta tudo que não é opção 070/080 antes de parsear.
    if (!isOpcaoDeInteresse(linha)) {
      relatorio.linhasPuladas++;
      continue;
    }

    let reg: RegistroCotahist | null;
    try {
      reg = parseLinhaCotahist(linha);
    } catch (erro) {
      // Corrupção numa linha que passou no filtro: loga e segue (não aborta).
      relatorio.erros++;
      logger.warn(
        `COTAHIST: linha ${relatorio.linhasLidas} rejeitada (${
          erro instanceof Error ? erro.message : String(erro)
        }); trecho="${linha.slice(0, 60)}"`,
      );
      continue;
    }

    // Defensivo: após o filtro, o parser não deveria devolver null.
    if (reg === null) {
      relatorio.linhasPuladas++;
      continue;
    }

    // Opção sem vencimento é anômalo (a tabela exige `expiresAt`): conta e pula.
    if (reg.datVen === null) {
      relatorio.erros++;
      logger.warn(
        `COTAHIST: opção ${reg.codNeg} sem DATVEN no pregão ${reg.dataPregao.toISOString()} — pulada`,
      );
      continue;
    }

    lote.push(registroParaUpsert(reg, opts.resolverObjeto(reg.codNeg)));
    relatorio.opcoesIngeridas++;
    if (lote.length >= tamanhoLote) await descarregar();
  }

  await descarregar();
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

  const inicio = Date.now();
  const relatorio = await processarLinhas(abrirFonte(arg), {
    resolverObjeto: (symbol) => derivarAtivoObjeto(symbol, mapaRaizes),
    upsert: (registros) => upsertLote(db, registros),
    logger: console,
  });

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  console.error(
    `\nIngestão concluída em ${seg}s:\n` +
      `  linhas lidas .......... ${relatorio.linhasLidas}\n` +
      `  opções ingeridas ...... ${relatorio.opcoesIngeridas}\n` +
      `  linhas puladas ........ ${relatorio.linhasPuladas}\n` +
      `  erros (linhas ruins) .. ${relatorio.erros}`,
  );
}

// Executa só quando rodado direto (não em import de teste).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\nFalha na ingestão:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
