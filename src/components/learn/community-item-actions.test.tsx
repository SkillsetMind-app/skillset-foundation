import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CommunityItemActions } from "@/components/learn/community-item-actions";
import type { SkillsetUser } from "@/domain/auth";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import {
  createCommunityReport,
  deleteCommunityComment,
  deleteCommunityPost,
  setCommunityPostPinned,
} from "@/lib/data/community-posts";

/**
 * Moderar a comunidade: quem ve cada botao e o que cada um faz.
 *   autor -> Apagar · dono do curso -> Fixar/Desafixar e Apagar ·
 *   outro membro -> Denunciar · sem login -> nada.
 * Apagar pede confirmacao; Denunciar abre um formulario no lugar.
 */

// O I18nProvider chama useRouter() para o refresh ao trocar de idioma.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

vi.mock("@/lib/data/community-posts", () => ({
  createCommunityReport: vi.fn(() => Promise.resolve()),
  deleteCommunityComment: vi.fn(() => Promise.resolve()),
  deleteCommunityPost: vi.fn(() => Promise.resolve()),
  setCommunityPostPinned: vi.fn(() => Promise.resolve()),
}));

function user(uid: string, displayName: string): SkillsetUser {
  return { uid, email: `${uid}@example.test`, emailVerified: true, displayName, photoURL: null, roles: ["student"] };
}

const author = user("student-2", "Carla Souza");
const owner = user("teacher-1", "Patrick S.");
const member = user("student-3", "Lucas Melo");

const post: CommunityPost = {
  id: "p-1",
  courseSlug: "course-1",
  authorId: author.uid,
  authorName: author.displayName ?? "",
  authorRole: "student",
  category: "discussion",
  body: "Synthetic post.",
  pinned: true,
};

const reply: CommunityComment = {
  id: "c-1",
  postId: "p-1",
  courseSlug: "course-1",
  authorId: "student-4",
  authorName: "Marcos Lima",
  authorRole: "student",
  body: "Synthetic reply.",
};

function show(props: Partial<Parameters<typeof CommunityItemActions>[0]>, locale: "en" | "es" = "en") {
  return render(
    <I18nProvider initialLocale={locale}>
      <div data-testid="actions">
        <CommunityItemActions post={post} currentUser={member} canModerate={false} {...props} />
      </div>
    </I18nProvider>,
  );
}

function buttonNames() {
  return within(screen.getByTestId("actions")).queryAllByRole("button").map((button) => button.textContent);
}

