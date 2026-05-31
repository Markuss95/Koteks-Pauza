import express from 'express'
import cors from 'cors'
import {
  seed,
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

const roleLabel = (role) => (role === 'admin' ? 'administrator' : 'korisnik')
import { verifyPassword, signToken, verifyToken } from './auth.js'

seed()

const app = express()
app.use(cors())
app.use(express.json())

const publicUser = (u) =>
  u && { id: u.id, username: u.username, displayName: u.display_name, role: u.role, score: u.score }

// ---- Middleware ------------------------------------------------------------

function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  const payload = token && verifyToken(token)
  if (!payload) return res.status(401).json({ error: 'Niste prijavljeni.' })
  const user = getUserById(payload.sub)
  if (!user) return res.status(401).json({ error: 'Korisnik više ne postoji.' })
  req.user = user
  next()
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Samo administrator može izvršiti ovu radnju.' })
  }
  next()
}

// ---- Auth ------------------------------------------------------------------

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  const user = username && getUserByUsername(String(username).trim().toLowerCase())
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Pogrešno korisničko ime ili lozinka.' })
  }
  res.json({ token: signToken(user), user: publicUser(user) })
})

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

// ---- State -----------------------------------------------------------------

app.get('/api/state', requireAuth, (req, res) => {
  res.json({
    users: listUsers(),
    optOuts: getOptOuts(),
    history: getHistory(),
    events: getEvents(),
  })
})

// ---- Participation & payments (any authenticated user) ---------------------

app.post('/api/participation', requireAuth, (req, res) => {
  const { date, userId, participating } = req.body || {}
  if (!date || !userId) return res.status(400).json({ error: 'Nedostaju podaci.' })
  const target = getUserById(userId)
  if (!target) return res.status(404).json({ error: 'Korisnik ne postoji.' })
  setParticipation(date, userId, !!participating)
  logEvent({
    type: participating ? 'join' : 'leave',
    actorName: req.user.display_name,
    message: `${target.display_name} ${participating ? 'dolazi' : 'ne dolazi'} (${date})`,
    details: { date, userId, participating: !!participating },
  })
  res.json({ ok: true })
})

app.post('/api/payments', requireAuth, (req, res) => {
  const { date, payerId } = req.body || {}
  if (!date || !payerId) return res.status(400).json({ error: 'Nedostaju podaci.' })
  try {
    const payment = recordPayment(date, payerId)
    const payer = getUserById(payerId)
    logEvent({
      type: 'payment',
      actorName: req.user.display_name,
      message: `${payer?.display_name ?? '—'} platio za ${payment.participantIds.length}`,
      details: { date, payerId, count: payment.participantIds.length },
    })
    res.json({ payment })
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Greška na poslužitelju.' })
  }
})

app.delete('/api/payments/:date', requireAuth, (req, res) => {
  const entry = getPayment(req.params.date)
  if (undoPayment(req.params.date) && entry) {
    const payer = getUserById(entry.payerId)
    logEvent({
      type: 'undo',
      actorName: req.user.display_name,
      message: `Poništeno plaćanje: ${payer?.display_name ?? '—'} (${entry.participantIds.length})`,
      details: { date: req.params.date },
    })
  }
  res.json({ ok: true })
})

// ---- Admin: user management & reset ----------------------------------------

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase()
  const displayName = String(req.body?.displayName || '').trim()
  const password = String(req.body?.password || '')
  const role = req.body?.role === 'admin' ? 'admin' : 'regular'
  if (!username || !displayName || !password) {
    return res.status(400).json({ error: 'Ime, korisničko ime i lozinka su obavezni.' })
  }
  if (getUserByUsername(username)) {
    return res.status(409).json({ error: 'Korisničko ime je već zauzeto.' })
  }
  const user = createUser({ username, password, displayName, role })
  logEvent({
    type: 'user-create',
    actorName: req.user.display_name,
    message: `Dodan korisnik ${user.displayName} (${roleLabel(user.role)})`,
  })
  res.json({ user })
})

app.patch('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const target = getUserById(req.params.id)
  if (!target) return res.status(404).json({ error: 'Korisnik ne postoji.' })
  // Don't allow demoting/removing the last admin.
  if (target.role === 'admin' && req.body?.role === 'regular' && countAdmins() <= 1) {
    return res.status(400).json({ error: 'Mora postojati barem jedan administrator.' })
  }
  const updated = updateUser(req.params.id, {
    displayName: req.body?.displayName,
    role: req.body?.role,
    password: req.body?.password || undefined,
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
    logEvent({
      type: 'user-update',
      actorName: req.user.display_name,
      message: `${target.display_name}: ${changes.join(', ')}`,
    })
  }
  res.json({ user: updated })
})

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const target = getUserById(req.params.id)
  if (!target) return res.status(404).json({ error: 'Korisnik ne postoji.' })
  if (target.role === 'admin' && countAdmins() <= 1) {
    return res.status(400).json({ error: 'Ne možete obrisati posljednjeg administratora.' })
  }
  deleteUser(req.params.id)
  logEvent({
    type: 'user-delete',
    actorName: req.user.display_name,
    message: `Uklonjen korisnik ${target.display_name}`,
  })
  res.json({ ok: true })
})

app.post('/api/reset', requireAuth, requireAdmin, (req, res) => {
  resetData()
  logEvent({
    type: 'reset',
    actorName: req.user.display_name,
    message: 'Obrisani svi bodovi i povijest',
  })
  res.json({ ok: true })
})

// Use a dedicated var (not PORT) so we never collide with the Vite dev server,
// which may inject PORT into the environment.
const PORT = process.env.API_PORT || 3001
app.listen(PORT, () => console.log(`Koteks Pauza API on http://localhost:${PORT}`))
