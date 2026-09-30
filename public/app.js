// RFQ Radar frontend. Vanilla JS. View state lives in the URL (shareable); the vendor
// profile lives in localStorage (it's about who you are, not what you're looking at).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString();
const SA_SHORT = { Y: 'SB', H: 'HUBZone', R: 'SDVOSB', L: 'WOSB', A: '8(a)', E: 'EDWOSB' };
const QTY_LABEL = { '1-10': '1–10', '11-100': '11–100', '101-1000': '101–1,000', '1000+': 'Over 1,000' };
const CERTS = [['sb', 'Small business'], ['wosb', 'Woman-owned (WOSB)'], ['edwosb', 'Econ. disadvantaged WOSB'], ['sdvosb', 'Service-disabled veteran-owned'], ['hubzone', 'HUBZone'], ['8a', '8(a)']];

// ---------- profile (localStorage) ----------
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const splitCodes = (s, len) => [...new Set(String(s || '').toUpperCase().split(/[^A-Z0-9]+/).filter((c) => !len || c.length === len))];
function getProfile() {
  try { return JSON.parse(ls.get('profile')) || null; } catch { return null; }
}
function saveProfile(pr) { ls.set('profile', pr ? JSON.stringify(pr) : null); }
function profileParams() {
  const pr = getProfile();
  return pr ? { profile: '1', certs: pr.certs.join(','), cages: pr.cages.join(','), cats: pr.cats.join(',') } : {};
}

// ---------- URL state ----------
let P = Object.fromEntries(new URLSearchParams(location.search));
let data = null, seq = 0, fscFilter = '', profileOpen = false;

function setP(patch, { keepPage = false } = {}) {
  P = { ...P, ...patch };
  if (!keepPage) delete P.page;
  for (const k of Object.keys(P)) if (P[k] === '' || P[k] == null) delete P[k];
  const qs = new URLSearchParams(P).toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  load();
}
const listOf = (k) => (P[k] ? P[k].split(',') : []);
const toggle = (k, v) => { const l = listOf(k); setP({ [k]: (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]).join(',') }); };

// ---------- dates ----------
const days = (iso, today) => Math.round((Date.parse(iso) - Date.parse(today)) / 864e5);
const md = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : '');
function relDue(iso, today) {
  const d = days(iso, today);
  if (d < 0) return { text: d === -1 ? 'yesterday' : `${-d} days ago`, cls: 'due-past' };
  if (d === 0) return { text: 'today', cls: 'due-red' };
  if (d === 1) return { text: 'tomorrow', cls: 'due-red' };
  return { text: `in ${d} days`, cls: d <= 3 ? 'due-amber' : '' };
}

// ---------- data ----------
async function load() {
  const id = ++seq;
  let r;
  try { r = await fetch(`/api/solicitations?${new URLSearchParams({ ...P, ...profileParams() })}`); }
  catch { return banner('Cannot reach the server.', true); }
  if (id !== seq) return;
  if (r.status === 503) return pollStatus();
  const d = await r.json();
  if (id !== seq) return;
  data = d;
  render();
}

