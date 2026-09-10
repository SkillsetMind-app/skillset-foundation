# Operational Account Controls

Status: implementation for review. No production migration is authorized by this
document. SQL smoke execution and hosted CI are required before publication.

## Boundaries

- `admin_set_account_control` is the only client write path. It requires an
  active administrator and `aal2`, a target and a 3-500 character reason.
- `suspend` denies account access without deleting data or removing a prior
  email block. `block` also reserves the current normalized **Auth** email.
  `restore` removes both restrictions and requires a new Auth session.
- Raw account-control reads/writes are revoked even for authenticated admins
  and service-role clients. The UI uses dedicated authenticated RPCs.
- Existing roles, names, billing, courses, enrollments and profile data remain
  unchanged. No email delivery, provider configuration or login page change.
- The control row has no identity FK: a future separately authorized identity
  deletion must not silently release the email. No deletion UI is included.

## Enforcement Map

| Boundary | Guard |
| --- | --- |
| Route handlers using `auth.getUser()` | Shared server client consults `account_session_allowed`; false, malformed, RPC errors and network errors deny access. Anonymous requests do not call the RPC. Explicit JWT uses the same Authorization header for both checks. |
| Direct authenticated table access | Restrictive `account_access_guard` on every existing public RLS table and `storage.objects`, ANDed with existing policies. No permissive policy is removed or weakened. |
| Private RPCs with MFA guards | Existing `require_strong_session` / `session_is_strong` paths now include live account status. Existing AAL2-or-no-verified-factor rule and grants are retained. |
| Role predicates inside definers | Six role/author helpers also require the account gate; persisted roles do not change. |
| Co-producer owner authorization | `assert_course_owner` now requires the existing strong-session guard, including calls from DECLARE initializers. |
| Roster, subscriber, funnel, quota, enrollment helpers | Existing explicit `session_is_strong` predicates. |
| Signup / actual email changes | `auth.users` trigger rejects the normalized blocked email, and changing a suspended account's email. It does not trust public profile email or JWT/user metadata. |
| Last active admin | Account operations and role writes serialize on the users table; role counts exclude suspended accounts. Self-removal guards remain. |
| Audit persistence | Direct insert into `audit_log` in the account mutation transaction. Legacy swallowing `log_audit_event` is not used for account changes. |

The smoke also enumerates actual callable SECURITY DEFINER functions. New or
unclassified functions fail instead of silently escaping coverage. Public
certificate verification, available-slug selection and the existing activation
denial predicate are explicitly classified, not private-data grants.

## Verification

Use only the existing disposable Supabase database job:

```sh
bash scripts/build-test-db.sh
npm run test:db
```

The builder runs the same account smoke with two transaction-local reversals:

- `without_account_session_guard=1`: must fail exactly with
  `ACCOUNT_CONTROL_REGRESSION: suspended session read private profile`.
- `without_account_email_guard=1`: must fail exactly with
  `ACCOUNT_CONTROL_REGRESSION: blocked email registered again`.

Setup/schema failures are not accepted as RED. The normal smoke then verifies
profiles, private lessons, storage, definer calls, suspended admin/downgrade,
Auth email authority, tombstone retention, audit rollback, session ownership and
fresh login after restore. Synthetic identity deletion exists only inside the
rolled-back smoke, never in the product operation.

Local focused checks, under the shared RAM/runner window:

```sh
npx vitest run src/lib/supabase/server.test.tsx src/lib/data/account-controls.test.ts src/components/admin/account-control-dialog.test.tsx src/components/admin/role-manager.test.tsx
npx tsc --noEmit --incremental false
```

Browser verification remains required for native-dialog focus/return, Escape,
mobile/desktop viewport fit and EN/ES. jsdom cannot prove layout.

## Publication And Limits

The coordinator must review and apply only this migration after real CI passes,
then publish the application. Deploying the server change before its RPC exists
fails closed for authenticated routes. Do not run `supabase db push`.

Status is checked on each new database statement/request. Already returned data,
in-flight authorized requests, downloaded files and previously issued media
URLs cannot be recalled. Authentication tokens may still be minted/refreshed;
they grant no application access while suspended. Restoration requires a session
created after the cutoff, not merely a refreshed old token.

Auth email uniqueness is normalized by lower/trim only, without provider-specific
alias rules. Legacy duplicate Auth addresses refuse blocking for manual review.
Operational table locks intentionally prioritize correctness at low volume;
measure before replacing them with a shared finer-grained lock protocol.

Primary references: [Supabase session/token limits](https://supabase.com/docs/guides/auth/managing-user-data)
and [PostgreSQL restrictive policies](https://www.postgresql.org/docs/17/sql-createpolicy.html).
