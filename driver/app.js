/* ==========================================================================
   Driver app — Phase 2
     النهارده : the line day, step by step (arrive / leave each point, the
                factory morning & evening, end of day) + overtime request
     المشاوير : one-off trips assigned by operations
     حسابي    : the month — days, waiting, overtime, trips, advances → net
   Presses keep the phone's time and are queued when there is no internet.
   While the app is open, GPS records arrive / leave by itself.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP, S = TP.session, O = TP.ops;
  TP.fb.offline = true;                      // local copy + queued writes on the phone

  const st = {
    tab: 'today', settings: Object.assign({}, TP.DEFAULT_SETTINGS),
    linesMain: [], linesSub: [], companies: {}, daysByMonth: {}, missionsByMonth: {}, missionPay: {}, dayOff: [], myIncidents: [],
    fix: null, gps: 'wait', armed: null, pending: 0, online: navigator.onLine,
    outside: {}, inflight: new Set(), acct: { month: null, data: null, loading: false, error: '' }, subsKey: ''
  };
  let unsubs = [], watchId = null, armTimer = null, renderQueued = false;

  const me = () => S.person.id;
  const kind = () => S.person.driverKind || 'line';
  const seesMoney = () => kind() !== 'tourism';
  const R = () => Number(st.settings.geofenceM) || 300;

  /* ---------- data ---------- */
  function stop() { unsubs.forEach(u => { try { u(); } catch (e) { /* ignore */ } }); unsubs = []; }
  function subscribe() {
    const today = TP.dayKey(TP.now()), M = O.monthOf(today);
    const dayMonths = [M], missionMonths = [M];
    if (today.endsWith('-01')) dayMonths.push(O.addMonths(M, -1));        // yesterday's evening may still be open
    if (Number(today.slice(8)) >= 20) missionMonths.push(O.addMonths(M, 1)); // trips booked for next month
    const key = [today, dayMonths, missionMonths].join('|');
    if (key === st.subsKey) return;
    stop(); st.subsKey = key;
    st.daysByMonth = {}; st.missionsByMonth = {}; st.missionPay = {};
    const on = (u) => unsubs.push(u);
    const warn = what => e => { console.warn(what, e && e.code); };
    on(TP.fb.onDoc('system/settings', s => { st.settings = Object.assign({}, TP.DEFAULT_SETTINGS, s || {}); queue(); }, warn('settings')));
    on(TP.fb.onCol('companies', null, l => { st.companies = {}; l.forEach(c => { st.companies[c.id] = c; }); queue(); }, warn('companies')));
    on(TP.fb.onCol('lines', { where: [['driverId', '==', me()]] }, l => { st.linesMain = l; queue(); }, warn('lines')));
    on(TP.fb.onCol('lines', { where: [['subDriverId', '==', me()]] }, l => { st.linesSub = l; queue(); }, warn('lines-sub')));
    dayMonths.forEach(m => on(TP.fb.onCol('days', { where: [['driverId', '==', me()], ['month', '==', m]] }, l => { st.daysByMonth[m] = l; queue(); }, warn('days'))));
    missionMonths.forEach(m => {
      on(TP.fb.onCol('missions', { where: [['driverId', '==', me()], ['month', '==', m]] }, l => { st.missionsByMonth[m] = l; queue(); }, warn('missions')));
      if (seesMoney()) on(TP.fb.onCol('missionDriver', { where: [['driverId', '==', me()], ['month', '==', m]] }, l => { l.forEach(x => { st.missionPay[x.id] = x.amount; }); queue(); }, warn('missionDriver')));
    });
    on(TP.fb.onCol('dayOff', { where: [['day', '==', today]] }, l => { st.dayOff = l; queue(); }, warn('dayOff')));
    on(TP.fb.onCol('incidents', { where: [['driverId', '==', me()], ['status', '==', 'open']] }, l => { st.myIncidents = l; queue(); }, warn('incidents')));
  }
  const allDays = () => Object.values(st.daysByMonth).flat();
  const getDay = id => allDays().find(d => d.id === id) || null;
  const allMissions = () => Object.values(st.missionsByMonth).flat();

  /** The lines this driver works today (regular or as a one-day substitute). */
  const isOpen = d => !!(d && d.events && d.events.fm_arr && !d.events.fe_dep && !d.events.end);
  function todayEntries() {
    const today = TP.dayKey(TP.now()), now = TP.now(), seen = new Set(), out = [];
    const rollover = Number(st.settings.dayRolloverHour) || 5, y = O.addDays(today, -1);
    st.linesMain.concat(st.linesSub).forEach(line => {
      if (seen.has(line.id) || line.active === false) return;
      seen.add(line.id);
      // an evening that went past midnight: keep yesterday open until it is finished
      // (before the rollover hour, and well before today's own start on this line)
      if (O.hourOf(now) < rollover) {
        const yd = getDay(O.dayId(line.id, y));
        const beforeStart = !line.morningTime || now < O.cairoMs(today, line.morningTime) - 3600000;
        if (isOpen(yd) && beforeStart) { out.push({ line, day: y, doc: yd, isSub: line.driverId !== me() }); return; }
      }
      const isMain = line.driverId === me();
      const subToday = line.subDay === today && !!line.subDriverId;
      if (isMain && subToday && line.subDriverId !== me()) { out.push({ line, replaced: true }); return; }
      if (!isMain && !(line.subDriverId === me() && line.subDay === today)) return;
      out.push({ line, day: today, doc: getDay(O.dayId(line.id, today)), isSub: !isMain });
    });
    return out;
  }

  /* ---------- GPS ---------- */
  function startGps() {
    if (!navigator.geolocation) { st.gps = 'none'; return; }
    if (watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(p => {
      st.fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy || 9999, t: Date.now() };
      const was = st.gps; st.gps = 'ok';
      if (was !== 'ok') renderStatus();
      updateDistances();
      autoCheck();
    }, e => {
      st.gps = e && e.code === 1 ? 'denied' : 'weak';
      renderStatus();
      if (e && e.code === 1 && watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  }
  function freshFix() {
    if (st.fix && Date.now() - st.fix.t < 30000) return Promise.resolve(st.fix);
    if (!navigator.geolocation) return Promise.resolve(null);
    return new Promise(res => {
      let done = false;
      const finish = v => { if (!done) { done = true; res(v); } };
      setTimeout(() => finish(st.fix && Date.now() - st.fix.t < 180000 ? st.fix : null), 8000);
      navigator.geolocation.getCurrentPosition(p => {
        st.fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy || 9999, t: Date.now() };
        st.gps = 'ok'; finish(st.fix);
      }, () => finish(null), { enableHighAccuracy: true, timeout: 7500, maximumAge: 15000 });
    });
  }
  /** One press: the phone's time, where it was, how far from the target, and flags. No undefined fields. */
  function pressData(fix, loc, auto, kind) {
    const ev = { at: TP.now(), sv: TP.fb.ts(), by: 'driver' };
    if (auto) ev.auto = true;
    if (fix) {
      ev.lat = Math.round(fix.lat * 1e6) / 1e6; ev.lng = Math.round(fix.lng * 1e6) / 1e6; ev.acc = Math.round(fix.acc);
      const d = O.dist(fix, loc);
      // an automatic "left the point" is by definition outside the circle — not a warning
      if (d !== null) { ev.dist = d; ev.far = !(auto && kind === 'dep') && d > R(); }
    } else ev.noGps = true;
    return ev;
  }

  /** Records arrive / leave by itself while the app is open (agreed: helps the driver who forgets). */
  function autoCheck() {
    const fix = st.fix;
    if (st.settings.autoGps === false || !fix || fix.acc > 150) return;
    const now = TP.now(), rad = R(), margin = Math.max(50, fix.acc);
    todayEntries().forEach(en => {
      if (en.replaced) return;
      const line = en.line, f = st.companies[line.factoryId];
      const steps = O.steps(line, f), ev = (en.doc && en.doc.events) || {};
      const s = steps[O.nextIndex(steps, ev)];
      // remember whether the car was last seen outside the factory (for the evening arrival)
      const okey = line.id + '|' + en.day, fd = O.dist(fix, f && f.location);
      const wasOutside = !!st.outside[okey];
      if (fd !== null) { if (fd > rad + margin) st.outside[okey] = true; else if (fd <= rad) st.outside[okey] = false; }
      if (!s || !s.loc || !isFinite(s.loc.lat)) return;
      const d = O.dist(fix, s.loc);
      const morning = line.morningTime ? O.cairoMs(en.day, line.morningTime) : null;
      let evening = line.eveningTime ? O.cairoMs(en.day, line.eveningTime) : null;
      if (evening && morning && evening < morning) evening += 86400000;
      let fire = false;
      if (s.phase === 'm') {
        if (!morning || now < morning - (Number(st.settings.morningAutoLeadMin) || 90) * 60000 || now > morning + 8 * 3600000) return;
        fire = s.kind === 'arr' ? d <= rad : d > rad + margin;
      } else if (s.key === 'fe_arr') {
        // only when the car comes back in — never while it stayed parked at the factory (that would add waiting)
        if (!evening || now < evening - (Number(st.settings.eveningAutoWindowMin) || 30) * 60000 || now > evening + 6 * 3600000) return;
        fire = d <= rad && wasOutside;
      } else if (s.key === 'fe_dep') {
        fire = d > rad + margin;
      }
      if (fire) recordLine(line, en.day, s, true);
    });
  }
  function updateDistances() {
    TP.$$('[data-dist]').forEach(el => {
      const [lat, lng] = el.dataset.dist.split(',').map(Number);
      const d = O.dist(st.fix, { lat, lng });
      el.textContent = d === null ? '' : (d <= R() ? 'إنت جوّه المكان' : 'على بعد ' + O.fmtDist(d));
    });
  }

  /* ---------- writes ---------- */
  function track(p, okMsg) {
    st.pending++; renderStatus();
    if (!navigator.onLine) TP.toast('اتسجلت على الموبايل — هتتبعت أول ما النت يرجع');
    else if (okMsg) TP.toast(okMsg);
    p.catch(e => { console.error(e); TP.toast(TP.errorText(e), 'warn'); })
      .finally(() => { st.pending = Math.max(0, st.pending - 1); renderStatus(); });
  }
  async function recordLine(line, day, step, auto) {
    const id = O.dayId(line.id, day), flight = id + '/' + step.key;
    const doc = getDay(id);
    if ((doc && doc.events && doc.events[step.key]) || st.inflight.has(flight)) return;
    const fa = doc && doc.events && doc.events.fe_arr;
    if (step.key === 'fe_dep' && fa && TP.now() - fa.at > 6 * 3600000) {
      // the system accepts at most 6 hours of evening waiting from the phone
      if (!auto) TP.toast('الانتظار عدّى 6 ساعات — كلّم الإدارة تسجّلها', 'warn');
      return;
    }
    st.inflight.add(flight);
    try {
      const ev = pressData(auto ? st.fix : await freshFix(), step.loc, auto, step.kind);
      const p = doc
        ? TP.fb.update('days/' + id, { ['events.' + step.key]: ev, lastKey: step.key, updatedAt: TP.fb.ts() })
        : TP.fb.set('days/' + id, { lineId: line.id, factoryId: line.factoryId, driverId: me(), day, month: O.monthOf(day), events: { [step.key]: ev }, lastKey: step.key, updatedAt: TP.fb.ts() }, true);
      track(p, (auto ? 'اتسجل تلقائي: ' : 'اتسجل: ') + step.label);
      await p.catch(() => {});
    } finally { st.inflight.delete(flight); }
  }
  async function recordMission(m, step) {
    const flight = 'm/' + m.id + '/' + step.key;
    if ((m.events && m.events[step.key]) || st.inflight.has(flight)) return;
    st.inflight.add(flight);
    try {
      const loc = step.key === 'start' ? (m.from && m.from.location) : (m.to && m.to.location);
      const ev = pressData(await freshFix(), step.key === 'done' ? null : loc, false);
      const p = TP.fb.update('missions/' + m.id, { ['events.' + step.key]: ev, lastKey: step.key, status: step.key === 'done' ? 'done' : 'active', updatedAt: TP.fb.ts() });
      track(p, 'اتسجل: ' + step.label);
      await p.catch(() => {});
    } finally { st.inflight.delete(flight); }
  }

  /* first tap arms the button, second tap records (no accidental presses) */
  function armOrRun(key, run) {
    clearTimeout(armTimer);
    if (st.armed === key) { st.armed = null; run(); render(); return; }
    st.armed = key; render();
    armTimer = setTimeout(() => { st.armed = null; render(); }, 4000);
  }

  /* ---------- rendering ---------- */
  function queue() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); }
  function render() {
    if (!S.ready || !S.person) return;
    renderStatus();
    TP.$$('.dv-nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === st.tab));
    ['today', 'missions', 'account'].forEach(t => { TP.$('#tab-' + t).hidden = st.tab !== t; });
    if (st.tab === 'today') renderToday(); else if (st.tab === 'missions') renderMissions(); else renderAccount();
    const openM = allMissions().filter(m => (m.status === 'assigned' || m.status === 'active') && m.day <= TP.dayKey(TP.now())).length;
    const b = TP.$('#mBadge'); b.hidden = !openM; b.textContent = openM;
    TP.hydrateIcons(TP.$('#app'));
    updateDistances();
  }
  function renderStatus() {
    const el = TP.$('#status'); if (!el) return;
    const net = st.online ? (st.pending ? `<span class="st st-warn">بيتبعت ${st.pending}…</span>` : '<span class="st st-ok">متصل</span>')
      : `<span class="st st-danger">مفيش نت${st.pending ? ` — ${st.pending} مستنية` : ''}</span>`;
    const gps = { ok: '<span class="st st-ok">الموقع شغال</span>', wait: '<span class="st st-info">بيدوّر على الموقع…</span>', weak: '<span class="st st-warn">إشارة الموقع ضعيفة</span>', denied: '<span class="st st-danger">الموقع مقفول</span>', none: '<span class="st st-off">الموبايل مفيهوش موقع</span>' }[st.gps] || '';
    const clock = Math.abs(TP.clockSkew || 0) > 5 * 60000 ? '<span class="st st-warn">ساعة الموبايل مش مظبوطة — التطبيق بيصححها</span>' : '';
    el.innerHTML = net + gps + clock;
  }

  function stepBadges(e) {
    if (!e) return '';
    return [e.auto ? '<span class="badge-s auto">تلقائي</span>' : '', e.far ? `<span class="badge-s far">بعيد ${esc(O.fmtDist(e.dist))}</span>` : '',
      e.noGps ? '<span class="badge-s nogps">بدون موقع</span>' : '', e.by === 'staff' ? '<span class="badge-s staff">سجلتها الإدارة</span>' : ''].join('');
  }
  const mapLink = (loc, label) => { const u = TP.mapsUrl(loc); return u ? `<a class="link" href="${esc(u)}" target="_blank" rel="noopener">${TP.icon('pin', 15)}${esc(label || 'الخريطة')}</a>` : ''; };
  const distSpan = loc => loc && isFinite(loc.lat) ? `<span data-dist="${loc.lat},${loc.lng}"></span>` : '';

  function renderToday() {
    const root = TP.$('#tab-today'), entries = todayEntries(), today = TP.dayKey(TP.now());
    let html = '';
    if (st.gps === 'denied') html += `<div class="banner danger">${TP.icon('pin')}<span>الموقع مقفول. افتحه من إعدادات الموبايل للمتصفح ده، علشان التسجيل التلقائي وعلشان الإدارة تعرف إنك وصلت.</span></div>`;
    if (st.myIncidents.length) html += `<div class="banner danger">${TP.icon('bell')}<span>بلاغك وصل للإدارة (${esc(O.incidentName(st.myIncidents[0].kind))}) — هيكلموك حالاً.</span></div>`;
    html += `<div class="banner info" style="justify-content:space-between"><b>${esc(TP.fmtDay(TP.now()))}</b><span class="muted small">خلي التطبيق مفتوح وإنت شغال</span></div>`;
    if (!entries.length) {
      html += `<section class="glass card"><div class="empty">مفيش خط عليك النهارده.<br><span class="small">لو عندك مشاوير هتلاقيها في "المشاوير".</span></div></section>`;
    }
    entries.forEach(en => { html += lineCard(en, today); });
    root.innerHTML = html;
    root.querySelectorAll('[data-press]').forEach(b => b.onclick = () => {
      const [lid, day, key] = b.dataset.press.split('|');
      const en = todayEntries().find(x => x.line.id === lid && x.day === day); if (!en) return;
      const step = O.steps(en.line, st.companies[en.line.factoryId]).find(s => s.key === key); if (!step) return;
      armOrRun(b.dataset.press, () => recordLine(en.line, day, step, false));
    });
    root.querySelectorAll('[data-ot]').forEach(b => b.onclick = () => askOvertime(b.dataset.ot));
  }

  function lineCard(en, today) {
    const line = en.line, f = st.companies[line.factoryId] || {};
    if (en.replaced) {
      return `<section class="glass card"><div class="dv-h"><div><h2>${esc(line.name)}</h2><div class="sub">${esc(f.name || '')}</div></div></div>
        <div class="banner warn">${TP.icon('users')}<span>النهارده فيه سواق بديل على الخط ده. مش مطلوب منك تسجّل.</span></div></section>`;
    }
    const steps = O.steps(line, f), ev = (en.doc && en.doc.events) || {}, ni = O.nextIndex(steps, ev), part = O.part(ev);
    const off = st.dayOff.find(o => o.factoryId === 'all' || o.factoryId === line.factoryId);
    const chip = part === 'full' ? '<span class="st st-ok">يوم كامل</span>' : part === 'half' ? '<span class="st st-info">نص يوم</span>' : '<span class="st st-off">لسه مبدأش</span>';
    let html = `<section class="glass card"><div class="dv-h"><div><h2>${esc(line.name)}</h2><div class="sub">${esc(f.name || '')}${line.morningTime ? ' · الصبح ' + esc(O.hm12(line.morningTime)) : ''}${line.eveningTime ? ' · الرجوع ' + esc(O.hm12(line.eveningTime)) : ''}</div></div>${chip}</div>`;
    if (en.isSub) html += `<div class="banner warn" style="margin-bottom:10px">${TP.icon('users')}<span>إنت السواق البديل على الخط ده النهارده.</span></div>`;
    if (en.day !== today) html += `<div class="banner info" style="margin-bottom:10px">${TP.icon('clock')}<span>ده يوم امبارح — لسه مخلصش.</span></div>`;
    if (off) html += `<div class="banner warn" style="margin-bottom:10px">${TP.icon('calendar')}<span>${off.type === 'cancelled' ? 'الإدارة لغت شغل النهارده' : 'النهارده إجازة'}${off.note ? ' — ' + esc(off.note) : ''}</span></div>`;
    if (line.notes) html += `<p class="small muted" style="margin-bottom:10px">${TP.icon('file', 15)} ${esc(line.notes)}</p>`;
    const next = steps[ni];
    if (next) {
      const pk = `${line.id}|${en.day}|${next.key}`, armed = st.armed === pk;
      const sub = armed ? 'دوس تاني للتأكيد' : (next.guests && next.guests.length && next.kind === 'arr' ? next.guests.length + ' ضيف: ' + next.guests.slice(0, 4).join('، ') + (next.guests.length > 4 ? '…' : '') : (next.note || ''));
      html += `<button type="button" class="act ${armed ? 'armed' : ''}" data-press="${esc(pk)}">${TP.icon(next.kind === 'end' ? 'check' : next.kind === 'dep' ? 'arrow' : 'pin', 30)}<span><b>${esc(next.label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${armed ? '' : `<small>${distSpan(next.loc)}</small>`}</span></button>`;
    } else {
      html += `<div class="banner ok">${TP.icon('check')}<span>اليوم خلص — متشكرين.</span></div>`;
    }
    // live evening wait + overtime
    const pills = [];
    if (ev.fe_arr) {
      const mins = ev.fe_dep ? O.waitMin(ev) : Math.max(0, Math.round((TP.now() - ev.fe_arr.at) / 60000));
      pills.push(`<div class="pill"><span>انتظار المسا${ev.fe_dep ? '' : ' (شغال)'}</span><strong>${mins} دقيقة</strong></div>`);
    }
    const ot = en.doc && en.doc.ot;
    if (ot) {
      const s = O.OT_STATUS[ot.status] || ['', 'st-off'];
      pills.push(`<div class="pill"><span>السهرة ${esc(O.otTierLabel(ot.tier, st.settings))}</span><strong><span class="st ${s[1]}">${s[0]}</span></strong></div>`);
    }
    if (pills.length) html += `<div class="sum-row">${pills.join('')}</div>`;
    if (!ot && ev.fm_arr && en.doc) html += `<button type="button" class="btn btn-ghost btn-block" style="margin-top:12px" data-ot="${esc(en.doc.id)}">${TP.icon('clock', 18)}طلب سهرة</button>`;
    // timeline
    html += `<ol class="tl">${steps.map((s, i) => {
      const e = ev[s.key], cls = e ? 'done' : i === ni ? 'next' : i < ni ? 'skipped' : '';
      const pk = `${line.id}|${en.day}|${s.key}`;
      const locked = s.phase === 'e' && !ev.fm_arr;   // the evening comes after the morning factory arrival
      const right = e ? `<span class="time">${esc(TP.fmtTime(e.at))}</span>`
        : i === ni || locked ? '' : `<button type="button" class="rec ${st.armed === pk ? 'armed' : ''}" data-press="${esc(pk)}">${st.armed === pk ? 'أكّد' : 'سجّل'}</button>`;
      const guests = s.kind === 'arr' && s.target === 'point' && s.guests.length ? `<div class="guests">${s.guests.map(esc).join(' · ')}</div>` : '';
      return `<li class="${cls}"><span class="dot">${e ? '✓' : i + 1}</span><div><b>${esc(s.label)}</b>
        <div class="meta">${stepBadges(e)}${!e && s.kind !== 'end' ? mapLink(s.loc, s.target === 'factory' ? 'لوكيشن المصنع' : 'لوكيشن النقطة') : ''}${!e && i < ni ? '<span class="badge-s far">اتعدّت</span>' : ''}</div>${guests}</div>${right}</li>`;
    }).join('')}</ol></section>`;
    return html;
  }

  function askOvertime(dayId) {
    let tier = 0;
    const tiers = [1, 2, 3];
    TP.openModal('طلب سهرة', `<p class="modal-text" style="margin-bottom:10px">اختار السهرة لحد إمتى. الطلب بيروح للإدارة للموافقة.</p>
      <div class="opt-list">${tiers.map(t => `<button type="button" class="opt" data-tier="${t}">${TP.icon('clock', 18)}${esc(O.otTierLabel(t, st.settings))}</button>`).join('')}</div>`, () => {
      if (!tier) { TP.toast('اختار شريحة السهرة'); return false; }
      const p = TP.fb.update('days/' + dayId, { ot: { tier, status: 'pending', reqAt: TP.now(), by: 'driver' }, updatedAt: TP.fb.ts() });
      track(p, 'طلب السهرة اتبعت للإدارة ✓');
    }, { saveLabel: 'ابعت الطلب', noFocus: true });
    TP.$$('#tp-modal [data-tier]').forEach(b => b.onclick = () => { tier = Number(b.dataset.tier); TP.$$('#tp-modal [data-tier]').forEach(x => x.classList.toggle('on', x === b)); });
  }

  /* ---------- missions ---------- */
  function renderMissions() {
    const root = TP.$('#tab-missions'), today = TP.dayKey(TP.now());
    const list = allMissions().filter(m => m.status !== 'cancelled').sort((a, b) => (a.day + (a.time || '')).localeCompare(b.day + (b.time || '')));
    const open = list.filter(m => m.status !== 'done'), done = list.filter(m => m.status === 'done').reverse().slice(0, 15);
    const card = m => {
      const f = st.companies[m.factoryId];
      const ev = m.events || {}, ni = O.nextIndex(O.MISSION_STEPS, ev), next = O.MISSION_STEPS[ni];
      const s = O.MISSION_STATUS[m.status] || ['', 'st-off'];
      const pay = seesMoney() && st.missionPay[m.id] !== undefined ? `<span class="tag gold">${esc(TP.money(st.missionPay[m.id]))}</span>` : '';
      let action = '';
      if (next && m.status !== 'done') {
        if (m.day > today) action = `<div class="banner info" style="margin-top:10px">${TP.icon('calendar')}<span>ميعاده ${esc(TP.fmtDay(m.day + 'T12:00:00'))}</span></div>`;
        else {
          const pk = 'm|' + m.id + '|' + next.key, armed = st.armed === pk;
          const tgt = next.key === 'start' ? m.from && m.from.location : next.key === 'arrive' ? m.to && m.to.location : null;
          action = `<button type="button" class="act ${armed ? 'armed' : ''}" data-mpress="${esc(pk)}">${TP.icon(next.key === 'done' ? 'check' : 'pin', 26)}<span><b>${esc(next.label)}</b><small>${armed ? 'دوس تاني للتأكيد' : distSpan(tgt)}</small></span></button>`;
        }
      }
      return `<div class="ms"><div class="ms-when"><b>${esc(TP.fmtDay(m.day + 'T12:00:00'))}${m.time ? ' · ' + esc(O.hm12(m.time)) : ''}</b><span class="st ${s[1]}">${s[0]}</span></div>
        <div style="font-weight:900;font-size:16px">${esc(m.title || 'مشوار')} ${pay}</div>
        ${f || m.client ? `<div class="muted small">${esc(f ? f.name : m.client)}</div>` : ''}
        <div class="ms-route">${TP.icon('pin', 16)}<div>من: ${esc((m.from && m.from.name) || '—')} ${mapLink(m.from && m.from.location, '')}</div>
          ${TP.icon('map', 16)}<div>إلى: ${esc((m.to && m.to.name) || '—')} ${mapLink(m.to && m.to.location, '')}</div></div>
        ${m.guests ? `<div class="small"><b>الضيوف:</b> ${esc(m.guests)}</div>` : ''}
        ${m.notes ? `<div class="small muted">${esc(m.notes)}</div>` : ''}
        ${Object.keys(ev).length ? `<div class="meta small muted" style="margin-top:6px">${O.MISSION_STEPS.filter(x => ev[x.key]).map(x => `${esc(x.short)} ${esc(TP.fmtTime(ev[x.key].at))} ${stepBadges(ev[x.key])}`).join(' · ')}</div>` : ''}
        ${action}</div>`;
    };
    root.innerHTML = `<section class="glass card"><div class="dv-h"><h2>المشاوير</h2></div>${open.length ? open.map(card).join('') : '<div class="empty">مفيش مشاوير عليك دلوقتي.</div>'}</section>
      ${done.length ? `<section class="glass card"><div class="dv-h"><h2>اللي خلص</h2></div>${done.map(card).join('')}</section>` : ''}`;
    root.querySelectorAll('[data-mpress]').forEach(b => b.onclick = () => {
      const [, mid, key] = b.dataset.mpress.split('|');
      const m = allMissions().find(x => x.id === mid), step = O.MISSION_STEPS.find(x => x.key === key);
      if (m && step) armOrRun(b.dataset.mpress, () => recordMission(m, step));
    });
  }

  /* ---------- حسابي ---------- */
  async function loadAccount(month) {
    st.acct = { month, data: null, loading: true, error: '' }; render();
    const w = [['driverId', '==', me()], ['month', '==', month]];
    try {
      const [days, missions, pay, rates, adj] = await Promise.all([
        TP.fb.list('days', { where: w }), TP.fb.list('missions', { where: w }),
        seesMoney() ? TP.fb.list('missionDriver', { where: w }) : [],
        seesMoney() ? TP.fb.get('driverRates/' + me()) : null,
        seesMoney() ? TP.fb.list('adjustments', { where: w }) : []
      ]);
      const missionPay = {}; pay.forEach(x => { missionPay[x.id] = x.amount; });
      if (st.acct.month !== month) return;
      st.acct.data = O.statement({ days, missions, missionPay, rateHistory: (rates && rates.history) || [], adjustments: adj });
    } catch (e) { console.error(e); st.acct.error = TP.errorText(e); }
    st.acct.loading = false; render();
  }
  function renderAccount() {
    const root = TP.$('#tab-account'), M = O.monthOf(TP.dayKey(TP.now()));
    if (!st.acct.month) { loadAccount(M); return; }
    const months = [M, O.addMonths(M, -1), O.addMonths(M, -2)], a = st.acct, d = a.data, money = seesMoney();
    let body = '';
    if (a.loading) body = '<div class="spinner"></div>';
    else if (a.error) body = `<div class="banner danger">${esc(a.error)}</div>`;
    else if (d) body = O.statementHtml(d, money);
    root.innerHTML = `<section class="glass card"><div class="dv-h"><div><h2>حسابي</h2><div class="sub">${esc(O.monthName(a.month))}</div></div><button type="button" class="icon-btn" id="acRefresh" title="تحديث">${TP.icon('refresh', 18)}</button></div>
      <div class="month-pick">${months.map(m => `<button type="button" class="chip ${m === a.month ? 'active' : ''}" data-month="${m}">${esc(O.monthName(m))}</button>`).join('')}</div>${body}</section>`;
    root.querySelectorAll('[data-month]').forEach(b => b.onclick = () => loadAccount(b.dataset.month));
    root.querySelector('#acRefresh').onclick = () => loadAccount(a.month);
  }

  /* ---------- SOS & reports ---------- */
  function openSos() {
    let kindSel = '';
    TP.openModal('استغاثة / بلاغ للإدارة', `<div class="opt-list">${O.INCIDENT_KINDS.map(k => `<button type="button" class="opt ${k.id === 'sos' ? 'sos' : ''}" data-kind="${k.id}">${TP.icon(k.id === 'sos' ? 'bell' : 'warn', 18)}${esc(k.name)}</button>`).join('')}</div>
      <label class="fld" style="margin-top:12px">تفاصيل (اختياري)<textarea class="input" id="sosNote" rows="2" maxlength="400"></textarea></label>
      <p class="muted small" style="margin-top:8px">مكانك هيتبعت مع البلاغ.</p>`, async () => {
      if (!kindSel) { TP.toast('اختار نوع البلاغ'); return false; }
      const fix = await freshFix();
      const today = todayEntries().find(e => !e.replaced);
      const data = { driverId: me(), driverName: S.person.name || '', phone: S.person.phone || '', kind: kindSel, note: TP.ui_val('sosNote').slice(0, 400), at: TP.now(), status: 'open', createdAt: TP.fb.ts() };
      if (fix) { data.lat = Math.round(fix.lat * 1e6) / 1e6; data.lng = Math.round(fix.lng * 1e6) / 1e6; data.acc = Math.round(fix.acc); }
      if (today) data.lineId = today.line.id;
      track(TP.fb.add('incidents', data), 'البلاغ وصل للإدارة ✓');
    }, { saveLabel: 'ابعت للإدارة', danger: true, noFocus: true });
    TP.$$('#tp-modal [data-kind]').forEach(b => b.onclick = () => { kindSel = b.dataset.kind; TP.$$('#tp-modal [data-kind]').forEach(x => x.classList.toggle('on', x === b)); });
  }
  TP.ui_val = id => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };

  /* ---------- wiring ---------- */
  TP.$$('.dv-nav button').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; st.armed = null; if (st.tab === 'account' && st.acct.month) loadAccount(st.acct.month); else render(); window.scrollTo(0, 0); });
  TP.$('#sosBtn').onclick = openSos;
  window.addEventListener('online', () => { st.online = true; renderStatus(); });
  document.addEventListener('tp:clock', () => renderStatus());
  window.addEventListener('offline', () => { st.online = false; renderStatus(); });
  setInterval(() => { if (!S.ready) return; subscribe(); if (st.tab === 'today' && !st.armed) render(); }, 30000); // day change · live waiting minutes

  document.addEventListener('tp:session', () => {
    TP.$('#app').hidden = false;
    TP.$('#meName').textContent = S.person.name || '';
    TP.$('#meKind').textContent = TP.driverKindName(kind());
    st.acct = { month: null, data: null, loading: false, error: '' };
    st.subsKey = '';
    subscribe();
    startGps();
    render();
  });
  document.addEventListener('tp:session-end', () => {
    TP.$('#app').hidden = true; stop(); st.subsKey = '';
    if (watchId !== null && navigator.geolocation) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  });
  S.start({ kind: 'driver', base: '../shared/' });
})(window.TP = window.TP || {});
