import { describe, expect, it } from "vitest";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

import type { CourseAsset } from "@/domain/course-asset";
import {
  countLessonFiles,
  getCourseReadiness,
  getLessonIdsWithMedia,
  groupCourseReadiness,
  type CourseReadinessInput,
} from "@/domain/course-readiness";
import { getCourseMaintenanceIssues } from "@/domain/course-overview";
import type { TeacherCourse, TeacherLesson } from "@/domain/teacher-course";

const lesson = { id: "l1", title: "Welcome", type: "video" as const, description: "" };

const complete: CourseReadinessInput = {
  title: "Clinical performance foundations",
  summary: "Build a repeatable practice for evidence-informed performance work.",
  category: "Applied Psychology & Behavior",
  categories: ["Applied Psychology & Behavior"],
  modules: [{ id: "m1", title: "Start here", lessons: [lesson] }],
  priceAmountMinor: 14900,
  paymentType: "one_time",
};

describe("getCourseReadiness", () => {
  it.each(["free", "one_time"] as const)("requires a creator plan even for a %s product", (paymentType) => {
    const account = { payoutsReady: true, verificationRequired: false, verificationApproved: false, planRequired: true };
    const input = { ...complete, paymentType };
    expect(getCourseReadiness(input, account).pending.map((item) => item.id)).toContain("plan");
    expect(getCourseReadiness(input, { ...account, planRequired: false }).pending.map((item) => item.id)).not.toContain("plan");
  });
  it.each([false, true])("localizes every check without changing publication gates (paid: %s)", (paid) => {
    const input = {
      ...complete,
      paymentType: paid ? "one_time" as const : "free" as const,
      priceAmountMinor: paid ? 14900 : 0,
      installmentsEnabled: true,
      installmentsMax: null,
    };
    const account = { payoutsReady: false, verificationRequired: paid, verificationApproved: false };
    const legacy = getCourseReadiness(input, account);
    const en = getCourseReadiness(input, account, (key) => translate(getDictionary("en"), key));
    const es = getCourseReadiness(input, account, (key) => translate(getDictionary("es"), key));
    const gates = (result: typeof legacy) => ({
      items: result.items.map(({ id, done, optional }) => ({ id, done, optional })),
      pending: result.pending.map(({ id }) => id),
      next: result.next?.id,
      doneCount: result.doneCount,
      total: result.total,
      percent: result.percent,
      ready: result.ready,
    });
    expect(en).toEqual(legacy);
    expect(gates(es)).toEqual(gates(legacy));
    expect(es.items.find(({ id }) => id === "title")?.label).toBe("Título del curso");
    expect(es.items.find(({ id }) => id === "title")?.hint).toBe("Dale al curso un título de al menos 3 caracteres.");
    expect(es.items.find(({ id }) => id === "verification")?.hint).toBe(paid
      ? "Completa la verificación profesional antes de publicar."
      : "Hoy es opcional; será obligatoria cuando se abra la admisión profesional.");
    for (const item of es.items) {
      expect(item.label).not.toBe(legacy.items.find(({ id }) => id === item.id)?.label);
      expect(item.hint).not.toBe(legacy.items.find(({ id }) => id === item.id)?.hint);
      expect(item.label).not.toContain("creatorEditor.");
      expect(item.hint).not.toContain("creatorEditor.");
    }
  });

  // The teacher saw three lists of "what is missing" with three different numbers
  // for the same course. The proof that there is now one rule: the same input
  // returns exactly the same list, always.
  it("returns the same list for the same input", () => {
    const first = getCourseReadiness(complete);
    const second = getCourseReadiness({ ...complete });
    expect(second).toEqual(first);
  });

  it("a course with no price and no lesson lists the two pending items, in that order", () => {
    const readiness = getCourseReadiness({
      ...complete,
      modules: [{ id: "m1", title: "Start here", lessons: [] }],
      priceAmountMinor: null,
    });

    expect(readiness.pending.map((item) => item.id)).toEqual(["lesson", "pricing"]);
    expect(readiness.next?.hint).toBe("Add at least one lesson.");
    expect(readiness.ready).toBe(false);
    // 4 of 6 required: title, summary, category and module.
    expect(readiness.doneCount).toBe(4);
    expect(readiness.total).toBe(6);
    expect(readiness.percent).toBe(67);
  });

  it("a complete course returns an empty list and 100%", () => {
    const readiness = getCourseReadiness(complete);

    expect(readiness.pending).toEqual([]);
    expect(readiness.next).toBeNull();
    expect(readiness.percent).toBe(100);
    expect(readiness.ready).toBe(true);
  });

  // Stricter rule across the screens: the builder accepted a 1-letter
  // title; the creation form and Manage asked for 3. A course that one screen
  // called incomplete cannot show up as 100% on another.
  it("requires a title with 3+ characters, as Manage already did", () => {
    const readiness = getCourseReadiness({ ...complete, title: "AB" });
    expect(readiness.pending.map((item) => item.id)).toEqual(["title"]);
  });

  it("free needs no price; paid requires a value above zero", () => {
    expect(
      getCourseReadiness({ ...complete, paymentType: "free", priceAmountMinor: 0 }).ready,
    ).toBe(true);
    expect(
      getCourseReadiness({ ...complete, priceAmountMinor: 0 }).pending.map((i) => i.id),
    ).toEqual(["pricing"]);
  });

  // Promise, Summary and Description were the same text with three names. The
  // checklist uses the name from the creation screen and the builder.
  it.each([
    ["en", "Description", "Write a description with at least 20 characters."],
    ["es", "Descripción", "Escribe una descripción de al menos 20 caracteres."],
  ] as const)("the summary item is called Description (%s)", (locale, label, hint) => {
    const readiness = getCourseReadiness(
      { ...complete, summary: "short" },
      undefined,
      (key) => translate(getDictionary(locale), key),
    );

    expect(readiness.pending[0]).toMatchObject({ id: "summary", label, hint });
  });

  // The list for whoever chose Free does not mention price anywhere, not even
  // as a done item: an old course with no paymentType and price 0 counts as free.
  it.each([
    ["free", 0],
    [undefined, 0],
  ] as const)("a free product (paymentType %s) has no price item in the checklist", (paymentType, priceAmountMinor) => {
    const account = { payoutsReady: false, verificationRequired: false, verificationApproved: false };
    const readiness = getCourseReadiness(
      { ...complete, paymentType, priceAmountMinor },
      account,
      (key) => translate(getDictionary("en"), key),
    );

    expect(readiness.items.map((item) => item.id)).not.toContain("pricing");
    expect(readiness.items.map((item) => `${item.label} ${item.hint}`).join(" ")).not.toMatch(/price/i);
    expect(readiness.ready).toBe(true);
  });

  // Installments only count when they exist: listing "Payment model is ready" on a
  // free course was a free "done" item that inflated the percentage.
  it("only requires an installment limit on a one-time sale with installments turned on", () => {
    const withoutLimit = getCourseReadiness({
      ...complete,
      installmentsEnabled: true,
      installmentsMax: null,
    });
    expect(withoutLimit.pending.map((item) => item.id)).toEqual(["installments"]);

    const free = getCourseReadiness({
      ...complete,
      paymentType: "free",
      installmentsEnabled: true,
      installmentsMax: null,
    });
    expect(free.items.some((item) => item.id === "installments")).toBe(false);
  });

  // Cover and learning outcomes help to sell but do not block
  // publishing: they appear in the list, marked as optional, outside the count.
  it("lists cover and outcomes as optional, outside the percentage", () => {
    const readiness = getCourseReadiness(complete);
    const optional = readiness.items.filter((item) => item.optional).map((i) => i.id);

    expect(optional).toEqual(["cover", "outcomes"]);
    expect(readiness.percent).toBe(100);
  });

  // Manage required Stripe payouts for a paid course and the professional
  // verification when mandatory; the builder did not know that and let
  // the person click Publish to find out through the error. With the profile at hand, the
  // same function enforces both locks.
  it("with account data, requires payouts on a paid course and verification when mandatory", () => {
    const readiness = getCourseReadiness(complete, {
      payoutsReady: false,
      verificationRequired: true,
      verificationApproved: false,
    });

    expect(readiness.pending.map((item) => item.id)).toEqual(["payouts", "verification"]);
    expect(readiness.percent).toBe(75);
  });

  it("a free course does not ask for payouts; verification that is not mandatory becomes optional", () => {
    const readiness = getCourseReadiness(
      { ...complete, paymentType: "free", priceAmountMinor: 0 },
      { payoutsReady: false, verificationRequired: false, verificationApproved: false },
    );

    expect(readiness.items.some((item) => item.id === "payouts")).toBe(false);
    expect(readiness.items.find((item) => item.id === "verification")?.optional).toBe(true);
    expect(readiness.ready).toBe(true);
  });

  // The one-time fee only showed up as a database error after Publish. Whoever still
  // owes the fee sees the item beforehand, with the value of the plans constant.
  it.each([
    ["en", "Activation — US$25, one time"],
    ["es", "Activación — US$25, pago único"],
  ] as const)("lists the pending activation for whoever still owes the fee (%s)", (locale, label) => {
    const dictionary = getDictionary(locale);
    const account = { payoutsReady: true, verificationRequired: false, verificationApproved: false };
    const blocked = getCourseReadiness(
      { ...complete, paymentType: "free", priceAmountMinor: 0 },
      { ...account, activationBlocked: true },
      (key) => translate(dictionary, key),
    );

    expect(blocked.pending.map((item) => item.id)).toEqual(["activation"]);
    expect(blocked.pending[0]).toMatchObject({ group: "sale", label, optional: false, done: false });
    expect(blocked.ready).toBe(false);
    expect(getCourseReadiness(complete, account).items.some((item) => item.id === "activation")).toBe(false);
  });

  it("without a translator, the activation label already comes out with the value", () => {
    const readiness = getCourseReadiness(complete, {
      payoutsReady: true,
      verificationRequired: false,
      verificationApproved: false,
      activationBlocked: true,
    });

    expect(readiness.next?.label).toBe("Activation — US$25, one time");
  });
});

