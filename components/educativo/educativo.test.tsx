import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { TermoTecnico } from "@/components/educativo/termo-tecnico";
import { Semaforo } from "@/components/risco/semaforo";
import { RotuloRisco } from "@/components/risco/rotulo-risco";
import { GLOSSARIO, getTermo } from "@/lib/glossario";

/**
 * Smoke tests da infraestrutura educativa e de risco (§2, §8.7, §10). Garante
 * que o `<TermoTecnico>` vira um link para a âncora do glossário, que o glossário
 * é íntegro (slugs únicos, sem campos vazios) e que os componentes de risco
 * renderizam o significado em texto (não só cor).
 */

function comProvider(ui: React.ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("glossário — integridade da fonte única", () => {
  it("não tem slug duplicado e nenhum campo vazio", () => {
    const slugs = GLOSSARIO.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const t of GLOSSARIO) {
      expect(t.termo.length).toBeGreaterThan(0);
      expect(t.curto.length).toBeGreaterThan(0);
      expect(t.longo.length).toBeGreaterThan(0);
    }
  });

  it("cobre os termos que o PRD cita explicitamente (§2)", () => {
    for (const slug of ["gregas", "iv-rank", "skew", "breakeven"]) {
      expect(getTermo(slug)).toBeDefined();
    }
  });
});

describe("<TermoTecnico>", () => {
  it("renderiza o rótulo como link para a âncora do glossário", () => {
    comProvider(<TermoTecnico termo="iv-rank">IV Rank</TermoTecnico>);
    const link = screen.getByRole("link", { name: /IV Rank/i });
    expect(link).toHaveAttribute("href", "/glossario#iv-rank");
  });

  it("usa o nome do glossário quando não há children", () => {
    comProvider(<TermoTecnico termo="breakeven" />);
    expect(screen.getByRole("link")).toHaveTextContent("Breakeven");
  });

  it("degrada para texto puro quando o slug não existe (não inventa, §2.4)", () => {
    comProvider(<TermoTecnico termo="inexistente">algo</TermoTecnico>);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("algo")).toBeInTheDocument();
  });
});

describe("<Semaforo>", () => {
  it("mostra o rótulo de texto por padrão (não depende só de cor)", () => {
    render(<Semaforo nivel="perigo" />);
    expect(screen.getByText("Acima do limite")).toBeInTheDocument();
  });

  it("sem rótulo visível, expõe o significado via aria-label", () => {
    render(<Semaforo nivel="ok" mostrarRotulo={false} />);
    expect(screen.getByRole("img", { name: "Dentro do limite" })).toBeInTheDocument();
  });
});

describe("<RotuloRisco>", () => {
  it("destaca DEFINIDO e INDEFINIDO em texto", () => {
    const { rerender } = render(<RotuloRisco tipo="definido" />);
    expect(screen.getByText("DEFINIDO")).toBeInTheDocument();

    rerender(<RotuloRisco tipo="indefinido" />);
    expect(screen.getByText("INDEFINIDO")).toBeInTheDocument();
  });
});
