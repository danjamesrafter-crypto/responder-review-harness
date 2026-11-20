import { PROJECT, VISITS, LIGHTING, VIEWS, MODEL, buildSubjects, parseName, NAME_RULE, SEED_AUDIT, aiFor, aiCounts } from './data.js';
import { useImg, dataUrlFor } from './images.js';
import * as Live from './live.js';
import { buildReport, eligible, imagesFor, parseFileId } from './pdf.js';

const V = window.FlywheelVisionDesignSystem_6c883d;
const {
  Button, IconButton, Icon, Tag, Typography, Tooltip, AlertPanel, Dialog, TextArea, Select, SelectItem,
  ButtonToggle, ButtonGroup, Switch, Checkbox, ProgressBar, Tabs, Tab, TabPanel, Snackbar, SnackbarContainer,
} = V;
const { useState, useMemo, useEffect, useRef, useCallback } = React;

const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { version: 'dev', built: 'dev', react: '?', commit: 'nogit' };
let ME = 'd.rafter@flywheel.example';
let ENV = { live: false };
const TRAJ = { strong: [1, 0.62, 0.36, 0.2], good: [1, 0.72, 0.48, 0.32], partial: [1, 0.86, 0.72, 0.64], none: [1, 0.97, 1.02, 0.95] };

const fmtTs = (s) => s.replace('T', ' ').replace(/\.\d+Z$|Z$/, ' UTC');
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

function isCandidate(s) {
  const r = s.info.response;
  return r.clinical?.label === 'good' || (r.ai && r.ai.score >= 0.7 && !r.clinical);
}
function needsAI(s) { return !s.info.response.clinical && !s.info.response.ai; }
function consentOf(s) { return s.info.consent.marketing.status; }
function decisionOf(s) { return s.info.marketing.review?.decision || null; }

const RESP_TAG = {
  good: { color: 'green', title: 'Clinical: Good' },
  partial: { color: 'orange', title: 'Clinical: Partial' },
  none: { color: 'red', title: 'Clinical: None' },
};
const CONSENT_TAG = {
  granted: { color: 'green', title: 'Marketing Consent', icon: 'shield-protect' },
  declined: { color: 'red', title: 'Consent Declined', icon: 'lock' },
  unknown: { color: 'orange', title: 'Consent Unverified', icon: 'warning' },
};
const DEC_TAG = {
  approve: { color: 'green', title: 'Approved' },
  hold: { color: 'orange', title: 'On Hold' },
  reject: { color: 'red', title: 'Rejected' },
};
const REASONS = {
  approve: ['Clear visible improvement', 'Representative of label claim', 'Consistent across lighting modes'],
  hold: ['Pending consent reconciliation', 'Pending medical review', 'Pending image re-capture'],
  reject: ['Insufficient visible change', 'Image quality / lighting inconsistent', 'Pose or crop not comparable', 'Confounder (makeup, lesion off-frame)'],
};

function Section({ title, children, right }) {
  return (
    <div className="sec">
      <div className="sec-h"><Typography variant="h5" color="muted">{title}</Typography>{right}</div>
      {children}
    </div>
  );
}

function KV({ k, v, mono }) {
  return <div className="kv"><span className="k">{k}</span><span className={mono ? 'v mono' : 'v'}>{v}</span></div>;
}

/* ---------------- Queue ---------------- */
function Queue({ subjects, selectedId, onSelect, filter, setFilter, consentOnly, setConsentOnly }) {
  const counts = {
    candidates: subjects.filter(isCandidate).length,
    needs_ai: subjects.filter(needsAI).length,
    all: subjects.length,
  };
  let list = subjects.filter((s) => (filter === 'candidates' ? isCandidate(s) : filter === 'needs_ai' ? needsAI(s) : true));
  if (consentOnly) list = list.filter((s) => consentOf(s) === 'granted');
  return (
    <aside className="queue">
      <div className="pane-h">
        <Typography variant="h4">Responder Queue</Typography>
        <Tag size="small" color="slate" title={`${list.length} shown`} />
      </div>
      <div className="queue-filters">
        <ButtonToggle value={filter} onChange={setFilter} size="small" fullWidth aria-label="Queue filter">
          <Button value="candidates">Candidates {counts.candidates}</Button>
          <Button value="needs_ai">No Label {counts.needs_ai}</Button>
          <Button value="all">All {counts.all}</Button>
        </ButtonToggle>
        <Switch name="consentOnly" size="small" checked={consentOnly} onChange={setConsentOnly} title="Marketing consent only" />
      </div>
      <div className="queue-list" role="listbox" aria-label="Subjects">
        {list.map((s) => {
          const r = s.info.response;
          const d = decisionOf(s);
          return (
            <div key={s._id} role="option" aria-selected={s._id === selectedId} tabIndex={0}
              className={'q-item' + (s._id === selectedId ? ' sel' : '')}
              onClick={() => onSelect(s._id)} onKeyDown={(e) => e.key === 'Enter' && onSelect(s._id)}>
              <div className="q-top">
                <Typography variant="h4">{s.code}</Typography>
                {d ? <Tag size="small" {...DEC_TAG[d]} /> : <Tag size="small" color="slate" title="Pending" />}
              </div>
              <div className="q-tags">
                {r.clinical ? <Tag size="small" {...RESP_TAG[r.clinical.label]} />
                  : r.ai ? <Tag size="small" color="secondary" icon="star-ai-artificial-intelligence" title={`AI ${r.ai.score.toFixed(2)}`} />
                  : <Tag size="small" color="slate" title="No Label" />}
                <Tag size="small" {...CONSENT_TAG[consentOf(s)]} />
              </div>
            </div>
          );
        })}
        {list.length === 0 && <div className="empty"><Typography variant="p3">No subjects match these filters.</Typography></div>}
      </div>
      <div className="queue-foot"><Typography variant="p4" color="light">Candidate = clinical label "good", or AI score ≥ 0.70 where no clinical label exists.</Typography></div>
    </aside>
  );
}

/* ---------------- Tile ---------------- */
function Img({ s, visit, light, view, w, h, align, className, style, alt }) {
  const { url, err, missing } = useImg(s, visit, light, view, w, h, align);
  if (url) return <img className={className} src={url} alt={alt || ''} draggable={false} style={style} />;
  return <div className={'img-ph ' + (className || '')}>{missing ? 'No Image' : err ? 'Load Failed' : <V.ProgressSpinner size="small" />}</div>;
}

