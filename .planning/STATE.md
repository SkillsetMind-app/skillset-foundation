# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-15)

**Core value:** o profissional é dono da audiência, dos dados e do contrato.
**Current focus:** Phase 1 — Vídeo híbrido

## Current Position

Phase: 1 of 4 (Vídeo híbrido)
Plan: 0 of TBD in current phase
Status: Planning
Last activity: 2026-07-15 — Scaffold .planning criado a partir dos docs travados do vault; recon do codebase feito (YouTube embed + Bunny/Supabase upload já existem; falta videoSource explícito + seletor Eduzz)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0

## Accumulated Context

### Decisions

- 2026-07-14: vídeo híbrido estilo Eduzz é escopo de launch (doc-norte §9.6, VIABILIDADE §6.3)
- 2026-07-15: recon constatou que embed YouTube (getTrustedLessonEmbed→nocookie, testado) e upload nativo (Bunny TUS + token assinado + fallback Supabase) JÁ EXISTEM — a fase entrega o `videoSource` explícito + UX do seletor, não o pipeline de vídeo

### Pending Todos

None yet.

### Blockers/Concerns

- Founder-gates fora do dev bloqueiam o go-live (Supabase pago, rotações, Turnstile, TOTP, logo) — não bloqueiam esta fase.
- Bunny configurado?: `isBunnyConfigured` decide Bunny vs Supabase em runtime; a fase não depende disso (abstração já cobre os dois).

## Session Continuity

Last session: 2026-07-15
Stopped at: .planning scaffold criado; branch feat/issue-2-hybrid-video na origin/main; issue #2 aberta
Resume file: None
