# Skillset DESIGN V2 — Design System Spec

> Source: `Skillset DESIGN V2-handoff (1).zip` → `project/`. Read from `tokens.css`, `app.css` (8501 lines), `Área de Membros.html` (inline `<style>`), `membros/panel.css`, and all JSX. Values copied verbatim; nothing rounded or invented.

---

## 1. VERDICT (read this first)

1. **Direction — marketplace/teach shell:** KEEPS the current direction exactly. Same institutional navy `#1a365d` + US-flag red `#b22234`, same Manrope + Cormorant Garamond pairing, same `--color-*` token names. `tokens.css` is a near-verbatim mirror of the app's current `:root`.
2. **Direction — member area (`Área de Membros.html`):** NEW, parallel direction. A **dark-mode-default**, warm-neutral (`#0a0d12`/`#efeae2`) surface system with its own `--mb-*` / `--pn-*` tokens, Portuguese UI copy, and per-instructor accent theming. It is NOT the navy system.
3. **New primitive both share:** Inter is added as a third family for numeric display (`--font-num`, tabular lining figures). This is the one genuinely net-new global token.
4. **Overall delta:** **MODERATE.** The marketplace half is cosmetic (a few radius/line/shadow token tweaks + many new component classes). The member area half is a MAJOR addition — a whole second theme layer — but it is additive (a separate route/HTML), not a replacement of the existing tokens.
5. **Net for the build:** current tokens survive almost untouched; the work is (a) apply ~6 token value tweaks, (b) port a large component library from `app.css`, (c) decide whether to adopt the member-area dark theme as the `/learn/*` classroom shell (App.jsx already redirects `classroom` → `Área de Membros.html`).

---

## 2. TOKENS

### 2a. Marketplace tokens (`tokens.css` `:root`) — the source of truth

**Brand / primary**
```
--color-brand:          #1a365d
--color-primary:        #1a365d
--color-primary-dark:   #0f2744
--color-primary-light:  #2c5282
```
**Accent (red)**
```
--color-accent:         #b22234
--color-accent-hover:   #9e1f2f
--color-accent-soft:    #f3d6dc
```
**Surfaces**
```
--color-base:           #ffffff
--color-surface:        #ffffff
--color-surface-soft:   #f5f9ff
--color-surface-strong: #ebf3fb
```
**Ink (text)**
```
--color-ink:        #163252
--color-ink-soft:   #4d6785
--color-ink-muted:  #7a8fae
--color-on-primary: #ffffff
--color-on-accent:  #ffffff
```
**Lines / semantic**
```
--color-line:         rgba(26,54,93,0.12)
--color-line-strong:  rgba(26,54,93,0.18)
--color-success:  #1f8a5b   --color-success-soft: #e4f3eb
--color-warning:  #c07b0a   --color-warning-soft: #fcefd2
--color-danger:   #b22234   --color-danger-soft:  rgba(178,34,52,0.06)
--color-info:     #2c5282   --color-info-soft:    #ebf3fb
```
**Shadows**
```
--shadow-soft:          0 12px 28px rgba(26,54,93,0.06)
--shadow-strong:        0 18px 44px rgba(15,39,68,0.14)
--shadow-button:        0 10px 22px rgba(26,54,93,0.14)
--shadow-button-strong: 0 14px 28px rgba(15,39,68,0.28)
--shadow-avatar:        0 8px 18px rgba(26,54,93,0.14)
```
**Radii** (`--radius-xs:6 sm:8 md:10 lg:12 xl:14 2xl:16 3xl:18 4xl:22` px)
**Spacing** (4px base): `--space-1:4 … --space-12:96` (1=4,2=8,3=12,4=16,5=20,6=24,7=32,8=40,9=48,10=64,11=80,12=96)
**Layout:** `--container-max:1280px  --container-pad-mobile:20px  --container-pad-desktop:32px  --sidebar-width:252px`
**Fonts**
```
--font-sans:    "Manrope", system-ui, -apple-system, "Segoe UI", sans-serif
--font-display: "Cormorant Garamond", "Cormorant", Georgia, serif
--font-mono:    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace
--font-num:     'Inter', 'Manrope', -apple-system, system-ui, sans-serif   (defined in app.css)
```
**Type scale (raw):** `--fs-10 … --fs-72`: 10,11,12,13,14,15,16,18,20,24,30,36,48,60,72 px
**Weights:** regular400 medium500 semibold600 bold700 extra800
**Tracking:** eyebrow `0.22em`, label `0.18em`, tight `0.14em`, normal `0`
**Line heights:** tight1.05 snug1.2 normal1.5 relaxed1.75 7=1.75
**Motion:** `--ease-standard: cubic-bezier(0.2,0.6,0.2,1)`, `--ease-out: ease-out`, `--duration-fast:120ms --duration-base:180ms --duration-slow:280ms`

