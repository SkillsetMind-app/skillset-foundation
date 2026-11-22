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
  it("uses the theme's on-primary foreground for the selected tab", () => {
    mocks.listPlatformUsers.mockResolvedValue([]);
    render(translatedRoster());
    expect(screen.getByRole("button", { name: "People" })).toHaveClass("text-[var(--color-on-primary)]");
    fireEvent.click(screen.getByRole("button", { name: "What each level can do" }));
    expect(screen.getByRole("button", { name: "What each level can do" })).toHaveClass("text-[var(--color-on-primary)]");
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
    fireEvent.click(screen.getByRole("button", { name: "What each level can do" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: translate(getDictionary("en"), "authFlow.loading.retry") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "People" }));
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

  it.each([0, 1, 2])("renders %i roster entries without altering names in Spanish", async count => {
    mocks.listPlatformUsers.mockResolvedValue(Array.from({ length: count }, (_, index) => ({ ...roster([])[0], uid: `u-${index}`, displayName: `Nombre $$ $& ${index}` })));
    render(translatedRoster());
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryAllByRole("listitem")).toHaveLength(count);
    if (count === 0) expect(screen.getByText("Nadie coincide con esta búsqueda.")).toBeInTheDocument();
    for (let index = 0; index < count; index++) expect(screen.getByText(`Nombre $$ $& ${index}`)).toBeInTheDocument();
  });

  it("translates every permission label and description without changing the matrix", async () => {
    mocks.listPlatformUsers.mockResolvedValue([]);
    render(translatedRoster());
    fireEvent.click(screen.getByRole("button", { name: "What each level can do" }));
    for (const definition of allPermissionDefinitions) expect(screen.getByText(definition.label)).toHaveAttribute("title", definition.description);
    const before = screen.getAllByRole("cell").map(cell => cell.querySelector("span")?.textContent ?? "label");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: "Qué puede hacer cada nivel" })).toHaveAttribute("aria-pressed", "true");
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
