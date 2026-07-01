# SkillsetUSA → Plataforma de Psicologia & Desenvolvimento Humano — Visão & Roadmap

> **Criado:** 2026-06-30 (madrugada) a partir de brain-dump do Patrick.
> **Status:** ENFILEIRADO. Executar APÓS concluir a migração de backend Firebase→Supabase (em andamento).
> **Modo:** Execução 100% autônoma autorizada pelo Patrick ("pode migrar API, Stripe, tudo que precisar"). Ele se ausentou.
> **Fato crítico confirmado por ele:** PRÉ-LANÇAMENTO, **zero clientes** ("a gente não tem cliente"). → o corte do Stripe deixa de ser alto-risco-irreversível.

---

## 0. North Star (a imagem final do quebra-cabeça)

Marketplace de cursos/área-de-membros **especificamente adaptado para profissionais de psicologia e desenvolvimento humano**: psicólogos, terapeutas, terapeutas holísticos/alternativos, hipnoterapeutas, coaches. Concorrentes de referência: **Teachable, Thinkific, Kajabi, Skool** — design deve ser competitivo com eles, mas o posicionamento é de nicho.

Diferencial central vs concorrentes: **IA consultiva embutida** (suporte personalizado a professor e aluno).

Origem: avô do Patrick é fundador de uma universidade de psicologia na Guiana Inglesa, com base em NY; deu a ideia e co-elaborou o escopo. Patrick é cofundador/construtor.

Sub-nichos futuros (segmentação de conteúdo): psicologia para homens / mulheres / casais / cristãos; terapias holísticas; constelação sistêmica familiar; etc.

---

## 1. A jornada completa que precisa funcionar (fim-a-fim)

Professor entra → cadastro → onboarding (perguntas/respostas) → dados capturados e armazenados → sobe cursos/programas (upload de vídeos) → área de membros gerada → gera link de checkout → manda pro aluno → aluno paga → recebe e-mail → faz login → acessa área de membros → assiste (sem travar, autoplay estilo Netflix/Hotmart) → avalia (5★) e comenta → participa da comunidade → conclui → gera certificado (PDF) → repasse automático de pagamento (Stripe tira a dela, plataforma tira a nossa %, professor recebe a dele).

---

## 2. Prioridade P0 — IMPRESCINDÍVEL / AGORA (o núcleo tem que FUNCIONAR)

1. **Concluir migração de backend** Firebase→Supabase (dados + RLS + Auth + Storage + Cloud Functions→Edge Functions + Stripe). Migração motivada por bloqueio de billing do Firebase.
2. **Auth fluido:** cadastro + login funcionando ponta-a-ponta, sem fricção.
3. **Onboarding em etapas** (perguntas/respostas) — verificar se cada etapa está funcionando E com design adequado; dados caem em lugar acessível (o Patrick precisa ter acesso a essas informações depois).
4. **Armazenamento:** onboarding-data + **vídeos dos professores** (upload → storage → aparece na área de membros do curso comprado). Definir Supabase Storage vs Cloudflare R2 (custo/entrega de vídeo).
5. **Área de membros:** aluno vê o curso que comprou; professor **consegue editar** a área de membros.
6. **Pagamento funcionando** (Stripe Connect marketplace já existe no código) — checkout, split, repasse.
7. **Botões, marketing play, fluxos** — verificar que tudo clica e opera.
8. **Análise de segurança** detalhada (RLS, pagamento, exposição de dados).
9. **Verificação de design desktop + mobile** — adequado e competitivo com Teachable/Thinkific/Kajabi/Skool.

---

## 3. Prioridade P1 — DIFERENCIAL / logo após o núcleo

- **IA consultiva embutida** (DeepSeek — modelo **v4 pro** por padrão, alterna para **v4 fast** quando adequado). Janelinha de chat no **canto inferior esquerdo**. Conhecimento SEGREGADO por papel: professor tem acesso a um conhecimento/suporte (fora da área de membros); aluno tem outro. Prioridade: suporte SUPERIOR e personalizado ao professor; aluno também bem servido.
- **i18n:** Inglês (1ª língua) → Espanhol (2ª) → Português (3ª), auto por **geolocalização + dispositivo**; extensível a mais línguas. (Já existe base i18n no código.)
- **Área de membros estilo Netflix:** cursos/módulos como cards com capa; comprados = coloridos/normais; **não comprados = cinza/apagados + cadeado**; clique no cadeado → opção de comprar (ver Decisão B).
- **Player:** aulas passam automaticamente (autoplay estilo Netflix), sem travar.
- **Avaliação 5★ + comentários** nas aulas; professor responde; comentários podem ser **curtidos de verdade**.
- **Comunidade** (ver Decisão A).
- **Calendário** do professor: agendar lives/aulas ao vivo/masterclass (grátis ou pago).
- **Certificado (PDF):** 1–2 templates padrão; auto-preenche nome do professor/curso; aluno preenche o próprio nome UMA vez com **confirmação enfática em pop-up** ("não poderá corrigir depois") → anti-falsificação; depois baixa PDF. Barra de progresso; cursos pagos normais, não pagos bloqueados.
- **Checkout do professor:** setor específico pra ele visualizar/copiar o link de checkout e mandar pro aluno; checkout de alta conversão.
- **Modelos de pagamento** (validar viabilidade no Stripe, relatar workaround se não nativo):
  - Assinatura com duração definida pelo professor (3/6/12 meses).
  - Parcelado no crédito (retira limite) — professor escolhe máx. de parcelas; professor decide se **passa os juros pro aluno** ou absorve.
  - Recorrente (mensal, sem consumir limite total) — débito ou crédito.
  - Pagamento único.
  - **Liberação manual de acesso** (aluno pagou presencialmente/fora da plataforma → professor libera acesso à área de membros).