Semantic text classes in tokens.css: `.h-display .h1 .h2 .h3 .h4 .lead .p/.body .eyebrow .eyebrow-brand .label .meta .code` (display classes use Cormorant `clamp()` sizes; `.eyebrow` is accent-red uppercase 0.22em).

### 2b. Member-area tokens (`Área de Membros.html` inline `<style>`) — SEPARATE SYSTEM

Selected on `<body data-theme="escuro|claro" data-mode="aluno|creator">`. Global constants:
```
--mb-accent:#b22234  --mb-accent-hover:#9e1f2f  --mb-success:#27a06a
--mb-display:"Cormorant Garamond", Georgia, serif
--mb-sans:"Manrope", system-ui, -apple-system, sans-serif
```
**DARK (`data-theme="escuro"`, DEFAULT):**
```
--bg:#0a0d12  --bg-top:#06080c  --elev:#11151d  --surface:#141923  --surface-2:#1a202b
--line:rgba(255,255,255,.08)  --line-2:rgba(255,255,255,.15)
--ink:#eef1f6  --ink-soft:#9aa6b6  --ink-muted:#67717f
--shadow:0 18px 50px rgba(0,0,0,.5)   --on-accent:#fff
```
**LIGHT (`data-theme="claro"`) — warm neutral, not white:**
```
--bg:#efeae2  --bg-top:#ffffff  --elev:#ffffff  --surface:#ffffff  --surface-2:#f5f1ea
--line:rgba(28,24,18,.12)  --line-2:rgba(28,24,18,.20)
--ink:#231f1a  --ink-soft:#6a6258  --ink-muted:#9b9286
--shadow:0 16px 40px rgba(60,50,38,.16)   --on-accent:#fff
```
Accent is runtime-overridable per instructor (`app.jsx` sets `--mb-accent` from `course.accent`). Palette options: `#b22234 #c9923f #1f8a5b #5b7fb0`. Display font switchable: Cormorant Garamond / Playfair Display / Fraunces. Uses `color-mix(in srgb, …)` heavily.

### 2c. Motion (member area)
Ad-hoc `.14s`–`.22s` transitions; keyframes `mbpulse mbslide mbtoast mbpop mbtoast`; card hover uses `cubic-bezier(.2,.6,.2,1)` (same curve as marketplace `--ease-standard`).

---

## 3. FONTS

| Family | Role | Weights | Load |
|---|---|---|---|
| **Manrope** | UI / body (`--font-sans`) | 400 500 600 700 800 | Google Fonts `@import` in tokens.css + `<link>` in both HTML files |
| **Cormorant Garamond** | Display / headings (`--font-display`) | 500 600 700 | same |
| **Inter** | Numeric display (`--font-num`, `.num` util) tabular/lining | 400 500 600 700 800 | in tokens.css `@import` (marketplace); member area uses `--font-num` less |
| Playfair Display / Fraunces | Optional display swap (Tweaks) | 500 600 700 | lazy-injected via `ensureFont()` / `ensureMFont()` on demand |

`.num` utility forces `font-feature-settings:"tnum" 1,"lnum" 1,"ss01" 1,"cv11" 1; font-variant-numeric:tabular-nums lining-nums; letter-spacing:-0.01em`.

