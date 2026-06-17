# B3 COTAHIST — Séries Históricas (cotações de fechamento)

> **Fonte oficial:** página de Cotações Históricas da B3
> (https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/cotacoes-historicas/)
> e o **PDF de layout** `SeriesHistoricas_Layout.pdf`
> (https://www.b3.com.br/data/files/33/67/B9/50/D84057102C784E47AC094EA8/SeriesHistoricas_Layout.pdf).
> Confirmado em 2026-06-16.
>
> ⚠️ **Sobre a confirmação do layout:** o PDF oficial é **escaneado/baseado em
> imagem** (sem camada de texto), então não foi possível extraí-lo
> programaticamente. As posições de byte abaixo foram conferidas contra **três
> reproduções fiéis e independentes** do mesmo layout oficial (o template
> `wilsonfreitas/rbmfbovespa`, parsers públicos em Python e a tabela publicada por
> terceiros) — todas batem com o spec estável de **245 bytes/registro** em vigor
> desde 1986. Antes de escrever o parser definitivo, **abrir o PDF num leitor e
> conferir visualmente** os campos que vamos usar (checklist no fim deste doc).

## Por que COTAHIST (decisão 2026-06-16)

A OpLab saiu de cogitação (assinatura cara, sem plano gratuito equivalente via
API). A nova fonte da **cadeia de opções** passa a ser o arquivo público
**COTAHIST** da B3 — dado de **fechamento do dia (EOD)**. Isso é **suficiente**
porque o Babilônia **não opera day trade**: monta estruturas com base no
fechamento e o usuário digita a ordem manualmente no home broker no pregão
seguinte. Gregas, IV e IV Rank passam a ser **calculados por nós** a partir do
preço de fechamento (ver `docs/design/options-math-black-scholes.md`).

## Formato geral do arquivo

- Arquivo **texto largura-fixa (fixed-width)**, codificação **ASCII/Latin-1**,
  **245 bytes por registro** + quebra de linha (CRLF). **Sem delimitadores.**
- Três tipos de registro, identificados pelos 2 primeiros bytes (campo `TIPREG`):
  - **`00`** — *header* (1 registro, no topo): nome do arquivo, código de origem,
    data de geração.
  - **`01`** — *cotação* (o que nos interessa): 1 registro por papel por pregão.
  - **`99`** — *trailer* (1 registro, no fim): contagem total de registros.
- Os arquivos vêm dentro de um `.ZIP` contendo um único `.TXT`
  (ex.: `COTAHIST_A2025.TXT`).

## Registro tipo 01 — layout completo (245 bytes)

Posições são **1-based, inclusivas** (como no PDF oficial). Em JS/TS, ao fatiar
com `String.prototype.slice`, lembrar que ele é 0-based e exclusivo no fim →
`slice(posIni - 1, posFin)`.

| # | Campo | Descrição | Tipo | Tam | Pos.Ini | Pos.Fin | Dec | Usamos? |
|---|-------|-----------|------|-----|--------:|--------:|:---:|:------:|
| 1 | `TIPREG` | Tipo de registro (sempre `01`) | N | 2 | 1 | 2 | — | ✅ filtro |
| 2 | `DATAPREGAO` | Data do pregão (`AAAAMMDD`) | N | 8 | 3 | 10 | — | ✅ |
| 3 | `CODBDI` | Código BDI (segmento; ver nota) | X | 2 | 11 | 12 | — | ✅ filtro |
| 4 | `CODNEG` | **Código de negociação (ticker)** | X | 12 | 13 | 24 | — | ✅ |
| 5 | `TPMERC` | **Tipo de mercado** (010 vista, 070 call, 080 put…) | N | 3 | 25 | 27 | — | ✅ |
| 6 | `NOMRES` | **Nome resumido da empresa/emissor** | X | 12 | 28 | 39 | — | ✅ link ao objeto |
| 7 | `ESPECI` | Especificação do papel (ON, PN, CALL…) | X | 10 | 40 | 49 | — | ⬜ |
| 8 | `PRAZOT` | Prazo em dias (termo) | X | 3 | 50 | 52 | — | ⬜ |
| 9 | `MODREF` | Moeda de referência (ex.: `R$`) | X | 4 | 53 | 56 | — | ⬜ |
| 10 | `PREABE` | **Preço de abertura** | N | 13 | 57 | 69 | 2 | ✅ |
| 11 | `PREMAX` | **Preço máximo** | N | 13 | 70 | 82 | 2 | ✅ |
| 12 | `PREMIN` | **Preço mínimo** | N | 13 | 83 | 95 | 2 | ✅ |
| 13 | `PREMED` | **Preço médio** | N | 13 | 96 | 108 | 2 | ✅ |
| 14 | `PREULT` | **Preço do último negócio (fechamento)** | N | 13 | 109 | 121 | 2 | ✅ |
| 15 | `PREOFC` | Melhor oferta de compra (bid) | N | 13 | 122 | 134 | 2 | ✅ spread |
| 16 | `PREOFV` | Melhor oferta de venda (ask) | N | 13 | 135 | 147 | 2 | ✅ spread |
| 17 | `TOTNEG` | **Número de negócios no pregão** | N | 5 | 148 | 152 | — | ✅ liquidez |
| 18 | `QUATOT` | Quantidade total de títulos negociados | N | 18 | 153 | 170 | — | ✅ liquidez |
| 19 | `VOLTOT` | **Volume total financeiro** | N | 18 | 171 | 188 | 2 | ✅ liquidez |
| 20 | `PREEXE` | **Preço de exercício (strike)** — opções | N | 13 | 189 | 201 | 2 | ✅ |
| 21 | `INDOPC` | Indicador de correção de strike (0 = não) | N | 1 | 202 | 202 | — | ⬜ |
| 22 | `DATVEN` | **Data de vencimento** (`AAAAMMDD`) — opções | N | 8 | 203 | 210 | — | ✅ |
| 23 | `FATCOT` | **Fator de cotação** (1, 1000…) | N | 7 | 211 | 217 | — | ✅ |
| 24 | `PTOEXE` | Preço de exercício em pontos (opções referenciadas em USD/pontos) | N | 13 | 218 | 230 | 6 | ⬜ |
| 25 | `CODISI` | Código ISIN / distribuição do papel | X | 12 | 231 | 242 | — | ⬜ |
| 26 | `DISMES` | Número de distribuição do papel | N | 3 | 243 | 245 | — | ⬜ |

### Notas de parsing (críticas)

- **Campos numéricos (`N`) vêm com zeros à esquerda e SEM ponto/vírgula
  decimal.** O número de casas decimais é **implícito** (coluna `Dec`).
  Ex.: `PREULT` com `Dec=2` e conteúdo `0000000001234` → **R$ 12,34**
  (dividir o inteiro por 100). `VOLTOT` idem (`Dec=2`).
- **`FATCOT` (fator de cotação):** preço cotado pode ser por **lote** de N
  títulos. Para opções de ações o usual é `FATCOT=1` (preço por unidade), mas
  **conferir sempre** e dividir/ajustar quando ≠ 1 — afeta o prêmio efetivo por
  contrato. O tamanho do contrato de opção de ação na B3 é **100 ações por
  contrato** (não vem no arquivo; é convenção — registrar como constante).
- **`PREEXE` (strike) e `DATVEN` (vencimento)** só são preenchidos para registros
  de mercado de opções/termo; em ações à vista vêm zerados.
- **`CODBDI`** segmenta o tipo de papel (ex.: `02` lote padrão, `78` opções de
  compra, `82` opções de venda, `96` fracionário…). **Para o nosso filtro de
  opções, o discriminador confiável é `TPMERC` (070/080)**, não o CODBDI — use
  TPMERC como filtro primário.
- **Datas** estão em `AAAAMMDD` (sem separador).
- **Texto (`X`)** vem preenchido com espaços à direita → aplicar `trim()`.

### TPMERC — códigos de tipo de mercado

| Código | Significado | Relevância p/ Babilônia |
|:------:|-------------|--------------------------|
| `010` | Mercado à vista | objeto (spot) — usado só para pegar o preço do ativo-objeto |
| `012` | Exercício de opções de compra | ignorar |
| `013` | Exercício de opções de venda | ignorar |
| `017` | Leilão | ignorar |
| `020` | Fracionário | ignorar |
| `030` | Termo | ignorar |
| `050` | Futuro c/ retenção de ganho | ignorar |
| `060` | Futuro c/ movimentação contínua | ignorar |
| **`070`** | **OPÇÕES DE COMPRA (CALL)** | ✅ **núcleo** |
| **`080`** | **OPÇÕES DE VENDA (PUT)** | ✅ **núcleo** |

> Para montar a cadeia: filtrar `TIPREG == "01"` **e** `TPMERC ∈ {070, 080}`.
> Mapear `070 → CALL`, `080 → PUT`.

### Ligar a opção ao ativo-objeto

O COTAHIST **não traz uma chave direta** "opção → ticker do objeto". Estratégias
(do mais robusto ao mais simples):

1. **Por raiz do ticker + ISIN/`NOMRES`:** o `CODNEG` da opção começa com a raiz
   do papel-objeto (ex.: `PETR…` → PETR4/PETR3). O `NOMRES` (nome resumido) e o
   `CODISI`/`DISMES` ajudam a desambiguar PN vs ON. Construir um mapa
   raiz-de-opção → ativo-objeto.
2. **Cruzar com os registros à vista (`TPMERC=010`)** do mesmo arquivo para obter
   o **preço spot** do objeto no mesmo pregão (necessário para o Black-Scholes).
3. Manter uma **tabela/seed de mapeamento** das raízes que o usuário acompanha
   (watchlist) para não depender de heurística frágil no MVP.

> ⚠️ A relação ticker-de-opção → objeto é a parte mais sujeita a borda (mudanças
> de série, sufixos E/F, opções semanais). No MVP, restringir aos objetos da
> watchlist reduz o risco.

## ⚠️ Gap explícito: NÃO existe OPEN INTEREST no COTAHIST

Confirmado: **nenhum campo do registro tipo 01 representa open interest /
contratos em aberto.** O arquivo traz apenas, por pregão:

- `VOLTOT` — volume financeiro do dia,
- `QUATOT` — quantidade de títulos negociados no dia,
- `TOTNEG` — número de negócios do dia.

Isso é um **gap de dado** (PRD §2, princípio 4 — "nunca inventar"). Já era um gap
com a OpLab (que também não fornece OI — ver `oplab.md` e PRD §6.4 item 1), então
a estratégia de liquidez **não muda** com a troca de fonte:

### Filtro de liquidez SEM open interest (§8.3 / §9)

Combinar os sinais que **temos** no COTAHIST:

- **Volume financeiro (`VOLTOT`)** acima de um piso (ex.: ≥ R$ X no pregão).
- **Número de negócios (`TOTNEG`)** acima de um piso (ex.: ≥ N negócios) — filtra
  séries que "negociaram" num único lote.
- **Spread bid/ask** estreito, via `PREOFC`/`PREOFV`
  (`spread% = (PREOFV − PREOFC) / PREMED`). Spread largo → alerta.
- **Sinal de recência:** série que não negociou no último pregão (`VOLTOT=0` e
  `TOTNEG=0`) recebe rótulo "sem negócios hoje — liquidez duvidosa".

Apresentar como **semáforo de liquidez** (verde/amarelo/vermelho) com texto leigo,
e **registrar no ticket** (§11) que a leitura de liquidez é baseada em
volume+negócios+spread, **sem OI**. Open interest fica como evolução futura (fonte
B3/UP2DATA paga), sem mudar a arquitetura (`lib/integrations` isola a fonte).

## Como baixar

### Caminho preferencial — URL direta (automático)

Padrão de URL pública (sem captcha), por **ano / mês / dia**:

```
# Ano inteiro (backfill histórico):
https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A{AAAA}.ZIP
  ex.: https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A2025.ZIP

# Mês:
https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_M{MMAAAA}.ZIP
  ex.: COTAHIST_M062026.ZIP  (junho/2026)

# Dia (atualização incremental diária):
https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D{DDMMAAAA}.ZIP
  ex.: COTAHIST_D15062026.ZIP  (15/06/2026)
```

Estratégia de ingestão no Babilônia:

- **Backfill inicial:** baixar `COTAHIST_A{ano}` dos últimos ~2 anos (para os 252
  pregões de IV Rank, ver design doc) — uma vez.
- **Atualização diária:** baixar o `COTAHIST_D{dia}` após o fechamento (job
  noturno). Tolerar 404 em dias sem pregão (feriado/fim de semana).
- O ZIP é grande (anual ~centenas de MB descompactado); processar em **stream**,
  filtrando `TIPREG=01` + `TPMERC∈{070,080}` (+ os `010` dos objetos da
  watchlist) e **descartar o resto** antes de persistir.

> ⚠️ O host `bvmf.bmfbovespa.com.br/InstDados/SerHist/` é legado mas segue ativo.
> Tratar a URL direta como **não-contratual**: encapsular em
> `lib/integrations/b3-cotahist.ts` para trocar a origem sem tocar no resto.

### Fallback manual — formulário com captcha

Se a URL direta parar de responder (ou mudar de host), há o caminho manual pela
página oficial de Cotações Históricas:

1. Acessar
   https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/cotacoes-historicas/
2. Selecionar **ano / mês / dia** no formulário e resolver o **captcha**.
3. Baixar o `.ZIP` manualmente e **colocá-lo numa pasta de ingestão** (ou subir
   pela UI), de onde o mesmo parser o processa.

Como o captcha impede automação, o caminho manual existe só como **plano B
operacional** — o app deve degradar com aviso ("não foi possível baixar o
COTAHIST de hoje automaticamente; baixe manualmente e coloque em …") em vez de
quebrar (PRD §6.3 / §13, resiliência).

## Checklist de verificação visual contra o PDF oficial

Antes de implementar `lib/integrations/b3-cotahist.ts`, abrir
`SeriesHistoricas_Layout.pdf` e confirmar **a olho** para o registro tipo 01:

- [ ] Total do registro = **245 bytes**.
- [ ] `CODNEG` em **13–24** (12 bytes).
- [ ] `TPMERC` em **25–27**, e que **070=compra / 080=venda**.
- [ ] `PREULT` em **109–121**, `Dec=2`.
- [ ] `VOLTOT` em **171–188**, `Dec=2`.
- [ ] `PREEXE` (strike) em **189–201**, `Dec=2`.
- [ ] `DATVEN` em **203–210**.
- [ ] `FATCOT` em **211–217**.
- [ ] Confirmar (de novo) que **não há** campo de open interest.

## Fontes

- B3 — Cotações Históricas (página oficial e PDF de layout): links no topo.
- Reproduções de referência conferidas: template
  [`wilsonfreitas/rbmfbovespa`](https://rdrr.io/github/wilsonfreitas/rbmfbovespa/src/legacy/tpl-cotahist.R),
  [`codigoquant/b3fileparser`](https://github.com/codigoquant/b3fileparser),
  [`rhlobo/bovespaParser`](https://github.com/rhlobo/bovespaParser).
