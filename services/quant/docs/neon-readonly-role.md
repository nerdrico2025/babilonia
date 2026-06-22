# Role read-only no Neon para o microserviço quant

> **Status:** script pronto — **aplicação manual pendente** (criação da role no
> console Neon + troca da `DATABASE_URL` no Railway são feitas à mão pelo dono do
> projeto, que tem o acesso). Este documento NÃO foi executado contra o banco.

## Por quê

O microserviço `services/quant/` (FastAPI no Railway) só faz **SELECT** —
screening da cadeia e backtest histórico são read-only por design, e
`app/core/db.py` ainda reforça isso em runtime abrindo cada conexão com
`default_transaction_read_only=on`. Mesmo assim, a `DATABASE_URL` usada hoje no
Railway aponta para a **role admin/owner** do Neon (read/write) — privilégio bem
maior que o necessário. A defesa definitiva é uma **role dedicada com apenas
`SELECT`** nas tabelas que o serviço efetivamente consulta.

## Tabelas que o serviço lê

Conferido em `app/quant/dados.py` (única camada que toca o banco):

| Tabela           | Lida hoje? | Onde                                                        |
| ---------------- | ---------- | ----------------------------------------------------------- |
| `watchlist`      | ✅ sim     | `buscar_watchlist` (screening da watchlist)                 |
| `opcao_cotahist` | ✅ sim     | cadeia EOD + histórico de fechamentos (screening, backtest) |
| `acao_cotahist`  | ✅ sim     | spot do ativo-objeto (screening, backtest)                  |
| `iv_history`     | 🔜 reserva | citada na docstring de `db.py` (superfície de IV — futuro)  |

`iv_history` ainda **não** é consultada por nenhuma query, mas o `GRANT` está
incluído porque é leitura barata e evita um segundo round de console Neon quando a
superfície de IV chegar. Tabelas de **escrita** do app Next.js (`position`, `leg`,
`ticket`, `settings`, `api_cache`, `fundamentos`, etc.) **ficam de fora de
propósito** — o serviço nunca deve enxergá-las.

## Script SQL

Rode no **SQL Editor do console Neon** (ou via `psql` com a connection string da
role owner), **conectado ao banco onde vivem as tabelas**. Troque o placeholder da
senha antes de executar.

```sql
-- ────────────────────────────────────────────────────────────────────────────
-- Role read-only dedicada ao microserviço quant (services/quant/).
-- Permissão APENAS de SELECT nas tabelas que o serviço lê. Nada de escrita.
-- ⚠️ Troque 'TROQUE_POR_UMA_SENHA_FORTE' por uma senha real (gere com
--    `openssl rand -base64 24`) ANTES de rodar. Não comite a senha.
-- ────────────────────────────────────────────────────────────────────────────

-- 1) Cria a role de login (usuário) do serviço.
CREATE ROLE quant_readonly WITH LOGIN PASSWORD 'TROQUE_POR_UMA_SENHA_FORTE';

-- 2) Permite conectar no banco. Troque <NOME_DO_BANCO> pelo banco do Neon
--    (ex.: o mesmo da DATABASE_URL atual — normalmente "neondb").
GRANT CONNECT ON DATABASE "<NOME_DO_BANCO>" TO quant_readonly;

-- 3) Permite enxergar o schema public (onde estão as tabelas).
GRANT USAGE ON SCHEMA public TO quant_readonly;

-- 4) SELECT explícito, tabela por tabela (só as que o serviço lê).
GRANT SELECT ON TABLE public.watchlist      TO quant_readonly;  -- screening da watchlist
GRANT SELECT ON TABLE public.opcao_cotahist TO quant_readonly;  -- cadeia EOD + histórico
GRANT SELECT ON TABLE public.acao_cotahist  TO quant_readonly;  -- spot do ativo-objeto
GRANT SELECT ON TABLE public.iv_history     TO quant_readonly;  -- reserva (superfície de IV)
```

### Conferir os privilégios concedidos

```sql
-- Deve listar SELECT nas quatro tabelas acima e em NENHUMA outra.
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'quant_readonly'
ORDER BY table_name;
```

### Notas

- **Não** se concede `ALL` nem `INSERT/UPDATE/DELETE`. Se um dia o serviço tentar
  escrever, o Postgres barra na role (defesa definitiva) além do
  `default_transaction_read_only=on` (defesa em runtime).
- **Grants não são retroativos para tabelas novas.** Se a lista de tabelas lidas
  crescer (ex.: a tabela da superfície de IV ganhar outro nome), rode um `GRANT
  SELECT` adicional. De propósito **não** usamos `ALTER DEFAULT PRIVILEGES` — não
  queremos que a role enxergue automaticamente tabelas futuras.
- Para revogar/desfazer: `DROP OWNED BY quant_readonly;` seguido de
  `DROP ROLE quant_readonly;`.

## Connection string (formato DIRETO, não-pooler)

O microserviço **precisa do endpoint direto** do Neon — o PgBouncer do `-pooler`
rejeita o startup option `default_transaction_read_only=on` que `app/core/db.py`
passa, e a conexão falha no boot (mesmo motivo já documentado no README §Deploy
para a role atual).

Como obter:

1. **Console Neon → Connection Details.** Selecione a role **`quant_readonly`** e o
   banco. Em **"Connection pooling"**, deixe **desligado** (queremos o host direto).
2. Copie a string. O host vem **sem** o sufixo `-pooler`. Formato:

   ```
   postgresql://quant_readonly:<SENHA>@ep-nome-xxxxx.<regiao>.aws.neon.tech/<NOME_DO_BANCO>?sslmode=require
   ```

   ⚠️ Se a string vier com `-pooler` no host (ex.:
   `ep-nome-xxxxx-pooler.<regiao>...`), **remova o `-pooler`** para obter o
   endpoint direto:

   ```
   ep-nome-xxxxx-pooler.<regiao>.aws.neon.tech   →   ep-nome-xxxxx.<regiao>.aws.neon.tech
   ```

3. Mantenha `?sslmode=require` (o Neon exige TLS).

## Aplicar no Railway (manual)

1. Projeto `babilonia-quant` (conta Click Hero) → serviço quant → **Variables**.
2. Substitua o valor de **`DATABASE_URL`** pela connection string da
   `quant_readonly` (formato direto acima).
3. Redeploy. Confira a saúde e que screening/backtest seguem funcionando:

   ```bash
   curl -s $QUANT_SERVICE_URL/health
   ```

4. Sanidade da permissão — uma tentativa de escrita pela nova role deve **falhar**
   por falta de privilégio (e não só pelo read-only de transação):

   ```sql
   -- conectado como quant_readonly:
   INSERT INTO public.watchlist (symbol) VALUES ('TESTE');  -- deve dar "permission denied"
   ```

Depois que a `DATABASE_URL` do Railway estiver trocada e validada, marcar a
pendência do README como **concluída**.
