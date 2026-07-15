# Roadmap: SkillsetMind Launch

## Overview

Do estado atual (cursos funcionais, brand sweep feito, sidebar corrigida) até o launch: vídeo híbrido estilo Eduzz no builder, IA conselheira no painel do produtor, núcleo do relançamento (messages/tutorial/sidebar+design), e assinatura do creator como fast-follow. Founder-gates (Supabase pago, rotações, Turnstile, TOTP, logo) correm em paralelo e não são fases de dev.

## Phases

- [ ] **Phase 1: Vídeo híbrido** - `videoSource` explícito + seletor de fonte estilo Eduzz no modal da aula (YouTube embed e upload Bunny/Supabase já existem no código)
- [ ] **Phase 2: IA conselheira** - sidebar flutuante de IA no painel do produtor (n8n + DeepSeek + guardrail)
- [ ] **Phase 3: Núcleo do relançamento** - messages + tutorial + sidebar religada + passada de design Cosmos→pele SkillsetMind
- [ ] **Phase 4: Assinatura do creator** - recorrência via Stripe Connect como formato de produto (P1.5 fast-follow)

## Phase Details

### Phase 1: Vídeo híbrido
**Goal**: Criador escolhe explicitamente, por aula, entre YouTube embed e upload nativo num seletor estilo Eduzz; o player do aluno respeita essa escolha; lições existentes seguem funcionando sem migração manual.
**Depends on**: Nothing (first phase)
**Requirements**: [VID-01, VID-02, VID-03, VID-04, VID-05, VID-06, VID-07]
**Success Criteria** (what must be TRUE):
  1. Na aba Video do modal da aula, o criador vê um seletor de fonte (YouTube | Upload) e só o input da fonte escolhida ativo.
  2. Colar URL do YouTube (watch/youtu.be/shorts/live) numa aula com fonte youtube resulta em playback `youtube-nocookie` na sala do aluno.
  3. Aula com fonte upload toca o vídeo hospedado (Bunny com token assinado quando configurado; Supabase Storage caso contrário) exatamente como hoje.
  4. Aula antiga sem `videoSource` continua tocando o que tocava antes (inferência), e o modal mostra a fonte inferida corretamente.
  5. Trocar a fonte de uma aula não apaga dados da outra fonte (URL preservada / assets preservados) e o player passa a respeitar a nova escolha.
**Plans**: TBD

Plans:
- [ ] 01-01: TBD

### Phase 2: IA conselheira
**Goal**: Sidebar flutuante de IA no painel do produtor respondendo com contexto do curso, via n8n + DeepSeek com guardrail prompt.
**Depends on**: Phase 1
**Requirements**: [AIA-01]
**Success Criteria** (what must be TRUE):
  1. Professor abre a sidebar flutuante em qualquer tela do painel e recebe respostas úteis do advisor.
  2. Guardrail prompt ativo no fluxo n8n.
**Plans**: TBD

### Phase 3: Núcleo do relançamento
**Goal**: Messages funcional, tutorial do professor, sidebar completa religada e passada de design na pele SkillsetMind.
**Depends on**: Phase 2
**Requirements**: [NUC-01, NUC-02, NUC-03]
**Success Criteria** (what must be TRUE):
  1. Messages utilizável entre aluno e professor.
  2. Tutorial de onboarding do professor no ar.
  3. Itens Cupons/Coproduções/Equipe/Integrações/Payouts visíveis na sidebar do professor com a pele Ink Indigo/Brass.
**Plans**: TBD

### Phase 4: Assinatura do creator
**Goal**: Creator vende assinatura (formato de produto) com recorrência via Stripe Connect, respeitando audit_log e a Skillset Promise.
**Depends on**: Phase 3
**Requirements**: [SUB-01]
**Success Criteria** (what must be TRUE):
  1. Creator cria produto-assinatura e aluno assina com cobrança recorrente.
  2. Repasse segue o motor release-payouts com trilha no audit_log.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Vídeo híbrido | 0/TBD | Not started | - |
| 2. IA conselheira | 0/TBD | Not started | - |
| 3. Núcleo do relançamento | 0/TBD | Not started | - |
| 4. Assinatura do creator | 0/TBD | Not started | - |
