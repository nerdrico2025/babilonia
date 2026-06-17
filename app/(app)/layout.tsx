import { auth, signOut } from "@/auth";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Layout das telas autenticadas (§14). Envolve tudo na casca (`AppShell`) com a
 * navegação e o disclaimer. Fica num route group `(app)` para NÃO afetar as URLs
 * e para deixar a tela `/login` (fora do grupo) sem a casca.
 *
 * É Server Component: lê a sessão (`auth`) e define o logout como Server Action,
 * mantendo o auth server-only (§13) — só o botão vive no client.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  async function sair() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <AppShell userName={session?.user?.name ?? null} sair={sair}>
      {children}
    </AppShell>
  );
}
