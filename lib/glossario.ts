/**
 * Glossário do Babilônia (§8.7, tela 9 do §14) — a FONTE ÚNICA dos termos.
 *
 * É consumido em dois lugares:
 *  - `<TermoTecnico>` (tooltip curto + link) ao redor de qualquer jargão na UI;
 *  - a tela `/glossario`, que lista todos os termos com a explicação longa.
 *
 * Princípio §2 (para leigos): toda definição é em português claro, sem jargão
 * sem explicação. O `curto` cabe num tooltip; o `longo` explica com calma.
 *
 * Módulo PURO (sem React/efeitos) — pode ser importado de qualquer lugar.
 */

/** Agrupa os termos na tela do glossário. */
export type CategoriaTermo =
  | "Gregas"
  | "Volatilidade"
  | "Preços e resultado"
  | "Técnico"
  | "Fundamentos"
  | "Estruturas"
  | "Liquidez"
  | "Operação";

export interface Termo {
  /** Identificador estável e âncora no glossário (ex.: `#iv-rank`). */
  slug: string;
  /** Como o termo aparece (ex.: "IV Rank"). */
  termo: string;
  /** Explicação de UMA linha, para o tooltip. */
  curto: string;
  /** Explicação completa (1–2 frases), para a tela do glossário. */
  longo: string;
  categoria: CategoriaTermo;
}

/**
 * Termos iniciais do MVP. Cobrem o que o PRD cita explicitamente (gregas, IV
 * Rank, skew, breakeven) e o vocabulário mínimo das telas de cadeia/montador.
 */
