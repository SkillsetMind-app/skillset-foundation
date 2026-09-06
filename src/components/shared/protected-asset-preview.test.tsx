import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseAsset } from "@/domain/course-asset";
import { ProtectedAssetPreview } from "./protected-asset-preview";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";

const { sign } = vi.hoisted(() => ({ sign: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/data/course-assets", () => ({ getProtectedCourseAssetObjectUrl: sign }));
vi.mock("@/components/learn/watermarked-video-player", () => ({
  WatermarkedVideoPlayer: ({ src, fileName }: { src: string; fileName: string }) => <video src={src} aria-label={fileName} />,
}));
const asset = (id: string): CourseAsset => ({
  id, courseId: "course", ownerId: "owner", kind: "lesson_video", fileName: id,
  contentType: "video/mp4", size: 1, storagePath: `private/${id}`, isPreview: false, lessonId: "lesson",
});

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

describe("protected asset preview identity", () => {
  beforeEach(() => {
    sign.mockReset();
    vi.stubGlobal("URL", class extends URL { static revokeObjectURL = vi.fn(); });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(["success", "failure"])("translates pending and %s UI without acquiring another protected URL", async (outcome) => {
    let finish!: (url: string) => void;
    let fail!: (error: Error) => void;
    sign.mockImplementationOnce(() => new Promise<string>((resolve, reject) => { finish = resolve; fail = reject; }));
    const selectedAsset = { ...asset("image"), fileName: "Capa $& íntegra.png", kind: "lesson_thumbnail" as const, contentType: "image/png" };
    const view = render(
      <I18nProvider initialLocale="en"><ChangeLanguage /><ProtectedAssetPreview asset={selectedAsset} /></I18nProvider>,
    );
    expect(screen.getByText("Preparing protected asset...")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText("Preparando archivo protegido...")).toBeInTheDocument();
    expect(sign).toHaveBeenCalledOnce();
    await act(async () => {
      if (outcome === "success") finish("blob:protected-image");
      else fail(new Error("provider detail stays private"));
    });
    if (outcome === "success") {
      expect(screen.getByRole("link", { name: "Abrir archivo" })).toHaveAttribute("href", "blob:protected-image");
      expect(screen.getByRole("link", { name: "Descargar" })).toHaveAttribute("download", selectedAsset.fileName);
    } else {
      expect(screen.getByText("El acceso al archivo está protegido. Actualiza tu sesión e inténtalo de nuevo.")).toBeInTheDocument();
      expect(screen.queryByText("provider detail stays private")).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    if (outcome === "success") expect(screen.getByRole("link", { name: "Open file" })).toHaveAttribute("href", "blob:protected-image");
    else expect(screen.getByText("Asset access is protected. Try again after refreshing your session.")).toBeInTheDocument();
    expect(sign).toHaveBeenCalledExactlyOnceWith(selectedAsset);
    view.unmount();
    if (outcome === "success") expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:protected-image");
  });

  it("removes the old video immediately and releases its blob when changing assets", async () => {
    const revoke = vi.mocked(URL.revokeObjectURL);
    sign.mockResolvedValueOnce("blob:old").mockImplementationOnce(() => new Promise(() => {}));
    const { rerender } = render(<ProtectedAssetPreview asset={asset("old")} />);
    expect(await screen.findByLabelText("old")).toHaveAttribute("src", "blob:old");
    rerender(<ProtectedAssetPreview asset={asset("next")} />);
    expect(screen.queryByLabelText("old")).not.toBeInTheDocument();
    expect(screen.getByText("Preparing protected asset...")).toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith("blob:old");
  });

  it("ignores and releases an old signature that resolves after an asset switch", async () => {
    const revoke = vi.mocked(URL.revokeObjectURL);
    let finish!: (url: string) => void;
    sign.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce("https://storage.example/signed-next");
    const { rerender } = render(<ProtectedAssetPreview asset={asset("old")} />);
    rerender(<ProtectedAssetPreview asset={asset("next")} />);
    await screen.findByLabelText("next");
    await act(async () => { finish("blob:late"); });
    expect(screen.getByLabelText("next")).toHaveAttribute("src", "https://storage.example/signed-next");
    expect(revoke).toHaveBeenCalledWith("blob:late");
    expect(revoke).not.toHaveBeenCalledWith("https://storage.example/signed-next");
  });

  it("recovers from a denied asset when a different authorized asset is selected", async () => {
    sign.mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce("https://storage.example/allowed");
    const { rerender } = render(<ProtectedAssetPreview asset={asset("denied")} />);
    await screen.findByText(/Asset access is protected/);
    rerender(<ProtectedAssetPreview asset={asset("allowed")} />);
    expect(await screen.findByLabelText("allowed")).toHaveAttribute("src", "https://storage.example/allowed");
    expect(screen.queryByText(/Asset access is protected/)).not.toBeInTheDocument();
    expect(sign).toHaveBeenLastCalledWith(asset("allowed"));
  });
});