// Audit (content-publish-without-media): a course could be published and
// sold with lessons without video, without text and without a file.
describe("lessonMedia: every lesson needs content", () => {
  const withVideo: TeacherLesson = { id: "l1", title: "Welcome", type: "video", description: "" };
  const empty: TeacherLesson = { id: "l2", title: "Empty lesson", type: "video", description: "" };
  const courseWith = (...lessons: TeacherLesson[]): CourseReadinessInput => ({
    ...complete,
    modules: [{ id: "m1", title: "Start here", lessons }],
  });
  const asset = (kind: CourseAsset["kind"], lessonId: string) => ({ kind, lessonId });
  const readinessOf = (
    course: CourseReadinessInput,
    assets: Array<Pick<CourseAsset, "kind" | "lessonId">> = [],
    t?: (key: string) => string,
  ) => getCourseReadiness({
    ...course,
    lessonIdsWithMedia: getLessonIdsWithMedia(course.modules, assets),
  }, undefined, t);

  it("2 lessons, one with video and one empty: not ready and the hint names the empty one", () => {
    const readiness = readinessOf(courseWith(withVideo, empty), [asset("lesson_video", "l1")]);

    expect(readiness.ready).toBe(false);
    expect(readiness.pending.map((item) => item.id)).toEqual(["lessonMedia"]);
    expect(readiness.next?.hint).toBe("Add a video, text or file to every lesson. Missing: Empty lesson.");
    expect(readiness.items.find((item) => item.id === "lessonMedia")?.group).toBe("content");
  });

  it("text in the empty lesson makes it ready", () => {
    const readiness = readinessOf(
      courseWith(withVideo, { ...empty, contentText: "Read this before the next lesson." }),
      [asset("lesson_video", "l1")],
    );

    expect(readiness.ready).toBe(true);
    expect(readiness.items.find((item) => item.id === "lessonMedia")).toMatchObject({
      done: true,
      hint: "Add a video, text or file to every lesson.",
    });
  });

  it("a lesson with only a PDF counts; only spaces in the text does not", () => {
    expect(readinessOf(courseWith(withVideo, empty), [
      asset("lesson_video", "l1"), asset("lesson_material", "l2"),
    ]).ready).toBe(true);
    expect(readinessOf(courseWith({ ...empty, contentText: "   " })).ready).toBe(false);
  });

  // The learner gets "Open resource" on an old link (Drive etc.), and the studio's link
  // field rejects that link: without counting it here, the teacher could never
  // republish without uploading the content again.
  it("a YouTube/Vimeo link or an old link (Drive) counts; an invalid link or the lesson cover does not", () => {
    expect(readinessOf(courseWith({ ...empty, externalUrl: "https://vimeo.com/123456" })).ready).toBe(true);
    expect(readinessOf(courseWith({ ...empty, externalUrl: "https://drive.example.test/file/d/x/view" })).ready)
      .toBe(true);
    expect(readinessOf(courseWith({ ...empty, externalUrl: "not a link" })).ready).toBe(false);
    expect(readinessOf(courseWith(empty), [asset("lesson_thumbnail", "l2")]).ready).toBe(false);
  });

  // Old text lesson: the body lives in the public description, which the learner sees and the
  // studio's Done badge counts. Without counting it here, Publish was blocked while the
  // panel said the lessons were fine.
  it("an old text lesson, with only the description, counts; a description with only spaces does not", () => {
    expect(readinessOf(courseWith({ ...empty, type: "text", description: "Read chapter 2 before the call." })).ready)
      .toBe(true);
    expect(readinessOf(courseWith({ ...empty, description: "   " })).ready).toBe(false);
  });

  it("the panel (lessons without content) and the Publish readiness point at the same lesson", () => {
    const lessons: TeacherLesson[] = [
      { id: "video", title: "Video lesson", type: "video", description: "" },
      { id: "pdf", title: "PDF only", type: "video", description: "" },
      { id: "legacy-text", title: "Legacy text", type: "text", description: "Read chapter 2." },
      { id: "drive", title: "Drive link", type: "video", description: "", externalUrl: "https://drive.example.test/file/d/x/view" },
      { id: "empty", title: "Empty lesson", type: "video", description: "" },
    ];
    const assets = [asset("lesson_video", "video"), asset("lesson_material", "pdf")];
    const course = {
      ...complete, id: "c1", ownerId: "o1", status: "draft", lessonCount: lessons.length,
      modules: [{ id: "m1", title: "Start here", lessons }],
    } as TeacherCourse;

    const panel = getCourseMaintenanceIssues({ course, assets: assets as CourseAsset[], coupons: null })
      .find((issue) => issue.id === "empty-lessons");
    const readiness = readinessOf(courseWith(...lessons), assets);

    expect(panel?.title).toBe("1 lesson has no content");
    expect(panel?.hint).toMatch(/^Empty lesson open/);
    expect(readiness.pending.map((item) => item.id)).toEqual(["lessonMedia"]);
    expect(readiness.next?.hint).toBe("Add a video, text or file to every lesson. Missing: Empty lesson.");
  });

  it("without the list (Manage) the item does not appear and the percentage does not change", () => {
    const readiness = getCourseReadiness(courseWith(withVideo, empty));

    expect(readiness.items.some((item) => item.id === "lessonMedia")).toBe(false);
    expect(readiness.ready).toBe(true);
    expect(readiness.percent).toBe(100);
  });

  it("with no lesson at all the item does not appear: the lesson item already covers it", () => {
    const readiness = readinessOf(courseWith());

    expect(readiness.items.some((item) => item.id === "lessonMedia")).toBe(false);
    expect(readiness.pending.map((item) => item.id)).toEqual(["lesson"]);
  });

  it("the hint names only the first three empty lessons, and translates without touching the titles", () => {
    const lessons = ["Aula $& um", "Two", "", "Four"].map((title, index) => ({
      ...empty, id: `e${index}`, title,
    }));
    const en = readinessOf(courseWith(...lessons), [], (key) => translate(getDictionary("en"), key));
    const es = readinessOf(courseWith(...lessons), [], (key) => translate(getDictionary("es"), key));

    expect(en.next?.hint).toBe("Add a video, text or file to every lesson. Missing: Aula $& um, Two, Untitled lesson and 1 more.");
    expect(es.next?.label).toBe("Contenido de las lecciones");
    expect(es.next?.hint).toBe("Añade un video, texto o archivo a cada lección. Faltan: Aula $& um, Two, Lección sin título y 1 más.");
    expect(en).toEqual(readinessOf(courseWith(...lessons)));
  });
});

