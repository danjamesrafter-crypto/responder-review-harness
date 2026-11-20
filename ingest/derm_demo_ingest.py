#!/usr/bin/env python3
"""Derm Response Demo: build an internal "art of the possible" project on Flywheel.

Two sources, clearly separated by subject label prefix and tags:
  SYN-*   synthetic longitudinal responder subjects (same data model as the
          Responder Review prototype: 4 visits x 3 views x 4 lighting modes,
          filenames that follow the ingest manifest rule, response / consent
          metadata). Images are procedurally drawn. No patient data.
  SCIN-*  real eczema photos from Google's SCIN dataset (SCIN Data Use License;
          re-identification prohibited). Single timepoint, dermatologist
          condition labels, estimated Fitzpatrick and Monk skin tone.

No customer data. Intended for internal demos only.

Usage (in a Flywheel JupyterLab workspace, which has internet + an SDK key):
  python derm_demo_ingest.py --group dantest --dry-run
  python derm_demo_ingest.py --group dantest
Idempotent: re-running skips subjects/files that already exist.
"""
import argparse, ast, csv, io, json, os, sys, time, zlib, urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

PROJECT_LABEL = 'Derm Response Demo (internal)'
WORK = os.path.expanduser('~/derm_demo')
SCIN_BASE = 'https://storage.googleapis.com/dx-scin-public-data/'
SCIN_LICENSE_URL = 'https://raw.githubusercontent.com/google-research-datasets/scin/main/LICENSE'
SCIN_CITATION = ('Ward A, Li J, et al. Crowdsourcing Dermatology Images with Google Search Ads: Creating a '
                 'Real-World Skin Condition Dataset. arXiv:2402.18545 (2024). '
                 'Dataset: https://github.com/google-research-datasets/scin (SCIN Data Use License).')

VISITS = [('V1', 'Baseline', 0), ('V3', 'Week 4', 28), ('V4', 'Week 8', 56), ('V5', 'Week 12', 84)]
LIGHTS = [('STD', 'Standard'), ('XPOL', 'Cross-Polarized'), ('PPOL', 'Parallel-Polarized'), ('UV', 'UV Fluorescence')]
VIEWS = [('L45', 'Left 45'), ('F', 'Frontal'), ('R45', 'Right 45')]
TRAJ = {'strong': [1, .62, .36, .2], 'good': [1, .72, .48, .32], 'partial': [1, .86, .72, .64], 'none': [1, .97, 1.02, .95]}
STUDY = 'DEMO-ACN-001'
GRANTED = 'eConsent v3.1, Section 9 (marketing use) [synthetic]'
SYN = [  # n, baseline lesions, trajectory, clinical label, IGA b/l, consent, preexisting AI score
    (101, 34, 'strong', 'good', 3, 1, 'granted', None), (104, 41, 'good', 'good', 3, 1, 'granted', None),
    (107, 29, 'strong', 'good', 3, 0, 'declined', None), (112, 38, 'good', 'good', 4, 2, 'unknown', None),
    (115, 31, 'good', 'good', 3, 1, 'granted', None), (118, 36, 'partial', 'partial', 3, 2, 'granted', None),
    (121, 27, 'none', 'none', 3, 3, 'granted', None), (124, 39, 'strong', None, None, None, 'granted', None),
    (127, 33, 'partial', None, None, None, 'granted', None), (130, 37, 'good', None, None, None, 'granted', None),
    (133, 30, 'none', None, None, None, 'unknown', None), (136, 42, 'strong', None, None, None, 'granted', None),
]


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


# ---------------------------------------------------------------- synthetic images
def _rng(*parts):
    return np.random.default_rng(zlib.crc32('|'.join(map(str, parts)).encode()))


def _radial(w, h, cx, cy, r):
    y, x = np.mgrid[0:h, 0:w]
    return np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r


def _blob(img, cx, cy, r, rgb, alpha):
    """Additive-alpha gaussian blob, clipped to a local window."""
    h, w, _ = img.shape
    x0, x1 = int(max(0, cx - 3 * r)), int(min(w, cx + 3 * r + 1))
    y0, y1 = int(max(0, cy - 3 * r)), int(min(h, cy + 3 * r + 1))
    if x0 >= x1 or y0 >= y1:
        return
    y, x = np.mgrid[y0:y1, x0:x1]
    a = alpha * np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r))
    img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - a[..., None]) + np.array(rgb) * a[..., None]


