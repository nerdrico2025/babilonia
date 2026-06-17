/**
 * catalogo — o CATÁLOGO de estruturas do Montador (tela 6, §8.4).
 *
 * Módulo PURO. Para cada variante que o §8.4 pede (travas de alta/baixa em
 * débito e crédito, borboleta, condor, straddle/strangle comprado/vendido, venda
 * coberta) ele declara:
 *  - os CAMPOS que o usuário preenche (strikes e prêmios), em linguagem de leigo;
 *  - a explicação "quando faz sentido" e "o que pode dar errado" (§8.4 item 5);
 *  - o slug do glossário para o `<TermoTecnico>` (§2);
 *  - um `montar()` que delega 100% a `lib/options-math` — assim TODO número
 *    (risco, ganho, breakevens, curva) vem do núcleo puro e testado, nunca da UI.
 *
 * É a fronteira que mantém a UI "burra": a tela coleta números e chama `montar`;
 * a matemática mora só no núcleo (§5.1).
 */

import {
  type FaixaPrecos,
  type ResultadoEstrutura,
  borboletaCalls,
  condorCalls,
  straddleComprado,
  straddleVendido,
  strangleComprado,
  strangleVendido,
  travaAltaCallDebito,
  travaAltaPutCredito,
  travaBaixaCallCredito,
  travaBaixaPutDebito,
  vendaCoberta,
} from "@/lib/options-math";

/** Identificador de cada variante de estrutura do catálogo. */
export type EstruturaId =
  | "trava_alta_debito"
  | "trava_alta_credito"
  | "trava_baixa_debito"
  | "trava_baixa_credito"
  | "borboleta"
  | "condor"
  | "straddle_comprado"
  | "straddle_vendido"
  | "strangle_comprado"
  | "strangle_vendido"
  | "venda_coberta";

/**
 * Família da estrutura — alinhada ao enum `structureType` do schema (§7), para
 * gravar a posição depois. As variantes (débito/crédito, comprado/vendido) ficam
 * implícitas nas pernas.
 */
export type FamiliaEstrutura =
  | "trava_alta"
  | "trava_baixa"
  | "borboleta"
  | "condor"
  | "straddle"
  | "strangle"
  | "venda_coberta";

/** Natureza de um campo de entrada: preço de exercício ou prêmio da opção. */
export type TipoCampo = "strike" | "premio";

/** Um campo numérico que o usuário preenche para montar a estrutura. */
export interface CampoEstrutura {
  /** Chave passada ao `montar` (ex.: "k1", "premioK1", "premioCall"). */
  chave: string;
  /** Rótulo claro para leigo (ex.: "Strike da call que você COMPRA"). */
  rotulo: string;
  tipo: TipoCampo;
  /** Dica curta opcional abaixo do campo. */
  ajuda?: string;
}

/** Entrada de montagem — só números, coletados pela UI. */
export interface EntradaMontagem {
  /** Valor de cada campo, pela `chave` (strikes e prêmios, por ação em BRL). */
  valores: Record<string, number>;
  /** Quantidade da estrutura em contratos (multiplica todas as pernas). */
  quantidade: number;
  /** Faixa de preços da curva (opcional; o núcleo sugere uma em torno dos strikes). */
  faixa?: FaixaPrecos;
}

/** Definição completa de uma variante no catálogo. */
export interface EstruturaDef {
  id: EstruturaId;
  familia: FamiliaEstrutura;
  /** Nome curto exibido (ex.: "Trava de alta (débito)"). */
  nome: string;
  /** Resumo de uma linha para o card de seleção. */
  resumo: string;
  /** Descrição das pernas, em palavras (ex.: "Compra 1 call e vende 1 call mais alta"). */
  resumoPernas: string;
  /** Slug do glossário para o `<TermoTecnico>` (§2). */
  glossarioSlug: string;
  /** Risco esperado da variante — para sinalizar já na seleção (§2). */
  riscoEsperado: "DEFINIDO" | "INDEFINIDO";
  /** Quando esta estrutura costuma fazer sentido (§8.4 item 5). */
  quandoFazSentido: string;
  /** O que pode dar errado — alerta honesto para o leigo (§8.4 item 5). */
  oQuePodeDarErrado: string;
  /** Campos a preencher (strikes/prêmios), na ordem de exibição. */
  campos: CampoEstrutura[];
  /** Monta a estrutura delegando ao núcleo `lib/options-math`. */
  montar: (entrada: EntradaMontagem) => ResultadoEstrutura;
}

