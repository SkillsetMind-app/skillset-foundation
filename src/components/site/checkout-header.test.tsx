import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { CheckoutHeader } from "./checkout-header";

vi.mock("@/components/i18n/locale-switcher", () => ({ LocaleSwitcher: () => <button type="button">EN</button> }));
vi.mock("@/components/shared/logo-wordmark", () => ({ LogoWordmark: () => <span>SkillsetMind</span> }));
afterEach(cleanup);

it("starts with the skip link to the checkout content, then brand, secure mark and language", () => {
  const { container } = render(<CheckoutHeader secureLabel="Secure checkout" skipLabel="Skip to content" />);
  const first = container.querySelector("a, button");
  expect(first).toHaveAttribute("href", "#conteudo");
  expect(first).toHaveTextContent("Skip to content");
  expect(screen.getByText("Secure checkout")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "EN" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});
