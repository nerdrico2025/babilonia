import {
  Blocks,
  GraduationCap,
  History,
  LayoutDashboard,
  LineChart,
  Settings,
  Table,
  Ticket,
  type LucideIcon,
} from "lucide-react";

/**
 * Itens de navegação = as telas do §14 (menos a tela 1, Login, que fica fora do
 * app). A ordem segue o fluxo natural: ver o book → analisar → escolher série →
 * montar → gerar ticket → consultar histórico → aprender → ajustar.
 */
export interface ItemNav {
  href: string;
  rotulo: string;
  /** Frase curta "para leigos" do que a tela faz (subtítulo/descrição). */
  descricao: string;
  icone: LucideIcon;
}

export const NAV: readonly ItemNav[] = [
  {
    href: "/",
    rotulo: "Dashboard",
    descricao: "Seu book: posições, risco e alertas de vencimento.",
    icone: LayoutDashboard,
  },
  {
    href: "/analise",
    rotulo: "Análise de ativo",
    descricao: "Preço, fundamentos e volatilidade do ativo-objeto.",
    icone: LineChart,
  },
  {
    href: "/cadeia",
    rotulo: "Cadeia de opções",
    descricao: "Calls e puts por strike e vencimento, com filtro de liquidez.",
    icone: Table,
  },
  {
    href: "/montador",
    rotulo: "Montador",
    descricao: "Monte estruturas com payoff visual — risco antes do ganho.",
    icone: Blocks,
  },
  {
    href: "/ticket",
    rotulo: "Ticket",
    descricao: "O resumo pronto para você digitar a ordem no home broker.",
    icone: Ticket,
  },
  {
    href: "/historico",
    rotulo: "Histórico",
    descricao: "Diário das operações montadas e encerradas.",
    icone: History,
  },
  {
    href: "/glossario",
    rotulo: "Glossário",
    descricao: "Todos os termos explicados em português claro.",
    icone: GraduationCap,
  },
  {
    href: "/configuracoes",
    rotulo: "Configurações",
    descricao: "Capital total e preferências do app.",
    icone: Settings,
  },
] as const;

/** Decide se um item está ativo para o pathname atual (exato para "/"). */
export function itemAtivo(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