/** Agrupamento das variantes na tela de seleção (passo 1 do wizard). */
export interface GrupoEstruturas {
  titulo: string;
  /** Frase "para leigos" do que o grupo busca. */
  descricao: string;
  ids: EstruturaId[];
}

// Lê um campo obrigatório da entrada (a UI valida presença antes de montar).
function v(entrada: EntradaMontagem, chave: string): number {
  const valor = entrada.valores[chave];
  if (valor == null || Number.isNaN(valor)) {
    throw new Error(`Falta preencher o campo "${chave}".`);
  }
  return valor;
}

// Campos reutilizados pelas travas verticais (dois strikes + dois prêmios).
function camposTrava(
  rotuloK1: string,
  rotuloK2: string,
): CampoEstrutura[] {
  return [
    { chave: "k1", rotulo: rotuloK1, tipo: "strike" },
    { chave: "k2", rotulo: rotuloK2, tipo: "strike", ajuda: "Precisa ser maior que o strike de baixo." },
    { chave: "premioK1", rotulo: `Prêmio da opção de ${rotuloK1.toLowerCase()}`, tipo: "premio" },
    { chave: "premioK2", rotulo: `Prêmio da opção de ${rotuloK2.toLowerCase()}`, tipo: "premio" },
  ];
}

/**
 * O CATÁLOGO. Cada `montar` repassa os números à função nomeada de
 * `lib/options-math` — a única fonte da verdade dos cálculos (§5.1).
 */
