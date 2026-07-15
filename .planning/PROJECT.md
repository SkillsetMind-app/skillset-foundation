# SkillsetMind — Launch (cursos + adds confirmados)

## What This Is

Marketplace de cursos + infraestrutura de negócio para psicólogos, terapeutas e profissionais de desenvolvimento pessoal (US-first, BR secundário). Next.js (Vercel) + Supabase (auth/Postgres/RLS) + Stripe Connect Express + Bunny Stream + n8n/DeepSeek. Repo: `opatricksimon/skillset-foundation`.

Este .planning cobre o **escopo de launch decidido em 2026-07-14**: vídeo híbrido → IA conselheira → messages/tutorial/sidebar religada → assinatura do creator (fast-follow). O 1:1 MVP é Fase 2 do produto (pós-launch) e fica fora deste milestone.

## Core Value

O profissional é dono da audiência, dos dados e do contrato (Skillset Promise: fee-lock 24m, paridade de features, export 1-clique, cancelamento 1-clique, proteção de fundos, suporte humano). Nenhuma feature pode violá-la.

## Source Documents (decisões travadas — ler antes de planejar)

- `C:\Users\nicae\PS8-OS\03-projetos\skillsetmind\CONTEXTO-PRODUTO-BACKLOG-2026-07-11.md` (doc-norte; §9 = arquitetura de lançamento FINAL)
- `C:\Users\nicae\PS8-OS\03-projetos\skillsetmind\VIABILIDADE-1A1-E-REFINO-PLANO-2026-07-14.md` (§3 encaixe no plano, §6 decisões travadas)
- `C:\Users\nicae\PS8-OS\03-projetos\skillsetmind\DESIGN-CLONE-SPEC-HOTMART-2026-07-14.md` (pele: Ink Indigo `#14182B` + Muted Brass `#C6A15B`, radius 6-8px, alturas 40-44px, headings pesados)
- `C:\Users\nicae\PS8-OS\03-projetos\skillsetmind\MAPEAMENTO-HOTMART-AO-VIVO-2026-07-14.md` (estrutura do painel do produtor)

## Key Decisions

| Data | Decisão | Fonte |
|------|---------|-------|
| 2026-07-14 | Vídeo = híbrido estilo Eduzz: YouTube embed + upload nativo, ambos em todos os planos | doc-norte §9.6 |
| 2026-07-14 | 1:1 = Fase 2 pós-launch, perfil coaching (sem HIPAA) | VIABILIDADE §6 |
| 2026-07-14 | Código começa pelo vídeo híbrido, via GSD plan→approve→execute→verify | VIABILIDADE §6.3 |
| 2026-07-14 | Assinatura como produto do creator = P1.5 fast-follow (não bloqueia launch) | doc-norte §9.9 |
| 2026-07-13 | US-first; modo lançamento tudo grátis com planos dormentes atrás de flag | doc-norte §9.1-9.2 |

## Constraints

- Founder solo: automação > processo manual; nada que crie trabalho humano recorrente.
- Todo money path passa pelo `audit_log`; entitlement gate do Bunny é explícito e NÃO pode ser removido.
- Git: commit direto na main proibido — Issue→Branch→PR (issue #2 = vídeo híbrido).
- Founder-gates bloqueiam o go-live e independem de dev: Supabase Free→pago, rotação service_role + Stripe LIVE, Turnstile, TOTP admin, logo.

---
*Scaffold gerado em 2026-07-15 a partir das decisões já travadas nos docs do vault (sem interrogatório novo — as respostas do new-project já existiam por escrito).*
