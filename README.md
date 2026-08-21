# GSG Clubs Networking Bingo

A mobile-first networking game for a student club event. Attendees join on
their phones, wait in a lobby, and start together when the organiser presses
Start. Each of 25 squares is a person to find, not a fact to tick — a square
only fills once a *different* person confirms it. A live Requests & Offers
board is the matchmaking layer that gets strangers actually talking.

**Stack:** Next.js 16 (App Router, TypeScript) on Vercel · Supabase
(Postgres + Realtime, self-hosted locally via the Supabase CLI).

---

## 1. Local setup

You need Node 20+, Docker (for local Supabase), and the repo cloned.

```bash
npm install
npx supabase start        # first run pulls a handful of images, ~1–2 min
```

`supabase start` prints four values you need. Copy `.env.example` to
`.env.local` and fill them in:

```bash
cp .env.example .env.local
```

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the `API URL` `supabase start` printed |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `anon key` it printed |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role key` it printed |
| `PLAYER_TOKEN_SECRET` | any long random string — `openssl rand -base64 48` |
| `ADMIN_PASSPHRASE` | whatever you want to type into `/admin` locally |
| `NEXT_PUBLIC_EVENT_SLUG` | leave as `gsg-clubs` unless you change the seed |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` locally |

Migrations and the 25 criteria are applied automatically by `supabase start`
(via `supabase/migrations` → a symlink to `db/migrations`, and
`supabase/seed.sql` → a symlink to `db/seed.sql`). To re-apply after an
edit:

```bash
npm run db:reset     # wraps `supabase db reset`: re-runs every migration + seed
```

Then:

```bash
npm run dev           # http://localhost:3000
```

`/admin` is gated by `ADMIN_PASSPHRASE`. `/admin/qr` gives you the printable
poster. Nothing plays until you press **Start the game** in `/admin` — that
is the whole point of the lobby.

### Running the checks

```bash
npm test              # 216 tests, real Postgres via PGlite (no Docker needed)
npm run lint           # clean
npx tsc --noEmit       # clean
```

