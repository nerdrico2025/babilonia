/**
 * analise/tecnico — análise TÉCNICA do ativo-objeto (§8.2, bloco 1).
 *
 * Módulo PURO e testável. Recebe uma SÉRIE DE FECHAMENTOS (colada pelo usuário,
 * §2.4 — o app não busca histórico automático, §2.4) e calcula os indicadores
 * clássicos: médias móveis, RSI, MACD, suporte/resistência e leitura de volume.
 *
 * Encerra com uma LEITURA DE INICIANTE (§9): descreve o que os números sugerem,
 * SEM nunca dizer "compre/venda" (§2.3) — só "tende a favorecer / atenção a…".
 */

/** Indicadores técnicos calculados a partir da série (nulos quando faltam dados). */
export interface AnaliseTecnica {
  /** Quantidade de fechamentos válidos na série. */
  pontos: number;
  precoAtual: number | null;
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  macd: { macd: number; sinal: number; histograma: number } | null;
  /** Menor fechamento da janela recente (suporte aproximado). */
  suporte: number | null;
  /** Maior fechamento da janela recente (resistência aproximada). */
  resistencia: number | null;
  volumeAtual: number | null;
  volumeMedio: number | null;
  /** Leitura em linguagem de iniciante (§9) — nunca recomenda. */
  leitura: string[];
}

/** Janela para suporte/resistência (nº de fechamentos recentes considerados). */
const JANELA_SR = 60;

/**
 * Converte texto colado em série de números. Separadores: espaço, tabulação,
 * ponto-e-vírgula e quebras de linha (a VÍRGULA fica reservada ao decimal pt-BR,
 * não separa). Ignora tokens não numéricos (ex.: datas com letras).
 */
export function parseSerie(texto: string): number[] {
  return texto
    .split(/[\s;]+/)
    .map((t) => t.trim())
    .filter((t) => t !== "")
    .map((t) => {
      // "12,34" (pt-BR) → 12.34; "1.234,56" → 1234.56; "12.34" mantém.
      const normalizado = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
      return Number(normalizado);
    })
    .filter((n) => Number.isFinite(n));
}

/** Média simples dos últimos `periodo` valores; `null` se faltarem dados. */
function sma(valores: number[], periodo: number): number | null {
  if (valores.length < periodo) return null;
  const fatia = valores.slice(valores.length - periodo);
  return fatia.reduce((a, b) => a + b, 0) / periodo;
}

/** Série de EMA (média móvel exponencial) com semente na SMA inicial. */
function emaSerie(valores: number[], periodo: number): number[] {
  if (valores.length < periodo) return [];
  const k = 2 / (periodo + 1);
  let ema = valores.slice(0, periodo).reduce((a, b) => a + b, 0) / periodo;
  const saida = [ema];
  for (let i = periodo; i < valores.length; i++) {
    ema = valores[i]! * k + ema * (1 - k);
    saida.push(ema);
  }
  return saida;
}

/** RSI de Wilder; `null` se faltarem dados (precisa de `periodo + 1` pontos). */
function rsi(valores: number[], periodo = 14): number | null {
  if (valores.length < periodo + 1) return null;
  let ganhos = 0;
  let perdas = 0;
  for (let i = 1; i <= periodo; i++) {
    const d = valores[i]! - valores[i - 1]!;
    if (d >= 0) ganhos += d;
    else perdas -= d;
  }
  let mediaG = ganhos / periodo;
  let mediaP = perdas / periodo;
  for (let i = periodo + 1; i < valores.length; i++) {
    const d = valores[i]! - valores[i - 1]!;
    const g = d > 0 ? d : 0;
    const p = d < 0 ? -d : 0;
    mediaG = (mediaG * (periodo - 1) + g) / periodo;
    mediaP = (mediaP * (periodo - 1) + p) / periodo;
  }
  if (mediaP === 0) return 100;
  const rs = mediaG / mediaP;
  return 100 - 100 / (1 + rs);
}

/** MACD(12,26,9): linha, sinal e histograma; `null` se faltarem dados. */
function macd(
  valores: number[],
): { macd: number; sinal: number; histograma: number } | null {
  const e12 = emaSerie(valores, 12);
  const e26 = emaSerie(valores, 26);
  if (e26.length === 0) return null;
  // Alinha as caudas (e12 é mais longa) e monta a linha MACD.
  const offset = e12.length - e26.length;
  const linha = e26.map((v, i) => e12[i + offset]! - v);
  const sinalSerie = emaSerie(linha, 9);
  if (sinalSerie.length === 0) return null;
  const macdVal = linha[linha.length - 1]!;
  const sinal = sinalSerie[sinalSerie.length - 1]!;
  return { macd: macdVal, sinal, histograma: macdVal - sinal };
}

/** Próximo de um nível (dentro de `tol`, default 2%)? */
function perto(preco: number, nivel: number, tol = 0.02): boolean {
  return Math.abs(preco - nivel) / nivel <= tol;
}

