// Live-mode test against a stubbed Extension SDK serving the Python-rendered synthetic files.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const SYN = path.join(process.env.HOME, 'derm_demo/synthetic');
const files = fs.readdirSync(SYN).filter((f) => f.endsWith('.jpg'));
const VIS = { V1: ['V1 Baseline', 0], V3: ['V3 Week 4', 28], V4: ['V4 Week 8', 56], V5: ['V5 Week 12', 84] };
const VW = { L45: 'Left 45', F: 'Frontal', R45: 'Right 45' };
const TRAJ = { strong: [1, .62, .36, .2], good: [1, .72, .48, .32], partial: [1, .86, .72, .64], none: [1, .97, 1.02, .95] };
const SYNDEF = { S101: [34, 'strong', 'good', 3, 1, 'granted'], S104: [41, 'good', 'good', 3, 1, 'granted'], S107: [29, 'strong', 'good', 3, 0, 'declined'], S112: [38, 'good', 'good', 4, 2, 'unknown'], S115: [31, 'good', 'good', 3, 1, 'granted'], S118: [36, 'partial', 'partial', 3, 2, 'granted'], S121: [27, 'none', 'none', 3, 3, 'granted'], S124: [39, 'strong', null, null, null, 'granted'], S127: [33, 'partial', null, null, null, 'granted'], S130: [37, 'good', null, null, null, 'granted'], S133: [30, 'none', null, null, null, 'unknown'], S136: [42, 'strong', null, null, null, 'granted'] };
const db = { project: { _id: 'p1', container_type: 'project', label: 'Derm Response Demo (internal)', info: {}, parents: {} }, subjects: [], sessions: {}, acqs: {} };
let fid = 0;
for (const [code, [base, traj, clin, igab, igal, consent]] of Object.entries(SYNDEF)) {
  const sid = 'sub-' + code;
  db.subjects.push({ _id: sid, container_type: 'subject', label: 'SYN-' + code, parents: { project: 'p1' }, info: {
    source: 'synthetic', response: { clinical: clin ? { label: clin, source: 'x', iga_baseline: igab, iga_latest: igal } : null, ai: null },
    consent: { marketing: { status: consent, recorded_in: 'eConsent v3.1, Section 9 [synthetic]' } }, marketing: { review: null }, demo: { trajectory: traj, expected_ai_score_if_scored: 0.8 } } });
  db.sessions[sid] = Object.entries(VIS).map(([vk, [label, day]], vi) => {
    const id = `ses-${code}-${vk}`;
    const inv = clin || vi === 0 ? { lesion_count_total: Math.round(base * TRAJ[traj][vi]) } : {};
    if (vi === 0 && igab != null) inv.iga = igab; if (vi === 3 && igal != null) inv.iga = igal;
    db.acqs[id] = Object.entries(VW).map(([wk, wl]) => ({ _id: `acq-${code}-${vk}-${wk}`, container_type: 'acquisition', label: wl, info: {},
      files: files.filter((f) => f.includes(`_${code}_${vk}_`) && f.endsWith(`_${wk}.jpg`)).map((f) => ({ _id: 'x' + (++fid), file_id: 'fid' + fid, name: f, type: 'image', size: 1, info: {} })) }));
    return { _id: id, container_type: 'session', label, info: { visit: vk, study_day: day, investigator: inv } };
  });
}
db.subjects.push({ _id: 'sub-scin1', container_type: 'subject', label: 'SCIN-123', info: { source: 'SCIN' } });
db.sessions['sub-scin1'] = [];
const stub = `
window.__fw = { writes: [], uploads: [], viewport: [], db: ${JSON.stringify(db)} };
const pg = (arr, q) => ({ count: arr.slice(q.skip||0, (q.skip||0)+(q.limit||100)).length, total: arr.length, results: arr.slice(q.skip||0, (q.skip||0)+(q.limit||100)) });
window.Flywheel = { initExtension: async (o) => ({
  user: { _id: 'tester@flywheel.example' }, params: {}, container: __fw.db.project,
  updateViewport: (v) => __fw.viewport.push(v),
  getContainer: async (t, id) => { if (t==='project') return __fw.db.project; if (t==='subject') return __fw.db.subjects.find(s=>s._id===id); if (t==='session') return Object.values(__fw.db.sessions).flat().find(s=>s._id===id); return Object.values(__fw.db.acqs).flat().find(a=>a._id===id); },
  getChildContainers: async (p, t, q) => { await new Promise(r=>setTimeout(r,5)); if (t==='subject') return pg(__fw.db.subjects.map(s=>({...s, info: undefined})), q); if (t==='session') return pg(__fw.db.sessions[p._id]||[], q); return pg(__fw.db.acqs[p._id]||[], q); },
  getFileBlob: async (c, f) => { const r = await fetch('/syn/' + f.name); return r.blob(); },
  updateContainerInfo: async (c, upd) => { __fw.writes.push({ id: c._id, upd: JSON.parse(JSON.stringify(upd)) }); },
  uploadFile: (c, file) => ({ subscribe: ({ complete }) => { __fw.uploads.push({ id: c._id, name: file.name, size: file.size }); setTimeout(complete, 10); } }),
}) };`;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.route('https://cdn.flywheel.io/**', (r) => r.fulfill({ contentType: 'application/javascript', body: stub }));
  await p.route('http://app.test/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith('/syn/')) return r.fulfill({ path: path.join(SYN, decodeURIComponent(u.pathname.slice(5))), contentType: 'image/jpeg' });
    return r.fulfill({ path: path.join(__dirname, '../dist/responder-review.html'), contentType: 'text/html' });
  });
  await p.goto('http://app.test/index.html#live');
  await p.waitForSelector('.tile img', { timeout: 30000 });
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'test/20-live-grid.png' });
  const q = await p.locator('.q-item').count();
  const picks = p.locator('.tile .pick button');
  await picks.nth(0).click(); await picks.nth(3).click();
  await p.getByRole('button', { name: 'Record Decision...' }).click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Record as/ }).click();
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Export PDF...' }).click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'test/21-live-pdf.png' });
  const dlP = p.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await p.getByRole('button', { name: /Save PDF/ }).click();
  const dl = await dlP; if (dl) await dl.saveAs('test/live-report.pdf');
  await p.waitForTimeout(1000);
  await p.getByRole('button', { name: 'Info' }).click();
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'test/22-live-info.png' });
  const fw = await p.evaluate(() => ({ writes: __fw.writes, uploads: __fw.uploads, viewport: __fw.viewport }));
  console.log('queue items', q);
  console.log('viewport', JSON.stringify(fw.viewport));
  console.log('writes', JSON.stringify(fw.writes).slice(0, 900));
  console.log('uploads', JSON.stringify(fw.uploads));
  console.log('errors', errs);
  await b.close();
})();
