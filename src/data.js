// Mock data shaped like Flywheel container payloads (project > subject > session > acquisition > file).
// Swap `api` for the extension-SDK adapter in the live harness (ext.apiRequest).
// All subjects, images and scores are SYNTHETIC.

export const PROJECT = {
  _id: 'p-demo-acn-001',
  label: 'Blinded Derm Study (demo)',
  group: 'sponsor-clinical',
  info: { indication: 'Inflammatory facial lesions (blinded)', sponsor_study: 'DEMO-ACN-001', device: 'Standardized photo system (simulated)' },
};

export const VISITS = [
  { key: 'V1', label: 'Baseline', day: 0 },
  { key: 'V3', label: 'Week 4', day: 28 },
  { key: 'V4', label: 'Week 8', day: 56 },
  { key: 'V5', label: 'Week 12', day: 84 },
];

export const LIGHTING = [
  { key: 'STD', label: 'Standard', short: 'Std' },
  { key: 'XPOL', label: 'Cross-Polarized', short: 'X-Pol' },
  { key: 'PPOL', label: 'Parallel-Polarized', short: 'P-Pol' },
  { key: 'UV', label: 'UV Fluorescence', short: 'UV' },
];

export const VIEWS = [
  { key: 'L45', label: 'Left 45°' },
  { key: 'F', label: 'Frontal' },
  { key: 'R45', label: 'Right 45°' },
];

// trajectory = fraction of baseline lesions remaining at each visit
const T = {
  strong: [1, 0.62, 0.36, 0.2],
  good: [1, 0.72, 0.48, 0.32],
  partial: [1, 0.86, 0.72, 0.64],
  none: [1, 0.97, 1.02, 0.95],
};

const S = (n, o) => ({ n, ...o });
const RAW = [
  S(101, { base: 34, traj: 'strong', clinical: 'good', igaB: 3, igaL: 1, consent: 'granted', consentSrc: 'eConsent v3.1 — Section 9 (marketing use)' }),
  S(104, { base: 41, traj: 'good', clinical: 'good', igaB: 3, igaL: 1, consent: 'granted', consentSrc: 'eConsent v3.1 — Section 9 (marketing use)', decided: 'approve4' }),
  S(107, { base: 29, traj: 'strong', clinical: 'good', igaB: 3, igaL: 0, consent: 'declined', consentSrc: 'eConsent v3.1 — Section 9 declined' }),
  S(112, { base: 38, traj: 'good', clinical: 'good', igaB: 4, igaL: 2, consent: 'unknown', consentSrc: 'Paper ICF — not yet reconciled' }),
  S(115, { base: 31, traj: 'good', clinical: 'good', igaB: 3, igaL: 1, consent: 'granted', consentSrc: 'eConsent v3.1 — Section 9 (marketing use)', decided: 'approve' }),
  S(118, { base: 36, traj: 'partial', clinical: 'partial', igaB: 3, igaL: 2, consent: 'granted', consentSrc: 'eConsent v3.1 — Section 9 (marketing use)' }),
  S(121, { base: 27, traj: 'none', clinical: 'none', igaB: 3, igaL: 3, consent: 'granted', consentSrc: 'eConsent v3.1 — Section 9 (marketing use)' }),
  // No clinical label in metadata (the "50–60%" gap): AI tier
  S(124, { base: 39, traj: 'strong', clinical: null, consent: 'granted', consentSrc: 'eConsent v3.1 — Section 9 (marketing use)', ai: 0.88 }),
  S(127, { base: 33, traj: 'partial', clinical: null, consent: 'granted', consentSrc: 'eConsent v3.1 — Section 9 (marketing use)', ai: 0.41 }),
  S(130, { base: 37, traj: 'good', clinical: null, consent: 'granted', consentSrc: 'eConsent v3.1 — Section 9 (marketing use)' }),
  S(133, { base: 30, traj: 'none', clinical: null, consent: 'unknown', consentSrc: 'Paper ICF — not yet reconciled' }),
  S(136, { base: 42, traj: 'strong', clinical: null, consent: 'granted', consentSrc: 'eConsent v3.1 — Section 9 (marketing use)' }),
];

export const MODEL = {
  gear: 'derm-response-scorer',
  gear_version: '0.1.0_dermfoundation-1.0 (demo)',
  model: 'Google Derm Foundation (BiT-M ResNet101x3, 448×448 in, 6144-d embedding)',
  head: 'Logistic head on per-visit embedding deltas — v0.1 (NOT TRAINED: simulated)',
};

const iso = (d) => new Date(Date.UTC(2026, 3, 6) + d * 864e5).toISOString();

export function aiFor(r) {
  // simulate a head that roughly tracks the true trajectory with noise
  const remain = T[r.traj][3];
  const score = Math.max(0.05, Math.min(0.97, 1.1 - remain * 1.05 + ((r.n % 7) - 3) * 0.015));
  return +score.toFixed(2);
}

export function aiCounts(r) {
  return T[r.traj].map((f, i) => Math.round(r.base * f * (1 + (((r.n + i) % 5) - 2) * 0.04)));
}