let polling = false;
async function pollStatus() {
  if (polling) return;
  polling = true;
  for (;;) {
    const s = await fetch('/api/status').then((r) => r.json()).catch(() => null);
    if (s) {
      if (s.phase === 'syncing') banner(`Syncing with DIBBS… ${s.message || ''}`);
      else if (s.error) banner(`DIBBS sync problem: ${s.error}${s.hasData ? ' (showing cached data)' : ''}`, true);
      else banner('');
      if (s.phase !== 'syncing' || (s.hasData && !data)) { polling = false; if (s.hasData) load(); return; }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}
function banner(msg, isError = false) {
  const b = $('#banner');
  b.hidden = !msg;
  b.textContent = msg;
  b.classList.toggle('error', isError);
}

// ---------- render ----------
function render() {
  const { meta } = data;
  $('#meta').textContent = `${fmt(meta.solicitations)} solicitations from ${meta.files} daily files (${md(meta.earliestFile)}–${md(meta.latestFile)}) · query ${data.ms} ms`;
  if (document.activeElement !== $('#q')) $('#q').value = P.q || '';
  $('#sort').value = P.sort || 'new';
  renderGates();
  renderFilters();
  renderSummary();
  renderTable();
  renderPager();
}

function renderGates() {
  const f = data.facets, gate = data.gate, hasProfile = data.profileSet;
  const steps = [
    { g: 0, title: 'All RFQs', sub: `last ${data.meta.files} files`, n: f.funnel[0] },
    { g: 1, title: '1 · Can I still bid?', sub: 'deadline not passed', n: f.funnel[1] },
    { g: 2, title: '2 · Am I allowed to?', sub: 'set-aside fits my certifications', n: f.funnel[2] },
    { g: 3, title: '3 · Can I get the part?', sub: 'my supplier or my product class', n: f.funnel[3] },
  ];
  const chips = [
    { k: 'closing', on: P.closing === '1', label: 'Closing within 3 days', n: f.closing, cls: 'red' },
    { k: 'posted', v: 'latest', on: P.posted === 'latest', label: `New in latest file (${md(data.meta.latestFile)})`, n: f.posted.latest },
    { k: 'extended', on: P.extended === '1', label: 'Deadline extended', sub: 'second chance', n: f.extended, cls: 'green' },
  ];
  $('#triage').innerHTML = `
    ${hasProfile ? '' : `<div class="welcome">
      <div><b>Should I bid on this?</b> RFQ Radar runs every DIBBS solicitation through bid/no-bid gates.
      Gate 1 needs only the deadline. Gates 2 and 3 need to know who you are: your certifications, suppliers and product classes.</div>
      <button class="btn primary" id="demo">Load a sample distributor profile</button></div>`}
    <div class="funnel">${steps.map((s, i) => {
      const locked = s.g >= 2 && !hasProfile;
      return `${i ? '<span class="arrow">›</span>' : ''}<button class="step ${gate === s.g ? 'on' : ''} ${locked ? 'locked' : ''}" data-g="${s.g}">
        <span class="t">${s.title}</span><span class="s">${locked ? 'set up your profile →' : s.sub}</span>
        <span class="n">${s.n == null ? '—' : fmt(s.n)}</span></button>`;
    }).join('')}</div>
    <div class="chips">${chips.map((c, i) => `<button class="chip ${c.on ? 'on' : ''} ${c.cls || ''}" data-i="${i}">
      <span>${c.label}${c.sub ? ` <span class="label-sub">${c.sub}</span>` : ''}</span><span class="n">${fmt(c.n)}</span></button>`).join('')}</div>`;
  if ($('#demo')) $('#demo').onclick = async () => {
    const s = await fetch('/api/sample-profile').then((r) => r.json());
    saveProfile(s);
    profileOpen = false;
    setP({ gate: '3' });
  };
  $('#triage').querySelectorAll('.step').forEach((b) => (b.onclick = () => {
    const g = +b.dataset.g;
    if (g >= 2 && !hasProfile) { profileOpen = true; renderFilters(); $('#pf')?.scrollIntoView({ behavior: 'smooth' }); return; }
    setP({ gate: String(g) });
  }));
  $('#triage').querySelectorAll('.chip').forEach((b) => (b.onclick = () => {
    const c = chips[b.dataset.i];
    setP({ [c.k]: c.on ? '' : c.v || '1' });
  }));
}

const opt = (type, k, v, checked, label, n, extra = '') =>
  `<label class="opt ${n === 0 && !checked ? 'zero' : ''}"><input type="${type}" data-k="${k}" data-v="${esc(v)}" ${checked ? 'checked' : ''}>
   <span class="lbl">${extra}${esc(label)}</span>${n == null ? '' : `<span class="n">${fmt(n)}</span>`}</label>`;

function profileHtml() {
  const pr = getProfile() || { certs: [], cages: [], cats: [] };
  const summary = getProfile()
    ? `${pr.certs.length ? pr.certs.map((c) => CERTS.find(([k]) => k === c)?.[1] || c).join(', ') : 'No certifications'} · ${pr.cages.length} supplier${pr.cages.length === 1 ? '' : 's'} · ${pr.cats.length} product class${pr.cats.length === 1 ? '' : 'es'}`
    : 'Not set up. Gates 2 and 3 need it.';
  return `<div class="fgroup profile" id="pf">
    <h4>My profile <button class="linkbtn" id="pftoggle">${profileOpen ? 'hide' : 'edit'}</button></h4>
    <p class="hint">${esc(summary)}</p>
    ${profileOpen ? `
      <div class="pfsec"><div class="pfl">Certifications <span class="small">(gate 2)</span></div>
        ${CERTS.map(([k, label]) => `<label class="opt"><input type="checkbox" class="pfcert" value="${k}" ${pr.certs.includes(k) ? 'checked' : ''}><span class="lbl">${label}</span></label>`).join('')}
        <p class="hint">None checked = unrestricted RFQs only.</p></div>
      <div class="pfsec"><div class="pfl">Suppliers I buy from <span class="small">(gate 3, CAGE codes)</span></div>
        <textarea id="pfcages" class="cages" placeholder="e.g. 1ABC2, 3DEF4">${esc(pr.cages.join(', '))}</textarea></div>
      <div class="pfsec"><div class="pfl">Product classes I deal in <span class="small">(gate 3, FSC codes)</span></div>
        <textarea id="pfcats" class="cages" placeholder="e.g. 5305, 5310, 4820">${esc(pr.cats.join(', '))}</textarea></div>
      <div class="pfbtns"><button class="btn primary" id="pfsave">Save profile</button>
        <button class="btn" id="pfsample" title="Fill in the suppliers and classes that appear most in open RFQs">Try a sample</button>
        ${getProfile() ? '<button class="btn" id="pfclear">Clear</button>' : ''}</div>` : ''}
  </div>`;
}

function renderFilters() {
  if (!data) return;
  const f = data.facets;
  const posted = P.posted || '';
  const sa = listOf('sa'), fsc = listOf('fsc'), office = listOf('office'), qty = listOf('qty');
  const fscItems = f.fsc.filter(([c, , name]) => !fscFilter || c.startsWith(fscFilter) || name.toLowerCase().includes(fscFilter.toLowerCase()));
  const focusFsc = document.activeElement?.id === 'fscq';

  $('#filters').innerHTML = `${profileHtml()}
    <div class="fgroup"><h4>First posted <span class="why" title="What's new since yesterday? Uses the FIRST posted date, so re-posted amendments don't look new.">why?</span></h4>
      ${opt('radio', 'posted', '', posted === '', 'Any time', f.posted.any)}
      ${opt('radio', 'posted', 'latest', posted === 'latest', `Latest file (${md(data.meta.latestFile)})`, f.posted.latest)}
      ${opt('radio', 'posted', '3', posted === '3', 'Last 3 days', f.posted[3])}
      ${opt('radio', 'posted', '7', posted === '7', 'Last 7 days', f.posted[7])}
    </div>
    <div class="fgroup"><h4>Product class (FSC) <span class="why" title="Vendors specialize by product class. The main way to narrow further.">why?</span></h4>
      <input id="fscq" class="fsc-search" placeholder="Filter ${fmt(f.fscTotal)} classes (e.g. 5305, valves)" value="${esc(fscFilter)}">
      <div class="fsc-list">${fscItems.map(([c, n, name]) => opt('checkbox', 'fsc', c, fsc.includes(c), name || '—', n, `<span class="code">${c}</span>`)).join('') || '<p class="hint">No match in the top classes.</p>'}</div>
    </div>
    <div class="fgroup"><h4>Set-aside <span class="why" title="Gate 2 applies this automatically from your profile. Use this to look at one type.">why?</span></h4>
      ${f.sa.map(([k, n, label]) => opt('checkbox', 'sa', k, sa.includes(k), label, n)).join('')}
    </div>
    <div class="fgroup"><h4>Quantity <span class="why" title="Very skewed (median 8, top 1% over 4,600). Screens by capacity and filters out one-off parts.">why?</span></h4>
      ${Object.entries(QTY_LABEL).map(([k, label]) => opt('checkbox', 'qty', k, qty.includes(k), label, f.qty[k] || 0)).join('')}
    </div>
    <div class="fgroup"><h4>Buying office <span class="why" title="From the solicitation prefix. Vendors tend to work with specific DLA supply chains.">why?</span></h4>
      ${f.office.map(([k, n, name]) => opt('checkbox', 'office', k, office.includes(k), name || k, n, name ? `<span class="code">${k}</span>` : '')).join('')}
    </div>
    <button class="btn clear" id="clear">Clear filters</button>`;

  $('#filters').querySelectorAll('input[data-k]').forEach((el) => {
    el.onchange = () => (el.type === 'radio' ? setP({ [el.dataset.k]: el.dataset.v }) : toggle(el.dataset.k, el.dataset.v));
  });
  const fq = $('#fscq');
  fq.oninput = () => { fscFilter = fq.value.trim(); renderFilters(); };
  if (focusFsc) { fq.focus(); fq.setSelectionRange(fq.value.length, fq.value.length); }
  $('#clear').onclick = () => { fscFilter = ''; setP({ closing: '', posted: '', extended: '', sa: '', fsc: '', office: '', qty: '', q: '' }); };

  $('#pftoggle').onclick = () => { profileOpen = !profileOpen; renderFilters(); };
  if (profileOpen) {
    $('#pfsave').onclick = () => {
      saveProfile({
        certs: [...document.querySelectorAll('.pfcert:checked')].map((c) => c.value),
        cages: splitCodes($('#pfcages').value, 5),
        cats: splitCodes($('#pfcats').value, 4),
      });
      profileOpen = false;
      setP({ gate: '3' });
    };
    $('#pfsample').onclick = async () => {
      const s = await fetch('/api/sample-profile').then((r) => r.json());
      document.querySelectorAll('.pfcert').forEach((c) => (c.checked = s.certs.includes(c.value)));
      $('#pfcages').value = s.cages.join(', ');
      $('#pfcats').value = s.cats.join(', ');
    };
    if ($('#pfclear')) $('#pfclear').onclick = () => { saveProfile(null); profileOpen = true; setP({ gate: '1' }); };
  }
}

function renderSummary() {
  const tags = [];
  if (P.q) tags.push(['q', '', `“${P.q}”`]);
  for (const k of ['sa', 'fsc', 'office', 'qty']) for (const v of listOf(k)) tags.push([k, v, k === 'sa' ? SA_SHORT[v] || 'Unrestricted' : k === 'qty' ? `Qty ${QTY_LABEL[v]}` : v]);
  if (P.closing === '1') tags.push(['closing', '', 'Closing ≤ 3 days']);
  if (P.posted) tags.push(['posted', '', P.posted === 'latest' ? 'Latest file' : `Last ${P.posted} days`]);
  if (P.extended === '1') tags.push(['extended', '', 'Deadline extended']);
  $('#summary').innerHTML = `<span><b>${fmt(data.total)}</b> solicitation${data.total === 1 ? '' : 's'}</span>
    <span class="active">${tags.map(([k, v, label]) => `<span class="tag" data-k="${k}" data-v="${esc(v)}" title="Remove">${esc(label)} ✕</span>`).join('')}</span>`;
  $('#summary').querySelectorAll('.tag').forEach((t) => (t.onclick = () => (t.dataset.v ? toggle(t.dataset.k, t.dataset.v) : setP({ [t.dataset.k]: '' }))));
}

function sourceCell(r) {
  if (r.supplierMatch.length) return `<span class="badge mine">✓ your supplier ${esc(r.supplierMatch.join(', '))}</span>`;
  const cat = r.categoryMatch ? `<span class="badge cat">✓ your class ${r.fsc}</span> ` : '';
  const list = r.sourceCount ? `<span class="mono small">${esc(r.cages.join(', '))}${r.sourceCount > 2 ? ` +${r.sourceCount - 2}` : ''}</span>` : '<span class="small">no approved sources listed</span>';
  return cat + list;
}

function renderTable() {
  const tb = $('#tbl tbody');
  const today = data.today, latest = data.meta.latestFile;
  if (!data.rows.length) {
    const hint = data.gate === 3 ? 'No RFQs pass all three gates. Add suppliers or product classes to your profile, or loosen a filter.' : 'No solicitations match. Try removing a filter.';
    tb.innerHTML = `<tr><td colspan="10" class="empty">${hint}</td></tr>`;
    return;
  }
  tb.innerHTML = data.rows.map((r) => {
    const due = relDue(r.returnBy, today);
    const saBadge = SA_SHORT[r.setAside] ? `<span class="badge sa">${SA_SHORT[r.setAside]}</span>` : '<span class="small">open to all</span>';
    const notElig = data.profileSet && !r.eligible ? ' <span class="badge bad" title="Your certifications don\'t cover this set-aside">not eligible</span>' : '';
    return `<tr data-sol="${r.sol}" class="${P.open === r.sol ? 'sel' : ''}">
      <td class="nowrap"><span class="mono">${r.solDisplay}</span>${r.lineCount > 1 ? `<div class="small">${r.lineCount} lines</div>` : ''}</td>
      <td><div class="nom">${esc(r.nom)}</div><div class="small">${r.fsc ? `${r.fsc} · ${esc(r.fscName)}` : 'part-number buy'}</div></td>
      <td class="nowrap mono">${esc(r.nsnDisplay)}${r.nsnCount > 1 ? ` <span class="small">+${r.nsnCount - 1}</span>` : ''}</td>
      <td class="num">${fmt(r.qty)} <span class="small">${esc(r.ui)}</span></td>
      <td class="nowrap"><span class="${due.cls}">${md(r.returnBy)}</span> <span class="small">${due.text}</span>
        ${r.extended ? `<div><span class="badge ext" title="Previously due ${md(r.prevReturnBy)}">extended from ${md(r.prevReturnBy)}</span></div>` : ''}</td>
      <td>${saBadge}${notElig}</td>
      <td>${sourceCell(r)}</td>
      <td class="nowrap">${md(r.firstPosted)} ${r.firstPosted === latest ? '<span class="badge new">new</span>' : ''}</td>
      <td><a class="ext-link" href="${r.link}" target="_blank" rel="noopener" title="Open on DIBBS">↗</a></td>
    </tr>`;
  }).join('');
  tb.querySelectorAll('tr[data-sol]').forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('a')) openDetail(tr.dataset.sol); }));
}

