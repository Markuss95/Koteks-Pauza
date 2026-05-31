import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, getToken, setToken } from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // On boot, if we have a stored token, confirm it's still valid.
  useEffect(() => {
    let alive = true
    async function boot() {
      if (!getToken()) {
        setLoading(false)
        return
      }
      try {
        const { user } = await api.me()
        if (alive) setUser(user)
      } catch {
        setToken(null)
      } finally {
        if (alive) setLoading(false)
      }
    }
    boot()
    return () => {
      alive = false
    }
  }, [])

  const login = useCallback(async (username, password) => {
    const { token, user } = await api.login(username, password)
    setToken(token)
    setUser(user)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  // Keep the cached current user fresh (e.g. after an admin changes our role).
  const refreshUser = useCallback(async () => {
    try {
      const { user } = await api.me()
      setUser(user)
    } catch {
      /* ignore */
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
