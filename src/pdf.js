// Responder image report: one cover page + one page per subject, US Letter landscape.
// Uses jsPDF (window.jspdf, UMD). Images come from the same synthetic renderer as the app.
import { VISITS, LIGHTING, VIEWS, PROJECT } from './data.js';
import { dataUrlFor, hasImage } from './images.js';

const INK = [20, 28, 45], MUTED = [104, 116, 134], LINE = [222, 226, 232], BRAND = [27, 104, 250], GREEN = [12, 146, 75];

export function reductionOf(s) {
  const b = s.sessions[0].info.investigator?.lesion_count_total;
  const l = s.sessions[3].info.investigator?.lesion_count_total;
  if (b != null && l != null) return { pct: Math.round((1 - l / b) * 100), source: 'investigator', b, l };
  const ai = s.info.response.ai;
  if (ai) { const [ab, , , al] = ai.per_visit_est_lesions; return { pct: Math.round((1 - al / ab) * 100), source: 'ai', b: ab, l: al }; }
  return null;
}

export function parseFileId(id) {
  // f-S101-V5-XPOL-F
  const [, code, visit, light, view] = id.split('-');
  return { code, visit, light, view };
}

export function imagesFor(s, opts) {
  if (opts.imageSource === 'selected' && s.info.marketing.review?.images?.length) {
    let ims = s.info.marketing.review.images.map(parseFileId);
    if (opts.ensureBaseline) {
      for (const im of [...ims]) {
        if (!ims.some((x) => x.visit === 'V1' && x.light === im.light && x.view === im.view)) ims.push({ ...im, visit: 'V1', added: true });
      }
    }
    return ims
      .sort((a, b) => LIGHTING.findIndex((l) => l.key === a.light) - LIGHTING.findIndex((l) => l.key === b.light) || a.view.localeCompare(b.view) || VISITS.findIndex((v) => v.key === a.visit) - VISITS.findIndex((v) => v.key === b.visit));
  }
  return [{ code: s.code, visit: 'V1', light: opts.light, view: opts.view }, { code: s.code, visit: 'V5', light: opts.light, view: opts.view }];
}

export function eligible(subjects, opts) {
  return subjects
    .filter((s) => s.info.marketing.review?.decision === 'approve' && s.info.consent.marketing.status === 'granted')
    .map((s) => ({ s, red: reductionOf(s) }))
    .filter(({ red }) => !opts.greatOnly || (red && red.pct >= opts.minPct))
    .sort((a, b) => (b.red?.pct ?? -1) - (a.red?.pct ?? -1));
}

function fileName(s, im) {
  const e = s._live?.files[`${im.visit}-${im.light}-${im.view}`];
  if (e) return e.file.name;
  const v = VISITS.find((x) => x.key === im.visit);
  return `DEMO-ACN-001_${s.code}_${im.visit}_D${String(v.day).padStart(3, '0')}_${im.light}_${im.view}`;
}

function watermark(doc, W, H, text) {
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.08 }));
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(40);
  const a = 28 * Math.PI / 180, tw = doc.getTextWidth(text);
  doc.text(text, W / 2 - Math.cos(a) * tw / 2, H / 2 + Math.sin(a) * tw / 2 + 18, { angle: 28 });
  doc.restoreGraphicsState();
}

function footer(doc, W, H, page, total, opts) {
  doc.setDrawColor(...LINE); doc.line(36, H - 34, W - 36, H - 34);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text(`${opts.docId} · Generated ${opts.generatedAt} by ${opts.user} · ${opts.dataNote}`, 36, H - 22);
  doc.text(`Page ${page} of ${total}`, W - 36, H - 22, { align: 'right' });
}

