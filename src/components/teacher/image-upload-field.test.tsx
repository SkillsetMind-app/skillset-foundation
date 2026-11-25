import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { UploadCourseAssetProgress } from "@/lib/data/course-assets";

import { ImageUploadField, type ImageUploadFieldProps } from "./image-upload-field";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// The single shell of the image field (B-05). It does not upload anything: the states come in by
// props and the chosen file goes to the onChange of whoever uses it.
const running: UploadCourseAssetProgress = { bytesTransferred: 512, totalBytes: 1024, percent: 50, state: "running" };

function setup(overrides: Partial<ImageUploadFieldProps> = {}) {
  const onChange = vi.fn();
  const onRemove = vi.fn();
  const props: ImageUploadFieldProps = {
    title: "Course cover",
    help: "JPG or PNG, up to 5 MB.",
    preview: { src: null, alt: "Cover of Course" },
    triggerLabel: "Upload cover",
    input: { accept: "image/*", onChange },
    remove: { label: "Remove cover", onClick: onRemove },
    progress: null,
    ...overrides,
  };
  render(
    <I18nProvider initialLocale="en">
      <ImageUploadField {...props} />
    </I18nProvider>,
  );
  return { onChange, onRemove, region: screen.getByRole("region", { name: "Course cover" }) };
}

describe("ImageUploadField", () => {
  afterEach(cleanup);

  it("empty: frame with no image, button with the rules and no Remove", () => {
    const { region } = setup({ preview: { src: null, alt: "Cover", emptyLabel: "No cover yet" }, note: "Add a cover." });
    expect(within(region).queryByRole("img")).toBeNull();
    expect(within(region).getByText("No cover yet")).toBeInTheDocument();
    const input = within(region).getByLabelText("Upload cover");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAccessibleDescription("JPG or PNG, up to 5 MB.");
    expect(within(region).queryByRole("button", { name: "Remove cover" })).toBeNull();
    expect(within(region).getByText("Add a cover.")).toBeInTheDocument();
  });

  it("with an image: preview with the caller's alt and Remove as text", () => {
    const { region, onRemove } = setup({ preview: { src: "/capa.png", alt: "Cover of Course" }, triggerLabel: "Replace cover" });
    expect(within(region).getByRole("img", { name: "Cover of Course" })).toHaveAttribute("src", "/capa.png");
    expect(within(region).getByLabelText("Replace cover")).toBeEnabled();
    fireEvent.click(within(region).getByRole("button", { name: "Remove cover" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("the chosen file goes whole to the caller's onChange", () => {
    const { region, onChange } = setup();
    const file = new File(["x"], "capa.png", { type: "image/png" });
    fireEvent.change(within(region).getByLabelText("Upload cover"), { target: { files: [file] } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0].target.files[0]).toBe(file);
  });

  it("uploading: fixed label, progress note, locked button and Remove out of view", () => {
    const { region } = setup({
      preview: { src: "/capa.png", alt: "Cover" },
      triggerLabel: "Replace cover",
      input: { accept: "image/*", disabled: true },
      progress: running,
      note: "Add a cover.",
    });
    expect(within(region).getByRole("status")).toHaveTextContent("50%");
    expect(within(region).getByLabelText("Replace cover")).toBeDisabled();
    expect(within(region).queryByText("Uploading...")).toBeNull();
    expect(within(region).queryByRole("button", { name: "Remove cover" })).toBeNull();
    expect(within(region).queryByText("Add a cover.")).toBeNull();
  });

  it("error: the house notice, announced, in place of the help", () => {
    const { region } = setup({ error: "We could not upload this image.", note: "Add a cover." });
    expect(within(region).getByRole("alert")).toHaveTextContent("We could not upload this image.");
    expect(within(region).queryByText("Add a cover.")).toBeNull();
  });

  it("2:3 for the module cover; 16:9 for the others", () => {
    const { region } = setup({ preview: { src: null, alt: "Module cover", portrait: true } });
    expect(region.querySelector(".aspect-\\[2\\/3\\]")).not.toBeNull();
    cleanup();
    const second = setup();
    expect(second.region.querySelector(".aspect-video")).not.toBeNull();
  });

  it("own frame and fit only when requested (the storefront logo)", () => {
    const { region } = setup({ preview: { src: "/logo.png", alt: "", frame: "aspect-square w-24", contain: true } });
    expect(region.querySelector(".aspect-square.w-24")).not.toBeNull();
    expect(region.querySelector(".aspect-video")).toBeNull();
    expect(region.querySelector("img")).toHaveClass("object-contain");
    cleanup();
    const plain = setup({ preview: { src: "/capa.png", alt: "Cover" } });
    expect(plain.region.querySelector("img")).toHaveClass("object-cover");
    expect(plain.region.querySelector("img")).not.toHaveClass("object-contain");
  });
});
