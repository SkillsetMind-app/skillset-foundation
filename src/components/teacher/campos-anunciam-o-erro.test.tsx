import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CouponsPanel } from "@/components/teacher/course-commerce-panels";

// The coupons panel now uses the primitives. What is proved here is not the
// appearance: it is the link that was missing. The error when creating a coupon was a
// colored paragraph with no role — someone using a screen reader submitted the form and
// heard nothing. And the field label now points to the control by id, instead
// of wrapping it, so the hint and the error fit in aria-describedby.

const mocks = vi.hoisted(() => ({
  createCourseCoupon: vi.fn(),
  subscribeToCourseCoupons: vi.fn(),
}));

vi.mock("@/lib/data/course-commerce", () => ({
  createCourseCoupon: mocks.createCourseCoupon,
  deleteCourseCoupon: vi.fn(),
  setCourseCouponActive: vi.fn(),
  subscribeToCourseCommerceSettings: vi.fn(() => vi.fn()),
  subscribeToCourseCoupons: mocks.subscribeToCourseCoupons,
  upsertCourseCommerceSettings: vi.fn(),
}));

vi.mock("@/lib/data/subscription-error", () => ({
  logSubscriptionError: () => vi.fn(),
}));

describe("coupons panel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.subscribeToCourseCoupons.mockReset();
    mocks.subscribeToCourseCoupons.mockImplementation(
      (_courseId: string, onData: (coupons: unknown[]) => void) => {
        onData([]);
        return vi.fn();
      },
    );
    mocks.createCourseCoupon.mockReset();
  });

  it("the label points to the field by id, and the field says whether it is invalid", () => {
    render(<CouponsPanel courseId="course-1" activationBlocked={false} />);

    const code = screen.getByLabelText(/^Code/);
    expect(code.id).toBe("coupon-code");
    expect(code).toHaveAttribute("aria-invalid", "false");
    expect(code).toBeRequired();
  });

  it("the refused coupon is announced, not just painted", async () => {
    render(<CouponsPanel courseId="course-1" activationBlocked={false} />);

    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "AB" } });
    fireEvent.click(screen.getByRole("button", { name: "Create coupon" }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert).toHaveTextContent("Coupon codes use 3-24 letters");
    expect(mocks.createCourseCoupon).not.toHaveBeenCalled();
  });
});
