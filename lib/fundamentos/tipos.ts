/**
 * Tipos de domínio dos FUNDAMENTOS do ativo-objeto — módulo NEUTRO (§5.1).
 *
 * SÓ TIPOS: sem imports de DB, UI, integrações ou qualquer runtime. Mesmo racional
 * de `lib/opcoes/tipos.ts`: é a fonte de verdade do FORMATO dos fundamentos,
 * desacoplada da FONTE de dados. Por não ter efeitos nem dependências, pode ser
 * importado pela UI, pelas integrações e por qualquer consumidor — todos falam o
 * mesmo vocabulário.
 *
 * Este tipo NÃO é o shape do `BrapiFundamentos`. Ele é desenhado em função dos
 * campos confirmados disponíveis na fonte nova (bolsai — ver
 * `docs/migracao-fundamentos.md`). O `brapi.ts` segue como fonte viva NESTA etapa;
 * a troca de consumidor vem em prompt futuro. Criar o tipo desacoplado primeiro é o
 * mesmo padrão aditivo usado na saída da OpLab: nasce a fonte/tipo novo ao lado,
 * troca-se o consumo, e só então remove-se o antigo.
 *
 * ── Decisões fechadas (NÃO reabrir ao ler este código no futuro) ──────────────
 * 1. Margem bruta, margem operacional e a série trimestral de lucros
 *    (`lucrosPorTrimestre`) foram ABANDONADAS. Não entram neste tipo, não viram
 *    campo manual e não são derivadas. Simplificação consciente do MVP — mesmo
 *    padrão do open interest que não existia na OpLab/COTAHIST.
 * 2. Dividend yield SAI por inteiro: não existe aqui, não é manual, não é um
 *    `null` disfarçado de "faltando". O campo simplesmente não existe neste tipo.
 * 3. Cotação/preço NÃO mora aqui — passa a ser EOD via `acao_cotahist`, tratado à
 *    parte. Proventos e calendário de resultados também ficam fora (são manuais,
 *    no ticket / outro lugar).
 *
 * Todo campo numérico é nullable porque a fonte pode não cobrir um ativo: a
 * cobertura real foi testada em 12/12 nos campos core da watchlist, mas NÃO se
 * assume cobertura universal nos demais.
 */

export interface Fundamentos {
  ticker: string;
  /** P/L — preço sobre lucro (`pl`). */
  precoLucro: number | null;
  /** EV/EBITDA (`ev_ebitda`). */
  evEbitda: number | null;
  /** P/VP — preço sobre valor patrimonial (`pvp`). */
  precoValorPatrimonial: number | null;
  /** Margem líquida (`net_margin`). */
  margemLiquida: number | null;
  /** Retorno sobre patrimônio líquido (`roe`). */
  roe: number | null;
  /** Retorno sobre capital investido (`roic`). */
  roic: number | null;
  /** Retorno sobre ativos (`roa`). */
  roa: number | null;
  /** Lucro por ação (`lpa`). */
  lpa: number | null;
  /** Valor patrimonial por ação (`vpa`). */
  vpa: number | null;
  /** Valor de mercado (`market_cap`). */
  marketCap: number | null;
  /** Lucro líquido pontual (`net_income`) — NÃO é série trimestral (decisão #1). */
  lucroLiquido: number | null;
  ebitda: number | null;
  /** Data de referência da fonte (`reference_date`), ISO — carimba o frescor. */
  dataReferencia: string;
  /** Nome da empresa (`corporate_name`). */
  nomeEmpresa: string | null;
}
