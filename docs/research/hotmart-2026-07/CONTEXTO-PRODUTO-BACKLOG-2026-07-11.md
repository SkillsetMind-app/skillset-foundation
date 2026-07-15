# SkillsetMind — Contexto de Produto & Backlog
> **Recebido via chat em 2026-07-13** (origem: sessão de estratégia + pesquisa de mercado no Claude.ai, 11/jul/2026).
> Documento-norte do produto. As decisões da Seção 3 são finais salvo indicação contrária.

**Para:** Claude Code (repo `opatricksimon/skillset-foundation`)
**Como usar:** Leia tudo antes de tocar em código. As decisões da Seção 3 são finais salvo indicação contrária. O backlog da Seção 7 está em ordem de prioridade.

---

## 1. O que é o produto

Marketplace de cursos + infraestrutura de negócio para **psicólogos, terapeutas e profissionais de desenvolvimento pessoal** (Brasil + EUA).

- **Entidade:** Skillset USA · operador SkillsetMind, 26 Broadway, New York, NY 10006 · lei de NY + arbitragem AAA
- **Domínio:** skillsetmind.com (www + apex) · e-mails @skillsetmind.com
- **Posicionamento (validado por pesquisa de dores em Zenklub, BetterHelp, Talkspace, Headway, Hotmart, Kajabi):** o oposto das plataformas extrativas. Aqui **o profissional é dono da audiência, dos dados e do contrato**. A "Skillset Promise" da homepage (fee-lock 24 meses, paridade de features, export ZIP 1-clique, cancelamento 1-clique, proteção de fundos, suporte humano com SLA) é compromisso de produto, não copy de marketing. **Nenhuma feature nova pode violá-la.**
- **Economia:** plano Free = 8% take rate (92% pro creator) · Plus com comissão até 0% · 30+ moedas via Stripe · wallet com ledger

## 2. Stack atual (não trocar sem razão forte)

- **Next.js** na Vercel · projeto `skillset-foundation` (prj_QwusKvUDMXibQHZG19FYydmsrZkH) · deploy automático via Git
- **Supabase** (project `ijtikldtjvsbtwszokvs`) — auth, Postgres, RLS. Migração Firebase→Supabase 100% concluída (04/jul). ⚠️ Ainda no plano **Free** — upgrade obrigatório antes do 1º aluno pagante (sem PITR, projeto pausável)
- **Stripe Connect Express** — payout de creators. Clearance de 30 dias > janela de refund de 7 dias (resolve por design o bug de refund-after-payout) + cap incondicional em admin refund + `audit_log`
- **Bunny Stream** — upload TUS, playback com token assinado e **entitlement gate explícito** (não remover)
- **n8n + DeepSeek** — help assistant público + teach advisor. ⚠️ Guardrail prompt pendente
- **PostHog** — analytics
- **Segurança:** auditoria full-platform de 07/jul (40 findings, 6 money paths corrigidos) · RLS de enrollment em `course_assets` · HIBP k-anonymity check próprio (Supabase Free não tem nativo) · Turnstile dormant (falta env var) · CSP em report-only

## 3. Decisões de produto (sessão de 11/jul)

### 3.1 Quem entra: aberto com selos — NÃO fechado, NÃO segregado

- Aceita psicólogos **e** terapeutas/coaches. **Mesma interface para todos.** Diferenciação por **selos de verificação**, não por áreas separadas.
- Racional: a dor documentada (Zenklub etc.) é o profissional regulado ser **confundido** com não-regulamentado que promete cura — não é a coexistência em si. Interface única = metade do custo de manutenção (founder solo).

### 3.2 Verificação em camadas (substitui a "aprovação cadastral" manual atual)

**Princípio: zero revisão humana no fluxo padrão.** Humano só vê a fila de exceção.

| Camada | Selo | Como valida | Automação |
|---|---|---|---|
| 0 (obrigatória p/ receber) | — | **Stripe Connect KYC**: identidade + fiscal (CPF/CNPJ ou SSN/EIN) + conta bancária | Já existe. O Stripe faz tudo. |
| 1 | **Profissional verificado** | BR: CNPJ **ativo** via consulta pública (`https://brasilapi.com.br/api/cnpj/v1/{cnpj}` ou minhareceita.org) + CNAE compatível. EUA: business registration (Secretary of State lookup onde houver) ou coberto pelo Stripe KYC | n8n, 100% automático |
| 2 | **Psicólogo · CRP verificado** (BR) / **Licensed (estado)** (EUA) | BR: Cadastro Nacional do CFP (cadastro.cfp.org.br) — nome + CRP + situação ativa. EUA: state board license lookup | n8n, automático (scrape/API conforme fonte) |
| Opcional | **Formação verificada** | Upload de certificado/diploma → OCR + LLM valida: instituição existe, nome confere, área compatível | Automático com score |

