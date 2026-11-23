import { describe, expect, it, vi } from "vitest";

// O "Try again" das telas do aluno e do site relê pela MESMA inscrição
// (`reload()`), sem sair e entrar de novo no Realtime. Para cada função:
//  - a consulta e o canal são os de antes (travados aqui, argumento por argumento);
//  - sem reload, tudo entrega como antes, inclusive a leitura inicial que volta
//    depois de desligar (a sala reinscreve a cada 5s depois do checkout);
//  - com reload: só a leitura mais nova vale entre ele e o canal, nada do
//    reload chega depois de desligar, e o reload que falha avisa e resolve.

type Answer = { data: unknown; error: Error | null };
type Read = { query: unknown[][]; answer: (answer: Answer) => void };
type Channel = { name: string; kind: string; filter: unknown; handler: (payload?: unknown) => void };

const fake = vi.hoisted(() => ({
  reads: [] as Read[],
  channels: [] as Channel[],
  removeChannel: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    // Consulta encadeável que anota cada chamada; ao ser aguardada vira uma
    // leitura pendente que o teste responde na ordem que quiser.
    from: (table: string) => {
      const query: unknown[][] = [["from", table]];
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "order", "limit", "range", "maybeSingle"]) {
        builder[method] = (...args: unknown[]) => {
          query.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve: (answer: Answer) => unknown, reject?: (reason: unknown) => unknown) =>
        new Promise<Answer>((answer) => fake.reads.push({ query, answer })).then(resolve, reject);
      return builder;
    },
    // O canal guarda o filtro e o handler: o teste dispara a mudança.
    channel: (name: string) => {
      const entry: Channel = { name, kind: "", filter: null, handler: () => undefined };
      fake.channels.push(entry);
      const channel = {
        on: (kind: string, filter: unknown, handler: (payload?: unknown) => void) => {
          Object.assign(entry, { kind, filter, handler });
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: fake.removeChannel,
    auth: { getSession: () => Promise.resolve({ data: { session: { user: {} } } }) },
  }),
}));

const { subscribeToUserWishlist } = await import("@/lib/data/wishlist");
const { subscribeToPublishedTeacherCourses } = await import("@/lib/data/published-courses");
const { subscribeToCourseSubscription, subscribeToTeacherCourseSubscriptions } = await import("@/lib/data/course-subscriptions");
const { subscribeToTeacherPayoutLedger } = await import("@/lib/data/payout-ledger");
const { subscribeToCommunityPosts } = await import("@/lib/data/community-posts");
const { subscribeToEnrollment } = await import("@/lib/data/enrollments");
const { subscribeToCompletedLessons } = await import("@/lib/data/lesson-progress");
const { subscribeToUserCertificates } = await import("@/lib/data/certificates");
const { subscribeToCourseEvents } = await import("@/lib/data/course-events");

type Subscription = (() => void) & { reload: () => Promise<void> };
type Case = {
  name: string;
  subscribe: (callback: (value: unknown) => void, onError: (error: Error) => void) => Subscription;
  /** A consulta de main, chamada por chamada. */
  query: unknown[][];
  channel: { name: string; filter: Record<string, string> };
  /** "reread": o canal relê a consulta; "payload": o canal entrega a linha que mudou. */
  realtime: "reread" | "payload";
  answer: (id: string) => unknown;
  idOf: (value: unknown) => string | null;
};

const newest = { ascending: false, nullsFirst: false };
const firstId = (value: unknown) => (value as Array<{ id: string }>)[0]?.id ?? null;

