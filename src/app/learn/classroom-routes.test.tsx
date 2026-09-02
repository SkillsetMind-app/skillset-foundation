import { describe, expect, it, vi } from "vitest";

import { platformNav } from "@/data/site";

/**
 * Reanalise item 9 — as rotas das abas e a regra "ir e voltar":
 *   - /learn/courses/<curso>/<aba> so aceita nomes de aba conhecidos;
 *   - /learn/community/<curso> e /learn/community/creator?courseId= eram a
 *     segunda cara da comunidade (hub separado, sem volta): agora encaminham
 *     para a aba da sala;
 *   - nada do proprio app abre em nova aba (so link externo).
 */

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));

vi.mock("@/components/learn/learn-course-page", () => ({
  LearnCoursePage: ({ slug, tab }: { slug: string; tab: string }) => (
    <div data-slug={slug} data-tab={tab} />
  ),
}));

import TabRoute from "@/app/learn/courses/[slug]/[tab]/page";
import CommunityRedirect from "@/app/learn/community/[slug]/page";
import CreatorCommunityRedirect from "@/app/learn/community/creator/page";

describe("rota da aba: /learn/courses/<curso>/<aba>", () => {
  it("abre a pagina da sala na aba pedida", async () => {
    const element = await TabRoute({
      params: Promise.resolve({ slug: "lideranca", tab: "community" }),
    });

    expect(element.props).toMatchObject({ slug: "lideranca", tab: "community" });
  });

  it("nome desconhecido e 404 — e '/lesson' tambem, porque a aula e a rota-mae", async () => {
    await expect(
      TabRoute({ params: Promise.resolve({ slug: "lideranca", tab: "banana" }) }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      TabRoute({ params: Promise.resolve({ slug: "lideranca", tab: "lesson" }) }),
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("a comunidade tem uma cara so: os enderecos antigos encaminham para a aba", () => {
  it("/learn/community/<curso> -> /learn/courses/<curso>/community", async () => {
    await expect(
      CommunityRedirect({ params: Promise.resolve({ slug: "lideranca" }) }),
    ).rejects.toThrow("REDIRECT:/learn/courses/lideranca/community");
  });

  it("/learn/community/creator?courseId=<id> -> /learn/courses/<id>/community", async () => {
    await expect(
      CreatorCommunityRedirect({ searchParams: Promise.resolve({ courseId: "course-1" }) }),
    ).rejects.toThrow("REDIRECT:/learn/courses/course-1/community");
  });

  it("sem courseId nao ha para onde ir: volta a lista de comunidades", async () => {
    await expect(
      CreatorCommunityRedirect({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/learn/community");
  });
});

describe("nada do proprio app abre em nova aba", () => {
  it("todo item da navegacao com newTab e um link externo", () => {
    const newTab = platformNav.filter((item) => item.newTab);

    for (const item of newTab) {
      expect(item.href, `${item.labelKey} abre em nova aba`).toMatch(/^https?:\/\//);
    }
  });

  it("'My courses' no estudio do professor abre na mesma aba", () => {
    const myCourses = platformNav.find(
      (item) => item.href === "/learn" && item.contexts.includes("teacher"),
    );

    expect(myCourses).toBeDefined();
    expect(myCourses?.newTab).toBeFalsy();
  });
});
