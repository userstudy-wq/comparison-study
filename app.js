/* Static pairwise study: one continuous run through all sections on a single page.
   State lives in this browser; every answer is also posted to the collector endpoint. */
(async function () {
  const CFG = window.STUDY_CONFIG || {};
  const app = document.getElementById('app');
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const svg = (d, extra = '') => h('span', { html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>` }).firstChild;
  const ICON = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
  };
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const raterId = (() => { let r = store.get('rater_id'); if (!r) { r = rid(); store.set('rater_id', r); } return r; })();
  const DATA = await (await fetch(`study.json?v=${encodeURIComponent(CFG.version || '1')}`)).json();
  const comparisons = (sid) => (CFG.comparisons && (CFG.comparisons[sid] || CFG.comparisons.default)) || DATA.studies[sid].default_comparisons;
  const UA = navigator.userAgent.slice(0, 200);

  /* ---------- collector ---------- */
  async function send(item) {
    if (!CFG.endpoint) return true;
    const body = JSON.stringify({ ...item, site_key: CFG.site_key || '' });
    try {
      const r = await fetch(CFG.endpoint, { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' });
      if (r.ok) { try { const j = await r.json(); if (j && j.ok === false) return false; } catch (e) {} return true; }
      return false;
    } catch (e) {
      try { await fetch(CFG.endpoint, { method: 'POST', body, mode: 'no-cors' }); return true; } catch (e2) { return false; }
    }
  }
  let flushing = null, again = false;
  function flush() {   // one flush at a time; items are removed individually once delivered
    if (flushing) { again = true; return flushing; }
    flushing = (async () => {
      do {
        again = false;
        for (const item of store.get('queue', [])) {
          if (await send(item)) store.set('queue', store.get('queue', []).filter((x) => x.eid !== item.eid));
        }
      } while (again);
    })().finally(() => { flushing = null; });
    return flushing;
  }
  function post(item) { const q = store.get('queue', []); q.push({ eid: rid(), ...item }); store.set('queue', q); return flush(); }
  async function getCounts() {   // per-pair judgment counts across all sections, one request
    if (!CFG.endpoint) return {};
    try { const r = await fetch(`${CFG.endpoint}?action=counts`, { redirect: 'follow' }); const j = await r.json(); return (j && j.counts) || {}; } catch (e) { return {}; }
  }

  /* ---------- sampling ---------- */
  function samplePairs(sid, k, counts) {
    const S = DATA.studies[sid];
    const done = new Set(store.get(`done:${sid}`, []));
    let cands = S.pairs.filter((p) => !done.has(p.id));
    if (!cands.length) cands = S.pairs.slice();
    shuffle(cands);
    cands.sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0));   // stable: keeps the random tie-break
    const chosen = [], prompts = new Set();
    for (const p of cands) { if (prompts.has(p.prompt)) continue; chosen.push(p); prompts.add(p.prompt); if (chosen.length === k) break; }
    for (const p of cands) { if (chosen.length === k) break; if (!chosen.includes(p)) chosen.push(p); }
    return shuffle(chosen);
  }

  async function startSession(ids, plan, raterCode) {
    const counts = await getCounts();
    const slates = [];
    for (const sid of ids) for (const p of samplePairs(sid, comparisons(sid), counts)) {
      const flip = Math.random() < 0.5;
      slates.push({ study: sid, pair: p.id, text: p.text, left: flip ? p.m[1] : p.m[0], right: flip ? p.m[0] : p.m[1], choice: null, seconds: null });
    }
    const sess = { id: rid(), studies: ids, plan, raterCode: raterCode || '', created: Date.now(), i: 0, slates };
    store.set(`session:${sess.id}`, sess); store.set('current_session', sess.id);
    post({ type: 'session_start', session: sess.id, study: ids.join('+'), rater: raterId, rater_code: sess.raterCode, plan, plan_index: 0, n_slates: slates.length, ua: UA });
    location.hash = `s=${sess.id}`;
  }

  /* ---------- intro ---------- */
  function renderIntro(params) {
    const study = params.get('study') || '';
    const plan = study ? '' : (params.get('plan') || 'all');
    const ids = study ? [study] : DATA.plans[plan];
    if (!ids || ids.some((i) => !DATA.studies[i])) { app.replaceChildren(h('div', { class: 'intro' }, h('p', { class: 'muted' }, 'This link is not valid.'))); return; }
    const total = ids.reduce((a, s) => a + comparisons(s), 0);
    const secs = ids.reduce((a, s) => a + comparisons(s) * (DATA.studies[s].media === 'video' ? 14 : 7), 0);
    const cur = store.get('current_session'); const curSess = cur && store.get(`session:${cur}`);
    const resumable = curSess && curSess.i < curSess.slates.length;
    const code = h('input', { type: 'text', id: 'code', maxlength: '32', placeholder: 'e.g. P07', autocomplete: 'off', value: store.get('rater_code', '') });
    const start = h('button', { class: 'btn primary', onclick: async () => { start.disabled = true; start.textContent = 'Preparing…'; store.set('rater_code', code.value.trim()); await startSession(ids, study || plan, code.value.trim()); } }, resumable ? 'Start a new run' : 'Start');
    app.replaceChildren(
      h('div', { class: 'intro' },
        h('div', { class: 'eyebrow' }, 'Research study'),
        h('h1', null, 'Which one do you prefer?'),
        h('p', { class: 'lead' }, 'You will see pairs of AI-generated images or videos made from the same text prompt. Pick the one you prefer, or say you have no preference. There are no right answers; we want your honest impression.'),
        h('div', { class: 'card' },
          h('h2', null, `${total} comparisons, all on one page`),
          h('p', { class: 'muted small' }, `They run straight through in ${ids.length} sections. The question at the top tells you what to judge in each one.`),
          h('ol', { class: 'sections' }, ids.map((s) => h('li', null, DATA.studies[s].label, h('span', { class: 'n' }, comparisons(s))))),
          h('div', { class: 'facts' },
            h('span', null, svg(ICON.clock), `about ${Math.max(1, Math.round(secs / 60))} minutes`),
            h('span', null, svg(ICON.monitor), 'laptop or desktop recommended'),
            h('span', null, svg(ICON.lock), 'answers are anonymous'),
          ),
        ),
        h('div', { class: 'card field' },
          h('label', { for: 'code' }, 'Participant code'),
          code,
          h('p', { class: 'help' }, 'Optional. Enter it only if you were given one.'),
        ),
        h('div', { class: 'actions' },
          resumable ? h('button', { class: 'btn primary', onclick: () => { location.hash = `s=${cur}`; } }, `Resume (${curSess.slates.length - curSess.i} left)`) : null,
          resumable ? h('button', { class: 'btn', onclick: start.onclick }, 'Start a new run') : start,
          !CFG.endpoint ? h('span', { class: 'hint warn' }, 'Collector not configured: answers stay in this browser only.') : null,
        ),
        h('p', { class: 'note' }, 'You can close the tab at any point and continue later by opening the same link in the same browser. Let the videos play before answering.'),
      ),
    );
  }

  /* ---------- rating ---------- */
  function renderSession(id) {
    const sess = store.get(`session:${id}`);
    if (!sess) { app.replaceChildren(h('div', { class: 'intro' }, h('p', { class: 'muted' }, 'This session is not available in this browser. ', h('a', { href: location.pathname + location.search }, 'Start again')))); return; }
    const ids = sess.studies || [sess.study];
    let shownAt = 0, timer = null, tick = null;
    const mediaEl = (m, label) => {
      if (m.endsWith('.mp4')) { const v = h('video', { src: `media/${m}`, poster: `media/${m.slice(0, -4)}.jpg`, muted: true, loop: true, playsinline: true, preload: 'auto', 'aria-label': label }); v.muted = true; v.play().catch(() => {}); return v; }
      return h('img', { src: `media/${m}`, alt: label });
    };
    async function answer(choice) {
      const S = DATA.studies[sess.slates[sess.i].study];
      if (performance.now() - shownAt < (S.min_seconds || 0) * 1000) return;
      const sl = sess.slates[sess.i];
      sl.choice = choice; sl.seconds = (performance.now() - shownAt) / 1000;
      app.querySelectorAll('.choice').forEach((b) => (b.disabled = true));
      const done = store.get(`done:${sl.study}`, []); done.push(sl.pair); store.set(`done:${sl.study}`, done);
      sess.i += 1; store.set(`session:${sess.id}`, sess);
      post({ type: 'judgment', jid: rid(), session: sess.id, study: sl.study, rater: raterId, rater_code: sess.raterCode, position: sess.i - 1, pair: sl.pair, left: sl.left, right: sl.right, choice, seconds: Math.round(sl.seconds * 100) / 100, ua: UA });
      if (sess.i >= sess.slates.length) { store.set('current_session', null); post({ type: 'session_complete', session: sess.id, study: ids.join('+'), rater: raterId, rater_code: sess.raterCode, plan: sess.plan, plan_index: 0, n_slates: sess.slates.length, ua: UA }); }
      render();
    }
    function render() {
      clearTimeout(timer); clearInterval(tick);
      app.replaceChildren();
      if (sess.i >= sess.slates.length) return renderDone();
      const sl = sess.slates[sess.i], total = sess.slates.length, S = DATA.studies[sl.study];
      const section = ids.indexOf(sl.study) + 1;
      const newSection = sess.i === 0 || sess.slates[sess.i - 1].study !== sl.study;
      const btns = [
        h('button', { class: 'choice side-a', disabled: true, onclick: () => answer('left') }, S.choices[0], h('kbd', null, '1')),
        h('button', { class: 'choice', disabled: true, onclick: () => answer('tie') }, S.choices[1], h('kbd', null, '2')),
        h('button', { class: 'choice side-b', disabled: true, onclick: () => answer('right') }, S.choices[2], h('kbd', null, '3')),
      ];
      const lock = h('span', { class: 'lock', 'aria-live': 'polite' });
      const side = (label, m, letter) => h('div', { class: 'side' },
        h('div', { class: 'tag' }, h('span', { class: 'letter' }, letter), label),
        h('div', { class: 'media' }, mediaEl(m, label)));
      app.append(
        h('div', { class: 'topbar' }, h('div', { class: 'in' },
          h('div', { class: 'sec' }, S.label, ids.length > 1 ? h('span', null, ` · section ${section} of ${ids.length}`) : null),
          h('div', { class: 'count' }, h('b', null, sess.i + 1), ` / ${total}`)),
          h('div', { class: 'progress' }, h('i', { style: `width:${(sess.i / total) * 100}%` }))),
        h('div', { class: 'rate' }, h('div', { class: 'stage' },
          newSection && ids.length > 1 ? h('div', { class: 'section-note' }, svg(ICON.info), `Section ${section}: ${S.label}. ${S.media === 'video' ? 'Answers unlock once both videos have played for a few seconds.' : S.task === 'diversity' ? 'Judge the variety across the whole set, not any single image.' : ''}`) : null,
          h('div', { class: 'ask' }, h('div', { class: 'q' }, S.question), h('div', { class: 'p' }, 'Prompt: ', h('b', null, sl.text))),
          h('div', { class: `pair ${S.layout === 'stack' ? 'stack' : ''}` }, side(S.side_labels[0], sl.left, 'A'), side(S.side_labels[1], sl.right, 'B')),
        )),
        h('div', { class: 'actionbar' }, h('div', { class: 'in' }, h('div', { class: 'choices' }, btns), lock, h('div', { class: 'instr' }, S.instructions))),
      );
      shownAt = performance.now();
      const wait = Math.round((S.min_seconds || 0) * 1000);
      const unlock = () => { btns.forEach((b) => (b.disabled = false)); lock.replaceChildren(); };
      if (wait > 0) {
        const left = () => Math.max(0, Math.ceil((wait - (performance.now() - shownAt)) / 1000));
        const label = () => (S.media === 'video' ? `Watch both videos · ${left()}s` : `${left()}s`);
        lock.replaceChildren(h('span', { class: 'ring' }), label());
        tick = setInterval(() => { lock.lastChild.textContent = label(); }, 250);
        timer = setTimeout(() => { clearInterval(tick); unlock(); }, wait);
      } else unlock();
      window.scrollTo(0, 0);
      const nx = sess.slates[sess.i + 1];
      if (nx) for (const m of [nx.left, nx.right]) { if (!m.endsWith('.mp4')) { const im = new Image(); im.src = `media/${m}`; } else { fetch(`media/${m}`, { headers: { Range: 'bytes=0-262143' } }).catch(() => {}); } }
    }
    function renderDone() {
      const pending = store.get('queue', []).length;
      app.append(h('div', { class: 'done' },
        h('div', { class: 'check' }, svg(ICON.check)),
        h('h1', null, 'All done. Thank you!'),
        h('p', { class: 'muted' }, 'Your completion code:'),
        h('div', { class: 'code' }, sess.id.slice(0, 6).toUpperCase()),
        pending ? h('p', { class: 'hint warn' }, `${pending} answers are still being sent. Please keep this tab open for a moment.`) : h('p', { class: 'muted small' }, 'You can close this tab now.')));
      flush().then(() => { if (pending) render(); });
    }
    document.onkeydown = (e) => { const map = { '1': 'left', '2': 'tie', '3': 'right' }; const b = app.querySelector('.choice'); if (map[e.key] && b && !b.disabled) answer(map[e.key]); };
    window.STUDY = { session: sess, answer };
    render();
  }

  function route() {
    const params = new URLSearchParams(location.search);          // ?plan=all / ?study=…
    for (const [k, v] of new URLSearchParams(location.hash.slice(1))) params.set(k, v);   // #s=<session>
    if (params.get('s')) renderSession(params.get('s')); else renderIntro(params);
  }
  window.addEventListener('hashchange', route);
  flush();
  route();
})();
