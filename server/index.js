import express from 'express'
import cors from 'cors'
import {
  init,
  getUserByUsername,
  getUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  countAdmins,
  getOptOuts,
  setParticipation,
  getHistory,
  getPayment,
  recordPayment,
  undoPayment,
  resetData,
  logEvent,
  getEvents,
} from './db.js'
import { verifyPassword, signToken, verifyToken } from './auth.js'

const roleLabel = (role) => (role === 'admin' ? 'administrator' : 'korisnik')

const app = express()
app.use(cors())
app.use(express.json())

// Flipped to true once the DB connection + schema setup succeeds (see boot at
// the bottom of the file). Read by /api/health and the readiness gate.
let dbReady = false

const publicUser = (u) =>
  u && {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    score: Number(u.score),
  }

// Wrap async route handlers so rejected promises reach the error middleware.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// ---- Middleware ------------------------------------------------------------

const requireAuth = ah(async (req, res, next) => {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  const payload = token && verifyToken(token)
  if (!payload) return res.status(401).json({ error: 'Niste prijavljeni.' })
  const user = await getUserById(payload.sub)
  if (!user) return res.status(401).json({ error: 'Korisnik više ne postoji.' })
  req.user = user
  next()
})

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Samo administrator može izvršiti ovu radnju.' })
  }
  next()
}

// ---- Health (for the hosting platform's health check) ----------------------
// Always 200, even before the DB is ready, so the host keeps the instance alive
// and warm while init() retries in the background (see bottom of file). If this
// reflected DB state, a slow Turso connection would make the host kill/restart
// the instance — turning a transient blip into a crash loop.
app.get('/api/health', (req, res) => res.json({ ok: true, db: dbReady }))

// Until the DB connects, data routes can't work — return a clean 503 (with a
// Croatian message) instead of hanging or 500ing. Health is already handled
// above; everything below this line requires the DB.
app.use((req, res, next) => {
  if (!dbReady) {
    return res
      .status(503)
      .json({ error: 'Poslužitelj se pokreće, pokušajte ponovno za koji trenutak.' })
  }
  next()
})

// ---- Auth ------------------------------------------------------------------

app.post(
  '/api/auth/login',
  ah(async (req, res) => {
    const { username, password } = req.body || {}
    const user = username ? await getUserByUsername(String(username).trim().toLowerCase()) : null
    if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'Pogrešno korisničko ime ili lozinka.' })
    }
    res.json({ token: signToken(user), user: publicUser(user) })
  }),
)

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

// ---- State -----------------------------------------------------------------

app.get(
  '/api/state',
  requireAuth,
  ah(async (req, res) => {
    const [users, optOuts, history, events] = await Promise.all([
      listUsers(),
      getOptOuts(),
      getHistory(),
      getEvents(),
    ])
    res.json({ users, optOuts, history, events })
  }),
)

// ---- Participation & payments (any authenticated user) ---------------------

app.post(
  '/api/participation',
  requireAuth,
  ah(async (req, res) => {
    const { date, userId, participating } = req.body || {}
    if (!date || !userId) return res.status(400).json({ error: 'Nedostaju podaci.' })
    const target = await getUserById(userId)
    if (!target) return res.status(404).json({ error: 'Korisnik ne postoji.' })
    await setParticipation(date, userId, !!participating)
    await logEvent({
      type: participating ? 'join' : 'leave',
      actorName: req.user.display_name,
      message: `${target.display_name} ${participating ? 'dolazi' : 'ne dolazi'} (${date})`,
      details: { date, userId, participating: !!participating },
    })
    res.json({ ok: true })
  }),
)

app.post(
  '/api/payments',
  requireAuth,
  ah(async (req, res) => {
    const { date, payerId } = req.body || {}
    if (!date || !payerId) return res.status(400).json({ error: 'Nedostaju podaci.' })
    const payment = await recordPayment(date, payerId)
    const payer = await getUserById(payerId)
    await logEvent({
      type: 'payment',
      actorName: req.user.display_name,
      message: `${payer?.display_name ?? '—'} platio za ${payment.participantIds.length}`,
      details: { date, payerId, count: payment.participantIds.length },
    })
    res.json({ payment })
  }),
)

app.delete(
  '/api/payments/:date',
  requireAuth,
  ah(async (req, res) => {
    const entry = await getPayment(req.params.date)
    if ((await undoPayment(req.params.date)) && entry) {
      const payer = await getUserById(entry.payerId)
      await logEvent({
        type: 'undo',
        actorName: req.user.display_name,
        message: `Poništeno plaćanje: ${payer?.display_name ?? '—'} (${entry.participantIds.length})`,
        details: { date: req.params.date },
      })
    }
    res.json({ ok: true })
  }),
)

