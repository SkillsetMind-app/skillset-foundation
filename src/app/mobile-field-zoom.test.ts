import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * O Safari do iPhone dá zoom ao focar um campo com fonte menor que 16px, e o
 * zoom NÃO volta sozinho: a pessoa fica com a tela deslocada no meio do login,
 * que é a primeira tela do produto. Não existe jsdom que pegue isso — é
 * comportamento do navegador real —, então a folha de estilo é lida como texto.
 *
 * Este teste afirma o REQUISITO, não a implementação. A versão anterior dele
 * vivia na pasta de auditoria e exigia literalmente `!important` dentro de uma
 * media query de `max-width` entre 600 e 769px: passou a falhar quando a regra
 * melhorou (o `!important` era desnecessário, e a faixa de largura deixava o
 * iPhone deitado de fora). Um teste que trava a solução de ontem cobra o preço
 * da correção de hoje.
 */
const css = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

function blocosDeMedia(): string[] {
  const blocos: string[] = [];
  const abre = /@media([^{]*)\{/g;
  let match: RegExpExecArray | null;

  while ((match = abre.exec(css)) !== null) {
    const condicao = match[1];
    let profundidade = 1;
    let i = abre.lastIndex;

    while (i < css.length && profundidade > 0) {
      if (css[i] === "{") profundidade += 1;
      if (css[i] === "}") profundidade -= 1;
      i += 1;
    }

    blocos.push(`@media${condicao}{${css.slice(abre.lastIndex, i)}`);
  }

  return blocos;
}

describe("piso de 16px em campos de formulário no celular", () => {
  const pisos = blocosDeMedia().filter(
    (bloco) =>
      /(^|[\s,>])(input|textarea|select)\b/i.test(bloco)
      && /font-size:\s*16px/i.test(bloco),
  );

  it("existe um piso de 16px para input, textarea e select", () => {
    expect(
      pisos.length,
      "nenhuma media query impõe 16px em campos — o Safari do iOS vai dar zoom no foco",
    ).toBeGreaterThan(0);

    const cobreOsTres = pisos.some(
      (bloco) =>
        /(^|[\s,>])input\b/i.test(bloco)
        && /(^|[\s,>])textarea\b/i.test(bloco)
        && /(^|[\s,>])select\b/i.test(bloco),
    );

    expect(
      cobreOsTres,
      "o piso existe mas não cobre os três tipos de campo que dão zoom",
    ).toBe(true);
  });

  it("vale por tipo de aparelho, não por largura de tela", () => {
    // O zoom nasce do tamanho da fonte do campo e dispara igual com o iPhone
    // deitado, onde a viewport passa de 900px. Um piso preso a `max-width`
    // deixa a tela de login quebrada em paisagem, que foi como o bug voltou.
    const porAparelho = pisos.some(
      (bloco) => /pointer:\s*coarse/i.test(bloco) || /hover:\s*none/i.test(bloco),
    );

    expect(
      porAparelho,
      "o piso está preso a max-width; o iPhone em paisagem (>900px) fica de fora e ainda dá zoom",
    ).toBe(true);
  });

  it("não precisa de !important para vencer as regras de classe", () => {
    // `input:not([type="checkbox"]):not([type="radio"])` é (0,2,1) e já vence
    // `.platform-sidebar-search input`, que é (0,1,1). Um !important de folha de
    // estilo atropelaria todo `style={{ fontSize }}` inline da aplicação e
    // obrigaria o próximo override legítimo a nascer com outro.
    const comImportant = pisos.filter((bloco) =>
      /font-size:\s*16px\s*!important/i.test(bloco),
    );

    expect(
      comImportant,
      "o piso usa !important sem precisar — ele também sobrepõe estilos inline legítimos",
    ).toHaveLength(0);
  });
});
