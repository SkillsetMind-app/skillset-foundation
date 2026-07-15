# Requirements: SkillsetMind Launch

**Defined:** 2026-07-15
**Core Value:** o profissional é dono da audiência, dos dados e do contrato; plataforma vende produto educacional.

## v1 Requirements (launch)

### Vídeo híbrido (Fase 1)

- [x] **VID-01**: Lição tem campo explícito `videoSource: 'youtube' | 'upload'` persistido com o curso (hoje a fonte é implícita: asset hospedado silenciosamente ganha do embed).
- [x] **VID-02**: Criador escolhe a fonte num seletor estilo Eduzz na aba Video do modal da aula — só o input da fonte escolhida fica visível/ativo (URL do YouTube OU upload nativo).
- [x] **VID-03**: URL do YouTube é validada/normalizada para embed `youtube-nocookie` (mecanismo `getTrustedLessonEmbed` existente — manter e ligar ao seletor; Vimeo continua aceito).
- [x] **VID-04**: Upload nativo continua atrás da abstração de storage existente: Bunny Stream (TUS, token assinado, entitlement gate) quando configurado, Supabase Storage como fallback. Nenhuma reescrita do pipeline de upload/playback.
- [x] **VID-05**: Player do aluno respeita `videoSource` explicitamente (sem precedência hardcoded silenciosa); lição com fonte youtube toca o embed mesmo que exista asset órfão, e vice-versa.
- [x] **VID-06**: Lições existentes continuam funcionando sem migração manual — `videoSource` ausente infere: asset de vídeo presente → `upload`; senão embed confiável presente → `youtube`.
- [x] **VID-07**: Aba Video do modal segue o DESIGN-CLONE-SPEC (radius 6-8px, alturas 40-44px, pele Ink Indigo/Brass, headings pesados).

### IA conselheira (Fase 2)

- [ ] **AIA-01**: Sidebar de IA flutuante no painel do produtor/professor, backend n8n + DeepSeek com guardrail prompt.

### Núcleo do relançamento (Fase 3)

- [ ] **NUC-01**: Messages funcional; **NUC-02**: Tutorial/onboarding do professor; **NUC-03**: sidebar religada (`contexts: []` → `["teacher"]` para Cupons/Coproduções/Equipe/Integrações/Payouts) + passada de design Cosmos→pele SkillsetMind.

### Assinatura do creator (Fase 4 — P1.5 fast-follow)

- [ ] **SUB-01**: Assinatura como formato de produto do creator (recorrência via Stripe Connect), money path novo com audit_log.

## v2 Requirements (pós-launch)

### 1:1 (Fase 2 do produto — coaching, sem HIPAA)

- **OTO-01**: agenda + sala de vídeo (Whereby) + Stripe-serviço (no-show, pacotes) + CRM-lite.

## Out of Scope

| Feature | Reason |
|---------|--------|
| HIPAA / terapia clínica licenciada | decisão §6.2 — coaching only; add-on futuro |
| Diretório/matching de atendimento | doc-norte §3.6 — fase 2 pós-tração |
| Parcelado BR / antecipação | doutrina de taxas §9.5 — Fase 3 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| VID-01..VID-07 | Phase 1 | Complete |
| AIA-01 | Phase 2 | Pending |
| NUC-01..NUC-03 | Phase 3 | Pending |
| SUB-01 | Phase 4 | Pending |
