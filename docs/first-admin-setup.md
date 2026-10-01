# First Admin Setup

> **Obsoleto:** descreve o fluxo da época do Firebase, que foi removido do projeto. Produção é https://www.skillsetmind.com; o banco agora é o Supabase.

Last updated: 2026-04-26

Skillset does not allow a user to make themselves admin from the public app.
That is intentional. The first admin must be promoted from Firebase Console.

## Steps

1. Sign in once at `https://skillsetusaofficial.web.app/login` with the account that should become admin.
2. Open Firebase Console for `skillsetusaofficial`.
3. Go to Firestore Database.
4. Open the `users` collection.
5. Open the document matching that user's `uid`.
6. Edit `roles` from `["student"]` or `["student", "teacher"]` to include `admin`.
7. Recommended founder/admin roles:

```json
["student", "teacher", "admin"]
```

8. Save, then sign out and sign in again.
9. Open `/ops`.

## Rule

Admin access must not be granted by normal onboarding. Onboarding can add only
`student` and `teacher`. Admin remains a trust operation until an audited role
management workflow exists.
