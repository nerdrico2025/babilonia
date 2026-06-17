/**
 * Proxy do Next 16 (antigo `middleware.ts`) — protege o acesso ao app (§13).
 *
 * Usa apenas a config edge-safe (`auth.config.ts`): o callback `authorized`
 * decide cada requisição. Quem não está logado é redirecionado para /login.
 *
 * O `matcher` roda o proxy em TODAS as rotas, EXCETO:
 *  - `/api/auth/*`   → endpoints do próprio NextAuth (login/logout/sessão);
 *  - `/api/health`   → health check público (uptime/monitor externo); não
 *                       expõe dados nem chaves;
 *  - assets estáticos do Next (`_next/static`, `_next/image`) e o favicon.
 * A própria tela `/login` passa pelo proxy, mas é liberada no callback.
 */
import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api/auth|api/health|_next/static|_next/image|favicon.ico).*)"],
};