---

## 4. DELTA TABLE (current app → V2)

### Tokens that DIFFER from the current app's `:root`

| Token | Current | V2 (tokens.css) | Note |
|---|---|---|---|
| `--color-surface-soft` | `#eef4fc` | `#f5f9ff` | slightly cooler/lighter page tint |
| `--color-surface-strong` | `#e3eef9` | `#ebf3fb` | lighter strong fill |
| `--color-ink-muted` | `#5a6a81` | `#7a8fae` | lighter muted ink (more contrast headroom) |
| `--color-line` | `rgba(26,54,93,.28)` | `rgba(26,54,93,0.12)` | **much softer** hairlines |
| `--color-line-strong` | `rgba(26,54,93,.40)` | `rgba(26,54,93,0.18)` | **much softer** strong lines |

Unchanged and confirmed identical: `--color-brand/-primary/-primary-dark/-primary-light`, `--color-accent/-hover/-soft`, `--color-base/-surface`, `--color-ink/-ink-soft`, `--color-success #1f8a5b`, `--color-warning #c07b0a`, `--color-info #2c5282`, `--color-danger #b22234`, all three `--shadow-*` you listed, all radii (`sm8 md10 lg12 xl14 3xl18 4xl22`), Manrope + Cormorant fonts, `[data-theme="dark"]` mechanism.

### Tokens NET-NEW in V2 (add these)

- `--color-accent-soft #f3d6dc`, `--color-success-soft #e4f3eb`, `--color-warning-soft #fcefd2`, `--color-danger-soft`, `--color-info-soft #ebf3fb`, `--color-on-primary`, `--color-on-accent`
- `--shadow-button`, `--shadow-button-strong`
- `--radius-xs 6px`, `--radius-2xl 16px`
- Full `--space-1…12` scale, `--container-max/-pad-mobile/-pad-desktop`, `--sidebar-width 252px`
- Full `--fs-10…72` raw scale; `--fw-*`; `--tracking-*`; `--leading-*`
- `--font-num` (Inter) + `--font-mono`
- Motion: `--ease-standard`, `--ease-out`, `--duration-fast/base/slow`
- Entire `--mb-*` and per-instructor theme layer (member area)

### Tokens V2 DROPS
None. Every current token is present (some renamed only in value). The current dark theme uses `[data-theme="dark"]`; V2's member area uses a different mechanism (`body[data-theme="escuro"]`) — the marketplace half still expects `[data-theme]` (Tweaks exposes light/auto).

---

## 5. SHELL / CHROME

### Marketplace / Teach shell (`App.jsx`, `app.css`)
- **Appbar** (`.appbar`): sticky top, `z-40`, `min-height:58px`, white, `border-bottom:1px solid --color-line-strong`. Left = collapse button (`.appbar-collapse`, hidden ≤920px) + flat logo `assets/skillset-usa-logo-flat.png` (`height:30px`). Right cell hosts the Topbar.
- **App grid** (`.app`): `grid-template-columns:250px 1fr`; collapsed → `64px 1fr`; ≤920px → single column. Animated via `--duration-slow`.
- **Sidebar** (`.sidebar`): **inverted navy**, sticky under appbar (`top:58px`, `height:calc(100vh - 58px)`), gradient `linear-gradient(180deg,#07172a,#0f2744 55%,#14304e)` + red radial glow + subtle grid texture + bottom vignette. Floating round collapse FAB (`.sb-collapse`, `right:-16px`). Nav rows (`.sb-item`): icon in a rounded chip, left red active rail (`::before`), active row = white-tint gradient + red gradient icon chip. Count badges red. Collapsed rows show flyout tooltips.
  - **Nav items — LEARNER role:** Marketplace(search) · Classroom(video) · Learning paths(layers) · Agenda(calendar) · Communities(users) · Credentials(award)
  - **Nav items — CREATOR role:** Studio(grid) · Course Builder(pencil) · Agenda(calendar) · Communities(users) · Reviews & refunds(star) · Affiliate program(globe) · Marketplace(search)
  - Account items (Subscription/Billing/Settings/Wishlist/Plans/Payouts) live in the **avatar menu**, not the sidebar. Learner/Creator role toggle sits at top of sidebar when `hasCreatorProfile`.
