// Live adapter: Flywheel Extension SDK 0.14.9 (UMD, window.Flywheel). The app never sees a token.
import { VISITS, parseName } from './data.js';

export const SDK_URL = 'https://cdn.flywheel.io/sdk/extension/flywheel-extension-0.14.9.min.js';
export const calls = []; // diagnostics: {t, op, target, ms, ok, note}

window.FW_CHROME = {
  fullWidth: true, hideHostClose: false,
  initOptions(o) { if (this.hideHostClose) o.hideCloseButton = true; return o; },
  apply(ext) {
    const d = document.documentElement; d.classList.add('fw-embedded');
    if (this.hideHostClose) d.classList.add('fw-own-close');
    if (this.fullWidth && ext && typeof ext.updateViewport === 'function') try { ext.updateViewport({ width: '100vw' }); } catch (e) { /* host may not support */ }
  },
};

async function track(op, target, fn) {
  const t0 = performance.now();
  const rec = { t: new Date().toISOString().slice(11, 19), op, target, ms: 0, ok: true, note: '' };
  calls.push(rec);
  try {
    const r = await fn();
    rec.ms = Math.round(performance.now() - t0);
    return r;
  } catch (e) {
    rec.ms = Math.round(performance.now() - t0); rec.ok = false; rec.note = e?.message || String(e);
    throw e;
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function pageAll(fetchPage) {
  const all = [];
  for (let skip = 0; ; skip += 100) {
    const p = await fetchPage({ limit: 100, skip });
    const rows = Array.isArray(p) ? p : p?.results || [];
    all.push(...rows);
    const total = Array.isArray(p) ? rows.length : (p?.total ?? rows.length);
    if (rows.length < 100 || all.length >= total) break;
  }
  return all;
}

export function wantLive() {
  if (location.hash.includes('demo')) return false;
  if (location.hash.includes('live')) return true;
  return window.parent !== window && /\.flywheel\.io/.test(document.referrer);
}

export async function connect() {
  if (!window.Flywheel?.initExtension) throw new Error('Extension SDK did not load');
  const ext = await Flywheel.initExtension(window.FW_CHROME.initOptions({
    scope: 'ReadWrite',
    validateOrigin: (o) => /^https:\/\/[a-z0-9.-]+\.flywheel\.io$/.test(o),
  }));
  window.FW_CHROME.apply(ext);
  return ext;
}

function normaliseReview(review, files) {
  if (!review) return review;
  const images = (review.images || []).map((im) => {
    if (typeof im === 'string') return im;
    const p = parseName(im.name || '');
    return p ? `f-${p.subject}-${p.visit}-${p.lighting}-${p.view}` : null;
  }).filter(Boolean);
  return { ...review, images, image_files: review.images };
}

export async function loadProject(ext, onProgress) {
  const params = ext.params || {};
  let project = null;
  const c = ext.container;
  if (c?.container_type === 'project') project = c;
  else if (params.project_id) project = await track('getContainer', 'project', () => ext.getContainer('project', params.project_id));
  else if (c?.parents?.project) project = await track('getContainer', 'project', () => ext.getContainer('project', c.parents.project));
  if (!project) throw new Error('Launch from a project (⋮ › Launch In), or set project_id in the app options.');
  if (!project.info) project = await track('getContainer', 'project', () => ext.getContainer('project', project._id));

  const re = new RegExp(params.subject_filter || '^SYN-');
  const subs = await track('getChildContainers', 'subjects', () => pageAll((q) => ext.getChildContainers(project, 'subject', q)));
  const keep = subs.filter((s) => re.test(s.label)).sort((a, b) => a.label.localeCompare(b.label));
  let done = 0;
  const subjects = await pool(keep, 4, async (s0) => {
    const s = await track('getContainer', s0.label, () => ext.getContainer('subject', s0._id));
    const sessions0 = await track('getChildContainers', `${s0.label} sessions`, () => pageAll((q) => ext.getChildContainers(s, 'session', q)));
    const sessions = await pool(sessions0, 4, async (se0) => {
      const se = se0.info && Object.keys(se0.info).length ? se0 : await track('getContainer', se0.label, () => ext.getContainer('session', se0._id));
      const acqs0 = await track('getChildContainers', `${s0.label}/${se0.label} acqs`, () => pageAll((q) => ext.getChildContainers(se, 'acquisition', q)));
      const acqs = await pool(acqs0, 4, (a) => (a.files ? a : track('getContainer', a.label, () => ext.getContainer('acquisition', a._id))));
      return { se, acqs };
    });
    const files = {};
    let code = s.label.replace(/^SYN-/, '');
    const outSessions = [];
    for (const { se, acqs } of sessions) {
      for (const a of acqs) {
        for (const f of a.files || []) {
          const p = parseName(f.name);
          if (!p) continue;
          code = p.subject;
          files[`${p.visit}-${p.lighting}-${p.view}`] = { file: f, acq: a, parsed: p };
        }
      }
      const visit = se.info?.visit || (se.label.match(/^(V\d)/) || [])[1];
      outSessions.push({ _id: se._id, label: se.label, timestamp: se.timestamp, info: { visit, study_day: se.info?.study_day, investigator: se.info?.investigator || {} }, acquisitions: acqs });
    }
    // order sessions as the app expects (Baseline, W4, W8, W12); empty placeholders if a visit is missing
    const ordered = VISITS.map((v) => outSessions.find((x) => x.info.visit === v.key) || { _id: null, label: v.label, info: { visit: v.key, investigator: {} }, acquisitions: [] });
    const info = s.info || {};
    const review = normaliseReview(info.marketing?.review, files);
    onProgress?.(++done, keep.length);
    return {
      _id: s._id, label: s.label, code,
      info: {
        response: { clinical: info.response?.clinical || null, ai: info.response?.ai || null },
        consent: { marketing: info.consent?.marketing || { status: 'unknown', recorded_in: 'No consent.marketing on this subject' } },
        marketing: { review, review_history: info.marketing?.review_history || [] },
      },
      sessions: ordered,
      _live: { container: s, files, api: null },
    };
  });
  return { project, subjects, total: subs.length };
}

export function makeApi(ext, project) {
  return {
    site: (document.referrer.match(/^https:\/\/([^.]+)/) || [])[1] || 'flywheel',
    user: ext.user?._id || ext.user?.email || 'unknown user',
    fileBlob: (acq, file) => track('getFileBlob', file.name, () => ext.getFileBlob(acq, file)),
    async saveReview(s, review, historyEntry) {
      const history = [...(s.info.marketing.review_history || []), historyEntry];
      await track('updateContainerInfo', `${s.label} marketing`, () => ext.updateContainerInfo(s._live.container, {
        set: { marketing: { review, review_history: history } },
      }));
      return history;
    },
    async uploadReport(blob, filename) {
      const file = new File([blob], filename, { type: 'application/pdf' });
      await track('uploadFile', filename, () => new Promise((resolve, reject) => {
        ext.uploadFile(project, file).subscribe({ error: reject, complete: resolve });
      }));
    },
    async recordExport(entry) {
      const prev = project.info?.responder_review?.exports || [];
      const exports = [...prev, entry];
      await track('updateContainerInfo', 'project responder_review', () => ext.updateContainerInfo(project, { set: { responder_review: { exports } } }));
      project.info = { ...(project.info || {}), responder_review: { exports } };
    },
  };
}
