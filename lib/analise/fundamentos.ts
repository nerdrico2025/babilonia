/**
 * analise/fundamentos — leitura FUNDAMENTALISTA do ativo (§8.2, bloco 2).
 *
 * Módulo PURO e testável. Recebe os múltiplos/margens (da brapi quando há plano,
 * ou COLADOS pelo usuário — §2.4) e produz uma leitura de iniciante (§9), sem
 * nunca recomendar (§2.3). Também infere a tendência de lucros pelos trimestres.
 */

/** Lucro de um trimestre (mesma forma do `BrapiFundamentos`). */
export interface LucroTrimestre {
  fim: string | null;
  lucroLiquido: number | null;
}

/** Entrada da leitura fundamentalista (campos podem faltar → `null`). */
export interface FundamentosEntrada {
  precoLucro: number | null;
  evEbitda: number | null;
  precoValorPatrimonial: number | null;
  margemBruta: number | null;
  margemOperacional: number | null;
  margemLiquida: number | null;
  /** Dividend yield (fração, ex.: 0.08 = 8%, ou já em % se > 1). */
  dividendYield: number | null;
  lucrosPorTrimestre: LucroTrimestre[];
}

export type TendenciaLucros = "alta" | "baixa" | "estavel";

export interface AnaliseFundamentos {
  tendenciaLucros: TendenciaLucros | null;
  leitura: string[];
}

/** Há ao menos um campo preenchido? (Para decidir se a leitura é possível.) */
export function temAlgumFundamento(f: FundamentosEntrada): boolean {
  return (
    f.precoLucro != null ||
    f.evEbitda != null ||
    f.precoValorPatrimonial != null ||
    f.margemBruta != null ||
    f.margemOperacional != null ||
    f.margemLiquida != null ||
    f.dividendYield != null ||
    f.lucrosPorTrimestre.some((t) => t.lucroLiquido != null)
  );
}

/**
 * Tendência de lucros pelos trimestres disponíveis: compara o primeiro com o
 * último (em ordem cronológica), com banda de ±5%. `null` se faltam dados.
 */
export function tendenciaLucros(trimestres: LucroTrimestre[]): TendenciaLucros | null {
  const validos = trimestres
    .filter((t) => t.lucroLiquido != null && t.fim != null)
    .slice()
    .sort((a, b) => (a.fim! < b.fim! ? -1 : 1));
  if (validos.length < 2) return null;
  const primeiro = validos[0]!.lucroLiquido!;
  const ultimo = validos[validos.length - 1]!.lucroLiquido!;
  if (primeiro === 0) return ultimo > 0 ? "alta" : ultimo < 0 ? "baixa" : "estavel";
  const variacao = (ultimo - primeiro) / Math.abs(primeiro);
  if (variacao > 0.05) return "alta";
  if (variacao < -0.05) return "baixa";
  return "estavel";
}

/** Formata uma medida que pode vir como fração (0.25) ou já em % (25). */
function pctFlex(v: number): string {
  const valor = Math.abs(v) <= 1 ? v * 100 : v;
  const txt = valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return `${txt}%`;
}

function num(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/**
 * Monta a leitura fundamentalista de iniciante (§9). Descreve os números em
 * linguagem simples; NÃO diz se a ação está "cara/barata" de forma conclusiva
 * nem recomenda — apenas explica o que cada indicador significa.
 */
export function lerFundamentos(f: FundamentosEntrada): AnaliseFundamentos {
  const leitura: string[] = [];

  if (!temAlgumFundamento(f)) {
    return {
      tendenciaLucros: null,
      leitura: [
        "Sem fundamentos da fonte (o brapi Free não os fornece, §6.1). Cole os dados acima para ver a leitura.",
      ],
    };
  }

  if (f.precoLucro != null) {
    leitura.push(
      `P/L de ${num(f.precoLucro)}: o mercado paga cerca de R$ ${num(f.precoLucro)} por R$ 1 de lucro anual da empresa.`,
    );
  }
  if (f.evEbitda != null) {
    leitura.push(
      `EV/EBITDA de ${num(f.evEbitda)}: quanto vale a empresa (com dívida) frente à sua geração operacional de caixa.`,
    );
  }
  if (f.precoValorPatrimonial != null) {
    leitura.push(
      `P/VP de ${num(f.precoValorPatrimonial)}: relação entre o preço e o valor patrimonial por ação` +
        `${f.precoValorPatrimonial < 1 ? " (abaixo de 1 = abaixo do patrimônio contábil)" : ""}.`,
    );
  }
  if (f.margemLiquida != null) {
    leitura.push(
      `Margem líquida de ${pctFlex(f.margemLiquida)}: parte da receita que sobra como lucro.`,
    );
  }
  if (f.dividendYield != null) {
    leitura.push(
      `Dividend yield de ${pctFlex(f.dividendYield)} ao ano: retorno em proventos sobre o preço atual.`,
    );
  }

  const tendencia = tendenciaLucros(f.lucrosPorTrimestre);
  if (tendencia === "alta") {
    leitura.push("Os lucros trimestrais vêm crescendo no período disponível.");
  } else if (tendencia === "baixa") {
    leitura.push("Os lucros trimestrais vêm caindo no período disponível — acompanhe os próximos resultados.");
  } else if (tendencia === "estavel") {
    leitura.push("Os lucros trimestrais estão relativamente estáveis no período disponível.");
  }

  leitura.push(
    "Isto é informação para contexto, não recomendação — múltiplos só fazem sentido comparados ao setor e ao histórico.",
  );

  return { tendenciaLucros: tendencia, leitura };
}
