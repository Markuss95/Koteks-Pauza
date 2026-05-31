const TOKEN_KEY = 'koteks-pauza/token'
const CREDS_KEY = 'koteks-pauza/creds'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

// "Remember password": credentials are kept locally so the login form can
// prefill them. Convenience only — stored in plaintext in this browser.
export function getSavedCreds() {
  try {
    return JSON.parse(localStorage.getItem(CREDS_KEY))
  } catch {
    return null
  }
}

export function setSavedCreds(creds) {
  if (creds) localStorage.setItem(CREDS_KEY, JSON.stringify(creds))
  else localStorage.removeItem(CREDS_KEY)
}

// Thin fetch wrapper: attaches the bearer token and throws an Error whose
// message is the server's Croatian error string.
async function request(method, path, body) {
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    /* empty body */
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Greška (${res.status}).`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  me: () => request('GET', '/api/me'),
  state: () => request('GET', '/api/state'),
  setParticipation: (date, userId, participating) =>
    request('POST', '/api/participation', { date, userId, participating }),
  recordPayment: (date, payerId) => request('POST', '/api/payments', { date, payerId }),
  undoPayment: (date) => request('DELETE', `/api/payments/${date}`),
  createUser: (payload) => request('POST', '/api/users', payload),
  updateUser: (id, payload) => request('PATCH', `/api/users/${id}`, payload),
  deleteUser: (id) => request('DELETE', `/api/users/${id}`),
  reset: () => request('POST', '/api/reset'),
}
