/* ==========================================================================
   The customer's page — opened from his link (…/c/#TOKEN), no sign-in.
   Shows only his own trip: the company card of the driver (photo, name,
   code — and the car for airport trips), where the car is, the time left,
   then "العربية وصلت وجاهزة" on top of everything with sound until "تمام".
   He can say "مش راكب النهارده / بكره", allow notifications, and rate the ride.

   The token never leaves this page and the staff who sent it: the car's
   side lives in track/{sha256(token)} (+ live/{…} for its place while it
   comes), his own answers in ans/{token} — the cloud alarm copies them to
   the driver within a minute. So nobody else can answer in his name.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP, O = TP.ops, FL = TP.flight;
  TP.fb.noAuth = true;

  const KEY = 'tp-c-token';
  let token = decodeURIComponent((location.hash || '').slice(1)).replace(/[^A-Za-z0-9]/g, '');
  if (token) TP.store.set(KEY, token); else token = TP.store.get(KEY, '');
  const st = { h: '', doc: undefined, live: null, ans: undefined, card: null, cardFor: '', photo: null, info: null, rateStars: 0, rateNote: '',
    popKey: '', map: null, mapFail: false, busy: false, soundOk: false };

  const today = () => TP.dayKey(TP.now());
  const main = () => TP.$('#main');
  /** A line link is for every day: only today's status counts (an evening past midnight still shows). A trip link is for that trip only. */
  const isToday = d => !!d && (d.kind === 'mission' || d.day === today() || (d.day === O.addDays(today(), -1) && ['evening', 'picked', 'dropped'].includes(d.st) && O.hourOf(TP.now()) < 5));
  const status = d => (d && isToday(d) ? d.st : 'idle') || 'idle';
  /** His own answers: what he just pressed (ans/) wins over the copy on the link. */
  const mine = () => Object.assign({}, st.doc || {}, st.ans || {});
  const skipOn = day => O.skipsOn(mine(), day);

  /* ---------- sound until "تمام" (phones allow sound only after a tap on the page) ---------- */
  let audio = null, ringTimer = null;
  function unlockSound() {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); st.soundOk = true; } catch (e) { /* no sound */ }
  }
  // any tap unlocks the sound; the hint button just goes (no full redraw here — it would swallow the tap's click)
  document.addEventListener('pointerdown', () => { unlockSound(); if (st.soundOk) { const b = TP.$('#sOn'); if (b) setTimeout(() => b.remove(), 400); } }, { passive: true });
  function beep() {
    try {
      if (audio) for (let i = 0; i < 3; i++) { const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.3; o.type = 'sine'; o.frequency.value = i % 2 ? 880 : 660; g.gain.value = 0.18; o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.22); }
    } catch (e) { /* no sound */ }
    try { navigator.vibrate && navigator.vibrate([400, 150, 400]); } catch (e) { /* no vibration */ }
  }
  const ring = on => { if (on && !ringTimer) { beep(); ringTimer = setInterval(beep, 2500); } if (!on && ringTimer) { clearInterval(ringTimer); ringTimer = null; } };

  /* ---------- the driver's company card ---------- */
  async function loadCard(pid) {
    if (!pid || st.cardFor === pid) return;
    st.cardFor = pid; st.card = null; st.photo = null;
    try {
      st.card = await TP.fb.get('cards/' + pid);
      if (st.card && st.card.hasPhoto) { const p = await TP.fb.get('cardPhotos/' + pid); st.photo = p && p.photo; }
    } catch (e) { console.warn('card', e); }
    render();
  }
  function cardHtml(d) {
    const c = st.card; if (!c) return '';
    const car = d.kind === 'mission' && d.type === 'airport' && c.car;
    return `<div class="c-badge"><div class="c-ph">${st.photo ? `<img src="${esc(st.photo)}" alt="">` : TP.icon('user', 40)}</div>
      <div class="c-who"><span class="caps">كارنيه الشركة</span><b>${esc(c.name || '')}</b>${c.code ? `<span class="tag gold">كود ${esc(c.code)}</span>` : ''}
      ${car ? `<div class="small">${esc([car.model, car.color].filter(Boolean).join(' — '))}${car.plate ? ` · <b>${esc(car.plate)}</b>` : ''}</div>` : ''}</div></div>`;
  }

  /* ---------- map (free OpenStreetMap, only while the car comes) ---------- */
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (st.leaflet) return st.leaflet;
    st.leaflet = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
      const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      s.onload = () => res(window.L); s.onerror = () => rej(new Error('leaflet')); document.head.appendChild(s);
      setTimeout(() => rej(new Error('timeout')), 15000);
    });
    st.leaflet.catch(() => { st.mapFail = true; });
    return st.leaflet;
  }
  async function drawMap(d, pos) {
    let el = TP.$('#cMap'); if (!el || !pos) return;
    const target = d.kind === 'line' ? d.pointLoc : d.fromLoc;
    try {
      const L = await loadLeaflet();
      el = TP.$('#cMap'); if (!el) return;
      // keep the same map between screen refreshes (no flicker, no reload of the tiles)
      if (st.map && st.map.el !== el) { el.replaceWith(st.map.el); el = st.map.el; st.map.m.invalidateSize(); }
      if (!st.map) {
        const m = L.map(el, { zoomControl: false, attributionControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
        st.map = { el, m, fitted: false, car: L.circleMarker([pos.lat, pos.lng], { radius: 11, color: '#fff', weight: 3, fillColor: '#7a1f22', fillOpacity: 1 }).addTo(m),
          me: target ? L.circleMarker([target.lat, target.lng], { radius: 9, color: '#7a1f22', weight: 3, fillColor: '#f2d48e', fillOpacity: 1 }).addTo(m) : null };
      }
      st.map.car.setLatLng([pos.lat, pos.lng]);
      // fit once — then only the car moves (the customer may have zoomed)
      if (!st.map.fitted) {
        const pts = [[pos.lat, pos.lng]].concat(target ? [[target.lat, target.lng]] : []);
        if (pts.length > 1) st.map.m.fitBounds(pts, { padding: [36, 36], maxZoom: 16 }); else st.map.m.setView(pts[0], 15);
        st.map.fitted = true;
      }
    } catch (e) { el.hidden = true; }
  }

  /* ---------- writes (only the customer's own answers, at most one every few seconds) ---------- */
  // One write at a time; answers pressed meanwhile are merged into the next one. The rules accept one
  // write every 4 seconds per link, so the gap is counted from when the last write was confirmed.
  let pending = null, waiters = [], timer = null, busyWrite = false, lastOk = 0, retried = false;
  const GAP = 4600;
  function save(patch) {
    pending = Object.assign(pending || {}, patch);
    st.ans = Object.assign({}, st.ans || {}, patch);   // shows at once
    render();
    return new Promise((res, rej) => { waiters.push({ res, rej }); schedule(); });
  }
  function schedule(extra) { if (!timer && !busyWrite && pending) timer = setTimeout(flush, Math.max(0, lastOk + GAP - Date.now()) + (extra || 0)); }
  async function flush() {
    timer = null;
    if (busyWrite || !pending) return;
    const patch = pending, ws = waiters; pending = null; waiters = [];
    busyWrite = true;
    try {
      const data = Object.assign({}, patch, { at: TP.fb.ts(), dirty: true });
      if (st.ansExists) await TP.fb.update('ans/' + token, data);
      else { await TP.fb.set('ans/' + token, Object.assign({ h: st.h }, data), true); st.ansExists = true; }
      lastOk = Date.now(); retried = false;
      ws.forEach(w => w.res());
    } catch (e) {
      console.warn(e);
      if (!retried) {   // too soon after another write (or another phone of his): once more, a bit later
        retried = true; pending = Object.assign({}, patch, pending || {}); waiters = ws.concat(waiters); lastOk = Date.now();
      } else { retried = false; TP.toast(TP.errorText(e), 'warn'); ws.forEach(w => w.rej(e)); }
    } finally { busyWrite = false; }
    schedule();
  }
  async function ack() {
    const d = st.doc; if (!d) return;
    ring(false); st.popKey = d.day + ':' + d.seq;
    TP.$('#pop').hidden = true;
    await save({ ack: { seq: Number(d.seq) || 0, at: TP.now() } }).catch(() => {});
  }
  async function setSkip(day, on) {
    if (on && !(await TP.confirm('مش هتركب؟', day === today() ? 'هنبلّغ السواق إنك مش راكب النهارده، والمصنع هيعرف.' : 'هنبلّغ السواق إنك مش راكب بكره.', 'أيوه، مش راكب'))) return;
    // one entry per day (today and tomorrow stay apart); old days drop off
    const keep = O.addDays(today(), -1), skips = {};
    Object.entries(mine().skips || {}).forEach(([k, v]) => { if (k >= keep && k !== day) skips[k] = v; });
    if (on) skips[day] = TP.now();
    await save({ skips }).then(() => TP.toast(on ? 'تمام — اتبلّغ ✓' : 'تمام — العربية هتعدي عليك ✓')).catch(() => {});
  }
  async function enablePush() {
    if (st.busy) return; st.busy = true;
    try {
      const t = await TP.fb.pushToken(true).catch(() => null);
      if (!t) { TP.toast('مقدرناش نفعّل الإشعارات — اسمح بيها من إعدادات المتصفح', 'warn'); return; }
      if (mine().fcm !== t) await save({ fcm: t, fcmAt: TP.now() });
      TP.toast('الإشعارات اتفعلت ✓');
    } finally { st.busy = false; render(); }
  }
  async function airportSay(k) { await save({ cust: Object.assign({}, mine().cust || {}, { [k]: TP.now() }) }).then(() => TP.toast('السواق هيعرف ✓')).catch(() => {}); }
  async function rate() {
    const d = st.doc, stars = st.rateStars;
    if (!stars) return TP.toast('اختار عدد النجوم');
    // the cloud alarm files it for this ride's driver (once a day, only for a ride that happened)
    await save({ rate: { day: d.day, stars, note: st.rateNote.trim().slice(0, 300) }, rateDay: d.day }).then(() => TP.toast('شكراً على تقييمك 🌟')).catch(() => {});
  }

  /* ---------- screen ---------- */
  const TEXT = {
    near: ['العربية في الطريق ليك', '🚗'], arrived: ['العربية وصلت وجاهزة', '✅'], picked: ['رحلة سعيدة', '🛣️'], dropped: ['وصلت بالسلامة', '🏁'],
    evening: ['العربية مستنياك للرجوع', '🚗'], done: ['الرحلة خلصت', '🌟'], skip: ['مسجلين إنك مش راكب النهارده', '📝'], noshow: ['العربية استنتك ومشيت', '⌛'], cancelled: ['المشوار ده اتلغى', '✖']
  };
  function etaText(lv) {
    if (!lv || !lv.eta) return '';
    const min = Math.max(0, Math.ceil((lv.eta - TP.now()) / 60000));
    const old = lv.pos && TP.now() - lv.pos.at > 3 * 60000 ? `<small class="muted">آخر تحديث من ${Math.round((TP.now() - lv.pos.at) / 60000)} دقيقة</small>` : '';
    return `<div class="c-eta"><span>هتوصلك في حوالي</span><b>${min <= 1 ? 'دقيقة' : min + ' دقيقة'}</b>${old}</div>`;
  }
  function flightHtml(f) {
    if (!f || !f.no) return '';
    const t = FL.when(f);
    return `<div class="c-flight">✈ <b dir="ltr">${esc(f.no)}</b>${f.other ? ` · ${f.dir === 'arr' ? 'جاية من' : 'رايحة'} ${esc(f.other)}` : ''}${t ? ` · ${f.dir === 'arr' ? 'الهبوط' : 'الإقلاع'} <b>${esc(TP.fmtTime(t))}</b>` : ''}${f.terminal ? ` · صالة <b>${esc(f.terminal)}</b>` : ''}${f.status ? ` · ${esc(FL.statusName(f.status))}` : ''}</div>`;
  }
  function render() {
    const d = st.doc, m = main();
    if (!token) { m.innerHTML = `<section class="glass card c-card"><h1>اللينك ناقص</h1><p class="muted">افتح اللينك اللي وصلك على الواتساب زي ما هو.</p></section>`; return; }
    if (d === undefined) return;
    if (d === null) { m.innerHTML = `<section class="glass card c-card"><h1>اللينك ده مش شغال</h1><p class="muted">يمكن المشوار اتلغى أو اللينك اتغيّر. كلّم الشركة.</p>${opsBtn()}</section>`; return; }
    const s = status(d), t = TEXT[s], me = mine();
    // a line customer who said "مش راكب" sees that (the driver's copy arrives within a minute)
    const shown = d.kind === 'line' && s === 'idle' && skipOn(today()) ? 'skip' : s;
    if (d.driverId && isToday(d)) loadCard(d.driverId);
    const name = String(d.name || '').split(' ')[0];
    let h = `<section class="glass card c-card"><div class="c-hello">أهلاً ${esc(name)} 👋</div>`;
    if (d.kind === 'line') h += `<div class="c-sub">${esc(d.lineName || '')}${d.factoryName ? ' — ' + esc(d.factoryName) : ''}<br>نقطتك: <b>${esc(d.pointName || '')}</b>${d.morningTime ? ` · العربية بتبدأ الساعة ${esc(O.hm12(d.morningTime))}` : ''}</div>`;
    else h += `<div class="c-sub"><b>${esc(d.title || 'مشوارك')}</b><br>${esc(TP.fmtDay(d.day + 'T12:00:00'))}${d.time ? ' · ' + esc(O.hm12(d.time)) : ''}<br>${esc(d.fromName || '')}${d.toName ? ' ← ' + esc(d.toName) : ''}</div>${flightHtml(d.flight)}`;
    if (TEXT[shown] && shown !== 'idle') h += `<div class="c-state s-${shown}"><span class="c-emo">${TEXT[shown][1]}</span><b>${esc(TEXT[shown][0])}</b></div>`;
    else if (d.kind === 'line') h += `<div class="c-state s-idle"><span class="c-emo">🕐</span><b>لما العربية تتحرك ليك هيوصلك إشعار هنا</b></div>`;
    const lv = st.live && st.live.day === d.day ? st.live : null;
    if (s === 'near') h += etaText(lv) + (lv && lv.pos && !st.mapFail ? '<div class="c-map" id="cMap"></div>' : '');
    if (isToday(d) && ['near', 'arrived', 'picked', 'evening'].includes(s)) h += cardHtml(d);
    // sound needs one tap on the page first (phone rule)
    if (!st.soundOk && isToday(d) && ['idle', 'near'].includes(s)) h += `<button type="button" class="btn btn-ghost btn-block c-sound" id="sOn">🔔 دوس هنا علشان صوت "العربية وصلت" يشتغل</button>`;
    // the airport arrivals hall: tell the driver where you are
    if (d.kind === 'mission' && d.type === 'airport' && d.flight && d.flight.dir === 'arr' && ['near', 'arrived'].includes(s)) {
      const c = me.cust || {};
      h += `<div class="c-acts">${c.landed ? '<span class="st st-ok">السواق هيعرف إنك نزلت ✓</span>' : '<button type="button" class="btn btn-primary btn-lg btn-block" id="aLanded">✈ نزلت من الطيارة</button>'}
        ${c.out ? '<span class="st st-ok">السواق هيعرف إنك طالع ✓</span>' : `<button type="button" class="btn ${c.landed ? 'btn-primary' : 'btn-ghost'} btn-lg btn-block" id="aOut">🧳 خلصت الجوازات والشنط وطالع</button>`}</div>`;
    }
    // "مش راكب": lines only, before the car reached him (today and tomorrow are separate)
    if (d.kind === 'line' && !(isToday(d) && ['arrived', 'picked', 'dropped', 'evening', 'done', 'noshow'].includes(d.st))) {
      const tm = O.addDays(today(), 1);
      h += `<div class="c-acts">${skipOn(today()) ? '<button type="button" class="btn btn-ghost btn-block" id="sUndo">لأ، هركب النهارده</button>'
        : '<button type="button" class="btn btn-ghost btn-block" id="sToday">مش هركب النهارده / أنا أجازة</button>'}
        ${skipOn(tm) ? '<button type="button" class="btn btn-ghost btn-block" id="sUndoT">لأ، هركب بكره</button>' : '<button type="button" class="btn btn-ghost btn-block" id="sTomorrow">مش هركب بكره</button>'}</div>`;
    }
    // rating after the ride (once a day)
    if (isToday(d) && ['dropped', 'evening', 'done'].includes(s) && me.rateDay !== d.day && d.driverId) {
      h += `<div class="c-rate"><b>إيه رأيك في المشوار؟</b><div class="stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}" class="${n <= st.rateStars ? 'on' : ''}" aria-label="${n}">★</button>`).join('')}</div>
        <input class="input" id="rNote" maxlength="300" placeholder="ملاحظة (اختياري)" value="${esc(st.rateNote)}"><button type="button" class="btn btn-primary btn-block" id="rGo">ابعت التقييم</button></div>`;
    } else if (isToday(d) && me.rateDay === d.day) h += '<p class="muted small" style="text-align:center">شكراً على تقييمك 🌟</p>';
    // notifications
    const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    if (!me.fcm && perm !== 'unsupported' && !['done', 'cancelled'].includes(s)) h += `<div class="banner warn c-push">${TP.icon('bell')}<span class="grow">فعّل الإشعارات علشان يوصلك لما العربية تقرب وتوصل حتى والصفحة مقفولة</span><button type="button" class="btn btn-primary btn-sm" id="pushOn">فعّل</button></div>`;
    else if (perm === 'unsupported' && !['done', 'cancelled'].includes(s)) h += `<p class="muted small">الموبايل ده مش بيدعم الإشعارات — خلي الصفحة مفتوحة${/iP(hone|ad)/.test(navigator.userAgent) ? '، أو ضيفها للشاشة الرئيسية (مشاركة ← Add to Home Screen) وافتحها من هناك' : ''}.</p>`;
    h += opsBtn() + '</section>';
    // keep the typed note and the focus while the page refreshes
    const focused = document.activeElement && document.activeElement.id;
    m.innerHTML = h;
    TP.hydrateIcons(m);
    if (focused === 'rNote' && TP.$('#rNote')) { const el = TP.$('#rNote'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    const on = (id, fn) => { const el = TP.$('#' + id); if (el) el.onclick = fn; };
    on('sToday', () => setSkip(today(), true)); on('sTomorrow', () => setSkip(O.addDays(today(), 1), true));
    on('sUndo', () => setSkip(today(), false)); on('sUndoT', () => setSkip(O.addDays(today(), 1), false));
    on('pushOn', enablePush); on('rGo', rate); on('sOn', () => { unlockSound(); beep(); render(); });
    on('aLanded', () => airportSay('landed')); on('aOut', () => airportSay('out'));
    const note = TP.$('#rNote'); if (note) note.oninput = () => { st.rateNote = note.value; };
    TP.$$('[data-star]', m).forEach(b => b.onclick = () => { st.rateStars = Number(b.dataset.star); TP.$$('[data-star]', m).forEach(x => x.classList.toggle('on', Number(x.dataset.star) <= st.rateStars)); });
    if (s === 'near' && lv && lv.pos) drawMap(d, lv.pos); else if (st.map) { try { st.map.m.remove(); } catch (e) { /* gone */ } st.map = null; }
    popup(d, s);
  }
  function opsBtn() {
    const ph = st.info && st.info.opsPhone;
    return ph ? `<a class="btn btn-ghost btn-block c-ops" href="${esc(TP.telLink(ph))}">${TP.icon('phone', 18)}كلّم الشركة</a>` : '';
  }
  /** "العربية وصلت وجاهزة" — over everything, with sound, until "تمام". */
  function popup(d, s) {
    const pop = TP.$('#pop'), me = mine();
    const need = isToday(d) && ['arrived', 'evening'].includes(s) && !(me.ack && me.ack.seq === d.seq) && st.popKey !== d.day + ':' + d.seq;
    if (!need) { pop.hidden = true; ring(false); return; }
    const air = d.kind === 'mission' && d.type === 'airport' && d.flight && d.flight.dir === 'arr';
    const title = s === 'evening' ? 'العربية مستنياك قدام المصنع' : air ? 'السواق وصل المطار ومستنيك' : 'العربية وصلت وجاهزة';
    if (pop.hidden || pop.dataset.key !== d.day + ':' + d.seq) {
      pop.dataset.key = d.day + ':' + d.seq;
      pop.innerHTML = `<div class="c-pop-card"><div class="c-pop-car">🚗</div><h2>${esc(title)}</h2>
        ${air && d.flight.terminal ? `<p>صالة <b>${esc(d.flight.terminal)}</b> — معاه لافتة باسمك</p>` : d.kind === 'line' && s === 'arrived' ? `<p>عند <b>${esc(d.pointName || '')}</b></p>` : ''}
        <div id="popCard"></div><button type="button" class="btn btn-gold btn-lg btn-block" id="popOk">تمام، جاي</button></div>`;
      pop.hidden = false;
      TP.$('#popOk', pop).onclick = ack;
    }
    const pc = TP.$('#popCard', pop), ch = cardHtml(d);   // the card may arrive after the message
    if (pc && pc.dataset.v !== ch) { pc.innerHTML = ch; pc.dataset.v = ch; TP.hydrateIcons(pc); }
    ring(true);
  }

  /** Added to the home screen, the app must still open this customer's own link. */
  function personalManifest() {
    try {
      const base = new URL('./', location.href).href, icon = new URL('../shared/icon-192.png', location.href).href;
      const man = { name: 'Three Pyramids — عربيتك', short_name: 'عربيتك', lang: 'ar', dir: 'rtl', start_url: base + '#' + token, scope: base, display: 'standalone',
        background_color: '#3b0d0f', theme_color: '#3b0d0f', icons: [{ src: icon, sizes: '192x192', type: 'image/png', purpose: 'any' }] };
      const link = document.querySelector('link[rel="manifest"]');
      if (link) link.href = URL.createObjectURL(new Blob([JSON.stringify(man)], { type: 'application/manifest+json' }));
    } catch (e) { /* the plain manifest stays */ }
  }

  /* ---------- start ---------- */
  if (!token) { render(); return; }
  if (!TP.fb.configured()) { main().innerHTML = '<section class="glass card c-card"><p>الخدمة مش متظبطة.</p></section>'; return; }
  personalManifest();
  Promise.all([TP.fb.load(), TP.sha256(token)]).then(([, h]) => {
    st.h = h;
    TP.fb.onDoc('track/' + h, d => { st.doc = d; render(); }, e => { console.warn(e); st.doc = null; render(); });
    TP.fb.onDoc('live/' + h, d => { st.live = d; if (st.doc && status(st.doc) === 'near') render(); }, () => {});
    TP.fb.onDoc('ans/' + token, a => { st.ansExists = !!a; if (!pending) { st.ans = a || null; render(); } }, () => { st.ans = null; });
    TP.fb.get('public/info').then(i => { st.info = i; render(); }).catch(() => {});
    // notifications already allowed on this phone → keep the token fresh
    if ('Notification' in window && Notification.permission === 'granted') setTimeout(() => { TP.fb.pushToken(false).then(t => { if (t && st.doc && mine().fcm !== t) save({ fcm: t, fcmAt: TP.now() }).catch(() => {}); }).catch(() => {}); }, 1500);
  }).catch(e => { console.error(e); main().innerHTML = '<section class="glass card c-card"><h1>مفيش اتصال</h1><p class="muted">اتأكد من الإنترنت وافتح اللينك تاني.</p></section>'; });
  document.addEventListener('tp:push', () => render());
  setInterval(() => { if (st.doc && status(st.doc) === 'near') render(); }, 20000);   // the time left counts down
  window.addEventListener('hashchange', () => location.reload());
})(window.TP = window.TP || {});
