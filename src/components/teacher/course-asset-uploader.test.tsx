import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { UploadCourseAssetProgress } from "@/lib/data/course-assets";

type UploadInput = {
  onProgress?: (progress: UploadCourseAssetProgress) => void;
};

const mocks = vi.hoisted(() => ({
  assets: [] as CourseAsset[],
  uploadCourseAsset: vi.fn<(input: UploadInput) => Promise<string>>(),
}));

vi.mock("@/lib/data/course-assets", () => ({
  deleteCourseAsset: vi.fn(),
  uploadCourseAsset: (input: UploadInput) => mocks.uploadCourseAsset(input),
  subscribeToCourseAssets: (
    _courseId: string,
    onAssets: (assets: CourseAsset[]) => void,
  ) => {
    onAssets(mocks.assets);
    return () => {};
  },
}));

const { CourseAssetUploader } = await import(
  "@/components/teacher/course-asset-uploader"
);

const course: TeacherCourse = {
  id: "course-1",
  ownerId: "owner-1",
  title: "Curso",
  summary: "",
  category: "geral",
  status: "draft",
  lessonCount: 0,
  modules: [],
};

function running(percent: number | null): UploadCourseAssetProgress {
  return { bytesTransferred: 0, totalBytes: 3, percent, state: "running" };
}

function chooseCover() {
  const file = new File(["png"], "capa.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Choose a course cover file"), {
    target: { files: [file] },
  });
  return file;
}

describe("CourseAssetUploader", () => {
  beforeEach(() => {
    mocks.assets = [];
    mocks.uploadCourseAsset.mockReset();
    // jsdom não implementa object URLs; o componente usa para a prévia local.
    URL.createObjectURL = vi.fn(() => "blob:preview-1");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  // O único limite escrito na tela era o do bucket (500 MB), dez vezes o teto
  // real do plano. O professor preparava o arquivo dentro dele e era recusado.
  it("mostra o teto real antes de o professor escolher o arquivo", () => {
    render(<CourseAssetUploader course={course} isEditable />);

    expect(screen.getByText(/Image up to 50\.0 MB\./)).toBeInTheDocument();
    expect(screen.queryByText(/500\.0 MB/)).not.toBeInTheDocument();
  });

  it("mostra a prévia da imagem escolhida antes de enviar", () => {
    render(<CourseAssetUploader course={course} isEditable />);

    chooseCover();

    expect(screen.getByRole("img", { name: "Preview of capa.png" })).toHaveAttribute(
      "src",
      "blob:preview-1",
    );
  });

  it("mostra a miniatura das capas já enviadas", () => {
    mocks.assets = [
      {
        id: "asset-1",
        courseId: "course-1",
        ownerId: "owner-1",
        kind: "course_cover",
        fileName: "capa.png",
        contentType: "image/png",
        size: 2048,
        storagePath: "courses/course-1/assets/owner-1/asset-1/capa.png",
        downloadUrl: "https://media.example/public-media/capa.png",
        isPreview: false,
        lessonId: null,
      },
    ];

    render(<CourseAssetUploader course={course} isEditable />);

    expect(
      screen.getByRole("img", { name: "Course cover: capa.png" }),
    ).toHaveAttribute("src", "https://media.example/public-media/capa.png");
  });

  // O catch descartava o erro sem ler e culpava "permissões" — inclusive para
  // o 413 do teto de tamanho, cuja mensagem certa já vinha pronta do domínio.
  it("mostra o motivo real quando o envio falha, não a acusação de permissão", async () => {
    mocks.uploadCourseAsset.mockRejectedValueOnce(
      new Error(
        "This file exceeds the current upload limit (~50.0 MB). Use a YouTube link or a smaller file.",
      ),
    );

    render(<CourseAssetUploader course={course} isEditable />);
    chooseCover();
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));

    expect(
      await screen.findByText(/exceeds the current upload limit/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/course ownership/)).not.toBeInTheDocument();
  });

  // A barra ficava em 0% o envio inteiro (o Storage não informa progresso) e
  // isso se lia como "travou". Sem número do transporte, não há número na tela.
  it("não inventa porcentagem quando o transporte não informa progresso", async () => {
    mocks.uploadCourseAsset.mockImplementation((input) => {
      input.onProgress?.(running(null));
      return new Promise(() => undefined);
    });

    render(<CourseAssetUploader course={course} isEditable />);
    chooseCover();
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Sending...");
    expect(status).not.toHaveTextContent("%");
  });

  it("mostra a barra quando o transporte informa porcentagem de verdade", async () => {
    mocks.uploadCourseAsset.mockImplementation((input) => {
      input.onProgress?.(running(42));
      return new Promise(() => undefined);
    });

    render(<CourseAssetUploader course={course} isEditable />);
    chooseCover();
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));

    expect(await screen.findByRole("status")).toHaveTextContent("42%");
  });

  // Falhou depois de começar: o progresso antigo não pode ficar na tela ao
  // lado da caixa vermelha dizendo que não foi possível enviar.
  it("limpa o progresso quando o envio falha", async () => {
    mocks.uploadCourseAsset.mockImplementation(async (input) => {
      input.onProgress?.(running(null));
      throw new Error("Row-level security policy violation");
    });

    render(<CourseAssetUploader course={course} isEditable />);
    chooseCover();
    fireEvent.click(screen.getByRole("button", { name: "Upload asset" }));

    expect(await screen.findByText(/do not have permission/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
