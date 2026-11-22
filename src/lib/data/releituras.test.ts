import { describe, expect, it, vi } from "vitest";

// O "Try again" das telas do aluno e do site relê pela MESMA inscrição
// (`reload()`), sem sair e entrar de novo no Realtime. Para cada função:
//  - a releitura repete a leitura inicial e não abre canal novo;
//  - respostas fora de ordem: só a leitura mais nova entrega;
//  - desligada, uma leitura que ainda volte não entrega nada.

type Answer = { data: unknown; error: Error | null };

const fake = vi.hoisted(() => ({
  reads: [] as Array<(answer: Answer) => void>,
  channels: 0,
  removeChannel: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => {
    // Consulta encadeável; ao ser aguardada, vira uma leitura pendente que o
    // teste responde na ordem que quiser.
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit", "maybeSingle"]) {
      query[method] = () => query;
    }
    query.then = (resolve: (answer: Answer) => unknown) =>
      new Promise<Answer>((settle) => fake.reads.push(settle)).then(resolve);
    const channel = {
      on: () => channel,
      subscribe: () => channel,
    };
    return {
      from: () => query,
      channel: () => {
        fake.channels += 1;
        return channel;
      },
      removeChannel: fake.removeChannel,
      auth: { getSession: () => Promise.resolve({ data: { session: { user: {} } } }) },
    };
  },
}));

const { subscribeToUserWishlist } = await import("@/lib/data/wishlist");
const { subscribeToPublishedTeacherCourses } = await import("@/lib/data/published-courses");
const { subscribeToCourseSubscription } = await import("@/lib/data/course-subscriptions");
const { subscribeToCommunityPosts } = await import("@/lib/data/community-posts");
const { subscribeToEnrollment } = await import("@/lib/data/enrollments");
const { subscribeToCompletedLessons } = await import("@/lib/data/lesson-progress");
const { subscribeToUserCertificates } = await import("@/lib/data/certificates");
const { subscribeToCourseEvents } = await import("@/lib/data/course-events");

type Subscribe = (
  callback: (value: unknown) => void,
  onError: (error: Error) => void,
) => (() => void) & { reload: () => Promise<void> };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// `answer(id)` monta a resposta do banco com aquela linha; `idOf` lê o id do
// que a função entregou, para saber QUAL leitura chegou.
const cases: Array<{
  name: string;
  subscribe: Subscribe;
  answer: (id: string) => unknown;
  idOf: (value: unknown) => string;
}> = [
  {
    name: "subscribeToUserWishlist",
    subscribe: (callback, onError) => subscribeToUserWishlist("u-1", callback as never, onError),
    answer: (id) => [{ id, user_id: "u-1", course_id: id, course_slug: id, created_at: "2026-11-22T10:00:00Z", updated_at: null }],
    idOf: (value) => (value as Array<{ id: string }>)[0].id,
  },
  {
    name: "subscribeToPublishedTeacherCourses",
    subscribe: (callback, onError) => subscribeToPublishedTeacherCourses(callback as never, onError),
    answer: (id) => [{ id, owner_id: "t-1", title: id, summary: "", category: "", status: "published", modules: [] }],
    idOf: (value) => (value as Array<{ id: string }>)[0].id,
  },
  {
    name: "subscribeToCourseSubscription",
    subscribe: (callback, onError) => subscribeToCourseSubscription("sub-1", callback as never, onError),
    answer: (id) => ({ id, user_id: "u-1", course_id: "c-1", status: "active" }),
    idOf: (value) => (value as { id: string }).id,
  },
  {
    name: "subscribeToCommunityPosts",
    subscribe: (callback, onError) => subscribeToCommunityPosts("course-1", callback as never, onError),
    answer: (id) => [{ id, course_slug: "course-1", author_id: "a-1", author_name: "Ana", body: "", created_at: "2026-11-22T10:00:00Z" }],
    idOf: (value) => (value as Array<{ id: string }>)[0].id,
  },
  {
    name: "subscribeToEnrollment",
    subscribe: (callback, onError) => subscribeToEnrollment("u-1", "course-1", callback as never, onError),
    answer: (id) => ({ id, user_id: "u-1", course_id: "c-1", course_slug: "course-1", course_title: "Curso" }),
    idOf: (value) => (value as { id: string }).id,
  },
  {
    name: "subscribeToCompletedLessons",
    subscribe: (callback, onError) => subscribeToCompletedLessons("enr-1", callback as never, onError),
    answer: (id) => [{ lesson_id: id }],
    idOf: (value) => (value as string[])[0],
  },
  {
    name: "subscribeToUserCertificates",
    subscribe: (callback, onError) => subscribeToUserCertificates("u-1", callback as never, onError),
    answer: (id) => [{ id, enrollment_id: id, user_id: "u-1", status: "issued" }],
    idOf: (value) => (value as Array<{ id: string }>)[0].id,
  },
  {
    name: "subscribeToCourseEvents",
    subscribe: (callback, onError) => subscribeToCourseEvents("course-1", callback as never, onError),
    answer: (id) => [{ id, course_slug: "course-1", status: "scheduled", starts_at: "2026-12-01T10:00:00Z", title: id }],
    idOf: (value) => (value as Array<{ id: string }>)[0].id,
  },
];

describe("reload() das inscrições do aluno e do site", () => {
  it.each(cases)("$name: relê sem canal novo, só a mais nova entrega, nada depois de desligar", async ({ subscribe, answer, idOf }) => {
    fake.reads = [];
    fake.channels = 0;
    fake.removeChannel.mockClear();
    const callback = vi.fn();
    const onError = vi.fn();
    const subscription = subscribe(callback, onError);
    await settle();
    const channels = fake.channels;

    // 1a leitura falha: a tela mostra o erro com "Try again".
    fake.reads[0]({ data: null, error: new Error("offline") });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());

    // Dois "Try again" seguidos: a mesma leitura, sem canal novo.
    void subscription.reload();
    void subscription.reload();
    await vi.waitFor(() => expect(fake.reads).toHaveLength(3));
    expect(fake.channels).toBe(channels);
    expect(fake.removeChannel).not.toHaveBeenCalled();

    // A mais nova volta primeiro; a velha, depois, é descartada.
    fake.reads[2]({ data: answer("nova"), error: null });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    fake.reads[1]({ data: answer("velha"), error: null });
    await settle();
    expect(callback).toHaveBeenCalledOnce();
    expect(idOf(callback.mock.calls[0][0])).toBe("nova");
    expect(onError).toHaveBeenCalledOnce();

    // Desligada, uma releitura que ainda volte não entrega nada.
    void subscription.reload();
    await vi.waitFor(() => expect(fake.reads).toHaveLength(4));
    subscription();
    fake.reads[3]({ data: answer("tarde"), error: null });
    await settle();
    expect(callback).toHaveBeenCalledOnce();
    expect(fake.removeChannel).toHaveBeenCalledOnce();
  });
});