export const CATALOGO: Record<EstruturaId, EstruturaDef> = {
  // ── Travas verticais ────────────────────────────────────────────────────────
  trava_alta_debito: {
    id: "trava_alta_debito",
    familia: "trava_alta",
    nome: "Trava de alta (débito, calls)",
    resumo: "Aposta numa subida moderada do ativo, pagando um custo conhecido.",
    resumoPernas: "Compra 1 call (strike menor) e vende 1 call (strike maior).",
    glossarioSlug: "trava-de-alta",
    riscoEsperado: "DEFINIDO",
    quandoFazSentido:
      "Quando você acha que o ativo vai subir de forma moderada até o vencimento e quer pagar pouco, com a perda limitada ao que desembolsou.",
    oQuePodeDarErrado:
      "Se o ativo não subir o suficiente (ficar abaixo do breakeven), você perde o que pagou. O ganho também é limitado — não acompanha uma alta forte.",
    campos: camposTrava("Strike da call comprada", "Strike da call vendida"),
    montar: (e) =>
      travaAltaCallDebito({
        k1: v(e, "k1"),
        k2: v(e, "k2"),
        premioK1: v(e, "premioK1"),
        premioK2: v(e, "premioK2"),
        quantidade: e.quantidade,
        faixa: e.faixa,
      }),
  },
  trava_alta_credito: {
    id: "trava_alta_credito",
    familia: "trava_alta",
    nome: "Trava de alta (crédito, puts)",
    resumo: "Recebe um prêmio apostando que o ativo NÃO cai abaixo de um nível.",
    resumoPernas: "Vende 1 put (strike maior) e compra 1 put (strike menor) para proteger.",
    glossarioSlug: "trava-de-alta",
    riscoEsperado: "DEFINIDO",
    quandoFazSentido:
      "Quando você acredita que o ativo vai ficar de lado ou subir, e prefere receber o prêmio agora. A perda é limitada pela put comprada.",
    oQuePodeDarErrado:
      "Se o ativo cair abaixo do breakeven, você perde — até o limite definido pela trava. O ganho é só o prêmio recebido.",
    campos: camposTrava("Strike da put comprada", "Strike da put vendida"),
    montar: (e) =>
      travaAltaPutCredito({
        k1: v(e, "k1"),
        k2: v(e, "k2"),
        premioK1: v(e, "premioK1"),
        premioK2: v(e, "premioK2"),
        quantidade: e.quantidade,
        faixa: e.faixa,
      }),
  },
  trava_baixa_debito: {
    id: "trava_baixa_debito",
    familia: "trava_baixa",
    nome: "Trava de baixa (débito, puts)",
    resumo: "Aposta numa queda moderada do ativo, pagando um custo conhecido.",
    resumoPernas: "Compra 1 put (strike maior) e vende 1 put (strike menor).",
    glossarioSlug: "trava-de-baixa",
    riscoEsperado: "DEFINIDO",
    quandoFazSentido:
      "Quando você acha que o ativo vai cair de forma moderada e quer um custo limitado, com perda máxima igual ao que pagou.",
    oQuePodeDarErrado:
      "Se o ativo não cair o suficiente, você perde o valor pago. O ganho é limitado e não acompanha uma queda muito forte.",
    campos: camposTrava("Strike da put vendida", "Strike da put comprada"),
    montar: (e) =>
      travaBaixaPutDebito({
        k1: v(e, "k1"),
        k2: v(e, "k2"),
        premioK1: v(e, "premioK1"),
        premioK2: v(e, "premioK2"),
        quantidade: e.quantidade,
        faixa: e.faixa,
      }),
  },
  trava_baixa_credito: {
    id: "trava_baixa_credito",
    familia: "trava_baixa",
    nome: "Trava de baixa (crédito, calls)",
    resumo: "Recebe um prêmio apostando que o ativo NÃO sobe acima de um nível.",
    resumoPernas: "Vende 1 call (strike menor) e compra 1 call (strike maior) para proteger.",
    glossarioSlug: "trava-de-baixa",
    riscoEsperado: "DEFINIDO",
    quandoFazSentido:
      "Quando você acredita que o ativo vai ficar de lado ou cair, e prefere receber o prêmio agora. A perda é limitada pela call comprada.",
    oQuePodeDarErrado:
      "Se o ativo subir acima do breakeven, você perde — até o limite da trava. O ganho é só o prêmio recebido.",
    campos: camposTrava("Strike da call vendida", "Strike da call comprada"),
    montar: (e) =>
      travaBaixaCallCredito({
        k1: v(e, "k1"),
        k2: v(e, "k2"),
        premioK1: v(e, "premioK1"),
        premioK2: v(e, "premioK2"),
        quantidade: e.quantidade,
        faixa: e.faixa,
      }),
  },

  // ── Borboleta e condor ──────────────────────────────────────────────────────
  borboleta: {
    id: "borboleta",
    familia: "borboleta",
    nome: "Borboleta (calls)",
    resumo: "Lucra se o ativo terminar perto do strike do meio.",
    resumoPernas: "Compra 1 call (K1), vende 2 calls (K2, no meio) e compra 1 call (K3).",
    glossarioSlug: "borboleta",
    riscoEsperado: "DEFINIDO",
    quandoFazSentido:
      "Quando você acha que o ativo vai ficar 'parado' perto de um preço (o strike do meio) até o vencimento. Custo e perda baixos e conhecidos.",
    oQuePodeDarErrado:
      "Se o ativo se afastar do strike central, o ganho some e você perde o valor pago. Os três strikes precisam ser equidistantes.",
    campos: [
      { chave: "k1", rotulo: "Strike de baixo (K1)", tipo: "strike" },
      { chave: "k2", rotulo: "Strike do meio (K2)", tipo: "strike", ajuda: "Equidistante de K1 e K3." },
      { chave: "k3", rotulo: "Strike de cima (K3)", tipo: "strike" },
      { chave: "premioK1", rotulo: "Prêmio da call de K1", tipo: "premio" },
      { chave: "premioK2", rotulo: "Prêmio da call de K2", tipo: "premio" },
      { chave: "premioK3", rotulo: "Prêmio da call de K3", tipo: "premio" },
    ],
    montar: (e) =>
      borboletaCalls({
        k1: v(e, "k1"),
        k2: v(e, "k2"),
        k3: v(e, "k3"),
        premioK1: v(e, "premioK1"),
        premioK2: v(e, "premioK2"),
        premioK3: v(e, "premioK3"),
        quantidade: e.quantidade,
        faixa: e.faixa,
      }),
  },
  condor: {
    id: "condor",
    familia: "condor",
    nome: "Condor (calls)",
    resumo: "Lucra se o ativo terminar dentro de uma faixa mais larga de preços.",
    resumoPernas: "Compra 1 call (K1), vende 1 (K2), vende 1 (K3) e compra 1 (K4).",
    glossarioSlug: "condor",
    riscoEsperado: "DEFINIDO",
    quandoFazSentido:
      "Como a borboleta, mas para uma faixa de preços mais ampla: você acha que o ativo fica entre dois níveis até o vencimento.",
    oQuePodeDarErrado:
      "Se o ativo sair da faixa (abaixo de K1 ou acima de K4), você perde o valor pago. O ganho é limitado ao platô entre os strikes do meio.",
    campos: [
      { chave: "k1", rotulo: "Strike 1 (mais baixo)", tipo: "strike" },
      { chave: "k2", rotulo: "Strike 2", tipo: "strike" },
      { chave: "k3", rotulo: "Strike 3", tipo: "strike" },
      { chave: "k4", rotulo: "Strike 4 (mais alto)", tipo: "strike" },
      { chave: "premioK1", rotulo: "Prêmio da call de K1", tipo: "premio" },
      { chave: "premioK2", rotulo: "Prêmio da call de K2", tipo: "premio" },
      { chave: "premioK3", rotulo: "Prêmio da call de K3", tipo: "premio" },
      { chave: "premioK4", rotulo: "Prêmio da call de K4", tipo: "premio" },
    ],
    montar: (e) =>
      condorCalls({
        k1: v(e, "k1"),
        k2: v(e, "k2"),
        k3: v(e, "k3"),
        k4: v(e, "k4"),
        premioK1: v(e, "premioK1"),
        premioK2: v(e, "premioK2"),
        premioK3: v(e, "premioK3"),
        premioK4: v(e, "premioK4"),
        quantidade: e.quantidade,
        faixa: e.faixa,
      }),
  },

  // ── Straddle e strangle ─────────────────────────────────────────────────────
  straddle_comprado: {
    id: "straddle_comprado",
    familia: "straddle",
    nome: "Straddle comprado",
    resumo: "Aposta num movimento FORTE, para qualquer lado.",
    resumoPernas: "Compra 1 call e 1 put no mesmo strike.",
    glossarioSlug: "straddle",
    riscoEsperado: "DEFINIDO",
    quandoFazSentido:
      "Quando você espera um movimento grande (ex.: balanço, notícia), mas não sabe a direção. A perda é limitada à soma dos prêmios pagos.",
    oQuePodeDarErrado:
      "Se o ativo ficar parado perto do strike, o tempo corrói os prêmios e você perde quase tudo o que pagou. É a estrutura mais cara das duas pernas.",
    campos: [
      { chave: "k", rotulo: "Strike (call e put no mesmo nível)", tipo: "strike" },
      { chave: "premioCall", rotulo: "Prêmio da call", tipo: "premio" },
      { chave: "premioPut", rotulo: "Prêmio da put", tipo: "premio" },
    ],
    montar: (e) =>
      straddleComprado({
        k: v(e, "k"),
        premioCall: v(e, "premioCall"),
        premioPut: v(e, "premioPut"),
        quantidade: e.quantidade,
        faixa: e.faixa,
      }),
  },
  straddle_vendido: {
    id: "straddle_vendido",
    familia: "straddle",
    nome: "Straddle vendido",
    resumo: "Recebe os prêmios apostando que o ativo fica PARADO. Risco indefinido.",
    resumoPernas: "Vende 1 call e 1 put no mesmo strike.",
    glossarioSlug: "straddle",
    riscoEsperado: "INDEFINIDO",
    quandoFazSentido:
      "Quando você espera que o ativo fique de lado e quer receber os prêmios. Exige margem e atenção redobrada.",
    oQuePodeDarErrado:
      "Risco INDEFINIDO: se o ativo se mexer muito (para cima ou para baixo), a perda pode superar — e muito — os prêmios recebidos.",
    campos: [
      { chave: "k", rotulo: "Strike (call e put no mesmo nível)", tipo: "strike" },
      { chave: "premioCall", rotulo: "Prêmio da call", tipo: "premio" },
      { chave: "premioPut", rotulo: "Prêmio da put", tipo: "premio" },
    ],
    montar: (e) =>
      straddleVendido({
        k: v(e, "k"),
        premioCall: v(e, "premioCall"),
        premioPut: v(e, "premioPut"),
        quantidade: e.quantidade,
        faixa: e.faixa,
      }),
  },
  strangle_comprado: {
    id: "strangle_comprado",
    familia: "strangle",
    nome: "Strangle comprado",
    resumo: "Como o straddle comprado, porém mais barato e precisando de movimento maior.",
    resumoPernas: "Compra 1 put (strike menor) e 1 call (strike maior).",
    glossarioSlug: "strangle",
    riscoEsperado: "DEFINIDO",
    quandoFazSentido:
      "Quando você espera um movimento forte mas quer pagar menos que no straddle. A perda é limitada à soma dos prêmios.",
    oQuePodeDarErrado:
      "Precisa de um movimento maior para dar lucro. Se o ativo ficar entre os dois strikes, você perde os prêmios pagos.",
    campos: [
      { chave: "k1", rotulo: "Strike da put comprada (menor)", tipo: "strike" },
      { chave: "k2", rotulo: "Strike da call comprada (maior)", tipo: "strike" },
      { chave: "premioPut", rotulo: "Prêmio da put", tipo: "premio" },
      { chave: "premioCall", rotulo: "Prêmio da call", tipo: "premio" },
    ],
    montar: (e) =>
      strangleComprado({
        k1: v(e, "k1"),
        k2: v(e, "k2"),
        premioPut: v(e, "premioPut"),
        premioCall: v(e, "premioCall"),
        quantidade: e.quantidade,
        faixa: e.faixa,
      }),
  },
  strangle_vendido: {
    id: "strangle_vendido",
    familia: "strangle",
    nome: "Strangle vendido",
    resumo: "Recebe os prêmios apostando que o ativo fica numa faixa. Risco indefinido.",
    resumoPernas: "Vende 1 put (strike menor) e 1 call (strike maior).",
    glossarioSlug: "strangle",
    riscoEsperado: "INDEFINIDO",
    quandoFazSentido:
      "Quando você espera que o ativo fique dentro de uma faixa e quer receber os prêmios. Exige margem e atenção redobrada.",
    oQuePodeDarErrado:
      "Risco INDEFINIDO: se o ativo romper a faixa para qualquer lado, a perda pode superar — e muito — os prêmios recebidos.",
    campos: [
      { chave: "k1", rotulo: "Strike da put vendida (menor)", tipo: "strike" },
      { chave: "k2", rotulo: "Strike da call vendida (maior)", tipo: "strike" },
      { chave: "premioPut", rotulo: "Prêmio da put", tipo: "premio" },
      { chave: "premioCall", rotulo: "Prêmio da call", tipo: "premio" },
    ],
    montar: (e) =>
      strangleVendido({
        k1: v(e, "k1"),
        k2: v(e, "k2"),
        premioPut: v(e, "premioPut"),
        premioCall: v(e, "premioCall"),
        quantidade: e.quantidade,
        faixa: e.faixa,
      }),
  },

  // ── Venda coberta (só a perna de opção, §3.2) ────────────────────────────────
  venda_coberta: {
    id: "venda_coberta",
    familia: "venda_coberta",
    nome: "Venda coberta (perna de call)",
    resumo: "Vende uma call sobre um ativo que você já tem, para receber prêmio.",
    resumoPernas: "Vende 1 call. O ativo à vista que cobre a posição fica por fora (§3.2).",
    glossarioSlug: "venda-coberta",
    riscoEsperado: "DEFINIDO",
    quandoFazSentido:
      "Quando você já possui o ativo e topa abrir mão da alta acima do strike em troca de receber o prêmio agora.",
    oQuePodeDarErrado:
      "Se o ativo subir muito, você é exercido e abre mão da valorização acima do strike (ou vende o ativo). O Babilônia trata só a perna de opção; o ativo é gerido por você.",
    campos: [
      { chave: "k", rotulo: "Strike da call vendida", tipo: "strike" },
      { chave: "premio", rotulo: "Prêmio recebido pela call", tipo: "premio" },
    ],
    montar: (e) =>
      vendaCoberta({
        k: v(e, "k"),
        premio: v(e, "premio"),
        quantidade: e.quantidade,
        faixa: e.faixa,
      }),
  },
};

