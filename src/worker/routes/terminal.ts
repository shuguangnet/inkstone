import { Hono } from 'hono'
import type { AppBindings } from '../env'
import { ApiError } from '../lib/errors'
import { requireAuth } from '../middleware/auth'

export const terminalRoutes = new Hono<AppBindings>()

terminalRoutes.use('*', requireAuth)
terminalRoutes.get('/authorize', (c) => {
  if (c.get('user').role !== 'owner') {
    throw ApiError.forbidden('Only the owner can open the server terminal')
  }
  c.header('Cache-Control', 'no-store')
  return c.json({ authorized: true })
})
