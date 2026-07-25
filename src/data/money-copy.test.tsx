import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Repo-wide guard for the direct-charges truth rules.
//
// Under direct charges the platform never holds creator money, but it also
// cannot make the money arrive faster: Stripe still settles (2 business days in
// the US, 30 CALENDAR DAYS for Brazilian domestic cards) and still holds a new
// connected account's first payout. We deleted the PLATFORM layer only.
//
// An adversarial sweep found seven live surfaces that had drifted back into
// custody vocabulary or into settlement claims the code cannot keep — every one
// of them outside the single file the old assistant-knowledge guard covered.
// This test covers the copy tree instead of one file, so the next drift fails
// in CI rather than in front of a creator.
//
// Each entry is a phrase that is wrong in EVERY context, so there are no
// exemptions to maintain. Context-dependent judgement (is this timing claim
// qualified in the same block?) stays with review — a regex cannot read a block.
const BANNED: ReadonlyArray<readonly [pattern: RegExp, why: string]> = [
  // Custody vocabulary: names a balance we hold, or a handover that cannot occur.
  [/wallet ledger/i, "the ledger is an earnings record, not a wallet we hold"],
  [/wallet release/i, "there is no platform balance, so nothing is released"],
  [/carteira do criador|liberação da plataforma/i, "pt-BR custody vocabulary"],
  [/billetera del creador|liberación de la plataforma/i, "es custody vocabulary"],

  // Settlement collapsed into the charge: true of the charge, false of the balance.
  [/the moment it is paid/i, "the charge is instant; the balance is not"],
  [/from the moment of the sale/i, "the charge is instant; the balance is not"],
  [/already in your own stripe balance/i, "pending until Stripe settles"],

  // Control of the payout schedule. Accounts are Stripe EXPRESS, where the
  // interval is a PLATFORM setting, and Brazilian accounts cannot change it at
  // all. We may claim the account is theirs, never that the schedule is.
  [/not one we impose/i, "on Express the interval IS a platform setting"],
  [/n[ãa]o no nosso/i, "pt-BR twin of 'not one we impose'"],
  [/no del nuestro/i, "es twin of 'not one we impose'"],
  [/on your own (account )?schedule/i, "claims schedule control we do not grant"],
  [/the schedule you control|which you set in Stripe/i, "claims schedule control"],

  // Currency count. supportedStripeCurrencies has exactly 30 entries, and the
  // list is a CHECKOUT presentment list, never a payout capability.
  [/30\+ currencies/i, "the list is exactly 30, and it is presentment only"],
  [/mais de 30 moedas|m[áa]s de 30 monedas/i, "exactly 30, presentment only"],
];

const COPY_ROOTS = ["src/app", "src/components", "src/data", "src/lib"];
const COPY_EXTENSIONS = [".tsx", ".ts", ".json"];

function collectCopyFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      collectCopyFiles(path, acc);
    } else if (
      COPY_EXTENSIONS.some((ext) => entry.endsWith(ext)) &&
      // Tests are not user-facing copy, and a test that asserts a phrase is
      // ABSENT has to be allowed to name it. Skipping them also skips this file.
      !/\.test\.tsx?$/.test(entry)
    ) {
      acc.push(path);
    }
  }
  return acc;
}

const files = COPY_ROOTS.flatMap((root) => collectCopyFiles(root));

describe("money copy across every user-facing surface", () => {
  it("scans a non-trivial slice of the tree", () => {
    // Guards the guard: a broken walk would make every assertion below pass.
    expect(files.length).toBeGreaterThan(200);
  });

  it.each(BANNED)("never says %s (%s)", (pattern, why) => {
    const offenders = files
      .filter((file) => pattern.test(readFileSync(file, "utf8")))
      .map((file) => `${file.replace(/\\/g, "/")} — ${why}`);

    expect(offenders).toEqual([]);
  });

  it("never leaves a clearing period unscoped to us", () => {
    // Stripe's own settlement window survives the pivot. "No clearing period"
    // on its own turns a true statement about SkillsetMind into a false one
    // about Stripe. Any mention has to name whose period it is — "platform",
    // "SkillsetMind", or "of its own" — within its own sentence.
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/clearing period/gi)) {
        const index = match.index ?? 0;
        const before = source.slice(Math.max(0, index - 40), index);
        const after = source.slice(index, index + 40);
        const scoped =
          /(platform|skillsetmind|plataforma)[\s-]*$/i.test(before) ||
          /of (its|our) own/i.test(after);
        if (!scoped) {
          offenders.push(`${file.replace(/\\/g, "/")}: "${before.trim()}${after.trim()}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
