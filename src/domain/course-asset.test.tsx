import { describe, expect, it } from "vitest";

import {
  canViewCourseAssetVideo,
  courseAssetAcceptTypes,
  courseAssetKindLabels,
  formatCourseAssetSize,
  getCourseAssetUploadErrorMessage,
  isAllowedCourseAssetFile,
  supabaseUploadLimitBytes,
} from "./course-asset";

function file(name: string, type: string, size = 1024) {
  return new File(["x".repeat(size)], name, { type });
}

describe("course asset validation", () => {
  it("allows common lesson material formats creators need for classes", () => {
    expect(
      isAllowedCourseAssetFile(
        file(
          "workbook.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        "lesson_material",
      ),
    ).toBe(true);
    expect(
      isAllowedCourseAssetFile(
        file(
          "slides.pptx",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
        "lesson_material",
      ),
    ).toBe(true);
    expect(
      isAllowedCourseAssetFile(file("resources.zip", "application/zip"), "lesson_material"),
    ).toBe(true);
    expect(
      isAllowedCourseAssetFile(file("audio-notes.mp3", "audio/mpeg"), "lesson_material"),
    ).toBe(true);
  });

  it("falls back to safe file extensions when browsers omit Office MIME types", () => {
    expect(isAllowedCourseAssetFile(file("worksheet.xlsx", ""), "lesson_material")).toBe(
      true,
    );
    expect(isAllowedCourseAssetFile(file("installer.exe", ""), "lesson_material")).toBe(
      false,
    );
  });

  it("registers the members-area cover kind as a labeled image asset", () => {
    expect(courseAssetKindLabels.members_cover).toBe("Members area cover");
    expect(courseAssetAcceptTypes.members_cover).toBe("image/*");
    expect(isAllowedCourseAssetFile(file("hero.jpg", "image/jpeg"), "members_cover")).toBe(
      true,
    );
    expect(isAllowedCourseAssetFile(file("hero.mp4", "video/mp4"), "members_cover")).toBe(
      false,
    );
  });
});

describe("upload error mapping", () => {
  it("defaults the effective Supabase limit to 50MB when the env override is unset", () => {
    expect(supabaseUploadLimitBytes).toBe(50 * 1024 * 1024);
  });

  it("maps the storage 413 to the actionable size-limit message", () => {
    expect(
      getCourseAssetUploadErrorMessage({ status: 413 }, 50 * 1024 * 1024),
    ).toBe(
      "This file exceeds the current upload limit (~50.0 MB). Use a YouTube link or a smaller file.",
    );
    expect(
      getCourseAssetUploadErrorMessage({ statusCode: "413" }),
    ).toContain("exceeds the current upload limit");
    expect(
      getCourseAssetUploadErrorMessage(
        new Error("The object exceeded the maximum allowed size"),
      ),
    ).toContain("exceeds the current upload limit");
  });

  it("maps permission failures to a permission message", () => {
    expect(getCourseAssetUploadErrorMessage({ status: 403 })).toBe(
      "You do not have permission to upload files to this course.",
    );
    expect(
      getCourseAssetUploadErrorMessage(
        new Error("new row violates row-level security policy"),
      ),
    ).toContain("permission");
  });

  it("passes other error messages through and keeps a generic fallback", () => {
    expect(getCourseAssetUploadErrorMessage(new Error("Network request failed"))).toBe(
      "Network request failed",
    );
    expect(getCourseAssetUploadErrorMessage(undefined)).toBe(
      "We could not upload this file. Check the file type and course permissions.",
    );
  });
});

describe("lesson video access authorization", () => {
  const base = {
    isPreview: false,
    assetOwnerId: "teacher-1",
    callerId: "learner-9",
    enrollmentStatus: null as string | null,
    isAdmin: false,
  };

  it("denies a signed-in stranger with no enrollment (the RLS-bypass attack)", () => {
    expect(canViewCourseAssetVideo(base)).toBe(false);
  });

  it("allows free preview lessons for anyone signed in", () => {
    expect(canViewCourseAssetVideo({ ...base, isPreview: true })).toBe(true);
  });

  it("allows the teacher who owns the asset", () => {
    expect(canViewCourseAssetVideo({ ...base, callerId: "teacher-1" })).toBe(true);
  });

  it("allows active and completed enrollments only", () => {
    expect(canViewCourseAssetVideo({ ...base, enrollmentStatus: "active" })).toBe(true);
    expect(canViewCourseAssetVideo({ ...base, enrollmentStatus: "completed" })).toBe(true);
    expect(canViewCourseAssetVideo({ ...base, enrollmentStatus: "refunded" })).toBe(false);
    expect(canViewCourseAssetVideo({ ...base, enrollmentStatus: "revoked" })).toBe(false);
  });

  it("allows platform admins", () => {
    expect(canViewCourseAssetVideo({ ...base, isAdmin: true })).toBe(true);
  });
});

describe("formatCourseAssetSize", () => {
  // O teto de vídeo do Bunny é 5 GiB e era anunciado como "5120.0 MB".
  it("usa GB acima de 1 GiB em vez de milhares de MB", () => {
    expect(formatCourseAssetSize(5 * 1024 * 1024 * 1024)).toBe("5 GB");
    expect(formatCourseAssetSize(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });

  it("mantém as faixas menores intactas", () => {
    expect(formatCourseAssetSize(512)).toBe("512 B");
    expect(formatCourseAssetSize(2 * 1024)).toBe("2.0 KB");
    expect(formatCourseAssetSize(50 * 1024 * 1024)).toBe("50.0 MB");
  });
});

describe("getCourseAssetUploadErrorMessage — falhas de vídeo", () => {
  // O criador lia "bunny-create-failed:429" na caixa vermelha do estúdio.
  it("traduz o rate limit do provedor sem citar código", () => {
    const msg = getCourseAssetUploadErrorMessage(new Error("bunny-create-failed:429"));
    expect(msg).toMatch(/too many uploads/i);
    expect(msg).not.toMatch(/429|bunny/i);
  });

  it("traduz sessão expirada e falta de permissão", () => {
    expect(getCourseAssetUploadErrorMessage(new Error("bunny-create-failed:401")))
      .toMatch(/session expired/i);
    expect(getCourseAssetUploadErrorMessage(new Error("bunny-create-failed:403")))
      .toMatch(/permission/i);
  });

  it("trata status desconhecido do provedor como falha temporária", () => {
    const msg = getCourseAssetUploadErrorMessage(new Error("bunny-create-failed:500"));
    expect(msg).toMatch(/try again/i);
    expect(msg).not.toMatch(/500|bunny/i);
  });

  // tus lança DetailedError, cuja mensagem é um parágrafo de método, URL e offset.
  it("reconhece queda de conexão do upload retomável pela forma do erro", () => {
    const tusError = Object.assign(
      new Error("tus: failed to upload chunk at offset 0, originated from request (method: PATCH, url: https://x)"),
      { originalRequest: {}, originalResponse: {} },
    );
    const msg = getCourseAssetUploadErrorMessage(tusError);
    expect(msg).toMatch(/interrupted|connection/i);
    expect(msg).not.toMatch(/PATCH|offset|tus:/);
  });

  it("nunca devolve string interna crua como mensagem ao criador", () => {
    expect(getCourseAssetUploadErrorMessage(new Error("some-service:503")))
      .not.toMatch(/some-service:503/);
    expect(getCourseAssetUploadErrorMessage(new Error("fetch failed")))
      .not.toBe("fetch failed");
  });
});