- **CNAEs sugeridos p/ camada 1 (validar lista final):** 8650-0/03 (psicologia e psicanálise), 8690-9/01 (práticas integrativas e complementares), 8599-6/04 (treinamento em desenvolvimento profissional). CNAE fora da lista não reprova sozinho — só reduz score.
- **Honestidade dos selos:** CNPJ prova negócio real e rastreável, não competência. Cada selo comunica exatamente o que validou. Nunca inflar.
- **Scoring:** score composto (credencial + web presence + formação). Acima do limiar → auto-aprova. Abaixo do piso → auto-rejeita com motivo. Faixa intermediária → fila de exceção (única intervenção humana). **Toda decisão vai pro `audit_log`.**
- **Web presence check:** IA busca os links públicos informados (site, Instagram, LinkedIn) e avalia coerência básica (perfil existe? é da área? tem histórico?). Entra no score, nunca decide sozinho.

### 3.3 Formulário de pré-aprovação (spec)

Passos do wizard de cadastro de creator:

1. **Tipo de profissional:** psicólogo · terapeuta · coach/facilitador → define o fluxo de verificação
2. **País de atuação:** BR · US → define fontes de validação
3. **Credencial (condicional ao tipo/país):**
   - Psicólogo BR: número CRP + UF → validação automática no ato (feedback em segundos)
   - Psicólogo/counselor US: license number + estado
   - Terapeuta/coach BR: CNPJ → validação automática no ato
   - Terapeuta/coach US: business registration (opcional; Stripe KYC é o piso)
4. **Formação (opcional, destrava selo extra):** upload de certificado/diploma (PDF/imagem)
5. **Perfil profissional:** abordagens/modalidades (multi-select), anos de prática, bio curta, links públicos (site, Instagram, LinkedIn, YouTube)
6. **O que pretende publicar:** categoria(s) do catálogo (Seção 3.7)
7. **Aceite do código de conduta** (Seção 3.5) — checkbox com scroll obrigatório

UX: validações automáticas dão resultado **na hora** (CRP/CNPJ). Só o que precisa de OCR/análise entra em "em análise" com prazo comunicado. Estado do cadastro sempre visível no dashboard.

### 3.4 Revisão de curso: REMOVIDA como gate

- **Decisão:** credenciamento é o único portão. Curso aprovado → creator publica direto, sem revisão prévia.
- **Recomendação aceita (custo ~zero, não bloqueia ninguém):** scan **assíncrono pós-publicação** — LLM varre título, descrição e landing do curso contra o checklist de compliance (3.5). Violação grosseira → flag na fila de exceção + notificação ao creator. Nunca despublica automaticamente.

### 3.5 Compliance CFP como spec de produto (diferencial competitivo)

Vedações do CFP (Nota Técnica 1/2022 + código de ética) que valem para **psicólogos BR** e viram regras da casa + validador:

- ❌ Depoimentos de pacientes em publicidade
- ❌ Promessa de resultado ("garanto sua cura", "vida feliz")
- ❌ Autopromoção comparativa ("o melhor do mercado")
- ❌ Preço como isca / pacotes de sessões
- ❌ "Atendimento a qualquer hora"
- ✅ Obrigatório: nome completo + título + CRP em material de divulgação

**Feature derivada:** templates de página de venda "CFP-safe" + validador automático no editor. Pitch: "publica aqui e sua divulgação já sai em conformidade com o CFP". Responsabilidade ética é pessoal do psicólogo mesmo quando a plataforma publica — proteger o creator é proteger o negócio.

### 3.6 Matching/diretório de atendimento: FASE 2 — não construir agora

- A ideia original (matching estilo Tinder/Uber com reviews 5 estrelas de pacientes e gamificação) foi **descartada nesta forma**: review de paciente é infração ética CFP no BR, risco de confidencialidade nos EUA, e intermediação de atendimento = telessaúde + dado sensível de saúde (LGPD/HIPAA) = camada regulatória que não queremos agora.
- **Forma aprovada para o futuro (fase 2, pós-tração do marketplace):** **diretório de profissionais verificados** — perfil público (abordagem, formação, cidade, online/presencial) + quiz de triagem do visitante como *filtro de busca*. Contato **direto** com o profissional. A plataforma NÃO intermedia sessão, NÃO processa pagamento de consulta, NÃO guarda prontuário, NÃO tem review de paciente.
- Nada disso entra no backlog atual. Registrado só para não redesenhar do zero depois.

### 3.7 Catálogo: substituir integralmente

