# VIABILIDADE ATENDIMENTO 1:1 + REFINO DO PLANO — SkillsetMind

> **Data:** 2026-07-14
> **Método:** 3 frentes de pesquisa web (dores de terapeutas/coaches em plataformas de curso · anatomia das plataformas 1:1 build-vs-buy · viabilidade técnica+compliance no nosso stack Next+Supabase+Stripe). Fontes ao final.
> **Pergunta do Patrick:** o 1:1 é viável? o que muda (programa/API/custo/pagamento/design)? o que isso agrega ao plano? em quanto tempo?

---

## TL;DR — VEREDITO

1. **1:1 é viável e é a MAIOR oportunidade não-atendida do mercado.** Ninguém junta hoje, barato e simples: checkout + agenda nativa + sala de vídeo + nota de sessão leve + compliance por padrão + repasse rápido. Plataforma de curso (Hotmart/Kajabi/Eduzz) trata "mentoria individual" como acesso a conteúdo (sem agenda, sem sala, sem prontuário). Ferramenta de clínica (SimplePractice/TheraPlatform) tem agenda+prontuário mas é cara e sem motor de venda/afiliado. **O buraco é uma camada de "comércio de sessão 1:1".**
2. **Reusa ~80% do que já temos.** O único fornecedor genuinamente novo é o de **vídeo ao vivo**. Agendamento, pagamento e repasse são código sobre Stripe/Supabase que já rodam.
3. **NÃO é "só código" em UM cenário:** se virar **terapia clínica licenciada** (dados de saúde/PHI, HIPAA nos EUA), o custo pula para **~US$950–1.450/mês fixo** (Supabase HIPAA ~$950/mo + vídeo com BAA). Para **coaching/mentoria/wellness** (avatar da Nicaele, criadores US), é **~US$50/mês** e o MVP sai em **~10-13 sessões de dev**.
4. **Recomendação:** 1:1 entra como **FASE 2 (pós-launch)**, MVP enxuto atrás de um flag. O launch atual segue com os **adds já confirmados** (IA conselheira, vídeo híbrido, sidebar flutuante, messages, tutorial). Meter um vertical 1:1 inteiro antes do launch — com os founder-gates ainda abertos (Supabase pago, Stripe LIVE) e 0 GMV — atrasa o que importa agora.
5. **Uma pergunta trava o custo:** coaching (default reversível, ~$50/mo) **ou** terapia clínica licenciada US (HIPAA, ~$1k/mo)? Construo o caminho coaching; HIPAA vira add-on quando/se um criador for atender saúde clínica.

---

## 1. Dores que validam (por que o 1:1 é a jogada)

| # | Dor | Fonte |
|---|---|---|
| 1 | Plataforma de curso é para conteúdo assíncrono, não p/ sessão síncrona ("Kajabi não substitui gestão de prática/notas clínicas") | Hummingbird, Practice Better |
| 2 | Taxa alta + reajuste sem aviso (Hotmart 9,9%+R$1; Kajabi 2025 gerou petição/cancelamentos) | Tactus, WeThriveByDesign |
| 3 | Sem agendamento nativo robusto (Kajabi Scheduler: 1 agenda p/ tudo, sem exceção de data) | Kajabi Help |
| 4 | LGPD: dado de sessão é sensível; CFP Res. 09/2024 responsabiliza o profissional, não a plataforma | CRP-MG, CFP |
| 5 | HIPAA (US): fim da tolerância pandêmica em 2023 deixou quem usa ferramenta genérica fora de conformidade | Patient Protect |
| 6 | Sem prontuário/notas de sessão (diferencial exclusivo de practice-management) | Practice Better |
| 7 | Saque/repasse travado por chargeback (bloqueio até 90d, taxa mínima de saque) | Jusbrasil, ReclameAqui |
| 8 | Suporte lento — crítico porque a sessão é AO VIVO | ReclameAqui |
| 9 | Sem CRM-lite: gestão em planilha "quebra" em 10-15 clientes ativos | ANHCO, Nutshell |
| 10 | No-show 20-40% sem lembrete+cobrança antecipada nativos | Greminders |
| 11 | "Mentoria individual" vendida e entregue sem estrutura de sessão (reclamação formal) | ReclameAqui |

**Stack de gambiarra atual (5-7 ferramentas p/ 1 sessão):** Hotmart/Kajabi (venda) + Calendly/Acuity (agenda) + Zoom/Meet (vídeo) + Stripe/Pix (pgto) + Notion/Sheets (histórico) + WhatsApp (combinar/lembrar) + Google Calendar (sync). Essa fragmentação **é** o produto que a gente pode absorver.

---

## 2. O que MUDA na plataforma (adicionar / mudar / tirar / manter)

