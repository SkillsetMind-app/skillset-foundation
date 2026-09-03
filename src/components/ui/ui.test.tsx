import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Button,
  Card,
  EmptyState,
  Eyebrow,
  Field,
  InlineAlert,
  SectionHeader,
  buttonClasses,
} from "@/components/ui";

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
    expect(button.className).toContain("rounded-[var(--radius-md)]");
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
    expect(card.className).toContain("rounded-[var(--radius-xl)]");
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
    expect(box.className).toContain("rounded-[var(--radius-xl)]");
    expect(screen.getByRole("button", { name: "Criar curso" })).toBeInTheDocument();
  });
});
