# ☕ Koteks Pauza

A small React app (with an Express + SQLite backend) that decides **whose turn it is to
pay** for the daily team coffee. Now with **accounts, login, and two roles**.

## How it works

- Coffee is every workday from **10:55–11:35 CET** (the status pill shows whether it's
  happening now — daylight saving is handled automatically via the `Europe/Berlin` zone).
- **Everyone joins by default.** Anyone can tap a chip to mark a person as *not joining* for
  that specific day.
- Each person has a **score** = *(coffees drunk) − (coffees paid for)*, a running fairness
  ledger. On a coffee day everyone who joined gets **+1** (they drank one); the payer also
  gets **−N** because they covered the whole table of N. Scores **carry over and can go
  negative**, and the total across everyone always stays the same (zero-sum).
- The next payer is the participant with the **highest score** — whoever has drunk the most
  relative to what they've paid for. Ties go to **whoever paid least recently** (and anyone
  who has never paid is picked first); name is only a final stable fallback.
- Hit **"X je platio/la →"** to record it; **Poništi** is an exact inverse (nothing is lost).
- Because covering a big table sinks your score by that whole amount, you won't pay again
  until you've earned it back — so it stays fair even when attendance fluctuates day to day.

## Transparency

Every action is recorded in an append-only **activity log** (the **Aktivnost** card),
visible to everyone: payments, undos, participation changes, account changes, and resets —
each stamped with who did it and when. Actor names and messages are stored at write time, so
the log stays readable even after a user is renamed or deleted, and it survives a data reset.

## Accounts & roles

- **Login required.** Passwords are hashed (bcrypt); sessions use a JWT bearer token.
- **Administrator** — can do everything, plus manage accounts (add / rename / delete people,
  change roles, set passwords) and reset all scores & history.
- **Korisnik (regular)** — can do everything *except* admin tasks: toggle anyone's
  participation, record payments, and undo. Account management is hidden and blocked
  server-side.
- Role gating is enforced on the **backend** (`requireAdmin`), not just in the UI.

### Accounts

Real accounts are created through the app by an administrator (the **Ljudi** section).
The current team is **Marko** (admin) plus Vlatko, Tuta, Dino, Barić, Branko, and Ivan.

If the database is ever empty/wiped, the server bootstraps a single recovery admin
`admin / admin` so you can log in and recreate people — change it immediately. Set
`JWT_SECRET` in the environment for any real deployment.

## Run it

```bash
npm install
npm run dev      # runs API (:3001) + Vite client (:5173) together
npm run build    # production client build into dist/
```

- `npm run server` / `npm run client` run the two halves separately.
- The Vite dev server proxies `/api/*` to the backend on port 3001.
- Data lives in `server/data.sqlite` (gitignored). Delete it to re-seed from scratch.

## Layout

- `server/index.js` — Express API: auth, state, participation, payments, user admin.
- `server/db.js` — SQLite schema, queries, the payment/score logic (transactional), and the activity log.
- `server/auth.js` — password hashing + JWT helpers.
- `src/api.js` — typed-ish fetch wrapper that attaches the bearer token.
- `src/auth.jsx` — React auth context (login / logout / current user).
- `src/useCoffeeData.js` — loads shared state from the API and exposes mutating actions.
- `src/Login.jsx` — login screen.
- `src/App.jsx` — UI (today's verdict, scoreboard, people admin, history), role-gated.
- `src/time.js` — CET coffee-window helpers.
- `src/styles.css` — styling.
