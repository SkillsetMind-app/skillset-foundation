import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { StorefrontSettingsPanel } from "@/components/teacher/storefront-settings-panel";

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  removeUserStorefrontImage: vi.fn(),
  subscribeToTeacherCourses: vi.fn(),
  updateUserStorefront: vi.fn(),
  uploadUserStorefrontImage: vi.fn(),
  router: { refresh: vi.fn() },
  user: { uid: "teacher-1" },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: mocks.subscribeToTeacherCourses,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  updateUserStorefront: mocks.updateUserStorefront,
}));

vi.mock("@/lib/data/profile-media", () => ({
  allowedAvatarTypes: ["image/jpeg", "image/png", "image/webp"],
  isAllowedAvatarFile: (file: File) =>
    ["image/jpeg", "image/png", "image/webp"].includes(file.type) &&
    file.size > 0 &&
    file.size <= 5 * 1024 * 1024,
  storefrontImageRequirementLabel: "JPG, PNG, or WebP under 5 MB",
  removeUserStorefrontImage: mocks.removeUserStorefrontImage,
  uploadUserStorefrontImage: mocks.uploadUserStorefrontImage,
}));

function LanguageControls() {
  const { setLocale } = useTranslation();
  return <>
    <button onClick={() => setLocale("en")}>Use EN</button>
    <button onClick={() => setLocale("es")}>Use ES</button>
  </>;
}

function renderWithLocale(locale: "en" | "es" = "en") {
  return render(
    <I18nProvider initialLocale={locale}>
      <LanguageControls />
      <StorefrontSettingsPanel />
    </I18nProvider>,
  );
}

