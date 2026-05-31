import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

// In production set JWT_SECRET in the environment. The dev fallback is fine for
// a local internal tool but should never ship to a public deployment.
const SECRET = process.env.JWT_SECRET || 'koteks-pauza-dev-secret-change-me'
const TOKEN_TTL = '30d'

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10)
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash)
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, SECRET, { expiresIn: TOKEN_TTL })
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET)
  } catch {
    return null
  }
}
