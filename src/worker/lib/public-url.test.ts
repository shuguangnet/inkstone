import { describe, expect, it } from 'vitest'
import { configuredPublicOrigin, normalizePublicRequest } from './public-url'

describe('configuredPublicOrigin', () => {
  it('accepts HTTPS and local development origins', () => {
    expect(configuredPublicOrigin('https://notes.example.com/path')).toBe('https://notes.example.com')
    expect(configuredPublicOrigin('http://localhost:7712/path')).toBe('http://localhost:7712')
  })

  it('rejects insecure public and invalid URLs', () => {
    expect(configuredPublicOrigin('http://notes.example.com')).toBeNull()
    expect(configuredPublicOrigin('not a url')).toBeNull()
  })
})

describe('normalizePublicRequest', () => {
  it('replaces the internal reverse-proxy origin and preserves the path', () => {
    const request = new Request('http://app:7712/api/health?full=1', {
      headers: { 'X-Test': 'present' },
    })
    const normalized = normalizePublicRequest(request, 'https://notes.example.com')

    expect(normalized.url).toBe('https://notes.example.com/api/health?full=1')
    expect(normalized.headers.get('X-Test')).toBe('present')
  })

  it('returns the original request without a valid configured origin', () => {
    const request = new Request('http://app:7712/api/health')
    expect(normalizePublicRequest(request)).toBe(request)
  })
})