export function buildSubjects() {
  return RAW.map((r) => {
    const code = `S${String(r.n).padStart(3, '0')}`;
    const counts = T[r.traj].map((f) => Math.round(r.base * f));
    const sessions = VISITS.map((v, vi) => ({
      _id: `ses-${code}-${v.key}`,
      label: `${v.key} ${v.label}`,
      timestamp: iso(v.day + (r.n % 3)),
      info: {
        visit: v.key,
        study_day: v.day,
        investigator: r.clinical !== null || vi === 0 ? { lesion_count_total: counts[vi], iga: vi === 0 ? r.igaB ?? null : null } : {},
      },
      acquisitions: VIEWS.map((vw) => ({
        _id: `acq-${code}-${v.key}-${vw.key}`,
        label: `${vw.label}`,
        files: LIGHTING.map((l) => ({
          file_id: `f-${code}-${v.key}-${l.key}-${vw.key}`,
          name: `DEMO-ACN-001_${code}_${v.key}_D${String(v.day).padStart(3, '0')}_${l.key}_${vw.key}.NEF`,
          type: 'image',
          size: 24_800_000 + ((r.n * 97 + vi * 13) % 900) * 1000,
          info: {}, // populated by the ingest manifest rule (see parseName)
        })),
      })),
    }));
    // IGA latest only when clinically labelled
    if (r.clinical !== null) sessions[3].info.investigator.iga = r.igaL;
    const ai = r.ai != null ? {
      score: r.ai, label: r.ai >= 0.7 ? 'likely_responder' : 'unlikely_responder',
      gear: MODEL.gear, gear_version: MODEL.gear_version, analysis_id: `an-${code}-7f3a`, run_at: '2026-11-18T14:02:11Z',
      per_visit_est_lesions: aiCounts(r),
    } : null;
    const seededDecision = r.decided === 'approve' ? {
      decision: 'approve', reason: 'Clear visible improvement', note: 'Strong W12 X-Pol series.',
      images: [`f-${code}-V1-XPOL-F`, `f-${code}-V5-XPOL-F`], reviewer: 'm.keller@sponsor.example',
      timestamp: '2026-11-19T16:41:05Z', decision_id: 'MKT-0007',
    } : r.decided === 'approve4' ? {
      decision: 'approve', reason: 'Consistent across lighting modes', note: 'Use STD and X-Pol pairs.',
      images: [`f-${code}-V1-STD-F`, `f-${code}-V5-STD-F`, `f-${code}-V1-XPOL-F`, `f-${code}-V5-XPOL-F`], reviewer: 'm.keller@sponsor.example',
      timestamp: '2026-11-19T17:02:40Z', decision_id: 'MKT-0008',
    } : null;
    return {
      _id: `sub-${code}`,
      label: code,
      code,
      _raw: r,
      info: {
        response: {
          clinical: r.clinical ? { label: r.clinical, source: 'Investigator IGA + lesion count (EDC import)', iga_baseline: r.igaB, iga_latest: r.igaL } : null,
          ai,
        },
        consent: { marketing: { status: r.consent, recorded_in: r.consentSrc } },
        marketing: { review: seededDecision },
      },
      sessions,
    };
  });
}

// Manifest rule: {study}_{subject}_{visit}_D{day}_{lighting}_{view}.{ext}
export const NAME_RULE = '{study}_{subject}_{visit}_D{day}_{lighting}_{view}.{ext}';
export function parseName(name) {
  const m = name.match(/^([A-Z0-9-]+)_(S\d{3})_(V\d)_D(\d{3})_([A-Z]+)_([A-Z0-9]+)\.(\w+)$/);
  if (!m) return null;
  return { study: m[1], subject: m[2], visit: m[3], study_day: +m[4], lighting: m[5], view: m[6], ext: m[7] };
}

export const SEED_AUDIT = [
  { ts: '2026-11-17T09:12:44Z', user: 'svc-ingest (manifest run)', action: 'Ingest', target: 'DEMO-ACN-001', detail: '576 images indexed; 576/576 filenames parsed by rule', api: 'POST /api/jobs/add (gear: manifest-ingest)' },
  { ts: '2026-11-17T09:40:02Z', user: 'svc-edc-import', action: 'Metadata import', target: '7 subjects', detail: 'Clinical response labels imported from EDC extract; 5 subjects have no label', api: 'POST /api/subjects/{id}/info (bulk)' },
  { ts: '2026-11-18T14:02:11Z', user: 'd.rafter@flywheel.example', action: 'Gear run', target: 'S124, S127', detail: `${MODEL.gear} ${MODEL.gear_version} → info.response.ai`, api: 'POST /api/jobs/add' },
  { ts: '2026-11-19T16:41:05Z', user: 'm.keller@sponsor.example', action: 'Decision: Approve', target: 'S115', detail: 'MKT-0007 · 2 images · Clear visible improvement', api: 'POST /api/subjects/sub-S115/info' },
  { ts: '2026-11-19T17:02:40Z', user: 'm.keller@sponsor.example', action: 'Decision: Approve', target: 'S104', detail: 'MKT-0008 · 4 images · Consistent across lighting modes', api: 'POST /api/subjects/sub-S104/info' },
];
