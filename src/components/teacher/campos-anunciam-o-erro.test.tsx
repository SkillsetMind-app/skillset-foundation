import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CouponsPanel } from "@/components/teacher/course-commerce-panels";

// O painel de cupons passou a usar os primitivos. O que se prova aqui não é a
// aparência: é a ligação que faltava. O erro de criar um cupom era um parágrafo
// colorido sem papel nenhum — quem usa leitor de tela mandava o formulário e
// não ouvia nada. E o rótulo do campo agora aponta para o controle por id, em
// vez de embrulhá-lo, então a dica e o erro cabem no aria-describedby.

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

describe("painel de cupons", () => {
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

  it("o rótulo aponta para o campo por id, e o campo diz se está inválido", () => {
    render(<CouponsPanel courseId="course-1" activationBlocked={false} />);

    const code = screen.getByLabelText(/^Code/);
    expect(code.id).toBe("coupon-code");
    expect(code).toHaveAttribute("aria-invalid", "false");
    expect(code).toBeRequired();
  });

  it("o cupom recusado é anunciado, não só pintado", async () => {
    render(<CouponsPanel courseId="course-1" activationBlocked={false} />);

    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "AB" } });
    fireEvent.click(screen.getByRole("button", { name: "Create coupon" }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert).toHaveTextContent("Coupon codes use 3-24 letters");
    expect(mocks.createCourseCoupon).not.toHaveBeenCalled();
  });
});
