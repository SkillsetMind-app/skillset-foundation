import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CourseInstructorCard } from "@/components/courses/course-social-proof";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { PublicProfile } from "@/domain/user-profile";
import { InstructorProfileView } from "./instructor-profile-view";
import { InstructorsDirectory } from "./instructors-directory";

// Perfil público sem selo: as credenciais são o que o próprio professor
// digitou, e ninguém conferiu. A tela diz isso ao lado delas; com o selo, não.
const state = vi.hoisted(() => ({ profiles: [] as unknown[] }));
vi.mock("@/lib/data/user-profiles", () => ({ listPublicProfiles: async () => state.profiles }));
vi.mock("@/components/shared/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const unverified: PublicProfile = {
  uid: "t-1",
  displayName: "Ana Prado",
  username: "ana",
  photoURL: null,
  bio: "Bio",
  credentials: ["ICF Associate Certified Coach"],
};
const verified: PublicProfile = { ...unverified, verification: { kind: "evidence", verifiedAt: null } };

function show(node: React.ReactNode, locale: "en" | "es" = "en") {
  return render(<I18nProvider initialLocale={locale}>{node}</I18nProvider>);
}
const credentialRow = () => screen.getByText("ICF Associate Certified Coach").parentElement!;

afterEach(cleanup);

describe("credencial sem selo", () => {
  it.each([
    ["en", "Self-reported"],
    ["es", "Declarado por el creador"],
  ] as const)("perfil público (%s): marcada ao lado da credencial", (locale, label) => {
    show(<InstructorProfileView profile={unverified} courses={[]} />, locale);
    expect(within(credentialRow()).getByText(label)).toBeInTheDocument();
  });

  it("cartão do diretório: marcada ao lado da credencial", async () => {
    state.profiles = [unverified];
    show(<InstructorsDirectory />);
    await screen.findByText("ICF Associate Certified Coach");
    expect(within(credentialRow()).getByText("Self-reported")).toBeInTheDocument();
  });

  it("cartão do instrutor na página do curso: marcada ao lado da credencial", () => {
    show(<CourseInstructorCard teacherId="t-1" profile={unverified} />);
    expect(within(credentialRow()).getByText("Self-reported")).toBeInTheDocument();
  });
});

describe("credencial com selo", () => {
  it("não leva a marca em lugar nenhum", async () => {
    state.profiles = [verified];
    show(
      <>
        <InstructorProfileView profile={verified} courses={[]} />
        <InstructorsDirectory />
        <CourseInstructorCard teacherId="t-1" profile={verified} />
      </>,
    );
    await screen.findByRole("link", { name: "View profile" });
    expect(screen.getAllByText("ICF Associate Certified Coach")).toHaveLength(3);
    expect(screen.queryByText("Self-reported")).not.toBeInTheDocument();
  });
});
