window.mxBasePath = '/drawio/mxgraph';
window.STENCIL_PATH = '/drawio/stencils';
window.SHAPES_PATH = '/drawio/shapes';
window.IMAGE_PATH = '/drawio/images';
window.mxLoadResources = false;
window.mxLoadStylesheets = false;
let rendered = '';
let pending = '';
let viewer = null;
function draw() {
  if (!pending || typeof GraphViewer === 'undefined' || pending === rendered) return;
  try {
    const xml = pending;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror') || !['mxfile', 'mxGraphModel'].includes(doc.documentElement.nodeName) || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Invalid diagram');
    const container = document.getElementById('diagram');
    container.replaceChildren();
    const graph = document.createElement('div');
    graph.className = 'mxgraph';
    graph.setAttribute('data-mxgraph', JSON.stringify({ xml, nav: true, resize: true, toolbar: '', lightbox: false, edit: null, tooltips: true, border: 12 }));
    container.append(graph);
    GraphViewer.createViewerForElement(graph, instance => { viewer = instance; });
    rendered = xml;
    setTimeout(measure, 80);
    setTimeout(measure, 600);
  } catch { parent.postMessage({ event: 'drawio-error' }, '*'); }
}
function measure() {
  if (!rendered) return;
  parent.postMessage({ event: 'drawio-size', height: document.getElementById('diagram').scrollHeight + 12 }, '*');
}
window.addEventListener('message', event => {
  if (event.source !== parent) return;
  if (event.data?.action === 'drawio-snapshot' && viewer) {
    try {
      const svg = new XMLSerializer().serializeToString(viewer.graph.getSvg('#ffffff', 1, 12));
      parent.postMessage({ event: 'drawio-snapshot', svg }, '*');
    } catch { parent.postMessage({ event: 'drawio-error' }, '*'); }
    return;
  }
  if (event.data?.action !== 'drawio-render' || typeof event.data.xml !== 'string' || event.data.xml.length > 524288) return;
  pending = event.data.xml;
  draw();
});
window.addEventListener('load', () => {
  if (typeof GraphViewer === 'undefined') parent.postMessage({ event: 'drawio-error' }, '*');
  else parent.postMessage({ event: 'drawio-ready' }, '*');
  draw();
});
new ResizeObserver(measure).observe(document.getElementById('diagram'));