/**
 * Analisa a série de fechamentos e devolve os indicadores + a leitura de
 * iniciante (§9). `precoAtual` pode ser passado (cotação ao vivo) ou assume o
 * último fechamento. `volumes` é opcional (paralelo aos fechamentos).
 */
export function analisarTecnico(
  closes: number[],
  opcoes: { volumes?: number[]; precoAtual?: number } = {},
): AnaliseTecnica {
  const pontos = closes.length;
  const precoAtual = opcoes.precoAtual ?? (pontos > 0 ? closes[pontos - 1]! : null);

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdVal = macd(closes);

  let suporte: number | null = null;
  let resistencia: number | null = null;
  if (pontos > 0) {
    const janela = closes.slice(Math.max(0, pontos - JANELA_SR));
    suporte = Math.min(...janela);
    resistencia = Math.max(...janela);
  }

  const volumes = opcoes.volumes ?? [];
  const volumeAtual = volumes.length > 0 ? volumes[volumes.length - 1]! : null;
  const volumeMedio =
    volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null;

  const leitura = montarLeituraTecnica({
    pontos,
    precoAtual,
    sma20,
    sma50,
    rsi14,
    macd: macdVal,
    suporte,
    resistencia,
    volumeAtual,
    volumeMedio,
  });

  return {
    pontos,
    precoAtual,
    sma20,
    sma50,
    rsi14,
    macd: macdVal,
    suporte,
    resistencia,
    volumeAtual,
    volumeMedio,
    leitura,
  };
}

/** Compõe a leitura de iniciante a partir dos indicadores (§9 — sem recomendar). */
function montarLeituraTecnica(a: Omit<AnaliseTecnica, "leitura">): string[] {
  const linhas: string[] = [];

  if (a.pontos < 20) {
    linhas.push(
      "Cole mais fechamentos (ao menos ~20 para as médias e ~35 para o MACD) para a leitura técnica ficar completa.",
    );
  }

  // Preço vs. médias móveis.
  if (a.precoAtual != null && a.sma20 != null && a.sma50 != null) {
    if (a.precoAtual > a.sma20 && a.precoAtual > a.sma50) {
      linhas.push(
        "O preço está acima das médias de 20 e 50 períodos — viés de curto prazo de alta.",
      );
    } else if (a.precoAtual < a.sma20 && a.precoAtual < a.sma50) {
      linhas.push(
        "O preço está abaixo das médias de 20 e 50 períodos — viés de curto prazo de baixa.",
      );
    } else {
      linhas.push(
        "O preço está entre as médias de 20 e 50 períodos — tendência indefinida no curto prazo.",
      );
    }
  } else if (a.precoAtual != null && a.sma20 != null) {
    linhas.push(
      a.precoAtual > a.sma20
        ? "O preço está acima da média de 20 períodos — força no curto prazo."
        : "O preço está abaixo da média de 20 períodos — fraqueza no curto prazo.",
    );
  }

  // RSI.
  if (a.rsi14 != null) {
    const r = Math.round(a.rsi14);
    if (a.rsi14 >= 70) {
      linhas.push(`RSI em ${r} — zona de sobrecompra; o movimento pode estar esticado.`);
    } else if (a.rsi14 <= 30) {
      linhas.push(`RSI em ${r} — zona de sobrevenda; a queda pode estar esticada.`);
    } else {
      linhas.push(`RSI em ${r} — região neutra (nem sobrecomprado, nem sobrevendido).`);
    }
  }

  // MACD.
  if (a.macd) {
    linhas.push(
      a.macd.histograma > 0
        ? "MACD acima da linha de sinal — momentum de curto prazo comprador."
        : a.macd.histograma < 0
          ? "MACD abaixo da linha de sinal — momentum de curto prazo vendedor."
          : "MACD colado na linha de sinal — momentum neutro.",
    );
  }

  // Suporte / resistência.
  if (a.precoAtual != null && a.suporte != null && a.resistencia != null) {
    if (perto(a.precoAtual, a.resistencia)) {
      linhas.push(
        "O preço está perto da resistência da janela — zona onde costuma encontrar vendedores.",
      );
    } else if (perto(a.precoAtual, a.suporte)) {
      linhas.push(
        "O preço está perto do suporte da janela — zona onde costuma encontrar compradores.",
      );
    }
  }

  // Volume.
  if (a.volumeAtual != null && a.volumeMedio != null && a.volumeMedio > 0) {
    if (a.volumeAtual > 1.5 * a.volumeMedio) {
      linhas.push("Volume bem acima da média — movimento com participação (mais confiável).");
    } else if (a.volumeAtual < 0.5 * a.volumeMedio) {
      linhas.push("Volume abaixo da média — movimento com pouca participação (menos confiável).");
    }
  }

  if (linhas.length === 0) {
    linhas.push("Sem dados suficientes para uma leitura técnica — cole o histórico de fechamentos.");
  }
  return linhas;
}
