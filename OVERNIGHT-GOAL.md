# OVERNIGHT — 2026-08-20

Rodada autônoma autorizada pelo fundador: *"aplique tudo, não pergunte nada, vá até onde der sozinho."*

## OBJETIVO

Duas features implementadas no repo, com teste e migração, prontas para revisão em PR:

**A — Domínio próprio** (custom domains multi-tenant na Vercel)
**B — Página de captura/vendas editável** por curso, com templates e cota por plano

## PRONTO QUANDO — todos verdes, verificável por comando

| # | Critério | Comando |
|---|---|---|
| 1 | Typecheck limpo | `npx tsc --noEmit` → exit 0 |
| 2 | Suíte verde, sem regressão | `npx vitest run --reporter=dot --maxWorkers=2` → exit 0, **≥ 625 testes** |
| 3 | Lint limpo | `npx eslint .` → exit 0 |
| 4 | Migração de domínio existe | `ls supabase/migrations/*custom_domain*.sql` |
| 5 | Migração de landing existe | `ls supabase/migrations/*landing*.sql` |
| 6 | Roteamento por host no proxy | `grep -q "custom domain" src/proxy.ts` |
| 7 | Testes de deriva novos | `entitlements.test.tsx` cobre `customDomains` e cota de landing |
| 8 | PRs abertos | `gh pr list` mostra os PRs desta rodada |

**Baseline registrada antes de começar:** typecheck exit 0 · 103 arquivos / 625 testes verdes / 122s · branch `main` limpa em `294897e`.

## FORA DE ESCOPO ESTA NOITE

- ❌ E-mail marketing (ordem explícita do fundador: *"deixa para depois"*)
- ❌ Deploy em produção
- ❌ Aplicar migração no Supabase de produção
- ❌ Merge de qualquer PR
- ❌ Criar/rotacionar credencial (`VERCEL_TOKEN` de produção)
- ❌ Adicionar domínio real de terceiro na conta Vercel
- ❌ Qualquer gasto

## PENDÊNCIAS DE MANHÃ (exigem o Patrick)

1. **`VERCEL_TOKEN` como env var de produção** — o código lê do servidor; o valor é credencial e nunca passa por mim
2. **Aplicar as migrações no Supabase de produção**
3. **Revisar e mergear os PRs** desta rodada
4. Os **4 PRs de ontem** (#100 workspace switcher, #101 diálogos fora da tela, #102 admin bootstrap, #103 copy) continuam abertos
5. 🔴 As rotações de credencial pendentes do `HANDOFF-SESSAO.md` §1 e §2 — `service_role` do Supabase e webhook Stripe LIVE

## FATOS CONFIRMADOS NESTA RODADA

- **Plano Vercel: Pro.** O repo está no team `SKILLSETMIND` (`team_1IeM4zznArJzdiwM2xHNKOTK`) e o plano Hobby não permite times. Logo: **custom domains ilimitados** (soft limit 100k/projeto), **SSL automático e grátis**, sem custo por domínio. Isso destrava o sub-plano 7, que estava parado por essa pergunta.
- Rate limits da API de domínios: 100 add/h · 50 verify/h · 100 remove/h por team.
- `@vercel/sdk` **não** está instalado — entra como dependência nova.
- CLI da Vercel existe e está autenticado como `opatricksimon-7537` (chamar sempre com `env -u VERCEL_TOKEN`).

## TETO ANTI-LOOP

Se a conclusão for rejeitada 3× seguidas **sem progresso novo** entre elas: parar, escrever handoff, encerrar. Nunca insistir contra bloqueio que depende de decisão humana.

## ENCERRAMENTO

Ao terminar ou parar pelo teto: handoff em `HANDOFF-OVERNIGHT.md` + rodar `overnight-stop.ps1`.
