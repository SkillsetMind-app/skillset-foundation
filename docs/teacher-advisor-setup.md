# Teacher Studio AI Advisor — Setup

The teacher panel has a floating **Studio advisor** chat. It's built and deployed
but **dormant** until you wire the backend and flip one env flag. This is the
whole wiring guide.

## How it works

```
Teacher types in the floating chat
        │
        ▼
POST /api/teach/advisor          ← lives in this app (Vercel)
  • authenticates the teacher (Supabase session)
  • rate-limits: 30 messages/hour + 120/day per teacher (enforce_rate_limit RPC)
  • caps input: last 20 messages, 4000 chars each
  • forwards { teacherId, messages } to your n8n webhook
        │
        ▼
n8n webhook (your VPS)           ← you build this
  • verify x-advisor-secret header (required — the app always sends it)
  • build a DeepSeek chat request (inject system prompt)
  • call DeepSeek
  • return { "reply": "<model text>" }
        │
        ▼
Reply shows in the chat
```

The app owns the **trust boundary** (auth, rate-limit, input caps). n8n owns the
**prompt + model**, so you can change the advisor's behavior without a redeploy.

## Env vars (Vercel → Project → Settings → Environment Variables)

| Var | Required | Value |
|-----|----------|-------|
| `NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED` | yes | `true` (turns the sidebar on) |
| `N8N_ADVISOR_WEBHOOK_URL` | yes | full n8n Production webhook URL, e.g. `https://n8n.seudominio.com/webhook/teacher-advisor` |
| `N8N_ADVISOR_WEBHOOK_SECRET` | **yes** | a long random string (e.g. `openssl rand -hex 32`). The app sends it as header `x-advisor-secret`; **without it the API stays at 503 and never calls n8n**. Put the SAME value on the n8n Webhook's Header Auth credential. |

After setting them, **redeploy** (env changes don't apply to the running build).
`NEXT_PUBLIC_*` must exist at build time — a redeploy is mandatory for that one.

Until **both** `N8N_ADVISOR_WEBHOOK_URL` and `N8N_ADVISOR_WEBHOOK_SECRET` are set, the API returns a calm 503 and the chat
shows "The studio advisor is being set up and will be available shortly." So you
can flip `NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED=true` first to preview the UI, then
wire n8n — nothing breaks in between.

## The contract (what n8n receives and must return)

**Receives** (POST body, JSON):
```json
{
  "teacherId": "uuid-of-the-teacher",
  "messages": [
    { "role": "user", "content": "How should I price my first course?" },
    { "role": "assistant", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```
`messages` is already cleaned and trimmed (roles are only `user`/`assistant`, last
entry is always a `user` turn). Header `x-advisor-secret` is **always** present —
the app requires the secret and refuses to call n8n without it.

**Must return** (200, JSON) — any ONE of these keys with the reply text:
```json
{ "reply": "..." }
```
The app also accepts `output`, `text`, or `message` as the key (whichever your
n8n node wiring produces). Non-200 or empty reply → the app shows an error and the
teacher can retry. Respond within **60s** (the app aborts after that).

## n8n workflow

**Fast path — import the ready flow.** [`docs/n8n/teacher-advisor.flow.json`](./n8n/teacher-advisor.flow.json)
is an importable workflow (Webhook → Build request → Call DeepSeek → Map reply →
Respond). In n8n: *Workflows → Import from File*. It ships with **no secrets**;
wire two credentials after import, copy the Webhook **Production** URL into
`N8N_ADVISOR_WEBHOOK_URL`, and set the workflow **Active**.

> Step-by-step in Portuguese, written for a non-engineer, lives in
> [`docs/n8n/README.md`](./n8n/README.md). It supersedes the earlier four-node
> draft, adding a guarded reply mapping, an error path that still returns valid
> JSON, and prompt-injection hardening.

- **Webhook → Header Auth** credential: header `x-advisor-secret`, value = the same
  string as Vercel's `N8N_ADVISOR_WEBHOOK_SECRET`. n8n rejects any call without it.
- **Call DeepSeek → Header Auth** credential: header `Authorization`, value
  `Bearer <your DeepSeek key>`.

Or build the same nodes by hand:

1. **Webhook** (trigger)
   - Method: `POST`, Path: `teacher-advisor`, Respond: *Using Respond to Webhook node*.
   - Authentication: **Header Auth** verifying `x-advisor-secret` (required — the app
     always sends it and refuses to run without it).
2. **Set / Function** — build the DeepSeek request body:
   - `model`: `deepseek-chat`
   - `messages`: the SYSTEM prompt (below) prepended to `{{$json.body.messages}}`.
3. **HTTP Request** — call DeepSeek:
   - Method `POST`, URL `https://api.deepseek.com/chat/completions`
   - Header `Authorization: Bearer <DEEPSEEK_API_KEY>` (store as an n8n credential, **never** inline)
   - Body: the object from node 3.
4. **Respond to Webhook**
   - Body: `{ "reply": {{ $json.choices[0].message.content }} }` (path depends on
     DeepSeek's response shape — map to the actual field).

Publish the workflow as **Active** so the Production webhook URL works (the
test URL only fires while the editor is open).

## System prompt (paste into node 3)

```
You are the Studio Advisor for Skillset, a marketplace where psychologists,
therapists, and coaches sell online courses. You advise the course creator
(the "teacher") inside their studio panel.

Be concise, warm, and practical. Prefer specific, actionable steps over theory.
You may advise on: course structure and outlining, whether to embed video from
YouTube or upload a file, pricing, launch and first-sale strategy, and how the
storefront/checkout works. When a question is outside course creation (legal,
tax, clinical advice), say so briefly and point them to a professional.

Video hosting on Skillset is hybrid: teachers can (a) publish a video on YouTube
and embed it, or (b) upload a file. Recommend YouTube embed for the fastest,
free start; recommend upload when they want the video off public YouTube.

Never invent Skillset features or policies you're unsure about. If you don't
know, say so and suggest they check the docs or contact support. Answer in the
teacher's language.
```

## Notes

- Cost is bounded by the 30/hr + 120/day rate limits + the 20-message / 4000-char
  caps, per teacher. Adjust the limits in `src/app/api/teach/advisor/route.ts` if needed.
- The advisor is stateless server-side: the client sends the running thread each
  turn; n8n keeps no history. Fine for advice; add a store later only if needed.
- To swap DeepSeek for another model, change only nodes 3–4 in n8n. No app change.
