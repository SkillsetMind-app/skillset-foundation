# Agent rules — SkillsetMind

Read this before writing UI. It is short on purpose: it holds rules that have
already cost us a real defect in production, not general advice.

Applies to every agent working in this repo — Claude Code, Codex, anything else.

---

## 1. Nothing may render outside the screen. Ever.

**A person cannot click what is not on the screen.** This is not a polish item
or a nice-to-have; a control that lands outside the viewport is a broken
feature, and it is worse than a crash because it looks like it works.

### The rule

Any panel, dialog, drawer, sheet, table or media block must fit the viewport it
renders in, or scroll **inside its own bounds**. Never rely on the page scroll
to reach the inside of an overlay: an overlay usually locks the page scroll, so
there is nothing left to reach it with.

### The specific mistake, because it has already happened here

A centred overlay whose panel has **no height cap**:

```tsx
// WRONG — the panel grows to its content
<div className="fixed inset-0 flex items-center justify-center sm:p-6">
  <div className="flex w-full max-w-5xl flex-col overflow-hidden">
    …tall content…
  </div>
</div>
```

Centring means the overflow is split between top and bottom. The bottom half
you might scroll to; **the top half is simply unreachable**, and any button up
there is gone. An inner `overflow-y-auto` does not save you either: with
nothing bounding the panel, that region is as tall as its content and never
scrolls.

Measured on `/pricing` in a 672px-tall window before the fix: the upgrade panel
rendered **1516px tall, top at −422**, with the confirm button at y=1050 — off
screen, unclickable. Seven dialogs in this codebase had the same defect.

```tsx
// RIGHT — capped, and something inside scrolls
<div className="modal-panel modal-panel-scroll w-full max-w-5xl …">
```

- `.modal-panel` caps the panel to the viewport (`100svh`, less the gutter at
  `sm` and up).
- Add `.modal-panel-scroll` when the panel has **no** scrolling region of its
  own. Panels that already have one (`min-h-0 flex-1 overflow-y-auto`) take
  only the cap.
- Both live in `src/app/globals.css`.

Drawers and dropdown menus are not dialogs and do not use these.

`src/app/dialog-viewport-fit.test.tsx` fails the build if a new centred overlay
ships without a cap. If it flags your component, cap it — do not add it to the
exemption list unless it genuinely is a drawer or a menu.

### Use `svh`, not `vh`

On mobile, `vh` counts the space behind the browser's own collapsing chrome, so
`100vh` is taller than what the person can see. Use `svh` for anything that must
fit.

### How to check, rather than assume

Layout bugs do not show up in jsdom — it has no layout engine. A passing test
suite says nothing about whether something fits. Open the page in a real browser
at a laptop height (~700px, not a tall desktop monitor) and measure:

```js
const r = el.getBoundingClientRect();
r.top < 0 || r.bottom > document.documentElement.clientHeight  // it does not fit
document.documentElement.scrollWidth > document.documentElement.clientWidth  // it overflows sideways
```

---

## 2. Other standing rules

- **Never commit to `main`.** Branch, open a PR, let CI run.
- **Money and auth writes fail closed; reads fail open.** A throw inside a
  Stripe webhook handler *is* the retry mechanism — do not swallow it.
- **Psychology is a subject — never a seller identity, and never the
  audience.** Two rules, both licensing constraints in all 50 US states rather
  than style preferences. (1) No seller-facing category may use a protected
  title; see the comment at the top of `src/domain/teacher-course.ts`. (2) No
  interface copy may address a licensed audience — "for psychologists", "for
  therapists". Naming them as the audience implies the platform is a place to
  practise, which is the claim that needs a licence, independently of what a
  seller teaches. Say coaches, facilitators, mentors, or personal-development
  experts. `src/data/i18n/regulated-wording.test.ts` fails the build if one
  comes back.

  The disclaimers on `/legal/terms` and `/legal/teacher-terms`, and the
  guardrail in `src/lib/assistant/knowledge.ts`, say "not therapy" and "no
  therapist-client relationship" **on purpose**. Those sentences deny the
  relationship; they are the shield, not the exposure. Never strip them while
  cleaning marketing wording.
- **No secret in code, ever.** Server-only values have no `NEXT_PUBLIC_` prefix.
