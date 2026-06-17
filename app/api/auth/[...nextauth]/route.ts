/**
 * Endpoints do Auth.js (NextAuth): /api/auth/* (login, logout, sessão, csrf).
 * Liberados no `matcher` do proxy — são a porta de entrada da autenticação.
 */
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