// The "N of M" bar added up title, cover and Stripe payout as if they were the
// same thing; the person did not know whether they were stuck on the content, on the page or
// on the money. The split into three groups is read-only: same ids, same
// total, same `ready`.
describe("groupCourseReadiness", () => {
  const partial: CourseReadinessInput = {
    ...complete,
    modules: [{ id: "m1", title: "Start here", lessons: [] }],
    priceAmountMinor: null,
  };
  const account = { payoutsReady: false, verificationRequired: true, verificationApproved: false };

  it("separates content, page and sale, in that order, counting only the required ones", () => {
    const readiness = getCourseReadiness(partial, account);
    const groups = groupCourseReadiness(readiness);

    expect(groups.map((group) => group.id)).toEqual(["content", "page", "sale"]);
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["title", "module", "lesson"],
      ["summary", "category", "cover", "outcomes"],
      ["pricing", "verification"],
    ]);
    // Cover and outcomes are optional: they appear on the page, and stay out of the 2 of 2.
    expect(groups.map((group) => [group.doneCount, group.total, group.ready])).toEqual([
      [2, 3, false],
      [2, 2, true],
      [0, 2, false],
    ]);
  });

  it("the sum of the groups matches the overall one and nothing in the old contract changes", () => {
    const readiness = getCourseReadiness(partial, account);
    const groups = groupCourseReadiness(readiness);

    expect(groups.reduce((sum, group) => sum + group.doneCount, 0)).toBe(readiness.doneCount);
    expect(groups.reduce((sum, group) => sum + group.total, 0)).toBe(readiness.total);
    expect(groups.flatMap((group) => group.items)).toHaveLength(readiness.items.length);
    expect(readiness.pending.map((item) => item.id)).toEqual(["lesson", "pricing", "verification"]);
    expect(readiness.percent).toBe(57);
    expect(readiness.ready).toBe(false);
  });

  it("installments and payouts of the paid course fall under sale; optional verification does not count", () => {
    const readiness = getCourseReadiness(
      { ...complete, installmentsEnabled: true, installmentsMax: 6 },
      { payoutsReady: true, verificationRequired: false, verificationApproved: false },
    );
    const [content, page, sale] = groupCourseReadiness(readiness);

    expect(sale.items.map((item) => item.id)).toEqual(["pricing", "installments", "payouts", "verification"]);
    expect([sale.doneCount, sale.total, sale.ready]).toEqual([3, 3, true]);
    expect(content.ready).toBe(true);
    expect(page.ready).toBe(true);
    expect(readiness.ready).toBe(true);
  });

  it("every item carries its group and the translation does not change it", () => {
    const en = getCourseReadiness(partial, account);
    const es = getCourseReadiness(partial, account, (key) => translate(getDictionary("es"), key));

    expect(en.items.map((item) => item.group)).toEqual(es.items.map((item) => item.group));
    expect(en.items.every((item) => ["content", "page", "sale"].includes(item.group))).toBe(true);
    expect(groupCourseReadiness(es).map((group) => group.doneCount)).toEqual(
      groupCourseReadiness(en).map((group) => group.doneCount),
    );
  });

  // A free product has no price to set: the "Pricing" line (with the hint
  // "Set a paid price greater than $0") was a free "done" item that only
  // confused whoever chose Free. With no count, the sale group stays empty and ready
  // (total 0: the screen hides the count instead of saying "0 of 0").
  it("with no account and a free course, sale does not list price and starts out ready", () => {
    const readiness = getCourseReadiness({ ...complete, paymentType: "free", priceAmountMinor: 0 });
    const sale = groupCourseReadiness(readiness)[2];

    expect(sale.items.map((item) => item.id)).toEqual([]);
    expect([sale.doneCount, sale.total, sale.ready]).toEqual([0, 0, true]);
  });
});

