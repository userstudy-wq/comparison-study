/* Image and video comparison study: one link, two parts in random order per rater.
     Part "diversity": Which of the two sets is more diverse?               (image grids, video strips)
     Part "quality":   Which has better visual quality? + Which matches the prompt better?
   Each part: instructions -> practice with feedback -> forced A/B comparisons (image and video blocks).
   ?study=diversity or ?study=quality runs a single part. State lives in this browser; answers are
   queued in localStorage and sent to the collector in the background. */
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
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const SCHEMA = 5;
  // Launch marker: data saved under an earlier marker (test runs, unsent test answers) is discarded, never sent.
  if (CFG.epoch && store.get('epoch') !== CFG.epoch) {
    try { for (const k of Object.keys(localStorage)) if (k !== 'rater_id') localStorage.removeItem(k); } catch (e) {}
    store.set('epoch', CFG.epoch);
  }
  const raterId = (() => { let r = store.get('rater_id'); if (!r) { r = rid(); store.set('rater_id', r); } return r; })();
  const DATA = await (await fetch(CFG.version && /^\d+$/.test(CFG.version) ? `study.${CFG.version}.json` : 'study.json')).json();
  const params = new URLSearchParams(location.search);
  const only = ['diversity', 'quality'].includes(params.get('study')) ? params.get('study') : null;
  const PARTS = only ? [only] : (() => { let o = store.get('order'); if (!o) { o = Math.random() < 0.5 ? ['diversity', 'quality'] : ['quality', 'diversity']; store.set('order', o); } return o; })();
  const raterCode = (params.get('code') || '').slice(0, 32);   // optional ?code=P07 in the link
  const comparisons = (sid) => (CFG.comparisons && (CFG.comparisons[sid] || CFG.comparisons.default)) || DATA.studies[sid].default_comparisons;
  const UA = navigator.userAgent.slice(0, 200);

  /* ---------- wording ---------- */
  const UI = {
    diversity: {
      name: 'Diversity',
      title: 'Which of the two sets is more diverse?',
      intro: 'You will see two sets of AI-generated images (9 per set) or short videos (5 per set), all made from the same text prompt. Choose the set whose items differ more from each other.',
      rules: [
        ['What counts as diversity.', 'Diversity can be in identity, background, camera pose, lighting and so on.'],
        ['Judge diversity only.', 'We are not asking which set looks better. A plainer or blurrier set can still be the more diverse one.'],
        ['Off-prompt items add nothing.', 'Pictures that do not show what the prompt asks for (a cat when the prompt says dog), or broken pictures, do not count as diversity.'],
        ['Videos.', 'Compare the five clips of a set with each other. How much a single clip moves does not matter.'],
      ],
      asks: ['Which of the two sets is more diverse?'],
      questions: ['diversity'],
      secsPer: { image: 8, video: 12 },
    },
    quality: {
      name: 'Quality',
      title: 'Which one is better?',
      intro: 'You will see two AI-generated images or two short videos made from the same text prompt, and answer two separate questions about them.',
      rules: [
        ['Visual quality.', 'Which looks better as an image or video: sharp, realistic, free of artifacts and of distorted objects, faces or hands. For videos, also smooth motion without flicker or morphing. Ignore the prompt for this question.'],
        ['Prompt match.', 'Which shows what the prompt describes more accurately: the right objects, how many, their colors and positions. Ignore visual quality for this question.'],
      ],
      asks: ['Which image or video has better visual quality?', 'Which image or video matches the prompt better?'],
      questions: ['quality', 'alignment'],
      secsPer: { image: 11, video: 15 },
    },
  };
  const Q = {
    diversity: (m) => ({ text: 'Which of the two sets is more diverse?', help: m === 'video' ? 'Diversity in identity, background, camera pose, lighting and so on. Compare the five clips with each other; not quality.' : 'Diversity in identity, background, camera pose, lighting and so on. Not quality; off-prompt pictures add nothing.' }),
    quality: (m) => ({ text: `Which ${m} has better visual quality?`, help: m === 'video' ? 'Sharpness, realism, artifacts, smooth motion. Ignore the prompt.' : 'Sharpness, realism, artifacts, distortions. Ignore the prompt.' }),
    alignment: (m) => ({ text: `Which ${m} matches the prompt better?`, help: 'Right objects, how many, colors, positions. Ignore visual quality.' }),
  };

  /* ---------- collector ----------
     With collector version >= 2 the whole queue goes in one request (the script skips duplicates);
     with an older script, up to four single answers are sent in parallel. Failed sends are retried. */
  const withTimeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
  let serverVersion = null;
  async function detectServer() {
    if (serverVersion !== null) return serverVersion;
    try { const j = await (await fetch(`${CFG.endpoint}?action=version`, { redirect: 'follow', signal: withTimeout(15000) })).json(); serverVersion = (j && j.version) || 1; }
    catch (e) { return 1; }
    return serverVersion;
  }
  async function send(payload) {   // true only when the script confirms it; anything else is retried
    const body = JSON.stringify({ ...payload, site_key: CFG.site_key || '' });
    try {
      const r = await fetch(CFG.endpoint, { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: withTimeout(45000) });
      const j = await r.json();
      if (j && j.version) serverVersion = j.version;
      return !!(j && j.ok === true);
    } catch (e) {
      try { await fetch(CFG.endpoint, { method: 'POST', body, mode: 'no-cors' }); } catch (e2) {}
      return false;
    }
  }
  const dropSent = (items) => { const ids = new Set(items.map((x) => x.eid)); store.set('queue', store.get('queue', []).filter((x) => !ids.has(x.eid))); };
  let flushing = null, again = false, retry = null;
  function flush() {
    if (!CFG.endpoint) return Promise.resolve();
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
      if (store.get('queue', []).length) retry = setTimeout(flush, 8000);
    });
    return flushing;
  }
  function post(item) { const q = store.get('queue', []); q.push({ eid: rid(), ...item }); store.set('queue', q); flush(); }
  window.addEventListener('pagehide', () => {
    const q = store.get('queue', []);
    if (q.length && CFG.endpoint && serverVersion >= 2 && navigator.sendBeacon)
      navigator.sendBeacon(CFG.endpoint, new Blob([JSON.stringify({ batch: q.slice(0, 200), site_key: CFG.site_key || '' })], { type: 'text/plain;charset=utf-8' }));
  });
  async function getCounts() {
    if (!CFG.endpoint) return {};
    try { const r = await fetch(`${CFG.endpoint}?action=counts`, { redirect: 'follow', signal: withTimeout(8000) }); const j = await r.json(); if (j && j.version) serverVersion = j.version; return (j && j.counts) || {}; } catch (e) { return {}; }
  }

  /* ---------- sessions (one per part) ---------- */
  const practiceOf = (plan) => (DATA.practice || {})[plan] || [];
  const totalOf = (plan) => DATA.plans[plan].reduce((a, sid) => a + comparisons(sid), 0);
  const secsOf = (plan) => DATA.plans[plan].reduce((a, sid) => a + comparisons(sid) * UI[plan].secsPer[DATA.studies[sid].media], 0) + practiceOf(plan).length * 25;
  const minutes = (plans) => { const m = plans.reduce((a, p) => a + secsOf(p), 0) / 60; return m > 12 ? Math.round(m / 5) * 5 : Math.max(1, Math.round(m)); };
  const valid = (s, plan) => s && s.v === SCHEMA && s.plan === plan && Array.isArray(s.slates) && s.slates.length && s.slates.every((sl) => DATA.studies[sl.study] && sl.left && sl.right);
  const active = (plan) => { const s = store.get(`session:${store.get(`current:${plan}`)}`); return valid(s, plan) && s.i < s.slates.length ? s : null; };
  const finished = (plan) => { const s = store.get(`session:${store.get(`last_done:${plan}`)}`); return valid(s, plan) && s.i >= s.slates.length ? s : null; };

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
  async function newSession(plan) {
    const counts = await getCounts();
    const blocks = {};
    for (const sid of DATA.plans[plan]) {
      const S = DATA.studies[sid];
      for (const p of samplePairs(sid, comparisons(sid), counts)) {
        const flip = Math.random() < 0.5;
        (blocks[S.media] = blocks[S.media] || []).push({ study: sid, block: S.media, pair: p.id, text: p.text, left: flip ? p.m[1] : p.m[0], right: flip ? p.m[0] : p.m[1] });
      }
    }
    const slates = shuffle(Object.values(blocks)).flatMap((b) => shuffle(b));
    const sess = { v: SCHEMA, id: rid(), plan, part: PARTS.indexOf(plan), raterCode, created: Date.now(), phase: 'practice', p: 0, i: 0, slates };
    store.set(`session:${sess.id}`, sess); store.set(`current:${plan}`, sess.id);
    post({ type: 'session_start', session: sess.id, study: plan, rater: raterId, rater_code: raterCode, plan: PARTS.join('>'), plan_index: sess.part, n_slates: slates.length, ua: UA });
    return sess;
  }

  /* ---------- shared bits ---------- */
  const partLabel = (plan) => (PARTS.length > 1 ? `Part ${PARTS.indexOf(plan) + 1} of ${PARTS.length}: ${UI[plan].name}` : UI[plan].name);
  const rulesList = (plan) => h('ol', { class: 'rules' }, UI[plan].rules.map(([b, t]) => h('li', null, h('strong', null, b), ' ', t)));
  function page(...kids) { document.onkeydown = null; delete document.body.dataset.mode; window.STUDY = null; app.replaceChildren(h('main', { class: 'doc' }, ...kids)); window.scrollTo(0, 0); }
  const testNote = () => (!CFG.endpoint ? h('p', { class: 'warn' }, 'Test mode: answers are not being saved.') : null);

  function showRules(plan) {
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === box) box.remove(); } },
      h('div', { class: 'modal-body' }, h('h2', null, UI[plan].title), h('p', null, UI[plan].intro), rulesList(plan),
        h('button', { class: 'btn', onclick: () => box.remove() }, 'Back to the comparison')));
    document.body.append(box);
  }

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

  /* ---------- pages ---------- */
  function renderOverview() {
    const start = h('button', { class: 'btn', onclick: () => { store.set('seen_overview', true); route(); } }, 'Begin');
    page(
      h('h1', null, 'Image and video comparison study'),
      h('p', { class: 'lede' }, `Thank you for taking part. You will compare pairs of AI-generated images and short videos made from the same text prompt, and choose between them. The study has ${PARTS.length} parts and takes about ${minutes(PARTS)} minutes.`),
      h('table', { class: 'plan' }, h('tbody', null, PARTS.map((p, k) => h('tr', null,
        h('td', { class: 'num' }, `Part ${k + 1}`),
        h('td', null, h('strong', null, UI[p].name), h('ul', { class: 'asks' }, UI[p].asks.map((q) => h('li', null, q)))))))),
      h('p', null, 'Each part starts with a short explanation and a few practice examples that show you what we mean. Please use a laptop or desktop computer.'),
      h('p', { class: 'fine' }, 'Your answers are anonymous. You can close the tab at any point and continue later by opening the same link in the same browser.'),
      h('div', { class: 'actions' }, start, testNote()),
    );
  }

  function renderPartIntro(plan) {
    const k = PARTS.indexOf(plan);
    const start = h('button', { class: 'btn', onclick: async () => { start.disabled = true; start.textContent = 'Preparing…'; go(await newSession(plan)); } }, 'Start the practice');
    page(
      k > 0 ? h('p', { class: 'notice' }, `Part ${k} is finished. Thank you. Take a short break if you like.`) : null,
      h('p', { class: 'kicker' }, partLabel(plan)),
      h('h1', null, UI[plan].title),
      h('p', { class: 'lede' }, UI[plan].intro),
      rulesList(plan),
      h('p', null, `You start with a few practice examples with feedback, then ${totalOf(plan)} comparisons without feedback. Answer with the buttons or the number keys shown next to them.`),
      h('div', { class: 'actions' }, start, testNote()),
    );
  }

  function renderInterlude(sess) {
    const startMain = () => { sess.phase = 'main'; store.set(`session:${sess.id}`, sess); go(sess); };
    page(
      h('p', { class: 'kicker' }, partLabel(sess.plan)),
      h('h1', null, 'Practice done'),
      h('p', { class: 'lede' }, `Now the ${sess.slates.length} comparisons that count. The instructions stay the same; there is no feedback from here on. Go with your first impression.`),
      rulesList(sess.plan),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: startMain }, 'Start the comparisons')),
    );
    document.onkeydown = (e) => { if (e.key === 'Enter') startMain(); };
  }

  /* One comparison screen, used for practice (with feedback) and for the real comparisons. */
  function renderSlate(sess, item, isPractice) {
    const plan = sess.plan, qs = UI[plan].questions;
    const practice = practiceOf(plan);
    const media = isPractice ? item.media : DATA.studies[item.study].media;
    const layout = isPractice ? item.layout : DATA.studies[item.study].layout;
    const chosen = {}, times = {}, firstTry = {}, attempts = {};
    const shownAt = performance.now();
    let locked = false;
    const total = isPractice ? practice.length : sess.slates.length;
    const index = isPractice ? sess.p : sess.i;
    const panel = (m, k) => h('figure', { class: 'panel' }, h('figcaption', null, k), h('div', { class: 'media' }, mediaEl(m, `${k}`)));
    const feedback = h('div', { class: 'feedback', 'aria-live': 'polite' });
    const next = h('button', { class: 'btn next', hidden: true, onclick: () => advancePractice() }, sess.p + 1 < practice.length ? 'Next example' : 'Finish the practice');

    const rows = qs.map((q, qi) => {
      const t = Q[q](media);
      const keys = qi === 0 ? ['1', '2'] : ['3', '4'];
      const btnA = h('button', { class: 'pick', onclick: () => pick(q, 'left'), 'aria-label': `${t.text} A` }, 'A', h('kbd', null, keys[0]));
      const btnB = h('button', { class: 'pick', onclick: () => pick(q, 'right'), 'aria-label': `${t.text} B` }, 'B', h('kbd', null, keys[1]));
      const row = h('div', { class: 'qrow' }, h('div', { class: 'qtext' }, h('p', { class: 'q' }, t.text), h('p', { class: 'qhelp' }, t.help)), h('div', { class: 'qbtns' }, btnA, btnB));
      return { q, row, btnA, btnB, keys };
    });
    const rowOf = (q) => rows.find((x) => x.q === q);
    const mark = (r) => { r.btnA.classList.toggle('on', chosen[r.q] === 'left'); r.btnB.classList.toggle('on', chosen[r.q] === 'right'); };

    function pick(q, side) {
      if (locked) return;
      const r = rowOf(q);
      if (isPractice) {
        if (r.row.classList.contains('right')) return;
        attempts[q] = (attempts[q] || 0) + 1;
        const correct = item.answers[q] === side;
        if (!(q in firstTry)) firstTry[q] = correct;
        chosen[q] = side; mark(r);
        r.row.classList.toggle('right', correct); r.row.classList.toggle('wrong', !correct);
        const old = feedback.querySelector(`[data-q="${q}"]`); if (old) old.remove();
        feedback.append(h('p', { class: `fb ${correct ? 'ok' : 'no'}`, 'data-q': q },
          qs.length > 1 ? h('span', { class: 'fbq' }, `${Q[q](media).text} `) : null,
          h('strong', null, correct ? 'Correct. ' : 'Not quite. '), item.explain[q], correct ? '' : ' Try the other one.'));
        if (correct) { r.btnA.disabled = side !== 'left'; r.btnB.disabled = side !== 'right'; }
        if (qs.every((x) => rowOf(x).row.classList.contains('right'))) { next.hidden = false; next.focus(); }
        return;
      }
      chosen[q] = side; times[q] = (performance.now() - shownAt) / 1000; mark(r);
      if (qs.every((x) => chosen[x])) { locked = true; setTimeout(commit, 220); }
    }
    function commit() {
      const sl = sess.slates[sess.i];
      for (const q of qs) post({ type: 'judgment', jid: rid(), session: sess.id, study: `${sl.study}:${q}`, rater: raterId, rater_code: sess.raterCode, position: sess.i, pair: sl.pair, left: sl.left, right: sl.right, choice: chosen[q], seconds: Math.round(times[q] * 100) / 100, ua: UA });
      const done = store.get(`done:${sl.study}`, []); done.push(sl.pair); store.set(`done:${sl.study}`, done);
      sess.i += 1; store.set(`session:${sess.id}`, sess);
      if (sess.i >= sess.slates.length) {
        store.set(`current:${plan}`, null); store.set(`last_done:${plan}`, sess.id);
        post({ type: 'session_complete', session: sess.id, study: plan, rater: raterId, rater_code: sess.raterCode, plan: PARTS.join('>'), plan_index: sess.part, n_slates: sess.slates.length, ua: UA });
      }
      go(sess);
    }
    function advancePractice() {
      post({ type: `practice:${item.id}`, session: sess.id, study: item.id, rater: raterId, rater_code: sess.raterCode, plan: qs.map((q) => `${q}=${firstTry[q] ? 'right' : 'wrong'}`).join(' '), plan_index: qs.reduce((a, q) => a + (attempts[q] || 1) - 1, 0), n_slates: 0, ua: UA });
      sess.p += 1; if (sess.p >= practice.length) sess.phase = 'interlude';
      store.set(`session:${sess.id}`, sess); go(sess);
    }

    document.body.dataset.mode = 'rate';
    app.replaceChildren(
      h('header', { class: 'bar-top' },
        h('span', { class: 'where' }, partLabel(plan), isPractice ? h('span', { class: 'tag' }, 'Practice') : null),
        h('span', { class: 'count' }, isPractice ? `example ${index + 1} of ${total}` : `${index + 1} / ${total}`),
        h('button', { class: 'textbtn', onclick: () => showRules(plan) }, 'Instructions'),
        h('span', { class: 'line', style: `width:${(index / total) * 100}%` })),
      h('div', { class: 'stage' },
        h('p', { class: 'prompt' }, h('span', { class: 'label' }, 'Prompt'), h('span', { class: 'text' }, item.text)),
        h('div', { class: `pair ${layout === 'stack' ? 'stack' : ''}` }, panel(item.left, 'A'), panel(item.right, 'B'))),
      h('footer', { class: 'bar-bottom' }, h('div', { class: 'inner' },
        isPractice ? feedback : null,
        rows.map((r) => r.row),
        isPractice ? h('div', { class: 'nextrow' }, next) : null,
        testNote())),
    );
    const bar = app.querySelector('.bar-bottom');
    new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`)).observe(bar);
    document.onkeydown = (e) => {
      const modal = document.querySelector('.modal');
      if (modal) { if (e.key === 'Escape' || e.key === 'Enter') modal.remove(); return; }
      if (isPractice && e.key === 'Enter' && !next.hidden) return advancePractice();
      for (const r of rows) { if (e.key === r.keys[0]) pick(r.q, 'left'); if (e.key === r.keys[1]) pick(r.q, 'right'); }
    };
    window.scrollTo(0, 0);
    if (!isPractice) {
      const nx = sess.slates[sess.i + 1];
      if (nx) for (const m of [nx.left, nx.right]) { if (!m.endsWith('.mp4')) { const im = new Image(); im.src = `media/${m}`; } else { fetch(`media/${m}`, { headers: { Range: 'bytes=0-262143' } }).catch(() => {}); } }
    }
    window.STUDY = { session: sess, pick, item, isPractice, advancePractice, go, route };
  }

  function renderDone() {
    let code = store.get('completion_code');
    if (!code) { code = rid().slice(0, 6).toUpperCase(); store.set('completion_code', code); }
    const status = h('p', { class: 'fine' });
    const update = () => {
      const n = store.get('queue', []).length;
      status.className = n ? 'warn' : 'fine';
      status.textContent = n ? `Saving your answers (${n} left). Please keep this tab open for a moment.` : 'All your answers are saved. You can close this tab.';
      return n;
    };
    page(
      h('h1', null, 'Thank you'),
      h('p', { class: 'lede' }, 'That was the last comparison. Your help makes this research possible.'),
      h('p', null, 'Completion code ', h('code', { class: 'code' }, code)),
      status,
    );
    const poll = setInterval(() => { if (!update() || !app.contains(status)) clearInterval(poll); }, 700);
    update(); flush();
  }

  function go(sess) {
    const practice = practiceOf(sess.plan);
    if (sess.phase === 'practice' && sess.p < practice.length) return renderSlate(sess, practice[sess.p], true);
    if (sess.phase === 'practice' || sess.phase === 'interlude') return renderInterlude(sess);
    if (sess.i < sess.slates.length) return renderSlate(sess, sess.slates[sess.i], false);
    route();
  }

  function route() {
    const plan = PARTS.find((p) => !finished(p));
    if (!plan) return renderDone();
    const s = active(plan);
    if (s) return go(s);
    if (PARTS.length > 1 && PARTS.indexOf(plan) === 0 && !store.get('seen_overview')) return renderOverview();
    renderPartIntro(plan);
  }

  document.title = 'Comparison study';
  flush();
  route();
})();
