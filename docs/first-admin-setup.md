# Primeiro administrador

Ninguém vira administrador pelo site, de propósito. O **primeiro** admin é criado
à mão no banco de dados. Depois dele, os próximos são promovidos pela tela de
operações (`/ops`).

## Como criar o primeiro admin

1. A pessoa cria a conta normalmente pelo site (`/signup`) e confirma o e-mail.
2. No painel do Supabase (o serviço que guarda o banco e o login), abra o
   **SQL Editor** (a tela onde se digitam comandos para o banco) do projeto de
   produção.
3. Rode o comando abaixo, trocando o e-mail:

   ```sql
   begin;
   set local skillset.trusted_write = 'on';
   update public.users
      set roles = coalesce(roles, '[]'::jsonb) || '["admin"]'::jsonb
    where lower(email) = lower('pessoa@exemplo.com');
   commit;
   ```

   O banco tem uma trava (o gatilho `users_field_guard`, um código que roda
   sozinho a cada alteração na tabela `users`) que impede qualquer pessoa de se
   dar um papel privilegiado. A linha `set local skillset.trusted_write = 'on'`
   libera essa trava **só dentro desta transação** (o bloco entre `begin` e
   `commit`). A versão atual da trava está em
   `supabase/migrations/20260915030000_stripe_connect_country.sql`.
4. A pessoa sai da conta e entra de novo.
5. Ela liga a **verificação em duas etapas** (um código de 6 dígitos gerado por
   um aplicativo autenticador no celular) em `/account/security`. Sem isso o
   papel de admin não vale: as funções do banco que conferem papéis
   (`is_admin()`, `is_ops()` e outras) exigem uma sessão confirmada com o
   segundo fator. A tela só aparece com `NEXT_PUBLIC_AUTH_MFA_ENABLED=true` na
   Vercel.
6. Pronto: `/ops` abre.

## Os próximos admins

Em `/ops`, a seção de papéis (`src/components/admin/role-manager.tsx`) chama a
função do banco `admin_set_user_roles`
(`supabase/migrations/20260819010000_admin_role_management.sql`). Ela só aceita
pedidos de quem já é admin, não deixa um admin tirar o próprio papel e não deixa
a plataforma ficar sem nenhum admin.

## Regra

O cadastro comum só dá os papéis `student` (aluno) e `teacher` (professor).
Qualquer outro papel (`admin`, `ops`, `support`, `moderator`) só existe por um
dos dois caminhos acima.
