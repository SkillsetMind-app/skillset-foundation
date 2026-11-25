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

// The host must be YouTube or Vimeo: that is what getTrustedLessonEmbed
// accepts. Nothing is fetched; the rest uses example.test.
const vimeo = "https://vimeo.com/123456";
const urlField = () => screen.queryByRole("textbox", { name: "YouTube or Vimeo URL" });
// jsdom has no DataTransfer: the paste carries only the getData the field reads.
const clipboard = (text: string) => ({ getData: () => text });

// Simulates the browser paste: the paste event (which the field reads) and then the
// insertion of the text at the cursor or the selection, which jsdom does not do by itself.
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
  // One video per lesson (decision of Sep 14): the upload OR the link, never both.
  it("in upload mode it shows only the upload area and the button to switch to link", () => {
    const props = renderPicker();
    const fileInput = screen.getByLabelText("Upload a lesson video");

    expect(fileInput.closest("label")).toContainElement(screen.getByText("Choose video"));
    expect(fileInput.closest("label")).toContainElement(screen.getByText("From your device"));
    expect(screen.getByText(/Drag & drop your video here/i)).toBeInTheDocument();
    expect(urlField()).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    expect(props.onModeChange).toHaveBeenCalledExactlyOnceWith("link");
  });

  it("in link mode it shows only the field, with the help outside the label, and the button to switch to upload", () => {
    const props = renderPicker({ mode: "link" });

    expect(urlField()).toBeInTheDocument();
    expect(screen.queryByLabelText("Upload a lesson video")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "How the YouTube or Vimeo URL field works" }).closest("label")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Replace with upload" }));
    expect(props.onModeChange).toHaveBeenCalledExactlyOnceWith("upload");
  });

  it("the help says only YouTube and Vimeo are accepted, with a full touch target", () => {
    renderPicker({ mode: "link", externalUrl: vimeo });
    const help = screen.getByRole("button", { name: "How the YouTube or Vimeo URL field works" });

    expect(help).toHaveClass("size-11", "shrink-0");
    expect(help.querySelector("svg")).toHaveAttribute("width", "13");
    fireEvent.focus(help);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/Only YouTube and Vimeo video links are accepted/);
    expect(help).toHaveAccessibleDescription(screen.getByRole("tooltip").textContent ?? "");
    expect(screen.getByDisplayValue(vimeo)).toBeInTheDocument();
  });

  it("saves only an accepted link; a rejected link shows an error and does not leave the field", () => {
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

  // Saving on every keystroke persisted truncated ids ("vimeo.com/12") while the
  // screen said "This link was not saved", and reported an error in the middle of typing.
  it("typing neither saves nor reports an error; it saves on leaving the field or on Enter", () => {
    const props = renderPicker({ mode: "link" });

    for (const partial of ["h", "https://vim", "https://vimeo.com/12", vimeo]) {
      fireEvent.change(urlField() as HTMLElement, { target: { value: partial } });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(urlField()).not.toHaveAttribute("aria-invalid");
    }
    expect(props.onLinkChange).not.toHaveBeenCalled();

    fireEvent.keyDown(urlField() as HTMLElement, { key: "Enter" });
    expect(props.onLinkChange).toHaveBeenCalledExactlyOnceWith(vimeo);

    // Pasting validates right away, and the error follows aria-invalid.
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

  it("without https:// it completes the scheme before validating and saves the normalized link", () => {
    const props = renderPicker({ mode: "link" });

    fireEvent.change(urlField() as HTMLElement, { target: { value: " vimeo.com/123456 " } });
    fireEvent.blur(urlField() as HTMLElement);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(props.onLinkChange).toHaveBeenCalledExactlyOnceWith(vimeo);
    expect(urlField()).toHaveValue(vimeo);
  });

  it("clearing the field removes the saved accepted link, only on leaving the field", () => {
    const props = renderPicker({ mode: "link", externalUrl: vimeo });

    // Leaving without changing the saved link does not save again.
    fireEvent.blur(urlField() as HTMLElement);
    fireEvent.change(urlField() as HTMLElement, { target: { value: "" } });
    expect(props.onLinkChange).not.toHaveBeenCalled();
    fireEvent.blur(urlField() as HTMLElement);
    expect(props.onLinkChange).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("pasting an accepted link saves right away, without waiting for the blur", () => {
    const props = renderPicker({ mode: "link" });

    paste(urlField() as HTMLInputElement, ` ${vimeo} `);

    expect(props.onLinkChange).toHaveBeenCalledExactlyOnceWith(vimeo);
    expect(urlField()).toHaveValue(vimeo);
  });

  // The paste replaced the whole field: typing "https://youtu.be/" and pasting the
  // id became "https://abc..." and was rejected.
  it("pasting at the cursor completes what was already typed", () => {
    const props = renderPicker({ mode: "link" });
    const field = urlField() as HTMLInputElement;
    fireEvent.change(field, { target: { value: "https://youtu.be/" } });
    field.setSelectionRange(17, 17);

    paste(field, "abc123XYZ_-");

    expect(props.onLinkChange).toHaveBeenCalledExactlyOnceWith("https://youtu.be/abc123XYZ_-");
    expect(field).toHaveValue("https://youtu.be/abc123XYZ_-");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("pasting over a selected range replaces only that range", () => {
    const props = renderPicker({ mode: "link", externalUrl: vimeo });
    const field = urlField() as HTMLInputElement;
    field.setSelectionRange("https://vimeo.com/".length, vimeo.length);

    paste(field, "654321");

    expect(props.onLinkChange).toHaveBeenCalledExactlyOnceWith("https://vimeo.com/654321");
    expect(field).toHaveValue("https://vimeo.com/654321");
  });

  // The "pasted" mark was only cleared in onChange. Pasting the same text (or an image, or
  // nothing) does not fire onChange, and the next key was treated as a paste:
  // Backspace saved https://vimeo.com/12345, another valid video.
  it("pasting the same link and deleting one character does not save another video; pasting nothing does not report an error", () => {
    const props = renderPicker({ mode: "link", externalUrl: vimeo });

    const field = urlField() as HTMLInputElement;
    // The same text over the same selection: the value does not change, there is no onChange.
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

  // An old link (Drive etc.) does not go into the field. Typing and deleting there
  // must not delete it: what removes the old link is its own button, in the modal.
  it("with an old link that is not a video, the field starts empty and deleting saves nothing", () => {
    const props = renderPicker({ mode: "link", externalUrl: "https://drive.example.test/file/d/x/view" });

    expect(urlField()).toHaveValue("");
    fireEvent.change(urlField() as HTMLElement, { target: { value: "abc" } });
    fireEvent.change(urlField() as HTMLElement, { target: { value: "" } });
    fireEvent.blur(urlField() as HTMLElement);
    expect(props.onLinkChange).not.toHaveBeenCalled();
  });

  it("keeps the link draft when switching language", () => {
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

  // Audit student-video-access-server-side: a YouTube/Vimeo link is a public
  // embed; drip and enrollment do not protect it. The notice stays under the field.
  it("warns under the link field that the YouTube/Vimeo video is not protected", () => {
    render(
      <I18nProvider initialLocale="en">
        <ChangeLanguage />
        <LessonVideoSourcePicker mode="link" accept="video/*" externalUrl=""
          embedStatus="" onModeChange={vi.fn()} onSelectFile={vi.fn()} onLinkChange={vi.fn()} />
      </I18nProvider>,
    );

    // A free preview lesson hands the upload to any visitor: the text does not
    // promise "enrolled only", only that the upload goes through the access check.
    const en = "YouTube and Vimeo videos stay viewable by anyone with the link, even outside SkillsetMind. Upload the video here so playback goes through SkillsetMind's access check.";
    const es = "Cualquiera que tenga el enlace puede ver los videos de YouTube y Vimeo, incluso fuera de SkillsetMind. Sube el video aquí para que la reproducción pase por el control de acceso de SkillsetMind.";
    expect(screen.getByText(en)).toBeInTheDocument();
    expect(urlField()).toHaveAccessibleDescription(en);
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText(es)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "URL de YouTube o Vimeo" })).toHaveAccessibleDescription(es);
  });

  it("the protection notice stays in the field description alongside the rejected link error", () => {
    renderPicker({ mode: "link" });

    fireEvent.change(urlField() as HTMLElement, { target: { value: "https://example.test/v.mp4" } });
    fireEvent.blur(urlField() as HTMLElement);
    expect(urlField()).toHaveAccessibleDescription(
      /^Only YouTube and Vimeo video links are accepted\. This link was not saved\. YouTube and Vimeo videos stay viewable/,
    );
  });

  it("keeps the drop area active when switching language", () => {
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

  // Choosing does NOT declare the source: `videoSource` is persisted by the autosave and is
  // the field the learner reads to choose the player. Whoever declares the source is the
  // upload's success path, in lesson-content-modal. (Product audit
  // of 2026-08-30, finding P-01.)
  it("selects the dropped video without declaring the source or switching mode", () => {
    const props = renderPicker();
    const file = videoFile();

    fireEvent.drop(screen.getByText(/Drag & drop your video here/i), {
      dataTransfer: { files: [file] },
    });

    expect(props.onSelectFile).toHaveBeenCalledWith(file);
    expect(props.onModeChange).not.toHaveBeenCalled();
    expect(props.onLinkChange).not.toHaveBeenCalled();
  });

  it("ignores a dropped file that is not a video", () => {
    const props = renderPicker();

    fireEvent.drop(screen.getByText(/Drag & drop your video here/i), {
      dataTransfer: {
        files: [new File(["x"], "notes.pdf", { type: "application/pdf" })],
      },
    });

    expect(props.onSelectFile).not.toHaveBeenCalled();
  });

  it("selects the video chosen in the browser without declaring the source", () => {
    const props = renderPicker();
    const file = videoFile();

    fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
      target: { files: [file] },
    });

    expect(props.onSelectFile).toHaveBeenCalledWith(file);
    expect(props.onModeChange).not.toHaveBeenCalled();
  });

  it("shows the embedded link state", () => {
    renderPicker({ mode: "link", embedStatus: "YouTube embed detected." });

    expect(screen.getByText("YouTube embed detected.")).toBeInTheDocument();
  });

  it("disabled: nothing responds, not even the mode switch", () => {
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