describe("StorefrontSettingsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mocks.getUserProfile.mockReset();
    mocks.getUserProfile.mockResolvedValue({
      displayName: "Dr. Ana Silva",
      storefront: {
        branding: { themePreset: "default" },
        showcase: { orderedCourseIds: [] },
      },
    });
    mocks.subscribeToTeacherCourses.mockReset();
    mocks.subscribeToTeacherCourses.mockImplementation(
      (_uid: string, onData: (courses: unknown[]) => void) => {
        onData([]);
        return vi.fn();
      },
    );
    mocks.updateUserStorefront.mockReset();
    mocks.updateUserStorefront.mockResolvedValue(undefined);
    mocks.removeUserStorefrontImage.mockReset();
    mocks.removeUserStorefrontImage.mockResolvedValue(undefined);
    mocks.uploadUserStorefrontImage.mockReset();
    mocks.router.refresh.mockReset();
  });

  it("uses native file controls instead of asking teachers for image URLs", async () => {
    render(<StorefrontSettingsPanel />);

    expect(await screen.findByLabelText("Upload storefront logo")).toHaveAttribute(
      "type",
      "file",
    );
    expect(screen.getByLabelText("Upload storefront hero image")).toHaveAttribute(
      "type",
      "file",
    );
    expect(screen.queryByLabelText(/Logo URL/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Hero image URL/i)).not.toBeInTheDocument();
  });

  it("uploads selected media and saves only the generated public URLs", async () => {
    mocks.uploadUserStorefrontImage
      .mockResolvedValueOnce("https://media.example/storefront-logo.png?v=1")
      .mockResolvedValueOnce("https://media.example/storefront-hero.png?v=1");

    render(<StorefrontSettingsPanel />);

    const logoInput = await screen.findByLabelText("Upload storefront logo");
    const heroInput = screen.getByLabelText("Upload storefront hero image");
    const logo = new File(["logo"], "logo.png", { type: "image/png" });
    const hero = new File(["hero"], "hero.webp", { type: "image/webp" });

    fireEvent.change(logoInput, { target: { files: [logo] } });
    fireEvent.change(heroInput, { target: { files: [hero] } });

    await waitFor(() => {
      expect(mocks.uploadUserStorefrontImage).toHaveBeenNthCalledWith(
        1,
        "teacher-1",
        "logo",
        logo,
        expect.any(Function),
      );
      expect(mocks.uploadUserStorefrontImage).toHaveBeenNthCalledWith(
        2,
        "teacher-1",
        "hero",
        hero,
        expect.any(Function),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Save storefront" }));

    await waitFor(() => {
      expect(mocks.updateUserStorefront).toHaveBeenCalledWith(
        "teacher-1",
        expect.objectContaining({
          branding: expect.objectContaining({
            logoUrl: "https://media.example/storefront-logo.png?v=1",
            heroImageUrl: "https://media.example/storefront-hero.png?v=1",
          }),
        }),
      );
    });
  });

  it("keeps Save disabled until every concurrent image upload finishes", async () => {
    let resolveLogo: (value: string) => void = () => undefined;
    let resolveHero: (value: string) => void = () => undefined;
    const logoUpload = new Promise<string>((resolve) => {
      resolveLogo = resolve;
    });
    const heroUpload = new Promise<string>((resolve) => {
      resolveHero = resolve;
    });

    mocks.uploadUserStorefrontImage.mockImplementation(
      (_uid: string, kind: "logo" | "hero") =>
        kind === "logo" ? logoUpload : heroUpload,
    );

    render(<StorefrontSettingsPanel />);

    const logoInput = await screen.findByLabelText("Upload storefront logo");
    const heroInput = screen.getByLabelText("Upload storefront hero image");
    const saveButton = screen.getByRole("button", { name: "Save storefront" });

    fireEvent.change(logoInput, {
      target: { files: [new File(["logo"], "logo.png", { type: "image/png" })] },
    });
    fireEvent.change(heroInput, {
      target: { files: [new File(["hero"], "hero.webp", { type: "image/webp" })] },
    });

    expect(saveButton).toBeDisabled();

    await act(async () => {
      resolveLogo("https://media.example/storefront-logo.png?v=1");
      await logoUpload;
    });
    expect(saveButton).toBeDisabled();

    await act(async () => {
      resolveHero("https://media.example/storefront-hero.png?v=1");
      await heroUpload;
    });
    await waitFor(() => expect(saveButton).toBeEnabled());
  });

  it("removes an uploaded object only after its saved URL is cleared", async () => {
    mocks.getUserProfile.mockResolvedValueOnce({
      displayName: "Dr. Ana Silva",
      storefront: {
        branding: {
          logoUrl: "https://media.example/storefront-logo.png?v=1",
          themePreset: "default",
        },
        showcase: { orderedCourseIds: [] },
      },
    });

    render(<StorefrontSettingsPanel />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Remove storefront logo",
    }));
    expect(mocks.removeUserStorefrontImage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save storefront" }));

    await waitFor(() => {
      expect(mocks.updateUserStorefront).toHaveBeenCalledWith(
        "teacher-1",
        expect.objectContaining({
          branding: expect.objectContaining({ logoUrl: null }),
        }),
      );
      expect(mocks.removeUserStorefrontImage).toHaveBeenCalledWith(
        "teacher-1",
        "logo",
      );
    });
    expect(
      mocks.updateUserStorefront.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.removeUserStorefrontImage.mock.invocationCallOrder[0]);
  });

  it("keeps the saved configuration and reports a retryable cleanup failure", async () => {
    mocks.getUserProfile.mockResolvedValueOnce({
      displayName: "Dr. Ana Silva",
      storefront: {
        branding: {
          heroImageUrl: "https://media.example/storefront-hero.png?v=1",
          themePreset: "default",
        },
        showcase: { orderedCourseIds: [] },
      },
    });
    mocks.removeUserStorefrontImage.mockRejectedValueOnce(
      new Error("remove failed"),
    );

    render(<StorefrontSettingsPanel />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Remove storefront hero image",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Save storefront" }));

    expect(await screen.findByText("Storefront saved.")).toBeInTheDocument();
    expect(
      screen.getByText(/old image could not be removed/i),
    ).toBeInTheDocument();
  });

  // A rejeição era escrita no rodapé do formulário, ~120 linhas abaixo do
  // botão — fora da tela no celular — e sem role="alert", então nem o leitor
  // de tela avisava. O botão voltava a "Upload" como se nada tivesse acontecido.
  it("anuncia a rejeição do arquivo ao lado do botão que a disparou", async () => {
    render(<StorefrontSettingsPanel />);

    const logoInput = await screen.findByLabelText("Upload storefront logo");
    fireEvent.change(logoInput, {
      target: { files: [new File(["bmp"], "logo.bmp", { type: "image/bmp" })] },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Use a JPG, PNG, or WebP under 5 MB image.");
    // Fica no campo do logo: vem ANTES do campo da capa, não no fim do form.
    const heroInput = screen.getByLabelText("Upload storefront hero image");
    expect(
      alert.compareDocumentPosition(heroInput) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(mocks.uploadUserStorefrontImage).not.toHaveBeenCalled();
  });

  it("mostra a falha do envio no campo da capa, antes do select de tema", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.uploadUserStorefrontImage.mockRejectedValueOnce(
      new Error("Storage is offline"),
    );

    render(<StorefrontSettingsPanel />);

    const heroInput = await screen.findByLabelText("Upload storefront hero image");
    fireEvent.change(heroInput, {
      target: { files: [new File(["hero"], "hero.webp", { type: "image/webp" })] },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We could not upload this image. Please try again.");
    expect(alert).not.toHaveTextContent("Storage is offline");
    const themeSelect = screen.getByRole("combobox", { name: "Theme preset" });
    expect(
      alert.compareDocumentPosition(themeSelect) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // O painel mostrava "Uploading 0%" o envio inteiro: o Storage não informa
  // progresso, e 0% parado se lia como "travou". Mesmo contrato do #138 —
  // sem número do transporte, não há número na tela.
  it("não inventa porcentagem enquanto o logo sobe", async () => {
    mocks.uploadUserStorefrontImage.mockImplementation(
      (
        _uid: string,
        _kind: string,
        file: File,
        onProgress: (progress: {
          bytesTransferred: number;
          totalBytes: number;
          percent: number | null;
          state: "running";
        }) => void,
      ) => {
        onProgress({ bytesTransferred: 0, totalBytes: file.size, percent: null, state: "running" });
        return new Promise<string>(() => undefined);
      },
    );

    render(<StorefrontSettingsPanel />);

    const logoInput = await screen.findByLabelText("Upload storefront logo");
    fireEvent.change(logoInput, {
      target: { files: [new File(["logo"], "logo.png", { type: "image/png" })] },
    });

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Sending...");
    expect(status).not.toHaveTextContent("%");
  });

  describe("idioma real da vitrine", () => {
    it.each(["en", "es"] as const)("traduz o formulário desde %s e preserva rascunho, ordem, destaque e dados autorais", async (initialLocale) => {
      const author = "Autoria $$ e $&";
      const firstTitle = "Curso $$ e $& de autoria";
      const secondTitle = "Outro curso autoral";
      const draft = "Rascunho $$ e $& que permanece";
      mocks.getUserProfile.mockResolvedValueOnce({
        displayName: author,
        storefront: {
          branding: { themePreset: "default" },
          showcase: { tagline: "Texto salvo", orderedCourseIds: ["second", "first", "old"] },
        },
      });
      mocks.subscribeToTeacherCourses.mockImplementation((_uid, onData) => {
        onData([
          { id: "first", ownerId: "teacher-1", title: firstTitle, status: "published", modules: [] },
          { id: "second", ownerId: "teacher-1", title: secondTitle, status: "published", modules: [] },
          { id: "draft", ownerId: "teacher-1", title: "Curso ainda privado", status: "draft", modules: [] },
        ]);
        return vi.fn();
      });
      renderWithLocale(initialLocale);
      const initial = initialLocale === "en"
        ? { heading: "Storefront branding", accent: "Accent color", tagline: "Tagline", theme: "Theme preset", feature: "Feature", move: `Move ${firstTitle} up` }
        : { heading: "Marca de la tienda", accent: "Color de acento", tagline: "Frase de presentación", theme: "Estilo de la tienda", feature: "Destacar", move: `Mover ${firstTitle} hacia arriba` };
      await screen.findByRole("heading", { name: initial.heading });
      fireEvent.change(screen.getByLabelText(initial.accent), { target: { value: "#2468ab" } });
      fireEvent.change(screen.getByLabelText(initial.tagline), { target: { value: draft } });
      fireEvent.change(screen.getByRole("combobox", { name: initial.theme }), { target: { value: "warm" } });
      const firstRow = screen.getByText(firstTitle).closest("li")!;
      fireEvent.click(within(firstRow).getByRole("button", { name: initial.feature }));
      fireEvent.click(screen.getByRole("button", { name: initial.move }));
      const profileCalls = mocks.getUserProfile.mock.calls.length;
      const courseCalls = mocks.subscribeToTeacherCourses.mock.calls.length;
      if (initialLocale === "en") fireEvent.click(screen.getByRole("button", { name: "Use ES" }));

      expect(screen.getByRole("heading", { name: "Marca de la tienda" })).toBeInTheDocument();
      expect(screen.getByLabelText("Color de acento")).toHaveValue("#2468ab");
      expect(screen.getByLabelText("Frase de presentación")).toHaveValue(draft);
      expect(screen.getByRole("combobox", { name: "Estilo de la tienda" })).toHaveValue("warm");
      for (const label of ["Predeterminado de la plataforma", "Cálido", "Frío", "Monocromático"]) {
        expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
      }
      expect(screen.getByText("Orden de los cursos")).toBeInTheDocument();
      expect(screen.getByText("Solo cursos publicados")).toBeInTheDocument();
      expect(screen.queryByText("Curso aún privado")).not.toBeInTheDocument();
      expect(screen.queryByText("Curso ainda privado")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Subir logotipo de la tienda")).toHaveAttribute("type", "file");
      expect(screen.getByLabelText("Subir imagen de portada de la tienda")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
      expect(screen.getByRole("button", { name: `Mover ${firstTitle} hacia arriba` })).toBeDisabled();
      expect(within(firstRow).getByRole("button", { name: "Destacado" })).toHaveAttribute("aria-pressed", "true");
      const preview = screen.getByRole("region", { name: "Vista previa de la tienda" });
      expect(within(preview).getByText(author)).toBeInTheDocument();
      expect(within(preview).getByText(draft)).toBeInTheDocument();
      expect(within(preview).getByText(`2 cursos publicados: ${firstTitle}, ${secondTitle}`)).toBeInTheDocument();
      const publicLink = screen.getByRole("link", { name: /Abrir página pública/ });
      expect(publicLink).toHaveAttribute("href", "/instructors/teacher-1");
      expect(publicLink).toHaveAttribute("rel", "noopener noreferrer");
      expect(mocks.getUserProfile).toHaveBeenCalledTimes(profileCalls);
      expect(mocks.subscribeToTeacherCourses).toHaveBeenCalledTimes(courseCalls);
      expect(mocks.updateUserStorefront).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Guardar tienda" }));
      await waitFor(() => expect(mocks.updateUserStorefront).toHaveBeenCalledWith("teacher-1", {
        branding: { accentColor: "#2468ab", logoUrl: null, heroImageUrl: null, themePreset: "warm" },
        showcase: { tagline: draft, orderedCourseIds: ["first", "second"], featuredCourseId: "first" },
      }));
    });

    it("mantém os uploads concorrentes e traduz a conclusão após EN↔ES", async () => {
      let finishLogo: (url: string) => void = () => undefined;
      let finishHero: (url: string) => void = () => undefined;
      const logoUpload = new Promise<string>((resolve) => { finishLogo = resolve; });
      const heroUpload = new Promise<string>((resolve) => { finishHero = resolve; });
      mocks.uploadUserStorefrontImage.mockImplementation((_uid, kind, file, onProgress) => {
        onProgress({ bytesTransferred: 0, totalBytes: file.size, percent: null, state: "running" });
        return kind === "logo" ? logoUpload : heroUpload;
      });
      renderWithLocale();
      fireEvent.change(await screen.findByLabelText("Upload storefront logo"), {
        target: { files: [new File(["logo"], "logo.png", { type: "image/png" })] },
      });
      fireEvent.change(screen.getByLabelText("Upload storefront hero image"), {
        target: { files: [new File(["hero"], "hero.webp", { type: "image/webp" })] },
      });
      fireEvent.click(screen.getByRole("button", { name: "Use ES" }));
      expect(screen.getByRole("button", { name: "Guardar tienda" })).toBeDisabled();
      for (const status of screen.getAllByRole("status")) {
        expect(status).toHaveTextContent("Enviando...");
        expect(status).not.toHaveTextContent("%");
      }
      await act(async () => { finishLogo("https://media.example/logo.png?v=1"); await logoUpload; });
      expect(screen.getByText("Logotipo subido. Guarda la tienda para publicarlo.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Guardar tienda" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Use EN" }));
      expect(screen.getByText("Logo uploaded. Save the storefront to publish it.")).toBeInTheDocument();
      await act(async () => { finishHero("https://media.example/hero.webp?v=1"); await heroUpload; });
      fireEvent.click(screen.getByRole("button", { name: "Use ES" }));
      expect(screen.getByText("Imagen de portada subida. Guarda la tienda para publicarla.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Guardar tienda" })).toBeEnabled();
      expect(mocks.uploadUserStorefrontImage).toHaveBeenCalledTimes(2);
      expect(mocks.getUserProfile).toHaveBeenCalledOnce();
      expect(mocks.subscribeToTeacherCourses).toHaveBeenCalledOnce();
      expect(mocks.updateUserStorefront).not.toHaveBeenCalled();
    });

    it("retraduz erros visíveis e preserva os limites de arquivo, cor e tagline", async () => {
      renderWithLocale();
      fireEvent.change(await screen.findByLabelText("Upload storefront logo"), {
        target: { files: [new File([], "empty.png", { type: "image/png" })] },
      });
      expect(await screen.findByRole("alert")).toHaveTextContent("Use a JPG, PNG, or WebP under 5 MB image.");
      fireEvent.click(screen.getByRole("button", { name: "Use ES" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Usa una imagen JPG, PNG o WebP de hasta 5 MB.");
      expect(mocks.uploadUserStorefrontImage).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText("Color de acento"), { target: { value: "#abc" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar tienda" }));
      expect(screen.getByText("El color de acento debe ser un código hexadecimal de 6 dígitos, como #183a5e.")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Color de acento"), { target: { value: "#123456" } });
      fireEvent.change(screen.getByLabelText("Frase de presentación"), { target: { value: "x".repeat(201) } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar tienda" }));
      expect(screen.getByText("La frase de presentación debe tener 200 caracteres o menos.")).toBeInTheDocument();
      expect(mocks.updateUserStorefront).not.toHaveBeenCalled();
      expect(mocks.getUserProfile).toHaveBeenCalledOnce();
    });

    it("traduz uma falha de carga existente sem recarregar o perfil ao trocar idioma", async () => {
      mocks.getUserProfile.mockRejectedValueOnce(new Error("LOCAL TEST: unavailable"));
      renderWithLocale();
      expect(await screen.findByRole("alert")).toHaveTextContent("We could not load your storefront settings.");
      fireEvent.click(screen.getByRole("button", { name: "Use ES" }));
      expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar la configuración de tu tienda.");
      expect(mocks.getUserProfile).toHaveBeenCalledOnce();
      expect(mocks.subscribeToTeacherCourses).toHaveBeenCalledOnce();
    });

    it("traduz remoção e limpeza posterior sem apagar o objeto antes da persistência", async () => {
      mocks.getUserProfile.mockResolvedValueOnce({
        displayName: "Autor $$ e $&",
        storefront: { branding: { themePreset: "default", logoUrl: "https://media.example/logo.png" }, showcase: {} },
      });
      let finishSave: () => void = () => undefined;
      const saving = new Promise<void>((resolve) => { finishSave = resolve; });
      mocks.updateUserStorefront.mockReturnValueOnce(saving);
      mocks.removeUserStorefrontImage.mockRejectedValueOnce(new Error("LOCAL TEST: cleanup failed"));
      renderWithLocale();
      fireEvent.click(await screen.findByRole("button", { name: "Remove storefront logo" }));
      fireEvent.click(screen.getByRole("button", { name: "Use ES" }));
      expect(screen.getByText("Guarda la tienda para publicar esta eliminación.")).toBeInTheDocument();
      expect(mocks.removeUserStorefrontImage).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Guardar tienda" }));
      expect(screen.getByRole("button", { name: "Guardando..." })).toBeDisabled();
      expect(mocks.removeUserStorefrontImage).not.toHaveBeenCalled();
      await act(async () => { finishSave(); await saving; });
      expect(await screen.findByText("Tienda guardada.")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("La tienda se guardó, pero no se pudo eliminar una imagen anterior. Guarda de nuevo para reintentar la limpieza.");
      expect(mocks.updateUserStorefront.mock.invocationCallOrder[0]).toBeLessThan(mocks.removeUserStorefrontImage.mock.invocationCallOrder[0]);
      fireEvent.click(screen.getByRole("button", { name: "Use EN" }));
      expect(screen.getByRole("alert")).toHaveTextContent("The storefront was saved, but an old image could not be removed.");
      fireEvent.click(screen.getByRole("button", { name: "Save storefront" }));
      await waitFor(() => expect(mocks.removeUserStorefrontImage).toHaveBeenCalledTimes(2));
      expect(mocks.removeUserStorefrontImage).toHaveBeenLastCalledWith("teacher-1", "logo");
      expect(mocks.getUserProfile).toHaveBeenCalledOnce();
    });

    it("traduz falha ao salvar e usa fallback de upload sem vazar texto técnico", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      mocks.uploadUserStorefrontImage.mockRejectedValueOnce(new Error("LOCAL TEST: storage backend detail"));
      mocks.updateUserStorefront.mockRejectedValueOnce(new Error("LOCAL TEST: save failed"));
      renderWithLocale("es");
      fireEvent.change(await screen.findByLabelText("Subir imagen de portada de la tienda"), {
        target: { files: [new File(["hero"], "hero.png", { type: "image/png" })] },
      });
      expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos subir esta imagen. Inténtalo de nuevo.");
      expect(screen.queryByText(/storage backend detail/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Guardar tienda" }));
      expect(await screen.findByText("No pudimos guardar tu tienda. Inténtalo de nuevo y contacta con soporte si el problema continúa.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Use EN" }));
      expect(screen.getByText("We could not save your storefront. Try again, and contact support if it keeps failing.")).toBeInTheDocument();
      expect(mocks.getUserProfile).toHaveBeenCalledOnce();
      expect(mocks.updateUserStorefront).toHaveBeenCalledOnce();
    });
  });

  // O que a pessoa sofria: nao havia caminho daqui para a vitrine publica, a
  // pagina nunca dizia se ela estava no ar, e a frase sobre "um passo
  // posterior" ficava mesmo com curso ja publicado — ou seja, mentia.
  describe("estado da vitrine publica", () => {
    function givenPublishedCourses(titles: string[]) {
      mocks.subscribeToTeacherCourses.mockImplementation(
        (_uid: string, onData: (courses: unknown[]) => void) => {
          onData(
            titles.map((title, index) => ({
              id: `course-${index}`,
              ownerId: "teacher-1",
              title,
              status: "published",
              modules: [],
              lessonCount: 0,
            })),
          );
          return vi.fn();
        },
      );
    }

    it("leva para a pagina publica e diz que ela esta publicada", async () => {
      givenPublishedCourses(["Facilitacao para grupos"]);

      render(<StorefrontSettingsPanel />);

      expect(
        await screen.findByRole("link", { name: /Open public page/ }),
      ).toHaveAttribute("href", "/instructors/teacher-1");
      expect(screen.getByText("Published")).toBeInTheDocument();
      expect(screen.queryByText(/goes live in a later step/)).not.toBeInTheDocument();
    });

    it("sem curso publicado, avisa que ainda nao esta no ar e mantem a frase do passo posterior", async () => {
      render(<StorefrontSettingsPanel />);

      expect(await screen.findByText("Not published yet")).toBeInTheDocument();
      expect(screen.getByText(/goes live in a later step/)).toBeInTheDocument();
      expect(screen.getByText("No published course yet")).toBeInTheDocument();
    });

    it("a previa mostra nome, resumo, cor e os cursos que a vitrine exibe", async () => {
      mocks.getUserProfile.mockResolvedValue({
        displayName: "Dr. Ana Silva",
        storefront: {
          branding: { themePreset: "default", accentColor: "#8a5d08" },
          showcase: { orderedCourseIds: [], tagline: "Grupos que decidem" },
        },
      });
      givenPublishedCourses(["Facilitacao para grupos", "Reunioes curtas"]);

      render(<StorefrontSettingsPanel />);

      const preview = within(
        await screen.findByRole("region", { name: "Live storefront preview" }),
      );
      expect(preview.getByText("Dr. Ana Silva")).toBeInTheDocument();
      expect(preview.getByText("Grupos que decidem")).toBeInTheDocument();
      expect(
        preview.getByText(
          "2 published courses: Facilitacao para grupos, Reunioes curtas",
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Accent color picker")).toHaveValue("#8a5d08");
    });
  });
});