def _disk(img, cx, cy, r, rgb, alpha):
    h, w, _ = img.shape
    x0, x1 = int(max(0, cx - r - 2)), int(min(w, cx + r + 3))
    y0, y1 = int(max(0, cy - r - 2)), int(min(h, cy + r + 3))
    if x0 >= x1 or y0 >= y1:
        return
    y, x = np.mgrid[y0:y1, x0:x1]
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    a = alpha * np.clip(r + 0.5 - d, 0, 1)
    img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - a[..., None]) + np.array(rgb) * a[..., None]


def render(code, base, remain, visit_idx, light, view, w=640, h=480):
    R = _rng(code, 'skin')
    sk = np.array([214 + R.random() * 22, 162 + R.random() * 22, 132 + R.random() * 20])
    uv = light == 'UV'
    tint = {'XPOL': [1.0, .93, .92], 'PPOL': [1.02, 1.0, .99]}.get(light, [1, 1, 1])
    col = np.array([58, 44, 96.]) if uv else np.minimum(255, sk * tint)
    vx = {'L45': .38, 'R45': .62}.get(view, .5)
    lx = {'L45': .25, 'R45': .75}.get(view, .5)
    # pose jitter per visit (registration would remove it)
    J = _rng(code, 'pose', visit_idx)
    jx, jy = (J.random() - .5) * .08 * w, (J.random() - .5) * .07 * h

    cx, cy = w * vx + jx, h * .56 + jy
    shade = np.clip(1 - .55 * np.clip(_radial(w, h, w * lx + jx, h * .35 + jy, w * .62), 0, 1) ** 1.6, .4, 1.08)
    img = col[None, None, :] * shade[..., None]
    mask = (((np.mgrid[0:h, 0:w][1] - cx) / (w * .5)) ** 2 + ((np.mgrid[0:h, 0:w][0] - cy) / (h * .62)) ** 2) <= 1

    P = _rng(code, 'pores')
    n = w * h // 90
    px, py = P.integers(0, w, n), P.integers(0, h, n)
    pa = P.random(n) * (.16 if light == 'PPOL' else .08) + .05
    pc = np.array([20, 10, 40.]) if uv else np.array([110, 60, 45.])
    img[py, px] = img[py, px] * (1 - pa[:, None]) + pc * pa[:, None]

    if not uv:
        E = _rng(code, 'ery')
        for _ in range(5):
            ex, ey, er = w * (vx - .25 + E.random() * .5) + jx, h * (.4 + E.random() * .35) + jy, w * (.05 + E.random() * .06)
            _blob(img, ex, ey, er, (200, 70, 70), (.22 if light == 'XPOL' else .1) * (.35 + .65 * remain))

    L = _rng(code, 'lesions')
    les = []
    for _ in range(base):
        les.append((w * (vx - .33 + L.random() * .66) + jx, h * (.28 + L.random() * .6) + jy,
                    (2.2 + L.random() * 3.6) * w / 320, L.random() < .25, L.random()))
    les.sort(key=lambda t: t[4])
    for x, y, r, pus, _ in les[:round(base * remain)]:
        if uv:
            _disk(img, x, y, max(1, r * .35), (255, 120, 60), .85)
            continue
        s = {'XPOL': 1, 'PPOL': .6}.get(light, .8)
        _blob(img, x, y, r * 1.2, (185, 50, 55), .55 * s)
        _disk(img, x, y, r, (165, 40, 45), .8 * s)
        if pus:
            _disk(img, x, y, r * .42, (245, 225, 170), .9)
        if light == 'PPOL':
            _disk(img, x - r * .3, y - r * .3, r * .25, (255, 255, 255), .55)
    if uv:
        U = _rng(code, 'uv', visit_idx)
        k = int(base * 1.5 * remain)
        ux = (w * (vx - .35 + U.random(k) * .7) + jx).astype(int).clip(0, w - 1)
        uy = (h * (.25 + U.random(k) * .62) + jy).astype(int).clip(0, h - 1)
        img[uy, ux] = img[uy, ux] * .4 + np.array([255, 140, 70.]) * .6
    if light == 'PPOL':
        yy, xx = np.mgrid[0:h, 0:w]
        t = ((xx - (w * lx)) * .8 + (yy - h / 2) * .4) / (w * .25)
        img = img + 255 * .14 * np.exp(-t ** 2)[..., None] * .5

    img = np.where(mask[..., None], img, 0)
    sw = max(4, w // 40)
    for i, c in enumerate(['#735244', '#c29682', '#627a9d', '#576c43', '#8580b1', '#67bdaa']):
        rgb = (34, 34, 34) if uv else tuple(int(c[j:j + 2], 16) for j in (1, 3, 5))
        img[h - sw - 6:h - 6, 6 + i * (sw + 1):6 + i * (sw + 1) + sw] = rgb
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def ai_for(traj, n):
    remain = TRAJ[traj][3]
    return round(max(.05, min(.97, 1.1 - remain * 1.05 + ((n % 7) - 3) * .015)), 2)


def build_synthetic(out):
    """Returns list of subject dicts with sessions/acquisitions/files on disk."""
    subjects = []
    for n, base, traj, clin, igab, igal, consent, _ in SYN:
        code = f'S{n:03d}'
        counts = [round(base * f) for f in TRAJ[traj]]
        sessions = []
        for vi, (vk, vlabel, day) in enumerate(VISITS):
            inv = {}
            if clin is not None or vi == 0:
                inv = {'lesion_count_total': counts[vi]}
                if vi == 0 and igab is not None:
                    inv['iga'] = igab
                if vi == 3 and igal is not None:
                    inv['iga'] = igal
            acqs = []
            for wk, wlabel in VIEWS:
                files = []
                for lk, llabel in LIGHTS:
                    name = f'{STUDY}_{code}_{vk}_D{day:03d}_{lk}_{wk}.jpg'
                    p = os.path.join(out, name)
                    if not os.path.exists(p):
                        render(code, base, TRAJ[traj][vi], vi, lk, wk).save(p, quality=88)
                    files.append({'path': p, 'name': name, 'info': {
                        'study': STUDY, 'subject': code, 'visit': vk, 'study_day': day, 'lighting': lk,
                        'lighting_label': llabel, 'view': wk, 'synthetic': True,
                        'parsed_by': 'manifest rule {study}_{subject}_{visit}_D{day}_{lighting}_{view}.{ext}'}})
                acqs.append({'label': wlabel, 'files': files})
            sessions.append({'label': f'{vk} {vlabel}', 'day': day,
                             'info': {'visit': vk, 'study_day': day, 'investigator': inv}, 'acquisitions': acqs})
        info = {
            'source': 'synthetic', 'synthetic': True,
            'response': {'clinical': ({'label': clin, 'source': 'Investigator IGA + lesion count (synthetic EDC import)',
                                       'iga_baseline': igab, 'iga_latest': igal} if clin else None), 'ai': None},
            'consent': {'marketing': {'status': consent, 'recorded_in':
                                      GRANTED if consent == 'granted' else
                                      ('eConsent v3.1, Section 9 declined [synthetic]' if consent == 'declined'
                                       else 'Paper ICF, not yet reconciled [synthetic]')}},
            'marketing': {'review': None},
            'demo': {'trajectory': traj, 'expected_ai_score_if_scored': ai_for(traj, n)},
        }
        subjects.append({'label': f'SYN-{code}', 'tags': ['synthetic', 'responder-demo'], 'info': info, 'sessions': sessions})
        log('rendered', code)
    return subjects


# ---------------------------------------------------------------- SCIN
def fetch(url, dest=None, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
            if dest:
                with open(dest, 'wb') as f:
                    f.write(data)
            return data
        except Exception as e:  # noqa
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def _col(cols, *needles, required=True):
    for c in cols:
        if all(n in c.lower() for n in needles):
            return c
    if required:
        raise SystemExit(f'SCIN schema changed: no column with {needles}. Columns: {cols}')
    return None


def _parse_weighted(s):
    if not s:
        return {}
    try:
        return ast.literal_eval(s) if s.strip().startswith('{') else json.loads(s)
    except Exception:
        return {}


def build_scin(out, n_cases, min_weight):
    cases = list(csv.DictReader(io.StringIO(fetch(SCIN_BASE + 'dataset/scin_cases.csv').decode())))
    labels = list(csv.DictReader(io.StringIO(fetch(SCIN_BASE + 'dataset/scin_labels.csv').decode())))
    log('SCIN rows', len(cases), 'cases', len(labels), 'labels')
    lc = list(labels[0].keys()); cc = list(cases[0].keys())
    k_case = _col(lc, 'case_id')
    k_w = _col(lc, 'weighted_skin_condition_label')
    k_fst = _col(lc, 'fitzpatrick_skin_type_label_1')
    k_mst = _col(lc, 'monk_skin_tone_label_us', required=False)
    k_grad = _col(lc, 'gradable_for_skin_condition_1', required=False)
    img_cols = [c for c in cc if c.startswith('image_') and c.endswith('_path')]
    if not img_cols:
        raise SystemExit(f'SCIN schema changed: no image_*_path columns. Columns: {cc}')
    by_case = {r[_col(cc, 'case_id')]: r for r in cases}

    cand = []
    for r in labels:
        wd = _parse_weighted(r.get(k_w, ''))
        ecz = sum(v for k, v in wd.items() if 'eczema' in k.lower() or 'atopic' in k.lower())
        if ecz < min_weight:
            continue
        if k_grad and not str(r.get(k_grad, '')).upper().startswith(('DEFAULT_YES', 'YES', 'TRUE')):
            continue
        c = by_case.get(r[k_case])
        if not c or not any(c.get(k) for k in img_cols):
            continue
        cand.append((ecz, r, c))
    log('eczema candidates', len(cand))
    # stratify by estimated Fitzpatrick type, highest eczema weight first within each
    buckets = {}
    for t in sorted(cand, key=lambda t: -t[0]):
        buckets.setdefault(t[1].get(k_fst) or 'unknown', []).append(t)
    picked = []
    while len(picked) < n_cases and any(buckets.values()):
        for k in sorted(buckets):
            if buckets[k] and len(picked) < n_cases:
                picked.append(buckets[k].pop(0))
    subjects = []
    meta_keep = [k for k in cc if any(s in k for s in ('age_group', 'sex_at_birth', 'body_parts', 'condition_symptoms',
                                                         'condition_duration', 'textures', 'fitzpatrick'))]

    def dl(job):
        url, dest = job
        if not os.path.exists(dest):
            fetch(url, dest)
        return dest

    jobs = []
    for ecz, r, c in picked:
        cid = r[k_case]
        files = []
        for i, k in enumerate(img_cols, 1):
            rel = c.get(k)
            if not rel:
                continue
            name = f'SCIN_{cid}_img{i}{os.path.splitext(rel)[1] or ".png"}'
            dest = os.path.join(out, name)
            jobs.append((SCIN_BASE + rel, dest))
            files.append({'path': dest, 'name': name, 'info': {'source': 'SCIN', 'scin_image_path': rel}})
        info = {
            'source': 'SCIN', 'synthetic': False,
            'scin': {'case_id': cid, 'eczema_weight': round(ecz, 3),
                     'weighted_skin_condition_label': _parse_weighted(r.get(k_w, '')),
                     'est_fitzpatrick': r.get(k_fst), 'est_monk': r.get(k_mst) if k_mst else None,
                     **{k: c.get(k) for k in meta_keep if c.get(k) not in (None, '')}},
            'licence': 'SCIN Data Use License; do not attempt re-identification',
            'citation': SCIN_CITATION,
        }
        subjects.append({'label': f'SCIN-{cid}', 'tags': ['scin', 'eczema', 'open-data'], 'info': info,
                         'sessions': [{'label': 'Contribution', 'day': None, 'info': {}, 'acquisitions': [
                             {'label': 'Photos', 'files': files}]}]})
    log('downloading', len(jobs), 'SCIN images')
    with ThreadPoolExecutor(12) as ex:
        list(ex.map(dl, jobs))
    return subjects


# ---------------------------------------------------------------- upload
README = """# Derm Response Demo (internal)

Internal Flywheel demo: the "art of the possible" for derm efficacy imaging (responder review + Derm Foundation scoring).
Built 2026-11-20. **No customer data. Do not share this project outside Flywheel.**
No model is trained on customer data until a customer contract is signed.

## Contents
| Prefix | Source | What | Licence |
|---|---|---|---|
| SYN-S### | Synthetic (procedural) | 12 subjects x 4 visits (Baseline, W4, W8, W12) x 3 views x 4 lighting modes = 576 images. Filenames follow the manifest rule {study}_{subject}_{visit}_D{day}_{lighting}_{view}.{ext}; file info holds the parsed fields. Subject info: response.clinical, consent.marketing, marketing.review (empty) | Flywheel-generated; not patient data |
| SCIN-<case> | Google SCIN dataset | Real crowdsourced eczema photos (1-3 per case), dermatologist condition labels, est. Fitzpatrick / Monk skin tone. Single timepoint. Stratified by Fitzpatrick type | SCIN Data Use License (attached). Re-identification prohibited. Attribution required |

## Not here (and why)
- SWET / EczemaNet images (Imperial College): consent prohibits public sharing; access by request to Dr Reiko Tanaka.
- Fitzpatrick17k: CC BY-NC-SA (non-commercial).

## Citation
""" + SCIN_CITATION + """

## Intended demos
1. Responder Review app on SYN-* (timeline grid, consent-gated decisions).
2. Derm Foundation embedding gear on SCIN-* + SYN-* (embedding sanity, skin-tone spread). Scores are exploratory, not validated.
"""


def upload(subjects, group_id, dry, attachments):
    import flywheel
    fw = flywheel.Client()
    log('Flywheel user', fw.get_current_user().id)
    group = fw.get_group(group_id)
    proj = group.projects.find_first(f'label={PROJECT_LABEL}')
    if proj is None:
        if dry:
            log('[dry] would create project', PROJECT_LABEL); return
        proj = group.add_project(label=PROJECT_LABEL, description=README)
        log('created project', proj.id)
    else:
        log('using project', proj.id)
    if not dry:
        existing_att = {f.name for f in fw.get_project(proj.id).files}
        for p in attachments:
            if os.path.basename(p) not in existing_att:
                proj.upload_file(p)
    totals = {'subjects': 0, 'files': 0, 'skipped': 0}
    for s in subjects:
        subj = proj.subjects.find_first(f'label={s["label"]}')
        if dry:
            totals['subjects'] += 1; totals['files'] += sum(len(a['files']) for se in s['sessions'] for a in se['acquisitions']); continue
        if subj is None:
            subj = proj.add_subject(label=s['label'], code=s['label'])
        subj.update_info(s['info'])
        for t in s['tags']:
            if t not in (subj.tags or []):
                subj.add_tag(t)
        totals['subjects'] += 1
        for se in s['sessions']:
            ses = subj.sessions.find_first(f'label={se["label"]}')
            if ses is None:
                kw = {'label': se['label']}
                ses = subj.add_session(**kw)
                if se['day'] is not None:
                    import datetime as dt
                    ses.update(timestamp=dt.datetime(2026, 4, 6, 9, tzinfo=dt.timezone.utc) + dt.timedelta(days=se['day']))
            if se['info']:
                ses.update_info(se['info'])
            for a in se['acquisitions']:
                acq = ses.acquisitions.find_first(f'label={a["label"]}')
                if acq is None:
                    acq = ses.add_acquisition(label=a['label'])
                have = {f.name for f in fw.get_acquisition(acq.id).files}
                for f in a['files']:
                    if f['name'] in have:
                        totals['skipped'] += 1; continue
                    acq.upload_file(f['path'])
                    acq.update_file_info(f['name'], f['info'])
                    totals['files'] += 1
        log('done', s['label'], totals)
    log('TOTAL', totals, 'project', proj.id)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--group', default='dantest')
    ap.add_argument('--scin-cases', type=int, default=60)
    ap.add_argument('--min-eczema-weight', type=float, default=0.5)
    ap.add_argument('--skip-scin', action='store_true')
    ap.add_argument('--skip-synthetic', action='store_true')
    ap.add_argument('--render-only', action='store_true', help='render synthetic images and exit (no network)')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    syn_dir, scin_dir = os.path.join(WORK, 'synthetic'), os.path.join(WORK, 'scin')
    os.makedirs(syn_dir, exist_ok=True); os.makedirs(scin_dir, exist_ok=True)
    subjects = []
    if not a.skip_synthetic:
        subjects += build_synthetic(syn_dir)
    if a.render_only:
        log('rendered to', syn_dir); return
    attachments = []
    readme = os.path.join(WORK, 'README.md')
    open(readme, 'w').write(README)
    attachments.append(readme)
    if not a.skip_scin:
        subjects += build_scin(scin_dir, a.scin_cases, a.min_eczema_weight)
        lic = os.path.join(WORK, 'SCIN_LICENSE.txt')
        fetch(SCIN_LICENSE_URL, lic)
        attachments.append(lic)
    upload(subjects, a.group, a.dry_run, attachments)


if __name__ == '__main__':
    main()
