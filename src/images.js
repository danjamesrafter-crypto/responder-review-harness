// One image source for both modes.
// Demo: synthetic tiles drawn in the browser. Live: the real file, fetched once through the Extension SDK.
import { renderTile } from './render.js';
import { VISITS } from './data.js';

const TRAJ = { strong: [1, 0.62, 0.36, 0.2], good: [1, 0.72, 0.48, 0.32], partial: [1, 0.86, 0.72, 0.64], none: [1, 0.97, 1.02, 0.95] };
const urls = new Map();      // file_id -> object URL
const pending = new Map();   // file_id -> Promise<url>

export const imgKey = (code, visit, light, view) => `f-${code}-${visit}-${light}-${view}`;

export function liveEntry(s, visit, light, view) {
  return s._live?.files[`${visit}-${light}-${view}`] || null;
}

export function hasImage(s, visit, light, view) {
  return s._live ? !!liveEntry(s, visit, light, view) : true;
}

function mockSrc(s, visit, light, view, w, h, align = true) {
  const vi = VISITS.findIndex((v) => v.key === visit);
  return renderTile({ subject: s.code, base: s._raw.base, remain: TRAJ[s._raw.traj][vi], visitIdx: vi, lighting: light, view, align, w, h });
}

export function cachedSrc(s, visit, light, view, w, h, align) {
  if (!s._live) return mockSrc(s, visit, light, view, w, h, align);
  const e = liveEntry(s, visit, light, view);
  return e ? urls.get(e.file.file_id) || null : null;
}

export async function loadSrc(s, visit, light, view, w, h, align) {
  if (!s._live) return mockSrc(s, visit, light, view, w, h, align);
  const e = liveEntry(s, visit, light, view);
  if (!e) return null;
  const id = e.file.file_id;
  if (urls.has(id)) return urls.get(id);
  if (!pending.has(id)) {
    pending.set(id, s._live.api.fileBlob(e.acq, e.file).then((blob) => {
      const u = URL.createObjectURL(blob);
      urls.set(id, u);
      pending.delete(id);
      return u;
    }).catch((err) => { pending.delete(id); throw err; }));
  }
  return pending.get(id);
}

export function useImg(s, visit, light, view, w, h, align = true) {
  const { useState, useEffect } = window.React;
  const [state, setState] = useState(() => ({ url: cachedSrc(s, visit, light, view, w, h, align), err: null }));
  useEffect(() => {
    let on = true;
    const now = cachedSrc(s, visit, light, view, w, h, align);
    setState({ url: now, err: null });
    if (!now && hasImage(s, visit, light, view)) {
      loadSrc(s, visit, light, view, w, h, align).then((u) => on && setState({ url: u, err: null }))
        .catch((e) => on && setState({ url: null, err: e?.message || 'load failed' }));
    }
    return () => { on = false; };
  }, [s._id, visit, light, view, w, h, align]);
  return { ...state, missing: !hasImage(s, visit, light, view) };
}

export async function dataUrlFor(s, visit, light, view, w, h) {
  const src = await loadSrc(s, visit, light, view, w, h, true);
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  // re-encode the live JPEG at a sane size so the PDF stays small
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, w / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}