- **Escassez / membros fundadores:** gatilhos para os primeiros 10/20/50/100 (condições especiais/vitalícias).
- **Planos simplificados:** reduzir barreira de objeção → **1 gratuito + 1 pago** (pago libera IA e recursos premium). Nada de muitos planos agora.
- **Tour/tutorial onboarding** guiado (obriga a clicar em lugares-chave), principalmente pro professor, também pro aluno.
- **Storefront do professor:** ele define 1–2 cores (paleta) → área de membros se adapta **sutilmente** (ex.: azul-marinho + dourado). Base `storefront` já existe no `user-profile.ts`.

> Nota de vocabulário: "professor" = professor **ou** terapeuta/psicólogo/hipnoterapeuta/coach — qualquer avatar do público-alvo.

---

## 4. Prioridade P2 — FUTURO (separar agora, plugar depois)

- **Página/fluxo para EMPRESAS e UNIVERSIDADES** (treinamento de funcionários; universidade oferecendo programas ao público externo e lucrando na plataforma). Decidir na hora: adaptar página existente vs criar 100% nova. Contatos via base do avô em NY.
- **Templates de página de captura / página de vendas** para o professor editar (imagens, oferta) com botão → checkout dele; suporte de IA opcional (pode virar recurso pago).
- **Separação paga vs gratuita a nível de usuário** (professor assinante recebe mais recursos). Hoje a plataforma NÃO distingue curso pago/gratuito em funcionalidade.
- **Sub-nichos** como segmentação de conteúdo/descoberta.

---

## 5. Decisões de produto que o Patrick me pediu para DECIDIR (lente CEO + Produto)

**Decisão A — Onde fica a Comunidade?**
→ **DENTRO da área de membros, acessível a professor E aluno.** Alinha com Skool/Kajabi (comunidade integrada à experiência do curso) e é a preferência que o Patrick sinalizou. (Rever depois se convém uma vitrine pública da comunidade para aquisição.)

**Decisão B — O que o aluno vê na área de membros?**
→ **Opção 2 (painel estilo Netflix)** com trilhas/módulos; comprados coloridos, **não comprados em cinza + cadeado**. **Variante B** (affordance de compra no card bloqueado) — porém **configurável pelo professor por curso** (ele liga/desliga a compra direta na plataforma, respeitando venda presencial/high-ticket que às vezes converte melhor no 1:1). Isso dá a superfície de upsell sem tirar o controle do professor.

---

## 6. Fronteira de autonomia & risco (protocolo do Patrick)

- Ele está ausente e autorizou **execução 100% autônoma**, incluindo migrar Stripe/APIs.
- **Pré-lançamento, zero clientes** → não há dinheiro real/payout em trânsito para corromper. Logo, construo e testo TUDO (inclusive Stripe em modo test) e posso carregar até o corte de produção.
- **Único item que fica PENDENTE para o retorno dele** (por ser o de maior risco residual mesmo pré-launch): apontar a produção real para o novo backend + ativar **Stripe LIVE** de fato cobrando cartão real. Deixo 100% pronto e testado, sinalizado, para ele dar o "vai" final — a menos que ele já tenha dito explicitamente para virar (ele disse "pode migrar o Stripe, tudo") → nesse caso viro em TEST provado e deixo o toggle LIVE documentado.
- Não fazer `git push` (delegar @devops). Nunca gravar segredos em disco versionado — só referência ao cofre.

---

## 7. Entregáveis finais que ele pediu ao concluir

1. Sugestões de **features novas** para elevar qualidade / diferencial vs concorrentes.
2. **Bugs** encontrados + correções.
3. **Análise de segurança** detalhada.
4. Verificação funcional: pagamento, botões, área de membros, edição da área de membros pelo professor, marketing play, login/cadastro fluido, etapas de onboarding (design + destino dos dados), upload→storage→playback de vídeo, avaliação/comentário/like, comunidade, calendário, certificado, progresso, cards bloqueados.
5. Verificação de **design desktop + mobile** competitivo (Teachable/Thinkific/Kajabi/Skool), com foco de nicho.

---

## 8. Como vou estruturar a execução (quando retomar)

Via GSD (RULE-GSD-MANDATORY) + workflows multi-agente (ultracode ON). Sequência macro:
1. **Fechar migração backend** (aplicar SQL → advisors de segurança → auditoria adversarial de RLS → Auth → Storage → Edge Functions → Stripe test → wiring do app ao Supabase).
2. **Auditoria fim-a-fim** do que já existe (o que funciona, o que quebra) — mapear o gap vs esta visão.
3. **GSD roadmap** por fases priorizadas P0→P1, executando autônomo, verificando cada fase.
4. **Relatório final** com os entregáveis da seção 7.

---

*Fonte: brain-dump verbatim do Patrick em 2026-06-30. Este documento é a "fila" que ele pediu para eu registrar antes de retomar a migração em andamento.*
