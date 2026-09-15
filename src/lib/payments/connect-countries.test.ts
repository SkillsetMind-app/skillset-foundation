import { describe, expect, it } from "vitest";

import {
  CONNECT_PAYOUT_COUNTRIES,
  isConnectPayoutCountry,
} from "@/lib/payments/connect-countries";

describe("connect payout countries", () => {
  it("lists US, CA, GB, CH and the 29 EU/EEA members once each", () => {
    expect(CONNECT_PAYOUT_COUNTRIES).toHaveLength(33);
    expect(new Set(CONNECT_PAYOUT_COUNTRIES).size).toBe(33);
  });

  it.each(["US", "gb", "De", "ch", "LI", "NO"])("accepts %s", (value) => {
    expect(isConnectPayoutCountry(value)).toBe(true);
  });

  // The exclusions are the point: a creator here gets an account that cannot
  // take direct charges with an application fee, i.e. cannot sell.
  it.each(["BR", "MX", "IS", "AR", "CO", "GY", "USA", "", " US", null, undefined, 42])(
    "rejects %s",
    (value) => {
      expect(isConnectPayoutCountry(value)).toBe(false);
    },
  );
});