function Tile({ s, visitIdx, light, view, align, w, h, selected, onToggleSel, focused, onFocus, onOpen, showAI }) {
  const v = VISITS[visitIdx];
  const ai = s.info.response.ai;
  return (
    <div className={'tile' + (focused ? ' focused' : '') + (selected ? ' picked' : '')} onClick={onFocus} onDoubleClick={onOpen}
      title="Click to inspect · Double-click to compare with baseline">
      <Img s={s} visit={v.key} light={light} view={view} w={w} h={h} align={align} alt={`${s.code} ${v.label} ${light} ${view}`} />
      <span className="ov tl">{v.label} · {LIGHTING.find((l) => l.key === light).short}</span>
      {showAI && ai?.per_visit_est_lesions && <span className="ov bl">AI est. {ai.per_visit_est_lesions[visitIdx]} lesions</span>}
      <div className="pick" onClick={(e) => e.stopPropagation()}>
        <Checkbox size="compact" checked={selected} onChange={onToggleSel} aria-label="Select for marketing package" />
      </div>
    </div>
  );
}

/* ---------------- Compare ---------------- */
function Compare({ s, view, align, light, setLight, visit, setVisit, picks, togglePick }) {
  const [z, setZ] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const vi = VISITS.findIndex((v) => v.key === visit);
  const inv = s.sessions.map((x) => x.info.investigator?.lesion_count_total ?? null);
  const ai = s.info.response.ai;
  const fileId = (vk) => `f-${s.code}-${vk}-${light}-${view}`;
  const onWheel = (e) => { e.preventDefault(); setZ((q) => Math.min(4, Math.max(1, +(q * (e.deltaY < 0 ? 1.12 : 0.89)).toFixed(3)))); };
  const pane = (idx) => {
    const fid = fileId(VISITS[idx].key);
    return (
      <div className="cmp-pane">
        <div className="cmp-cap">
          <Typography variant="h5">{VISITS[idx].label} · Day {VISITS[idx].day}</Typography>
          <Checkbox size="compact" checked={picks.has(fid)} onChange={() => togglePick(fid)} title="Include" />
        </div>
        <div className="cmp-view" onWheel={onWheel}
          onMouseDown={(e) => (drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y })}
          onMouseMove={(e) => drag.current && setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })}
          onMouseUp={() => (drag.current = null)} onMouseLeave={() => (drag.current = null)}>
          <Img s={s} visit={VISITS[idx].key} light={light} view={view} w={720} h={540} align={align} style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${z})` }} />
          <span className="ov tl">{s.code} · {LIGHTING.find((l) => l.key === light).label} · {VIEWS.find((x) => x.key === view).label}</span>
        </div>
        <div className="cmp-stats">
          <KV k="Investigator lesions" v={inv[idx] ?? '—'} />
          {ai?.per_visit_est_lesions && <KV k="AI est. lesions" v={ai.per_visit_est_lesions[idx]} />}
        </div>
      </div>
    );
  };
  const delta = inv[0] != null && inv[vi] != null ? Math.round((1 - inv[vi] / inv[0]) * 100) : null;
  const aiDelta = ai?.per_visit_est_lesions ? Math.round((1 - ai.per_visit_est_lesions[vi] / ai.per_visit_est_lesions[0]) * 100) : null;
  return (
    <div className="compare">
      <div className="cmp-bar">
        <ButtonToggle value={light} onChange={setLight} size="small" aria-label="Lighting">
          {LIGHTING.map((l) => <Button key={l.key} value={l.key}>{l.short}</Button>)}
        </ButtonToggle>
        <Typography variant="p4" color="muted">Baseline vs</Typography>
        <Select value={visit} onChange={setVisit} size="compact" width={140} aria-label="Follow-up visit">
          {VISITS.slice(1).map((v) => <SelectItem key={v.key} value={v.key} title={v.label} />)}
        </Select>
        <div className="sp" />
        <Tooltip title="Zoom Out"><IconButton icon="search-zoom-minus" size="small" color="slate" aria-label="Zoom out" onClick={() => setZ((q) => Math.max(1, q / 1.25))} /></Tooltip>
        <Typography variant="p4" color="muted" className="mono">{Math.round(z * 100)}%</Typography>
        <Tooltip title="Zoom In"><IconButton icon="search-zoom-plus" size="small" color="slate" aria-label="Zoom in" onClick={() => setZ((q) => Math.min(4, q * 1.25))} /></Tooltip>
        <Tooltip title="Reset View"><IconButton icon="arrow-rotate-restore" size="small" color="slate" aria-label="Reset view" onClick={() => { setZ(1); setPan({ x: 0, y: 0 }); }} /></Tooltip>
      </div>
      <div className="cmp-grid">{pane(0)}{pane(vi)}</div>
      <div className="cmp-delta">
        <Typography variant="p3">
          Investigator lesion reduction: <b>{delta == null ? 'not recorded' : `${delta}%`}</b>
          {aiDelta != null && <> · AI-estimated reduction: <b>{aiDelta}%</b> <span className="muted">(exploratory)</span></>}
          {' '}· Zoom and pan are synced across both panes.
        </Typography>
      </div>
    </div>
  );
}

/* ---------------- Evidence + decision ---------------- */
function GearRunner({ s, job, onRun }) {
  if (job && job.subjectId === s._id) {
    return (
      <div className="card">
        <Typography variant="h5">{MODEL.gear} · running</Typography>
        <ProgressBar value={job.progress} showValue />
        <Typography variant="p4" color="muted">{job.stage}</Typography>
      </div>
    );
  }
  return (
    <div className="card">
      <Typography variant="p3">No response label in metadata for this subject.</Typography>
      <Button size="small" variant="outlined" color="secondary" startIcon="star-ai-artificial-intelligence" onClick={() => onRun(s)}>Run Derm Foundation Gear...</Button>
      <Typography variant="p4" color="light">Embeds 48 images (4 visits × 4 lighting × 3 views) and writes info.response.ai. Simulated in this prototype.</Typography>
    </div>
  );
}

function DecisionPanel({ s, picks, job, onRunGear, onRecord, onRevise }) {
  const r = s.info.response;
  const consent = consentOf(s);
  const existing = s.info.marketing.review;
  const aiOnly = !r.clinical && !!r.ai;
  const [decision, setDecision] = useState('approve');
  const [reason, setReason] = useState(REASONS.approve[0]);
  const [note, setNote] = useState('');
  const [attest, setAttest] = useState(false);
  useEffect(() => { setDecision('approve'); setReason(REASONS.approve[0]); setNote(''); setAttest(false); }, [s._id]);
  useEffect(() => setReason(REASONS[decision][0]), [decision]);

  const blockers = [];
  if (decision === 'approve') {
    if (consent !== 'granted') blockers.push(consent === 'declined' ? 'Subject declined marketing use.' : 'Marketing consent not verified.');
    if (picks.size === 0) blockers.push('Select at least one image for the package.');
    if (!r.clinical && !r.ai) blockers.push('No response evidence. Run the gear or import a clinical label.');
    if (aiOnly && !attest) blockers.push('AI-only evidence needs medical reviewer confirmation.');
    if (r.clinical && r.clinical.label !== 'good') blockers.push(`Clinical label is "${r.clinical.label}".`);
  }
  const canSubmit = blockers.length === 0;

  return (
    <div className="decision">
      <Section title="Response Evidence">
        {r.clinical ? (
          <div className="card">
            <div className="row"><Tag {...RESP_TAG[r.clinical.label]} /><Typography variant="p4" color="muted">source of record</Typography></div>
            <KV k="IGA" v={`${r.clinical.iga_baseline} → ${r.clinical.iga_latest}`} />
            <KV k="Lesions (total)" v={`${s.sessions[0].info.investigator.lesion_count_total} → ${s.sessions[3].info.investigator.lesion_count_total}`} />
            <KV k="Source" v={r.clinical.source} />
          </div>
        ) : r.ai ? null : <GearRunner s={s} job={job} onRun={onRunGear} />}
        {r.ai && (
          <div className="card ai">
            <div className="row"><Tag color="secondary" icon="star-ai-artificial-intelligence" title={`AI score ${r.ai.score.toFixed(2)}`} />
              <Typography variant="p4" color="muted">{r.ai.label === 'likely_responder' ? 'Likely responder' : 'Unlikely responder'}</Typography></div>
            {r.ai.per_visit_est_lesions && <KV k="Est. lesions" v={`${r.ai.per_visit_est_lesions[0]} → ${r.ai.per_visit_est_lesions[3]}`} />}
            <KV k="Gear" v={`${r.ai.gear} ${r.ai.gear_version}`} />
            <KV k="Analysis" v={r.ai.analysis_id} mono />
            <AlertPanel severity="warning" title="Exploratory. Not a grade." description="Untrained demo head. Never overwrites the clinical label; stored in info.response.ai." />
          </div>
        )}
      </Section>

      <Section title="Marketing Consent">
        <div className="card">
          <div className="row"><Tag {...CONSENT_TAG[consent]} /></div>
          <KV k="Recorded in" v={s.info.consent.marketing.recorded_in} />
          {consent !== 'granted' && <AlertPanel severity={consent === 'declined' ? 'error' : 'warning'}
            title={consent === 'declined' ? 'Approve disabled' : 'Approve disabled until reconciled'}
            description={consent === 'declined' ? 'Marketing use was declined. Images stay available for scientific use.' : 'No machine-readable marketing consent on record for this subject.'} />}
        </div>
      </Section>

      <Section title="Marketing Decision">
        {existing ? (
          <div className="card">
            <div className="row"><Tag {...DEC_TAG[existing.decision]} /><Typography variant="p4" color="muted" className="mono">{existing.decision_id}</Typography></div>
            <KV k="Reason" v={existing.reason} />
            <KV k="Images" v={existing.images.length} />
            <KV k="Reviewer" v={existing.reviewer} />
            <KV k="Recorded" v={fmtTs(existing.timestamp)} />
            {existing.note && <KV k="Note" v={existing.note} />}
            <Button size="small" variant="outlined" color="slate" onClick={() => onRevise(s)}>Revise Decision...</Button>
          </div>
        ) : (
          <div className="card">
            <ButtonToggle value={decision} onChange={setDecision} fullWidth size="small" aria-label="Decision">
              <Button value="approve" color="green" startIcon="thumbs-up-like">Approve</Button>
              <Button value="hold" color="orange" startIcon="clock-hour-4">Hold</Button>
              <Button value="reject" color="red" startIcon="thumbs-down-dislike">Reject</Button>
            </ButtonToggle>
            <label className="lbl">Reason</label>
            <Select value={reason} onChange={setReason} fullWidth size="compact" aria-label="Reason">
              {REASONS[decision].map((x) => <SelectItem key={x} value={x} title={x} />)}
            </Select>
            <KV k="Images selected" v={picks.size} />
            {aiOnly && decision === 'approve' && (
              <Checkbox size="compact" checked={attest} onChange={setAttest} title="Medical reviewer confirms visible response" />
            )}
            <label className="lbl">Note</label>
            <TextArea rows={2} fullWidth value={note} onChange={setNote} placeholder="Optional" />
            {!canSubmit && <ul className="blockers">{blockers.map((b) => <li key={b}><Icon name="warning-circle" color="orange" size="small" decorative /> {b}</li>)}</ul>}
            <Button fullWidth disabled={!canSubmit} color={decision === 'approve' ? 'green' : decision === 'hold' ? 'orange' : 'red'}
              onClick={() => onRecord(s, { decision, reason, note, attest })}>Record Decision...</Button>
          </div>
        )}
      </Section>
    </div>
  );
}

function AuditPanel({ audit, s }) {
  const [scope, setScope] = useState('subject');
  const list = scope === 'subject' ? audit.filter((a) => a.target.includes(s.code)) : audit;
  return (
    <div className="audit">
      <ButtonToggle value={scope} onChange={setScope} size="small" fullWidth aria-label="Audit scope">
        <Button value="subject">{s.code}</Button>
        <Button value="all">All Activity</Button>
      </ButtonToggle>
      {list.length === 0 && <Typography variant="p4" color="light">No entries for {s.code} yet.</Typography>}
      {[...list].reverse().map((a, i) => (
        <div className="audit-row" key={i}>
          <div className="row"><Typography variant="h5">{a.action}</Typography><Typography variant="p5" color="light" className="mono">{fmtTs(a.ts)}</Typography></div>
          <Typography variant="p4" color="muted">{a.user} · {a.target}</Typography>
          <Typography variant="p4">{a.detail}</Typography>
          <Typography variant="p5" color="light" className="mono">{a.api}</Typography>
        </div>
      ))}
      <Typography variant="p4" color="light">Prototype log. In product, entries come from the platform audit trail (server time, attributable user).</Typography>
    </div>
  );
}

/* ---------------- Info / About ---------------- */
function InfoPanel({ s, env, onClose }) {
  const a = (href, text) => <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>;
  const calls = env.live ? Live.calls : [];
  const failed = calls.filter((c) => !c.ok);
  return (
    <div className="info">
      <div className="pane-h"><Typography variant="h4">Info</Typography>
        <IconButton icon="close" size="small" color="slate" aria-label="Close info" onClick={onClose} /></div>
      <div className="info-body">
        <Section title="Context">
          <KV k="Project" v={env.live ? env.project.label : PROJECT.label} />
          {env.live && <KV k="Project ID" v={env.project._id} mono />}
          <KV k="Subject" v={env.live ? `${s.label} (${s.code})` : s.code} />
          <KV k="Images" v={env.live ? `${Object.keys(s._live.files).length} matched by filename rule` : '48 per subject (4 visits × 4 lighting × 3 views)'} />
          {env.live && <KV k="Subjects loaded" v={`${env.loaded} of ${env.total} (filter ${env.filter})`} />}
          <KV k="User" v={ME} />
        </Section>
        <Section title="Application">
          <KV k="App" v={`responder-review/${BUILD.version} (${BUILD.commit})`} />
          <KV k="Build" v={`${BUILD.mode} · ${BUILD.built}`} mono />
          <KV k="Mode" v={env.live ? `Live · ${env.site} · Extension SDK 0.14.9 (ReadWrite)` : 'Demo · synthetic data · no Flywheel calls'} />
          <KV k="Tier" v="Prototype harness. Not for marketing or clinical use." />
          <KV k="Source" v={BUILD.repo ? BUILD.repo : 'Not yet in git'} />
        </Section>
        <Section title="Algorithms (this item)">
          {s.info.response.ai ? (<>
            <KV k="Gear" v={`${s.info.response.ai.gear} ${s.info.response.ai.gear_version}`} />
            <KV k="Analysis" v={s.info.response.ai.analysis_id} mono />
            <KV k="Outputs used" v="info.response.ai.score, per_visit_est_lesions" />
          </>) : <Typography variant="p4" color="muted">No gear run for {s.code}. AI score and AI lesion estimates are unavailable.</Typography>}
          <KV k="Base model" v="Google Derm Foundation, BiT-M ResNet101x3; 448×448 PNG in, 6144-d embedding out" />
          <div className="links">
            {a('https://huggingface.co/google/derm-foundation', 'Hugging Face: google/derm-foundation')}
            {a('https://developers.google.com/health-ai-developer-foundations/derm-foundation/model-card', 'Model card')}
          </div>
          <KV k="Licence" v="Health AI Developer Foundations terms of use (verify for marketing-selection use)" />
          <KV k="Head" v="Response head NOT TRAINED. Scores here are simulated." />
          <KV k="Training data" v="None yet. Proposed: the sponsor's graded archive (IGA, lesion counts)" />
          <AlertPanel severity="warning" title="Not validated" description="No performance numbers exist. Exploratory and supportive only; never a primary endpoint." />
        </Section>
        <Section title="Method">
          <ul className="method">
            <li>Candidate: clinical label "good", or AI score ≥ 0.70 when no clinical label exists (threshold assumed).</li>
            <li>Lesion reduction = 1 − follow-up ÷ baseline total count, investigator values from the EDC import.</li>
            <li>AI estimate: proposed per-visit regression head on Derm Foundation embeddings; delta computed the same way.</li>
            <li>Auto-Align simulates registration of pose and crop across visits (not implemented in product).</li>
            <li>Approve requires: consent granted, ≥1 image, clinical "good" or attested AI evidence.</li>
            <li>PDF export: approved + consent granted only; "great responder" = investigator lesion reduction ≥ threshold (AI estimate only where no counts exist, labelled).</li>
          </ul>
        </Section>
        {env.live && (
          <Section title={`Diagnostics · ${calls.length} calls${failed.length ? ` · ${failed.length} failed` : ''}`}>
            <div className="diag">
              {calls.slice(-40).reverse().map((c, i) => (
                <div key={i} className={'diag-row' + (c.ok ? '' : ' bad')}>
                  <span className="mono">{c.t}</span><span>{c.op}</span><span className="muted">{c.target}</span><span className="mono">{c.ms} ms</span>
                  {!c.ok && <span className="diag-err">{c.note}</span>}
                </div>
              ))}
            </div>
          </Section>
        )}
        <Section title="Libraries">
          <KV k="React / ReactDOM" v={`${BUILD.react} · MIT`} />
          <div className="links">{a('https://react.dev', 'react.dev')}</div>
          <KV k="Flywheel Extension SDK" v="0.14.9 (cdn.flywheel.io) · MIT (verify)" />
          <KV k="Flywheel Vision Design System" v="vision-react bundle (bundle.js sha256 bfa41eba…)" />
          <div className="links">{a('https://claude.ai/artifact/VWFDvStzgRxSSJzChTnXt9', 'Vision Design System artifact')}</div>
          <KV k="jsPDF" v={`${BUILD.jspdf} · MIT`} />
          <div className="links">{a('https://github.com/parallax/jsPDF', 'github.com/parallax/jsPDF')}</div>
          <KV k="Canvas 2D" v="Browser built-in, renders synthetic tiles" />
          <KV k="Build tool" v={`esbuild ${BUILD.esbuild}`} />
        </Section>
        <Section title="Data">
          <KV k="Dataset" v={env.live ? `Flywheel project ${env.project.label}. SYN-* subjects are synthetic (procedural images, no patient data).` : 'Synthetic. Procedurally drawn cheek close-ups; no patient images.'} />
          <KV k="Filenames" v={NAME_RULE} mono />
        </Section>
      </div>
    </div>
  );
}


/* ---------------- PDF report ---------------- */
async function saveBlob(blob, filename) {
  let downloadsNs = null;
  try { downloadsNs = window.claude?.use ? await window.claude.use('downloads') : null; } catch (e) { downloadsNs = null; }
  if (downloadsNs) {
    await downloadsNs.save({ filename, data: blob });
    return 'saved';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}

function PdfDialog({ subjects, env, onClose, onDone, onError }) {
  const [greatOnly, setGreatOnly] = useState(true);
  const [minPct, setMinPct] = useState('70');
  const [imageSource, setImageSource] = useState('selected');
  const [light, setLight] = useState('XPOL');
  const [view, setView] = useState('F');
  const [cover, setCover] = useState(true);
  const [metrics, setMetrics] = useState(true);
  const [showAI, setShowAI] = useState(false);
  const [wm, setWm] = useState(true);
  const [ensureBaseline, setEnsureBaseline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const opts = { greatOnly, minPct: +minPct, imageSource, light, view, cover, metrics, showAI, ensureBaseline, watermark: wm, watermarkText: 'CONFIDENTIAL · INTERNAL REVIEW' };
  const rows = eligible(subjects, opts);
  const approvedNoConsent = subjects.filter((x) => x.info.marketing.review?.decision === 'approve' && x.info.consent.marketing.status !== 'granted').length;
  const below = subjects.filter((x) => x.info.marketing.review?.decision === 'approve' && x.info.consent.marketing.status === 'granted').length - rows.length;
  const imgCount = rows.reduce((a, r) => a + Math.min(6, imagesFor(r.s, opts).length), 0);
  const go = async () => {
    setBusy(true);
    try {
      const stamp = nowIso();
      const docId = `RPT-${stamp.slice(0, 10).replace(/-/g, '')}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
      let done = 0;
      setProgress(`Fetching images 0 of ${imgCount}`);
      const projectLabel = env.live ? env.project.label : PROJECT.label;
      const { blob, pages } = await buildReport(subjects, { ...opts, generatedAt: fmtTs(stamp), user: ME, docId, live: env.live, projectLabel,
        dataNote: env.live ? `Flywheel ${env.site} · project ${env.project.label}` : 'SYNTHETIC DEMO IMAGES, NOT PATIENT DATA',
        sourceNote: env.live ? `Flywheel ${env.site}, project ${env.project.label}` : '',
        onProgress: () => setProgress(`Fetching images ${++done} of ${imgCount}`) });
      const safe = projectLabel.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+$/, '');
      const filename = `${safe}_responder-images_${docId}.pdf`;
      let where = 'Downloaded';
      if (env.live) {
        setProgress('Saving to project attachments');
        await env.api.uploadReport(blob, filename);
        await env.api.recordExport({ doc_id: docId, filename, pages, subjects: rows.map((r) => r.s.label), images: imgCount,
          criteria: greatOnly ? `lesion reduction >= ${minPct}%` : 'all approved', user: ME, timestamp: stamp, app: `responder-review/${BUILD.version}` });
        where = 'Saved to project attachments';
        try { await saveBlob(blob, filename); where += ' and downloaded'; } catch (e) { /* frame may block downloads */ }
      } else {
        await saveBlob(blob, filename);
      }
      onDone({ docId, pages, n: rows.length, images: imgCount, filename, where, criteria: greatOnly ? `reduction >= ${minPct}%` : 'all approved' });
    } catch (e) {
      if (e?.code === 'declined') onError('Download declined', 'Nothing was saved.');
      else onError('PDF export failed', e?.message || String(e));
    } finally { setBusy(false); }
  };
  return (
    <Dialog open title="Export Responder Images (PDF)" width="medium" onClose={onClose}
      actions={<><Button variant="outlined" color="slate" onClick={onClose}>Cancel</Button>
        <Button startIcon="document-file-download" disabled={!rows.length || busy} onClick={go}>{busy ? (progress || 'Building PDF...') : `${env.live ? 'Save PDF' : 'Download PDF'} (${rows.length})`}</Button></>}>
      <div className="pdf-dlg">
        <div className="pdf-opts">
          <Section title="Who">
            <Typography variant="p4" color="muted">Only subjects with an Approve decision and granted marketing consent can be exported.</Typography>
            <Switch name="great" size="small" checked={greatOnly} onChange={setGreatOnly} title="Great responders only" />
            {greatOnly && (<>
              <label className="lbl">Minimum lesion reduction, baseline to Week 12</label>
              <ButtonToggle value={minPct} onChange={setMinPct} size="small" aria-label="Minimum reduction">
                {['50', '60', '70', '80'].map((v) => <Button key={v} value={v}>{v}%</Button>)}
              </ButtonToggle>
            </>)}
          </Section>
          <Section title="Which Images">
            <ButtonToggle value={imageSource} onChange={setImageSource} size="small" fullWidth aria-label="Image source">
              <Button value="selected">Reviewer's Selection</Button>
              <Button value="pair">Baseline + Week 12</Button>
            </ButtonToggle>
            {imageSource === 'pair' ? (<>
              <ButtonToggle value={light} onChange={setLight} size="small" aria-label="Lighting">
                {LIGHTING.map((l) => <Button key={l.key} value={l.key}>{l.short}</Button>)}
              </ButtonToggle>
              <ButtonToggle value={view} onChange={setView} size="small" aria-label="View">
                {VIEWS.map((v) => <Button key={v.key} value={v.key}>{v.label}</Button>)}
              </ButtonToggle>
            </>) : (<>
              <Typography variant="p4" color="light">Images picked at decision time, up to 6 per subject. Subjects with none fall back to the baseline + Week 12 pair.</Typography>
              <Checkbox size="compact" checked={ensureBaseline} onChange={setEnsureBaseline} title="Add the matching baseline when it wasn't picked" />
            </>)}
          </Section>
          <Section title="Layout">
            <Checkbox size="compact" checked={cover} onChange={setCover} title="Cover page with criteria and summary table" />
            <Checkbox size="compact" checked={metrics} onChange={setMetrics} title="Show IGA and lesion counts" />
            <Checkbox size="compact" checked={showAI} onChange={setShowAI} title="Show AI score (labelled exploratory)" />
            <Checkbox size="compact" checked={wm} onChange={setWm} title="Watermark: Confidential, internal review" />
          </Section>
        </div>
        <div className="pdf-prev">
          <Section title={`In This Report · ${rows.length} subjects · ${imgCount} images · ${rows.length + (cover ? 1 : 0)} pages`}>
            {rows.map(({ s, red }) => (
              <div key={s._id} className="pdf-row">
                <Typography variant="h5">{s.code}</Typography>
                <Tag size="small" color="green" title={red ? `${red.pct}% reduction${red.source === 'ai' ? ' (AI est.)' : ''}` : 'No counts'} />
                <Typography variant="p4" color="muted" className="mono">{s.info.marketing.review.decision_id}</Typography>
                <div className="sp" />
                <div className="pdf-thumbs">
                  {imagesFor(s, opts).slice(0, 6).map((im, i) => <Img key={i} s={s} visit={im.visit} light={im.light} view={im.view} w={160} h={120} />)}
                </div>
              </div>
            ))}
            {!rows.length && <Typography variant="p4" color="light">No approved, consented subjects meet these criteria. Approve subjects in Review first, or lower the threshold.</Typography>}
            {(approvedNoConsent > 0 || below > 0) && (
              <Typography variant="p4" color="light">Excluded: {below > 0 ? `${below} approved below the threshold` : ''}{below > 0 && approvedNoConsent > 0 ? ', ' : ''}{approvedNoConsent > 0 ? `${approvedNoConsent} approved without granted consent` : ''}.</Typography>
            )}
          </Section>
          <AlertPanel severity="info" title="Generated in the browser" description={env.live ? 'The PDF is built in this browser from the Flywheel images, saved to the project\'s attachments, and logged in project info (responder_review.exports). In product a gear would render it server-side.' : 'Prototype only. In product, the PDF would be rendered server-side by a gear, stored with the decision record, and its export logged in the audit trail.'} />
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------- App ---------------- */
function App({ env, initialSubjects, initialAudit }) {
  const ME = env.user;
  const [subjects, setSubjects] = useState(initialSubjects);
  const [selectedId, setSelectedId] = useState(() => (initialSubjects.find(isCandidate) || initialSubjects[0])._id);
  const [filter, setFilter] = useState('candidates');
  const [consentOnly, setConsentOnly] = useState(false);
  const [view, setView] = useState('F');
  const [lights, setLights] = useState(['STD', 'XPOL', 'UV']);
  const [mode, setMode] = useState('grid');
  const [cmpLight, setCmpLight] = useState('XPOL');
  const [cmpVisit, setCmpVisit] = useState('V5');
  const [align, setAlign] = useState(true);
  const [focus, setFocus] = useState(null);
  const [picks, setPicks] = useState({}); // subjectId -> Set(fileId)
  const [rightTab, setRightTab] = useState('decision');
  const [info, setInfo] = useState(false);
  const [audit, setAudit] = useState(initialAudit);
  const [toasts, setToasts] = useState([]);
  const [job, setJob] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);

  const s = subjects.find((x) => x._id === selectedId) || subjects[0];
  const myPicks = picks[s._id] || new Set();
  const toast = (title, description, severity = 'success') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, title, description, severity }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  };
  const log = (e) => setAudit((a) => [...a, { ts: nowIso(), user: ME, ...e }]);

  const togglePick = (fid) => setPicks((p) => {
    const cur = new Set(p[s._id] || []);
    cur.has(fid) ? cur.delete(fid) : cur.add(fid);
    return { ...p, [s._id]: cur };
  });

  useEffect(() => { setFocus(null); }, [selectedId]);

  // J/K navigation through visible queue
  useEffect(() => {
    const h = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (e.key !== 'j' && e.key !== 'k') return;
      let list = subjects.filter((x) => (filter === 'candidates' ? isCandidate(x) : filter === 'needs_ai' ? needsAI(x) : true));
      if (consentOnly) list = list.filter((x) => consentOf(x) === 'granted');
      const i = list.findIndex((x) => x._id === selectedId);
      const n = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'j' ? 1 : -1)))];
      if (n) setSelectedId(n._id);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [subjects, filter, consentOnly, selectedId]);

  const runGear = (subj) => {
    const stages = ['Queued on gear engine', 'Decoding 48 NEF → 448×448 PNG', 'Derm Foundation embeddings (6144-d)', 'Scoring response head v0.1', 'Writing info.response.ai'];
    let p = 0;
    setJob({ subjectId: subj._id, progress: 0, stage: stages[0] });
    const t = setInterval(() => {
      p += 10;
      setJob({ subjectId: subj._id, progress: Math.min(100, p), stage: stages[Math.min(stages.length - 1, Math.floor(p / 21))] });
      if (p >= 100) {
        clearInterval(t);
        const score = subj._raw ? aiFor(subj._raw) : (subj._demo?.expected_ai_score_if_scored ?? 0.5);
        const ai = { score, label: score >= 0.7 ? 'likely_responder' : 'unlikely_responder', gear: MODEL.gear, gear_version: MODEL.gear_version,
          analysis_id: `an-${subj.code}-${Math.random().toString(16).slice(2, 6)}`, run_at: nowIso(), per_visit_est_lesions: subj._raw ? aiCounts(subj._raw) : null, simulated: true };
        setSubjects((all) => all.map((x) => (x._id === subj._id ? { ...x, info: { ...x.info, response: { ...x.info.response, ai } } } : x)));
        log({ action: 'Gear run (simulated)', target: subj.code, detail: `${MODEL.gear} ${MODEL.gear_version} → AI score ${score.toFixed(2)}${env.live ? ' · not saved to Flywheel' : ''}`, api: env.live ? 'none: gear not built yet' : 'POST /api/jobs/add' });
        toast(env.live ? 'Simulated gear run' : 'Gear complete', env.live ? `${subj.code}: AI score ${score.toFixed(2)} shown for this session only. Not written to Flywheel.` : `${subj.code}: AI score ${score.toFixed(2)} written to info.response.ai`, env.live ? 'warning' : 'success');
        setJob(null);
      }
    }, 380);
  };

  const record = (subj, d) => setConfirm({ subj, d });
  const [saving, setSaving] = useState(false);
  const nextDecisionId = () => {
    const ids = subjects.flatMap((x) => [x.info.marketing.review?.decision_id, ...(x.info.marketing.review_history || []).map((h) => h.decision_id)])
      .filter(Boolean).map((id) => +String(id).replace(/\D/g, '')).filter((n) => !Number.isNaN(n));
    const n = Math.max(env.live ? 0 : 7, ...ids) + 1;
    return `MKT-${String(n).padStart(4, '0')}`;
  };
  const toFileRefs = (subj, keys) => keys.map((k) => {
    const { visit, light, view } = parseFileId(k);
    const e = subj._live?.files[`${visit}-${light}-${view}`];
    return e ? { name: e.file.name, file_id: e.file.file_id } : k;
  });
  const commit = async () => {
    const { subj, d } = confirm;
    const review = { decision: d.decision, reason: d.reason, note: d.note, images: [...(picks[subj._id] || [])], reviewer: ME,
      timestamp: nowIso(), decision_id: nextDecisionId(), ai_attested: d.attest || undefined, app: `responder-review/${BUILD.version}` };
    let history = subj.info.marketing.review_history || [];
    if (env.live) {
      setSaving(true);
      try {
        const stored = { ...review, images: toFileRefs(subj, review.images) };
        history = await env.api.saveReview(subj, stored, { action: 'decision', ...stored });
      } catch (e) {
        setSaving(false);
        toast('Decision not saved', e?.message || String(e), 'error');
        return;
      }
      setSaving(false);
    }
    setSubjects((all) => all.map((x) => (x._id === subj._id ? { ...x, info: { ...x.info, marketing: { review, review_history: history } } } : x)));
    log({ action: `Decision: ${DEC_TAG[d.decision].title}`, target: subj.code, detail: `${review.decision_id} · ${review.images.length} images · ${d.reason}${d.attest ? ' · AI evidence attested' : ''}`,
      api: env.live ? `updateContainerInfo(subject ${subj.label}) set marketing.review` : `POST /api/subjects/${subj._id}/info {set:{marketing.review}} (verify)` });
    toast(`${subj.code} ${DEC_TAG[d.decision].title.toLowerCase()}`, `${review.decision_id} ${env.live ? 'saved to Flywheel' : 'recorded'}`, d.decision === 'approve' ? 'success' : 'warning');
    setConfirm(null);
  };
  const revise = async (subj) => {
    const prev = subj.info.marketing.review;
    let history = subj.info.marketing.review_history || [];
    if (env.live) {
      try {
        history = await env.api.saveReview(subj, null, { action: 'reopened', decision_id: prev.decision_id, reviewer: ME, timestamp: nowIso() });
      } catch (e) { toast('Not reopened', e?.message || String(e), 'error'); return; }
    }
    setSubjects((all) => all.map((x) => (x._id === subj._id ? { ...x, info: { ...x.info, marketing: { review: null, review_history: history } } } : x)));
    log({ action: 'Decision reopened', target: subj.code, detail: `${prev.decision_id} superseded; prior value kept in review_history`, api: env.live ? `updateContainerInfo(subject ${subj.label})` : `POST /api/subjects/${subj._id}/info (verify)` });
  };

  const approved = subjects.filter((x) => decisionOf(x) === 'approve');
  const manifest = approved.map((x) => ({
    subject: x.code, decision_id: x.info.marketing.review.decision_id, consent: x.info.consent.marketing.recorded_in,
    evidence: x.info.response.clinical ? `clinical:${x.info.response.clinical.label}` : `ai:${x.info.response.ai?.score} (attested)`,
    files: x.info.marketing.review.images.map((id) => id.replace(/^f-/, '')),
  }));

  const visibleLights = LIGHTING.filter((l) => lights.includes(l.key));
  const focusFile = focus && (() => {
    const { visit, light, view } = parseFileId(focus);
    if (s._live) return s._live.files[`${visit}-${light}-${view}`]?.file || null;
    return s.sessions.flatMap((ses) => ses.acquisitions.flatMap((a) => a.files)).find((f) => f.file_id === focus);
  })();
  const parsed = focusFile && parseName(focusFile.name);
  const inv = s.sessions.map((x) => x.info.investigator || {});

  return (
    <div className="app vision-dark">
      <header className="topbar">
        <div className="brand"><Icon name="image-picture-square" color="primary" decorative /><Typography variant="h4">Responder Review</Typography></div>
        <Tag color="slate" title={env.live ? env.project.label : PROJECT.label} />
        {env.live ? <Tag color="green" icon="server-checkmark" title={`Live · ${env.site}`} /> : <Tag color="orange" icon="warning" title="Demo · Synthetic Images" />}
        <div className="sp" />
        <Typography variant="p4" color="muted">{approved.length} approved</Typography>
        <Button size="small" variant="outlined" startIcon="document-file-download" disabled={!approved.length} onClick={() => setPdfOpen(true)}>Export PDF...</Button>
        <Button size="small" variant="outlined" startIcon="download" disabled={!approved.length} onClick={() => setExportOpen(true)}>Export Approved...</Button>
        <Tooltip title="Info and About"><IconButton icon="information-circle" color="slate" selected={info} aria-label="Info" onClick={() => setInfo((v) => !v)} /></Tooltip>
      </header>

      <div className="body">
        <Queue subjects={subjects} selectedId={s._id} onSelect={setSelectedId} filter={filter} setFilter={setFilter} consentOnly={consentOnly} setConsentOnly={setConsentOnly} />

        <main className="center">
          <div className="subj-h">
            <div>
              <Typography variant="h2">{s.code}</Typography>
              <Typography variant="p4" color="muted">{env.live ? `${s.label} · ${env.project.label}` : `${PROJECT.info.indication} · ${PROJECT.info.device}`}</Typography>
            </div>
            <div className="sp" />
            <ButtonToggle value={mode} onChange={setMode} size="small" aria-label="Layout">
              <Button value="grid" startIcon="grid-layout">Timeline Grid</Button>
              <Button value="compare" startIcon="layers">Compare</Button>
            </ButtonToggle>
          </div>
          <div className="toolbar">
            <ButtonToggle value={view} onChange={setView} size="small" aria-label="View">
              {VIEWS.map((v) => <Button key={v.key} value={v.key}>{v.label}</Button>)}
            </ButtonToggle>
            {mode === 'grid' && (
              <ButtonGroup value={lights} onChange={(v) => v.length && setLights(LIGHTING.map((l) => l.key).filter((k) => v.includes(k)))} size="small" aria-label="Lighting modes">
                {LIGHTING.map((l) => <Button key={l.key} value={l.key}>{l.short}</Button>)}
              </ButtonGroup>
            )}
            <div className="sp" />
            {env.live ? <Tooltip title="Registration across visits is not built yet"><Tag color="slate" title="Auto-Align: Not Available" /></Tooltip>
              : <Switch name="align" size="small" checked={align} onChange={setAlign} title="Auto-Align" />}
          </div>

          {mode === 'grid' ? (
            <div className="grid-wrap">
              <div className="tgrid" style={{ gridTemplateColumns: `96px repeat(${VISITS.length}, minmax(0,1fr))` }}>
                <div />
                {VISITS.map((v, i) => (
                  <div className="colh" key={v.key}>
                    <Typography variant="h5">{v.label}</Typography>
                    <Typography variant="p5" color="muted">Day {v.day}{inv[i].lesion_count_total != null ? ` · ${inv[i].lesion_count_total} lesions` : ''}{inv[i].iga != null ? ` · IGA ${inv[i].iga}` : ''}</Typography>
                  </div>
                ))}
                {visibleLights.map((l) => (
                  <React.Fragment key={l.key}>
                    <div className="rowh"><Typography variant="h6" color="muted">{l.label}</Typography></div>
                    {VISITS.map((v, vi) => {
                      const fid = `f-${s.code}-${v.key}-${l.key}-${view}`;
                      return <Tile key={fid} s={s} visitIdx={vi} light={l.key} view={view} align={align} w={320} h={240}
                        selected={myPicks.has(fid)} onToggleSel={() => togglePick(fid)} focused={focus === fid} onFocus={() => setFocus(fid)}
                        onOpen={() => { setCmpLight(l.key); setCmpVisit(vi === 0 ? 'V5' : v.key); setMode('compare'); }} showAI />;
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          ) : (
            <Compare s={s} view={view} align={align} light={cmpLight} setLight={setCmpLight} visit={cmpVisit} setVisit={setCmpVisit} picks={myPicks} togglePick={togglePick} />
          )}

          <footer className="filebar">
            {parsed ? (<>
              <Icon name="file-blank-search" color="muted" size="small" decorative />
              <span className="mono fname">{focusFile.name}</span>
              {Object.entries(parsed).filter(([k]) => k !== 'ext').map(([k, val]) => <Tag key={k} size="small" color="primary" title={`${k}: ${val}`} />)}
              <Typography variant="p5" color="light">parsed at ingest by manifest rule</Typography>
            </>) : <Typography variant="p4" color="light">Click a tile to see its filename and the metadata parsed from it at ingest. Double-click opens Compare. J / K moves through the queue.</Typography>}
          </footer>
        </main>

        <aside className="right">
          {info ? <InfoPanel s={s} env={env} onClose={() => setInfo(false)} /> : (
            <Tabs value={rightTab} onChange={setRightTab}>
              <Tab value="decision" title="Review" />
              <Tab value="audit" title="Audit Trail" />
              <TabPanel value="decision"><DecisionPanel s={s} picks={myPicks} job={job} onRunGear={runGear} onRecord={record} onRevise={revise} /></TabPanel>
              <TabPanel value="audit"><AuditPanel audit={audit} s={s} /></TabPanel>
            </Tabs>
          )}
        </aside>
      </div>

      {confirm && (
        <Dialog open title="Record Marketing Decision" width="small" onClose={() => setConfirm(null)}
          actions={<><Button variant="outlined" color="slate" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button disabled={saving} color={confirm.d.decision === 'approve' ? 'green' : confirm.d.decision === 'hold' ? 'orange' : 'red'} onClick={commit}>{saving ? 'Saving...' : `Record as ${ME.split('@')[0]}`}</Button></>}>
          <div className="dlg">
            <KV k="Subject" v={confirm.subj.code} />
            <KV k="Decision" v={DEC_TAG[confirm.d.decision].title} />
            <KV k="Reason" v={confirm.d.reason} />
            <KV k="Images" v={(picks[confirm.subj._id] || new Set()).size} />
            {confirm.d.attest && <KV k="Attestation" v="Medical reviewer confirms visible response (AI evidence)" />}
            <AlertPanel severity="info" title="Business record" description={env.live ? 'Saved to this subject\'s metadata (marketing.review, with history) in Flywheel. Core records the change in its audit log (verify). Whether this needs a Part 11 e-signature is a sponsor Quality decision (open).' : "Written to subject metadata and the audit trail with your user and server time. Whether this needs a Part 11 e-signature is a sponsor Quality decision (open)."} />
          </div>
        </Dialog>
      )}

      {exportOpen && (
        <Dialog open title="Export Approved Package" width="medium" onClose={() => setExportOpen(false)}
          actions={<><Button variant="outlined" color="slate" onClick={() => setExportOpen(false)}>Close</Button>
            <Button startIcon="download" onClick={() => { log({ action: 'Export', target: approved.map((x) => x.code).join(', '), detail: `${manifest.reduce((a, m) => a + m.files.length, 0)} files → marketing DAM (simulated)`, api: 'POST /api/jobs/add (gear: dam-export) (verify)' }); setExportOpen(false); toast('Export queued', 'Simulated. No files left this browser.', 'success'); }}>Queue Export</Button></>}>
          <div className="dlg">
            <Typography variant="p3">Only subjects with an Approve decision and granted marketing consent are packaged. Each file carries its decision ID and consent reference.</Typography>
            <pre className="manifest">{JSON.stringify(manifest, null, 2)}</pre>
          </div>
        </Dialog>
      )}

      {pdfOpen && <PdfDialog subjects={subjects} env={env} onClose={() => setPdfOpen(false)}
        onError={(t, d) => toast(t, d, 'error')}
        onDone={(r) => { setPdfOpen(false); log({ action: 'Export PDF', target: `${r.n} subjects`, detail: `${r.docId} · ${r.pages} pages · ${r.images} images · ${r.criteria} · ${r.filename}`, api: env.live ? 'uploadFile(project) + updateContainerInfo(project responder_review.exports)' : 'client-side render (product: POST /api/jobs/add, gear: responder-report) (verify)' }); toast('PDF ready', `${r.docId} · ${r.pages} pages · ${r.where}`, 'success'); }} />}

      <SnackbarContainer align="right">
        {toasts.map((t) => <Snackbar key={t.id} title={t.title} description={t.description} severity={t.severity} />)}
      </SnackbarContainer>
    </div>
  );
}

/* ---------------- Root: demo or live ---------------- */
function auditFromMetadata(subjects, project) {
  const rows = [];
  for (const x of subjects) {
    for (const h of x.info.marketing.review_history || []) {
      rows.push({ ts: h.timestamp, user: h.reviewer || 'unknown', action: h.action === 'reopened' ? 'Decision reopened' : `Decision: ${DEC_TAG[h.decision]?.title || h.decision}`,
        target: x.code, detail: `${h.decision_id || ''}${h.images ? ` · ${h.images.length} images` : ''}${h.reason ? ` · ${h.reason}` : ''}`, api: 'from subject info marketing.review_history' });
    }
  }
  for (const e of project.info?.responder_review?.exports || []) {
    rows.push({ ts: e.timestamp, user: e.user, action: 'Export PDF', target: `${(e.subjects || []).length} subjects`, detail: `${e.doc_id} · ${e.pages} pages · ${e.criteria} · ${e.filename}`, api: 'from project info responder_review.exports' });
  }
  return rows.filter((r) => r.ts).sort((a, b) => a.ts.localeCompare(b.ts));
}

function Root() {
  const [st, setSt] = useState(() => (Live.wantLive() ? { phase: 'connecting' } : { phase: 'ready', env: { live: false, user: ME }, subjects: buildSubjects(), audit: SEED_AUDIT }));
  useEffect(() => {
    if (st.phase !== 'connecting') return;
    (async () => {
      try {
        const ext = await Live.connect();
        setSt({ phase: 'loading', progress: null });
        const { project, subjects, total } = await Live.loadProject(ext, (d, n) => setSt({ phase: 'loading', progress: [d, n] }));
        const api = Live.makeApi(ext, project);
        subjects.forEach((x) => { x._live.api = api; x._demo = x._live.container.info?.demo; });
        ME = api.user;
        const env = { live: true, api, project, user: api.user, site: api.site, total, loaded: subjects.length, filter: ext.params?.subject_filter || '^SYN-' };
        ENV = env;
        if (!subjects.length) { setSt({ phase: 'error', error: `No subjects in ${project.label} match ${env.filter}. Set subject_filter in the app options.` }); return; }
        setSt({ phase: 'ready', env, subjects, audit: auditFromMetadata(subjects, project) });
      } catch (e) {
        setSt({ phase: 'error', error: e?.message || String(e) });
      }
    })();
  }, [st.phase]);
  if (st.phase === 'ready') return <App env={st.env} initialSubjects={st.subjects} initialAudit={st.audit} />;
  return (
    <div className="app vision-dark boot">
      <div className="boot-card">
        <Icon name="image-picture-square" color="primary" size="large" decorative />
        <Typography variant="h3">Responder Review</Typography>
        {st.phase === 'error' ? (<>
          <AlertPanel severity="error" title="Could not load" description={st.error} />
          <Typography variant="p4" color="light">Open with #demo for synthetic data.</Typography>
        </>) : (<>
          <Typography variant="p4" color="muted">{st.phase === 'connecting' ? 'Connecting to Flywheel' : st.progress ? `Loading subjects ${st.progress[0]} of ${st.progress[1]}` : 'Listing subjects'}</Typography>
          <ProgressBar mode={st.progress ? 'determinate' : 'indeterminate'} value={st.progress ? Math.round((100 * st.progress[0]) / st.progress[1]) : 0} />
        </>)}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
