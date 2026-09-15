import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LessonVideoSourcePicker } from "@/components/teacher/lesson-video-source-picker";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

type PickerProps = Parameters<typeof LessonVideoSourcePicker>[0];

function renderPicker(overrides: Partial<PickerProps> = {}) {
  const props: PickerProps = {
    mode: "upload",
    accept: "video/*",
    externalUrl: "",
    embedStatus: "Paste a link when the video already lives outside SkillsetMind.",
    onModeChange: vi.fn(),
    onSelectFile: vi.fn(),
    onLinkChange: vi.fn(),
    ...overrides,
  };

  render(<LessonVideoSourcePicker {...props} />);
  return props;
}

function videoFile(name = "lesson.mp4") {
  return new File(["video-bytes"], name, { type: "video/mp4" });
}

// O host tem de ser do YouTube ou do Vimeo: e o que getTrustedLessonEmbed
// aceita. Nada e buscado; o resto usa example.test.
const vimeo = "https://vimeo.com/123456";
const urlField = () => screen.queryByRole("textbox", { name: "YouTube or Vimeo URL" });
// jsdom nao tem DataTransfer: a colagem leva so o getData que o campo le.
const clipboard = (text: string) => ({ getData: () => text });

// Simula a colagem do navegador: o evento paste (que o campo le) e depois a
// insercao do texto no cursor ou na selecao, que o jsdom nao faz sozinho.
function paste(field: HTMLInputElement, text: string) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  const next = field.value.slice(0, start) + text + field.value.slice(end);
  fireEvent.paste(field, { clipboardData: clipboard(text) });
  if (text && next !== field.value) {
    fireEvent.change(field, { target: { value: next } });
  }
}

