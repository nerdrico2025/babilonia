# Auditoria de UX — Babilônia

**Data:** 22/06/2026 · **Método:** leitura do código-fonte das telas (`app/`) e
componentes (`components/`). Sem browser, sem alteração de código.
**Escopo:** as 9 telas do §14 do PRD, contra critérios Visual / Fluxo / Princípios
do PRD (§2).

> Esta é uma auditoria de **levantamento** — lista achados, não corrige nada.
> Cada achado traz uma sugestão de uma linha para uma futura rodada de ajustes.

## 1. Resumo executivo

O app está **maduro e coerente**. A casca de navegação (`app-shell`), o cabeçalho
de tela (`Pagina`) e os componentes de princípio (`RotuloRisco`, `Semaforo`,
`DisclaimerBar/Nota`, `TermoTecnico`) são reaproveitados de forma consistente em
todas as telas, e os princípios do §2 — **risco antes do ganho**, rótulo
**DEFINIDO/INDEFINIDO**, **decisão é do usuário** e **dados reais primeiro** —
aparecem com destaque nas telas de decisão (montador, ticket, screening, backtest).
Estados de erro/vazio/indisponível são tratados em quase toda parte (book vazio,
banco fora, cadeia ausente, serviço de quant "acordando").

**Nenhum achado de severidade Alta** — nada quebra o uso. Foram levantados **9
achados**: **3 Médios** (incomodam ou contrariam um princípio do PRD de forma
sutil) e **6 Baixos** (polimento). Os Médios concentram-se em (a) um botão
"em breve" que contradiz um recurso já entregue, (b) um tooltip educativo apontando
para o termo errado e (c) o carimbo de frescor mostrando **hora** em dado que é de
**fechamento (EOD)**.

| Severidade | Qtde |
| ---------- | ---- |
| Alta       | 0    |
| Média      | 3    |
| Baixa      | 6    |

## 2. Tabela de achados

| # | Tela | Categoria | Sev. | Problema | Sugestão |
|---|------|-----------|------|----------|----------|
| 1 | Montador | Fluxo | Média | Botão **"Trazer da cadeia (em breve)"** desabilitado + texto "Preencha manualmente", mas o pré-preenchimento pela cadeia **já existe** (banner + `prefillDaCadeia`). | Remover o botão/aviso "em breve"; quando há séries da cadeia, mostrar que vieram preenchidas. |
| 2 | Ticket | Princípio (educativo) | Média | A palavra **"ticker"** está embrulhada em `<TermoTecnico termo="strike">` — o tooltip mostra a definição de *strike*, não de ticker. | Trocar o termo (não há "ticker" no glossário): remover o `<TermoTecnico>` ou criar o verbete. |
| 3 | Análise (fund./volat.) | Princípio (dados EOD §6.2) | Média | `FrescorBadge` carimba **"Dado de HH:MM · atualizado agora"** (hora), mas o dado é de **fechamento/EOD** — sugere cotação ao vivo. | Trocar `fmtHora` por data de pregão (DD/MM) no badge dos blocos derivados de EOD. |
| 4 | Cadeia | Princípio (educativo) | Baixa | Hint inicial embrulha **"calls e puts"** em `<TermoTecnico termo="strike">` (termo trocado). | Usar termo próprio (ou nenhum) para "calls e puts"; reservar "strike" para o strike. |
| 5 | Cadeia | Visual / Princípio (§6.4) | Baixa | Coluna **"OI"** sempre exibe "n/d" (open interest não existe na fonte) — jargão e ruído permanentes para o leigo. | Remover a coluna OI (a nota de liquidez já explica) ou rebaixar para tooltip do cabeçalho. |
| 6 | Ticket, Histórico | Visual (consistência) | Baixa | Usam `<select>` **HTML nativo**; o componente shadcn `ui/select.tsx` existe e **não é usado em lugar nenhum** — selects destoam do design system. | Padronizar nos selects shadcn, ou assumir o nativo e remover o componente órfão. |
| 7 | Análise | Fluxo / Visual (loading) | Baixa | Durante a busca, só o spinner do botão aparece; a área dos 3 blocos fica **em branco** (cadeia/screening/backtest têm aviso de loading; a análise não). | Mostrar aviso/skeleton "Carregando análise de XXXX…" enquanto busca. |
| 8 | Dashboard | Princípio (§2 rótulo) | Baixa | Na linha **colapsada** da posição, o selo `RotuloRisco` (DEFINIDO/INDEFINIDO) só aparece ao expandir; colapsada mostra só o texto "INDEFINIDO"/valor. | Exibir um mini-selo DEFINIDO/INDEFINIDO também na linha colapsada. |
| 9 | (infra) | Visual (dívida) | Baixa | `EmConstrucao` ("chega na Fase 1") em `layout/pagina.tsx` é **código morto** — nenhuma tela o usa mais (Fases 0–3 concluídas). | Remover o componente `EmConstrucao` para não voltar a aparecer por engano. |

## 3. Achados por tela (Média e Alta — detalhe)

> Não há achados de severidade **Alta**. Abaixo, o detalhe dos **3 Médios**.

### Achado 1 — Montador: botão "Trazer da cadeia (em breve)" (Média · Fluxo)

