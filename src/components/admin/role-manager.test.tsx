import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoleManager } from "@/components/admin/role-manager";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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
