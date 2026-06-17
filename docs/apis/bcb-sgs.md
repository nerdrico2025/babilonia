# Banco Central — SGS (Sistema Gerenciador de Séries Temporais)

> **Fonte oficial:** Portal de Dados Abertos do BCB
> (https://dadosabertos.bcb.gov.br/) e a API pública do SGS.
> Confirmado em 2026-06-16.

Usamos o SGS para obter a **taxa livre de risco** que alimenta o Black-Scholes
(`r` no pricing e no solver de IV — ver `docs/design/options-math-black-scholes.md`).
Substitui o antigo `GET /market/interest_rates` da OpLab.

## Endpoint

```
https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo_serie}/dados?formato=json&dataInicial={DD/MM/AAAA}&dataFinal={DD/MM/AAAA}
```

- **Sem autenticação**, sem chave, sem cota publicada (uso moderado + cache).
- `formato=json` (também aceita `csv`).
- Datas em **`DD/MM/AAAA`**. Sem intervalo, retorna a série completa (evitar).
- Resposta:

```json
[
  { "data": "16/06/2026", "valor": "14.75" }
]
```

- `valor` vem como **string** → parsear para número. A unidade depende da série
  (ver abaixo).
- Há também o **último valor**:
  `https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados/ultimos/1?formato=json`.

## Séries candidatas

| Código | Nome | Unidade | Frequência | Atualização |
|:------:|------|---------|------------|-------------|
| **`11`** | Taxa Selic (Selic over) | **% ao dia** | diária (dias úteis) | diária |
| **`12`** | CDI | **% ao dia** | diária (dias úteis) | diária |
| **`432`** | **Meta Selic definida pelo Copom** | **% ao ano** | a cada reunião | ~a cada 45 dias |
| `1178` | Selic anualizada base 252 | **% ao ano** | diária | diária |
| `4189` | Selic acumulada no mês anualizada (base 252) | % ao ano | mensal | mensal |

> **Atenção à unidade:** as séries `11` e `12` são **% ao dia** (ex.: `0.052531`).
> As séries `432` e `1178` são **% ao ano** (ex.: `14.75`). Misturar as duas é
> erro grave no pricing.

## Decisão: usar a série **432 (Meta Selic Copom)** — com `1178` como alternativa

**Escolha primária: `432` — Meta Selic definida pelo Copom.**

Justificativa para o nosso caso de uso (pricing EOD, usuário leigo, sem alta
frequência):

1. **Já é anual (% a.a.).** O Black-Scholes precisa de `r` anual; com a `432` não
   há conversão de taxa diária→anual (que exigiria `(1 + d/100)^252 − 1` e abre
   espaço para bug de unidade). As séries `11`/`12` são diárias e precisariam
   dessa composição.
2. **É o proxy canônico de "taxa livre de risco" no Brasil.** A Meta Selic é a
   taxa básica de política monetária — exatamente o conceito de risk-free do BS.
3. **Estável e barata de cachear.** Muda só quando o Copom decide (~8x/ano), então
   um valor único cacheado com TTL longo serve. Não precisa de série diária para
   uma grega que já é uma aproximação.
4. **Determinística e auditável.** Um número redondo de decisão (ex.: 14,75% a.a.)
   é mais fácil de exibir/explicar ao usuário leigo do que a Selic over flutuando
   na 4ª casa decimal.

**Alternativa mais "efetiva": `1178` (Selic anualizada base 252).** Se quisermos a
taxa **realizada** (e não a meta), a `1178` entrega a Selic over já anualizada em
base 252 — diária, mesma unidade (% a.a.), encaixe direto no BS sem conversão. A
diferença para a `432` é de poucos centésimos (a Selic over orbita a meta) e
**irrelevante** para gregas/IV de EOD. Manter a `1178` documentada como troca de
uma linha em `lib/integrations/bcb-sgs.ts` caso se queira precisão de taxa
realizada no futuro.

**Por que NÃO `11`/`12` como primária:** corretas, mas em **% ao dia** → exigem
anualização base 252 antes de entrar no BS. Mais um passo, mais um ponto de erro
de unidade, sem ganho de precisão relevante para EOD. (A `12`/CDI ≈ Selic − 0,1
p.p.; sem vantagem sobre a Selic para risk-free.)

### Uso no Black-Scholes

- O BS usa `r` **contínuo**. Converter a taxa anual efetiva da `432`:
  `r_continuo = ln(1 + meta_selic/100)`.
- O prazo `T` é medido em **dias úteis / 252** (convenção brasileira, base 252) —
  coerente com a anualização base 252 da Selic. Ver design doc.
- Para o backfill de IV histórica (252 pregões), usar a **`432` vigente em cada
  pregão** (a série traz a meta com a data de vigência) ou, se optar pela `1178`,
  o valor daquele dia. Não usar a meta de hoje para precificar o passado.

## Cache e resiliência (PRD §6.3)

- Encapsular em `lib/integrations/bcb-sgs.ts`; nenhuma tela chama a API direto.
- TTL longo (a meta muda ~a cada 45 dias) — cachear na tabela `api_cache`.
- Em falha da API, **degradar para o último valor em cache** com aviso ("taxa de
  DD/MM"), nunca quebrar a precificação. Como fallback final, manter uma
  **constante de taxa** padrão configurável em `settings` para não bloquear o
  cálculo.

## Fontes

- [Série 11 — Taxa de juros · Selic (Dados Abertos BCB)](https://dadosabertos.bcb.gov.br/dataset/11-taxa-de-juros---selic)
- [Série 432 — Meta Selic definida pelo Copom (Dados Abertos BCB)](https://dadosabertos.bcb.gov.br/en/dataset/432-taxa-de-juros---meta-selic-definida-pelo-copom)
- [Série 4189 — Selic acumulada no mês anualizada base 252](https://dadosabertos.bcb.gov.br/dataset/4189-taxa-de-juros---selic-acumulada-no-mes-anualizada-base-252/resource/091e3cb3-4dca-488b-a89d-6c9bb56c9a99)
