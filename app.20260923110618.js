/* Pairwise comparison studies: forced A/B choice, one link per study.
     ?study=diversity (default)  Which set has more variety?          (image + video sets)
     ?study=quality              Which has better visual quality?  +  Which matches the prompt better?
   Flow: explanation page -> warm-up examples with feedback -> real comparisons -> thank-you.
   Real comparisons come in blocks (images, videos), block order random per rater, sources mixed
   inside each block. State lives in this browser; answers are sent to the collector in the background. */
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
  const ICON = { check: '<path d="M5 12l5 5L20 7"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>' };
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const SCHEMA = 4;
  // Launch marker: data saved under an earlier marker (test runs, unsent test answers) is discarded, never sent.
  if (CFG.epoch && store.get('epoch') !== CFG.epoch) {
    try { for (const k of Object.keys(localStorage)) if (k !== 'rater_id') localStorage.removeItem(k); } catch (e) {}
    store.set('epoch', CFG.epoch);
  }
  const raterId = (() => { let r = store.get('rater_id'); if (!r) { r = rid(); store.set('rater_id', r); } return r; })();
  const DATA = await (await fetch(CFG.version && /^\d+$/.test(CFG.version) ? `study.${CFG.version}.json` : 'study.json')).json();
  const params = new URLSearchParams(location.search);
  const asked = params.get('study') || params.get('plan');
  const plan = ['diversity', 'quality'].includes(asked) ? asked : 'diversity';
  const other = plan === 'diversity' ? 'quality' : 'diversity';
  const raterCode = (params.get('code') || '').slice(0, 32);   // optional ?code=P07 in the link
  const comparisons = (sid) => (CFG.comparisons && (CFG.comparisons[sid] || CFG.comparisons.default)) || DATA.studies[sid].default_comparisons;
  const UA = navigator.userAgent.slice(0, 200);
  const CUR = `current:${plan}`, LAST = `last_done:${plan}`;
  const linkTo = (p) => `${location.pathname}?study=${p}${raterCode ? `&code=${encodeURIComponent(raterCode)}` : ''}`;

  /* ---------- wording ---------- */
  const UI = {
    diversity: {
      title: 'Which set has more variety?',
      lead: 'Each comparison shows two sets of AI-generated images or short videos, all made from the same text prompt. Pick the set whose items are more different from each other.',
      rules: [
        ['Look for', 'different subjects, poses, viewpoints, compositions, backgrounds, colors and styles.'],
        ['Ignore quality', 'we are not asking which set looks better. A set of plainer or blurrier pictures can still be the more varied one.'],
        ['Off-prompt items don’t count', 'pictures that do not show the prompt (for example a cat when the prompt asks for a dog), or broken pictures, add no variety.'],
        ['Videos', 'compare the five clips of a set with each other. How much a single clip moves does not matter.'],
        ['Always pick one', 'there is no “no preference” option. If the sets look alike, go with your best guess.'],
      ],
      questions: ['diversity'],
      secsPer: { image: 8, video: 12 },
    },
    quality: {
      title: 'Which one is better?',
      lead: 'Each comparison shows two AI-generated images or short videos made from the same text prompt. You answer two separate questions about them.',
      rules: [
        ['1 · Visual quality', 'which looks better as a picture or video: sharp, realistic, free of artifacts and of distorted objects, faces or hands. For videos, also smooth and coherent motion without flicker or morphing. Ignore the prompt for this question.'],
        ['2 · Prompt match', 'which shows what the prompt describes more accurately: the right objects, how many, their colors and positions. Ignore visual quality for this question.'],
        ['The answers can differ', 'the better-looking one does not have to be the better match.'],
        ['Always pick one', 'there is no “no preference” option. If they look alike, go with your best guess.'],
      ],
      questions: ['quality', 'alignment'],
      secsPer: { image: 11, video: 15 },
    },
  }[plan];
  const Q = {
    diversity: (m) => ({ text: `Which set of ${m === 'video' ? 'videos' : 'images'} has more variety?`, help: m === 'video' ? 'Compare the five clips with each other. Only variety counts, not quality; off-prompt clips add no variety.' : 'Only variety counts, not quality. Pictures that do not show the prompt add no variety.', a: 'Set A', b: 'Set B' }),
    quality: (m) => ({ text: `Which ${m} has better visual quality?`, help: m === 'video' ? 'Sharpness, realism, artifacts, smooth motion. Ignore the prompt.' : 'Sharpness, realism, artifacts, distortions. Ignore the prompt.', a: `${m === 'video' ? 'Video' : 'Image'} A`, b: `${m === 'video' ? 'Video' : 'Image'} B` }),
    alignment: (m) => ({ text: `Which ${m} matches the prompt better?`, help: 'Right objects, how many, colors and positions. Ignore visual quality.', a: `${m === 'video' ? 'Video' : 'Image'} A`, b: `${m === 'video' ? 'Video' : 'Image'} B` }),
  };

  /* ---------- collector ----------
     Answers go into a queue in localStorage and are sent in the background, so raters never wait.
     With collector version >= 2 the whole queue goes in one request (the script de-duplicates);
     with an older script, up to four single answers are sent in parallel. Failed sends are retried. */
  const withTimeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
  let serverVersion = null;
  async function detectServer() {
    if (serverVersion !== null) return serverVersion;
    try { const j = await (await fetch(`${CFG.endpoint}?action=version`, { redirect: 'follow', signal: withTimeout(15000) })).json(); serverVersion = (j && j.version) || 1; }
    catch (e) { return 1; }
    return serverVersion;
  }
  async function send(payload) {   // true only when the script confirms it; anything else is retried (the v2 script skips duplicates)
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
      const S = DATA.studies[sid];
      for (const p of samplePairs(sid, comparisons(sid), counts)) {
        const flip = Math.random() < 0.5;
        (blocks[S.media] = blocks[S.media] || []).push({ study: sid, block: S.media, pair: p.id, text: p.text, left: flip ? p.m[1] : p.m[0], right: flip ? p.m[0] : p.m[1] });
      }
    }
    const slates = shuffle(Object.values(blocks)).flatMap((b) => shuffle(b));
    const sess = { v: SCHEMA, id: rid(), plan, raterCode, created: Date.now(), phase: 'practice', p: 0, i: 0, slates };
    store.set(`session:${sess.id}`, sess); store.set(CUR, sess.id);
    post({ type: 'session_start', session: sess.id, study: plan, rater: raterId, rater_code: raterCode, plan, plan_index: 0, n_slates: slates.length, ua: UA });
    return sess;
  }
  const valid = (s) => s && s.v === SCHEMA && s.plan === plan && Array.isArray(s.slates) && s.slates.length && s.slates.every((sl) => DATA.studies[sl.study] && sl.left && sl.right);
  const practiceItems = (DATA.practice || {})[plan] || [];
  const minutes = () => {
    const main = DATA.plans[plan].reduce((a, sid) => a + comparisons(sid) * UI.secsPer[DATA.studies[sid].media], 0);
    return Math.max(1, Math.round((main + practiceItems.length * 25) / 60));
  };

  /* ---------- pages ---------- */
  const rulesList = () => h('ul', { class: 'rules' }, UI.rules.map(([b, t]) => h('li', null, h('b', null, b), ' — ', t)));

  function renderIntro() {
    document.onkeydown = null; delete document.body.dataset.rows;
    const total = DATA.plans[plan].reduce((a, sid) => a + comparisons(sid), 0);
    const start = h('button', { class: 'btn primary', onclick: async () => { start.disabled = true; start.textContent = 'Preparing…'; go(await newSession()); } }, `Start with ${practiceItems.length} practice examples`);
    app.replaceChildren(h('div', { class: 'intro' },
      h('div', { class: 'eyebrow' }, 'Research study'),
      h('h1', null, UI.title),
      h('p', { class: 'lead' }, UI.lead),
      h('div', { class: 'card' }, h('h2', null, 'What we ask of you'), rulesList()),
      h('div', { class: 'card steps' },
        h('div', null, h('b', null, `${practiceItems.length} practice examples`), h('span', null, 'with feedback, to show what we mean')),
        h('div', null, h('b', null, `${total} comparisons`), h('span', null, 'the actual study, without feedback')),
        h('div', null, h('b', null, `about ${minutes()} minutes`), h('span', null, 'laptop or desktop recommended'))),
      h('div', { class: 'actions' }, start, !CFG.endpoint ? h('span', { class: 'hint warn' }, 'Test mode: answers are not being saved.') : null),
      h('p', { class: 'note' }, 'Your answers are anonymous. You can close the tab at any point and continue later by opening the same link in the same browser.'),
    ));
  }

  function renderInterlude(sess) {
    delete document.body.dataset.rows;
    const startMain = () => { sess.phase = 'main'; store.set(`session:${sess.id}`, sess); go(sess); };
    document.onkeydown = (e) => { if (e.key === 'Enter') startMain(); };
    app.replaceChildren(h('div', { class: 'intro' },
      h('div', { class: 'eyebrow' }, 'Practice complete'),
      h('h1', null, 'Now the real comparisons'),
      h('p', { class: 'lead' }, `${sess.slates.length} comparisons follow. The rules are the same; from here on there is no feedback. Go with your first impression.`),
      h('div', { class: 'card' }, h('h2', null, 'Reminder'), rulesList()),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: startMain }, 'Start the comparisons'))));
    window.scrollTo(0, 0);
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

  function showRules() {
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === box) box.remove(); } },
      h('div', { class: 'card' }, h('h2', null, UI.title), rulesList(), h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => box.remove() }, 'Back to the comparison'))));
    document.body.append(box);
  }

  /* One comparison screen, used for practice (with feedback) and for the real comparisons. */
  function renderSlate(sess, item, isPractice) {
    const media = isPractice ? item.media : DATA.studies[item.study].media;
    const layout = isPractice ? item.layout : DATA.studies[item.study].layout;
    const qs = UI.questions;
    const chosen = {}, times = {}, firstTry = {}, attempts = {};
    const shownAt = performance.now();
    let locked = false;
    const total = isPractice ? practiceItems.length : sess.slates.length;
    const index = isPractice ? sess.p : sess.i;
    const noun = media === 'video' ? 'Video' : 'Image';
    const sideLabel = (k) => (qs[0] === 'diversity' ? `Set ${k}` : `${noun} ${k}`);
    const side = (m, k) => h('div', { class: 'side' }, h('div', { class: 'tag' }, h('span', { class: 'letter' }, k), sideLabel(k)), h('div', { class: 'media' }, mediaEl(m, sideLabel(k))));
    const feedback = h('div', { class: 'feedback', 'aria-live': 'polite' });
    const next = h('button', { class: 'btn primary next', hidden: true, onclick: () => advancePractice() }, sess.p + 1 < practiceItems.length ? 'Next example' : 'Finish practice');

    const rows = qs.map((q, qi) => {
      const t = Q[q](media);
      const keys = qi === 0 ? ['1', '2'] : ['3', '4'];
      const btnA = h('button', { class: 'choice', onclick: () => pick(q, 'left') }, t.a, h('kbd', null, keys[0]));
      const btnB = h('button', { class: 'choice', onclick: () => pick(q, 'right') }, t.b, h('kbd', null, keys[1]));
      const row = h('div', { class: 'qrow' }, h('div', { class: 'qtext' }, h('div', { class: 'q' }, t.text), h('div', { class: 'qhelp' }, t.help)), h('div', { class: 'qbtns' }, btnA, btnB));
      return { q, row, btnA, btnB, keys };
    });
    const rowOf = (q) => rows.find((x) => x.q === q);
    const mark = (r) => { r.btnA.classList.toggle('picked', chosen[r.q] === 'left'); r.btnB.classList.toggle('picked', chosen[r.q] === 'right'); };

    function pick(q, side) {
      if (locked) return;
      const r = rowOf(q);
      if (isPractice) {
        if (r.row.classList.contains('right-answer')) return;
        attempts[q] = (attempts[q] || 0) + 1;
        const correct = item.answers[q] === side;
        if (!(q in firstTry)) firstTry[q] = correct;
        chosen[q] = side; mark(r);
        r.row.classList.toggle('right-answer', correct); r.row.classList.toggle('wrong-answer', !correct);
        const old = feedback.querySelector(`[data-q="${q}"]`); if (old) old.remove();
        const fb = h('div', { class: `fb ${correct ? 'ok' : 'no'}`, 'data-q': q }, svg(correct ? ICON.check : ICON.x),
          h('div', null, qs.length > 1 ? h('span', { class: 'fbq' }, `${Q[q](media).text} `) : null, h('b', null, correct ? 'Correct. ' : 'Not quite. '), item.explain[q], correct ? '' : ' Try the other one.'));
        feedback.append(fb);
        if (correct) { r.btnA.disabled = side !== 'left'; r.btnB.disabled = side !== 'right'; }
        if (qs.every((x) => rowOf(x).row.classList.contains('right-answer'))) { next.hidden = false; next.focus(); }
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
        store.set(CUR, null); store.set(LAST, sess.id);
        post({ type: 'session_complete', session: sess.id, study: plan, rater: raterId, rater_code: sess.raterCode, plan, plan_index: 0, n_slates: sess.slates.length, ua: UA });
      }
      go(sess);
    }
    function advancePractice() {
      post({ type: `practice:${item.id}`, session: sess.id, study: item.id, rater: raterId, rater_code: sess.raterCode, plan: qs.map((q) => `${q}=${firstTry[q] ? 'right' : 'wrong'}`).join(' '), plan_index: qs.reduce((a, q) => a + (attempts[q] || 1) - 1, 0), n_slates: 0, ua: UA });
      sess.p += 1; if (sess.p >= practiceItems.length) sess.phase = 'interlude';
      store.set(`session:${sess.id}`, sess); go(sess);
    }

    document.body.dataset.rows = String(qs.length);
    app.replaceChildren(
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': index }, h('i', { style: `width:${(index / total) * 100}%` })),
      h('div', { class: 'rate' }, h('div', { class: 'stage' },
        h('div', { class: 'ask' },
          h('div', { class: 'meta' },
            isPractice ? h('span', { class: 'pill' }, `Practice ${index + 1} of ${total}`) : h('span', { class: 'count' }, h('b', null, index + 1), ` / ${total}`),
            h('button', { class: 'linkbtn', onclick: showRules, title: 'Show the instructions' }, svg(ICON.help), 'Instructions')),
          h('div', { class: 'p' }, 'Prompt: ', h('b', null, item.text))),
        h('div', { class: `pair ${layout === 'stack' ? 'stack' : ''}` }, side(item.left, 'A'), side(item.right, 'B')),
      )),
      h('div', { class: 'actionbar' }, h('div', { class: 'in' },
        isPractice ? feedback : null,
        rows.map((r) => r.row),
        isPractice ? h('div', { class: 'nextrow' }, next) : null,
        !CFG.endpoint ? h('div', { class: 'testmode' }, 'Test mode: answers are not being saved.') : null)),
    );
    const bar = app.querySelector('.actionbar');
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
    window.STUDY = { session: sess, pick, item, isPractice, advancePractice, go };
  }

  function renderDone(sess) {
    document.onkeydown = null; delete document.body.dataset.rows;
    const status = h('p', { class: 'muted small' });
    const update = () => {
      const n = store.get('queue', []).length;
      status.className = n ? 'hint warn' : 'muted small';
      status.textContent = n ? `Saving your answers (${n} left). Please keep this tab open for a moment.` : 'All answers are saved. You can close this tab now.';
      return n;
    };
    const otherDone = (() => { const s = store.get(`session:${store.get(`last_done:${other}`)}`); return !!(s && s.slates && s.i >= s.slates.length); })();
    const otherName = other === 'quality' ? 'quality' : 'variety';
    app.replaceChildren(h('div', { class: 'done' },
      h('div', { class: 'check' }, svg(ICON.check)),
      h('h1', null, 'All done. Thank you!'),
      h('p', { class: 'muted' }, 'Your completion code:'),
      h('div', { class: 'code' }, sess.id.slice(0, 6).toUpperCase()),
      status,
      !otherDone ? h('div', { class: 'card other' },
        h('b', null, `Can you also do the ${otherName} study?`),
        h('p', { class: 'muted small' }, other === 'quality' ? 'Similar pairs, but you judge visual quality and prompt match instead of variety.' : 'Similar prompts, but you judge which set has more variety.'),
        h('a', { class: 'btn primary', href: linkTo(other) }, `Go to the ${otherName} study`)) : null,
      h('p', { class: 'again' }, h('button', { class: 'btn', onclick: async (e) => { clearInterval(poll); e.target.disabled = true; e.target.textContent = 'Preparing…'; const s = await newSession(); s.phase = 'main'; store.set(`session:${s.id}`, s); go(s); } }, 'Do another round'))));
    const poll = setInterval(() => { if (!update() || !app.contains(status)) clearInterval(poll); }, 700);
    update(); flush(); window.scrollTo(0, 0);
  }

  function go(sess) {
    if (sess.phase === 'practice' && sess.p < practiceItems.length) return renderSlate(sess, practiceItems[sess.p], true);
    if (sess.phase === 'practice' || sess.phase === 'interlude') return renderInterlude(sess);
    if (sess.i < sess.slates.length) return renderSlate(sess, sess.slates[sess.i], false);
    renderDone(sess);
  }

  /* ---------- start: resume, show completion, or show the explanation page ---------- */
  document.title = plan === 'quality' ? 'Quality study' : 'Variety study';
  flush();
  const cur = store.get(`session:${store.get(CUR)}`);
  if (valid(cur) && cur.i < cur.slates.length) return go(cur);
  const last = store.get(`session:${store.get(LAST)}`);
  if (valid(last) && last.i >= last.slates.length) return renderDone(last);
  renderIntro();
})();