// ---- Admin: user management & reset ----------------------------------------

app.post(
  '/api/users',
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase()
    const displayName = String(req.body?.displayName || '').trim()
    const password = String(req.body?.password || '')
    const role = req.body?.role === 'admin' ? 'admin' : 'regular'
    if (!username || !displayName || !password) {
      return res.status(400).json({ error: 'Ime, korisničko ime i lozinka su obavezni.' })
    }
    if (await getUserByUsername(username)) {
      return res.status(409).json({ error: 'Korisničko ime je već zauzeto.' })
    }
    const user = await createUser({ username, password, displayName, role })
    await logEvent({
      type: 'user-create',
      actorName: req.user.display_name,
      message: `Dodan korisnik ${user.displayName} (${roleLabel(user.role)})`,
    })
    res.json({ user })
  }),
)

app.patch(
  '/api/users/:id',
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const target = await getUserById(req.params.id)
    if (!target) return res.status(404).json({ error: 'Korisnik ne postoji.' })
    // Don't allow demoting the last admin.
    if (target.role === 'admin' && req.body?.role === 'regular' && (await countAdmins()) <= 1) {
      return res.status(400).json({ error: 'Mora postojati barem jedan administrator.' })
    }
    // An explicit score override (admin manually corrects the ledger).
    let score
    if (req.body?.score !== undefined && req.body?.score !== null && req.body?.score !== '') {
      score = Number(req.body.score)
      if (!Number.isInteger(score)) {
        return res.status(400).json({ error: 'Bodovi moraju biti cijeli broj.' })
      }
    }
    const updated = await updateUser(req.params.id, {
      displayName: req.body?.displayName,
      role: req.body?.role,
      password: req.body?.password || undefined,
      score,
    })
    const changes = []
    if (req.body?.displayName && req.body.displayName !== target.display_name) {
      changes.push(`preimenovan u ${updated.displayName}`)
    }
    if (req.body?.role && req.body.role !== target.role) {
      changes.push(`uloga: ${roleLabel(updated.role)}`)
    }
    if (req.body?.password) changes.push('promijenjena lozinka')
    if (changes.length) {
      await logEvent({
        type: 'user-update',
        actorName: req.user.display_name,
        message: `${target.display_name}: ${changes.join(', ')}`,
      })
    }
    // Score edits get their own audit entry so a manual correction is always
    // visible in the activity log (and never hidden inside an unrelated rename).
    if (score !== undefined && score !== Number(target.score)) {
      await logEvent({
        type: 'score-edit',
        actorName: req.user.display_name,
        message: `${target.display_name}: bodovi ${Number(target.score)} → ${score}`,
        details: { userId: target.id, from: Number(target.score), to: score },
      })
    }
    res.json({ user: updated })
  }),
)

app.delete(
  '/api/users/:id',
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const target = await getUserById(req.params.id)
    if (!target) return res.status(404).json({ error: 'Korisnik ne postoji.' })
    if (target.role === 'admin' && (await countAdmins()) <= 1) {
      return res.status(400).json({ error: 'Ne možete obrisati posljednjeg administratora.' })
    }
    await deleteUser(req.params.id)
    await logEvent({
      type: 'user-delete',
      actorName: req.user.display_name,
      message: `Uklonjen korisnik ${target.display_name}`,
    })
    res.json({ ok: true })
  }),
)

app.post(
  '/api/reset',
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    await resetData()
    await logEvent({
      type: 'reset',
      actorName: req.user.display_name,
      message: 'Obrisani svi bodovi i povijest',
    })
    res.json({ ok: true })
  }),
)

// ---- Error handler ---------------------------------------------------------
// Catches thrown { status, message } (e.g. from recordPayment) and anything else.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (!err.status) console.error(err)
  res.status(err.status || 500).json({ error: err.message || 'Greška na poslužitelju.' })
})

// Local dev sets API_PORT=3001 (so we don't collide with the Vite dev server).
// In production, hosts like Render/Railway provide the port via PORT.
const PORT = process.env.API_PORT || process.env.PORT || 3001

// Listen FIRST, initialize the DB in the background. This way /api/health
// responds immediately so the host marks the instance healthy and keeps it
// warm, and a slow or briefly-unreachable Turso can't hang the whole boot the
// way `await init()` before listen() used to (that made one bad wake take the
// entire service down with 504s). Until init() succeeds, data routes return 503.
app.listen(PORT, () => console.log(`Koteks Pauza API on port ${PORT}`))

async function initWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      await init()
      dbReady = true
      console.log('Database ready — accepting requests.')
      return
    } catch (err) {
      const delay = Math.min(30000, attempt * 5000)
      console.error(`DB init failed (attempt ${attempt}), retrying in ${delay / 1000}s:`, err.message)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

initWithRetry()
