import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CourseInstructorCard } from "@/components/courses/course-social-proof";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { PublicProfile } from "@/domain/user-profile";
import { InstructorProfileView } from "./instructor-profile-view";
import { InstructorsDirectory } from "./instructors-directory";

// A public profile without a verified badge: the credentials are what the teacher
// typed themselves, and nobody checked. The screen says so beside them; with the badge, it does not.
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

describe("a credential without a verified badge", () => {
  it.each([
    ["en", "Self-reported"],
    ["es", "Declarado por el creador"],
  ] as const)("public profile (%s): marked beside the credential", (locale, label) => {
    show(<InstructorProfileView profile={unverified} courses={[]} />, locale);
    expect(within(credentialRow()).getByText(label)).toBeInTheDocument();
  });

  it("directory card: marked beside the credential", async () => {
    state.profiles = [unverified];
    show(<InstructorsDirectory />);
    await screen.findByText("ICF Associate Certified Coach");
    expect(within(credentialRow()).getByText("Self-reported")).toBeInTheDocument();
  });

  it("instructor card on the course page: marked beside the credential", () => {
    show(<CourseInstructorCard teacherId="t-1" profile={unverified} />);
    expect(within(credentialRow()).getByText("Self-reported")).toBeInTheDocument();
  });
});

describe("a credential with a verified badge", () => {
  it("carries the mark nowhere", async () => {
    state.profiles = [verified];
    show(
      <>
        <InstructorProfileView profile={verified} courses={[]} />
        <InstructorsDirectory />
        <CourseInstructorCard teacherId="t-1" profile={verified} />
      </>,
    );
    await screen.findByText("View profile");
    expect(screen.getAllByText("ICF Associate Certified Coach")).toHaveLength(3);
    expect(screen.queryByText("Self-reported")).not.toBeInTheDocument();
  });
});