**Remover:** HR Management, Project Management, Effective Communication, Leadership Development (genéricos, diluem o nicho).

**Novas categorias (PT/EN):**

| PT | EN |
|---|---|
| Psicologia Clínica & Abordagens (TCC, psicanálise, humanista…) | Clinical Psychology & Approaches |
| Hipnoterapia | Hypnotherapy |
| Terapias Integrativas & Holísticas | Integrative & Holistic Therapies |
| Constelação Familiar & Trabalho Sistêmico | Family Constellations & Systemic Work |
| Saúde Mental — Fundamentos | Mental Health Foundations |
| Desenvolvimento Pessoal | Personal Development |
| Negócio & Carreira do Terapeuta (marketing ético, precificação, prática privada) | The Therapist's Business |
| Supervisão & Formação Continuada | Supervision & Continuing Education |

Cursos placeholder atuais (waitlist $49–149): substituir junto com as categorias.

### 3.8 Landing page: mostrar o produto (padrão Teachable/Kajabi)

- Adicionar seção "product tour" na home: **screenshots reais da plataforma** (dashboard do creator, player de vídeo, página de curso, wallet/earnings) dentro de mockups de device.
- Preferir screenshot real a imagem genérica de IA — mais crível e mais barato. Se usar imagem de pessoas, que seja composição com a tela real da plataforma visível.
- Referência de estrutura: demo tours oficiais de Teachable e Kajabi no YouTube (analisar antes de desenhar).

### 3.9 Camada de transformação & LTV (specs em sessão futura — placeholder)

- Escada de valor do creator: curso → grupo/cohort → 1:1
- Ferramentas de transformação do aluno: tarefas entre aulas, journaling, tracking de progresso
- Patrick vai detalhar as specs. Não implementar ainda; só não tomar decisões de arquitetura que inviabilizem isso.

## 4. Bugs & débitos conhecidos

1. **Sidebar aplica mudanças parcialmente pós-deploy.** Hipótese nº 1: **componente duplicado** (padrão pós-migração — ex.: `SidebarOld`/`SidebarNew` coexistindo, páginas diferentes renderizando versões diferentes). Hipótese nº 2: CSS legado com especificidade maior sobrescrevendo o novo. Hipótese nº 3 (menos provável): cache. **Começar caçando duplicatas de componente.**
2. **Resquícios da marca antiga** ("Skillset", skillset.app) em strings, e-mails, assets, metadata — varrer e limpar.
3. **Logo nova pendente** (Patrick fornece o asset; preparar os pontos de troca).
4. **Código morto da era Firebase** — mapear e remover em PR separado (não misturar com features).

## 5. Checklist do founder (só o Patrick pode fazer — lembrar ele, não tentar automatizar)

- [ ] Rotate da `service_role` key do Supabase
- [ ] Ligar Turnstile (env var na Vercel)
- [ ] Ativar Supabase Attack Protection
- [ ] Guardrail prompt nos agentes n8n
- [ ] TOTP no admin
- [ ] **Upgrade Supabase Free → pago antes do 1º aluno pagante**

(~30–40 min no total. Bloqueia launch.)

## 6. Go-to-market (contexto — não é tarefa de código, mas orienta prioridade)

- Cold-start: **curso âncora do avô** (autoridade + acervo) → **10–15 founding creators** recrutados 1-a-1 na rede existente, com condição de fundador travada + produção assistida do curso.
- Cada founding creator traz a própria audiência — a plataforma não precisa gerar demanda no launch.
- **Features que suportam isso ganham prioridade:** condição/flag de founding creator no plano, página pública de creator caprichada, cupons.

## 7. Backlog priorizado

**P0 — antes de qualquer feature**
1. Investigar e corrigir o bug da sidebar (Seção 4.1)
2. Varredura de resquícios da marca antiga (4.2)

**P1 — núcleo do relançamento**
3. Formulário de credenciamento novo (3.3) + pipeline de verificação automática (3.2): integrações CRP/CFP e CNPJ/BrasilAPI via n8n, scoring, fila de exceção, audit_log
4. Catálogo novo (3.7): categorias, remoção dos placeholders, seeds
5. Selos no perfil público e no card de curso (badge por camada verificada)

**P2 — polimento pré-launch**
6. Seção product tour na home (3.8)
7. Scan assíncrono de compliance pós-publicação (3.4)
8. Templates/validador CFP-safe no editor de página de venda (3.5)
9. Flag de founding creator + página pública de creator (6)
10. Limpeza do código morto Firebase (4.4)

**Não fazer agora:** diretório/matching (3.6), camada de transformação (3.9 — aguardando specs).

## 8. Princípios de engenharia (invariantes)