// The type stored at creation (courses.product_format) decides what publishing
// requires. Same rule as publish_teacher_course (20261007010000).
describe("what each type needs to deliver", () => {
  const ids = (input: CourseReadinessInput) =>
    getCourseReadiness(input).items.filter((item) => !item.optional).map((item) => item.id);
  const empty = { ...complete, modules: [], paymentType: "free" as const, priceAmountMinor: 0 };

  it("course: module and lesson, as before (and with no stored type, course)", () => {
    expect(ids({ ...empty, productFormat: "course" })).toEqual(["title", "summary", "category", "module", "lesson"]);
    expect(getCourseReadiness({ ...empty, productFormat: "course" }).ready).toBe(false);
    expect(ids(empty)).toEqual(ids({ ...empty, productFormat: "course" }));
  });

  it("community: lesson optional, publishes with none", () => {
    const readiness = getCourseReadiness({ ...empty, productFormat: "community", communityEnabled: true });
    expect(readiness.items.map((item) => item.id)).not.toContain("module");
    expect(readiness.items.map((item) => item.id)).not.toContain("lesson");
    expect(readiness.ready).toBe(true);
  });

  it("community: a lesson that exists still needs content", () => {
    const readiness = getCourseReadiness({
      ...complete,
      productFormat: "community",
      paymentType: "subscription_monthly",
      communityEnabled: true,
      lessonIdsWithMedia: new Set<string>(),
    });
    expect(readiness.pending.map((item) => item.id)).toEqual(["lessonMedia"]);
  });

  // Without a required lesson, a disabled community would let an empty product be published.
  it("community: the community must be turned on", () => {
    const readiness = getCourseReadiness({ ...empty, productFormat: "community", communityEnabled: false });
    expect(readiness.pending.map((item) => item.id)).toEqual(["community"]);
  });

  it("live event: the scheduled session in place of the lesson", () => {
    const base = { ...empty, productFormat: "live_event" as const };
    expect(getCourseReadiness({ ...base, scheduledSessionCount: 0 }).pending.map((item) => item.id)).toEqual(["session"]);
    expect(getCourseReadiness({ ...base, scheduledSessionCount: 1 }).ready).toBe(true);
    // Without the session list (Manage), the item disappears, like lessonMedia.
    expect(ids(base)).not.toContain("session");
  });

  it("e-book: at least one file, without requiring a module, a lesson or lesson content", () => {
    const base = {
      ...complete,
      paymentType: "free" as const,
      priceAmountMinor: 0,
      productFormat: "ebook" as const,
      lessonIdsWithMedia: new Set<string>(),
    };
    expect(getCourseReadiness({ ...base, lessonFileCount: 0 }).pending.map((item) => item.id)).toEqual(["file"]);
    expect(getCourseReadiness({ ...base, lessonFileCount: 1 }).ready).toBe(true);
  });

  it("only counts a file attached to a lesson of the product", () => {
    const modules = [{ id: "m1", title: "Download", lessons: [lesson] }];
    const assets: Pick<CourseAsset, "kind" | "lessonId">[] = [
      { kind: "lesson_material", lessonId: "l1" },
      { kind: "lesson_material", lessonId: "deleted-lesson" },
      { kind: "lesson_material", lessonId: null },
      { kind: "lesson_video", lessonId: "l1" },
    ];
    expect(countLessonFiles(modules, assets)).toBe(1);
  });

  it("translates the new items", () => {
    const es = (key: string) => translate(getDictionary("es"), key);
    const session = getCourseReadiness({ ...empty, productFormat: "live_event", scheduledSessionCount: 0 }, undefined, es)
      .items.find((item) => item.id === "session");
    const file = getCourseReadiness({ ...empty, productFormat: "ebook", lessonFileCount: 0 }, undefined, es)
      .items.find((item) => item.id === "file");
    const community = getCourseReadiness({ ...empty, productFormat: "community" }, undefined, es)
      .items.find((item) => item.id === "community");
    expect([session?.label, file?.label, community?.label])
      .toEqual(["Sesión en vivo", "Archivo para descargar", "Comunidad activada"]);
  });
});

