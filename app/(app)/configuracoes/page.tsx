import { KeyRound, ShieldCheck, TriangleAlert } from "lucide-react";

import { Pagina, PaginaCabecalho } from "@/components/layout/pagina";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { carregarConfiguracoes } from "@/db/queries";

import { ConfiguracoesForm } from "./configuracoes-form";
import { WatchlistManager } from "./watchlist-manager";

/**
 * Tela 3 (§7, §14): Configurações. Server Component — lê capital, preferências e
 * watchlist do banco e checa a PRESENÇA das chaves de API (nunca seus valores,
 * §5.1). Edição via Server Actions; degrada com aviso se o banco cair.
 */
export default async function ConfiguracoesPage() {
  const config = await carregarConfiguracoes();

  // Status das chaves: só "configurada / faltando", JAMAIS o valor (§5.1).
  const chaves = [
    { nome: "BOLSAI_API_KEY", presente: !!process.env.BOLSAI_API_KEY, descricao: "Fundamentos do ativo-objeto (bolsai). Preço e cadeia vêm do COTAHIST (público)." },
    { nome: "DATABASE_URL", presente: !!process.env.DATABASE_URL, descricao: "Banco de dados (book, cache, cadeia COTAHIST, configurações)." },
    { nome: "AUTH_SECRET", presente: !!process.env.AUTH_SECRET, descricao: "Assinatura da sessão de login." },
  ];

  return (
    <Pagina>
      <PaginaCabecalho
        sobretitulo="Tela 3 · Ajustes"
        titulo="Configurações"
        descricao="Defina o capital total que serve de base para as regras de risco, ajuste o tema e gerencie sua watchlist de ativos."
      />

      <div className="flex flex-col gap-6">
        {!config.ok ? (
          <div className="flex items-start gap-2 rounded-lg border border-risco-alerta/40 bg-risco-alerta-suave px-3.5 py-3 text-sm text-risco-alerta">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Não foi possível carregar as configurações do banco agora. As chaves de
              API abaixo continuam visíveis; recarregue a página para editar capital e
              watchlist.
            </span>
          </div>
        ) : (
          <>
            <ConfiguracoesForm
              capitalInicial={config.capitalTotal}
              temaInicial={config.preferencias.tema}
            />
            <WatchlistManager ativos={config.watchlist} />
          </>
        )}

        {/* Status das chaves de API (server-only — sem expor valores, §5.1). */}
        <StatusChaves chaves={chaves} />
      </div>
    </Pagina>
  );
}

function StatusChaves({
  chaves,
}: {
  chaves: { nome: string; presente: boolean; descricao: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden />
          Chaves de API
        </CardTitle>
        <CardDescription>
          As chaves ficam só no servidor e nunca aparecem aqui — mostramos apenas se
          estão configuradas. Edite-as no ambiente (.env.local / Vercel), não nesta tela.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border">
        {chaves.map((c) => (
          <div key={c.nome} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="font-mono text-sm">{c.nome}</p>
              <p className="text-xs text-muted-foreground">{c.descricao}</p>
            </div>
            {c.presente ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-risco-ok-suave px-2.5 py-0.5 text-xs font-medium text-risco-ok">
                <ShieldCheck className="size-3.5" aria-hidden />
                Configurada
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-risco-alerta-suave px-2.5 py-0.5 text-xs font-medium text-risco-alerta">
                <TriangleAlert className="size-3.5" aria-hidden />
                Faltando
              </span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
