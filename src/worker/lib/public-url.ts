export function configuredPublicOrigin(value?: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

export function normalizePublicRequest(request: Request, configured?: string): Request {
  const origin = configuredPublicOrigin(configured)
  if (!origin) return request
  const url = new URL(request.url)
  if (url.origin === origin) return request
  const canonical = new URL(`${url.pathname}${url.search}${url.hash}`, origin)
  return new Request(canonical, request)
}