- **Topbar** (`.topbar`, inside appbar right cell): breadcrumbs (`section › page` from a route→title map), spacer, learner **streak pill** (🔥 + count + progress), optional ops status pill, Tweaks button, Messages icon (unread badge), Bell + notifications dropdown, user-trigger (pill avatar + name + role, dropdown menu with plan chip, settings, billing/payouts, wishlist/credentials, role-switch, replay tutorial, sign out).
- **Main / content** (`.content`): `padding:32px 40px 48px`, inner `max-width:1240px` centered, ambient white→`#fcfdff` gradient. Body has radial navy/red ambient wash.
- **Command palette** (`CommandK`, ⌘K/Ctrl+K): full modal, sectioned results (Quick actions, Suggestions, Courses, Educators, Lessons, Events, Community), arrow/enter/esc keyboard nav, footer hint. Also `g`+letter nav combos and `?` for shortcuts help.
- **Density:** `body[data-density="compact"]` tightens `.content` padding to 24px, hero to `40px 40px 36px`.
- **Theme:** marketplace is light-first; Tweaks offers Light/Auto (no full dark theme built on this side). `--color-accent` + display font are runtime-swappable via Tweaks.

### Member-area shell (`Área de Membros.html` + `membros/`)
- Two spaces: **Panel** (multi-course, `.pn-*`, topbar `height:66px` with horizontal nav) and **Course** (`.mb-*`, topbar `height:64px`, big cover hero). Dark by default.
- **Panel topbar nav:** Meus cursos(layers) · Descobrir(compass) · Comunidade(users); right = messages + avatar dropdown (Perfil e conta, Mensagens, Segurança 2FA, Ajuda e suporte, theme seg-control, Sair).
- **Course topbar:** back-to-panel, menu (opens left drawer), instructor brand mark+name, theme toggle, search, bell, avatar. Professor role adds a sticky **admin bar** (`.mb-adminbar`, plum gradient) with Editando / Ver como aluno switch.
- **Assistant FAB** (`.mb-fab`) bottom-right; overlays for search/notif/assistant/prefs/offer.
- Responsive: hero art hidden ≤980px, lesson grid collapses, panel nav hides ≤860px, grids reflow to 1–2 cols on phones.

---

## 6. COMPONENT INVENTORY (marketplace, exact values)

**Buttons** (`.btn`, radius 9px, `font-size:13px`, `padding:11px 16px`, weight 600)
- `.btn-primary` navy bg, inset red underline shadow `inset 0 -2px 0 rgba(178,34,52,0.32)` + soft navy drop; hover → `--color-primary-dark`, `translateY(-1px)`.
- `.btn-accent` red bg + red glow.
- `.btn-ghost` translucent white, `--color-line` border, navy text.
- `.btn-on-dark` translucent white on dark surfaces.
- Sizes: `.btn-sm` (8px 12px / 12px / r8) · `.btn-lg` (14px 22px / 14px / r10).

**Chips**: `.chip` (pill, uppercase 0.16em, red text, soft shadow) · `.chip-mute` (strong surface, r8) · `.chip-role` (white, red-tinted border) · `.chip-dot`.

**Cards**
- `.card`: white, `1px --color-line`, `radius:16px`, `--shadow-soft`. `.card-hover` → `translateY(-3px)` + `--shadow-strong`.
- **Course card `.cc`**: white, `radius:18px`, `--shadow-soft`; `.img` `aspect-ratio:4/3` with navy gradient scrim; `.chip` top-left, `.price-tag` (navy pill, blur) top-right, `.meta-bot` bottom; `.body` `padding:20px 22px 22px`; `.cat` red 0.2em uppercase; `.foot .rating` warning-gold stars. `.cc-wish` bookmark toggle (fills accent when active).
- Hero (`.hero`): navy, `radius:24px`, `padding:56px`, layered radial + red glow + grid-mask bg, Cormorant `clamp(40px,5.2vw,60px)` h1, red bottom rule.

