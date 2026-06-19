/**
 * Placeholder da camada de API (§5 do PRD).
 *
 * As rotas em `app/api/` atuam como PROXY + CACHE das integrações externas
 * (brapi/COTAHIST/BCB-SGS), mantendo as chaves só no servidor (§5.1). Esta é uma
 * rota de health-check para validar o setup; as rotas reais chegam na Fase 1.
 */
export async function GET() {
  return Response.json({ status: "ok", service: "babilonia" });
}
