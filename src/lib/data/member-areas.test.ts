import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMyMemberArea,
  getMemberAreaHome,
  getMemberAreaSlugs,
  getMyMemberAreas,
  isValidMemberAreaSlug,
  memberAreaPath,
  memberAreaProductsOf,
  orderMemberAreaProducts,
  parseMemberAreaHome,
  saveMyMemberArea,
  saveMyMemberAreaProducts,
  uploadMemberAreaCover,
} from "@/lib/data/member-areas";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const upload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({ rpc, from, storage: { from: () => ({ upload }) } }),
}));

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  upload.mockReset();
});

// select().eq() → maybeSingle() ou a própria promessa, como o supabase-js.
function table(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    maybeSingle: async () => result,
    then: (resolve: (value: unknown) => void) => resolve(result),
  };
  return chain;
}

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

describe("orderMemberAreaProducts", () => {
  it("lista salva primeiro; o resto do mais novo ao mais antigo", () => {
    const courses = [
      { id: "a", createdAt: "2026-01-01T00:00:00Z" },
      { id: "b", createdAt: "2026-05-01T00:00:00Z" },
      { id: "c", createdAt: "2026-09-01T00:00:00Z" },
      { id: "d", createdAt: "2026-03-01T00:00:00Z" },
    ];
    const choices = new Map([["d", { position: 0, visible: false }], ["a", { position: 1, visible: true }]]);
    expect(orderMemberAreaProducts(courses, choices).map((course) => course.id)).toEqual(["d", "a", "c", "b"]);
    expect(orderMemberAreaProducts(courses, new Map()).map((course) => course.id)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("getMyMemberAreas", () => {
  it("sem linha: só a principal, virtual", async () => {
    from.mockReturnValueOnce(table({ data: [], error: null }));
    await expect(getMyMemberAreas("u-1")).resolves.toEqual({
      areas: [{ id: null, slug: null, settings: null, communityCourseId: null }],
      placement: new Map(),
    });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("principal primeiro, extras depois, e onde cada produto mora", async () => {
    from
      .mockReturnValueOnce(table({ data: [
        { id: "area-2", slug: "vip", name: "VIP", theme: "light", cover_path: null, welcome_text: null, community_course_id: null },
        { id: "area-1", slug: null, name: "Eton Academy", theme: "dark", cover_path: null, welcome_text: "Oi", community_course_id: "c-com" },
      ], error: null }))
      .mockReturnValueOnce(table({ data: [{ area_id: "area-2", course_id: "c-a", position: 0, visible: false }], error: null }));
    const editor = await getMyMemberAreas("u-1");
    expect(from).toHaveBeenNthCalledWith(2, "member_area_products");
    expect(editor.areas.map((area) => area.slug)).toEqual([null, "vip"]);
    expect(editor.areas[0].settings).toEqual({ name: "Eton Academy", theme: "dark", coverPath: null, welcomeText: "Oi" });
    expect(editor.areas[0].communityCourseId).toBe("c-com");
    expect(editor.placement.get("c-a")).toEqual({ areaId: "area-2", position: 0, visible: false });
  });
});

describe("memberAreaProductsOf", () => {
  const editor = {
    areas: [
      { id: "main", slug: null, settings: null, communityCourseId: null },
      { id: "vip", slug: "vip", settings: null, communityCourseId: null },
    ],
    placement: new Map([
      ["a", { areaId: "main", position: 0, visible: true }],
      ["b", { areaId: "vip", position: 0, visible: false }],
    ]),
  };
  const courses = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("principal: a lista dela e o que não está em extra; extra: só a lista dela", () => {
    const main = memberAreaProductsOf(courses, editor, editor.areas[0]);
    expect(main.courses.map((course) => course.id)).toEqual(["a", "c"]);
    expect([...main.choices.keys()]).toEqual(["a"]);
    const vip = memberAreaProductsOf(courses, editor, editor.areas[1]);
    expect(vip.courses.map((course) => course.id)).toEqual(["b"]);
    expect(vip.choices.get("b")).toEqual({ position: 0, visible: false });
  });
});

describe("áreas extras", () => {
  it("endereço da extra e regra do slug", () => {
    expect(memberAreaPath({ username: "eton", ownerId: "u-1", slug: "vip" })).toBe("/learn/areas/@eton/vip");
    expect(isValidMemberAreaSlug("turma-2")).toBe(true);
    for (const bad of ["community", "-x", "x-", "Turma", "a b", "", "a".repeat(41)]) {
      expect(isValidMemberAreaSlug(bad), bad).toBe(false);
    }
  });

  it("pede a extra pelo slug; a principal nem manda o parâmetro", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await getMemberAreaHome("@eton", "vip");
    expect(rpc).toHaveBeenLastCalledWith("get_member_area_home", { p_area_ref: "@eton", p_slug: "vip" });
    await getMemberAreaHome("@eton");
    expect(rpc).toHaveBeenLastCalledWith("get_member_area_home", { p_area_ref: "@eton" });
  });

  it("criar: traduz limite, endereço em uso e inválido", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "MEMBER_AREA_LIMIT", code: "P0001" } });
    await expect(createMyMemberArea("x", "vip")).rejects.toThrow("limit");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "duplicate key", code: "23505" } });
    await expect(createMyMemberArea("x", "vip")).rejects.toThrow("slugTaken");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "MEMBER_AREA_SLUG_INVALID", code: "22023" } });
    await expect(createMyMemberArea("x", "vip")).rejects.toThrow("slugInvalid");
    rpc.mockResolvedValueOnce({ data: "area-2", error: null });
    await expect(createMyMemberArea("VIP", "vip")).resolves.toBe("area-2");
  });

  it("slugs dos produtos: lista vazia não vai ao banco", async () => {
    await expect(getMemberAreaSlugs([])).resolves.toEqual(new Map());
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: [{ course_id: "c-b", slug: "vip", name: "VIP" }], error: null });
    await expect(getMemberAreaSlugs(["c-a", "c-b"])).resolves.toEqual(new Map([["c-b", { slug: "vip", name: "VIP" }]]));
  });
});

describe("uploadMemberAreaCover", () => {
  it("sobe na pasta do criador com nome novo e devolve o caminho", async () => {
    upload.mockResolvedValue({ error: null });
    const file = new File(["x"], "capa.png", { type: "image/png" });
    const path = await uploadMemberAreaCover("u-1", file);
    expect(path).toMatch(/^users\/u-1\/member-area\/cover-\d+$/);
    expect(upload).toHaveBeenCalledWith(path, file, { contentType: "image/png", upsert: false });
  });

  it("recusa formato fora da lista sem subir nada", async () => {
    await expect(uploadMemberAreaCover("u-1", new File(["x"], "capa.gif", { type: "image/gif" })))
      .rejects.toThrow("MEMBER_AREA_COVER_INVALID");
    expect(upload).not.toHaveBeenCalled();
  });
});
