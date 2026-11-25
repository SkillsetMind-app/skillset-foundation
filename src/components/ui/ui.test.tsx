import { cleanup, render, screen } from "@testing-library/react";
import { Loader2 } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";

import {
  BusyLabel,
  Button,
  Card,
  EmptyState,
  Eyebrow,
  Field,
  InlineAlert,
  ProgressBar,
  SectionHeader,
  buttonClasses,
} from "@/components/ui";
import { SpotArt } from "@/components/ui/spot-art";

// A single file for the seven primitives: they are small components, and
// seven test files would cost seven jsdom initializations without proving
// anything more.
afterEach(cleanup);

describe("Button", () => {
  it("brings the layout that the global classes do not", () => {
    render(<Button>Salvar</Button>);

    const button = screen.getByRole("button", { name: "Salvar" });
    // The global class only paints border, background, color and shadow. Radius, spacing and
    // icon alignment were copied in 361 places.
    expect(button).toHaveClass("button-solid", "inline-flex", "items-center", "gap-2");
    expect(button).toHaveClass("rounded-md");
  });

  it("maps each variant to the matching global class", () => {
    render(
      <>
        <Button variant="outline">Voltar</Button>
        <Button variant="danger">Excluir</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Voltar" })).toHaveClass("button-outline");
    expect(screen.getByRole("button", { name: "Excluir" })).toHaveClass("button-danger");
  });

  it("defaults to type=button so it does not submit the form by accident", () => {
    render(<Button>Adicionar linha</Button>);

    expect(screen.getByRole("button", { name: "Adicionar linha" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("large brass loading: the spinner takes the icon's place and the button locks", () => {
    render(
      <Button variant="accent" size="lg" loading icon={<svg data-testid="icone" />}>
        Publicar
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Publicar" });
    expect(button).toHaveClass("button-accent", "button-lg");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("icone")).toBeNull();
    // The ring only spins without "reduce motion"; with it on, it stays still and in
    // view (it does not disappear).
    const ring = button.querySelector("svg")!;
    expect(ring).toHaveClass("motion-safe:animate-spin");
    expect(ring).not.toHaveClass("animate-spin");
  });

  it("without busyLabel, the markup is the usual one (spinner or icon, then the text)", () => {
    const ring = <Loader2 aria-hidden="true" size={16} strokeWidth={2.2} className="shrink-0 motion-safe:animate-spin" />;
    const cases = [
      { loading: false, reference: <svg data-testid="icone" /> },
      { loading: true, reference: ring },
    ];
    for (const { loading, reference } of cases) {
      const { container: current, unmount } = render(
        <Button variant="accent" loading={loading} icon={<svg data-testid="icone" />}>
          Publicar
        </Button>,
      );
      const html = current.innerHTML;
      unmount();
      // A literal copy of what the Button wrote before busyLabel existed.
      const { container: before, unmount: unmountBefore } = render(
        <button
          type="button"
          className={buttonClasses({ variant: "accent" })}
          disabled={loading}
          aria-busy={loading || undefined}
        >
          {reference}
          Publicar
        </button>,
      );
      expect(html).toBe(before.innerHTML);
      unmountBefore();
    }
  });

  it("with busyLabel, both labels share the same cell and the name is the visible one", () => {
    const { rerender } = render(
      <Button loading={false} busyLabel="Salvando...">
        Salvar
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Salvar" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
    // Both labels always exist, stacked in the same cell.
    const idle = screen.getByText("Salvar");
    const busy = screen.getByText("Salvando...");
    expect(idle).toHaveClass("[grid-area:1/1]");
    expect(busy).toHaveClass("[grid-area:1/1]");
    expect(idle.parentElement).toBe(busy.parentElement);
    expect(idle.parentElement).toHaveClass("inline-grid");
    expect(busy).toHaveClass("invisible");
    expect(busy).toHaveAttribute("aria-hidden", "true");
    expect(idle).not.toHaveClass("invisible");
    expect(idle).not.toHaveAttribute("aria-hidden");
    // The spinner's spot is already reserved at rest (on the waiting face).
    const ring = busy.querySelector("svg")!;
    expect(ring).toHaveClass("motion-safe:animate-spin");

    rerender(
      <Button loading busyLabel="Salvando...">
        Salvar
      </Button>,
    );

    const waiting = screen.getByRole("button", { name: "Salvando..." });
    expect(waiting).toBe(button);
    expect(waiting).toBeDisabled();
    expect(waiting).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
    expect(idle).toHaveClass("invisible");
    expect(idle).toHaveAttribute("aria-hidden", "true");
    expect(busy).not.toHaveClass("invisible");
    expect(busy).not.toHaveAttribute("aria-hidden");
    // The same spinner, in the same place: nothing enters or leaves the button.
    expect(busy.querySelector("svg")).toBe(ring);
  });

  it("with busyLabel and an icon: the icon stays on the resting face and the spinner on the waiting one", () => {
    render(
      <Button loading busyLabel="Publicando..." icon={<svg data-testid="icone" />}>
        Publicar
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Publicando..." })).toBeDisabled();
    expect(screen.getByTestId("icone").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Publicando...").querySelector("svg")).toHaveClass("motion-safe:animate-spin");
  });

  it("exposes the same outfit as text, for a Link dressed as a button", () => {
    expect(buttonClasses({ variant: "outline", size: "sm" })).toContain("button-outline");
    expect(buttonClasses({ variant: "outline", size: "sm" })).toContain("text-xs");
  });
});

describe("BusyLabel", () => {
  it("keeps the width of the larger label and only swaps what is visible and the name", () => {
    const { rerender } = render(
      <button type="button" className="button-solid">
        <BusyLabel busy={false} idle="Enviar" busyText="Enviando..." />
      </button>,
    );

    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
    const idle = screen.getByText("Enviar");
    const busy = screen.getByText("Enviando...");
    expect(idle.parentElement).toBe(busy.parentElement);
    expect(idle.parentElement).toHaveClass("inline-grid");
    expect(idle).toHaveClass("[grid-area:1/1]");
    expect(busy).toHaveClass("[grid-area:1/1]", "invisible");
    expect(busy).toHaveAttribute("aria-hidden", "true");
    // No spinner: these buttons never had one.
    expect(busy.querySelector("svg")).toBeNull();

    rerender(
      <button type="button" className="button-solid">
        <BusyLabel busy idle="Enviar" busyText="Enviando..." />
      </button>,
    );

    expect(screen.getByRole("button", { name: "Enviando..." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar" })).toBeNull();
    expect(idle).toHaveClass("invisible");
    expect(idle).toHaveAttribute("aria-hidden", "true");
    expect(busy).not.toHaveClass("invisible");
    expect(busy).not.toHaveAttribute("aria-hidden");
  });
});

describe("Card", () => {
  it("aponta para as variáveis em vez de bg-white", () => {
    const { container } = render(<Card>conteúdo</Card>);

    const card = container.firstElementChild!;
    expect(card.className).toContain("bg-[var(--color-surface)]");
    expect(card).toHaveClass("rounded-lg");
    expect(card.className).toContain("border-[var(--color-line)]");
    // bg-white is trampled in the dark theme by a global rule with
    // !important that not even the certificate exception can beat.
    expect(card.className).not.toContain("bg-white");
  });

  it("respeita a etiqueta pedida", () => {
    const { container } = render(
      <Card as="section" tone="soft" padding="none">
        conteúdo
      </Card>,
    );

    const card = container.firstElementChild!;
    expect(card.tagName).toBe("SECTION");
    expect(card.className).toContain("bg-[var(--color-surface-soft)]");
    expect(card.className).not.toContain("p-4");
  });

  // A list-row card does not lift off the surface. Without this escape hatch the
  // primitive would not suit the two places that already use it that way.
  it("drops the shadow when the card lives inside another one", () => {
    const { container } = render(<Card shadow={false}>linha</Card>);

    expect(container.firstElementChild!.className).not.toContain("shadow-");
  });
});

describe("InlineAlert", () => {
  // 187 red surfaces in the project against 23 role="alert": most errors
  // never reached people who use a screen reader.
  it("announces the error instead of just painting it red", () => {
    render(<InlineAlert tone="error">Não foi possível salvar.</InlineAlert>);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Não foi possível salvar.");
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("notifies without interrupting in the tones that are not errors", () => {
    render(<InlineAlert tone="success">Domínio conectado.</InlineAlert>);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Without an icon, the only difference between error, warning, success and info was
  // color. The icon is decorative: the alert's name is still the sentence.
  it.each(["error", "warning", "success", "info"] as const)("tone %s brings its own icon, hidden from the screen reader", (tone) => {
    const { container } = render(<InlineAlert tone={tone}>Mensagem.</InlineAlert>);

    const box = container.firstElementChild!;
    const icons = box.querySelectorAll("svg");
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute("aria-hidden", "true");
    expect(icons[0]).toHaveAttribute("width", "16");
    expect(box).toHaveClass("flex", "items-start", "gap-2");
    expect(box).toHaveTextContent("Mensagem.");
  });

  it("each tone has a different icon", () => {
    const { container } = render(
      <>
        {(["error", "warning", "success", "info"] as const).map((tone) => (
          <InlineAlert key={tone} tone={tone}>{tone}</InlineAlert>
        ))}
      </>,
    );

    const classes = [...container.querySelectorAll("svg")].map((icon) => icon.getAttribute("class"));
    expect(new Set(classes).size).toBe(4);
  });

  // The error background comes from the theme variable, which rises to 18% in dark (the
  // literal 6% vanished over the near-black).
  it("the error background follows the theme (--color-danger-soft)", () => {
    render(<InlineAlert tone="error">Falhou.</InlineAlert>);
    expect(screen.getByRole("alert").className).toContain("bg-[var(--color-danger-soft)]");
    // Error text in danger-fg, never in brass (revisao-pr494.test.ts, C3).
    expect(screen.getByRole("alert").className).toContain("text-[var(--color-danger-fg)]");
  });

  it("a title and pieces with a link sit in an inner wrapper beside the icon, in order", () => {
    render(
      <InlineAlert tone="warning" title="Atenção">
        Leia antes. <a href="/x">Abrir</a>
      </InlineAlert>,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("AtençãoLeia antes. Abrir");
    const body = status.lastElementChild!;
    expect(body).toHaveClass("min-w-0", "flex-1");
    expect(body.firstElementChild).toHaveTextContent("Atenção");
    expect(body.querySelector("a")).toHaveAttribute("href", "/x");
  });

  // Six screens already arrange the children in flex in the box itself (one with its own
  // warning icon): they carry on with no extra icon and with the children loose.
  it("whoever arranges the children in flex carries on as before: no extra icon or inner wrapper", () => {
    render(
      <InlineAlert tone="error" className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <span>Falhou.</span>
        <button type="button">Tentar de novo</button>
      </InlineAlert>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.querySelector("svg")).toBeNull();
    expect(alert.firstElementChild?.tagName).toBe("SPAN");
    expect(alert).toHaveClass("justify-between");
    expect(alert).not.toHaveClass("items-start");
  });
});

describe("ProgressBar", () => {
  it("tells the value to the screen reader, from 0 to 100", () => {
    render(<ProgressBar value={40} label="Progress" />);

    const bar = screen.getByRole("progressbar", { name: "Progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("clamps the value at the ends", () => {
    render(
      <>
        <ProgressBar value={140} label="Acima" />
        <ProgressBar value={-5} label="Abaixo" />
      </>,
    );

    expect(screen.getByRole("progressbar", { name: "Acima" })).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("progressbar", { name: "Abaixo" })).toHaveAttribute("aria-valuenow", "0");
  });

  // Sign-up and interview: the screen reader hears the step, not the percentage.
  it("in steps, tells the step from 1 to the total and the phrase; the value only draws", () => {
    render(<ProgressBar value={50} step={{ current: 1, total: 2 }} label="Step 1 of 2" />);

    const bar = screen.getByRole("progressbar", { name: "Step 1 of 2" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemin", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "2");
    expect(bar).toHaveAttribute("aria-valuetext", "Step 1 of 2");
    expect((bar.firstElementChild as HTMLElement).style.transform).toBe("translateX(-50%)");
  });

  it("without steps, does not write valuetext", () => {
    render(<ProgressBar value={40} label="Progress" />);
    expect(screen.getByRole("progressbar", { name: "Progress" })).not.toHaveAttribute("aria-valuetext");
  });

  // Track from the line variable (navy at 12% vanished in dark) and motion
  // only in transform, inside motion-safe.
  it("one height, a track that follows the theme and a fill that slides with transform", () => {
    render(<ProgressBar value={25} label="Curso" />);

    const bar = screen.getByRole("progressbar", { name: "Curso" });
    expect(bar).toHaveClass("h-1.5", "rounded-full", "overflow-hidden", "bg-[var(--color-line)]");
    const fill = bar.firstElementChild as HTMLElement;
    // TEXT brass: the background one (--color-accent) gave 1.44:1 against the track.
    expect(fill).toHaveClass("bg-[var(--color-accent-fg)]", "motion-safe:transition-transform");
    expect(fill.className).not.toMatch(/transition-\[width\]|transition-all/);
    expect(fill.style.transform).toBe("translateX(-75%)");
  });

  it("accepts the track and fill of an area with its own theme", () => {
    render(
      <ProgressBar
        value={50}
        label="Área"
        className="bg-[var(--ma-surface-2)]"
        fillClassName="bg-[var(--ma-accent)]"
      />,
    );

    const bar = screen.getByRole("progressbar", { name: "Área" });
    expect(bar).toHaveClass("bg-[var(--ma-surface-2)]");
    expect(bar).not.toHaveClass("bg-[var(--color-line)]");
    expect(bar.firstElementChild).toHaveClass("bg-[var(--ma-accent)]");
    expect(bar.firstElementChild).not.toHaveClass("bg-[var(--color-accent-fg)]");
  });
});

describe("Field", () => {
  it("links label, hint and error to the control", () => {
    render(
      <Field id="hostname" label="Adicionar domínio" hint="Sem http." error="Domínio inválido.">
        {(a11y) => <input {...a11y} />}
      </Field>,
    );

    const input = screen.getByLabelText(/Adicionar domínio/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    // The hint before the error: that is the order in which the person needs both.
    expect(input).toHaveAttribute("aria-describedby", "hostname-hint hostname-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Domínio inválido.");
  });

  it("does not mark the field invalid while there is no error", () => {
    render(
      <Field id="email-field" label="E-mail">
        {(a11y) => <input {...a11y} />}
      </Field>,
    );

    const input = screen.getByLabelText("E-mail");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).not.toHaveAttribute("aria-describedby");
  });
});

describe("Eyebrow", () => {
  it("uses a single tracking value", () => {
    const { container } = render(<Eyebrow>Teacher Studio</Eyebrow>);

    const eyebrow = container.firstElementChild!;
    expect(eyebrow.className).toContain("tracking-[0.22em]");
    expect(eyebrow.className).toContain("uppercase");
    expect(eyebrow.className).toContain("text-[var(--color-accent-fg)]");
  });
});

describe("SectionHeader", () => {
  it("builds the eyebrow, title and description at the requested heading level", () => {
    render(
      <SectionHeader
        eyebrow="Media library"
        title="Arquivos do curso"
        description="Revise o que foi enviado."
        as="h3"
      />,
    );

    expect(screen.getByRole("heading", { level: 3, name: "Arquivos do curso" })).toBeInTheDocument();
    expect(screen.getByText("Media library")).toBeInTheDocument();
    expect(screen.getByText("Revise o que foi enviado.")).toBeInTheDocument();
  });

  // The serif is kept for the page headline; a card title is the sans.
  it("with size=card, the title is the card's sans, not the page's serif", () => {
    render(<SectionHeader title="Your own domain" size="card" />);

    const heading = screen.getByRole("heading", { level: 2, name: "Your own domain" });
    expect(heading).not.toHaveClass("display-title");
    expect(heading).toHaveClass("text-lg", "font-semibold");
  });
});

describe("EmptyState", () => {
  it("uses a single dashed shape and accepts the action", () => {
    const { container } = render(
      <EmptyState
        title="Crie um curso primeiro."
        description="Os arquivos ficam presos a um curso."
        action={<Button>Criar curso</Button>}
      />,
    );

    const box = container.firstElementChild!;
    expect(box.className).toContain("border-dashed");
    expect(box).toHaveClass("rounded-lg");
    expect(screen.getByRole("button", { name: "Criar curso" })).toBeInTheDocument();
  });

  it("with a scene: the engraving comes before the text, hidden from the screen reader, and the title is sans", () => {
    const { container } = render(
      <EmptyState
        title="Tu primer producto empieza aquí."
        art={<SpotArt scene="firstProduct" />}
        action={<Button>Crear mi primer producto</Button>}
      />,
    );

    const box = container.firstElementChild!;
    const art = box.firstElementChild!;
    // The scene rises 6px and lights up (motion catalog, item 10).
    expect(art).toHaveClass("empty-state__art", "spot-art-in");
    expect(art.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const heading = screen.getByRole("heading", { name: "Tu primer producto empieza aquí." });
    expect(heading).toHaveClass("text-lg", "font-semibold");
    expect(heading).not.toHaveClass("display-title");
    expect(screen.getByRole("button", { name: "Crear mi primer producto" })).toBeInTheDocument();
  });

  it("without a scene, no art frame", () => {
    const { container } = render(<EmptyState title="Vazio." />);
    expect(container.querySelector(".empty-state__art")).toBeNull();
  });
});
