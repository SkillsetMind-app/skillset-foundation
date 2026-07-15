# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-15)

**Core value:** o profissional é dono da audiência, dos dados e do contrato.
**Current focus:** Phase 1 — Vídeo híbrido

## Current Position

Phase: 1 of 4 (Vídeo híbrido)
Plan: 1 of 4 in current phase
Status: In progress
Last activity: 2026-07-15 — Plan 01-01 concluído: videoSource tipado, normalizado, inferido para legado e mapeado para Lesson

Progress: [██░░░░░░░░] 25%

## Performance Metrics

**Velocity:**
- Total plans completed: 1

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 01-video-hibrido | 01 | 7 min | 2 | 5 |

## Accumulated Context

### Decisions

- 2026-07-14: vídeo híbrido estilo Eduzz é escopo de launch (doc-norte §9.6, VIABILIDADE §6.3)
- 2026-07-15: recon constatou que embed YouTube (getTrustedLessonEmbed→nocookie, testado) e upload nativo (Bunny TUS + token assinado + fallback Supabase) JÁ EXISTEM — a fase entrega o `videoSource` explícito + UX do seletor, não o pipeline de vídeo
- 2026-07-15: `videoSource` aceita apenas `youtube`/`upload`; valores ausentes ou inválidos normalizam para `null`, e a inferência legada prioriza asset de vídeo sobre embed confiável

### Pending Todos

None yet.

### Blockers/Concerns

- Founder-gates fora do dev bloqueiam o go-live (Supabase pago, rotações, Turnstile, TOTP, logo) — não bloqueiam esta fase.
- Bunny configurado?: `isBunnyConfigured` decide Bunny vs Supabase em runtime; a fase não depende disso (abstração já cobre os dois).

## Session Continuity

Last session: 2026-07-15
Stopped at: Completed 01-01-PLAN.md
Resume file: None
