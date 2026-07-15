# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-15)

**Core value:** o profissional é dono da audiência, dos dados e do contrato.
**Current focus:** Phase 2 — IA conselheira (planning next)

## Current Position

Phase: 1 of 4 (Vídeo híbrido)
Plan: 4 of 4 in current phase
Status: Complete — ready for PR and Phase 2 planning
Last activity: 2026-07-15 — Phase 1 concluída: videoSource explícito, picker Eduzz, playback por fonte e gates integrados verdes

Progress: [██████████] 100% of Phase 1

## Performance Metrics

**Velocity:**
- Total plans completed: 4

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 01-video-hibrido | 01 | 7 min | 2 | 5 |
| 01-video-hibrido | 02 | 16 min | 2 | 2 |
| 01-video-hibrido | 03 | 17 min | 3 | 4 |
| 01-video-hibrido | 04 | 9 min | 2 | 4 planning artifacts |

## Accumulated Context

### Decisions

- 2026-07-14: vídeo híbrido estilo Eduzz é escopo de launch (doc-norte §9.6, VIABILIDADE §6.3)
- 2026-07-15: recon constatou que embed YouTube (getTrustedLessonEmbed→nocookie, testado) e upload nativo (Bunny TUS + token assinado + fallback Supabase) JÁ EXISTEM — a fase entrega o `videoSource` explícito + UX do seletor, não o pipeline de vídeo
- 2026-07-15: `videoSource` aceita apenas `youtube`/`upload`; valores ausentes ou inválidos normalizam para `null`, e a inferência legada prioriza asset de vídeo sobre embed confiável
- 2026-07-15: escolha explícita sempre vence dados órfãos; trocar a fonte altera apenas `videoSource` e preserva URL/assets

### Pending Todos

None yet.

### Blockers/Concerns

- Founder-gates fora do dev bloqueiam o go-live (Supabase pago, rotações, Turnstile, TOTP, logo) — não bloqueiam esta fase.
- Bunny configurado?: `isBunnyConfigured` decide Bunny vs Supabase em runtime; a fase não depende disso (abstração já cobre os dois).

## Session Continuity

Last session: 2026-07-15
Stopped at: Phase 1 complete; issue #2 ready for PR
Resume file: None
