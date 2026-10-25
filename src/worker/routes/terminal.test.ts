import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { AppBindings } from '../env'
import { errorResponse } from '../lib/errors'
import { terminalRoutes } from './terminal'

function appFor(role?: 'owner' | 'member') {
  const app = new Hono<AppBindings>()
  app.onError((error, c) => errorResponse(c, error))
  app.use('*', async (c, next) => {
    if (role) {
      c.set('userId', 'test-user')
      c.set('user', { id: 'test-user', role, username: 'test', login: 'test', name: 'Test', avatarUrl: '', createdAt: 0, settingsRaw: '{}' })
    }
    await next()
  })
  app.route('/api/terminal', terminalRoutes)
  return app
}

describe('terminal session authorization', () => {
  it('rejects signed-out visitors', async () => {
    expect((await appFor().request('/api/terminal/authorize')).status).toBe(401)
  })
  it('rejects members', async () => {
    expect((await appFor('member').request('/api/terminal/authorize')).status).toBe(403)
  })
  it('allows owners without exposing a pairing secret or caching authorization', async () => {
    const response = await appFor('owner').request('/api/terminal/authorize')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authorized: true })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
