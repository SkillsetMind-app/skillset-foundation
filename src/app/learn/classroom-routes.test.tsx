import { describe, expect, it, vi } from "vitest";

import { platformNav } from "@/data/site";

/**
 * Reanalysis item 9 — the tab routes and the "go and come back" rule:
 *   - /learn/courses/<course>/<tab> only accepts known tab names;
 *   - /learn/community/<course> and /learn/community/creator?courseId= were the
 *     second face of the community (a separate hub, with no way back): now they
 *     redirect to the classroom tab;
 *   - nothing in the app itself opens in a new tab (external links only).
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
import PostRoute from "@/app/learn/courses/[slug]/community/q/[postId]/page";
import CommunityRedirect from "@/app/learn/community/[slug]/page";
import CreatorCommunityRedirect from "@/app/learn/community/creator/page";

describe("tab route: /learn/courses/<course>/<tab>", () => {
  it("opens the classroom page on the requested tab", async () => {
    const element = await TabRoute({
      params: Promise.resolve({ slug: "lideranca", tab: "community" }),
    });

    expect(element.props).toMatchObject({ slug: "lideranca", tab: "community" });
  });

  it("the question drawer has its own address inside the Community tab", async () => {
    const element = await PostRoute({
      params: Promise.resolve({ slug: "lideranca", postId: "post-1" }),
    });

    expect(element.props).toMatchObject({ slug: "lideranca", tab: "community", openPostId: "post-1" });
  });

  it("an unknown name is a 404, and so is '/lesson', because the lesson is the parent route", async () => {
    await expect(
      TabRoute({ params: Promise.resolve({ slug: "lideranca", tab: "banana" }) }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      TabRoute({ params: Promise.resolve({ slug: "lideranca", tab: "lesson" }) }),
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("the community has a single face: the old addresses redirect to the tab", () => {
  it("/learn/community/<course> -> /learn/courses/<course>/community", async () => {
    await expect(
      CommunityRedirect({ params: Promise.resolve({ slug: "lideranca" }) }),
    ).rejects.toThrow("REDIRECT:/learn/courses/lideranca/community");
  });

  it("/learn/community/creator?courseId=<id> -> /learn/courses/<id>/community", async () => {
    await expect(
      CreatorCommunityRedirect({ searchParams: Promise.resolve({ courseId: "course-1" }) }),
    ).rejects.toThrow("REDIRECT:/learn/courses/course-1/community");
  });

  it("with no courseId there is nowhere to go: back to the list of communities", async () => {
    await expect(
      CreatorCommunityRedirect({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/learn/community");
  });
});

describe("nothing in the app itself opens in a new tab", () => {
  // The `newTab` option is gone from the navigation: switching between learner
  // and teacher is the button at the top, in the same tab (platform-header).
  it("no navigation item opens in a new tab", () => {
    for (const item of platformNav) {
      expect(item, `${item.labelKey}`).not.toHaveProperty("newTab");
    }
  });
});
