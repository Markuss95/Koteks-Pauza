import { useState } from 'react'
import { useAuth } from './auth.jsx'
import { getSavedCreds, setSavedCreds } from './api.js'

export default function Login() {
  const { login } = useAuth()
  const saved = getSavedCreds()
  const [username, setUsername] = useState(saved?.username || '')
  const [password, setPassword] = useState(saved?.password || '')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(username, password)
      setSavedCreds(remember ? { username, password } : null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app app--login">
      <header className="hero">
        <h1>☕ Koteks Pauza</h1>
        <p className="tagline">Prijavite se da nastavite</p>
      </header>

      <form className="card login" onSubmit={submit}>
        <label className="field">
          <span>Korisničko ime</span>
          <input
            className="input"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Lozinka</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <label className="remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Zapamti lozinku</span>
        </label>

        {error && <p className="error">{error}</p>}

        <button className="btn btn--block" type="submit" disabled={busy}>
          {busy ? 'Prijava…' : 'Prijavi se'}
        </button>
      </form>
    </div>
  )
}