function renderPager() {
  const { page, pages } = data;
  $('#pager').innerHTML = pages > 1 ? `<button class="btn" id="prev" ${page <= 1 ? 'disabled' : ''}>← Prev</button>
    <span>Page ${page} of ${fmt(pages)}</span><button class="btn" id="next" ${page >= pages ? 'disabled' : ''}>Next →</button>` : '';
  if (pages > 1) {
    $('#prev').onclick = () => { setP({ page: String(page - 1) }, { keepPage: true }); scrollTo(0, 0); };
    $('#next').onclick = () => { setP({ page: String(page + 1) }, { keepPage: true }); scrollTo(0, 0); };
  }
}

// ---------- detail drawer ----------
function gateRow(pass, title, detail) {
  const icon = pass === null ? '<span class="gi unk">?</span>' : pass ? '<span class="gi ok">✓</span>' : '<span class="gi no">✕</span>';
  return `<li>${icon}<div><b>${title}</b><div class="small">${detail}</div></div></li>`;
}

async function openDetail(sol) {
  P.open = sol;
  history.replaceState(null, '', `?${new URLSearchParams(P)}`);
  document.querySelectorAll('tbody tr').forEach((tr) => tr.classList.toggle('sel', tr.dataset.sol === sol));
  const r = await fetch(`/api/solicitation?${new URLSearchParams({ sol, ...profileParams() })}`);
  if (!r.ok) return closeDetail();
  const s = await r.json();
  const g = s.gates;
  const due = relDue(s.returnBy, s.today);
  const saText = s.setAside === 'N' ? 'Unrestricted: anyone can bid' : `${s.setAsideLabel} set-aside`;
  const srcText = !s.profileSet ? 'Set up your profile to check.'
    : g.supplierMatch.length ? `Your supplier ${g.supplierMatch.join(', ')} is an approved source.`
    : g.categoryMatch ? `FSC ${s.fsc} is one of your product classes${s.sources.length ? `, but none of your suppliers is an approved source (${s.sources.length} listed)` : ' and no approved source is required'}.`
    : s.sources.length ? `None of your suppliers is among the ${s.sources.length} approved source${s.sources.length === 1 ? '' : 's'}, and FSC ${s.fsc || '—'} isn't one of your classes.`
    : `No approved sources listed, and FSC ${s.fsc || '—'} isn't one of your classes.`;
  $('#drawer').innerHTML = `
    <button class="close" title="Close (Esc)">×</button>
    <div class="small mono">${s.solDisplay}</div>
    <h2>${esc(s.nom)}</h2>
    <div class="small">${esc(s.fsc ? `FSC ${s.fsc} · ${s.fscName}` : 'Part-number buy')}${s.officeName ? ` · ${esc(s.officeName)}` : ''}</div>
    <div class="actions">
      <a class="btn primary" href="${s.links.record}" target="_blank" rel="noopener">Open on DIBBS ↗</a>
      <a class="btn" href="${s.links.quote}" target="_blank" rel="noopener">Quote on DIBBS ↗</a>
      <a class="btn" href="${s.links.pdf}" target="_blank" rel="noopener">Solicitation PDF ↗</a>
    </div>
    <h3>Should I bid?</h3>
    <ul class="gates">
      ${gateRow(g.open, '1 · Can I still bid?', `Due ${s.returnBy} (${due.text})${s.extended ? `, extended from ${s.prevReturnBy}` : ''}`)}
      ${gateRow(s.setAside === 'N' ? true : s.profileSet ? g.eligible : null, '2 · Am I allowed to?',
        `${saText}.${s.setAside !== 'N' && !s.profileSet ? ' Set up your profile to check your certifications.' : s.profileSet && !g.eligible ? " Your certifications don't cover it." : ''}`)}
      ${gateRow(s.profileSet ? g.canSource : null, '3 · Can I get the part?', esc(srcText))}
      <li id="gate4"><span class="gi unk">…</span><div><b>4 · Is it worth it?</b><div class="small">Checking DIBBS award history…</div></div></li>
      ${gateRow(null, '5 · Can I deliver in time?', `${Math.max(0, days(s.returnBy, s.today))} days left to quote. Supplier lead time is up to you.`)}
    </ul>
    <div id="tableread"><h3>Who's at the table</h3><p class="small">Loading past awards for this NSN from DIBBS…</p></div>
    <dl class="grid">
      <dt>NSN</dt><dd class="mono">${esc(s.nsnDisplay)}</dd>
      <dt>Total quantity</dt><dd>${fmt(s.qty)} ${esc(s.ui)}${s.lineCount > 1 ? ` across ${s.lineCount} purchase requests` : ''}</dd>
      <dt>First posted</dt><dd>${s.firstPosted}${s.lastPosted !== s.firstPosted ? ` · re-posted ${s.lastPosted}` : ''}</dd>
      <dt>AMSC</dt><dd>${esc(s.amsc || '—')}</dd>
      <dt>Buyer code</dt><dd class="mono">${esc(s.buyer)}</dd>
    </dl>
    <h3>Approved sources (${s.sources.length})</h3>
    ${s.sources.length ? `<table><thead><tr><th>CAGE</th><th>Part numbers to ask for</th></tr></thead><tbody>
      ${s.sources.map((x) => `<tr><td class="mono">${g.supplierMatch.includes(x.cage) ? `<span class="badge mine">✓ ${x.cage}</span>` : x.cage}</td><td class="mono">${esc(x.parts.join(', ') || '—')}</td></tr>`).join('')}
      </tbody></table>` : '<p class="small">DLA lists no approved sources for this item.</p>'}
    <h3>Lines (${s.lines.length})</h3>
    <table><thead><tr><th>Purchase request</th><th>NSN</th><th class="num">Qty</th><th>Return by</th></tr></thead><tbody>
      ${s.lines.map((l) => `<tr><td class="mono">${l.pr}</td><td class="mono">${l.nsn}</td><td class="num">${fmt(l.qty)} ${l.ui}</td><td>${l.returnBy}</td></tr>`).join('')}
    </tbody></table>
    <p class="small" style="margin-top:16px">Item names are cut to 21 characters in DLA's daily file. The full description is in the solicitation PDF.</p>`;
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  $('#drawer .close').onclick = closeDetail;
  loadTableRead(s);
}

