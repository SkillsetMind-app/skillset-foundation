import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getMemberAreaHome,
  memberAreaPath,
  parseMemberAreaHome,
  saveMyMemberArea,
  saveMyMemberAreaProducts,
} from "@/lib/data/member-areas";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ rpc }) }));

beforeEach(() => rpc.mockReset());

const home = {
  area: {
    owner_id: "u-1", username: "eton", creator_name: "Eton Simon", creator_photo_url: null,
    name: "Eton Academy", theme: "dark", cover_path: "users/u-1/member-area/capa.jpg",
    welcome_text: "Bem-vindo", configured: true, is_owner_preview: false,
  },
  continue: {
    course_id: "c-a", course_title: "EI Mastery", lesson_id: "l-2", lesson_title: "Aula 2",
    position_seconds: 42, last_seen_at: "2026-10-15T10:00:00Z",
  },
  my_products: [
    { course_id: "c-a", title: "EI Mastery", cover_image_url: null, product_format: "course",
      lesson_count: 17, progress_percent: 12, enrollment_status: "active" },
    { title: "sem id" },
  ],
  more_products: [
    { course_id: "c-b", title: "Leadership Blind Spots", cover_image_url: "https://x/c.jpg",
      price_amount_minor: 9700, currency: "usd", payment_type: "one_time", sales_key: "leadership-blind-spots" },
    { course_id: "c-c", title: "Sem chave", price_amount_minor: null },
  ],
};

describe("getMemberAreaHome", () => {
  it("pede a área pelo @ e devolve as três seções em camelCase", async () => {
    rpc.mockResolvedValue({ data: home, error: null });
    const result = await getMemberAreaHome("@eton");
    expect(rpc).toHaveBeenCalledWith("get_member_area_home", { p_area_ref: "@eton" });
    expect(result?.area).toMatchObject({ ownerId: "u-1", name: "Eton Academy", theme: "dark", configured: true });
    expect(result?.continueWatching).toEqual({
      courseId: "c-a", courseTitle: "EI Mastery", lessonId: "l-2", lessonTitle: "Aula 2",
      positionSeconds: 42, lastSeenAt: "2026-10-15T10:00:00Z",
    });
    expect(result?.myProducts.map((product) => product.courseId)).toEqual(["c-a"]);
    expect(result?.moreProducts).toEqual([
      { courseId: "c-b", title: "Leadership Blind Spots", coverImageUrl: "https://x/c.jpg",
        priceAmountMinor: 9700, currency: "usd", paymentType: "one_time", salesKey: "leadership-blind-spots" },
      { courseId: "c-c", title: "Sem chave", coverImageUrl: null, priceAmountMinor: null,
        currency: null, paymentType: null, salesKey: "c-c" },
    ]);
  });

  it("null do banco (não é aluno nem dono) vira null", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getMemberAreaHome("@eton")).resolves.toBeNull();
  });

  it("propaga a recusa do banco sem traduzir", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(getMemberAreaHome("@eton")).rejects.toMatchObject({ message: "permission denied" });
  });
});

describe("parseMemberAreaHome", () => {
  it("tema desconhecido vira claro e área sem dono vira null", () => {
    expect(parseMemberAreaHome({ ...home, area: { ...home.area, theme: "neon" } })?.area.theme).toBe("light");
    expect(parseMemberAreaHome({ ...home, area: { name: "x" } })).toBeNull();
    expect(parseMemberAreaHome({ ...home, continue: null })?.continueWatching).toBeNull();
  });
});

describe("memberAreaPath", () => {
  it("usa o @ quando existe e o uid quando não", () => {
    expect(memberAreaPath({ username: "eton", ownerId: "u-1" })).toBe("/learn/areas/@eton");
    expect(memberAreaPath({ username: null, ownerId: "u-1" })).toBe("/learn/areas/u-1");
  });
});

describe("saveMyMemberArea", () => {
  it("manda vazio para o que volta ao padrão", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await saveMyMemberArea({ name: "Eton Academy", theme: "light", coverPath: null, welcomeText: null });
    expect(rpc).toHaveBeenCalledWith("save_my_member_area", {
      p_name: "Eton Academy", p_theme: "light", p_cover_path: "", p_welcome_text: "",
    });
  });

  it("propaga o erro", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "MEMBER_AREA_FORBIDDEN" } });
    await expect(saveMyMemberArea({ name: null, theme: "dark", coverPath: null, welcomeText: null }))
      .rejects.toMatchObject({ message: "MEMBER_AREA_FORBIDDEN" });
  });
});

describe("saveMyMemberAreaProducts", () => {
  it("manda a lista inteira na ordem dada", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await saveMyMemberAreaProducts([{ courseId: "c-b", visible: true }, { courseId: "c-a", visible: false }]);
    expect(rpc).toHaveBeenCalledWith("save_my_member_area_products", {
      p_items: [{ course_id: "c-b", visible: true }, { course_id: "c-a", visible: false }],
    });
  });

  it("propaga a recusa de produto alheio", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "MEMBER_AREA_COURSE_NOT_OWNED" } });
    await expect(saveMyMemberAreaProducts([{ courseId: "x", visible: true }]))
      .rejects.toMatchObject({ message: "MEMBER_AREA_COURSE_NOT_OWNED" });
  });
});
