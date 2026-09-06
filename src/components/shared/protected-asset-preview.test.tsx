import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseAsset } from "@/domain/course-asset";
import { ProtectedAssetPreview } from "./protected-asset-preview";

const { sign } = vi.hoisted(() => ({ sign: vi.fn() }));
vi.mock("@/lib/data/course-assets", () => ({ getProtectedCourseAssetObjectUrl: sign }));
vi.mock("@/components/learn/watermarked-video-player", () => ({
  WatermarkedVideoPlayer: ({ src, fileName }: { src: string; fileName: string }) => <video src={src} aria-label={fileName} />,
}));
const asset = (id: string): CourseAsset => ({
  id, courseId: "course", ownerId: "owner", kind: "lesson_video", fileName: id,
  contentType: "video/mp4", size: 1, storagePath: `private/${id}`, isPreview: false, lessonId: "lesson",
});

describe("protected asset preview identity", () => {
  beforeEach(() => {
    sign.mockReset();
    vi.stubGlobal("URL", class extends URL { static revokeObjectURL = vi.fn(); });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
