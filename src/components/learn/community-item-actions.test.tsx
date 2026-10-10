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

  it("the owner unpins with the same write the database already allowed", async () => {
    show({ currentUser: owner, canModerate: true });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Unpin" })); });
    expect(setCommunityPostPinned).toHaveBeenCalledExactlyOnceWith("p-1", false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["en", "Unpin", "We could not change the pin. Try again."],
    ["es", "Desfijar", "No pudimos cambiar el fijado. Inténtalo de nuevo."],
  ] as const)("a refused pin says so instead of failing silently (%s)", async (locale, unpin, message) => {
    // 0 linhas (RLS) vira erro em setCommunityPostPinned; a tela mostra.
    vi.mocked(setCommunityPostPinned).mockRejectedValueOnce(new Error("community_pin_refused"));
    show({ currentUser: owner, canModerate: true }, locale);

    const button = screen.getByRole("button", { name: unpin });
    await act(async () => { fireEvent.click(button); });

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("community_pin_refused")).toBeNull();
    expect(button).toHaveAttribute("aria-disabled", "false");
  });

  it("a second click while the pin is saving does not write twice", async () => {
    let finish!: () => void;
    vi.mocked(setCommunityPostPinned).mockReturnValueOnce(new Promise<void>((done) => { finish = done; }));
    show({ currentUser: owner, canModerate: true });

    const button = screen.getByRole("button", { name: "Unpin" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    await act(async () => { finish(); });

    expect(setCommunityPostPinned).toHaveBeenCalledTimes(1);
  });

  it("the delete confirmation takes the focus, and Escape closes only it", () => {
    // A gaveta em volta tambem fecha com Esc (ouve no document).
    const drawerEscape = vi.fn();
    document.addEventListener("keydown", drawerEscape);
    try {
      show({ currentUser: owner, canModerate: true });
      const open = screen.getByRole("button", { name: "Delete" });
      fireEvent.click(open);

      const keep = screen.getByRole("button", { name: "Keep it" });
      expect(keep).toHaveFocus();
      fireEvent.keyDown(keep, { key: "Escape" });

      expect(screen.queryByRole("group")).toBeNull();
      expect(open).toHaveFocus();
      expect(open).toHaveAttribute("aria-expanded", "false");
      expect(drawerEscape).not.toHaveBeenCalled();
      expect(deleteCommunityPost).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", drawerEscape);
    }
  });

  it("'Cancel' and Escape on the report form give the focus back to the button that opened it", () => {
    show({ currentUser: member });
    const open = screen.getByRole("button", { name: "Report" });

    fireEvent.click(open);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(open).toHaveFocus();

    fireEvent.click(open);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Reason" }), { key: "Escape" });
    expect(screen.queryByRole("form")).toBeNull();
    expect(open).toHaveFocus();
  });

  it.each([
    ["the next item", true, "Next post"],
    ["the list heading when it was the last item", false, "Community"],
  ] as const)("after deleting, the focus goes to %s", async (_label, withNext, focused) => {
    render(
      <I18nProvider initialLocale="en">
        <h2 data-community-heading tabIndex={-1}>Community</h2>
        <article data-community-item>
          <CommunityItemActions post={post} currentUser={owner} canModerate />
        </article>
        {withNext ? (
          <article data-community-item>
            <button type="button">Next post</button>
          </article>
        ) : null}
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, delete" })); });

    expect(deleteCommunityPost).toHaveBeenCalledExactlyOnceWith("p-1");
    expect(document.activeElement).toHaveTextContent(focused);
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

  it.each([
    ["en", "Report", "Send report", "You sent a lot of reports in the last hour. Wait a little and try again."],
    ["es", "Denunciar", "Enviar denuncia", "Enviaste muchas denuncias en la última hora. Espera un poco y vuelve a intentarlo."],
  ] as const)("the report limit has its own words, not 'you posted a lot' (%s)", async (locale, report, send, message) => {
    vi.mocked(createCommunityReport).mockRejectedValueOnce({ code: "P0001", message: "RATE_LIMIT" });
    show({ currentUser: member }, locale);

    fireEvent.click(screen.getByRole("button", { name: report }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: send })); });

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/posted|Publicaste/);
  });

  it.each([
    ["en", "Report", "Send report", "You already reported this. Our team will review it."],
    ["es", "Denunciar", "Enviar denuncia", "Ya lo denunciaste. Nuestro equipo lo revisará."],
  ] as const)("reporting the same thing again is a friendly note, not an error (%s)", async (locale, report, send, message) => {
    // O banco recusa a segunda denuncia aberta do mesmo alvo.
    vi.mocked(createCommunityReport).mockRejectedValueOnce({ code: "23505", message: "COMMUNITY_REPORT_DUPLICATE" });
    show({ currentUser: member }, locale);

    fireEvent.click(screen.getByRole("button", { name: report }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: send })); });

    expect(screen.getByRole("status")).toHaveTextContent(message);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("button", { name: report })).toBeNull();
  });
});
