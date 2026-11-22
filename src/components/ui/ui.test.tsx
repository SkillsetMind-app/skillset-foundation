import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
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

// Um arquivo só para os sete primitivos: são componentes de uma tela cada, e
// sete arquivos de teste custariam sete inicializações de jsdom sem provar
// nada a mais.
afterEach(cleanup);

describe("Button", () => {
  it("traz o layout que as classes globais não trazem", () => {
    render(<Button>Salvar</Button>);

    const button = screen.getByRole("button", { name: "Salvar" });
    // A classe global só pinta borda, fundo, cor e sombra. Raio, espaçamento e
    // alinhamento do ícone estavam copiados em 361 lugares.
    expect(button).toHaveClass("button-solid", "inline-flex", "items-center", "gap-2");
    expect(button).toHaveClass("rounded-md");
  });

  it("mapeia cada variante na classe global correspondente", () => {
    render(
      <>
        <Button variant="outline">Voltar</Button>
        <Button variant="danger">Excluir</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Voltar" })).toHaveClass("button-outline");
    expect(screen.getByRole("button", { name: "Excluir" })).toHaveClass("button-danger");
  });

  it("nasce type=button para não enviar o formulário sem querer", () => {
    render(<Button>Adicionar linha</Button>);

    expect(screen.getByRole("button", { name: "Adicionar linha" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("latão grande carregando: o spinner toma o lugar do ícone e o botão trava", () => {
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
    expect(button.querySelector(".animate-spin")).not.toBeNull();
  });

  it("expõe a mesma roupa em texto, para Link vestido de botão", () => {
    expect(buttonClasses({ variant: "outline", size: "sm" })).toContain("button-outline");
    expect(buttonClasses({ variant: "outline", size: "sm" })).toContain("text-xs");
  });
});

describe("Card", () => {
  it("aponta para as variáveis em vez de bg-white", () => {
    const { container } = render(<Card>conteúdo</Card>);

    const card = container.firstElementChild!;
    expect(card.className).toContain("bg-[var(--color-surface)]");
    expect(card).toHaveClass("rounded-lg");
    expect(card.className).toContain("border-[var(--color-line)]");
    // bg-white é atropelado no tema escuro por uma regra global com
    // !important que nem a exceção do certificado consegue vencer.
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

  // Cartão de linha de lista não levanta da superfície. Sem esta saída o
  // primitivo não serviria para os dois lugares que já o usam assim.
  it("dispensa a sombra quando o cartão vive dentro de outro", () => {
    const { container } = render(<Card shadow={false}>linha</Card>);

    expect(container.firstElementChild!.className).not.toContain("shadow-");
  });
});

describe("InlineAlert", () => {
  // 187 superfícies vermelhas no projeto contra 23 role="alert": a maioria dos
  // erros nunca chegava a quem usa leitor de tela.
  it("anuncia o erro em vez de só pintar de vermelho", () => {
    render(<InlineAlert tone="error">Não foi possível salvar.</InlineAlert>);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Não foi possível salvar.");
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("avisa sem interromper nos tons que não são erro", () => {
    render(<InlineAlert tone="success">Domínio conectado.</InlineAlert>);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Sem ícone, a única diferença entre erro, aviso, sucesso e informação era a
  // cor. O ícone é decorativo: o nome do aviso continua sendo a frase.
  it.each(["error", "warning", "success", "info"] as const)("tom %s traz o próprio ícone, escondido do leitor de tela", (tone) => {
    const { container } = render(<InlineAlert tone={tone}>Mensagem.</InlineAlert>);

    const box = container.firstElementChild!;
    const icons = box.querySelectorAll("svg");
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute("aria-hidden", "true");
    expect(icons[0]).toHaveAttribute("width", "16");
    expect(box).toHaveClass("flex", "items-start", "gap-2");
    expect(box).toHaveTextContent("Mensagem.");
  });

  it("cada tom tem um ícone diferente", () => {
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

  // O fundo do erro vem da variável de tema, que sobe para 18% no escuro (o
  // literal de 6% sumia sobre o quase-preto).
  it("o fundo do erro segue o tema (--color-danger-soft)", () => {
    render(<InlineAlert tone="error">Falhou.</InlineAlert>);
    expect(screen.getByRole("alert").className).toContain("bg-[var(--color-danger-soft)]");
  });

  it("título e trechos com link ficam num miolo ao lado do ícone, na ordem", () => {
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

  // Seis telas já arrumam os filhos em flex na própria caixa (uma com o próprio
  // ícone de aviso): elas seguem sem ícone extra e com os filhos soltos.
  it("quem arruma os filhos em flex segue como antes: sem ícone extra nem miolo", () => {
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
  it("diz o valor ao leitor de tela, de 0 a 100", () => {
    render(<ProgressBar value={40} label="Progress" />);

    const bar = screen.getByRole("progressbar", { name: "Progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("corta o valor nas pontas", () => {
    render(
      <>
        <ProgressBar value={140} label="Acima" />
        <ProgressBar value={-5} label="Abaixo" />
      </>,
    );

    expect(screen.getByRole("progressbar", { name: "Acima" })).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("progressbar", { name: "Abaixo" })).toHaveAttribute("aria-valuenow", "0");
  });

  // Trilho pela variável de linha (o navy a 12% sumia no escuro) e movimento
  // só em transform, dentro de motion-safe.
  it("uma altura, trilho que segue o tema e preenchimento que desliza com transform", () => {
    render(<ProgressBar value={25} label="Curso" />);

    const bar = screen.getByRole("progressbar", { name: "Curso" });
    expect(bar).toHaveClass("h-1.5", "rounded-full", "overflow-hidden", "bg-[var(--color-line)]");
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill).toHaveClass("bg-[var(--color-accent)]", "motion-safe:transition-transform");
    expect(fill.className).not.toMatch(/transition-\[width\]|transition-all/);
    expect(fill.style.transform).toBe("translateX(-75%)");
  });

  it("aceita trilho e preenchimento de uma área com tema próprio", () => {
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
    expect(bar.firstElementChild).not.toHaveClass("bg-[var(--color-accent)]");
  });
});

describe("Field", () => {
  it("liga rótulo, dica e erro ao controle", () => {
    render(
      <Field id="hostname" label="Adicionar domínio" hint="Sem http." error="Domínio inválido.">
        {(a11y) => <input {...a11y} />}
      </Field>,
    );

    const input = screen.getByLabelText(/Adicionar domínio/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    // A dica antes do erro: é a ordem em que a pessoa precisa dos dois.
    expect(input).toHaveAttribute("aria-describedby", "hostname-hint hostname-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Domínio inválido.");
  });

  it("não marca o campo como inválido enquanto não há erro", () => {
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
  it("usa um tracking só", () => {
    const { container } = render(<Eyebrow>Teacher Studio</Eyebrow>);

    const eyebrow = container.firstElementChild!;
    expect(eyebrow.className).toContain("tracking-[0.22em]");
    expect(eyebrow.className).toContain("uppercase");
    expect(eyebrow.className).toContain("text-[var(--color-accent-fg)]");
  });
});

describe("SectionHeader", () => {
  it("monta eyebrow, título e descrição no nível de heading pedido", () => {
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

  // A serifa fica para a manchete da pagina; titulo de cartao e o sans.
  it("em size=card, o titulo e o sans do cartao, nao a serifa da pagina", () => {
    render(<SectionHeader title="Your own domain" size="card" />);

    const heading = screen.getByRole("heading", { level: 2, name: "Your own domain" });
    expect(heading).not.toHaveClass("display-title");
    expect(heading).toHaveClass("text-lg", "font-semibold");
  });
});

describe("EmptyState", () => {
  it("usa uma forma tracejada só e aceita a ação", () => {
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

  it("com cena: a gravura entra antes do texto, escondida do leitor de tela, e o título é sans", () => {
    const { container } = render(
      <EmptyState
        title="Tu primer producto empieza aquí."
        art={<SpotArt scene="firstProduct" />}
        action={<Button>Crear mi primer producto</Button>}
      />,
    );

    const box = container.firstElementChild!;
    const art = box.firstElementChild!;
    // A cena sobe 6px e acende (catálogo de movimento, item 10).
    expect(art).toHaveClass("empty-state__art", "spot-art-in");
    expect(art.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const heading = screen.getByRole("heading", { name: "Tu primer producto empieza aquí." });
    expect(heading).toHaveClass("text-lg", "font-semibold");
    expect(heading).not.toHaveClass("display-title");
    expect(screen.getByRole("button", { name: "Crear mi primer producto" })).toBeInTheDocument();
  });

  it("sem cena, nada de moldura de arte", () => {
    const { container } = render(<EmptyState title="Vazio." />);
    expect(container.querySelector(".empty-state__art")).toBeNull();
  });
});
