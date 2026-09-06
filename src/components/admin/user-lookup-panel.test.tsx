import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserLookupPanel } from "@/components/admin/user-lookup-panel";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { UserProfile } from "@/domain/user-profile";

const mocks = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/data/admin-users", () => ({ subscribeToAdminUserProfiles: mocks.subscribe }));
const person: UserProfile = { uid: "person-$$-$&", displayName: "Ana $$ $& Álvarez", email: "ana@example.test", photoURL: null, roles: ["student", "teacher", "admin", "support", "moderator", "ops", "guest"], onboardingCompleted: true, createdAt: "", updatedAt: "", lastLoginAt: "" };
function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}
function panel() { return <I18nProvider initialLocale="en"><ChangeLanguage /><UserLookupPanel /></I18nProvider>; }
function language() { fireEvent.click(screen.getByRole("button", { name: "Change language" })); }
function deliver(rows = [person]) { act(() => mocks.subscribe.mock.calls[0][0](rows)); }
beforeEach(() => { vi.clearAllMocks(); mocks.subscribe.mockImplementation(() => vi.fn()); });
afterEach(cleanup);

describe("user lookup presentation", () => {
  it.each([person.uid, "ANA@EXAMPLE.TEST", "Álvarez"])("preserves the search %s through locale changes", async query => {
    render(panel());
    deliver([person, { ...person, uid: "other", displayName: "Bruno", email: null }]);
    const input = screen.getByRole("searchbox", { name: "Search by email or username..." });
    fireEvent.change(input, { target: { value: query } });
    language();
    expect(screen.getByRole("searchbox", { name: "Buscar por correo o nombre de usuario..." })).toHaveValue(query);
    await waitFor(() => expect(screen.queryByText("Bruno")).toBeNull());
    expect(screen.getByText(person.displayName!)).toBeInTheDocument();
    expect(screen.getByText(`UID: ${person.uid}`)).toBeInTheDocument();
    expect(screen.getByText("Estudiante, Instructor, Administrador, Soporte, Moderador, Operaciones, Visitante")).toBeInTheDocument();
    language();
    expect(screen.getByRole("searchbox", { name: "Search by email or username..." })).toHaveValue(query);
    expect(screen.queryByText("Bruno")).toBeNull();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1, 2])("shows %i known users and localizes missing profile fields", count => {
    render(panel());
    expect(screen.queryByText("0 users")).toBeNull();
    language();
    deliver(Array.from({ length: count }, (_, index) => ({ ...person, uid: `user-${index}`, displayName: null, email: null })));
    expect(screen.getByText(count === 1 ? "1 usuario" : `${count} usuarios`)).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(count);
    if (!count) expect(screen.getByText("Ningún usuario coincide con esta búsqueda.")).toBeInTheDocument();
    else {
      expect(screen.getAllByText("Usuario sin nombre")).toHaveLength(count);
      expect(screen.getAllByText("El perfil no tiene correo electrónico")).toHaveLength(count);
    }
  });

  it("does not turn a failed user read into empty results and can recover in Spanish", () => {
    render(panel());
    expect(screen.getByRole("status")).toHaveTextContent("Loading users");
    act(() => mocks.subscribe.mock.calls[0][1](new Error("Private user read detail")));
    language();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar los usuarios.");
    expect(screen.queryByText("Ningún usuario coincide con esta búsqueda.")).toBeNull();
    expect(screen.queryByText("Private user read detail")).toBeNull();
    deliver([]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Ningún usuario coincide con esta búsqueda.")).toBeInTheDocument();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });
});