`app/(app)/montador/montador-wizard.tsx` (passo 2, ~linhas 491–498) renderiza um
bloco com o texto **"Preencha os strikes e prêmios manualmente."** e um botão
**desabilitado** "Trazer da cadeia (em breve)". Porém o recurso de **pré-preencher
as pernas a partir da cadeia já está implementado e funcionando**: a tela 5 envia
as séries (`salvarSelecaoCadeia`), o `MontadorWizard` lê (`lerSelecaoCadeia`),
mostra o `BannerSelecao` e o `escolher()` chama `prefillDaCadeia` para preencher
strikes/prêmios/ativo/vencimento. O botão "em breve" contradiz o que o app já faz e
pode levar o iniciante a achar que precisa redigitar tudo. (Comentário no código —
"da cadeia chega com o Prompt 13" — também está obsoleto.)

**Impacto:** confunde o fluxo principal (cadeia → montador) que é justamente o
diferencial. **Sugestão:** remover o aviso/botão "em breve"; com séries presentes,
o banner já comunica o pré-preenchimento.

### Achado 2 — Ticket: tooltip de "ticker" aponta para "strike" (Média · Princípio educativo)

`app/(app)/ticket/ticket-cliente.tsx` (~linha 325), na descrição "Informe o
**ticker** exato de cada opção", a palavra *ticker* está dentro de
`<TermoTecnico termo="strike">`. Resultado: ao passar o mouse em "ticker", o usuário
lê a definição de **strike** (preço de exercício) — conceitos diferentes. O §2/§8.7
exige que todo termo técnico explique **o próprio** termo. Não há verbete "ticker"
no `lib/glossario.ts` (o `<TermoTecnico>` degrada para texto, mas aqui foi forçado o
slug errado).

**Impacto:** ensina o conceito errado num ponto crítico (preenchimento do ticket).
**Sugestão:** remover o `<TermoTecnico>` de "ticker" (palavra já familiar) ou criar
o verbete "ticker" no glossário e apontar para ele.

### Achado 3 — Análise: frescor com hora em dado de fechamento (Média · Princípio §6.2)

`app/(app)/analise/analise-ui.tsx` — o `FrescorBadge` formata o frescor como
**"Dado de HH:MM · atualizado agora"** via `fmtHora` (fuso de São Paulo). Ele é
usado nos cabeçalhos dos blocos **Fundamentalista** e **Volatilidade**. Mas o dado
do produto é **de fechamento (EOD)**: o §6.2/CLAUDE.md são explícitos — "a UI deve
**datar** o dado ('fechamento de DD/MM'). Não prometer cotação ao vivo". Mostrar uma
**hora** ("14:30 · atualizado agora") sugere tempo real. O bloco **Técnico** está
salvo porque tem, logo abaixo, o aviso datado explícito ("Preço de fechamento de
DD/MM"); o bloco **Volatilidade** (IV vinda de `iv_history`, EOD por pregão) **não**
tem esse contrapeso.

**Impacto:** contraria um princípio não-negociável (dado EOD, nunca "ao vivo") e
pode iludir o iniciante. **Sugestão:** no `FrescorBadge`, exibir a **data do pregão**
(DD/MM) em vez da hora para blocos derivados de EOD.

## 4. Fora do escopo desta auditoria

Itens **intencionalmente não avaliados** (não é que estejam ok — é que não foram o
foco desta passada):

- **Performance** (tamanho de bundle, re-render, tempo de carga, cold start do
  Railway) — exceto onde afeta a *percepção* de loading (achado 7).
- **Acessibilidade WCAG formal** (contraste AA/AAA, ordem de foco, navegação só por
  teclado, leitores de tela). Notou-se uso de `aria-*`/`role` e rótulos textuais
  além de cor (bom sinal), mas não houve auditoria de acessibilidade dedicada.
- **Mobile-first / layout em telas pequenas** — verificou-se apenas que nada
  **quebra** (sidebar vira menu hambúrguer; a tabela larga da cadeia tem
  `overflow-x-auto` e rola; barras de ação fixas no rodapé). Não se avaliou a
  *qualidade* da experiência mobile (ex.: a tabela de 12 colunas é usável, mas
  apertada no celular).
- **Correção numérica** (payoff, gregas, risco) — é responsabilidade de
  `lib/options-math` / `risk-rules` e seus testes (Vitest), não desta auditoria de UX.
- **Conteúdo dos textos do glossário e das "leituras de iniciante"** — avaliou-se a
  presença/encadeamento dos `<TermoTecnico>`, não a qualidade didática de cada verbete.
- **Microcopy de erros de backend** — as mensagens das rotas/Server Actions foram
  consideradas como caixa-preta; só se avaliou se a tela as **exibe** sem quebrar.
- **Telas de e-mail/onboarding/billing** — não existem (app mono-usuário).

> Nota: os critérios originais desta auditoria mencionavam "brapi/COTAHIST" nos
> estados de loading de dados externos. O **brapi foi aposentado** (migração para
> bolsai + COTAHIST, 2026-06-19); a avaliação de loading considerou as fontes
> atuais (`/api/ativo`, `/api/cadeia`, `/api/screening`, `/api/backtest`).
