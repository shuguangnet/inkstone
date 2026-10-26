import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebdavConfig } from '@shared/types';
import { authHeader, resolveWebdavBase, webdavDeliverArchive, webdavFetch, webdavTest } from './webdav';
import { fetchBackupArchive } from './restore';

const config: WebdavConfig = { url: 'https://webdav.pcloud.com/dav/', username: 'writer', prefix: 'inkstone', mode: 'archive' };
const secret = { password: 'test-only-password' };
const redirect = (location: string, status = 307) => new Response('redirect', { status, headers: { Location: location } });
afterEach(() => vi.unstubAllGlobals());

describe('WebDAV redirects', () => {
  it('preserves DAV methods, headers and replayable bodies through relative redirects', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(redirect('../canonical/', 301)).mockResolvedValueOnce(new Response(null, { status: 207 }));
    vi.stubGlobal('fetch', fetcher);
    const init = { method: 'PROPFIND', headers: { Authorization: authHeader(config, secret), Depth: '0' }, body: '<propfind/>' };
    await webdavFetch(config.url, init, 'https://webdav.pcloud.com');
    expect(String(fetcher.mock.calls[1][0])).toBe('https://webdav.pcloud.com/canonical/');
    expect(fetcher.mock.calls[1][1]).toEqual({ ...init, redirect: 'manual' });
  });

  it('automatically resolves the exact official pCloud regional endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(redirect('https://ewebdav.pcloud.com/dav/')).mockResolvedValueOnce(new Response(null, { status: 207 }));
    vi.stubGlobal('fetch', fetcher);
    const connection = await resolveWebdavBase(config, secret);
    expect(connection.base.href).toBe('https://ewebdav.pcloud.com/dav/');
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe(authHeader(config, secret));
  });

  it.each(['https://storage.provider.com/dav/', 'https://webdav.pcloud.com.evil.com/dav/', 'https://evil.pcloud.com/dav/', 'https://ewebdav.pcloud.com:8443/dav/'])('never sends credentials to an untrusted redirect: %s', async (url) => {
    const fetcher = vi.fn().mockResolvedValue(redirect(url));
    vi.stubGlobal('fetch', fetcher);
    const result = await webdavTest(config, secret);
    expect(result.ok).toBe(false);
    expect(result.redirectUrl).toBe(url);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(secret.password);
    expect(JSON.stringify(result)).not.toContain(authHeader(config, secret));
  });

  it.each(['http://ewebdav.pcloud.com/dav/', 'https://127.0.0.1/dav/', 'https://localhost/dav/', 'https://writer:password@storage.example/dav/', 'https://storage.provider.com/dav/?token=private'])('rejects unsafe suggestions before sending credentials: %s', async (url) => {
    const fetcher = vi.fn().mockResolvedValue(redirect(url));
    vi.stubGlobal('fetch', fetcher);
    const result = await webdavTest(config, secret);
    expect(result.ok).toBe(false);
    expect(result.redirectUrl).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('cancels redirect response bodies and bounds redirect loops', async () => {
    const cancelled = vi.fn();
    const fetcher = vi.fn(() => Promise.resolve(new Response(new ReadableStream({ cancel: cancelled }), { status: 308, headers: { Location: '/dav/' } })));
    vi.stubGlobal('fetch', fetcher);
    await expect(webdavFetch(config.url, { method: 'PROPFIND' }, new URL(config.url).origin)).rejects.toThrow('Too many WebDAV redirects');
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(cancelled).toHaveBeenCalledTimes(5);
  });

  it('refuses to replay a streaming upload', async () => {
    const fetcher = vi.fn().mockResolvedValue(redirect('/canonical/'));
    vi.stubGlobal('fetch', fetcher);
    await expect(webdavFetch(config.url, { method: 'PUT', body: new ReadableStream() as unknown as BodyInit }, new URL(config.url).origin, false)).rejects.toThrow('streaming upload');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('canonical DAV operations', () => {
  it('tests read/write/delete using the canonical base and returns it for saving', async () => {
    let written: BodyInit | null | undefined;
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: URL, init: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init.method! });
      if (url === config.url) return redirect('https://ewebdav.pcloud.com/final/');
      expect(url.startsWith('https://ewebdav.pcloud.com/final/')).toBe(true);
      if (init.method === 'PROPFIND') return new Response(null, { status: 207 });
      if (init.method === 'MKCOL') return new Response(null, { status: 201 });
      if (init.method === 'PUT') { written = init.body; return new Response(null, { status: 201 }); }
      if (init.method === 'GET') return new Response(written);
      return new Response(null, { status: 204 });
    }));
    const result = await webdavTest(config, secret);
    expect(result.ok).toBe(true);
    expect(result.resolvedUrl).toBe('https://ewebdav.pcloud.com/final/');
    expect(calls.map((call) => call.method)).toEqual(['PROPFIND', 'PROPFIND', 'MKCOL', 'PUT', 'GET', 'DELETE']);
    expect(calls.at(-1)?.url).toBe(calls.at(-2)?.url);
  });

  it('resolves object redirects with HEAD before sending an archive stream exactly once', async () => {
    vi.stubGlobal('FixedLengthStream', class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(expected: bigint) {
        let received = 0n;
        super({ transform(bytes, controller) { received += BigInt(bytes.length); controller.enqueue(bytes); }, flush() { expect(received).toBe(expected); } });
      }
    });
    const payload = new TextEncoder().encode('PK test archive');
    const uploaded: string[] = [];
    const fetcher = vi.fn(async (input: URL, init: RequestInit) => {
      const url = String(input);
      if (url === config.url) return redirect('https://ewebdav.pcloud.com/final/');
      if (init.method === 'PROPFIND') return new Response(null, { status: 207 });
      if (init.method === 'MKCOL') return new Response(null, { status: 201 });
      if (init.method === 'HEAD' && !url.endsWith('/resolved.zip')) return redirect('/final/resolved.zip');
      if (init.method === 'HEAD') return new Response(null, { status: 404 });
      expect(init.method).toBe('PUT');
      uploaded.push(url);
      expect(new Uint8Array(await new Response(init.body).arrayBuffer())).toEqual(payload);
      return new Response(null, { status: 201 });
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await webdavDeliverArchive(config, secret, { filename: 'test.zip', byteLength: BigInt(payload.length), byteLengthNumber: payload.length, stream: new ReadableStream({ start(controller) { controller.enqueue(payload); controller.close(); } }) });
    expect(result).toEqual({ files: 1, bytes: payload.length, path: 'inkstone/backups/test.zip' });
    expect(uploaded).toEqual(['https://ewebdav.pcloud.com/final/resolved.zip']);
    expect(fetcher.mock.calls.slice(1).every(([url]) => String(url).startsWith('https://ewebdav.pcloud.com/'))).toBe(true);
  });

  it('restores from the resolved base, follows GET redirects and supports Unicode credentials', async () => {
    const unicodeConfig = { ...config, username: '\u5199\u4f5c\u8005' };
    const unicodeSecret = { password: '\u5bc6\u7801' };
    const fetcher = vi.fn(async (input: URL, init: RequestInit) => {
      expect(new Headers(init.headers).get('Authorization')).toBe('Basic ' + Buffer.from('\u5199\u4f5c\u8005:\u5bc6\u7801').toString('base64'));
      const url = String(input);
      if (url === config.url) return redirect('https://ewebdav.pcloud.com/final/');
      if (init.method === 'PROPFIND') return new Response(null, { status: 207 });
      expect(init.method).toBe('GET');
      if (!url.endsWith('/download.zip')) return redirect('/final/download.zip');
      return new Response('archive contents');
    });
    vi.stubGlobal('fetch', fetcher);
    const restored = await fetchBackupArchive(unicodeConfig, unicodeSecret, '2026-10-25');
    expect(new TextDecoder().decode(restored)).toBe('archive contents');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
