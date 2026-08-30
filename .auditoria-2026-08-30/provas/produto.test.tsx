/**
 * PROVAS da auditoria de produto — 30/08/2026.
 * Deliberadamente VERMELHAS. Ver o cabeçalho de criticos.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LessonVideoSourcePicker } from "@/components/teacher/lesson-video-source-picker";

const RAIZ = process.cwd();
const leia = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

describe("P-01 · escolher um arquivo não pode apagar a aula de quem já pagou", () => {
  // O bug: `selectFile` avisava "a fonte agora é upload" no instante em que o
  // professor ESCOLHE o arquivo — antes de qualquer envio. Esse campo é
  // persistido na aula pelo autosave de 1,8s e é o mesmo que o aluno lê para
  // decidir qual player mostrar. Com a fonte em "upload" e nenhum arquivo
  // enviado, o aluno pagante vê "Media not attached yet" — e o link do YouTube,
  // que continua salvo e válido, nunca mais é consultado.
  //
  // O professor não consegue diagnosticar: o cabeçalho do modal continua
  // dizendo "Media is connected." com o selo "Embedded", porque aquele rótulo
  // olha os anexos e o embed, e ignora a fonte.
  //
  // Basta escolher o arquivo errado, ou desistir depois de estourar o limite de
  // tamanho. Não é preciso enviar nada.

  function escolheUmArquivo() {
    const onChange = vi.fn();
    const onSelectFile = vi.fn();

    const { container } = render(
      <LessonVideoSourcePicker
        value="youtube"
        accept="video/*"
        externalUrl="https://www.youtube.com/watch?v=abc123"
        embedStatus="Embedded"
        onChange={onChange}
        onSelectFile={onSelectFile}
        onExternalUrlChange={vi.fn()}
      />,
    );

    const arquivo = new File(["conteudo"], "aula.mp4", { type: "video/mp4" });
    const campo = container.querySelector('input[type="file"]');
    expect(campo, "o seletor precisa expor um campo de arquivo").not.toBeNull();
    fireEvent.change(campo as HTMLInputElement, { target: { files: [arquivo] } });

    return { onChange, onSelectFile };
  }

  it("guarda o arquivo escolhido", () => {
    const { onSelectFile } = escolheUmArquivo();
    expect(onSelectFile).toHaveBeenCalledTimes(1);
  });

  it("NÃO troca a fonte da aula só por escolher o arquivo", () => {
    const { onChange } = escolheUmArquivo();
    expect(
      onChange,
      "trocar a fonte antes do envio apaga a aula para quem já pagou",
    ).not.toHaveBeenCalled();
  });

  it("a troca da fonte acontece depois do envio bem-sucedido", () => {
    // O outro lado do conserto: quem passa a declarar "a fonte é upload" é o
    // modal, no caminho de sucesso do envio — não o seletor, na escolha.
    const modal = leia("src/components/teacher/lesson-content-modal.tsx");
    const marcador = 'setSuccess("File uploaded to this lesson.")';
    const i = modal.indexOf(marcador);
    expect(i, "premissa do teste: o caminho de sucesso existe").toBeGreaterThan(-1);

    const trechoDeSucesso = modal.slice(Math.max(0, i - 800), i + 800);
    expect(
      /videoSource:\s*"upload"/.test(trechoDeSucesso),
      "o caminho de sucesso do envio não declara a fonte como upload",
    ).toBe(true);
  });
});

describe("P-11 · o campo de login não pode fazer o iPhone dar zoom", () => {
  // Campo de formulário com fonte abaixo de 16px faz o Safari do iOS dar zoom
  // ao receber foco, e o zoom não volta sozinho: a pessoa fica com a tela
  // deslocada no meio do login. É a primeira tela do produto.
  const css = leia("src/app/globals.css");

  it("existe um piso de 16px para campos no celular", () => {
    // O requisito não é "nenhuma regra abaixo de 16px" — no desktop não há zoom
    // e a densidade projetada é legítima. O requisito é que no celular exista um
    // piso que vença as regras de classe existentes.
    const regras = css.split("}");
    const suspeitas = regras.filter((regra) => {
      const mexeEmCampo =
        /(^|[\s,>])(input|textarea|select)\b/i.test(regra) ||
        /[.#][a-z0-9-]*input\b/i.test(regra);
      return mexeEmCampo && /font-size:\s*(1[0-5]px|0\.\d+rem|\.\d+rem)/i.test(regra);
    });

    const piso = regras.some((regra) => {
      const ehCampo = /(^|[\s,>])(input|textarea|select)\b/i.test(regra);
      const dezesseis = /font-size:\s*16px\s*!important/i.test(regra);
      return ehCampo && dezesseis;
    });
    const dentroDeMediaDeCelular = /@media[^{]*max-width:\s*(6[0-9][0-9]|7[0-6][0-9])px[\s\S]{0,600}font-size:\s*16px\s*!important/i.test(css);

    expect(
      piso && dentroDeMediaDeCelular,
      `há ${suspeitas.length} regras de campo com fonte < 16px e nenhum piso de 16px ` +
        `numa media query de celular — o Safari do iOS vai dar zoom no foco`,
    ).toBe(true);
  });
});
