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

  // Always-current snapshot so optimistic actions can revert on failure.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const refresh = useCallback(async () => {
    try {
      const data = await api.state()
      setState(data)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Poll so other people's actions show up without a manual refresh.
  useEffect(() => {
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [refresh])

  // Wrap a mutating call: run it, refetch, and bubble up any error message.
  const run = useCallback(
    async (fn) => {
      try {
        await fn()
        await refresh()
        return true
      } catch (e) {
        setError(e.message)
        return false
      }
    },
    [refresh],
  )

  // Apply `apply(state)` immediately, fire the request, then reconcile via a
  // refetch. On failure, roll back to the snapshot taken before the change.
  const optimistic = useCallback(
    async (apply, fn) => {
      const prev = stateRef.current
      setState(apply(prev))
      try {
        await fn()
        await refresh()
        return true
      } catch (e) {
        setState(prev)
        setError(e.message)
        return false
      }
    },
    [refresh],
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