**Badges**: `.vb` VerifiedBadge (starburst SVG + white check, `color:--color-primary`, `margin-left:4px`) · sidebar `.count` (red pill) · topbar `.badge` (red dot / num) · `.health-pill` (studio, tabular num).

**Inputs / forms**: sidebar search (`.sb-search input`, translucent-on-navy, r10, ⌘K kbd hint); auth/settings inputs live in screen sections; focus borders use `--color-primary-light`/accent.

**Tabs**: underline bars (billing/settings/reviews-mod), 2.5px accent underline on active — pattern repeated in member area (`.mb-tab.on::after`).

**Modals**: user-dropdown (`radius:14px`, `--shadow-strong`, `dropdown-in` anim) · Command-K (`.ck-*`) · ShareWin (`.sw-*`, `radius:22px`, confetti, spring pop `cubic-bezier(0.34,1.56,0.64,1)`) · lesson upload modal.

**Avatars**: `.user-trigger .avatar` (28px navy gradient), `.sb-user-av` (36px, tone variants navy/red/green/warm), dropdown 38px.

**Skeletons** (`Skeleton.jsx` + `.sk`): shimmer via `sk-shimmer` keyframe (1.4s), `--color-surface-soft` base gradient; `CourseCardSkeleton`, `ContinueCardSkeleton`. `.sk-shimmer` white-sweep overlay.

**Streak pill** (`.streak-pill`): amber→red gradient tint, flame emoji with `streak-flicker` anim, tabular num (`#c07b0a`), 40px mini progress bar (amber→accent fill).

---

## 7. MEMBER-AREA SCREENS (`membros/*`, Portuguese)

| Screen | File | Layout & sections | Key components / copy |
|---|---|---|---|
| **Panel — Meus cursos** | `Panel.jsx` `MyCourses` | Topbar + `.pn-page`; "continue" resume hero (`.pn-resume`); filter chips + search; `.pn-grid` of `.pn-card` course cards | `AccessBadge` (vitalício/mensal/período/escola/manual/bloqueado/expirado), `RenewModal` (acesso ≠ pagamento; Pix/Cartão 12x), lock "míope" blur effect. Copy: "Meus cursos", "Renovar acesso", "Concluído". |
| **Panel — Descobrir** | `Discover.jsx` | `.pn-store-banner` + course store grid | `StoreCard` (price/rating), `CourseBuyModal`. Marketplace inside member area. |
| **Panel — Comunidade (hub)** | `Panel.jsx` `CommunityHub` | `.pn-hub-grid` of `.pn-hub-card` (per-course communities, member avatar stack) | off state dims non-owned. |
| **Panel — Mensagens** | `Messages.jsx` | `.pn-msg` 2-col (conversation list 320px + thread); bubbles `.pn-bubble me/them` | `SCOPE` labels; rule note about DM policy; compose bar. |
| **Panel — Perfil e conta** | `Profile.jsx` | `.pn-prof` 2-col panels; identity + editable fields; **2FA** panel with `QRFake` QR + steps + switch | avatar photo upload (`.pn-photo`), theme seg control. |
| **Course — Home** | `Home.jsx` `CourseHome` | Full-bleed `.mb-hero` (cover image-slot + scrim + progress bar + Continuar CTA); tabs **Conteúdos / Sobre**; modules in **grade** or **lista** view (`.mb-grid` / `.mb-list`); About tab = lede + facts grid + testimonials | Creator mode = `Editable` contentEditable titles/covers, add/remove/reorder modules, status cycle (open/soon/locked). At 100% shows "Emitir certificado". |
| **Course — Lesson** | `Lesson.jsx` `LessonView` | `.mb-lesson` 2-col: player (`.mb-player`, 16/9, scrub bar) + sticky module sidebar (`.mb-lz-side`); star rating + mark-complete; tabs Info/Materials; comments thread (`.mb-comment`, replies) | related-course upsell card (`.mb-up`), materials list (pdf/zip/xls icon tints), prev/next nav. |
| **Course — Comunidade** | `Screens.jsx` `CommunityView` | `.mb-screen` feed: composer + `.mb-post` cards (pinned, mentor role tag), like/reply | Portuguese post actions. |
| **Course — Certificado** | `Screens.jsx` `CertificateView` | `.mb-cert-paper` certificate (locked blur until 100%), progress bar, signature line, download/share actions | veil overlay when locked. |
| **Overlays** | `Extras.jsx` | ToastHost, NotificationsPanel, SearchOverlay, AssistantPanel, PreferencesSheet, OfferModal | shared popover shell `.mb-pop`. |
| **Auth (login)** | `membros/Auth.jsx` + `.mb-auth-*` | split screen: showcase panel (scrim + tag + title) + form (role picker Aluno/Professor, fields, demo buttons) | 2-col, collapses ≤860px. |

