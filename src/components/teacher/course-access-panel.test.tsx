import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), act: vi.fn() }));
vi.mock("@/lib/data/course-access", () => ({ listCourseAccess: mocks.list, changeCourseAccess: mocks.act }));
import { CourseAccessPanel } from "./course-access-panel";
const grant = { id: "grant-1", learner_email: "learner@example.com", access_status: "pending", revoked_at: null };
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([]); mocks.act.mockResolvedValue({ grant, accessStatus: "pending", emailStatus: "failed" }); });
it("keeps a recorded grant visible after email failure and allows a targeted retry", async () => {
  render(<CourseAccessPanel courseId="course-1" />);
  await waitFor(() => expect(mocks.list).toHaveBeenCalledWith("course-1"));
  fireEvent.change(screen.getByLabelText("Learner email"), { target: { value: grant.learner_email } });
  fireEvent.click(screen.getByRole("button", { name: "Grant access and send link" }));
  expect(await screen.findByText(/Access recorded.*email could not be sent/i)).toBeInTheDocument();
  expect(screen.getByText(grant.learner_email)).toBeInTheDocument();
  mocks.act.mockResolvedValue({ grant, accessStatus: "pending", emailStatus: "sent" });
  fireEvent.click(screen.getByRole("button", { name: `Resend link to ${grant.learner_email}` }));
  await waitFor(() => expect(mocks.act).toHaveBeenLastCalledWith({ action: "resend", grantId: grant.id }));
});
it("requires inline confirmation before revoking", async () => {
  mocks.list.mockResolvedValue([grant]);
  render(<CourseAccessPanel courseId="course-1" />);
  fireEvent.click(await screen.findByRole("button", { name: `Revoke access for ${grant.learner_email}` }));
  expect(mocks.act).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm revocation" }));
  await waitFor(() => expect(mocks.act).toHaveBeenCalledWith({ action: "revoke", grantId: grant.id }));
});

it("keeps keyboard focus through confirmation, Escape, Cancel and revocation", async () => {
  mocks.list.mockResolvedValue([grant]);
  render(<CourseAccessPanel courseId="course-1" />);
  const trigger = await screen.findByRole("button", { name: `Revoke access for ${grant.learner_email}` });
  trigger.focus();
  fireEvent.click(trigger);
  expect(trigger).toHaveFocus();
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(screen.queryByRole("button", { name: "Confirm revocation" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  const cancel = screen.getByRole("button", { name: "Cancel" });
  cancel.focus();
  fireEvent.click(cancel);
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  mocks.act.mockResolvedValue({ grant: { ...grant, access_status: "revoked", revoked_at: "2026-09-05" }, accessStatus: "revoked" });
  fireEvent.click(screen.getByRole("button", { name: "Confirm revocation" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveFocus());
});
