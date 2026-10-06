import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InstructorDetailPage, { generateMetadata } from "@/app/instructors/[slug]/page";
import { RealCoursesProvider } from "@/components/site/real-courses";
import type { PublicProfile } from "@/domain/user-profile";
import type { CreatorCourse } from "@/lib/data/server/public-profile";

const mocks = vi.hoisted(() => ({
  getPublicProfileByRef: vi.fn<(ref: string) => Promise<PublicProfile | null>>(),
  listCreatorCourses: vi.fn<(uid: string) => Promise<CreatorCourse[] | null>>(),
  // Como o Next: notFound() interrompe a renderização lançando.
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  locale: "en",
}));

vi.mock("@/lib/data/server/public-profile", () => ({
  getPublicProfileByRef: mocks.getPublicProfileByRef,
  listCreatorCourses: mocks.listCreatorCourses,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.locale }) }) }));

const ana: PublicProfile = {
  uid: "6f1c2a7e-0000-4000-8000-000000000001",
  displayName: "Ana Souza",
  username: "ana.souza",
  photoURL: null,
  bio: "Coach de carreira há doze anos. ".repeat(10).trim(),
  credentials: ["ICF Associate Certified Coach"],
  storefront: { showcase: { tagline: "Career coach for first-time managers", featuredCourseId: "c-2" } },
  updatedAt: "2026-10-05T12:00:00.000Z",
};

const course = (id: string, title: string, extra: Partial<CreatorCourse> = {}): CreatorCourse => ({
  id,
  href: `/courses/${id}`,
  title,
  coverImageUrl: null,
  free: false,
  priceAmountMinor: 4900,
  currency: "USD",
  ratingAverage: 0,
  ratingCount: 0,
  ...extra,
});

const courses = [
  course("c-1", "Alpha", { free: true, priceAmountMinor: null }),
  course("c-2", "Bravo", { ratingAverage: 4.5, ratingCount: 4 }),
];

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function renderPage(slug: string, hasRealCourses = true) {
  const page = await InstructorDetailPage(params(slug));
  return render(<RealCoursesProvider value={hasRealCourses}>{page}</RealCoursesProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = "en";
  mocks.getPublicProfileByRef.mockImplementation(async (ref) =>
    ref === "@ana.souza" || ref === ana.uid ? ana : null,
  );
  mocks.listCreatorCourses.mockResolvedValue(courses);
});
afterEach(cleanup);

