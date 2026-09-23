/* Pairwise comparison study. Opening the link goes straight to the first comparison.
   Comparisons are grouped into blocks by question (image quality, image diversity, video quality,
   video diversity); block order is random per rater and sources are mixed inside each block.
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
  const svg = (d) => h('span', { html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>` }).firstChild;
  const CHECK = '<path d="M5 12l5 5L20 7"/>';
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const SCHEMA = 3;
  const raterId = (() => { let r = store.get('rater_id'); if (!r) { r = rid(); store.set('rater_id', r); } return r; })();
  const DATA = await (await fetch(CFG.version && /^\d+$/.test(CFG.version) ? `study.${CFG.version}.json` : 'study.json')).json();
  const params = new URLSearchParams(location.search);
  const plan = DATA.plans[params.get('plan')] ? params.get('plan') : 'all';
  const raterCode = (params.get('code') || '').slice(0, 32);   // optional ?code=P07 in the link
  const comparisons = (sid) => (CFG.comparisons && (CFG.comparisons[sid] || CFG.comparisons.default)) || DATA.studies[sid].default_comparisons;
  const UA = navigator.userAgent.slice(0, 200);
  const CUR = `current:${plan}`, LAST = `last_done:${plan}`;

  /* ---------- collector ----------
     Answers go into a queue in localStorage and are sent in the background, so raters never wait.
     With collector version >= 2 the whole queue goes in one request (the script de-duplicates);
     with an older script, up to four single answers are sent in parallel. Failed sends are retried. */
  const withTimeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
  let serverVersion = null;   // null = not known yet
  async function detectServer() {
    if (serverVersion !== null) return serverVersion;
    try { const j = await (await fetch(`${CFG.endpoint}?action=version`, { redirect: 'follow', signal: withTimeout(15000) })).json(); serverVersion = (j && j.version) || 1; }
    catch (e) { return 1; }   // unknown for now: behave like the old script, ask again next time
    return serverVersion;
  }
  async function send(payload) {
    const body = JSON.stringify({ ...payload, site_key: CFG.site_key || '' });
    try {
      const r = await fetch(CFG.endpoint, { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: withTimeout(45000) });
      if (!r.ok) return false;
      try { const j = await r.json(); return !(j && j.ok === false); } catch (e) { return true; }
    } catch (e) {
      try { await fetch(CFG.endpoint, { method: 'POST', body, mode: 'no-cors' }); return true; } catch (e2) { return false; }
    }
  }
  const dropSent = (items) => { const ids = new Set(items.map((x) => x.eid)); store.set('queue', store.get('queue', []).filter((x) => !ids.has(x.eid))); };
  let flushing = null, again = false, retry = null;
  function flush() {
    if (!CFG.endpoint) return Promise.resolve();   // not configured: keep answers in the browser, never drop them
    if (flushing) { again = true; return flushing; }
    flushing = (async () => {
      let failed = false;
      do {
        again = false;
        let q = store.get('queue', []);
        while (q.length && !failed) {
          if ((await detectServer()) >= 2) {
            const chunk = q.slice(0, 200);
            if (await send({ batch: chunk })) dropSent(chunk); else failed = true;
          } else {
            const chunk = q.slice(0, 4);
            const res = await Promise.all(chunk.map((it) => send(it)));
            dropSent(chunk.filter((_, k) => res[k]));
            failed = res.some((x) => !x);
          }
          q = store.get('queue', []);
        }
      } while (again && !failed);
    })().finally(() => {
      flushing = null;
      clearTimeout(retry);
      if (store.get('queue', []).length) retry = setTimeout(flush, 8000);   // retry until everything is delivered
    });
    return flushing;
  }
  function post(item) { const q = store.get('queue', []); q.push({ eid: rid(), ...item }); store.set('queue', q); flush(); }
  window.addEventListener('pagehide', () => {   // tab closing: hand the rest to the browser (safe: the v2 script skips duplicates)
    const q = store.get('queue', []);
    if (q.length && CFG.endpoint && serverVersion >= 2 && navigator.sendBeacon)
      navigator.sendBeacon(CFG.endpoint, new Blob([JSON.stringify({ batch: q.slice(0, 200), site_key: CFG.site_key || '' })], { type: 'text/plain;charset=utf-8' }));
  });
  async function getCounts() {   // per-pair judgment counts, one request; never hold up the first comparison for long
    if (!CFG.endpoint) return {};
    try { const r = await fetch(`${CFG.endpoint}?action=counts`, { redirect: 'follow', signal: withTimeout(4000) }); const j = await r.json(); if (j && j.version) serverVersion = j.version; return (j && j.counts) || {}; } catch (e) { return {}; }
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
    return chosen;
  }
  async function newSession() {
    const counts = await getCounts();
    const blocks = {};
    for (const sid of DATA.plans[plan]) {
      const S = DATA.studies[sid], key = `${S.media}:${S.task}`;
      for (const p of samplePairs(sid, comparisons(sid), counts)) {
        const flip = Math.random() < 0.5;
        (blocks[key] = blocks[key] || []).push({ study: sid, block: key, pair: p.id, text: p.text, left: flip ? p.m[1] : p.m[0], right: flip ? p.m[0] : p.m[1], choice: null, seconds: null });
      }
    }
    const slates = shuffle(Object.values(blocks)).flatMap((b) => shuffle(b));
    const sess = { v: SCHEMA, id: rid(), plan, raterCode, created: Date.now(), i: 0, slates };
    store.set(`session:${sess.id}`, sess); store.set(CUR, sess.id);
    post({ type: 'session_start', session: sess.id, study: plan, rater: raterId, rater_code: raterCode, plan, plan_index: 0, n_slates: slates.length, ua: UA });
    return sess;
  }
  const valid = (s) => s && s.v === SCHEMA && Array.isArray(s.slates) && s.slates.length && s.slates.every((sl) => DATA.studies[sl.study] && sl.left && sl.right);

  /* ---------- rating ---------- */
  let shownAt = 0;
  function mediaEl(m, label) {
    if (m.endsWith('.mp4')) {
      const v = h('video', { src: `media/${m}`, poster: `media/${m.slice(0, -4)}.jpg`, muted: true, loop: true, playsinline: true, preload: 'auto', 'aria-label': label });
      v.muted = true;
      const tryPlay = () => v.play().catch(() => { v.controls = true; });   // autoplay blocked: show native controls
      tryPlay(); v.addEventListener('canplay', tryPlay, { once: true }); v.addEventListener('click', () => { if (v.paused) v.play().catch(() => {}); });
      return v;
    }
    return h('img', { src: `media/${m}`, alt: label });
  }

  function run(sess) {
    async function answer(choice) {
      const sl = sess.slates[sess.i];
      if (!sl || sl.choice) return;
      sl.choice = choice; sl.seconds = (performance.now() - shownAt) / 1000;
      app.querySelectorAll('.choice').forEach((b) => (b.disabled = true));
      const done = store.get(`done:${sl.study}`, []); done.push(sl.pair); store.set(`done:${sl.study}`, done);
      sess.i += 1; store.set(`session:${sess.id}`, sess);
      post({ type: 'judgment', jid: rid(), session: sess.id, study: sl.study, rater: raterId, rater_code: sess.raterCode, position: sess.i - 1, pair: sl.pair, left: sl.left, right: sl.right, choice, seconds: Math.round(sl.seconds * 100) / 100, ua: UA });
      if (sess.i >= sess.slates.length) {
        store.set(CUR, null); store.set(LAST, sess.id);
        post({ type: 'session_complete', session: sess.id, study: plan, rater: raterId, rater_code: sess.raterCode, plan, plan_index: 0, n_slates: sess.slates.length, ua: UA });
      }
      render();
    }
    function render() {
      if (sess.i >= sess.slates.length) return renderDone(sess);
      const sl = sess.slates[sess.i], total = sess.slates.length, S = DATA.studies[sl.study];
      const newQuestion = sess.i > 0 && sess.slates[sess.i - 1].block !== sl.block;
      const helper = S.task === 'quality' ? '' : S.instructions.replace(/\s*Choose A, B, or No preference\.\s*/, ' ').trim();
      const btns = [
        h('button', { class: 'choice side-a', onclick: () => answer('left') }, S.choices[0], h('kbd', null, '1')),
        h('button', { class: 'choice', onclick: () => answer('tie') }, S.choices[1], h('kbd', null, '2')),
        h('button', { class: 'choice side-b', onclick: () => answer('right') }, S.choices[2], h('kbd', null, '3')),
      ];
      const side = (label, m, letter) => h('div', { class: 'side' },
        h('div', { class: 'tag' }, h('span', { class: 'letter' }, letter), label),
        h('div', { class: 'media' }, mediaEl(m, label)));
      app.replaceChildren(
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': sess.i }, h('i', { style: `width:${(sess.i / total) * 100}%` })),
        h('div', { class: 'rate' }, h('div', { class: 'stage' },
          h('div', { class: 'ask' },
            h('div', { class: 'q' }, newQuestion ? h('span', { class: 'newq' }, 'New question') : null, S.question),
            h('div', { class: 'p' }, 'Prompt: ', h('b', null, sl.text)),
            helper ? h('div', { class: 'helper' }, helper) : null),
          h('div', { class: `pair ${S.layout === 'stack' ? 'stack' : ''}` }, side(S.side_labels[0], sl.left, 'A'), side(S.side_labels[1], sl.right, 'B')),
        )),
        h('div', { class: 'actionbar' }, h('div', { class: 'in' },
          h('div', { class: 'count' }, h('b', null, sess.i + 1), ` / ${total}`),
          h('div', { class: 'choices' }, btns),
          h('span'),
          !CFG.endpoint ? h('div', { class: 'testmode' }, 'Test mode: answers are not being saved yet.') : null)),
      );
      shownAt = performance.now();
      window.scrollTo(0, 0);
      const nx = sess.slates[sess.i + 1];
      if (nx) for (const m of [nx.left, nx.right]) { if (!m.endsWith('.mp4')) { const im = new Image(); im.src = `media/${m}`; } else { fetch(`media/${m}`, { headers: { Range: 'bytes=0-262143' } }).catch(() => {}); } }
    }
    document.onkeydown = (e) => { const map = { '1': 'left', '2': 'tie', '3': 'right' }; const b = app.querySelector('.choice'); if (map[e.key] && b && !b.disabled) answer(map[e.key]); };
    window.STUDY = { session: sess, answer, render };
    render();
  }

  function renderDone(sess) {
    document.onkeydown = null;
    const status = h('p', { class: 'muted small' });
    const update = () => {
      const n = store.get('queue', []).length;
      status.className = n ? 'hint warn' : 'muted small';
      status.textContent = n ? `Saving your answers (${n} left). Please keep this tab open for a moment.` : 'All answers are saved. You can close this tab now.';
      return n;
    };
    app.replaceChildren(h('div', { class: 'done' },
      h('div', { class: 'check' }, svg(CHECK)),
      h('h1', null, 'All done. Thank you!'),
      h('p', { class: 'muted' }, 'Your completion code:'),
      h('div', { class: 'code' }, sess.id.slice(0, 6).toUpperCase()),
      status,
      h('p', { class: 'again' }, h('button', { class: 'btn', onclick: async (e) => { clearInterval(poll); e.target.disabled = true; e.target.textContent = 'Preparing…'; run(await newSession()); } }, 'Do another round'))));
    const poll = setInterval(() => { if (!update() || !app.contains(status)) clearInterval(poll); }, 700);
    update(); flush();
  }

  /* ---------- start: resume, show completion, or go straight to the first comparison ---------- */
  flush();
  const cur = store.get(`session:${store.get(CUR)}`);
  if (valid(cur) && cur.i < cur.slates.length) return run(cur);
  const last = store.get(`session:${store.get(LAST)}`);
  if (valid(last) && last.i >= last.slates.length) return renderDone(last);
  run(await newSession());
})();