// ---------- gate 4: who's at the table ----------
const money = (n) => (n == null ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const HEAT = { unknown: ['?', 'unk', 'Unknown table'], incumbent: ['!', 'amber', 'Sticky incumbent'], crowded: ['✕', 'no', 'Crowded table'], contested: ['~', 'amber', 'Contested'], thin: ['✓', 'ok', 'Thin table'] };

async function loadTableRead(s) {
  const sol = s.sol;
  let t;
  try {
    const r = await fetch(`/api/tableread?${new URLSearchParams({ sol, ...profileParams() })}`);
    t = await r.json();
    if (!r.ok) throw new Error(t.error || `HTTP ${r.status}`);
  } catch (e) {
    if (P.open !== sol) return;
    $('#tableread').innerHTML = `<h3>Who's at the table</h3><p class="small">Couldn't load award history: ${esc(e.message)}</p>`;
    $('#gate4').innerHTML = `<span class="gi unk">?</span><div><b>4 · Is it worth it?</b><div class="small">Award history unavailable.</div></div>`;
    return;
  }
  if (P.open !== sol) return; // user moved on
  const [icon, cls, label] = HEAT[t.heat];
  $('#gate4').innerHTML = `<span class="gi ${cls}">${icon}</span><div><b>4 · Is it worth it?</b><div class="small">${label}. ${esc(t.headline)}</div></div>`;

  const winners = t.winners.map((w) => `<tr><td class="mono">${w.cage}${w.mine ? ' <span class="badge mine">your supplier</span>' : ''}${w.approved ? ' <span class="badge cat">approved source</span>' : ''}</td><td class="num">${w.wins}</td><td class="num">${Math.round((100 * w.wins) / t.n)}%</td></tr>`).join('');
  const history = t.awards.map((a) => `<tr><td>${a.date || '—'}</td><td class="mono">${a.cage}</td>
    <td class="num">${a.total != null ? money(a.total) : '<span class="small">not published</span>'}</td>
    <td class="num">${a.qty != null ? fmt(a.qty) : '<span class="small">?</span>'}</td>
    <td class="num">${a.unitPrice != null ? money(a.unitPrice) : '<span class="small">—</span>'}</td>
    <td class="mono small">${esc(a.sol)}</td></tr>`).join('');

  $('#tableread').innerHTML = `
    <h3>Who's at the table <span class="heat heat-${t.heat}">${label}</span></h3>
    <p>${esc(t.headline)}</p>
    ${t.n ? `<dl class="grid">
      <dt>Recent awards</dt><dd>${t.n}${t.perMonth ? ` (about ${t.perMonth}/month)` : ''}${t.truncated ? ' <span class="small">first 50 shown</span>' : ''}</dd>
      <dt>Last award</dt><dd>${t.lastAward.total != null ? money(t.lastAward.total) : 'Price not published'}${t.lastAward.qty ? ` for ${fmt(t.lastAward.qty)}` : ''} to <span class="mono">${t.lastAward.cage}</span> on ${t.lastAward.date}</dd>
      <dt>Recent unit price</dt><dd>${t.anchorUnitPrice != null ? `${money(t.anchorUnitPrice)} / ${esc(t.ui)} <span class="small">(median of ${t.unitPriceCount} award${t.unitPriceCount === 1 ? '' : 's'} where we know the quantity)</span>` : '<span class="small">Not known: no recent award has both a published price and a known quantity.</span>'}</dd>
    </dl>
    <table><thead><tr><th>Winner (CAGE)</th><th class="num">Wins</th><th class="num">Share</th></tr></thead><tbody>${winners}</tbody></table>
    <div class="ev">
      <div class="pfl">Your price check <span class="small">(gate 4 + adverse selection)</span></div>
      <label class="small">My unit cost from supplier: $ <input id="evcost" type="number" min="0" step="0.01" class="evin"></label>
      <label class="small">Markup: <input id="evmk" type="number" min="0" step="1" value="15" class="evin short">%</label>
      <div id="evout" class="small"></div>
    </div>
    <details><summary class="small">Award history (${t.awards.length})</summary>
      <table><thead><tr><th>Date</th><th>CAGE</th><th class="num">Total</th><th class="num">Qty</th><th class="num">Unit</th><th>Solicitation</th></tr></thead><tbody>${history}</tbody></table>
    </details>` : ''}
    <p class="small">Source: ${esc(t.source)}. Heat labels are rules of thumb from award counts, not predictions.</p>`;

  const cost = $('#evcost'), mk = $('#evmk');
  if (!cost) return;
  const update = () => {
    const c = parseFloat(cost.value), m = parseFloat(mk.value) || 0;
    if (!(c > 0)) { $('#evout').innerHTML = 'Enter your cost to see margin, a rough expected value, and warnings.'; return; }
    const price = c * (1 + m / 100);
    const profit = (price - c) * t.qty;
    const a = t.anchorUnitPrice;
    const warn = [];
    if (a != null && price > a * 1.05) warn.push(`<div class="callout">Your price (${money(price)}) is ${Math.round((price / a - 1) * 100)}% above the recent winning unit price (${money(a)}). Likely to lose unless you can cut markup.</div>`);
    if (a != null && c > a) warn.push(`<div class="callout">Your cost is above what DLA recently paid. This table is priced below your supply chain.</div>`);
    if (a != null && price < a * 0.7) warn.push(`<div class="callout">Winner's-curse check: you'd be ${Math.round((1 - price / a) * 100)}% under recent winners. Cheap wins are where surprises hide: check first article, packaging, inspection and spec in the PDF before quoting.</div>`);
    if (t.heat === 'incumbent') warn.push(`<div class="callout">Sticky incumbent (${t.winners[0].cage}). They likely know the true cost. Beat them only if you're sure of yours.</div>`);
    const p = t.baselineWinChance;
    $('#evout').innerHTML = `Quote ${money(price)}/${esc(t.ui)} → profit if you win ${money(profit)} on ${fmt(t.qty)} ${esc(t.ui)}.
      ${p != null ? `<br>Rough expected value ≈ ${money(profit * p)} <span class="small">(baseline win chance ${Math.round(p * 100)}% = one of ${t.winners.length} recent winners + you. A placeholder until calibrated on your own wins and losses.)</span>` : ''}
      ${warn.join('')}`;
  };
  cost.oninput = update;
  mk.oninput = update;
  update();
}
function closeDetail() {
  delete P.open;
  const qs = new URLSearchParams(P).toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
  document.querySelectorAll('tbody tr.sel').forEach((tr) => tr.classList.remove('sel'));
}

// ---------- wiring ----------
let debounce;
$('#q').oninput = (e) => { clearTimeout(debounce); debounce = setTimeout(() => setP({ q: e.target.value.trim() }), 200); };
$('#sort').onchange = (e) => setP({ sort: e.target.value === 'new' ? '' : e.target.value });
$('#scrim').onclick = closeDetail;
$('#refresh').onclick = async () => { await fetch('/api/refresh', { method: 'POST' }); pollStatus(); };
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
  if (e.key === 'Escape') { if (!$('#drawer').hidden) closeDetail(); else if (typing) document.activeElement.blur(); }
});

$('#q').value = P.q || '';
load().then(() => { if (P.open) openDetail(P.open); });
pollStatus();