describe("acoes de moderacao da comunidade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it.each([
    ["the author", { currentUser: author }, ["Delete"]],
    ["the course owner", { currentUser: owner, canModerate: true }, ["Unpin", "Delete"]],
    ["another member", { currentUser: member }, ["Report"]],
    ["a signed-out visitor", { currentUser: null }, []],
  ] as const)("on a post, %s sees exactly %j", (_who, props, names) => {
    show(props);
    expect(buttonNames()).toEqual(names);
  });

  it.each([
    ["the author of the reply", { currentUser: user("student-4", "Marcos Lima") }, ["Delete"]],
    ["the course owner (no pin on a reply)", { currentUser: owner, canModerate: true }, ["Delete"]],
    ["the author of the post", { currentUser: author }, ["Report"]],
  ] as const)("on a reply, %s sees exactly %j", (_who, props, names) => {
    show({ comment: reply, ...props });
    expect(buttonNames()).toEqual(names);
  });

  it("the owner unpins with the same write the database already allowed", () => {
    show({ currentUser: owner, canModerate: true });
    fireEvent.click(screen.getByRole("button", { name: "Unpin" }));
    expect(setCommunityPostPinned).toHaveBeenCalledExactlyOnceWith("p-1", false);
  });

  it("delete asks first: 'Keep it' changes nothing, 'Yes, delete' deletes and hides", async () => {
    const onDeleted = vi.fn();
    show({ currentUser: owner, canModerate: true, onDeleted });

    const open = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");
    const confirm = screen.getByRole("group", { name: "Delete this post for everyone? Its replies go too." });
    fireEvent.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(deleteCommunityPost).not.toHaveBeenCalled();

    fireEvent.click(open);
    const yes = screen.getByRole("button", { name: "Yes, delete" });
    expect(yes).toHaveClass("button-danger", "min-h-11");
    await act(async () => { fireEvent.click(yes); });

    expect(deleteCommunityPost).toHaveBeenCalledExactlyOnceWith("p-1");
    expect(deleteCommunityComment).not.toHaveBeenCalled();
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("deleting a reply says its replies go too and deletes only that reply", async () => {
    const onDeleted = vi.fn();
    show({ comment: reply, currentUser: owner, canModerate: true, onDeleted });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("group", { name: "Delete this reply for everyone? Replies to it go too." })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, delete" })); });

    expect(deleteCommunityComment).toHaveBeenCalledExactlyOnceWith("c-1");
    expect(deleteCommunityPost).not.toHaveBeenCalled();
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("a refused delete stays on screen with a plain error, in the person's language", async () => {
    vi.mocked(deleteCommunityPost).mockRejectedValueOnce(new Error("community_delete_refused"));
    const onDeleted = vi.fn();
    show({ currentUser: author, onDeleted }, "es");

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sí, eliminar" })); });

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos eliminarlo. Inténtalo de nuevo.");
    expect(screen.queryByText("community_delete_refused")).toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("report sends the reason and the note, then thanks and hides the button", async () => {
    show({ currentUser: member });

    const open = screen.getByRole("button", { name: "Report" });
    fireEvent.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");
    const form = screen.getByRole("form", { name: "Report this post" });
    const reason = within(form).getByRole("combobox", { name: "Reason" });
    const note = within(form).getByRole("textbox", { name: "Anything else? (optional)" });
    // Campo com 16px no celular (sem zoom do iPhone).
    expect(reason).toHaveClass("field-input");
    expect(note).toHaveClass("field-input");
    expect(note).toHaveAttribute("maxlength", "500");
    expect(within(reason).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Spam or selling",
      "Insults or harassment",
      "Dangerous or explicit content",
      "Off-topic",
      "Something else",
    ]);

    fireEvent.change(reason, { target: { value: "harassment" } });
    fireEvent.change(note, { target: { value: "  Insulted another member.  " } });
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Send report" })); });

    expect(createCommunityReport).toHaveBeenCalledExactlyOnceWith({
      courseSlug: "course-1",
      postId: "p-1",
      commentId: null,
      targetType: "post",
      targetAuthorId: "student-2",
      targetAuthorName: "Carla Souza",
      reason: "harassment",
      detail: "Insulted another member.",
      user: member,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Thanks. Our team will review it.");
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("reporting a reply targets the reply and its author", async () => {
    show({ comment: reply, currentUser: member }, "es");

    fireEvent.click(screen.getByRole("button", { name: "Denunciar" }));
    const form = screen.getByRole("form", { name: "Denunciar esta respuesta" });
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Enviar denuncia" })); });

    expect(createCommunityReport).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      postId: "p-1",
      commentId: "c-1",
      targetType: "comment",
      targetAuthorId: "student-4",
      targetAuthorName: "Marcos Lima",
      reason: "spam",
      detail: null,
    }));
    expect(screen.getByRole("status")).toHaveTextContent("Gracias. Nuestro equipo lo revisará.");
  });

  it("a failed report keeps the form and says so", async () => {
    vi.mocked(createCommunityReport).mockRejectedValueOnce(new Error("internal detail"));
    show({ currentUser: member });

    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send report" })); });

    expect(screen.getByRole("alert")).toHaveTextContent("We could not send your report. Try again.");
    expect(screen.getByRole("form", { name: "Report this post" })).toBeInTheDocument();
    expect(screen.queryByText("internal detail")).toBeNull();
  });
});
