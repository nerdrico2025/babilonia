# Auditoria de UX — Babilônia

**Auditoria original:** 22/06/2026 · **Última atualização:** 22/06/2026 ·
**Método:** leitura do código-fonte das telas (`app/`) e componentes (`components/`).
**Escopo:** as 9 telas do §14 do PRD, contra critérios Visual / Fluxo / Princípios
do PRD (§2).

> **Registro vivo do UX review** — não é só o snapshot inicial. A auditoria
> levantou os achados; conforme cada um é corrigido, esta página é atualizada com o
> status e o commit. Coluna **Status**: 🔴 aberto · ✅ corrigido (com hash). O
> histórico de correções fica na §5.

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
sutil) e **6 Baixos** (polimento). Os Médios concentravam-se em (a) um botão
"em breve" que contradizia um recurso já entregue, (b) um tooltip educativo apontando
para o termo errado e (c) o carimbo de frescor mostrando **hora** em dado que é de
**fechamento (EOD)**.

**Estado atual (22/06/2026):** os **3 Médios estão corrigidos** (M1, M2, M3); entre
os Baixos, foram corrigidos o **#4** (junto do M2), o **#5** (coluna OI) e o **#7**
(skeleton de loading na Análise). Restam **3 Baixos** (polimento), abertos.

| Severidade | Total | Corrigidos | Abertos |
| ---------- | ----- | ---------- | ------- |
| Alta       | 0     | 0          | 0       |
| Média      | 3     | 3          | 0       |
| Baixa      | 6     | 3          | 3       |

## 2. Tabela de achados

| # | Tela | Categoria | Sev. | Problema | Sugestão | Status |
|---|------|-----------|------|----------|----------|--------|
| 1 | Montador | Fluxo | Média | Botão **"Trazer da cadeia (em breve)"** desabilitado + texto "Preencha manualmente", mas o pré-preenchimento pela cadeia **já existe** (banner + `prefillDaCadeia`). | Remover o botão/aviso "em breve"; quando há séries da cadeia, mostrar que vieram preenchidas. | ✅ `81a918c` |
| 2 | Ticket | Princípio (educativo) | Média | A palavra **"ticker"** está embrulhada em `<TermoTecnico termo="strike">` — o tooltip mostra a definição de *strike*, não de ticker. | Trocar o termo (não há "ticker" no glossário): remover o `<TermoTecnico>` ou criar o verbete. | ✅ `484a572` |
| 3 | Análise (fund./volat.) | Princípio (dados EOD §6.2) | Média | `FrescorBadge` carimba **"Dado de HH:MM · atualizado agora"** (hora), mas o dado é de **fechamento/EOD** — sugere cotação ao vivo. | Trocar `fmtHora` por data de pregão (DD/MM) no badge dos blocos derivados de EOD. | ✅ `1dd7736` |
| 4 | Cadeia | Princípio (educativo) | Baixa | Hint inicial embrulha **"calls e puts"** em `<TermoTecnico termo="strike">` (termo trocado). | Usar termo próprio (ou nenhum) para "calls e puts"; reservar "strike" para o strike. | ✅ `484a572` |
| 5 | Cadeia | Visual / Princípio (§6.4) | Baixa | Coluna **"OI"** sempre exibe "n/d" (open interest não existe na fonte) — jargão e ruído permanentes para o leigo. | Remover a coluna OI (a nota de liquidez já explica) ou rebaixar para tooltip do cabeçalho. | ✅ `bf0de23` |
| 6 | Ticket, Histórico | Visual (consistência) | Baixa | Usam `<select>` **HTML nativo**; o componente shadcn `ui/select.tsx` existe e **não é usado em lugar nenhum** — selects destoam do design system. | Padronizar nos selects shadcn, ou assumir o nativo e remover o componente órfão. | 🔴 aberto |
| 7 | Análise | Fluxo / Visual (loading) | Baixa | Durante a busca, só o spinner do botão aparece; a área dos 3 blocos fica **em branco** (cadeia/screening/backtest têm aviso de loading; a análise não). | Mostrar aviso/skeleton "Carregando análise de XXXX…" enquanto busca. | ✅ `e1bf4ba` |
| 8 | Dashboard | Princípio (§2 rótulo) | Baixa | Na linha **colapsada** da posição, o selo `RotuloRisco` (DEFINIDO/INDEFINIDO) só aparece ao expandir; colapsada mostra só o texto "INDEFINIDO"/valor. | Exibir um mini-selo DEFINIDO/INDEFINIDO também na linha colapsada. | 🔴 aberto |
| 9 | (infra) | Visual (dívida) | Baixa | `EmConstrucao` ("chega na Fase 1") em `layout/pagina.tsx` é **código morto** — nenhuma tela o usa mais (Fases 0–3 concluídas). | Remover o componente `EmConstrucao` para não voltar a aparecer por engano. | 🔴 aberto |

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

