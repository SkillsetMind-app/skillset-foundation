import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdvisorSidebar } from "@/components/teacher/advisor-sidebar";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "teacher-1", roles: ["teacher"] } }),
}));

vi.mock("@/lib/advisor/config", () => ({ isAdvisorEnabled: true }));
vi.mock("@/lib/permissions", () => ({ hasAnyPermission: () => true }));
vi.mock("@/lib/ui/floating-action", () => ({
  announceFloatingAction: vi.fn(),
  onFloatingActionOpened: () => () => undefined,
}));

describe("AdvisorSidebar", () => {
  it("labels the composer and restores trigger focus after Escape", () => {
    render(<AdvisorSidebar />);

    const trigger = screen.getByRole("button", { name: "Open studio advisor" });
    fireEvent.click(trigger);

    expect(
      screen.getByRole("textbox", { name: "Message to studio advisor" }),
    ).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Studio advisor" })).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
