/**
 * prefill — pré-preenche os campos do montador a partir das séries trazidas da
 * cadeia (tela 5 → tela 6). Módulo PURO e testável.
 *
 * Mapeia as séries selecionadas para as `chaves` de cada estrutura do `catalogo`
 * (k1, k2, premioK1…). Como cada estrutura tem uma "forma" diferente (quantas
 * calls/puts, em que ordem de strike), o mapeamento é explícito por `EstruturaId`
 * — claro e previsível. Se a seleção não casar com a estrutura, devolve o que deu
 * (parcial) com um aviso, e o usuário completa à mão (§2.4 — nunca inventamos).
 */

import type { EstruturaId } from "./catalogo";
import type { SerieSelecionada } from "./selecao-cadeia";

/** Resultado do pré-preenchimento: valores (strings de input) + completude. */
export interface ResultadoPrefill {
  /** Valores por `chave`, em formato de input pt-BR (vírgula decimal). */
  valores: Record<string, string>;
  /** `true` quando todos os campos necessários foram preenchidos. */
  completo: boolean;
  /** Aviso quando a seleção não casa exatamente com a estrutura. */
  aviso?: string;
}

/** Número → string de input pt-BR (22.5 → "22,5"); null/0-inexistente → "". */
function s(valor: number | null): string {
  return valor == null ? "" : String(valor).replace(".", ",");
}

/** Conclui o resultado: completo só se nenhum campo necessário ficou vazio. */
function concluir(valores: Record<string, string>, aviso?: string): ResultadoPrefill {
  const completo = Object.values(valores).every((v) => v.trim() !== "");
  // Um aviso explícito (ex.: strikes diferentes) é sempre preservado; só quando
  // não há aviso e ficou incompleto entra a mensagem padrão.
  return {
    valores,
    completo,
    aviso:
      aviso ??
      (completo
        ? undefined
        : "Algumas séries não trouxeram prêmio (bid/ask) — confira e complete os campos."),
  };
}

/** Falha de casamento (faltam séries do tipo certo). */
function faltou(mensagem: string): ResultadoPrefill {
  return { valores: {}, completo: false, aviso: mensagem };
}

/**
 * Pré-preenche os campos da estrutura `id` com as `series` da cadeia. Calls e
 * puts são ordenadas por strike crescente para casar com a convenção das
 * estruturas (K1 < K2 < …).
 */
export function prefillDaCadeia(
  id: EstruturaId,
  series: SerieSelecionada[],
): ResultadoPrefill {
  const calls = series.filter((x) => x.tipo === "call").sort((a, b) => a.strike - b.strike);
  const puts = series.filter((x) => x.tipo === "put").sort((a, b) => a.strike - b.strike);

  switch (id) {
    // Travas com calls (2 calls, strikes crescentes).
    case "trava_alta_debito":
    case "trava_baixa_credito": {
      if (calls.length < 2) return faltou("Selecione 2 calls (uma de cada strike) na cadeia.");
      return concluir({
        k1: s(calls[0]!.strike),
        k2: s(calls[1]!.strike),
        premioK1: s(calls[0]!.premioRef),
        premioK2: s(calls[1]!.premioRef),
      });
    }
    // Travas com puts (2 puts, strikes crescentes).
    case "trava_alta_credito":
    case "trava_baixa_debito": {
      if (puts.length < 2) return faltou("Selecione 2 puts (uma de cada strike) na cadeia.");
      return concluir({
        k1: s(puts[0]!.strike),
        k2: s(puts[1]!.strike),
        premioK1: s(puts[0]!.premioRef),
        premioK2: s(puts[1]!.premioRef),
      });
    }
    // Borboleta: 3 calls.
    case "borboleta": {
      if (calls.length < 3) return faltou("Selecione 3 calls (K1, K2 e K3) na cadeia.");
      return concluir({
        k1: s(calls[0]!.strike),
        k2: s(calls[1]!.strike),
        k3: s(calls[2]!.strike),
        premioK1: s(calls[0]!.premioRef),
        premioK2: s(calls[1]!.premioRef),
        premioK3: s(calls[2]!.premioRef),
      });
    }
    // Condor: 4 calls.
    case "condor": {
      if (calls.length < 4) return faltou("Selecione 4 calls (K1 a K4) na cadeia.");
      return concluir({
        k1: s(calls[0]!.strike),
        k2: s(calls[1]!.strike),
        k3: s(calls[2]!.strike),
        k4: s(calls[3]!.strike),
        premioK1: s(calls[0]!.premioRef),
        premioK2: s(calls[1]!.premioRef),
        premioK3: s(calls[2]!.premioRef),
        premioK4: s(calls[3]!.premioRef),
      });
    }
    // Straddle: 1 call + 1 put no mesmo strike.
    case "straddle_comprado":
    case "straddle_vendido": {
      if (calls.length < 1 || puts.length < 1) {
        return faltou("Selecione 1 call e 1 put (de mesmo strike) na cadeia.");
      }
      const aviso =
        calls[0]!.strike !== puts[0]!.strike
          ? "A call e a put selecionadas têm strikes diferentes — o straddle usa o mesmo strike. Confira."
          : undefined;
      return concluir(
        {
          k: s(calls[0]!.strike),
          premioCall: s(calls[0]!.premioRef),
          premioPut: s(puts[0]!.premioRef),
        },
        aviso,
      );
    }
    // Strangle: 1 put (strike menor) + 1 call (strike maior).
    case "strangle_comprado":
    case "strangle_vendido": {
      if (calls.length < 1 || puts.length < 1) {
        return faltou("Selecione 1 put (strike menor) e 1 call (strike maior) na cadeia.");
      }
      return concluir({
        k1: s(puts[0]!.strike),
        k2: s(calls[0]!.strike),
        premioPut: s(puts[0]!.premioRef),
        premioCall: s(calls[0]!.premioRef),
      });
    }
    // Venda coberta: 1 call.
    case "venda_coberta": {
      if (calls.length < 1) return faltou("Selecione 1 call na cadeia.");
      return concluir({
        k: s(calls[0]!.strike),
        premio: s(calls[0]!.premioRef),
      });
    }
  }
}