/** Grupos do passo de seleção (passo 1 do wizard) — fluxo do §8.4. */
export const GRUPOS: readonly GrupoEstruturas[] = [
  {
    titulo: "Travas (direção com risco limitado)",
    descricao:
      "Apostam numa subida ou queda moderada. Risco e ganho conhecidos desde o início.",
    ids: [
      "trava_alta_debito",
      "trava_alta_credito",
      "trava_baixa_debito",
      "trava_baixa_credito",
    ],
  },
  {
    titulo: "Borboleta e condor (ativo parado / numa faixa)",
    descricao: "Lucram quando o ativo termina perto de um preço ou dentro de um intervalo.",
    ids: ["borboleta", "condor"],
  },
  {
    titulo: "Straddle e strangle (tamanho do movimento)",
    descricao:
      "Não apostam na direção, e sim na intensidade. As versões vendidas têm risco indefinido.",
    ids: [
      "straddle_comprado",
      "strangle_comprado",
      "straddle_vendido",
      "strangle_vendido",
    ],
  },
  {
    titulo: "Venda coberta",
    descricao: "Recebe prêmio vendendo uma call sobre um ativo que você já possui.",
    ids: ["venda_coberta"],
  },
] as const;

/** Busca a definição de uma estrutura pelo id. */
export function getEstrutura(id: EstruturaId): EstruturaDef {
  return CATALOGO[id];
}