> **✅ Corrigido — `81a918c`.** Opção A: o botão desabilitado foi removido. Para não
> deixar quem chega direto ao montador sem caminho de descoberta, a caixa-dica virou
> um ponteiro textual com link para a Cadeia ("…ou escolha as séries na Cadeia e elas
> vêm preenchidas aqui"). Opção B (abrir a Cadeia com o ativo pré-selecionado) foi
> descartada porque exigiria alterar `cadeia-cliente.tsx` (lê o ticker de um input,
> não da URL). Comentário obsoleto "Prompt 13" também removido.

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

> **✅ Corrigido — `484a572`.** Criado o verbete **"ticker"** em `lib/glossario.ts`
> (categoria Operação: "código de negociação de uma série de opção na B3, ex.:
> PETRE450") e o ticket passou a usar `termo="ticker"`. O grep por `termo="strike"`
> revelou a **mesma classe de erro no achado #4** (Cadeia, "calls e puts"); ambos
> foram corrigidos no mesmo commit.

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

> **✅ Corrigido — `1dd7736`.** O `FrescorBadge` ganhou a prop `tipoFonte:
> 'eod' | 'realtime'` (default `eod`): EOD carimba "Fechamento de DD/MM/AAAA" (sem
> hora, sem "atualizado agora"); `realtime` preserva o formato com hora. Técnico e
> Volatilidade ficam no default `eod`; **Fundamentalista** foi marcado `realtime`,
> pois seu `geradoEm` é o instante real de busca na bolsai (não um fechamento de
> pregão). O bloco **Volatilidade** ganhou o mesmo aviso EOD datado que o Técnico já
> tinha.

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

## 5. Histórico de correções

| Data | Achados | Commit | Resumo |
|------|---------|--------|--------|
| 22/06/2026 | M2 + #4 | `484a572` | `fix(ux): corrige TermoTecnico com termo="strike" em campo de ticker (M2)` — verbete "ticker" no glossário; ticket usa `termo="ticker"`; corrige também "calls e puts" na Cadeia (#4). |
| 22/06/2026 | M3 | `1dd7736` | `fix(ux): FrescorBadge não promete realtime em dado EOD; aviso EOD no bloco Volatilidade (M3)` — prop `tipoFonte` (default `eod`); Fundamentalista marcado `realtime`; aviso EOD na Volatilidade. |
| 22/06/2026 | M1 | `81a918c` | `fix(ux): remove/habilita botão "em breve" no montador — recurso de cadeia já existe (M1)` — botão desabilitado removido (Opção A) e substituído por link de descoberta para a Cadeia. |
| 22/06/2026 | #5 (B1) | `bf0de23` | `fix(ux): coluna OI na cadeia — conecta dado real ou remove com aviso honesto (B1)` — investigação confirmou que OI **não existe no COTAHIST** (nem no layout B3 Rev 02, nem no schema/parser); coluna 100% "n/d" removida. A nota honesta `NOTA_LIQUIDEZ` (visível abaixo da tabela) e o verbete "open-interest" no glossário já explicam a ausência. |
| 22/06/2026 | #7 (B2) | `e1bf4ba` | `fix(ux): skeleton de loading nos blocos da análise — elimina área em branco (B2)` — criado o componente `Skeleton` (shadcn, não estava instalado) e um placeholder de três cartões exibido na 1ª busca (`carregando && !dadosAtivo`). |

**Próximos candidatos (Baixos abertos):** #6 (`<select>` nativo vs. shadcn `Select`
órfão), #8 (selo DEFINIDO/INDEFINIDO na linha colapsada do Dashboard), #9
(`EmConstrucao` morto).