export const GLOSSARIO: readonly Termo[] = [
  // ── Gregas ─────────────────────────────────────────────────────────────────
  {
    slug: "gregas",
    termo: "Gregas",
    curto:
      "Medidas de como o preço da opção reage a mudanças (preço do ativo, tempo e volatilidade).",
    longo:
      "“Gregas” é o apelido de um grupo de medidas (delta, gama, theta, vega, rho) que mostram o quanto o preço de uma opção tende a mudar quando o ativo se move, o tempo passa ou a volatilidade muda. Servem para entender o comportamento da operação antes de montá-la.",
    categoria: "Gregas",
  },
  {
    slug: "delta",
    termo: "Delta",
    curto:
      "Quanto o preço da opção tende a variar para cada R$ 1 de variação no ativo.",
    longo:
      "O delta indica o quanto o preço da opção sobe ou desce, aproximadamente, para cada R$ 1 de variação no ativo-objeto. Um delta de 0,50 sugere que a opção anda cerca de R$ 0,50 quando o ativo anda R$ 1. Também é lido, de forma simplificada, como uma ideia da chance de a opção “valer” no vencimento.",
    categoria: "Gregas",
  },
  {
    slug: "gama",
    termo: "Gama",
    curto: "A velocidade com que o delta muda quando o ativo se move.",
    longo:
      "O gama mede o quanto o próprio delta muda conforme o ativo se mexe. Gama alto significa que a sensibilidade da opção (o delta) muda rápido — a operação fica mais “nervosa” perto do strike.",
    categoria: "Gregas",
  },
  {
    slug: "theta",
    termo: "Theta",
    curto:
      "Quanto a opção perde de valor a cada dia que passa (desgaste do tempo).",
    longo:
      "O theta é o “desgaste do tempo”: estima quanto a opção perde de valor a cada dia que passa, mantido o resto igual. Quem compra opção costuma ter theta contra; quem vende costuma ter theta a favor.",
    categoria: "Gregas",
  },
  {
    slug: "vega",
    termo: "Vega",
    curto:
      "Quanto o preço da opção muda quando a volatilidade implícita sobe ou desce.",
    longo:
      "O vega mostra o quanto o preço da opção reage a mudanças na volatilidade implícita (IV). Se a IV sobe, opções com vega alto tendem a ficar mais caras; se a IV cai, mais baratas — independentemente de o ativo se mover.",
    categoria: "Gregas",
  },
  {
    slug: "rho",
    termo: "Rho",
    curto: "Sensibilidade do preço da opção à taxa de juros.",
    longo:
      "O rho mede o quanto o preço da opção muda quando a taxa de juros muda. No dia a dia de quem está começando, costuma ser a grega menos importante.",
    categoria: "Gregas",
  },

  // ── Volatilidade ───────────────────────────────────────────────────────────
  {
    slug: "volatilidade-implicita",
    termo: "Volatilidade implícita (IV)",
    curto:
      "A expectativa de oscilação do ativo embutida no preço das opções, em %.",
    longo:
      "A volatilidade implícita (IV) é a “expectativa de balanço” do ativo que está embutida no preço das opções. IV alta encarece as opções (o mercado espera movimento); IV baixa as deixa mais baratas. Não diz a direção, só a intensidade esperada.",
    categoria: "Volatilidade",
  },
  {
    slug: "iv-rank",
    termo: "IV Rank",
    curto:
      "Onde a IV de hoje está entre a mínima e a máxima do último período (0% a 100%).",
    longo:
      "O IV Rank coloca a volatilidade implícita de hoje numa régua de 0% a 100% comparando com o intervalo do último período (ex.: 1 ano). Perto de 100% a IV está “cara” frente ao histórico (tende a favorecer estruturas vendidas); perto de 0% está “barata” (tende a favorecer compradas). Existe no nível do ativo, não por contrato.",
    categoria: "Volatilidade",
  },
  {
    slug: "skew",
    termo: "Skew",
    curto:
      "A diferença de volatilidade implícita entre strikes/lados (puts vs. calls).",
    longo:
      "Skew é a assimetria da volatilidade implícita entre diferentes strikes ou entre puts e calls. Em geral, puts de proteção custam uma IV maior — sinal de que o mercado paga mais caro para se proteger de quedas.",
    categoria: "Volatilidade",
  },

  // ── Preços e resultado ─────────────────────────────────────────────────────
  {
    slug: "premio",
    termo: "Prêmio",
    curto: "O preço da opção — quanto se paga (ou recebe) por contrato.",
    longo:
      "O prêmio é o preço da opção: o valor que você paga ao comprar ou recebe ao vender o contrato. Numa operação de várias pernas, o resultado financeiro de montar é a soma dos prêmios pagos e recebidos.",
    categoria: "Preços e resultado",
  },
  {
    slug: "strike",
    termo: "Strike",
    curto: "O preço de exercício combinado na opção.",
    longo:
      "O strike é o preço de exercício da opção — o valor de referência no qual o direito da opção passa a “valer”. É um dos campos que definem cada perna de uma estrutura.",
    categoria: "Preços e resultado",
  },
  {
    slug: "moneyness",
    termo: "ITM / ATM / OTM",
    curto:
      "Se o strike está “dentro” (ITM), “no” (ATM) ou “fora” (OTM) do dinheiro.",
    longo:
      "Moneyness descreve a posição do strike frente ao preço do ativo: ITM (dentro do dinheiro) já teria valor de exercício; ATM (no dinheiro) está perto do preço atual; OTM (fora do dinheiro) ainda não teria valor de exercício. Influencia prêmio e probabilidade.",
    categoria: "Preços e resultado",
  },
  {
    slug: "breakeven",
    termo: "Breakeven",
    curto:
      "O preço do ativo no vencimento em que a operação não ganha nem perde.",
    longo:
      "O breakeven (ponto de equilíbrio) é o preço do ativo no vencimento em que a operação empata — nem lucro nem prejuízo. Acima ou abaixo dele a operação passa a ganhar ou perder, conforme a estrutura. Algumas estruturas têm mais de um breakeven.",
    categoria: "Preços e resultado",
  },
  {
    slug: "payoff",
    termo: "Payoff",
    curto:
      "O gráfico de quanto a operação ganha ou perde para cada preço do ativo no vencimento.",
    longo:
      "O payoff é a curva que mostra o resultado da operação (ganho ou perda) para cada preço possível do ativo no vencimento. É a forma visual de enxergar risco máximo, ganho máximo e os breakevens de uma só vez.",
    categoria: "Preços e resultado",
  },

  // ── Técnico (§8.2) ───────────────────────────────────────────────────────────
  {
    slug: "media-movel",
    termo: "Média móvel",
    curto: "A média dos preços de fechamento dos últimos N períodos, que suaviza o ruído.",
    longo:
      "A média móvel calcula a média dos fechamentos dos últimos N períodos (ex.: 20 ou 50 dias) e acompanha o preço suavizando as oscilações. Preço acima da média sugere força de curto prazo; abaixo, fraqueza. É uma referência de tendência, não uma garantia.",
    categoria: "Técnico",
  },
  {
    slug: "rsi",
    termo: "RSI",
    curto: "Índice de força relativa (0–100): acima de 70 = sobrecompra; abaixo de 30 = sobrevenda.",
    longo:
      "O RSI (Índice de Força Relativa) mede a velocidade e a magnitude das altas frente às quedas, numa escala de 0 a 100. Acima de ~70 indica sobrecompra (movimento possivelmente esticado); abaixo de ~30, sobrevenda. É um termômetro, não um gatilho de ordem.",
    categoria: "Técnico",
  },
  {
    slug: "macd",
    termo: "MACD",
    curto: "Diferença entre duas médias exponenciais e sua linha de sinal — mede momentum.",
    longo:
      "O MACD compara duas médias móveis exponenciais (12 e 26) e uma linha de sinal (9). Quando o MACD está acima do sinal, o momentum de curto prazo é comprador; abaixo, vendedor. O histograma mostra a distância entre os dois.",
    categoria: "Técnico",
  },
  {
    slug: "suporte-resistencia",
    termo: "Suporte e resistência",
    curto: "Faixas de preço onde costumam aparecer compradores (suporte) ou vendedores (resistência).",
    longo:
      "Suporte é a região de preço onde a queda tende a encontrar compradores; resistência, onde a alta tende a encontrar vendedores. São zonas de referência observadas no histórico — úteis para situar onde o preço está, não níveis mágicos.",
    categoria: "Técnico",
  },
  {
    slug: "momentum",
    termo: "Momentum",
    curto: "A força e a direção de um movimento de preço — se ele está ganhando ou perdendo fôlego.",
    longo:
      "Momentum é a 'embalagem' do movimento: mede se o preço está acelerando ou desacelerando numa direção. Indicadores como o MACD tentam capturar esse fôlego — momentum comprador quando a alta ganha força, vendedor quando a queda ganha força. É uma leitura de contexto, não um sinal de entrada.",
    categoria: "Técnico",
  },
  {
    slug: "cruzamento-medias",
    termo: "Cruzamento de médias",
    curto: "Quando uma média curta passa acima (alta) ou abaixo (baixa) de uma média mais longa.",
    longo:
      "Um cruzamento de alta ocorre quando uma média curta (ex.: 9 ou 50 pregões) passa acima de uma mais longa (21 ou 200) — sinal de que os preços recentes superaram a referência mais lenta. O de baixa é o contrário. São observações de tendência muito acompanhadas, mas que falham com frequência — nunca uma garantia.",
    categoria: "Técnico",
  },
  {
    slug: "volume",
    termo: "Volume",
    curto: "Quantidade negociada num período — mede a participação por trás do movimento.",
    longo:
      "Volume é o quanto foi negociado no período. Um movimento com volume acima da média tende a ser mais confiável (mais participação); com volume baixo, menos. No ativo-objeto, ajuda a validar a força de uma alta ou queda.",
    categoria: "Técnico",
  },

  // ── Fundamentos (§8.2) ─────────────────────────────────────────────────────────
  {
    slug: "preco-lucro",
    termo: "P/L (Preço/Lucro)",
    curto: "Quanto o mercado paga por R$ 1 de lucro anual da empresa.",
    longo:
      "O P/L divide o preço da ação pelo lucro por ação. Indica quantos anos de lucro atual o mercado está disposto a pagar pela ação. Só faz sentido comparado ao setor e ao histórico da própria empresa — sozinho não diz se está cara ou barata.",
    categoria: "Fundamentos",
  },
  {
    slug: "ev-ebitda",
    termo: "EV/EBITDA",
    curto: "Valor da empresa (com dívida) frente à sua geração operacional de caixa.",
    longo:
      "O EV/EBITDA relaciona o valor da empresa (incluindo dívida) com o EBITDA (geração operacional de caixa). É útil para comparar empresas com endividamentos diferentes. Como todo múltiplo, vale por comparação, não isolado.",
    categoria: "Fundamentos",
  },
  {
    slug: "preco-valor-patrimonial",
    termo: "P/VP (Preço/Valor Patrimonial)",
    curto: "Relação entre o preço da ação e o valor patrimonial por ação.",
    longo:
      "O P/VP compara o preço com o patrimônio líquido por ação. Abaixo de 1 significa que o mercado paga menos que o valor contábil — o que pode indicar desconto ou problemas. Interpretação depende do setor.",
    categoria: "Fundamentos",
  },
  {
    slug: "margem-liquida",
    termo: "Margem líquida",
    curto: "Parte da receita que sobra como lucro depois de todos os custos e impostos.",
    longo:
      "A margem líquida é o lucro líquido dividido pela receita. Mostra quanto de cada R$ 1 vendido vira lucro. Margens crescentes costumam indicar eficiência; quedas pedem atenção aos próximos resultados.",
    categoria: "Fundamentos",
  },
  {
    slug: "dividend-yield",
    termo: "Dividend yield",
    curto: "Retorno em proventos (dividendos/JCP) sobre o preço atual da ação, ao ano.",
    longo:
      "O dividend yield mostra quanto a empresa distribuiu em proventos no último período frente ao preço atual. Yield alto pode ser atrativo para renda, mas também pode refletir queda do preço — olhe junto com a saúde dos lucros.",
    categoria: "Fundamentos",
  },
  {
    slug: "roe",
    termo: "ROE (Retorno sobre o Patrimônio)",
    curto: "Quanto de lucro a empresa gera sobre o dinheiro dos acionistas, ao ano.",
    longo:
      "O ROE (Return on Equity) divide o lucro líquido pelo patrimônio líquido. Mostra a eficiência da empresa em transformar o capital dos sócios em lucro. ROE alto e consistente costuma indicar negócio rentável, mas compare ao setor e veja se não vem de endividamento excessivo.",
    categoria: "Fundamentos",
  },
  {
    slug: "roic",
    termo: "ROIC (Retorno sobre o Capital Investido)",
    curto: "Retorno que a empresa gera sobre TODO o capital investido (sócios + dívida).",
    longo:
      "O ROIC (Return on Invested Capital) mede o retorno sobre o capital total empregado no negócio, incluindo dívida. Comparado ao custo desse capital, indica se a empresa cria ou destrói valor. É um dos retornos mais usados para avaliar qualidade operacional.",
    categoria: "Fundamentos",
  },
  {
    slug: "roa",
    termo: "ROA (Retorno sobre os Ativos)",
    curto: "Quanto de lucro a empresa gera sobre o total de ativos que possui.",
    longo:
      "O ROA (Return on Assets) divide o lucro líquido pelo total de ativos. Mostra a eficiência em usar tudo o que a empresa tem (máquinas, estoques, caixa) para gerar lucro. Útil para comparar empresas do mesmo setor com estruturas de ativos parecidas.",
    categoria: "Fundamentos",
  },

  // ── Estruturas ─────────────────────────────────────────────────────────────
  {
    slug: "risco-definido",
    termo: "Risco definido",
    curto:
      "A perda máxima é conhecida e limitada desde a montagem da operação.",
    longo:
      "Numa estrutura de risco definido, a perda máxima possível é conhecida e limitada já na montagem (ex.: travas, borboletas, condores). Você sabe de antemão o pior caso em reais.",
    categoria: "Estruturas",
  },
  {
    slug: "risco-indefinido",
    termo: "Risco indefinido",
    curto:
      "A perda pode ser muito maior que o valor recebido — sem teto claro.",
    longo:
      "Numa estrutura de risco indefinido (ex.: venda a descoberto, straddle/strangle vendido), a perda potencial não tem um teto claro e pode superar — e muito — o prêmio recebido. Exige margem e atenção redobrada com o risco.",
    categoria: "Estruturas",
  },
  {
    slug: "trava-de-alta",
    termo: "Trava de alta",
    curto:
      "Estrutura de risco definido que aposta numa subida moderada do ativo.",
    longo:
      "A trava de alta combina duas opções de mesmo vencimento (compra de um strike e venda de outro mais alto) para apostar numa subida moderada do ativo, com risco e ganho máximos limitados e conhecidos.",
    categoria: "Estruturas",
  },
  {
    slug: "trava-de-baixa",
    termo: "Trava de baixa",
    curto:
      "Estrutura de risco definido que aposta numa queda moderada do ativo.",
    longo:
      "A trava de baixa é o espelho da trava de alta: combina dois strikes para se beneficiar de uma queda moderada do ativo, também com risco e ganho máximos limitados.",
    categoria: "Estruturas",
  },
  {
    slug: "borboleta",
    termo: "Borboleta",
    curto:
      "Três strikes que lucram se o ativo terminar perto do strike do meio.",
    longo:
      "A borboleta usa três strikes para criar uma faixa estreita de lucro em torno do strike central. É de risco definido e costuma render mais quando o ativo fica “parado” perto do meio até o vencimento.",
    categoria: "Estruturas",
  },
  {
    slug: "condor",
    termo: "Condor",
    curto:
      "Quatro strikes que lucram numa faixa mais larga de preços do ativo.",
    longo:
      "O condor é parecido com a borboleta, mas usa quatro strikes para abrir uma faixa de lucro mais larga. De risco definido, beneficia-se de o ativo ficar dentro de um intervalo até o vencimento.",
    categoria: "Estruturas",
  },
  {
    slug: "straddle",
    termo: "Straddle",
    curto:
      "Compra (ou venda) de call e put no mesmo strike — aposta no tamanho do movimento.",
    longo:
      "O straddle combina uma call e uma put de mesmo strike e vencimento. Comprado, ganha com movimentos fortes para qualquer lado; vendido (risco indefinido), ganha se o ativo ficar parado. Não aposta na direção, e sim no tamanho do movimento.",
    categoria: "Estruturas",
  },
  {
    slug: "strangle",
    termo: "Strangle",
    curto:
      "Como o straddle, mas com strikes diferentes — mais barato e mais largo.",
    longo:
      "O strangle é como o straddle, mas usa strikes diferentes para call e put. Sai mais barato e precisa de um movimento maior para dar lucro quando comprado. Vendido, tem risco indefinido.",
    categoria: "Estruturas",
  },
  {
    slug: "venda-coberta",
    termo: "Venda coberta",
    curto:
      "Venda de uma call sobre um ativo que você já possui, para receber prêmio.",
    longo:
      "Na venda coberta, vende-se uma call tendo o ativo-objeto em carteira. O Babilônia trata apenas a perna de opção (§3.2) — a parte do ativo à vista está fora do escopo. Serve para receber prêmio em troca de abrir mão de parte da alta.",
    categoria: "Estruturas",
  },

  // ── Liquidez ───────────────────────────────────────────────────────────────
  {
    slug: "liquidez",
    termo: "Liquidez",
    curto:
      "A facilidade de comprar/vender a opção pelo preço esperado, sem sustos.",
    longo:
      "Liquidez é a facilidade de entrar e sair de uma opção pelo preço esperado. Séries pouco negociadas podem ter spread largo e dificuldade de execução — a ordem precisa ser “digitável” no home broker (§2, princípio 5).",
    categoria: "Liquidez",
  },
  {
    slug: "spread",
    termo: "Spread",
    curto:
      "A diferença entre o melhor preço de compra (bid) e de venda (ask).",
    longo:
      "O spread é a distância entre o melhor preço de compra (bid) e o de venda (ask). Spread largo encarece entrar e sair da posição e costuma sinalizar baixa liquidez.",
    categoria: "Liquidez",
  },
  {
    slug: "open-interest",
    termo: "Open interest",
    curto:
      "Número de contratos em aberto numa série — o COTAHIST/B3 não fornece (§6.4).",
    longo:
      "Open interest é a quantidade de contratos em aberto numa série de opção, usada como indício de liquidez. A fonte da cadeia (COTAHIST/B3) não fornece esse dado (§6.4); por isso o Babilônia avalia a liquidez por volume, número de negócios e spread.",
    categoria: "Liquidez",
  },

  // ── Operação ───────────────────────────────────────────────────────────────
  {
    slug: "vencimento",
    termo: "Vencimento",
    curto: "A data em que a opção expira e seus direitos deixam de existir.",
    longo:
      "O vencimento é a data em que a opção expira. Perto do vencimento o tempo “corre” mais rápido (theta) e o risco de exercício/atribuição aumenta — o app alerta nos últimos dias úteis (§10).",
    categoria: "Operação",
  },
  {
    slug: "exercicio",
    termo: "Exercício / atribuição",
    curto:
      "Quando o direito da opção é acionado — você exerce, ou tem a sua opção exercida.",
    longo:
      "Exercício é acionar o direito da opção; atribuição é quando uma opção que você vendeu é exercida contra você. Perto do vencimento, opções dentro do dinheiro têm mais chance de exercício — algo a acompanhar para não ser pego de surpresa.",
    categoria: "Operação",
  },
  {
    slug: "ticket",
    termo: "Ticket de operação",
    curto:
      "O resumo padronizado da operação, pronto para você digitar a ordem no home broker.",
    longo:
      "O ticket é o resumo padronizado da operação montada (ativo, pernas, quantidades, preços, risco máximo, breakevens, observações). O Babilônia gera o ticket para você conferir e digitar a ordem manualmente — ele nunca envia ordens.",
    categoria: "Operação",
  },
] as const;

/** Mapa slug → termo, para busca O(1) no `<TermoTecnico>`. */
const PORSLUG: ReadonlyMap<string, Termo> = new Map(
  GLOSSARIO.map((t) => [t.slug, t]),
);

/** Busca um termo pelo slug; `undefined` se não existir. */
export function getTermo(slug: string): Termo | undefined {
  return PORSLUG.get(slug);
}

/** Ordem de exibição das categorias na tela do glossário. */
export const CATEGORIAS_ORDEM: readonly CategoriaTermo[] = [
  "Gregas",
  "Volatilidade",
  "Preços e resultado",
  "Técnico",
  "Fundamentos",
  "Estruturas",
  "Liquidez",
  "Operação",
] as const;

/** Agrupa os termos por categoria, na ordem de `CATEGORIAS_ORDEM`. */
export function termosPorCategoria(): { categoria: CategoriaTermo; termos: Termo[] }[] {
  return CATEGORIAS_ORDEM.map((categoria) => ({
    categoria,
    termos: GLOSSARIO.filter((t) => t.categoria === categoria),
  }));
}
