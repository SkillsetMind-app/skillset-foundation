import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoleManager } from "@/components/admin/role-manager";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CONFIRM_GUARD_MS } from "@/components/ui/confirm-dialog";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { allPermissionDefinitions } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  listPlatformUsers: vi.fn(),
  setUserRoles: vi.fn(),
}));

vi.mock("@/lib/data/platform-roles", () => ({
  listPlatformUsers: mocks.listPlatformUsers,
  setUserRoles: mocks.setUserRoles,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

function translatedRoster() {
  return <I18nProvider initialLocale="en"><ChangeLanguage /><RoleManager /></I18nProvider>;
}

// Mudar o nível admin pergunta na janela da plataforma (não mais no
// window.confirm). O jsdom não tem showModal/close: o stub faz o mínimo que o
// navegador faz. Só o Date é falso: o confirmar ignora cliques nos primeiros
// CONFIRM_GUARD_MS (toque duplo), e os setTimeout reais servem o findBy.
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

// Responde a pergunta aberta, depois da trava do toque duplo.
function answer(button: string) {
  const dialog = screen.getByRole("dialog");
  vi.advanceTimersByTime(CONFIRM_GUARD_MS);
  fireEvent.click(within(dialog).getByRole("button", { name: button }));
}

function roster(roles: string[]) {
  return [
    {
      uid: "u-1",
      email: "person@example.com",
      displayName: "Test Person",
      roles,
      verificationStatus: null,
      createdAt: "2026-01-01",
    },
  ];
}

describe("RoleManager", () => {
  // As três trocam de painel: são as abas únicas da plataforma (I-18), não
  // caixas com aria-pressed.
  it("switches panels with the platform tabs", () => {
    mocks.listPlatformUsers.mockResolvedValue([]);
    render(translatedRoster());
    expect(screen.getByRole("tablist", { name: "Access sections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "People" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "What each level can do" }));
    expect(screen.getByRole("tab", { name: "What each level can do" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "People" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("button", { name: "People" })).toBeNull();
  });

  it("retries a failed roster read with the current search without writing roles", async () => {
    mocks.listPlatformUsers.mockReset().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Private roster detail"));
    render(translatedRoster());
    await screen.findByText("No one matches that search.");
    fireEvent.change(screen.getByRole("searchbox", { name: "Find someone" }), { target: { value: "Test Person" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the roster.");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    const retry = translate(getDictionary("es"), "authFlow.loading.retry");
    let finish!: (people: ReturnType<typeof roster>) => void;
    mocks.listPlatformUsers.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: retry }));
    expect(mocks.listPlatformUsers).toHaveBeenLastCalledWith("Test Person");
    expect(screen.getByRole("status")).toHaveTextContent(translate(getDictionary("es"), "platform.ops.accessPanel.loading"));
    expect(screen.getByRole("searchbox", { name: "Buscar a una persona" })).toHaveValue("Test Person");
    await act(async () => finish(roster(["student"])));
    expect(await screen.findByText("Test Person")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.listPlatformUsers).toHaveBeenCalledTimes(3);
    expect(mocks.setUserRoles).not.toHaveBeenCalled();
  });

  it("does not attach a failed roster read to the independent permission matrix", async () => {
    mocks.listPlatformUsers.mockRejectedValue(new Error("Private roster detail"));
    render(translatedRoster());
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("tab", { name: "What each level can do" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: translate(getDictionary("en"), "authFlow.loading.retry") })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "People" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load the roster.");
    expect(mocks.listPlatformUsers).toHaveBeenCalledTimes(1);
    expect(mocks.setUserRoles).not.toHaveBeenCalled();
  });

  it("writes all three staff roles when Team is switched on", async () => {
    // Team is one checkbox over three roles. If the mapping ever collapses to a
    // single role, this user silently loses two thirds of their access.
    mocks.listPlatformUsers.mockResolvedValue(roster(["student"]));
    mocks.setUserRoles.mockResolvedValue(["moderator", "ops", "student", "support"]);

    render(<RoleManager />);

    const team = await screen.findByLabelText("Team");
    fireEvent.click(team);
    answer("Add to Team");

    await waitFor(() => expect(mocks.setUserRoles).toHaveBeenCalledTimes(1));
    const [uid, nextRoles] = mocks.setUserRoles.mock.calls[0];
    expect(uid).toBe("u-1");
    expect([...nextRoles].sort()).toEqual([
      "moderator",
      "ops",
      "student",
      "support",
    ]);
  });

  it("asks before granting admin and writes nothing when the operator cancels", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    mocks.listPlatformUsers.mockResolvedValue(roster(["student"]));
    render(translatedRoster());

    fireEvent.click(await screen.findByLabelText("Admin"));

    // (a) a frase de sempre, agora na janela da plataforma;
    const dialog = screen.getByRole("dialog", { name: "Make this person an administrator?" });
    expect(dialog).toHaveTextContent("Make Test Person an administrator? Admins can change anyone's access, issue refunds and see every account.");
    expect(nativeConfirm).not.toHaveBeenCalled();
    // (b) desistir não grava nada.
    answer("Cancel");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.setUserRoles).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Admin")).not.toBeChecked();
  });

  it("grants admin only after the operator confirms, once, over the roles current at confirmation", async () => {
    mocks.listPlatformUsers.mockResolvedValue(roster(["student"]));
    mocks.setUserRoles.mockResolvedValue(["student", "teacher", "admin"]);
    render(translatedRoster());

    fireEvent.click(await screen.findByLabelText("Admin"));

    const dialog = screen.getByRole("dialog", { name: "Make this person an administrator?" });
    expect(mocks.setUserRoles).not.toHaveBeenCalled();
    // Um clique colado na abertura (toque duplo) é descartado.
    fireEvent.click(within(dialog).getByRole("button", { name: "Make administrator" }));
    expect(mocks.setUserRoles).not.toHaveBeenCalled();
    // Com a pergunta aberta, a busca com atraso traz papéis mais novos (alguém
    // virou instrutor). Gravar os do clique apagaria essa mudança.
    mocks.listPlatformUsers.mockResolvedValue(roster(["student", "teacher"]));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find someone" }), { target: { value: "Test" } });
    await waitFor(() => expect(mocks.listPlatformUsers).toHaveBeenLastCalledWith("Test"));
    await waitFor(() => expect(screen.getByLabelText("Instructor")).toBeChecked());
    // (c) confirmar grava uma vez: o admin entra sobre os papéis de agora.
    answer("Make administrator");
    fireEvent.click(within(dialog).getByRole("button", { name: "Make administrator" }));
    expect(mocks.setUserRoles).toHaveBeenCalledExactlyOnceWith("u-1", ["student", "teacher", "admin"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByLabelText("Admin")).toBeChecked();
  });

  it("writes nothing when the person left the list while the question was open", async () => {
    mocks.listPlatformUsers.mockResolvedValue(roster(["student"]));
    render(translatedRoster());

    fireEvent.click(await screen.findByLabelText("Admin"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    mocks.listPlatformUsers.mockResolvedValue([]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find someone" }), { target: { value: "Someone else" } });
    expect(await screen.findByText("No one matches that search.")).toBeInTheDocument();

    answer("Make administrator");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.setUserRoles).not.toHaveBeenCalled();
  });

  it("asks before removing admin, in the operator's language", async () => {
    mocks.listPlatformUsers.mockResolvedValue(roster(["admin"]));
    render(translatedRoster());
    await screen.findByLabelText("Admin");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));

    fireEvent.click(screen.getByLabelText("Administrador"));

    expect(screen.getByRole("dialog", { name: "¿Quitar el acceso de administrador?" }))
      .toHaveTextContent("¿Quitar el acceso de administrador a Test Person?");
    answer("Cancelar");
    expect(mocks.setUserRoles).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Administrador")).toBeChecked();
  });

  it("removes admin after the operator confirms, keeping the other roles", async () => {
    mocks.listPlatformUsers.mockResolvedValue(roster(["teacher", "admin"]));
    mocks.setUserRoles.mockResolvedValue(["teacher"]);
    render(translatedRoster());

    fireEvent.click(await screen.findByLabelText("Admin"));
    answer("Remove administrator");

    expect(mocks.setUserRoles).toHaveBeenCalledExactlyOnceWith("u-1", ["teacher"]);
    await waitFor(() => expect(screen.getByLabelText("Admin")).not.toBeChecked());
    expect(screen.getByLabelText("Instructor")).toBeChecked();
  });

  // Team abre reembolsos, moderação e o catálogo inteiro: dar Team pergunta,
  // como admin (I-04). A gravação é a mesma de antes, uma vez, só depois do sim.
  it("asks before adding someone to the Team and writes once, only after confirmation", async () => {
    mocks.listPlatformUsers.mockResolvedValue(roster(["student"]));
    mocks.setUserRoles.mockResolvedValue(["student", "support", "moderator", "ops"]);
    render(translatedRoster());

    fireEvent.click(await screen.findByLabelText("Team"));
    const dialog = screen.getByRole("dialog", { name: "Add this person to the Team?" });
    expect(dialog).toHaveTextContent("Add Test Person to the Team? Team members open the internal panel, answer support, issue refunds, moderate the community and can publish or take down any course.");
    answer("Cancel");
    expect(mocks.setUserRoles).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Team")).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    fireEvent.click(screen.getByLabelText("Equipo"));
    expect(screen.getByRole("dialog", { name: "¿Agregar a esta persona al Equipo?" }))
      .toHaveTextContent("¿Agregar a Test Person al Equipo?");
    answer("Agregar al Equipo");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Agregar al Equipo" }));
    expect(mocks.setUserRoles).toHaveBeenCalledExactlyOnceWith("u-1", ["student", "support", "moderator", "ops"]);
    await waitFor(() => expect(screen.getByLabelText("Equipo")).toBeChecked());
  });

  it("removes Team without asking, as before", async () => {
    mocks.listPlatformUsers.mockResolvedValue(roster(["student", "support", "moderator", "ops"]));
    mocks.setUserRoles.mockResolvedValue(["student"]);
    render(translatedRoster());

    fireEvent.click(await screen.findByLabelText("Team"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.setUserRoles).toHaveBeenCalledExactlyOnceWith("u-1", ["student"]);
  });

  // Gravar um nível dizia nada: as caixas só apagavam e voltavam (I-11). A
  // região viva do "Saved" fica sempre montada; só o texto entra e sai.
  it("says Saved next to the levels after a level change, in a reserved live slot", async () => {
    mocks.listPlatformUsers.mockResolvedValue(roster(["student"]));
    let finish!: (roles: string[]) => void;
    mocks.setUserRoles.mockReturnValue(new Promise<string[]>(resolve => { finish = resolve; }));
    render(translatedRoster());

    const instructor = await screen.findByLabelText("Instructor");
    const slot = instructor.closest("div")!.lastElementChild!;
    expect(slot).toHaveClass("min-w-[7rem]");
    expect(slot).toHaveAttribute("role", "status");
    expect(slot).toBeEmptyDOMElement();
    fireEvent.click(instructor);
    expect(slot).toBeEmptyDOMElement();
    await act(async () => finish(["student", "teacher"]));
    expect(instructor.closest("div")!.lastElementChild).toBe(slot);
    expect(slot).toHaveTextContent("Saved");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(slot).toHaveTextContent("Guardado");
  });

  // Um "Saved" velho ao lado das caixas dizia que a mudança desistida gravou.
  it("drops Saved on the next click, a cancelled question, a failed write and a new search", async () => {
    mocks.listPlatformUsers.mockResolvedValue(roster(["student"]));
    mocks.setUserRoles.mockResolvedValueOnce(["student", "teacher"]);
    render(translatedRoster());
    const slot = () => screen.getByLabelText("Instructor").closest("div")!.lastElementChild!;

    fireEvent.click(await screen.findByLabelText("Instructor"));
    await waitFor(() => expect(slot()).toHaveTextContent("Saved"));
    // Cancelar a pergunta do Team não deixa o "Saved" de antes.
    fireEvent.click(screen.getByLabelText("Team"));
    expect(slot()).toBeEmptyDOMElement();
    answer("Cancel");
    expect(slot()).toBeEmptyDOMElement();

    // Gravação recusada: o erro aparece e nenhum "Saved".
    mocks.setUserRoles.mockRejectedValueOnce({ message: "Private RPC schema detail" });
    fireEvent.click(screen.getByLabelText("Team"));
    answer("Add to Team");
    expect(await screen.findByRole("alert")).toHaveTextContent("That change was refused. Nothing was saved.");
    expect(slot()).toBeEmptyDOMElement();

    // Grava de novo e depois busca: a lista nova não herda o "Saved".
    mocks.setUserRoles.mockResolvedValueOnce(["student"]);
    fireEvent.click(screen.getByLabelText("Instructor"));
    await waitFor(() => expect(slot()).toHaveTextContent("Saved"));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find someone" }), { target: { value: "Test" } });
    expect(slot()).toBeEmptyDOMElement();
    expect(mocks.setUserRoles).toHaveBeenCalledTimes(3);
  });

  it("does not ask for levels below admin", async () => {
    mocks.listPlatformUsers.mockResolvedValue(roster(["student"]));
    mocks.setUserRoles.mockResolvedValue(["student", "teacher"]);
    render(translatedRoster());

    fireEvent.click(await screen.findByLabelText("Instructor"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.setUserRoles).toHaveBeenCalledWith("u-1", ["student", "teacher"]);
  });

  it("shows the database's own sentence when it refuses a change", async () => {
    // The last-admin and self-lockout guards live in SQL. Their wording is the
    // only thing that explains WHY a click did nothing, so it must reach the
    // screen instead of being swallowed by a generic failure message.
    mocks.listPlatformUsers.mockResolvedValue(roster(["admin"]));
    mocks.setUserRoles.mockRejectedValue(
      new Error("You cannot remove your own admin role."),
    );

    render(<RoleManager />);

    const admin = await screen.findByLabelText("Admin");
    fireEvent.click(admin);
    answer("Remove administrator");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You cannot remove your own admin role.");
  });

  it("keeps the search and checked roles across locale changes while a Team write is pending", async () => {
    const people = roster(["student"]);
    people[0].displayName = "Ana $$50 $& Álvarez";
    mocks.listPlatformUsers.mockResolvedValue(people);
    let finish!: (roles: string[]) => void;
    mocks.setUserRoles.mockReturnValue(new Promise<string[]>(resolve => { finish = resolve; }));
    render(translatedRoster());
    await screen.findByLabelText("Team");
    fireEvent.change(screen.getByRole("searchbox", { name: "Find someone" }), { target: { value: "Ana $$50 $&" } });
    await waitFor(() => expect(mocks.listPlatformUsers).toHaveBeenLastCalledWith("Ana $$50 $&"));
    const reads = mocks.listPlatformUsers.mock.calls.length;
    fireEvent.click(screen.getByLabelText("Team"));
    answer("Add to Team");
    expect(screen.getByLabelText("Team")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("searchbox", { name: "Buscar a una persona" })).toHaveValue("Ana $$50 $&");
    expect(screen.getByLabelText("Estudiante")).toBeChecked();
    expect(screen.getByLabelText("Equipo")).toBeDisabled();
    expect(screen.getByLabelText("Equipo")).not.toBeChecked();
    expect(screen.getByText("Ana $$50 $& Álvarez")).toBeInTheDocument();
    expect(mocks.setUserRoles).toHaveBeenCalledWith("u-1", ["student", "support", "moderator", "ops"]);
    await act(async () => finish(["student", "support", "moderator", "ops"]));
    expect(screen.getByLabelText("Equipo")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByLabelText("Team")).toBeChecked();
    expect(screen.getByLabelText("Learner")).toBeChecked();
    expect(mocks.listPlatformUsers).toHaveBeenCalledTimes(reads);
    expect(mocks.setUserRoles).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["You cannot remove your own admin role.", "No puedes quitarte tu propio rol de administrador."],
    ["The platform must keep at least one administrator.", "La plataforma debe conservar al menos un administrador."],
    ["Admin privileges are required.", "Se necesitan permisos de administrador."],
    ["That user does not exist.", "Ese usuario no existe."],
  ])("preserves the known refusal %s and translates it without changing roles", async (message, spanish) => {
    mocks.listPlatformUsers.mockResolvedValue(roster(["admin"]));
    // Supabase RPC errors are plain objects, not necessarily Error instances.
    mocks.setUserRoles.mockRejectedValue({ message, code: "42501" });
    render(translatedRoster());
    fireEvent.click(await screen.findByLabelText("Admin"));
    answer("Remove administrator");
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Admin")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent(spanish);
    expect(screen.getByLabelText("Administrador")).toBeChecked();
    expect(mocks.setUserRoles).toHaveBeenCalledTimes(1);
    expect(mocks.listPlatformUsers).toHaveBeenCalledTimes(1);
  });

  it("does not expose an internal write error or report a saved checkbox", async () => {
    mocks.listPlatformUsers.mockResolvedValue(roster(["student"]));
    mocks.setUserRoles.mockRejectedValue({ message: "Private RPC schema detail" });
    render(translatedRoster());
    fireEvent.click(await screen.findByLabelText("Team"));
    answer("Add to Team");
    expect(await screen.findByRole("alert")).toHaveTextContent("That change was refused. Nothing was saved.");
    expect(screen.getByLabelText("Team")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("El cambio fue rechazado. No se guardó nada.");
    expect(screen.queryByText("Private RPC schema detail")).toBeNull();
  });

  it("keeps a failed roster read distinct from an empty roster in both languages", async () => {
    mocks.listPlatformUsers.mockRejectedValue(new Error("Private roster detail"));
    render(translatedRoster());
    expect(screen.getByRole("status")).toHaveTextContent("Loading the roster");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the roster.");
    expect(screen.queryByText("No one matches that search.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cargar la lista de personas.");
    expect(screen.queryByText("Nadie coincide con esta búsqueda.")).toBeNull();
    expect(screen.queryByText("Private roster detail")).toBeNull();
    expect(mocks.listPlatformUsers).toHaveBeenCalledTimes(1);
  });

  it("keeps the current roster on screen, dimmed and busy, while a new search runs (I-12)", async () => {
    mocks.listPlatformUsers.mockResolvedValueOnce(roster(["student"]));
    render(translatedRoster());
    const list = (await screen.findByText("Test Person")).closest("ul")!;
    expect(list).not.toHaveAttribute("aria-busy");
    let finish!: (people: ReturnType<typeof roster>) => void;
    mocks.listPlatformUsers.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find someone" }), { target: { value: "Test" } });
    await waitFor(() => expect(mocks.listPlatformUsers).toHaveBeenLastCalledWith("Test"));
    expect(screen.getByText("Test Person").closest("ul")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Test Person").closest("ul")).toHaveClass("opacity-60");
    // A lista não vira a linha de "carregando" (as regiões do "Saved" ficam montadas e vazias).
    expect(screen.queryByText(/Loading the roster/)).toBeNull();
    await act(async () => finish(roster(["student"])));
    expect(screen.getByText("Test Person").closest("ul")).not.toHaveAttribute("aria-busy");
    expect(mocks.setUserRoles).not.toHaveBeenCalled();
  });

  it("ignores an older search answer that arrives after the newer one", async () => {
    mocks.listPlatformUsers.mockResolvedValueOnce([]);
    render(translatedRoster());
    await screen.findByText("No one matches that search.");
    let answerAn!: (people: ReturnType<typeof roster>) => void;
    let answerAna!: (people: ReturnType<typeof roster>) => void;
    mocks.listPlatformUsers
      .mockReturnValueOnce(new Promise(resolve => { answerAn = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { answerAna = resolve; }));
    const search = screen.getByRole("searchbox", { name: "Find someone" });
    fireEvent.change(search, { target: { value: "an" } });
    await waitFor(() => expect(mocks.listPlatformUsers).toHaveBeenLastCalledWith("an"));
    fireEvent.change(search, { target: { value: "ana" } });
    await waitFor(() => expect(mocks.listPlatformUsers).toHaveBeenLastCalledWith("ana"));
    await act(async () => answerAna([{ ...roster(["student"])[0], displayName: "Ana Nova" }]));
    expect(screen.getByText("Ana Nova").closest("ul")).not.toHaveAttribute("aria-busy");
    // A resposta velha de "an" chega depois e não troca a lista.
    await act(async () => answerAn([{ ...roster(["student"])[0], uid: "u-2", displayName: "Andre Velho" }]));
    expect(screen.getByText("Ana Nova")).toBeInTheDocument();
    expect(screen.queryByText("Andre Velho")).toBeNull();
  });

  it("keeps showing the search as running until the newest answer arrives", async () => {
    mocks.listPlatformUsers.mockResolvedValueOnce(roster(["student"]));
    render(translatedRoster());
    await screen.findByText("Test Person");
    let answerOld!: (people: ReturnType<typeof roster>) => void;
    let answerNew!: (people: ReturnType<typeof roster>) => void;
    mocks.listPlatformUsers
      .mockReturnValueOnce(new Promise(resolve => { answerOld = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { answerNew = resolve; }));
    const search = screen.getByRole("searchbox", { name: "Find someone" });
    fireEvent.change(search, { target: { value: "Te" } });
    await waitFor(() => expect(mocks.listPlatformUsers).toHaveBeenLastCalledWith("Te"));
    fireEvent.change(search, { target: { value: "Test" } });
    await waitFor(() => expect(mocks.listPlatformUsers).toHaveBeenLastCalledWith("Test"));
    await act(async () => answerOld(roster(["student"])));
    expect(screen.getByText("Test Person").closest("ul")).toHaveAttribute("aria-busy", "true");
    await act(async () => answerNew(roster(["student"])));
    expect(screen.getByText("Test Person").closest("ul")).not.toHaveAttribute("aria-busy");
  });

  it.each([0, 1, 2])("renders %i roster entries without altering names in Spanish", async count => {
    mocks.listPlatformUsers.mockResolvedValue(Array.from({ length: count }, (_, index) => ({ ...roster([])[0], uid: `u-${index}`, displayName: `Nombre $$ $& ${index}` })));
    render(translatedRoster());
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    await waitFor(() => expect(screen.queryByText(/Cargando la lista de personas/)).toBeNull());
    expect(screen.queryAllByRole("listitem")).toHaveLength(count);
    if (count === 0) expect(screen.getByText("Nadie coincide con esta búsqueda.")).toBeInTheDocument();
    for (let index = 0; index < count; index++) expect(screen.getByText(`Nombre $$ $& ${index}`)).toBeInTheDocument();
  });

  it("translates every permission label and description without changing the matrix", async () => {
    mocks.listPlatformUsers.mockResolvedValue([]);
    render(translatedRoster());
    fireEvent.click(screen.getByRole("tab", { name: "What each level can do" }));
    for (const definition of allPermissionDefinitions) expect(screen.getByText(definition.label)).toHaveAttribute("title", definition.description);
    const before = screen.getAllByRole("cell").map(cell => cell.querySelector("span")?.textContent ?? "label");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("tab", { name: "Qué puede hacer cada nivel" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Qué puede hacer cada nivel" })).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("row")).toHaveLength(allPermissionDefinitions.length + 1);
    for (const definition of allPermissionDefinitions) {
      const key = `platform.ops.accessPanel.permissions.${definition.key}`;
      const label = translate(getDictionary("es"), `${key}.label`);
      expect(label).not.toBe(`${key}.label`);
      expect(label).not.toBe(definition.label);
      expect(screen.getByText(label)).toHaveAttribute("title", translate(getDictionary("es"), `${key}.description`));
    }
    expect(screen.getAllByRole("cell").map(cell => cell.querySelector("span")?.textContent ?? "label")).toEqual(before);
    expect(screen.getAllByLabelText("sí").length).toBeGreaterThan(0);
    expect(screen.queryAllByLabelText("yes")).toHaveLength(0);
  });
});
