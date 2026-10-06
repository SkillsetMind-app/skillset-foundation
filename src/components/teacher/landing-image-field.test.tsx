import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { LandingImageField } from "./landing-image-field";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const mocks = vi.hoisted(() => ({
  uploadCourseAsset: vi.fn(),
  fetchCourseAssets: vi.fn(),
}));

vi.mock("@/lib/data/course-assets", () => ({
  uploadCourseAsset: (input: unknown) => mocks.uploadCourseAsset(input),
  fetchCourseAssets: (id: string) => mocks.fetchCourseAssets(id),
}));

const publicUrl = "https://example.supabase.co/storage/v1/object/public/public-media/courses/c1/assets/u1/a1/foto.png";

function setup(value: string | null = null, locale: "en" | "es" = "en") {
  const onChange = vi.fn();
  render(
    <I18nProvider initialLocale={locale}>
      <LandingImageField courseId="c1" ownerId="u1" label="Photo" value={value} onChange={onChange} />
    </I18nProvider>,
  );
  return onChange;
}

function pick(file: File) {
  const input = document.querySelector("input[type=file]") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("LandingImageField", () => {
  beforeEach(() => {
    mocks.uploadCourseAsset.mockReset();
    mocks.fetchCourseAssets.mockReset();
  });

  it("offers an upload button and keeps the link field", () => {
    setup();
    expect(screen.getByRole("button", { name: "Upload image" })).toBeInTheDocument();
    expect(screen.getByLabelText("Or paste a link")).toBeInTheDocument();
    expect(screen.getByText(/JPG, PNG or WebP/)).toBeInTheDocument();
  });

  it("speaks Spanish", () => {
    setup(null, "es");
    expect(screen.getByRole("button", { name: "Subir imagen" })).toBeInTheDocument();
    expect(screen.getByLabelText("O pega un enlace")).toBeInTheDocument();
  });

  it("uploads through the course asset helper and hands back the public URL", async () => {
    let finish: (id: string) => void = () => undefined;
    mocks.uploadCourseAsset.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));
    mocks.fetchCourseAssets.mockResolvedValue([{ id: "a1", downloadUrl: publicUrl }]);
    const onChange = setup();
    const file = new File(["x"], "foto.png", { type: "image/png" });
    pick(file);
    expect(await screen.findByText("Uploading…")).toBeInTheDocument();
    finish("a1");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(publicUrl));
    expect(mocks.uploadCourseAsset).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: "c1", ownerId: "u1", kind: "lesson_thumbnail", file, lessonId: null, moduleId: null, isPreview: false }),
    );
  });

  it("previews the current image", () => {
    setup(publicUrl);
    expect(screen.getByRole("img", { name: "Preview of Photo" })).toHaveAttribute("src", publicUrl);
  });

  it("shows a clear error when the upload fails", async () => {
    mocks.uploadCourseAsset.mockRejectedValue(new Error("boom"));
    const onChange = setup();
    pick(new File(["x"], "foto.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses other formats before uploading", async () => {
    setup();
    pick(new File(["x"], "doc.gif", { type: "image/gif" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/JPG, PNG or WebP/);
    expect(mocks.uploadCourseAsset).not.toHaveBeenCalled();
  });

  it("still lets the creator paste a link", () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText("Or paste a link"), { target: { value: "/uploads/x.jpg" } });
    expect(onChange).toHaveBeenCalledWith("/uploads/x.jpg");
  });
});
