import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'

// Loads the shared coffee state from the backend and exposes actions that
// mutate it server-side, then refetch. Errors are surfaced via `error`.
export function useCoffeeData() {
  const [state, setState] = useState({ users: [], optOuts: {}, history: [], events: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

  const actions = {
    setParticipation: (date, userId, participating) =>
      run(() => api.setParticipation(date, userId, participating)),
    recordPayment: (date, payerId) => run(() => api.recordPayment(date, payerId)),
    undoPayment: (date) => run(() => api.undoPayment(date)),
    createUser: (payload) => run(() => api.createUser(payload)),
    updateUser: (id, payload) => run(() => api.updateUser(id, payload)),
    deleteUser: (id) => run(() => api.deleteUser(id)),
    reset: () => run(() => api.reset()),
    clearError: () => setError(null),
  }

  return { state, loading, error, refresh, ...actions }
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