const cases: Case[] = [
  {
    name: "subscribeToUserWishlist",
    subscribe: (callback, onError) => subscribeToUserWishlist("u-1", callback as never, onError),
    query: [["from", "wishlists"], ["select", "*"], ["eq", "user_id", "u-1"]],
    channel: { name: "wishlists:user:u-1", filter: { event: "*", schema: "public", table: "wishlists", filter: "user_id=eq.u-1" } },
    realtime: "reread",
    answer: (id) => [{ id, user_id: "u-1", course_id: id, course_slug: id, created_at: "2026-11-22T10:00:00Z", updated_at: null }],
    idOf: firstId,
  },
  {
    name: "subscribeToPublishedTeacherCourses",
    subscribe: (callback, onError) => subscribeToPublishedTeacherCourses(callback as never, onError),
    query: [["from", "courses"], ["select", "*"], ["eq", "status", "published"], ["limit", 200]],
    channel: { name: "courses:published", filter: { event: "*", schema: "public", table: "courses" } },
    realtime: "reread",
    answer: (id) => [{ id, owner_id: "t-1", title: id, summary: "", category: "", status: "published", modules: [] }],
    idOf: firstId,
  },
  {
    name: "subscribeToCourseSubscription",
    subscribe: (callback, onError) => subscribeToCourseSubscription("sub-1", callback as never, onError),
    query: [["from", "course_subscriptions"], ["select", "*"], ["eq", "id", "sub-1"], ["maybeSingle"]],
    channel: { name: "course_subscriptions:one:sub-1", filter: { event: "*", schema: "public", table: "course_subscriptions", filter: "id=eq.sub-1" } },
    realtime: "payload",
    answer: (id) => ({ id, user_id: "u-1", course_id: "c-1", status: "active" }),
    idOf: (value) => (value as { id: string } | null)?.id ?? null,
  },
  {
    name: "subscribeToCommunityPosts",
    subscribe: (callback, onError) => subscribeToCommunityPosts("course-1", callback as never, onError),
    query: [
      ["from", "community_posts"], ["select", "*"], ["eq", "course_slug", "course-1"],
      ["order", "pinned", newest], ["order", "created_at", newest], ["limit", 200],
    ],
    channel: { name: "community_posts:course:course-1", filter: { event: "*", schema: "public", table: "community_posts", filter: "course_slug=eq.course-1" } },
    realtime: "reread",
    answer: (id) => [{ id, course_slug: "course-1", author_id: "a-1", author_name: "Ana", body: "", created_at: "2026-11-22T10:00:00Z" }],
    idOf: firstId,
  },
  {
    name: "subscribeToEnrollment",
    subscribe: (callback, onError) => subscribeToEnrollment("u-1", "course-1", callback as never, onError),
    query: [["from", "enrollments"], ["select", "*"], ["eq", "id", "u-1__course-1"], ["maybeSingle"]],
    channel: { name: "enrollments:one:u-1__course-1", filter: { event: "*", schema: "public", table: "enrollments", filter: "id=eq.u-1__course-1" } },
    realtime: "payload",
    answer: (id) => ({ id, user_id: "u-1", course_id: "c-1", course_slug: "course-1", course_title: "Curso" }),
    idOf: (value) => (value as { id: string } | null)?.id ?? null,
  },
  {
    name: "subscribeToCompletedLessons",
    subscribe: (callback, onError) => subscribeToCompletedLessons("enr-1", callback as never, onError),
    query: [["from", "lesson_progress"], ["select", "lesson_id"], ["eq", "enrollment_id", "enr-1"]],
    channel: { name: "lesson_progress:enr-1", filter: { event: "*", schema: "public", table: "lesson_progress", filter: "enrollment_id=eq.enr-1" } },
    realtime: "reread",
    answer: (id) => [{ lesson_id: id }],
    idOf: (value) => (value as string[])[0] ?? null,
  },
  {
    name: "subscribeToUserCertificates",
    subscribe: (callback, onError) => subscribeToUserCertificates("u-1", callback as never, onError),
    query: [["from", "certificates"], ["select", "*"], ["eq", "user_id", "u-1"]],
    channel: { name: "certificates:u-1", filter: { event: "*", schema: "public", table: "certificates", filter: "user_id=eq.u-1" } },
    realtime: "reread",
    answer: (id) => [{ id, enrollment_id: id, user_id: "u-1", status: "issued" }],
    idOf: firstId,
  },
  {
    name: "subscribeToCourseEvents",
    subscribe: (callback, onError) => subscribeToCourseEvents("course-1", callback as never, onError),
    query: [["from", "course_events"], ["select", "*"], ["eq", "course_slug", "course-1"]],
    channel: { name: "course_events:slug:course-1", filter: { event: "*", schema: "public", table: "course_events", filter: "course_slug=eq.course-1" } },
    realtime: "reread",
    answer: (id) => [{ id, course_slug: "course-1", status: "scheduled", starts_at: "2026-12-01T10:00:00Z", title: id }],
    idOf: firstId,
  },
  // A opção das canceladas: a MESMA consulta e o mesmo canal, só o filtro muda.
  {
    name: "subscribeToCourseEvents com includeCancelled",
    subscribe: (callback, onError) =>
      subscribeToCourseEvents("course-1", callback as never, onError, { includeCancelled: true }),
    query: [["from", "course_events"], ["select", "*"], ["eq", "course_slug", "course-1"]],
    channel: { name: "course_events:slug:course-1", filter: { event: "*", schema: "public", table: "course_events", filter: "course_slug=eq.course-1" } },
    realtime: "reread",
    answer: (id) => [{ id, course_slug: "course-1", status: "cancelled", starts_at: "2026-12-01T10:00:00Z", title: id }],
    idOf: firstId,
  },
];