describe("LessonVideoSourcePicker", () => {
  // Um video por aula (decisao de 14/09): o envio OU o link, nunca os dois.
  it("no modo envio mostra so a area de envio e o botao de trocar para link", () => {
    const props = renderPicker();
    const fileInput = screen.getByLabelText("Upload a lesson video");

    expect(fileInput.closest("label")).toContainElement(screen.getByText("Choose video"));
    expect(fileInput.closest("label")).toContainElement(screen.getByText("From your device"));
    expect(screen.getByText(/Drag & drop your video here/i)).toBeInTheDocument();
    expect(urlField()).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    expect(props.onModeChange).toHaveBeenCalledExactlyOnceWith("link");
  });

  it("no modo link mostra so o campo, com a ajuda fora do rotulo, e o botao de trocar para envio", () => {
    const props = renderPicker({ mode: "link" });

    expect(urlField()).toBeInTheDocument();
    expect(screen.queryByLabelText("Upload a lesson video")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "How the YouTube or Vimeo URL field works" }).closest("label")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    expect(props.onModeChange).toHaveBeenCalledExactlyOnceWith("upload");
  });

  it("a ajuda diz que so YouTube e Vimeo sao aceitos, com area de toque cheia", () => {
    renderPicker({ mode: "link", externalUrl: vimeo });
    const help = screen.getByRole("button", { name: "How the YouTube or Vimeo URL field works" });

    expect(help).toHaveClass("size-11", "shrink-0");
    expect(help.querySelector("svg")).toHaveAttribute("width", "13");
    fireEvent.focus(help);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/Only YouTube and Vimeo video links are accepted/);
    expect(help).toHaveAccessibleDescription(screen.getByRole("tooltip").textContent ?? "");
    expect(screen.getByDisplayValue(vimeo)).toBeInTheDocument();
  });

  it("grava so link aceito; link recusado mostra erro e nao sai do campo", () => {
    const props = renderPicker({ mode: "link" });

    fireEvent.change(urlField() as HTMLElement, { target: { value: "https://example.test/v.mp4" } });
    fireEvent.blur(urlField() as HTMLElement);
    expect(screen.getByRole("alert")).toHaveTextContent("Only YouTube and Vimeo video links are accepted.");
    expect(urlField()).toHaveAttribute("aria-invalid", "true");
    expect(props.onLinkChange).not.toHaveBeenCalled();

    fireEvent.change(urlField() as HTMLElement, { target: { value: `  ${vimeo} ` } });
    fireEvent.blur(urlField() as HTMLElement);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(urlField()).not.toHaveAttribute("aria-invalid");
    expect(props.onLinkChange).toHaveBeenCalledExactlyOnceWith(vimeo);
  });

  // Gravar a cada tecla persistia ids truncados ("vimeo.com/12") enquanto a
  // tela dizia "This link was not saved", e acusava erro no meio da digitacao.
  it("digitar nao grava nem acusa erro; grava ao sair do campo ou no Enter", () => {
    const props = renderPicker({ mode: "link" });

    for (const partial of ["h", "https://vim", "https://vimeo.com/12", vimeo]) {
      fireEvent.change(urlField() as HTMLElement, { target: { value: partial } });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(urlField()).not.toHaveAttribute("aria-invalid");
    }
    expect(props.onLinkChange).not.toHaveBeenCalled();

    fireEvent.keyDown(urlField() as HTMLElement, { key: "Enter" });
    expect(props.onLinkChange).toHaveBeenCalledExactlyOnceWith(vimeo);

    // Colar valida na hora, e o erro acompanha aria-invalid.
    fireEvent.change(urlField() as HTMLElement, { target: { value: "" } });
    paste(urlField() as HTMLInputElement, "https://example.test/v.mp4");
    expect(urlField()).toHaveValue("https://example.test/v.mp4");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(urlField()).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(urlField() as HTMLElement, { target: { value: "https://example.test/v" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(urlField()).not.toHaveAttribute("aria-invalid");
    expect(props.onLinkChange).toHaveBeenCalledOnce();
  });

  it("sem https:// completa o esquema antes de validar e grava o link normalizado", () => {
    const props = renderPicker({ mode: "link" });

    fireEvent.change(urlField() as HTMLElement, { target: { value: " vimeo.com/123456 " } });
    fireEvent.blur(urlField() as HTMLElement);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(props.onLinkChange).toHaveBeenCalledExactlyOnceWith(vimeo);
    expect(urlField()).toHaveValue(vimeo);
  });

  it("apagar o campo tira o link aceito salvo, so ao sair do campo", () => {
    const props = renderPicker({ mode: "link", externalUrl: vimeo });

    // Sair sem mudar o link salvo nao grava de novo.
    fireEvent.blur(urlField() as HTMLElement);
    fireEvent.change(urlField() as HTMLElement, { target: { value: "" } });
    expect(props.onLinkChange).not.toHaveBeenCalled();
    fireEvent.blur(urlField() as HTMLElement);
    expect(props.onLinkChange).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("colar um link aceito grava na hora, sem esperar o blur", () => {
    const props = renderPicker({ mode: "link" });

    paste(urlField() as HTMLInputElement, ` ${vimeo} `);

    expect(props.onLinkChange).toHaveBeenCalledExactlyOnceWith(vimeo);
    expect(urlField()).toHaveValue(vimeo);
  });

  // A colagem trocava o campo inteiro: digitar "https://youtu.be/" e colar o
  // id virava "https://abc..." e era recusado.
  it("colar no cursor completa o que ja foi digitado", () => {
    const props = renderPicker({ mode: "link" });
    const field = urlField() as HTMLInputElement;
    fireEvent.change(field, { target: { value: "https://youtu.be/" } });
    field.setSelectionRange(17, 17);

    paste(field, "abc123XYZ_-");

    expect(props.onLinkChange).toHaveBeenCalledExactlyOnceWith("https://youtu.be/abc123XYZ_-");
    expect(field).toHaveValue("https://youtu.be/abc123XYZ_-");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("colar sobre um trecho selecionado troca so esse trecho", () => {
    const props = renderPicker({ mode: "link", externalUrl: vimeo });
    const field = urlField() as HTMLInputElement;
    field.setSelectionRange("https://vimeo.com/".length, vimeo.length);

    paste(field, "654321");

    expect(props.onLinkChange).toHaveBeenCalledExactlyOnceWith("https://vimeo.com/654321");
    expect(field).toHaveValue("https://vimeo.com/654321");
  });

  // A marca de "colou" so saia no onChange. Colar o mesmo texto (ou imagem, ou
  // nada) nao dispara onChange, e a tecla seguinte era tratada como colagem:
  // o Backspace gravava https://vimeo.com/12345, outro video valido.
  it("colar o mesmo link e apagar um caractere nao grava outro video; colar vazio nao acusa erro", () => {
    const props = renderPicker({ mode: "link", externalUrl: vimeo });

    const field = urlField() as HTMLInputElement;
    // O mesmo texto sobre a mesma selecao: o valor nao muda, nao ha onChange.
    field.setSelectionRange(0, vimeo.length);
    paste(field, vimeo);
    fireEvent.change(field, { target: { value: vimeo.slice(0, -1) } });
    expect(props.onLinkChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.change(field, { target: { value: "" } });
    paste(field, "");
    fireEvent.change(field, { target: { value: "v" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(urlField()).not.toHaveAttribute("aria-invalid");
    expect(props.onLinkChange).not.toHaveBeenCalled();
  });

  // Um link antigo (Drive etc.) nao entra no campo. Digitar e apagar ali nao
  // pode apaga-lo: quem tira o link antigo e o botao proprio, no modal.
  it("com link antigo que nao e video, o campo comeca vazio e apagar nao grava nada", () => {
    const props = renderPicker({ mode: "link", externalUrl: "https://drive.example.test/file/d/x/view" });

    expect(urlField()).toHaveValue("");
    fireEvent.change(urlField() as HTMLElement, { target: { value: "abc" } });
    fireEvent.change(urlField() as HTMLElement, { target: { value: "" } });
    fireEvent.blur(urlField() as HTMLElement);
    expect(props.onLinkChange).not.toHaveBeenCalled();
  });

  it("mantem o rascunho do link ao trocar de idioma", () => {
    const onLinkChange = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <ChangeLanguage />
        <LessonVideoSourcePicker mode="link" accept="video/*" externalUrl={vimeo}
          embedStatus="Vimeo" onModeChange={vi.fn()} onSelectFile={vi.fn()} onLinkChange={onLinkChange} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByDisplayValue(vimeo)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cómo funciona el campo de URL de YouTube o Vimeo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reemplazar por archivo" })).toBeInTheDocument();
    expect(onLinkChange).not.toHaveBeenCalled();
  });

  // Auditoria student-video-access-server-side: link do YouTube/Vimeo e um
  // embed publico; drip e matricula nao o protegem. O aviso fica sob o campo.
  it("avisa sob o campo de link que o video do YouTube/Vimeo nao e protegido", () => {
    render(
      <I18nProvider initialLocale="en">
        <ChangeLanguage />
        <LessonVideoSourcePicker mode="link" accept="video/*" externalUrl=""
          embedStatus="" onModeChange={vi.fn()} onSelectFile={vi.fn()} onLinkChange={vi.fn()} />
      </I18nProvider>,
    );

    expect(screen.getByText(
      "YouTube and Vimeo videos stay viewable by anyone with the link, even outside SkillsetMind. Upload the video here to keep it for enrolled students only.",
    )).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText(
      "Cualquiera que tenga el enlace puede ver los videos de YouTube y Vimeo, incluso fuera de SkillsetMind. Sube el video aquí para que solo lo vean los estudiantes inscritos.",
    )).toBeInTheDocument();
  });

  it("mantem a area de soltar ativa ao trocar de idioma", () => {
    const onSelectFile = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <ChangeLanguage />
        <LessonVideoSourcePicker mode="upload" accept="video/*" externalUrl=""
          embedStatus="" onModeChange={vi.fn()} onSelectFile={onSelectFile} onLinkChange={vi.fn()} />
      </I18nProvider>,
    );
    const input = screen.getByLabelText("Upload a lesson video");

    fireEvent.dragOver(input.closest("label") as HTMLElement);
    expect(screen.getByText("Drop the video to select it")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText("Suelta el video para seleccionarlo")).toBeInTheDocument();
    expect(screen.getByLabelText("Subir un video de la lección")).toBe(input);
    const file = videoFile("Aula $& íntegra.mp4");
    fireEvent.drop(input.closest("label") as HTMLElement, { dataTransfer: { files: [file] } });
    expect(onSelectFile).toHaveBeenCalledExactlyOnceWith(file);
  });

  // Escolher NAO declara a fonte: `videoSource` e persistido pelo autosave e e
  // o campo que o aluno le para escolher o player. Quem declara a fonte e o
  // caminho de sucesso do envio, no lesson-content-modal. (Auditoria de produto
  // de 2026-08-30, achado P-01.)
  it("seleciona o video solto sem declarar a fonte nem trocar de modo", () => {
    const props = renderPicker();
    const file = videoFile();

    fireEvent.drop(screen.getByText(/Drag & drop your video here/i), {
      dataTransfer: { files: [file] },
    });

    expect(props.onSelectFile).toHaveBeenCalledWith(file);
    expect(props.onModeChange).not.toHaveBeenCalled();
    expect(props.onLinkChange).not.toHaveBeenCalled();
  });

  it("ignora arquivo solto que nao e video", () => {
    const props = renderPicker();

    fireEvent.drop(screen.getByText(/Drag & drop your video here/i), {
      dataTransfer: {
        files: [new File(["x"], "notes.pdf", { type: "application/pdf" })],
      },
    });

    expect(props.onSelectFile).not.toHaveBeenCalled();
  });

  it("seleciona o video escolhido no navegador sem declarar a fonte", () => {
    const props = renderPicker();
    const file = videoFile();

    fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
      target: { files: [file] },
    });

    expect(props.onSelectFile).toHaveBeenCalledWith(file);
    expect(props.onModeChange).not.toHaveBeenCalled();
  });

  it("mostra o estado do link embutido", () => {
    renderPicker({ mode: "link", embedStatus: "YouTube embed detected." });

    expect(screen.getByText("YouTube embed detected.")).toBeInTheDocument();
  });

  it("desabilitado: nada responde, nem a troca de modo", () => {
    const props = renderPicker({ disabled: true });

    expect(screen.getByLabelText("Upload a lesson video")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace with link" })).toBeDisabled();
    fireEvent.drop(screen.getByText(/Drag & drop your video here/i), {
      dataTransfer: { files: [videoFile()] },
    });
    expect(props.onSelectFile).not.toHaveBeenCalled();

    renderPicker({ mode: "link", disabled: true });
    expect(urlField()).toBeDisabled();
  });
});
