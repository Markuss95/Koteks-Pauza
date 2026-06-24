import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

// Loads the shared coffee state from the backend and exposes actions that
// mutate it server-side. The most-clicked actions update the UI optimistically
// (instantly), then reconcile with the server — so it feels snappy even when
// the backend is a network hop away. Errors are surfaced via `error`.
export function useCoffeeData() {
  const [state, setState] = useState({ users: [], optOuts: {}, history: [], events: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Number of mutations currently in flight. We only refetch the authoritative
  // server state once the LAST one settles — refetching after each would let an
  // earlier finisher clobber a later, still-pending change (the flicker bug when
  // toggling two people quickly). Polls are likewise skipped while > 0.
  const pending = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const data = await api.state()
      // Don't overwrite local state if a mutation started while we were fetching.
      if (pending.current === 0) {
        setState(data)
        setError(null)
      }
    } catch (e) {
      if (pending.current === 0) setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Poll so other people's actions show up without a manual refresh (but not
  // while one of our own mutations is still settling).
  useEffect(() => {
    const t = setInterval(() => {
      if (pending.current === 0) refresh()
    }, 15000)
    return () => clearInterval(t)
  }, [refresh])

  // Run a mutation. When the last in-flight mutation finishes, reconcile with
  // the server. Overlapping clicks therefore don't fight each other.
  const run = useCallback(
    async (fn) => {
      pending.current++
      try {
        await fn()
        return true
      } catch (e) {
        setError(e.message)
        return false
      } finally {
        pending.current--
        if (pending.current === 0) refresh()
      }
    },
    [refresh],
  )

  // Optimistic mutation: apply locally right away — using the functional form so
  // it builds on the latest state (and on any other in-flight optimistic change)
  // — then run. The final refresh (when all settle) reconciles with the server.
  const optimistic = useCallback(
    (apply, fn) => {
      setState((s) => apply(s))
      return run(fn)
    },
    [run],
  )

  const actions = {
    setParticipation: (date, userId, participating) =>
      optimistic(
        (s) => applyParticipation(s, date, userId, participating),
        () => api.setParticipation(date, userId, participating),
      ),
    recordPayment: (date, payerId) =>
      optimistic(
        (s) => applyPayment(s, date, payerId),
        () => api.recordPayment(date, payerId),
      ),
    undoPayment: (date) =>
      optimistic(
        (s) => applyUndo(s, date),
        () => api.undoPayment(date),
      ),
    // Admin actions are infrequent — plain run (wait for the server) is fine.
    createUser: (payload) => run(() => api.createUser(payload)),
    updateUser: (id, payload) => run(() => api.updateUser(id, payload)),
    deleteUser: (id) => run(() => api.deleteUser(id)),
    reset: () => run(() => api.reset()),
    clearError: () => setError(null),
  }

  return { state, loading, error, refresh, ...actions }
}

// ---- Optimistic state transforms (mirror the server's logic) --------------

function applyParticipation(s, date, userId, participating) {
  const set = new Set(s.optOuts[date] || [])
  if (participating) set.delete(userId)
  else set.add(userId)
  const optOuts = { ...s.optOuts }
  if (set.size) optOuts[date] = [...set]
  else delete optOuts[date]
  return { ...s, optOuts }
}

function applyPayment(s, date, payerId) {
  const out = new Set(s.optOuts[date] || [])
  const participantIds = s.users.filter((u) => !out.has(u.id)).map((u) => u.id)
  if (!participantIds.includes(payerId)) return s
  const n = participantIds.length
  const inSet = new Set(participantIds)
  const users = s.users.map((u) => {
    if (!inSet.has(u.id)) return u
    return { ...u, score: u.id === payerId ? u.score + 1 - n : u.score + 1 }
  })
  const history = [{ date, payerId, participantIds, ts: Date.now() }, ...s.history]
  return { ...s, users, history }
}

function applyUndo(s, date) {
  const entry = s.history.find((h) => h.date === date)
  if (!entry) return s
  const n = entry.participantIds.length
  const inSet = new Set(entry.participantIds)
  const users = s.users.map((u) => {
    if (!inSet.has(u.id)) return u
    return { ...u, score: u.id === entry.payerId ? u.score - 1 + n : u.score - 1 }
  })
  return { ...s, users, history: s.history.filter((h) => h.date !== date) }
}

// ---- Pure selectors (shared with the UI) ----------------------------------

export function participantsFor(state, dateKey) {
  const out = new Set(state.optOuts[dateKey] || [])
  return state.users.filter((u) => !out.has(u.id))
}

// Highest score pays. Ties go to whoever paid least recently — and anyone who
// has never paid (no entry) sorts first. Name is only a final stable fallback.
export function payerAmong(participants, history = []) {
  if (participants.length === 0) return null
  const lastPaid = {}
  for (const h of history) {
    if (!lastPaid[h.payerId] || h.date > lastPaid[h.payerId]) lastPaid[h.payerId] = h.date
  }
  return [...participants].sort(
    (a, b) =>
      b.score - a.score ||
      (lastPaid[a.id] || '').localeCompare(lastPaid[b.id] || '') ||
      a.displayName.localeCompare(b.displayName),
  )[0]
}

export function isRecorded(state, dateKey) {
  return state.history.some((h) => h.date === dateKey)
}

// Attendance is only ever recorded on a day someone paid the bill — that's the
// only time we snapshot who was present (a payment's participantIds). So the set
// of "coffee days" is exactly state.history, and a user attended a day iff their
// id is in that day's participants. Counts are computed purely from history, so
// no backend changes are needed.
export function attendanceStats(state) {
  const totalDays = state.history.length
  return state.users
    .map((u) => {
      const attended = state.history.reduce(
        (n, h) => n + (h.participantIds.includes(u.id) ? 1 : 0),
        0,
      )
      const paid = state.history.reduce((n, h) => n + (h.payerId === u.id ? 1 : 0), 0)
      return {
        id: u.id,
        displayName: u.displayName,
        attended,
        paid,
        rate: totalDays ? attended / totalDays : 0,
      }
    })
    .sort(
      (a, b) =>
        b.attended - a.attended ||
        b.paid - a.paid ||
        a.displayName.localeCompare(b.displayName),
    )
}

// One point per coffee day (chronological), tracking how a single user's
// attendance evolves: whether they were present that day, whether they paid,
// and their running attendance rate up to and including that day. Drives the
// per-user trend chart. Returns [] if there are no coffee days yet.
export function attendanceSeries(state, userId) {
  const days = [...state.history].sort((a, b) => a.date.localeCompare(b.date))
  let attended = 0
  return days.map((h, i) => {
    const present = h.participantIds.includes(userId)
    if (present) attended++
    return {
      date: h.date,
      present,
      paid: h.payerId === userId,
      rate: attended / (i + 1),
    }
  })
}
