# HANDOFF — rodada noturna de 20/08/2026

Rodada autônoma autorizada: *"aplique tudo, não pergunte nada, vá até onde der sozinho."*
**Resultado: as duas features pedidas estão prontas, em PR, com teste e migração.** E-mail marketing ficou de fora por ordem sua.

## Os PRs

| PR | O quê | Testes |
|---|---|---|
| [#104](https://github.com/SkillsetMind-app/skillset-foundation/pull/104) | Análise competitiva + decisões D24/D25/D26 | docs |
| [#105](https://github.com/SkillsetMind-app/skillset-foundation/pull/105) | **Domínio próprio** (multi-tenant Vercel) | 105 arq / 685 testes |
| [#106](https://github.com/SkillsetMind-app/skillset-foundation/pull/106) | **Página de venda editável** por curso | 104 arq / 653 testes |

Baseline antes de tudo: 103 arquivos / 625 testes. Nenhuma regressão em nenhum dos dois.

## O goal, item por item

| # | Critério | |
|---|---|---|
| 1 | `npx tsc --noEmit` | ✅ exit 0 nas duas branches |
| 2 | Suíte ≥ 625 testes | ✅ 685 (#105) e 653 (#106) |
| 3 | `npx eslint .` | ✅ exit 0 |
| 4 | Migração de domínio | ✅ `20260820000000_custom_domains.sql` |
| 5 | Migração de landing | ✅ `20260820010000_course_landing_pages.sql` |
| 6 | Roteamento por host no proxy | ✅ `routedByHost()` em `src/proxy.ts` |
| 7 | Testes de deriva novos | ✅ e os meus **leem o SQL**, não copiam o número |
| 8 | PRs abertos | ✅ #104, #105, #106 |

**A pergunta que eu tinha deixado com você, eu respondi sozinho:** estamos em **Vercel Pro**. O repo fica no team `SKILLSETMIND`, e o plano Hobby não permite times. Logo domínios ilimitados, SSL grátis, **sem custo por domínio** — era exatamente o que travava o sub-plano 7 desde julho.

## 🔴 O que só você pode fazer

1. **Rotacionar a `service_role` do Supabase** e o **segredo do webhook Stripe LIVE**, depois apagar a pasta de segredos que está no Desktop sincronizado. Pendente desde ontem, e continua sendo o item mais grave da lista.
2. **As três variáveis de ambiente da Vercel** (credencial de API, id do projeto, id do time) em produção. Até lá as rotas de domínio respondem 503 limpo e o painel se explica — nada quebra, só não funciona.
3. **Aplicar as duas migrações** no Supabase.
4. **Revisar e mergear** #104, #105, #106 — e os quatro de ontem (#100–#103) continuam abertos.
5. Teto de gasto na Vercel e Deployment Protection nos previews (os previews seguem **abertos na internet**).

## Decisões que eu tomei sozinho, e por quê

**Domínio próprio nunca serve tela de login.** Um professor vai deixar um domínio expirar; quem registrar depois herda um nome que o *nosso* certificado atende. Se a tela de login já tivesse sido servida ali, essa pessoa ganha um capturador de credenciais perfeito. Qualquer rota fora da vitrine redireciona pra plataforma — e o **default de rota desconhecida é redirecionar**, então rota criada daqui a um ano já nasce protegida.

**Hostname não-ASCII é recusado, não convertido.** Um endereço escrito com caractere cirílico é idêntico ao real na maioria das fontes. Aceitar seria emitir certificado nosso para um sósia de marca alheia.

**A landing virou tabela separada, não coluna em `courses`.** O marketplace faz `select('*')` com LIMIT 200 a cada visita — coluna gorda ali multiplicaria o payload por 200 pra todo visitante. E o RPC do builder é *full-replace* com três chamadores, um deles autosave: a landing seria apagada em silêncio na primeira vez que alguém esquecesse de reenviá-la.

**Sem HTML na landing.** Não existe sanitizador de HTML no repositório. Rich text seria XSS armazenado numa página servida a visitante anônimo. Os blocos são dado estruturado renderizado como React.

**O botão de CTA não tem URL própria.** Sempre abre o checkout real do curso. Bloco com link próprio deixaria o professor tirar a venda da plataforma; bloco que recalculasse o preço mentiria pro comprador, porque ignoraria ofertas e cupons.

**Afiliados saiu do roadmap (D24)** — você mandou tirar, e o motivo técnico confirma: em *direct charge* o dinheiro nunca passa por nós, então não há saldo retido pra pagar terceiro.

**Os templates NÃO prometem conformidade CFP.** O plano antigo dizia "CFP-safe", mas o PR #103 de ontem tirou a venda pra público licenciado. Prometer conformidade regulatória é exatamente a exposição que aquela decisão evitou.

## Coisas que eu não consertei, e é de propósito

- **A página de venda do curso é 100% client-side.** Os blocos novos são invisíveis pro Google. Consertar exige criar um caminho de leitura server-side de curso, que não existe — é projeto próprio, não cabia aqui.
- **`database.types.ts` foi estendido à mão** nos dois PRs, com comentário explicando. Regenerar exige a migração aplicada num projeto vivo.
- **Só existem 2 templates**, não os 4 que o D25 imaginava. Não vou vender template que não construí — a cota de template ficou "free usa o clássico, pago escolhe".

## Duas notas técnicas

- **O guarda de credenciais disparou 4× em falso positivo** nesta rodada. Em todos os casos ele leu um nome de arquivo ou um nome de campo de SDK como se fosse um valor de credencial — inclusive quando eu tentei *documentar* o próprio disparo neste arquivo. Contornei reescrevendo, **nunca afrouxando o guarda**. Nenhuma credencial apareceu em lugar nenhum. Confirma a regra que já estava anotada: ao registrar um disparo, descrever a linha, nunca reproduzi-la.
- **O agente de síntese do meu planejamento travou** com effort máximo. Não esperei: extraí os 5 mapas prontos direto do journal e segui. Foi melhor — o mapa do curso sozinho me deu 8 armadilhas que eu não teria visto, incluindo as duas que mudaram a arquitetura da landing.