---

## 8. SCREEN → ROUTE MAP

The V2 handoff is **two apps**. The marketplace/teach app (`App.jsx`) maps to most Next.js routes; the member area (`Área de Membros.html`) IS the `/learn/*` classroom experience (App.jsx redirects `classroom` → `Área de Membros.html?as=aluno`).

| V2 screen (file) | Next.js route | Likely target component (under `src/`) |
|---|---|---|
| Discover (`screens/Discover.jsx`) | `/courses`, `/learn` (marketplace home) | `app/(marketplace)/courses/page.tsx` / discover view |
| CourseDetail (`screens/CourseDetail.jsx`) | `/courses/[slug]` | `app/courses/[slug]/page.tsx` |
| Studio (`screens/Studio.jsx`) | `/teach`, `/teach/storefront` | `app/teach/page.tsx` (creator dashboard) |
| Builder (`screens/Builder.jsx`) | `/teach/builder`, `/teach/builder/[courseId]/preview` | `app/teach/builder/…` |
| LessonUploadModal (`screens/LessonUploadModal.jsx`) | (within builder) | `teach/builder` lesson upload modal |
| Paths (`screens/Paths.jsx`) | `/learn` paths / `/courses/creator` | learning-paths view |
| Classroom → **Área de Membros** | `/learn/courses/[slug]` | member-area shell (see member rows below) |
| Community (`screens/Community.jsx`) | `/learn/community`, `/learn/community/[slug]` | `app/learn/community/…` |
| Credentials (`screens/Credentials.jsx`) | `/learn/credentials`, `/learn/credentials/[certificateId]` | `app/learn/credentials/…` |
| Pricing (`screens/Pricing.jsx`) | `/pricing`, `/account/plans`, `/fees-and-payouts` | `app/pricing/page.tsx` |
| Payouts (`screens/Payouts.jsx`) | `/account/payments`, `/teach` payouts, `/fees-and-payouts` | `app/account/payments/…` / `teach/refunds` |
| Billing (`screens/Billing.jsx`) | `/account/billing`, `/account/billing/upgrade`, `/account/billing/return`, `subscription` tab | `app/account/billing/…` |
| Settings (`screens/Settings.jsx`) | `/account`, `/account/profile`, `/account/security`, `/account/email`, `/account/notifications`, `/learn/settings` | `app/account/…` settings tabs |
| Agenda (`screens/Agenda.jsx`) | `/learn/events`, `/teach/events` | `app/learn/events/…` |
| Notifications (`screens/Notifications.jsx`) | `/account/notifications` | notifications panel |
| Wishlist (`screens/Wishlist.jsx`) | `/learn/wishlist` | `app/learn/wishlist/page.tsx` |
| Messages (`screens/Messages.jsx`) | `/support`, `/help` (DM) | messages surface |
| Affiliate (`screens/Affiliate.jsx`) | `/for-creators`, `/teach/co-productions` | affiliate/co-prod |
| ReviewsModeration (`screens/ReviewsModeration.jsx`) | `/teach/refunds`, `/teach/sales`, `/teach/sales/[orderId]` | reviews & refunds |
| Onboarding (`screens/Onboarding.jsx`) | `/onboarding`, `/welcome` | `app/onboarding/page.tsx` |
| Tutorial (`screens/Tutorial.jsx`) | (in-app coach marks) | tutorial overlay |
| Auth (`screens/Auth.jsx`) | `/auth`, `/login`, `/signup`, `/forgot-password`, `/verify` | `app/(auth)/…` |
| StubScreen "Coming in v2.1" | `/instructors`, `/instructors/[slug]`, `/teach/coupons`, `/teach/integrations`, `/teach/media`, `/teach/team`, `/ops`, `/platform` | placeholder / not-yet-built surfaces |
| — (static marketing) | `/`, `/about`, `/how-it-works`, `/for-creators`, `/teach` (landing), `/trust`, `/promise`, `/contact`, `/legal/*`, `/verify` | not in this prototype (marketing pages) |
| **Member — Panel/MyCourses** (`membros/Panel.jsx`) | `/learn` (student home) | member-area panel |
| **Member — Course Home** (`membros/Home.jsx`) | `/learn/courses/[slug]` | classroom course home |
| **Member — Lesson** (`membros/Lesson.jsx`) | `/learn/courses/[slug]` (lesson) | classroom lesson/player |
| **Member — Discover** (`membros/Discover.jsx`) | `/courses` (in-classroom store) | member store |
| **Member — Community** (`membros/Screens.jsx`) | `/learn/community/[slug]` | classroom community |
| **Member — Certificate** (`membros/Screens.jsx`) | `/learn/credentials/[certificateId]` | certificate view |
| **Member — Messages** (`membros/Messages.jsx`) | `/support` (DM) | classroom messages |
| **Member — Profile/2FA** (`membros/Profile.jsx`) | `/account/profile`, `/account/security` | account (dark variant) |
| **Member — Auth** (`membros/Auth.jsx`) | `/login` (student entry) | classroom login |

