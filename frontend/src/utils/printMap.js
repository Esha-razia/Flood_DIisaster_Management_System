export function printMapOnly(element, map) {
  if (!element) return;
  const ancestors = [];
  let parent = element.parentElement;
  while (parent) { ancestors.push(parent); parent.classList.add('fdm-print-path'); parent = parent.parentElement; }
  element.classList.add('fdm-print-target');
  document.body.classList.add('fdm-printing');
  const center = map?.getCenter();
  const zoom = map?.getZoom();
  const resize = () => { map?.invalidateSize(); if (center) map.setView(center, zoom, { animate: false }); };
  const cleanup = () => {
    ancestors.forEach(node => node.classList.remove('fdm-print-path'));
    element.classList.remove('fdm-print-target');
    document.body.classList.remove('fdm-printing');
    window.removeEventListener('beforeprint', resize);
    window.removeEventListener('afterprint', cleanup);
    resize();
  };
  window.addEventListener('beforeprint', resize);
  window.addEventListener('afterprint', cleanup);
  try { window.print(); } catch (error) { cleanup(); throw error; }
}