| Componente | Decisão | Detalhe | Custo novo |
|---|---|---|---|
| **Vídeo ao vivo** | **COMPRAR** (Whereby Embedded) | iframe embutível em minutos; ~US$0,004/min; BAA add-on **US$16,99/mo** (o mais barato do mercado — Daily/LiveKit cobram $500/mo). Alternativa: Daily.co / LiveKit self-host só em escala | ~$0-50/mo (coaching) |
| **Agendamento** | **CONSTRUIR** no Supabase | 2 tabelas (`availability`, `bookings`) + constraint anti-overlap (`EXCLUDE USING gist` em tstzrange). NÃO trazer Cal.com (= 2º backend p/ manter). Sync Google/Outlook só quando cliente pagante pedir (YAGNI) | $0 |
| **Intake/anamnese** | **CONSTRUIR** | formulário → linha no banco. Pagar $99/mo (Jotform) só por form = desperdício | $0 |
| **Prontuário/notas** | **CONSTRUIR leve, ADIÁVEL** | começa como nota em texto; CRUD S/O/A/P depois. Só vira bloqueador com volume de dados de saúde | $0 |
| **Pagamento** | **MUDA** (sobre Stripe já existente) | (a) cobrar na marcação com política de reembolso (o hold/captura manual do Stripe **expira em 7d e exclui "healthcare"** de extensão — não serve p/ agendamento distante); (b) pacote = 1 cobrança de N créditos + contador na nossa tabela; (c) no-show = 2 estados novos (`CLIENT_NO_SHOW`/`PROVIDER_NO_SHOW`) disparados pelo webhook "entrou na sala" do vídeo | $0 (fees normais) |
| **Repasse ao criador** | **REUSAR** motor `release-payouts` | mesma máquina de estados; troca só o gatilho: de "compra + 30d" para "sessão concluída + 24-48h de disputa". Não é mecanismo novo | $0 |
| **Compliance** | **LGPD já coberto** (RLS + hosting sa-east-1 + consentimento). **HIPAA só se clínico** | HIPAA obriga BAA em todo fornecedor que toca PHI → Supabase Team+add-on (~$950/mo) + vídeo com BAA. Atrás de flag | $0 ou ~$950/mo |
| **Design** | **NOVO bloco de UI** (o clone Hotmart NÃO cobre 1:1) | precisa: página de agenda pública, sala de sessão, CRM-lite (cliente/histórico/pacote/status). Mantém a pele Ink Indigo + Brass já definida | — |

**Resposta direta às perguntas do Patrick:**
- *Precisa de outro programa?* Não — 1 serviço novo (vídeo). O resto é código no que já temos.
- *Precisa de mais API?* Só a de vídeo (+ opcional Cal.com/HIPAA, adiados).
- *Gasto a mais?* ~US$50/mo no cenário coaching; ~US$1k/mo só no cenário clínico-HIPAA.
- *Só edição de código ou os selos/integrações bastam?* Os selos (Stripe/Supabase) bastam p/ coaching; falta **1 integração** (vídeo). Pagamento **muda** (nova máquina de estado de booking).
- *Muda o design da inspiração Hotmart?* O que foi clonado (cursos) **continua**; o 1:1 é UI **nova por cima**, mesma pele.

---

## 3. Onde encaixa no PLANO (refino)

**LAUNCH (agora) — cursos + adds confirmados:**
- **IA conselheira no painel do produtor/professor** (DeepSeek + fluxo n8n atrás) — backend novo a planejar/construir. Sidebar de IA **flutuante**.
- **Vídeo híbrido modelo Eduzz** — YouTube embed (criador sobe no YT e cola) **+** upload nativo já preparado p/ plugar **Bunny** depois.
- **Messages** (útil), **Tutorial** (importante), **paths** úteis religados.
- Religar sidebar (`contexts: []` → `["teacher"]` p/ Cupons/Coproduções/Equipe/Integrações/Payouts) + passada de design Cosmos→pele nossa.

**FASE 2 (pós-launch, pós founder-gates) — 1:1 MVP:** agenda + vídeo (Whereby) + Stripe-serviço (capture na marcação, no-show, pacotes) + CRM-lite. Cenário coaching.

**FASE 3 — 1:1 avançado:** prontuário estruturado, sync de calendário, HIPAA se o avatar for clínico.

---

## 4. Estimativa de tempo (sessão de dev ≈ 4h; multiplicador realista aplicado)

| Bloco | Sessões | Observação |
|---|---|---|
| Vídeo híbrido (YT embed + upload Bunny-ready) | 2-3 | menor lift, fully specced |
| IA conselheira (backend n8n+DeepSeek + sidebar flutuante + wiring) | 4-6 | backend novo — maior incerteza |
| Messages + tutorial + paths + religar sidebar | 3-4 | + passada de design |
| **1:1 MVP (Fase 2)** | **10-13** | 2-3 semanas part-time; cenário coaching |
| 1:1 + HIPAA (Fase 3, só se clínico) | +3-5 | + ~$1k/mo fixo + revisão jurídica externa |

Sem contar os **founder-gates que bloqueiam o launch** (Supabase Free→pago, rotacionar service_role + Stripe LIVE, Turnstile, TOTP, logo) — esses são pré-requisito e independem de dev de feature.

---

## 5. Fonte das decisões (URLs-chave)

Dores: hummingbirdmentoring.com · practicebetter.io · tactus.com.br · CFP/CRP-MG · patient-protect.com · reclameaqui (Hotmart/Hubla). Anatomia/custos: cal.com/pricing · daily.co/pricing · livekit.com/pricing · whereby.com/information/embedded/pricing · stripe.com/billing/pricing · simplepractice/theranest/jane. Técnico/compliance: docs.stripe.com/payments/extended-authorization · supabase.com/docs/guides/security/hipaa-compliance · CFM Res. 2.314/2022.

---

## 6. DECISÕES TRAVADAS (Patrick, 2026-07-14)

1. **1:1 = Fase 2, pós-launch.** Launch sai com cursos + adds confirmados (IA conselheira, vídeo híbrido, sidebar religada, messages, tutorial). Não atrasa o go-live.
2. **Perfil = coaching/mentoria/wellness.** Sem HIPAA. Custo ~US$50/mês. HIPAA vira add-on futuro sem retrabalho (MVP agenda+vídeo+Stripe é o mesmo).
3. **Código começa pelo vídeo híbrido (YT embed + upload Bunny-ready), em SESSÃO NOVA via GSD** (plan-phase → execute), com handoff. Handoff: `HANDOFF-SESSAO-VIDEO-HIBRIDO.md` nesta pasta.