`npm test` runs against [PGlite](https://pglite.dev) — a real Postgres 18
compiled to WASM — not a mock. The rules that decide the game (line
detection, the start gate, match confirmation, the pair cap) live in
`plpgsql` functions, so testing anything less than real Postgres would test
nothing.

With the dev server and local Supabase both running, two more scripts
exercise the real HTTP + database path end to end:

```bash
npm run smoke          # 31 checks against the live app: join, match, BINGO,
                        # security, admin — the same requests a phone makes
npm run loadtest        # simulates 300 concurrent players joining, posting,
                        # and polling; reports p50/p95/max latency
npm run shots           # Playwright screenshots + measures the card's font
                        # size at 375px and 320px against the longest
                        # criterion, so "it fits" is measured, not asserted
npm run qr              # exports the QR poster to docs/qr/ as SVG, PNG, and
                        # a print-ready PDF
```

---

## 2. Deploying

Everything above runs against a local Supabase. Going live needs two free
accounts and about 20 minutes.

### 2.1 Supabase (hosted)

1. Create a project at [supabase.com](https://supabase.com) — pick a region
   close to the venue. Free tier is enough for up to ~200 concurrent
   Realtime connections (see the note on scale below).
2. In **Project Settings → API**, copy the `Project URL`, `anon` key, and
   `service_role` key.
3. Push the schema:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   This runs every file in `db/migrations/` against the hosted database,
   in order, including the seed of the 25 criteria and every RLS policy.
4. In **Database → Replication**, confirm the tables `events`, `players`,
   `posts`, `replies`, `card_squares`, `match_confirmations`, `bingos` are
   in the `supabase_realtime` publication (migration `0007_rls.sql` adds
   them automatically if the publication already exists on your project).

### 2.2 Vercel

1. Push this repo to GitHub, then **Import Project** on
   [vercel.com](https://vercel.com).
2. Framework preset: Next.js (auto-detected).
3. Add every variable from `.env.local` to **Settings → Environment
   Variables** — same names, the hosted Supabase values instead of local
   ones. Generate a fresh `PLAYER_TOKEN_SECRET` and `ADMIN_PASSPHRASE` for
   production; don't reuse the local ones.
4. Set `NEXT_PUBLIC_SITE_URL` to the Vercel URL you're given (or your custom
   domain), then deploy.
5. Re-run the QR export against the real URL so the poster points at
   production, not localhost:
   ```bash
   npm run qr -- https://your-app.vercel.app
   ```

You now have a public HTTPS URL. `/admin/qr` on that URL also lets you
download the poster PNG/SVG straight from the browser, generated
client-side — no external QR service ever sees the link.

### On scale and cost

Both tiers are free at the numbers in the brief. Supabase's free tier caps
Realtime at **200 concurrent connections**; at 300 players roughly a third
would be refused a socket if Realtime were the only transport. It isn't:
every client polls Supabase directly every 3 seconds regardless of whether
it has a Realtime slot, and Realtime is layered on top purely to make
updates land faster for whoever gets a socket. `npm run loadtest` reports
real p50/p95 numbers for that poll at 300 simulated players — on a laptop,
against local Supabase, it came back at **p50 ~95ms, p95 ~230ms, zero
errors**, for the full per-poll snapshot (event status, board page, full
card, pending confirmations) that every phone repeats.

---

## 3. Running the event, day of

### Pre-event checklist

- [ ] `npm run qr -- <production URL>` re-run against the real deployed URL,
      not localhost. Print `docs/qr/gsg-bingo-poster.pdf` at A4.
- [ ] Open `/admin` on your phone or laptop and confirm you can sign in with
      `ADMIN_PASSPHRASE`.
- [ ] Open `/admin` → **Reset for a rerun** once, so the event starts from
      `waiting` with zero players — this also wipes anything from testing.
- [ ] Walk through the 25 squares in the admin criteria list. If any of them
      won't make sense on the day (a speaker cancelled, a room changed),
      edit the wording right there — it propagates to every card
      immediately, no redeploy.
- [ ] Do one real join-to-BINGO run yourself on a phone, on the venue wifi
      if you can get on it early, to see the actual latency you'll get.
- [ ] Have `/lobby?display=1` up on the projector *before* people start
      arriving — that's the moment it's built for.
- [ ] Decide your countdown length (default 3s) and whether late joins stay
      open the whole time; both are one tap away in `/admin`.

### Running it

1. Put the QR poster at the door. Point the projector at
   `/lobby?display=1`.
2. As people join, watch the constellation fill up. The admin console shows
   a live headcount and per-university breakdown too.
3. When you're ready, press **Start the game**. Every connected phone gets
   the same 3-2-1 at the same moment — the clock is server time, not each
   phone's own clock, so nobody gets a head start from a fast clock.
4. During the game: `/admin` has live counts (joined, cards dealt, squares
   filled, BINGOs), a feed of recent posts you can hide if something's
   inappropriate, and a player list you can remove someone from if needed.
   **Undo a square** if a confirmation was made in error — it also
   withdraws a BINGO whose line no longer holds.
5. Point a second screen (or flip the projector over) to
   `/leaderboard?display=1` once the first BINGOs start landing — that's
   the other screen built to be looked at from across a room.
6. Press **End the game** when you're done. The board and every card go
   read-only and the leaderboard is final.
7. **Reset for a rerun** if you're running a second heat — it wipes every
   player, card, post, and BINGO, keeps the 25 criteria, and asks you to
   type the event slug back so it can't happen on a stray tap.

### If the wifi is bad

It will be. The app is built for it:

- Every phone polls Supabase directly for reads; there's no dependency on
  getting a Realtime socket.
- Posting and replying queue in `localStorage` on a failure and retry
  automatically once the connection comes back — a timeout never loses a
  message, and a client-generated key stops a retried post ever landing
  twice.
- A "Reconnecting…" banner tells a player when they've actually gone
  offline, rather than silently showing stale data.
- A player's card lives entirely server-side; the token in `localStorage`
  is only the claim to it. Closing the tab, losing signal, or the phone
  locking itself never costs anyone their progress.

---

## 4. Architecture, briefly

```
db/migrations/     the schema, the rules engine, RLS — the source of truth
db/seed.sql        the 25 criteria, verbatim from the brief
db/tests/          216 tests against real Postgres (PGlite)
src/app/           routes: join, lobby, /play/{card,board,leaderboard},
                   public /leaderboard, /admin, /admin/qr, API routes
src/components/    the card, the board, the constellation, the celebration
src/lib/           transport (poll + realtime), session, mutation queue,
                   token signing, the client-side line-detection mirror
scripts/           smoke test, load test, screenshot/measurement tool,
                   QR export
```

**Every outcome-deciding action is a Postgres function**, called only by a
Next.js route holding the service-role key. Starting the event, filling a
square, confirming a match, awarding a BINGO — none of it is a client-side
write, and the anon key (which ships in the browser bundle) can read public
game state and write nothing at all. That split is enforced by Row Level
Security with an explicit policy per table (`db/migrations/0007_rls.sql`),
not by convention.

The rules that would embarrass a wrong answer — BINGO line detection, the
start gate, and match confirmation (self-matching, the pair cap, the two
machine-checkable criteria) — have their own test files under `db/tests/`
and are the most heavily covered part of the codebase on purpose.

---

## 5. What I'd add next

- **Nudges.** A quiet push/notification when someone answers your post or
  sends you a confirmation prompt — right now finding out means having the
  app open.
- **A "find me" gesture on Offer posts** — a big "I'm right here" button
  that briefly highlights the offerer's general area if the venue has any
  positioning signal, for a big room where "by the coffee table" isn't
  specific enough.
- **Server-timed pause banking shown to players**, not just the admin — a
  paused game currently corrects elapsed time under the hood, but a player
  mid-race doesn't see why their clock froze.
- **A lightweight photo attached to a confirmation** — "here's us" — purely
  optional, purely for the fun of it, not for verification.
- **Automatic university-name clustering** in the autocomplete (fuzzy-match
  near-duplicates an admin can merge), so "IUG" and "Islamic University of
  Gaza" typed by different people don't need a human to notice they're the
  same place.
- **A second, harder card variant** for a repeat event, so returning
  players don't get the exact 25 they've already mastered.
