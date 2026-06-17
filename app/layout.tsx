import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Fraunces, Mulish, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

// Fraunces (serif editorial, com personalidade) nos títulos/marca: dá um ar de
// "almanaque" sério e acolhedor, sem parecer mais um fintech genérico.
const fontHeading = Fraunces({
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
});

// Mulish (sans humanista) no corpo: muito legível e amigável — combina com o
// público leigo (§2). Evita as fontes genéricas (Inter/Geist/Arial).
const fontSans = Mulish({
  variable: "--font-sans-base",
  subsets: ["latin"],
  display: "swap",
});

// Mono só para números financeiros (prêmios, strikes, %), com a classe `.tabular`.
const fontMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Babilônia",
  description:
    "Ferramenta pessoal para analisar e montar operações com opções da B3.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Tema vem de um cookie gravado em Configurações (§14) — lido aqui sem tocar no
  // banco (login não precisa de DB). "escuro" liga a classe `.dark`; default claro.
  const tema = (await cookies()).get("tema")?.value;
  const escuro = tema === "escuro";

  return (
    <html
      lang="pt-BR"
      className={`${fontHeading.variable} ${fontSans.variable} ${fontMono.variable} h-full antialiased${escuro ? " dark" : ""}`}
    >
      <body className="min-h-full flex flex-col">
        {/* Provider global de tooltips: o princípio "para leigos" (§2) exige
            tooltips/explicações em toda a UI — por isso fica na raiz. */}
        <TooltipProvider delay={120}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
