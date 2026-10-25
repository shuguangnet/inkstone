import { decodeDataValue } from './data-attr'
import { t } from '../i18n'

export function hydrateDrawio(root: HTMLElement): void {
  for (const block of root.querySelectorAll<HTMLElement>('[data-drawio]')) {
    if (block.querySelector('iframe')) continue
    const source = decodeDataValue(block.dataset.drawio)
    const frame = document.createElement('iframe')
    frame.className = 'drawio-viewer'
    frame.title = block.dataset.drawioTitle || 'Draw.io'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.referrerPolicy = 'no-referrer'
    frame.src = '/drawio-viewer.html'
    frame.loading = 'lazy'
    const placeholder = block.querySelector<HTMLElement>('.drawio-placeholder')
    const showError = () => {
      if (placeholder) { placeholder.hidden = false; placeholder.textContent = t('drawio.render_error') }
    }
    const timer = window.setTimeout(showError, 30000)
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object') return
      if (event.data.event === 'drawio-ready') frame.contentWindow?.postMessage({ action: 'drawio-render', xml: source }, '*')
      if (event.data.event === 'drawio-size' && Number.isFinite(event.data.height)) {
        window.clearTimeout(timer)
        frame.style.height = `${Math.max(160, Math.min(1000, event.data.height))}px`
        if (placeholder) placeholder.hidden = true
      }
      if (event.data.event === 'drawio-error') { window.clearTimeout(timer); showError() }
    }
    window.addEventListener('message', receive)
    const observer = new MutationObserver(() => {
      if (!frame.isConnected) { window.clearTimeout(timer); window.removeEventListener('message', receive); observer.disconnect() }
    })
    block.append(frame)
    observer.observe(document.body, { childList: true, subtree: true })
    frame.addEventListener('load', () => frame.contentWindow?.postMessage({ action: 'drawio-render', xml: source }, '*'))
  }
}

export async function inlineDrawioImages(root: HTMLElement): Promise<void> {
  for (const block of root.querySelectorAll<HTMLElement>('[data-drawio]')) {
    const xml = decodeDataValue(block.dataset.drawio)
    const svg = await diagramSnapshot(xml)
    const image = document.createElement('img')
    image.alt = block.dataset.drawioTitle || 'Draw.io'
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    block.querySelectorAll('[data-drawio-edit], .drawio-placeholder').forEach((node) => node.remove())
    block.append(image)
    delete block.dataset.drawio
  }
}

function diagramSnapshot(xml: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;left:-10000px;width:1000px;height:800px;border:0'
    frame.src = '/drawio-viewer.html'
    const cleanup = () => { window.clearTimeout(timer); window.removeEventListener('message', receive); frame.remove() }
    const fail = () => { cleanup(); reject(new Error(t('drawio.render_error'))) }
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object') return
      if (event.data.event === 'drawio-ready') frame.contentWindow?.postMessage({ action: 'drawio-render', xml }, '*')
      if (event.data.event === 'drawio-size') frame.contentWindow?.postMessage({ action: 'drawio-snapshot' }, '*')
      if (event.data.event === 'drawio-error') fail()
      if (event.data.event === 'drawio-snapshot' && typeof event.data.svg === 'string' && event.data.svg.length < 10_000_000) {
        cleanup()
        resolve(event.data.svg)
      }
    }
    const timer = window.setTimeout(fail, 30000)
    window.addEventListener('message', receive)
    document.body.append(frame)
  })
}
