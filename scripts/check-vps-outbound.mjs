import { Miniflare } from 'miniflare';

const mf = new Miniflare({
  modules: true,
  compatibilityDate: '2026-05-01',
  compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
  script: `export default {
    async fetch() {
      const results = [];
      for (const url of ['https://app.koofr.net/dav/Koofr', 'https://s3.amazonaws.com/']) {
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
        await response.body?.cancel();
        results.push({ host: new URL(url).hostname, status: response.status });
      }
      return Response.json(results);
    }
  }`,
});

try {
  const response = await mf.dispatchFetch('http://localhost');
  if (!response.ok) throw new Error(`Worker outbound HTTPS check failed: HTTP ${response.status}`);
  const results = await response.json();
  if (!Array.isArray(results) || results.length !== 2 || results.some((result) => result.status < 200 || result.status >= 500)) {
    throw new Error('WebDAV or S3 did not return a reachable service response');
  }
  for (const result of results) console.log(`${result.host}: HTTPS reachable (HTTP ${result.status})`);
} finally {
  await mf.dispose();
}
