import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { LandingImageField } from "./landing-image-field";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const mocks = vi.hoisted(() => ({ uploadLandingImage: vi.fn() }));

vi.mock("@/lib/data/landing-images", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/landing-images")>()),
  uploadLandingImage: (courseId: string, file: File) => mocks.uploadLandingImage(courseId, file),
}));

const publicUrl = "https://example.supabase.co/storage/v1/object/public/public-media/courses/c1/landing/a1.png";

function setup(value: string | null = null, locale: "en" | "es" = "en") {
  const onChange = vi.fn();
  render(
    <I18nProvider initialLocale={locale}>
      <LandingImageField courseId="c1" label="Photo" value={value} onChange={onChange} />
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
    mocks.uploadLandingImage.mockReset();
  });

  it("offers an upload button, named by its field and described by the rules", () => {
    setup();
    const button = screen.getByRole("button", { name: "Upload image" });
    expect(button).toHaveAccessibleDescription("JPG, PNG or WebP, up to 5.0 MB.");
    expect(screen.getByRole("group", { name: "Photo" })).toContainElement(button);
    expect(screen.getByLabelText("Or paste a link")).toBeInTheDocument();
  });

  it("speaks Spanish", () => {
    setup(null, "es");
    expect(screen.getByRole("button", { name: "Subir imagen" })).toBeInTheDocument();
    expect(screen.getByLabelText("O pega un enlace")).toBeInTheDocument();
  });

  it("uploads the sales page image and hands back the public URL", async () => {
    let finish: (url: string) => void = () => undefined;
    mocks.uploadLandingImage.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));
    const onChange = setup();
    const file = new File(["x"], "foto.png", { type: "image/png" });
    pick(file);
    expect(await screen.findByText("Uploading…")).toBeInTheDocument();
    finish(publicUrl);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(publicUrl));
    expect(mocks.uploadLandingImage).toHaveBeenCalledWith("c1", file);
  });

  it("previews the current image and lets the creator remove it", () => {
    const onChange = setup(publicUrl);
    expect(screen.getByRole("img", { name: "Preview of Photo" })).toHaveAttribute("src", publicUrl);
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows a clear error when the upload fails", async () => {
    mocks.uploadLandingImage.mockRejectedValue(new Error("boom"));
    const onChange = setup();
    pick(new File(["x"], "foto.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not upload this file.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ["doc.gif", "image/gif"],
    ["logo.svg", "image/svg+xml"],
  ])("refuses %s before uploading", async (name, type) => {
    setup(null, "es");
    pick(new File(["x"], name, { type }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ese archivo no es una imagen JPG, PNG o WebP.");
    expect(mocks.uploadLandingImage).not.toHaveBeenCalled();
  });

  it("refuses an image over the limit before uploading", async () => {
    setup();
    const big = new File(["x"], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 });
    pick(big);
    expect(await screen.findByRole("alert")).toHaveTextContent("That image is 6.0 MB. Use one up to 5.0 MB.");
    expect(mocks.uploadLandingImage).not.toHaveBeenCalled();
  });

  it("still lets the creator paste a link", () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText("Or paste a link"), { target: { value: "/uploads/x.jpg" } });
    expect(onChange).toHaveBeenCalledWith("/uploads/x.jpg");
  });
});