describe("subscribeToCourseEvents: as canceladas", () => {
  const rows = [
    { id: "marcada", course_slug: "course-1", status: "scheduled", starts_at: "2026-12-01T10:00:00Z" },
    { id: "cancelada", course_slug: "course-1", status: "cancelled", starts_at: "2026-12-02T10:00:00Z" },
    { id: "realizada", course_slug: "course-1", status: "completed", starts_at: "2026-12-03T10:00:00Z" },
  ];

  it.each([
    ["sem a opção, só as marcadas (como antes)", undefined, ["marcada"]],
    ["com a opção, as marcadas e as canceladas", { includeCancelled: true }, ["marcada", "cancelada"]],
  ] as const)("%s", async (_label, options, ids) => {
    fake.reads = [];
    fake.channels = [];
    const callback = vi.fn();
    subscribeToCourseEvents("course-1", callback, vi.fn(), options);
    await vi.waitFor(() => expect(fake.reads).toHaveLength(1));
    fake.reads[0].answer({ data: rows, error: null });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    expect(callback.mock.calls[0][0].map((event: { id: string }) => event.id)).toEqual(ids);
  });
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const reads = (count: number) => vi.waitFor(() => expect(fake.reads).toHaveLength(count));
const reloadCases = cases.filter((item) => item.realtime === "reread");
const payloadCases = cases.filter((item) => item.realtime === "payload");

// Uma inscrição nova, com a leitura inicial já pendente e o canal aberto.
async function start(item: Case) {
  fake.reads = [];
  fake.channels = [];
  fake.removeChannel.mockClear();
  const callback = vi.fn();
  const onError = vi.fn();
  const subscription = item.subscribe(callback, onError);
  await reads(1);
  await settle();
  const delivered = () => callback.mock.calls.map(([value]) => item.idOf(value));
  return { callback, onError, subscription, delivered, channel: () => fake.channels[0] };
}

describe("reload() das inscrições do aluno e do site", () => {
  it.each(cases)("$name: a consulta e o canal são os de antes, e o reload repete a mesma consulta", async (item) => {
    const { subscription } = await start(item);
    expect(fake.reads[0].query).toEqual(item.query);
    expect(fake.channels).toHaveLength(1);
    expect(fake.channels[0]).toMatchObject({ name: item.channel.name, kind: "postgres_changes", filter: item.channel.filter });

    void subscription.reload();
    await reads(2);
    expect(fake.reads[1].query).toEqual(item.query);
    expect(fake.channels).toHaveLength(1);
    expect(fake.removeChannel).not.toHaveBeenCalled();
  });

  it.each(cases)("$name: sem reload, a leitura inicial que volta depois de desligar ainda entrega (como antes)", async (item) => {
    const { subscription, delivered } = await start(item);
    subscription();
    fake.reads[0].answer({ data: item.answer("inicial"), error: null });
    await settle();
    expect(delivered()).toEqual(["inicial"]);
    expect(fake.removeChannel).toHaveBeenCalledOnce();
  });

  it.each(reloadCases)("$name: sem reload, as releituras do canal entregam na ordem em que voltam (como antes)", async (item) => {
    const { delivered, channel } = await start(item);
    fake.reads[0].answer({ data: item.answer("inicial"), error: null });
    channel().handler();
    channel().handler();
    await reads(3);
    fake.reads[2].answer({ data: item.answer("canal-2"), error: null });
    await settle();
    fake.reads[1].answer({ data: item.answer("canal-1"), error: null });
    await settle();
    expect(delivered()).toEqual(["inicial", "canal-2", "canal-1"]);
  });

  it.each(payloadCases)("$name: o canal entrega a linha que mudou, sem leitura nova (como antes)", async (item) => {
    const { delivered, channel } = await start(item);
    fake.reads[0].answer({ data: item.answer("inicial"), error: null });
    await settle();
    channel().handler({ eventType: "UPDATE", new: item.answer("mudou") });
    channel().handler({ eventType: "DELETE", old: {} });
    expect(delivered()).toEqual(["inicial", "mudou", null]);
    expect(fake.reads).toHaveLength(1);
  });

  it.each(cases)("$name: dois reloads fora de ordem: só o mais novo entrega", async (item) => {
    const { subscription, onError, delivered } = await start(item);
    fake.reads[0].answer({ data: null, error: new Error("offline") });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());

    void subscription.reload();
    void subscription.reload();
    await reads(3);
    fake.reads[2].answer({ data: item.answer("nova"), error: null });
    await settle();
    fake.reads[1].answer({ data: item.answer("velha"), error: null });
    await settle();
    expect(delivered()).toEqual(["nova"]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it.each(reloadCases)("$name: o canal relê depois do reload: vale a do canal, a do reload que volta depois cai", async (item) => {
    const { subscription, delivered, channel } = await start(item);
    fake.reads[0].answer({ data: item.answer("inicial"), error: null });
    await settle();

    void subscription.reload();
    channel().handler();
    await reads(3);
    fake.reads[2].answer({ data: item.answer("canal"), error: null });
    await settle();
    fake.reads[1].answer({ data: item.answer("reload"), error: null });
    await settle();
    expect(delivered()).toEqual(["inicial", "canal"]);
  });

  it.each(reloadCases)("$name: o reload depois de uma releitura do canal: vale o reload, a do canal mais velha cai", async (item) => {
    const { subscription, delivered, channel } = await start(item);
    fake.reads[0].answer({ data: item.answer("inicial"), error: null });
    await settle();

    channel().handler();
    await reads(2);
    void subscription.reload();
    await reads(3);
    fake.reads[2].answer({ data: item.answer("reload"), error: null });
    await settle();
    fake.reads[1].answer({ data: item.answer("canal-velho"), error: null });
    await settle();
    expect(delivered()).toEqual(["inicial", "reload"]);
  });

  it.each(cases)("$name: o reload que falha avisa por onError e a promessa resolve", async (item) => {
    const { subscription, onError, callback } = await start(item);
    fake.reads[0].answer({ data: null, error: new Error("offline") });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());

    const retry = subscription.reload();
    await reads(2);
    fake.reads[1].answer({ data: null, error: new Error("ainda offline") });
    await expect(retry).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[1][0]).toEqual(new Error("ainda offline"));
    expect(callback).not.toHaveBeenCalled();
  });

  it.each(cases)("$name: o reload que volta depois de desligar não entrega nada", async (item) => {
    const { subscription, onError, callback } = await start(item);
    fake.reads[0].answer({ data: null, error: new Error("offline") });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());

    const retry = subscription.reload();
    await reads(2);
    subscription();
    fake.reads[1].answer({ data: item.answer("tarde"), error: null });
    await expect(retry).resolves.toBeUndefined();
    expect(callback).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(fake.removeChannel).toHaveBeenCalledOnce();
  });
});

// Ganhos e Assinaturas: as duas leituras do professor ganharam `reload` (o
// "Try again"). Elas leem em páginas e, ao desligar, já não entregavam nada,
// nem a leitura inicial; e a releitura do canal só entrega a mais nova. Por
// isso ficam fora da lista acima, com as provas que valem para elas.
type TeacherCase = {
  name: string;
  subscribe: (callback: (value: unknown) => void, onError: (error: Error) => void) => Subscription;
  table: string;
  answer: (id: string) => unknown;
};

const teacherCases: TeacherCase[] = [
  {
    name: "subscribeToTeacherPayoutLedger",
    subscribe: (callback, onError) => subscribeToTeacherPayoutLedger("t-1", callback as never, onError),
    table: "payout_ledger",
    answer: (id) => [{ id, teacher_id: "t-1", course_id: "c-1", order_id: id, currency: "USD", status: "settled" }],
  },
  {
    name: "subscribeToTeacherCourseSubscriptions",
    subscribe: (callback, onError) => subscribeToTeacherCourseSubscriptions("t-1", callback as never, onError),
    table: "course_subscriptions",
    answer: (id) => [{ id, user_id: "u-1", teacher_id: "t-1", course_id: "c-1", status: "active" }],
  },
];

// A consulta de main, chamada por chamada (a primeira página de 500).
const teacherQuery = (table: string) => [
  ["from", table], ["select", "*"], ["eq", "teacher_id", "t-1"],
  ["order", "created_at", { ascending: true }], ["order", "id", { ascending: true }], ["range", 0, 499],
];

async function startTeacher(item: TeacherCase) {
  fake.reads = [];
  fake.channels = [];
  fake.removeChannel.mockClear();
  const callback = vi.fn();
  const onError = vi.fn();
  const subscription = item.subscribe(callback, onError);
  await reads(1);
  fake.reads[0].answer({ data: null, error: new Error("offline") });
  await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
  return { callback, onError, subscription };
}

describe("reload() das leituras do professor (Ganhos e Assinaturas)", () => {
  it.each(teacherCases)("$name: o reload repete a mesma consulta, no mesmo canal, e entrega uma vez", async (item) => {
    const { callback, onError, subscription } = await startTeacher(item);
    expect(fake.reads[0].query).toEqual(teacherQuery(item.table));
    expect(fake.channels).toHaveLength(1);
    expect(fake.channels[0]).toMatchObject({
      name: `${item.table}:teacher:t-1`,
      kind: "postgres_changes",
      filter: { event: "*", schema: "public", table: item.table, filter: "teacher_id=eq.t-1" },
    });

    const retry = subscription.reload();
    await reads(2);
    expect(fake.reads[1].query).toEqual(teacherQuery(item.table));
    fake.reads[1].answer({ data: item.answer("de-novo"), error: null });
    await expect(retry).resolves.toBeUndefined();
    expect(callback).toHaveBeenCalledOnce();
    expect((callback.mock.calls[0][0] as Array<{ id: string }>).map((row) => row.id)).toEqual(["de-novo"]);
    expect(onError).toHaveBeenCalledOnce();
    expect(fake.channels).toHaveLength(1);
    expect(fake.removeChannel).not.toHaveBeenCalled();
  });

  it.each(teacherCases)("$name: o reload depois de desligar não entrega nada", async (item) => {
    const { callback, onError, subscription } = await startTeacher(item);
    subscription();
    const retry = subscription.reload();
    await reads(2);
    fake.reads[1].answer({ data: item.answer("tarde"), error: null });
    await expect(retry).resolves.toBeUndefined();
    expect(callback).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(fake.removeChannel).toHaveBeenCalledOnce();
  });
});