export async function buildReport(subjects, opts) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const rows = eligible(subjects, opts);
  const total = rows.length + (opts.cover ? 1 : 0);
  let page = 0;
  doc.setProperties({ title: `Responder Image Report ${opts.projectLabel || PROJECT.info.sponsor_study}`, subject: opts.live ? 'Marketing image selection' : 'Marketing image selection (synthetic demo)', creator: 'Flywheel Responder Review (prototype)' });

  if (opts.cover) {
    page++;
    doc.setFillColor(...BRAND); doc.rect(0, 0, W, 6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(...INK);
    doc.text('Responder Image Report', 54, 96);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.setTextColor(...MUTED);
    doc.text(`${opts.projectLabel || PROJECT.label}${opts.live ? '' : ' · ' + PROJECT.info.indication}`, 54, 120);
    const crit = [
      ['Subjects', `${rows.length} (approved for marketing use, marketing consent granted)`],
      ['Response filter', opts.greatOnly ? `Lesion reduction at least ${opts.minPct}% baseline to Week 12` : 'All approved subjects'],
      ['Images', opts.imageSource === 'selected' ? `Images selected by the reviewer at decision time${opts.ensureBaseline ? ', plus the matching baseline image where it was not selected' : ''} (baseline and Week 12 pair where none were selected)` : `Baseline and Week 12, ${LIGHTING.find((l) => l.key === opts.light).label}, ${VIEWS.find((v) => v.key === opts.view).label}`],
      ['Response source', 'Investigator lesion counts and IGA. AI estimates are shown only where noted and are exploratory.'],
      ['Generated', `${opts.generatedAt} by ${opts.user}`],
      ['Document ID', opts.docId],
    ];
    let y = 170;
    doc.setFontSize(10.5);
    for (const [k, v] of crit) {
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK); doc.text(k, 54, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED);
      const lines = doc.splitTextToSize(v, W - 260); doc.text(lines, 190, y); y += 16 * lines.length + 8;
    }
    // summary table
    y += 10;
    doc.setDrawColor(...LINE); doc.line(54, y, W - 54, y); y += 18;
    const cols = [54, 130, 250, 360, 470, 600];
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...MUTED);
    ['Subject', 'Decision', 'Lesions', 'Reduction', 'IGA', 'Consent reference'].forEach((h, i) => doc.text(h, cols[i], y));
    y += 14; doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK);
    for (const { s, red } of rows) {
      if (y > H - 70) break;
      const c = s.info.response.clinical;
      doc.text(s.code, cols[0], y);
      doc.text(s.info.marketing.review.decision_id, cols[1], y);
      doc.text(red ? `${red.b} to ${red.l}${red.source === 'ai' ? ' (AI est.)' : ''}` : '—', cols[2], y);
      doc.text(red ? `${red.pct}%` : '—', cols[3], y);
      doc.text(c ? `${c.iga_baseline} to ${c.iga_latest}` : '—', cols[4], y);
      doc.text(doc.splitTextToSize(s.info.consent.marketing.recorded_in, W - 54 - cols[5])[0], cols[5], y);
      y += 15;
    }
    if (!rows.length) { doc.setTextColor(...MUTED); doc.text('No subjects meet the criteria.', 54, y); }
    doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(`Use is limited to the purposes covered by each subject’s marketing consent. ${opts.live ? 'Source: ' + opts.sourceNote + '.' : 'This prototype report contains synthetic images generated for demonstration; it contains no patient data.'}`, W - 108), 54, H - 64);
    if (opts.watermark) watermark(doc, W, H, opts.watermarkText);
    footer(doc, W, H, page, total, opts);
  }

  for (const { s, red } of rows) {
    if (page > 0) doc.addPage();
    page++;
    const review = s.info.marketing.review, c = s.info.response.clinical;
    doc.setFillColor(...BRAND); doc.rect(0, 0, W, 6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...INK);
    doc.text(`Subject ${s.code}`, 36, 42);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
    const meta = [
      `Decision ${review.decision_id} · ${review.reason}`,
      `Reviewer ${review.reviewer} · ${review.timestamp.replace('T', ' ').replace('Z', ' UTC')}`,
      `Consent: ${s.info.consent.marketing.recorded_in}`,
    ];
    meta.forEach((m, i) => doc.text(m, 36, 60 + i * 13));
    // metric chips (right)
    const chips = [];
    if (red) chips.push([`${red.pct}%`, red.source === 'ai' ? 'AI-est. reduction' : 'Lesion reduction']);
    if (red) chips.push([`${red.b} to ${red.l}`, red.source === 'ai' ? 'AI-est. lesions' : 'Total lesions']);
    if (c && opts.metrics) chips.push([`${c.iga_baseline} to ${c.iga_latest}`, 'IGA']);
    if (opts.showAI && s.info.response.ai) chips.push([s.info.response.ai.score.toFixed(2), 'AI score (exploratory)']);
    let cx = W - 36;
    for (const [v, k] of chips.reverse()) {
      const w = Math.max(doc.getTextWidth(k) * (8 / 9.5) + 20, 70);
      cx -= w;
      doc.setDrawColor(...LINE); doc.setFillColor(248, 249, 251); doc.roundedRect(cx, 26, w, 44, 4, 4, 'FD');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...(k.includes('reduction') ? GREEN : INK)); doc.text(v, cx + 10, 46);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(k, cx + 10, 61);
      cx -= 8;
    }

    // image grid
    const ims = imagesFor(s, opts).slice(0, 6);
    const n = ims.length;
    const colsN = n <= 2 ? n : n === 4 ? 2 : 3, rowsN = Math.ceil(n / colsN);
    const top = 104, bottom = H - 50, gap = 14;
    const areaW = W - 72, areaH = bottom - top;
    const capH = 26;
    let cw = (areaW - gap * (colsN - 1)) / colsN;
    let ch = cw * 0.75;
    if (ch * rowsN + (capH + gap) * rowsN > areaH) { ch = (areaH - (capH + gap) * rowsN) / rowsN; cw = ch / 0.75; }
    const startX = 36 + (areaW - (cw * colsN + gap * (colsN - 1))) / 2;
    for (let i = 0; i < ims.length; i++) {
      const im = ims[i];
      const vi = VISITS.findIndex((v) => v.key === im.visit);
      const x = startX + (i % colsN) * (cw + gap), y = top + Math.floor(i / colsN) * (ch + capH + gap);
      const url = hasImage(s, im.visit, im.light, im.view) ? await dataUrlFor(s, im.visit, im.light, im.view, 960, 720) : null;
      if (url) doc.addImage(url, 'JPEG', x, y, cw, ch, undefined, 'FAST');
      else { doc.setFillColor(240, 241, 243); doc.rect(x, y, cw, ch, 'F'); doc.setFontSize(9); doc.setTextColor(...MUTED); doc.text('Image not available', x + cw / 2, y + ch / 2, { align: 'center' }); }
      doc.setDrawColor(...LINE); doc.rect(x, y, cw, ch);
      const v = VISITS[vi];
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
      doc.text(`${v.label} · Day ${v.day} · ${LIGHTING.find((l) => l.key === im.light).label} · ${VIEWS.find((x2) => x2.key === im.view).label}${im.added ? ' (added)' : ''}`, x, y + ch + 12);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
      doc.text(fileName(s, im), x, y + ch + 22);
      opts.onProgress?.();
    }
    if (opts.watermark) watermark(doc, W, H, opts.watermarkText);
    footer(doc, W, H, page, total, opts);
  }
  return { blob: doc.output('blob'), pages: total, subjects: rows.length };
}
