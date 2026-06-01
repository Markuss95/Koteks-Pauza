import { createClient } from '@libsql/client'
import { hashPassword } from './auth.js'

// In production set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) to a Turso database.
// Locally we fall back to an on-disk SQLite file, so no credentials are needed
// for development.
const url = process.env.TURSO_DATABASE_URL || 'file:server/data.sqlite'
const authToken = process.env.TURSO_AUTH_TOKEN
const client = createClient(authToken ? { url, authToken } : { url })

function rid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

// Create tables (if missing) and bootstrap a recovery admin on an empty DB.
// Must be awaited before the server starts handling requests.
export async function init() {
  await client.executeMultiple(`
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

  const { rows } = await client.execute('SELECT COUNT(*) AS c FROM users')
  if (Number(rows[0].c) === 0) {
    await client.execute({
      sql: `INSERT INTO users (id, username, password_hash, display_name, role, score)
            VALUES (?, ?, ?, ?, 'admin', 0)`,
      args: [rid(), 'admin', hashPassword('admin'), 'Admin'],
    })
    console.log('Empty database — created recovery admin (admin/admin). Change this!')
  }
}

async function one(sql, args = []) {
  const { rows } = await client.execute({ sql, args })
  return rows[0]
}
async function all(sql, args = []) {
  const { rows } = await client.execute({ sql, args })
  return rows
}

// ---- Users -----------------------------------------------------------------

const toPublicUser = (r) =>
  r && {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    score: Number(r.score),
  }

export function getUserByUsername(username) {
  return one('SELECT * FROM users WHERE username = ?', [username])
}

export function getUserById(id) {
  return one('SELECT * FROM users WHERE id = ?', [id])
}

export async function listUsers() {
  return (await all('SELECT * FROM users ORDER BY display_name COLLATE NOCASE')).map(toPublicUser)
}

export async function createUser({ username, password, displayName, role }) {
  const id = rid()
  await client.execute({
    sql: `INSERT INTO users (id, username, password_hash, display_name, role, score)
          VALUES (?, ?, ?, ?, ?, 0)`,
    args: [id, username, hashPassword(password), displayName, role === 'admin' ? 'admin' : 'regular'],
  })
  return toPublicUser(await getUserById(id))
}

export async function updateUser(id, { displayName, role, password, score }) {
  const existing = await getUserById(id)
  if (!existing) return null
  await client.execute({
    sql: 'UPDATE users SET display_name = ?, role = ?, password_hash = ?, score = ? WHERE id = ?',
    args: [
      displayName ?? existing.display_name,
      role ? (role === 'admin' ? 'admin' : 'regular') : existing.role,
      password ? hashPassword(password) : existing.password_hash,
      score ?? existing.score,
      id,
    ],
  })
  return toPublicUser(await getUserById(id))
}

export async function deleteUser(id) {
  await client.batch(
    [
      { sql: 'DELETE FROM opt_outs WHERE user_id = ?', args: [id] },
      { sql: 'DELETE FROM payments WHERE payer_id = ?', args: [id] },
      { sql: 'DELETE FROM users WHERE id = ?', args: [id] },
    ],
    'write',
  )
  return true
}

export async function countAdmins() {
  const r = await one("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'")
  return Number(r.c)
}

// ---- Opt-outs / participation ---------------------------------------------

export async function getOptOuts() {
  const rows = await all('SELECT date, user_id FROM opt_outs')
  const map = {}
  for (const r of rows) (map[r.date] ||= []).push(r.user_id)
  return map
}

export async function setParticipation(date, userId, participating) {
  if (participating) {
    await client.execute({
      sql: 'DELETE FROM opt_outs WHERE date = ? AND user_id = ?',
      args: [date, userId],
    })
  } else {
    await client.execute({
      sql: 'INSERT OR IGNORE INTO opt_outs (date, user_id) VALUES (?, ?)',
      args: [date, userId],
    })
  }
}

// ---- Payments / scores -----------------------------------------------------

const toPayment = (r) =>
  r && {
    date: r.date,
    payerId: r.payer_id,
    participantIds: JSON.parse(r.participant_ids),
    ts: Number(r.ts),
  }

export async function getHistory() {
  return (await all('SELECT * FROM payments ORDER BY date DESC')).map(toPayment)
}

export async function getPayment(date) {
  return toPayment(await one('SELECT * FROM payments WHERE date = ?', [date]))
}

async function participantIdsFor(date) {
  const optedOut = new Set(
    (await all('SELECT user_id FROM opt_outs WHERE date = ?', [date])).map((r) => r.user_id),
  )
  return (await all('SELECT id FROM users')).map((r) => r.id).filter((id) => !optedOut.has(id))
}

// Records a payment. Throws { status, message } on conflict/validation errors.
//
// Fairness ledger: score = (coffees drunk) − (coffees paid for).
// Everyone who joined drank one coffee (+1); the payer covered the whole table,
// so they also pay for N coffees (−N). Scores carry over and may go negative;
// the sum across everyone is invariant (each day adds N and subtracts N).
// Paying for a big table sinks you further, so you won't pay again until you've
// "earned" it back — which is what keeps it fair when attendance varies.
export async function recordPayment(date, payerId) {
  if (await getPayment(date)) throw { status: 409, message: 'Plaćanje za ovaj dan je već zabilježeno.' }
  const participantIds = await participantIdsFor(date)
  if (!participantIds.includes(payerId)) {
    throw { status: 400, message: 'Platitelj danas ne sudjeluje.' }
  }
  const stmts = participantIds.map((id) => ({
    sql: 'UPDATE users SET score = score + 1 WHERE id = ?',
    args: [id],
  }))
  stmts.push({ sql: 'UPDATE users SET score = score - ? WHERE id = ?', args: [participantIds.length, payerId] })
  stmts.push({
    sql: 'INSERT INTO payments (date, payer_id, participant_ids, ts) VALUES (?, ?, ?, ?)',
    args: [date, payerId, JSON.stringify(participantIds), Date.now()],
  })
  await client.batch(stmts, 'write')
  return getPayment(date)
}

// Exact inverse of recordPayment — fully reversible since nothing is reset.
export async function undoPayment(date) {
  const entry = await getPayment(date)
  if (!entry) return false
  const stmts = entry.participantIds.map((id) => ({
    sql: 'UPDATE users SET score = score - 1 WHERE id = ?',
    args: [id],
  }))
  stmts.push({
    sql: 'UPDATE users SET score = score + ? WHERE id = ?',
    args: [entry.participantIds.length, entry.payerId],
  })
  stmts.push({ sql: 'DELETE FROM payments WHERE date = ?', args: [date] })
  await client.batch(stmts, 'write')
  return true
}

// Clears coffee data (scores, opt-outs, history) but keeps the accounts.
export async function resetData() {
  await client.batch(
    ['DELETE FROM payments', 'DELETE FROM opt_outs', 'UPDATE users SET score = 0'],
    'write',
  )
}

// ---- Activity log (append-only audit trail) -------------------------------
// Messages are pre-built (in Croatian) and the actor name is denormalized, so
// the log stays readable even after a user is renamed or deleted.

export async function logEvent({ type, actorName, message, details }) {
  await client.execute({
    sql: 'INSERT INTO events (ts, type, actor_name, message, details) VALUES (?, ?, ?, ?, ?)',
    args: [Date.now(), type, actorName ?? null, message, details ? JSON.stringify(details) : null],
  })
}

export async function getEvents(limit = 250) {
  return (await all('SELECT * FROM events ORDER BY id DESC LIMIT ?', [limit])).map((e) => ({
    id: Number(e.id),
    ts: Number(e.ts),
    type: e.type,
    actor: e.actor_name,
    message: e.message,
    details: e.details ? JSON.parse(e.details) : null,
  }))
}
