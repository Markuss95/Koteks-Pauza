# Deploying Koteks Pauza (free)

Two parts deploy separately:

- **Frontend** (React/Vite) → **Netlify** (static).
- **Backend** (`server/` — Express) → **Render Free**.
- **Database** → **Turso** (hosted, SQLite-compatible). Data lives here, not on
  Render's disk, so it survives Render's free-tier sleeps and redeploys.

Netlify proxies `/api/*` to the backend, so the browser stays same-origin.

---

## 1. Create the Turso database

Using the Turso CLI (or the web dashboard):

```bash
turso db create koteks-pauza
turso db show koteks-pauza --url        # -> libsql://koteks-pauza-xxx.turso.io
turso db tokens create koteks-pauza     # -> the auth token
```

Keep the **URL** and **token** for the next step. (Tables are created
automatically on first boot.)

## 2. Backend on Render (Free)

1. Render → **New + → Blueprint** → pick this repo (reads `render.yaml`).
2. When prompted, set:
   - `TURSO_DATABASE_URL` = the `libsql://…` URL
   - `TURSO_AUTH_TOKEN` = the token
   - `JWT_SECRET` = auto-generated (leave it)
3. Deploy. Copy the service URL, e.g. `https://koteks-pauza-api.onrender.com`.
4. First boot seeds a recovery admin **`admin / admin`** — log in once and create
   your real accounts (or change that password).

> Free instances sleep after ~15 min idle; the first request then takes ~50s to
> wake. Data is safe in Turso regardless.

Prefer to set it up manually instead of the Blueprint? Use:
- Build command: `npm install`
- Start command: `node server/index.js`
- Env vars: the three above. Health check path: `/api/health`.

## 3. Frontend on Netlify

1. In **`netlify.toml`**, replace the host in the `/api/*` redirect with your
   Render URL:
   ```toml
   to = "https://koteks-pauza-api.onrender.com/api/:splat"
   ```
2. Commit & push.
3. Netlify → **Add new site → Import from Git** → pick the repo (settings come
   from `netlify.toml`: build `npm run build`, publish `dist`). Deploy.

Open the Netlify URL and log in. Calls to `/api/*` proxy to Render → Turso.

---

## Env vars summary

| Where | Variable | Value |
|-------|----------|-------|
| Render | `TURSO_DATABASE_URL` | `libsql://…turso.io` |
| Render | `TURSO_AUTH_TOKEN` | Turso token |
| Render | `JWT_SECRET` | long random string (auto) |
| Netlify | — | none needed |

Local dev needs none of these: `npm run dev` runs the API on `:3001` (using a
local `file:` SQLite db) and the client on `:5173`.
