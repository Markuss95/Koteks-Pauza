import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword } from './auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const db = new Database(path.join(__dirname, 'data.sqlite'))
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'regular',
    score         INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS opt_outs (
    date    TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (date, user_id)
  );
  CREATE TABLE IF NOT EXISTS payments (
    date            TEXT PRIMARY KEY,
    payer_id        TEXT NOT NULL,
    participant_ids TEXT NOT NULL,
    ts              INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL,
    type       TEXT NOT NULL,
    actor_name TEXT,
    message    TEXT NOT NULL,
    details    TEXT
  );
`)

function rid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

// Bootstrap a recovery admin only if the database is completely empty (e.g. a
// brand-new or wiped DB). Real accounts are created through the app, not here,
// so we never keep their passwords in source. Change this login after first use.
export function seed() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM users').get()
  if (c > 0) return
  db.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, role, score)
     VALUES (?, ?, ?, ?, 'admin', 0)`,
  ).run(rid(), 'admin', hashPassword('admin'), 'Admin')
  console.log('Empty database — created recovery admin (admin/admin). Change this!')
}

// ---- Users -----------------------------------------------------------------

const toPublicUser = (r) =>
  r && { id: r.id, username: r.username, displayName: r.display_name, role: r.role, score: r.score }

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username)
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id)
}

export function listUsers() {
  return db
    .prepare('SELECT * FROM users ORDER BY display_name COLLATE NOCASE')
    .all()
    .map(toPublicUser)
}

export function createUser({ username, password, displayName, role }) {
  const id = rid()
  db.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, role, score)
     VALUES (?, ?, ?, ?, ?, 0)`,
  ).run(id, username, hashPassword(password), displayName, role === 'admin' ? 'admin' : 'regular')
  return toPublicUser(getUserById(id))
}

export function updateUser(id, { displayName, role, password }) {
  const existing = getUserById(id)
  if (!existing) return null
  db.prepare('UPDATE users SET display_name = ?, role = ?, password_hash = ? WHERE id = ?').run(
    displayName ?? existing.display_name,
    role ? (role === 'admin' ? 'admin' : 'regular') : existing.role,
    password ? hashPassword(password) : existing.password_hash,
    id,
  )
  return toPublicUser(getUserById(id))
}

export function deleteUser(id) {
  db.prepare('DELETE FROM opt_outs WHERE user_id = ?').run(id)
  db.prepare('DELETE FROM payments WHERE payer_id = ?').run(id)
  return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0
}

export function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c
}

// ---- Opt-outs / participation ---------------------------------------------

export function getOptOuts() {
  const rows = db.prepare('SELECT date, user_id FROM opt_outs').all()
  const map = {}
  for (const r of rows) (map[r.date] ||= []).push(r.user_id)
  return map
}

export function setParticipation(date, userId, participating) {
  if (participating) {
    db.prepare('DELETE FROM opt_outs WHERE date = ? AND user_id = ?').run(date, userId)
  } else {
    db.prepare('INSERT OR IGNORE INTO opt_outs (date, user_id) VALUES (?, ?)').run(date, userId)
  }
}

// ---- Payments / scores -----------------------------------------------------

const toPayment = (r) =>
  r && { date: r.date, payerId: r.payer_id, participantIds: JSON.parse(r.participant_ids), ts: r.ts }

export function getHistory() {
  return db.prepare('SELECT * FROM payments ORDER BY date DESC').all().map(toPayment)
}

export function getPayment(date) {
  return toPayment(db.prepare('SELECT * FROM payments WHERE date = ?').get(date))
}

function participantIdsFor(date) {
  const optedOut = new Set(
    db.prepare('SELECT user_id FROM opt_outs WHERE date = ?').all(date).map((r) => r.user_id),
  )
  return db
    .prepare('SELECT id FROM users')
    .all()
    .map((r) => r.id)
    .filter((id) => !optedOut.has(id))
}

// Records a payment. Throws { status, message } on conflict/validation errors.
//
// Fairness ledger: score = (coffees drunk) − (coffees paid for).
// Everyone who joined drank one coffee (+1); the payer covered the whole table,
// so they also pay for N coffees (−N). Scores carry over and may go negative;
// the sum across everyone is invariant (each day adds N and subtracts N).
// Paying for a big table sinks you further, so you won't pay again until you've
// "earned" it back — which is what keeps it fair when attendance varies.
export const recordPayment = db.transaction((date, payerId) => {
  if (getPayment(date)) throw { status: 409, message: 'Plaćanje za ovaj dan je već zabilježeno.' }
  const participantIds = participantIdsFor(date)
  if (!participantIds.includes(payerId)) {
    throw { status: 400, message: 'Platitelj danas ne sudjeluje.' }
  }
  const drink = db.prepare('UPDATE users SET score = score + 1 WHERE id = ?')
  for (const id of participantIds) drink.run(id)
  db.prepare('UPDATE users SET score = score - ? WHERE id = ?').run(participantIds.length, payerId)
  db.prepare('INSERT INTO payments (date, payer_id, participant_ids, ts) VALUES (?, ?, ?, ?)').run(
    date,
    payerId,
    JSON.stringify(participantIds),
    Date.now(),
  )
  return getPayment(date)
})

// Exact inverse of recordPayment — now fully reversible since nothing is reset.
export const undoPayment = db.transaction((date) => {
  const entry = getPayment(date)
  if (!entry) return false
  const undrink = db.prepare('UPDATE users SET score = score - 1 WHERE id = ?')
  for (const id of entry.participantIds) undrink.run(id)
  db.prepare('UPDATE users SET score = score + ? WHERE id = ?').run(
    entry.participantIds.length,
    entry.payerId,
  )
  db.prepare('DELETE FROM payments WHERE date = ?').run(date)
  return true
})

// Clears coffee data (scores, opt-outs, history) but keeps the accounts.
export const resetData = db.transaction(() => {
  db.prepare('DELETE FROM payments').run()
  db.prepare('DELETE FROM opt_outs').run()
  db.prepare('UPDATE users SET score = 0').run()
})

// ---- Activity log (append-only audit trail) -------------------------------
// Messages are pre-built (in Croatian) and the actor name is denormalized, so
// the log stays readable even after a user is renamed or deleted.

const insertEvent = db.prepare(
  'INSERT INTO events (ts, type, actor_name, message, details) VALUES (?, ?, ?, ?, ?)',
)

export function logEvent({ type, actorName, message, details }) {
  insertEvent.run(Date.now(), type, actorName ?? null, message, details ? JSON.stringify(details) : null)
}

export function getEvents(limit = 250) {
  return db
    .prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((e) => ({
      id: e.id,
      ts: e.ts,
      type: e.type,
      actor: e.actor_name,
      message: e.message,
      details: e.details ? JSON.parse(e.details) : null,
    }))
}

export default db