// Each type accepts only its own ways to pay (paymentTypeFitsFormat, the
// mirror of course_payment_type_fits_format). A product created before the rule
// shows the price item open, with the reason, instead of publishing and the database
// rejecting it.
describe("a way to pay that the type does not accept", () => {
  const pricing = (input: CourseReadinessInput, t?: (key: string) => string) =>
    getCourseReadiness(input, undefined, t).items.find((item) => item.id === "pricing");

  it.each([
    ["community", "one_time"],
    ["live_event", "subscription_monthly"],
    ["ebook", "subscription_yearly"],
  ] as const)("%s charging %s: the price stays pending", (productFormat, paymentType) => {
    const item = pricing({ ...complete, productFormat, paymentType, communityEnabled: true });
    expect(item?.done).toBe(false);
    expect(item?.hint).toBe("This way of paying does not fit this type of product. Pick another one in Pricing.");
    const es = pricing({ ...complete, productFormat, paymentType, communityEnabled: true }, (key) =>
      translate(getDictionary("es"), key),
    );
    expect(es?.hint).toBe("Esta forma de pago no corresponde a este tipo de producto. Elige otra en Precios.");
  });

  it.each([
    ["course", "subscription_yearly"],
    ["community", "subscription_yearly"],
    ["live_event", "one_time"],
    ["ebook", "one_time"],
  ] as const)("%s charging %s: the price counts as done", (productFormat, paymentType) => {
    expect(pricing({ ...complete, productFormat, paymentType, communityEnabled: true })?.done).toBe(true);
  });

  // A hard-coded "$0" said dollars to whoever sells in reais.
  it("the zero in the hint comes in the chosen currency", () => {
    const empty = { ...complete, priceAmountMinor: null, currency: "BRL" };
    expect(pricing(empty)?.hint).toBe("Set a price above R$0, or choose Free.");
    expect(pricing(empty, (key) => translate(getDictionary("es"), key))?.hint).toBe(
      "Define un precio mayor que R$0 o elige Gratis.",
    );
    expect(pricing({ ...empty, currency: "USD" })?.hint).toBe("Set a price above $0, or choose Free.");
  });
});