---

## 9. FIDELITY NOTES / things a coding agent must confirm

1. **Two design languages, one product — biggest decision.** The marketplace/teach shell is light navy `--color-*`; the classroom (`Área de Membros.html`) is dark-default warm `--mb-*`. Confirm with the team whether `/learn/*` should adopt the member-area dark theme (as the prototype implies via the redirect) or be re-skinned into the navy system. This is a product decision, not inferable from source.
2. **`--color-line`/`--color-line-strong` got dramatically softer** (0.28→0.12, 0.40→0.18). Applying these will visibly lighten every border/divider in the current app. Confirm intentional (it reads as intentional — the whole V2 aesthetic is airier).
3. **Inter is a new font dependency** for numeric display. Add to the Next font loader; `.num` utility + `font-variant-numeric` must carry over.
4. **`color-mix(in srgb, …)`** is used throughout the member area — fine for modern browsers; confirm target support or provide fallbacks.
5. **Per-instructor accent theming** (member area) sets `--mb-accent` at runtime from course data. If ported, needs a theming mechanism keyed on course/instructor.
6. **Prototype is React-18-UMD + Babel-in-browser + `window.*` globals + mock `data.js`.** None of the JS architecture ports — only the CSS tokens, class styles, layout structure, and component semantics are the contract.
7. **Radii nuance:** V2 course cards use `18px` (`--radius-3xl`) and generic `.card` uses `16px` (`--radius-2xl`, new). Current app tops out at `--radius-4xl:22`; confirm `2xl:16`/`xs:6` additions.
8. **Auth exists in both apps** (marketplace `screens/Auth.jsx` navy, member `membros/Auth.jsx` dark). Pick one canonical login per the theme decision in (1).
9. **`screens/` folder = the marketplace surfaces**; skimmed for names/purposes only (structure matches Topbar route→title map). Deep component styles for each live in the corresponding `app.css` section (§ headers listed in file, e.g. `PRICING` L2214, `PAYOUTS` L2415, `SETTINGS` L2885, `BUILDER` L3037, `AUTH` L7601).