describe("metadata do perfil", () => {
  it("título, descrição, canônico e cartão são do professor", async () => {
    const metadata = await generateMetadata(params("@ana.souza"));

    expect(metadata.title).toBe("Ana Souza (@ana.souza) · Career coach for first-time managers | SkillsetMind");
    expect(metadata.description).toBe("Career coach for first-time managers");
    expect(metadata.alternates?.canonical).toBe("https://www.skillsetmind.com/@ana.souza");
    expect(metadata.openGraph?.images).toEqual([
      // ?v= muda quando o perfil muda: WhatsApp e Facebook guardam o cartão
      // pela URL, e sem isso a foto nova nunca aparecia.
      { url: `https://www.skillsetmind.com/instructors/${ana.uid}/opengraph-image?v=2026-10-05T12%3A00%3A00.000Z` },
    ]);
  });

  it("plano que tira a marca: o título não termina com '| SkillsetMind'", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({
      ...ana,
      storefront: { ...ana.storefront, branding: { hidePlatformBrand: true } },
    });
    const metadata = await generateMetadata(params("@ana.souza"));
    expect(metadata.title).toBe("Ana Souza (@ana.souza) · Career coach for first-time managers");
  });

  it("sem tagline, a descrição são os primeiros ~155 caracteres da bio", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({ ...ana, storefront: null });
    const metadata = await generateMetadata(params("@ana.souza"));

    expect(metadata.title).toBe("Ana Souza (@ana.souza) | SkillsetMind");
    expect(metadata.description).toMatch(/^Coach de carreira há doze anos\./);
    expect(metadata.description!.length).toBeLessThanOrEqual(156);
    expect(metadata.description).toMatch(/…$/);
  });

  it("o mesmo perfil por /instructors/{uid} declara /@usuario como canônico", async () => {
    const metadata = await generateMetadata(params(ana.uid));
    expect(metadata.alternates?.canonical).toBe("https://www.skillsetmind.com/@ana.souza");
  });

  it("sem @, o canônico continua sendo /instructors/{uid}", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({ ...ana, username: null });
    const metadata = await generateMetadata(params(ana.uid));
    expect(metadata.alternates?.canonical).toBe(`https://www.skillsetmind.com/instructors/${ana.uid}`);
  });

  it("o @ codificado (%40) acha o mesmo perfil", async () => {
    await generateMetadata(params("%40ana.souza"));
    expect(mocks.getPublicProfileByRef).toHaveBeenCalledWith("@ana.souza");
  });

  it("leitura que falhou não inventa professor: metadata genérica e fora do índice", async () => {
    mocks.getPublicProfileByRef.mockRejectedValue(new Error("banco fora"));
    const metadata = await generateMetadata(params("@ana.souza"));
    expect(metadata.title).toBe("Instructor | SkillsetMind");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("página do perfil", () => {
  it("@ ou uid inexistente é 404 de verdade", async () => {
    await expect(InstructorDetailPage(params("@ninguem"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(InstructorDetailPage(params("uid-inventado"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.listCreatorCourses).not.toHaveBeenCalled();
  });

  it("leitura que falhou vira erro, nunca 404", async () => {
    mocks.getPublicProfileByRef.mockRejectedValue(new Error("banco fora"));
    await expect(InstructorDetailPage(params("@ana.souza"))).rejects.toThrow("banco fora");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("segue a ordem do link da bio, do cabeçalho ao rodapé", async () => {
    const { container } = await renderPage("@ana.souza");

    const order = [...container.querySelectorAll("[data-section]")].map((node) => node.getAttribute("data-section"));
    expect(order).toEqual(["header", "primary", "courses", "proof", "about", "footer"]);

    expect(screen.getByRole("heading", { level: 1, name: "Ana Souza" })).toBeInTheDocument();
    expect(screen.getByText("@ana.souza")).toBeInTheDocument();
    // Botão principal = curso em destaque (Bravo), não o primeiro da lista.
    expect(container.querySelector('[data-section="primary"]')).toHaveAttribute("href", "/courses/c-2");
    expect(container.querySelector('[data-section="primary"]')).toHaveTextContent("Bravo");
    // Linhas: destaque primeiro; preço ou "Free"; nota.
    const rows = screen.getAllByRole("listitem").filter((item) => item.querySelector(".marketplace-card--row"));
    expect(rows.map((row) => row.querySelector("h3")?.textContent)).toEqual(["Bravo", "Alpha"]);
    expect(rows[1]).toHaveTextContent("Free");
    expect(rows[0]).toHaveTextContent("$49.00");
    // Prova: só a nota. Inscrições saíram (enrollment_count não é mantido).
    expect(container.querySelector('[data-section="proof"]')).toHaveTextContent("4.5(4 ratings)");
    expect(container.textContent).not.toMatch(/enrollment|student/i);
    // Rodapé leva a quem quer criar, não à loja.
    expect(screen.getByRole("link", { name: "Made with SkillsetMind" })).toHaveAttribute("href", "/for-creators");
  });

  it("professor verificado: o selo com as palavras logo depois do nome", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({
      ...ana,
      verification: { kind: "evidence", verifiedAt: "2026-09-01T12:00:00.000Z" },
    });
    await renderPage("@ana.souza");

    const heading = screen.getByRole("heading", { level: 1, name: "Ana Souza" });
    const badge = screen.getByRole("button", { name: "Verified professional" });
    expect(heading.nextElementSibling).toContainElement(badge);
    expect(badge.closest("header")).toHaveAttribute("data-section", "header");
  });

  it("sem verificação, sem selo", async () => {
    await renderPage("@ana.souza");
    expect(screen.queryByRole("button", { name: "Verified professional" })).toBeNull();
  });

  it("sem curso, sem botão principal e sem faixa de prova", async () => {
    mocks.listCreatorCourses.mockResolvedValue([]);
    const { container } = await renderPage("@ana.souza");

    const order = [...container.querySelectorAll("[data-section]")].map((node) => node.getAttribute("data-section"));
    expect(order).toEqual(["header", "courses", "about", "footer"]);
    expect(screen.getByText("No public courses yet")).toBeInTheDocument();
  });

  it("prova zerada não aparece", async () => {
    mocks.listCreatorCourses.mockResolvedValue([course("c-1", "Alpha")]);
    const { container } = await renderPage("@ana.souza");
    expect(container.querySelector('[data-section="proof"]')).toBeNull();
  });

  // Item de layout: com `truncate`, o título longo do botão principal dava ao
  // grid a largura do texto (448px numa área de 343px a 375px) e o
  // .page-shell cortava o resto. A coluna tem de poder encolher.
  it("a coluna encolhe para caber no celular, mesmo com título longo no botão", async () => {
    mocks.listCreatorCourses.mockResolvedValue([course("c-2", "How to Lead Your First Team Without Burning Out Again")]);
    const { container } = await renderPage("@ana.souza");
    expect(container.querySelector("article")).toHaveClass("grid-cols-[minmax(0,1fr)]");
    expect(container.querySelector('[data-section="primary"]')).toHaveClass("min-w-0");
  });

  it("bio curta aparece inteira, sem 'Read more'", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({ ...ana, bio: "Coach for first-time managers." });
    const { container } = await renderPage("@ana.souza");
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("Coach for first-time managers.")).not.toHaveClass("line-clamp-3");
  });

  it("bio longa recolhida, com um botão de nome curto", async () => {
    const { container } = await renderPage("@ana.souza");
    const summary = container.querySelector("details > summary");
    // O nome acessível é "Read more", não a bio inteira.
    expect(summary?.textContent).toBe("Read more");
    expect(screen.getByText(ana.bio!)).toHaveClass("line-clamp-3");
  });

  it("plano com vitrine: logo do professor, botão na cor da marca e tema no cabeçalho", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({
      ...ana,
      storefront: {
        ...ana.storefront,
        branding: { logoUrl: "https://cdn.example/ana-logo.png", accentColor: "#f5c518", themePreset: "warm" },
      },
    });
    const { container } = await renderPage("@ana.souza");

    // Starter também mostra o logo; a nossa marca segue no rodapé.
    expect(screen.getByRole("img", { name: "Ana Souza" })).toHaveAttribute("src", "https://cdn.example/ana-logo.png");
    expect(screen.getByRole("link", { name: "Made with SkillsetMind" })).toBeInTheDocument();
    // Amarelo: o texto do botão é escuro (readableTextOnAccent).
    const primary = container.querySelector<HTMLElement>('[data-section="primary"]')!;
    expect(primary).toHaveAttribute("data-accent");
    expect(primary.style.getPropertyValue("--storefront-accent")).toBe("#f5c518");
    expect(primary.style.getPropertyValue("--storefront-accent-ink")).toBe("#0a0d12");
    expect(container.querySelector('[data-section="header"]')).toHaveAttribute("data-storefront-theme", "warm");
  });

  it("nada do perfil leva ao marketplace, nem o menu do site", async () => {
    const { container } = await renderPage("@ana.souza");

    const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(hrefs.filter((href) => href === "/courses" || href === "/instructors")).toEqual([]);
    expect(hrefs.every((href) => href === "/" || href === "/for-creators" || href?.startsWith("/courses/"))).toBe(true);
    expect(container.textContent).not.toMatch(/marketplace|Instructor storefront|Lessons|Categories/i);
  });

  // Regra da loja (#471): sem curso real publicado, nenhum link para /courses.
  // O perfil não linka a loja nem quando ela tem curso: o visitante veio do
  // Instagram do professor e só sai daqui para um curso dele.
  it.each([true, false])("com a loja %s, nenhum link para /courses", async (hasRealCourses) => {
    const { container } = await renderPage("@ana.souza", hasRealCourses);
    expect(container.querySelectorAll('a[href="/courses"]')).toHaveLength(0);
    expect(container.querySelectorAll('a[href^="/courses/"]').length).toBeGreaterThan(0);
  });

  it("plano sem a marca da plataforma: sem logo nosso e sem 'Made with'", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({
      ...ana,
      storefront: { ...ana.storefront, branding: { hidePlatformBrand: true, logoUrl: "https://cdn.example/ana-logo.png" } },
    });
    const { container } = await renderPage("@ana.souza");
    expect(container.querySelector('a[href="/"]')).toBeNull();
    // No lugar do nosso, o logo do professor.
    expect(screen.getByRole("img", { name: "Ana Souza" })).toHaveAttribute("src", "https://cdn.example/ana-logo.png");
    expect(container.querySelector('[data-section="footer"]')).toBeNull();
  });

  it("cursos que não carregaram: o perfil fica no ar com o aviso", async () => {
    mocks.listCreatorCourses.mockResolvedValue(null);
    await renderPage("@ana.souza");
    expect(screen.getByText("Instructor courses could not load right now.")).toBeInTheDocument();
  });

  it("em espanhol", async () => {
    mocks.locale = "es";
    await renderPage("@ana.souza");
    expect(screen.getByRole("link", { name: "Hecho con SkillsetMind" })).toBeInTheDocument();
  });
});