- Founder solo → **automação > processo manual**; fila de exceção mínima; nada que crie trabalho humano recorrente
- **Nunca capturar o contrato, os dados ou a audiência do profissional** (a lição Headway/Zenklub) — export e portabilidade sempre funcionais
- Todo money path passa pelo `audit_log`
- Nenhuma feature quebra a Skillset Promise
- Compliance CFP não é obstáculo, é spec de produto

---

## 9. Arquitetura de Lançamento (decisões de 2026-07-14 — FINAIS)

> Estudo de custos e análise competitiva completa: `ESTUDO-CUSTOS-PLANOS-2026-07-14.md` (mesma pasta).

### 9.1 US-FIRST
Launch focado no mercado americano (empresa é americana, Dr. Eton está nos EUA). BR simultâneo mas secundário. Entidade BR/subcontas Stripe = pós-caixa. Copy EN-first, moeda USD.

### 9.2 Modo lançamento: tudo grátis, assinaturas dormentes
Sem gate de entrada. Sistema de planos construído mas OCULTO (flag). Reativação quando o caixa engatar. Urgência explícita "condição de lançamento".

### 9.3 Dois trilhos de fundador
| | Founding Creator (pago) | Founding Builder (mérito) |
|---|---|---|
| Condição | US$497 único, **30 vagas** | Publicar o 1º curso em **60 dias** (primeiros **50**) |
| Comissão | **0% por 3 meses → 2% vitalício** | **6% vitalício** (blindado contra aumentos futuros) |
| Extras | Selo + beta access + suporte prioritário + voz no roadmap | Selo Founding Builder |

### 9.4 Planos dormentes (reativação pós-launch, calibrar com dados reais)
Free 8% / Creator ~US$39 3% / Pro ~US$99 1%. **Sem feature-lock** (Promise: paridade de features). Diferenciação = comissão + rate limit IA + suporte + perks. Vídeo "ilimitado" em TODOS (fair use no ToS + tripwire interno invisível: >100GB com 0 vendas/90d → revisão de novos uploads, nunca da entrega).

### 9.5 Doutrina de taxas: "taxa só onde há custo real, publicada, opt-in"
- ❌ Taxa de player por venda (custo Bunny = 1–3% do take; mataria "8% e acabou") · ❌ taxa de saque
- ✅ Parcelamento BR (repasse/absorve, custo Stripe + margem publicada, quando ativar BR) · ✅ Antecipação de recebíveis (feature opt-in futura, Stripe Instant Payouts + margem) · ✅ FX repassado à taxa publicada, nunca spread escondido

### 9.6 Vídeo: híbrido (estilo Eduzz)
YouTube embed (custo zero) + upload nativo Bunny. Ambos em todos os planos.

### 9.7 Público-alvo em teste ("efeito boneca")
Messaging amplo ("terapeutas e profissionais do desenvolvimento humano"), selos diferenciam regulados. Medir por "tipo de profissional" do wizard → KPIs segmentados. Reavaliar avatar em ~90 dias por DADO.

### 9.8 Produto educacional vs serviço clínico (fluxo de reviews)
Plataforma vende SÓ produto educacional no launch → comprador = aluno, não paciente. Reviews de aluno habilitados COM filtro do validador CFP-safe (barra linguagem de resultado clínico). Rótulo não muda substância: terapia disfarçada de mentoria = clínico. Carimbo de advogado no fluxo final pré-launch.

### 9.9 Novos itens de backlog (detalhe no estudo, Adendo 3)
- **P1.5 — Assinatura como produto do creator** (recorrência via Stripe Connect): NOVO, ~2–3 sessões, money path novo. Não bloqueia launch (founding = pagamento único); fast-follow.
- **P2**: carrinho abandonado → funil do creator (captura + leads + página de vendas com editor de blocos + IA pré-preenche copy CFP-safe + checkout personalizado) → automações v1 (8 toggles)
- **Fase 3**: antecipação de recebíveis · parcelamento BR · mini-site + domínio · plataforma-como-afiliado (~50%) · afiliados recorrentes (estilo Skool) · afiliados comuns (incorporar durante o lançamento com cuidado no código existente)
- **AI advisor no painel do professor** (sidebar flutuante, DeepSeek + n8n) + tutorial + messages: escopo de launch (decisão de 14/07, sessão anterior)

### 9.10 Mapeamento Hotmart (em andamento)
Varredura do painel do produtor (menu lateral, fluxo de criação de curso/programa, módulos/liberação, pagamentos: parcelamento repassa/absorve + assinatura) → gap analysis vs nossa sidebar → alimenta o plano de código do launch. SEM copiar: promoções internas, ofertas de crédito. COM: evolução/progresso do creator.
