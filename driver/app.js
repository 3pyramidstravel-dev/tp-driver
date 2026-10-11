/* ==========================================================================
   Driver app
     النهارده : the line day, step by step (arrive / leave each point, the
                factory morning & evening, end of day) + overtime request,
                and the customers of every point (رکب / مجاش / واتساب)
     المشاوير : one-off trips and airport transfers (name sign, cash, expenses)
     حسابي    : the month — days, waiting, overtime, trips (money only when
                the accounts are on and the driver may see his pay)
   Presses keep the phone's time and are queued when there is no internet.
   While the app is open, GPS records arrive / leave by itself, and tells
   the customer who is next: "العربية في الطريق" with the time left, then
   "العربية وصلت وجاهزة".
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP, S = TP.session, O = TP.ops;
  TP.fb.offline = true;                      // local copy + queued writes on the phone

  const st = {
    tab: 'today', settings: Object.assign({}, TP.DEFAULT_SETTINGS),
    linesMain: [], linesSub: [], companies: {}, daysByMonth: {}, missionsByMonth: {}, missionPay: {}, dayOff: [], myIncidents: [],
    fix: null, gps: 'wait', armed: null, pending: 0, online: navigator.onLine, acks: {}, openedAt: TP.now(),
    outside: {}, inflight: new Set(), acct: { month: null, data: null, loading: false, error: '' }, subsKey: '',
    track: {}, live: {}, speed: 0, lastFix: null, myExpenses: []
  };
  let trackSubs = {};
  let unsubs = [], watchId = null, armTimer = null, renderQueued = false;

  const me = () => S.person.id;
  const kind = () => S.person.driverKind || 'line';
  const seesMoney = () => kind() !== 'tourism' && TP.financeOn(st.settings);
  const R = () => Number(st.settings.geofenceM) || 300;

  /* ---------- data ---------- */
  function stop() { unsubs.forEach(u => { try { u(); } catch (e) { /* ignore */ } }); unsubs = []; }
  function subscribe() {
    const today = TP.dayKey(TP.now()), M = O.monthOf(today);
    const dayMonths = [M], missionMonths = [M];
    if (today.endsWith('-01')) dayMonths.push(O.addMonths(M, -1));        // yesterday's evening may still be open
    if (Number(today.slice(8)) >= 20) missionMonths.push(O.addMonths(M, 1)); // trips booked for next month
    if (TP.dvCar) TP.dvCar.start();                                      // the car's trip order (month changes too)
    const key = [today, dayMonths, missionMonths, seesMoney()].join('|');
    if (key === st.subsKey) return;
    stop(); st.subsKey = key;
    st.daysByMonth = {}; st.missionsByMonth = {}; st.missionPay = {};
    const on = (u) => unsubs.push(u);
    const warn = what => e => { console.warn(what, e && e.code); };
    on(TP.fb.onDoc('system/settings', s => {
      const before = seesMoney();
      st.settings = Object.assign({}, TP.DEFAULT_SETTINGS, s || {});
      if (seesMoney() !== before) { setTimeout(() => { subscribe(); if (st.tab === 'account') loadAccount(st.acct.month || O.monthOf(TP.dayKey(TP.now()))); }, 0); return; }   // the accounts were switched on / off
      queue();
    }, warn('settings')));
    on(TP.fb.onCol('companies', null, l => { st.companies = {}; l.forEach(c => { st.companies[c.id] = c; }); queue(); }, warn('companies')));
    on(TP.fb.onCol('lines', { where: [['driverId', '==', me()]] }, l => { st.linesMain = l; queue(); }, warn('lines')));
    on(TP.fb.onCol('lines', { where: [['subDriverId', '==', me()]] }, l => { st.linesSub = l; queue(); }, warn('lines-sub')));
    dayMonths.forEach(m => on(TP.fb.onCol('days', { where: [['driverId', '==', me()], ['month', '==', m]] }, l => { st.daysByMonth[m] = l; queue(); }, warn('days'))));
    missionMonths.forEach(m => {
      on(TP.fb.onCol('missions', { where: [['driverId', '==', me()], ['month', '==', m]] }, l => { st.missionsByMonth[m] = l; queue(); }, warn('missions')));
      if (seesMoney()) on(TP.fb.onCol('missionDriver', { where: [['driverId', '==', me()], ['month', '==', m]] }, l => { l.forEach(x => { st.missionPay[x.id] = x.amount; }); queue(); }, warn('missionDriver')));
    });
    on(TP.fb.onCol('dayOff', { where: [['day', '>=', today]] }, l => { st.dayOff = l; queue(); }, warn('dayOff')));
    st.acks = {};
    [today, O.addDays(today, 1)].forEach(d => on(TP.fb.onCol('wakeAcks', { where: [['driverId', '==', me()], ['day', '==', d]] }, l => { st.acks[d] = l[0] || null; queue(); }, warn('wakeAcks'))));
    on(TP.fb.onCol('incidents', { where: [['driverId', '==', me()], ['status', '==', 'open']] }, l => { st.myIncidents = l; queue(); }, warn('incidents')));
    on(TP.fb.onCol('expenses', { where: [['driverId', '==', me()], ['month', '==', M]] }, l => { st.myExpenses = l.sort((a, b) => (b.at || 0) - (a.at || 0)); queue(); }, warn('expenses')));
  }
  function stopTrack() { Object.values(trackSubs).forEach(u => { try { u(); } catch (e) { /* ignore */ } }); trackSubs = {}; st.track = {}; }
  /** Live copies of today's customers' link documents (to see "مش راكب", who read the message, who allowed pushes). */
  function syncTrack() {
    const want = new Set(myCustomers().map(c => c.h).filter(Boolean));
    Object.keys(trackSubs).forEach(t => { if (!want.has(t)) { trackSubs[t](); delete trackSubs[t]; delete st.track[t]; } });
    want.forEach(t => { if (!trackSubs[t]) trackSubs[t] = TP.fb.onDoc('track/' + t, d => { st.track[t] = d; queue(); }, () => {}); });
  }
  /** Every customer the driver may meet today: his lines' points and his trips of today. */
  function myCustomers() {
    const out = [], today = TP.dayKey(TP.now());
    todayEntries().forEach(en => { if (!en.replaced) O.lineCustomers(en.line).forEach(c => { if (c.h) out.push(Object.assign({ kind: 'line', lineId: en.line.id, day: en.day }, c)); }); });
    allMissions().filter(m => m.status !== 'cancelled' && (m.day === today || m.status === 'active')).forEach(m => (m.customers || []).forEach(c => { if (c.h) out.push(Object.assign({ kind: 'mission', missionId: m.id, day: m.day }, c)); }));
    return out;
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
      // speed on the way (km/h), smoothed — for the customer's "time left"
      const lf = st.lastFix, f = st.fix;
      if (isFinite(p.coords.speed) && p.coords.speed !== null && p.coords.speed >= 0) st.speed = st.speed ? st.speed * 0.6 + p.coords.speed * 3.6 * 0.4 : p.coords.speed * 3.6;
      else if (lf && f.t - lf.t >= 5000 && f.acc < 80) { const v = O.dist(lf, f) / ((f.t - lf.t) / 1000) * 3.6; if (v < 150) st.speed = st.speed ? st.speed * 0.6 + v * 0.4 : v; }
      if (!lf || f.t - lf.t >= 5000) st.lastFix = f;
      const was = st.gps; st.gps = 'ok';
      if (was !== 'ok') renderStatus();
      updateDistances();
      autoCheck();
      liveTick();
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
      const line = en.line, f = st.companies[line.factoryId], ev = (en.doc && en.doc.events) || {};
      const steps = stepsOf(line, en.day, ev);
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
    // trips: reaching the customer and the destination are recorded by themselves too
    allMissions().filter(m => m.status === 'active').forEach(m => {
      const steps = O.missionSteps(m), next = steps[O.nextIndex(steps, m.events || {})];
      if (next && (next.key === 'pickup' || next.key === 'arrive') && next.loc && isFinite(next.loc.lat) && O.dist(fix, next.loc) <= rad) recordMission(m, next, true);
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
  /** Who of this point's customers said "مش راكب" for this day (on his link). */
  const skipsDay = (c, day) => O.skipsOn(st.track[c.h], day);
  /** Points the car need not pass: every customer there said "مش راكب". */
  function skipSet(line, day) {
    const out = new Set();
    (line.points || []).forEach((p, i) => { const cs = O.custsOf(p).filter(c => c.h); if (cs.length && cs.every(c => skipsDay(c, day))) out.add(i); });
    return out;
  }
  const stepsOf = (line, day, ev) => O.steps(line, st.companies[line.factoryId], skipSet(line, day), ev);

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
      const fix = auto ? st.fix : await freshFix();
      const ev = pressData(fix, step.loc, auto, step.kind);
      const picked = pickedFor(line, day, step, doc);
      const p = doc
        ? TP.fb.update('days/' + id, Object.assign({ ['events.' + step.key]: ev, lastKey: step.key, updatedAt: TP.fb.ts() }, Object.fromEntries(Object.entries(picked).map(([k, v]) => ['picked.' + k, v]))))
        : TP.fb.set('days/' + id, Object.assign({ lineId: line.id, factoryId: line.factoryId, driverId: me(), day, month: O.monthOf(day), events: { [step.key]: ev }, lastKey: step.key, updatedAt: TP.fb.ts() }, Object.keys(picked).length ? { picked } : {}), true);
      track(p, (auto ? 'اتسجل تلقائي: ' : 'اتسجل: ') + step.label);
      onLineStep(line, day, step, Object.assign({}, (doc && doc.events) || {}, { [step.key]: ev }));
      await p.catch(() => {});
    } finally { st.inflight.delete(flight); }
  }
  /** Who rode, written with the press: leaving a point = its customers rode (unless "مجاش" / they said "مش راكب"). */
  function pickedFor(line, day, step, doc) {
    const out = {}, now = TP.now();
    if (!(step.kind === 'dep' && step.target === 'point')) return out;
    O.lineCustomers(line).forEach(c => {
      if (!c.id || c.pointIdx !== step.i || O.riderOf(doc, c.id) || skipsDay(c, day)) return;
      out[c.id] = { at: now, n: nm(c) };
    });
    return out;
  }
  const first = n => String(n || '').trim().split(/\s+/)[0] || '';
  /** The customer's name is kept on the record, so reports still name him after he leaves the line. */
  const nm = c => String((c && c.name) || '').slice(0, 60);

  /* ---------- the customer's link: status, push, position ---------- */
  /** Changes one customer's status for the day (each change has a number the customer's "تمام" answers). */
  function custStatus(h, stName, day, push, extra, again) {
    const cur = st.track[h];
    // not loaded yet (cold start / offline): read it (the offline copy is enough), then apply
    if (!cur) { if (!again && h) TP.fb.get('track/' + h).then(d => { if (d) { st.track[h] = st.track[h] || d; custStatus(h, stName, day, push, extra, true); } }).catch(() => {}); return; }
    const sameDay = cur.day === day;
    if (sameDay && cur.st === stName) return;
    if (sameDay && ['skip', 'noshow'].includes(cur.st) && !['noshow'].includes(stName)) return;   // keep "مش راكب" / "مجاش"
    if (!sameDay && O.skipsOn(cur, day) && stName !== 'skip') return;
    const seq = (Number(cur.seq) || 0) + 1, now = TP.now();
    const patch = { day, st: stName, stAt: now, seq, driverId: me() };
    if (push && cur.fcm) Object.assign(patch, { pq: { seq, t: push.t, b: push.b }, pqAt: now });
    st.track[h] = Object.assign({}, cur, patch);
    TP.fb.update('track/' + h, patch).then(() => {
      // the time left / the car's place live apart (only the customer's page reads them)
      const eta = extra && extra.eta ? extra.eta : null;
      if (stName === 'near' || st.live[h]) return TP.fb.set('live/' + h, { driverId: me(), day, eta, pos: null, at: now });
    }).catch(e => console.warn('track', e && e.code));
    if (stName !== 'near') delete st.live[h];
  }
  const nearMsg = (min, where) => ({ t: 'العربية في الطريق ليك 🚗', b: (min ? `هتوصل ${where ? where + ' ' : ''}في حوالي ${min} دقيقة` : 'السواق اتحرك ليك') + ' — افتح اللينك تتابعها' });
  function onLineStep(line, day, step, ev) {
    const custs = O.lineCustomers(line).filter(c => c.h), drv = first(S.person.name);
    const live = (c, fn) => { if (!skipsDay(c, day)) fn(st.track[c.h] || {}); };
    if (step.target === 'point' && step.kind === 'arr') custs.filter(c => c.pointIdx === step.i).forEach(c => live(c, () => custStatus(c.h, 'arrived', day, { t: 'العربية وصلت وجاهزة 🚗', b: `السواق ${drv} مستنيك عند ${step.name}` })));
    if (step.target === 'point' && step.kind === 'dep') {
      custs.filter(c => c.pointIdx === step.i).forEach(c => live(c, t => { if (!(t.day === day && t.st === 'noshow')) custStatus(c.h, 'picked', day); }));
      const steps = stepsOf(line, day, ev), next = steps.find(x => x.target === 'point' && x.kind === 'arr' && !ev[x.key]);
      if (next) custs.filter(c => c.pointIdx === next.i).forEach(c => live(c, () => {
        const eta = etaTo(line, day, next.i, next.loc);
        custStatus(c.h, 'near', day, nearMsg(eta, ''), eta ? { eta: TP.now() + eta * 60000 } : null);
      }));
    }
    if (step.key === 'fm_arr') custs.forEach(c => live(c, t => { if (t.day === day && t.st === 'picked') custStatus(c.h, 'dropped', day); }));
    if (step.key === 'fe_arr') custs.forEach(c => live(c, t => { if (t.day === day && ['picked', 'dropped'].includes(t.st)) custStatus(c.h, 'evening', day, { t: 'العربية مستنياك قدام المصنع 🚗', b: `السواق ${drv} وصل للرجوع` }); }));
    if (step.key === 'fe_dep' || step.key === 'end') custs.forEach(c => live(c, t => { if (t.day === day && ['picked', 'dropped', 'evening'].includes(t.st)) custStatus(c.h, 'done', day); }));
  }
  /** Minutes to a line point: distance & speed, blended with how long this stretch usually takes. */
  function etaTo(line, day, i, loc) {
    if (!st.fix || !loc || !isFinite(loc.lat)) return null;
    const days = allDays().filter(d => d.lineId === line.id && d.day !== day);
    const prev = i > 0 ? (line.points || [])[i - 1] : null;
    return O.etaMin(st.fix, loc, { radius: R(), speedKmh: st.speed, histMin: O.usualLeg(days, i), histDist: prev ? O.dist(prev.location, loc) : null });
  }
  /**
   * While the car goes to a customer: "في الطريق" (once) and its position + time left every few seconds.
   * Lines: the next point (the first one from a while before the line's time). Trips: after "اتحركت".
   */
  function liveTick() {
    const fix = st.fix; if (!fix || fix.acc > 200) return;
    const now = TP.now(), every = Math.max(15, Number(st.settings.liveEverySec) || 60) * 1000, targets = [];
    todayEntries().forEach(en => {
      if (en.replaced) return;
      if (st.dayOff.some(o => o.day === en.day && (o.factoryId === 'all' || o.factoryId === en.line.factoryId))) return;   // holiday / cancelled day
      const line = en.line, ev = (en.doc && en.doc.events) || {}, steps = stepsOf(line, en.day, ev);
      const ni = O.nextIndex(steps, ev), next = steps[ni];
      if (!next || next.target !== 'point' || next.kind !== 'arr' || !next.loc || !isFinite(next.loc.lat)) return;
      const morning = line.morningTime ? O.cairoMs(en.day, line.morningTime) : null;
      if (ni === 0 && (!morning || now < morning - (Number(st.settings.nearLeadMin) || 45) * 60000 || now > morning + 4 * 3600000)) return;
      if (O.dist(fix, next.loc) <= R()) return;
      O.lineCustomers(line).filter(c => c.h && c.pointIdx === next.i && !skipsDay(c, en.day)).forEach(c => targets.push({ c, day: en.day, loc: next.loc, eta: () => etaTo(line, en.day, next.i, next.loc) }));
    });
    allMissions().filter(m => m.status === 'active').forEach(m => {
      const ev = m.events || {}, steps = O.missionSteps(m), next = steps[O.nextIndex(steps, ev)];
      if (!next || next.key !== 'pickup') return;
      const loc = next.loc && isFinite(next.loc.lat) ? next.loc : null;
      (m.customers || []).filter(c => c.h).forEach(c => targets.push({ c, day: m.day, loc, eta: () => loc ? O.etaMin(fix, loc, { radius: R(), speedKmh: st.speed }) : null }));
    });
    targets.forEach(({ c, day, loc, eta }) => {
      const t = st.track[c.h]; if (!t) return;
      const min = eta();
      if (!(t.day === day && ['near', 'arrived', 'picked', 'dropped', 'evening', 'done', 'noshow', 'skip'].includes(t.st))) { custStatus(c.h, 'near', day, nearMsg(min, ''), min ? { eta: now + min * 60000 } : null); st.live[c.h] = { at: now, lat: fix.lat, lng: fix.lng, min }; return; }
      if (t.st !== 'near' || !loc) return;
      const last = st.live[c.h];
      if (last && now - last.at < every) return;
      if (last && O.dist(last, fix) < 30 && last.min === min) return;
      st.live[c.h] = { at: now, lat: fix.lat, lng: fix.lng, min };
      TP.fb.set('live/' + c.h, { driverId: me(), day, pos: { lat: Math.round(fix.lat * 1e5) / 1e5, lng: Math.round(fix.lng * 1e5) / 1e5, at: now }, eta: min ? now + min * 60000 : null, at: now }).catch(() => {});
    });
  }
  /** "مجاش": the car waited at the point and the customer did not come (the place is recorded as proof). */
  async function noShow(kindOf, owner, c, day) {
    if (!(await TP.confirm('العميل مجاش', `${c.name} مجاش؟ هيتسجل عند الإدارة والمصنع ومكانك هيتسجل معاه.`, 'أيوه، مجاش', true))) return;
    const fix = await freshFix(), r = { at: TP.now(), n: nm(c) };
    if (fix) { r.lat = Math.round(fix.lat * 1e6) / 1e6; r.lng = Math.round(fix.lng * 1e6) / 1e6; r.acc = Math.round(fix.acc); }
    const path = kindOf === 'line' ? 'days/' + O.dayId(owner.id, day) : 'missions/' + owner.id;
    track(TP.fb.update(path, { ['noshow.' + c.id]: r, updatedAt: TP.fb.ts() }), 'اتسجل: ' + c.name + ' مجاش');
    custStatus(c.h, 'noshow', day, { t: 'العربية استنتك ومشيت', b: 'لو محتاج حاجة كلّم الشركة' });
  }
  /** A trip customer got in. */
  function picked(m, c) {
    track(TP.fb.update('missions/' + m.id, { ['picked.' + c.id]: { at: TP.now(), n: nm(c) }, updatedAt: TP.fb.ts() }), c.name + ' ركب ✓');
    custStatus(c.h, 'picked', m.day);
  }

  async function recordMission(m, step, auto) {
    const flight = 'm/' + m.id + '/' + step.key;
    if ((m.events && m.events[step.key]) || st.inflight.has(flight)) return;
    st.inflight.add(flight);
    try {
      const ev = pressData(auto ? st.fix : await freshFix(), step.key === 'done' || step.key === 'start' ? null : step.loc, auto, step.key === 'start' ? 'dep' : 'arr');
      const patch = { ['events.' + step.key]: ev, lastKey: step.key, status: step.key === 'done' ? 'done' : 'active', updatedAt: TP.fb.ts() };
      // arriving at the destination / ending the trip: whoever was not marked rode
      if (step.key === 'arrive' || step.key === 'done') (m.customers || []).forEach(c => { if (c.id && !O.riderOf(m, c.id)) patch['picked.' + c.id] = { at: TP.now(), n: nm(c) }; });
      const p = TP.fb.update('missions/' + m.id, patch);
      track(p, (auto ? 'اتسجل تلقائي: ' : 'اتسجل: ') + step.label);
      onMissionStep(m, step);
      await p.catch(() => {});
    } finally { st.inflight.delete(flight); }
  }
  function onMissionStep(m, step) {
    const drv = first(S.person.name), air = m.type === 'airport' && m.flight;
    (m.customers || []).filter(c => c.h).forEach(c => {
      const t = st.track[c.h] || {}, gone = t.st === 'noshow';
      if (step.key === 'start') custStatus(c.h, 'near', m.day, nearMsg(null, ''));
      if (step.key === 'pickup' && !gone) custStatus(c.h, 'arrived', m.day, air && air.dir === 'arr'
        ? { t: 'السواق وصل المطار ومستنيك 🚗', b: `${air.terminal ? 'صالة ' + air.terminal + ' — ' : ''}معاه لافتة باسمك` }
        : { t: 'العربية وصلت وجاهزة 🚗', b: `السواق ${drv} مستنيك` });
      if (step.key === 'arrive' && !gone) custStatus(c.h, 'dropped', m.day);
      if (step.key === 'done' && !gone) custStatus(c.h, 'done', m.day);
    });
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
    syncTrack();
    renderStatus();
    TP.$$('.dv-nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === st.tab));
    // "عربيتي" (trip order, custody, fuel, salary) only for a driver who has it
    const car = !!(TP.dvCar && TP.dvCar.available()), carBtn = TP.$('.dv-nav [data-tab="car"]');
    if (carBtn) carBtn.hidden = !car;
    TP.$('.dv-nav').style.gridTemplateColumns = `repeat(${car ? 4 : 3}, 1fr)`;
    if (st.tab === 'car' && !car) st.tab = 'today';
    ['today', 'missions', 'account', 'car'].forEach(t => { const el = TP.$('#tab-' + t); if (el) el.hidden = st.tab !== t; });
    if (st.tab === 'today') renderToday(); else if (st.tab === 'missions') renderMissions(); else if (st.tab === 'car') renderCar(); else renderAccount();
    const openM = allMissions().filter(m => (m.status === 'assigned' || m.status === 'active') && m.day <= TP.dayKey(TP.now())).length;
    const b = TP.$('#mBadge'); b.hidden = !openM; b.textContent = openM;
    TP.hydrateIcons(TP.$('#app'));
    updateDistances();
    checkWake();
  }
  /** "عربيتي" — drawn by fleet.js; never redrawn under the driver's fingers while he types. */
  function renderCar() {
    const root = TP.$('#tab-car'), a = document.activeElement;
    if (a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    TP.dvCar.keep(root);
    TP.dvCar.render(root);
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
    if (TP.dvCar) html += TP.dvCar.custodyBanner();
    html += wakeCard();
    html += `<div class="banner info" style="justify-content:space-between"><b>${esc(TP.fmtDay(TP.now()))}</b><span class="muted small">خلي التطبيق مفتوح وإنت شغال</span></div>`;
    if (!entries.length) {
      html += `<section class="glass card"><div class="empty">مفيش خط عليك النهارده.<br><span class="small">لو عندك مشاوير هتلاقيها في "المشاوير".</span></div></section>`;
    }
    entries.forEach(en => { html += lineCard(en, today); });
    root.innerHTML = html;
    root.querySelectorAll('[data-press]').forEach(b => b.onclick = () => {
      const [lid, day, key] = b.dataset.press.split('|');
      const en = todayEntries().find(x => x.line.id === lid && x.day === day); if (!en) return;
      const step = stepsOf(en.line, day, (en.doc && en.doc.events) || {}).find(s => s.key === key); if (!step) return;
      armOrRun(b.dataset.press, () => recordLine(en.line, day, step, false));
    });
    bindCustomers(root);
    if (TP.dvCar) TP.dvCar.bindBanner(root);
    root.querySelectorAll('[data-ot]').forEach(b => b.onclick = () => askOvertime(b.dataset.ot));
    const wr = root.querySelector('#wReady'); if (wr) wr.onclick = () => markReady();
    const wc = root.querySelector('#wChange'); if (wc) wc.onclick = () => changeWake();
    const wp = root.querySelector('#wPush'); if (wp) wp.onclick = () => TP.push.enable().then(ok => { TP.toast(ok ? 'التنبيهات اتفعلت ✓' : 'مقدرناش نفعّل التنبيهات — اسمح بيها من إعدادات المتصفح', ok ? '' : 'warn'); render(); });
  }

  function lineCard(en, today) {
    const line = en.line, f = st.companies[line.factoryId] || {};
    if (en.replaced) {
      return `<section class="glass card"><div class="dv-h"><div><h2>${esc(line.name)}</h2><div class="sub">${esc(f.name || '')}</div></div></div>
        <div class="banner warn">${TP.icon('users')}<span>النهارده فيه سواق بديل على الخط ده. مش مطلوب منك تسجّل.</span></div></section>`;
    }
    const ev = (en.doc && en.doc.events) || {}, steps = stepsOf(line, en.day, ev), ni = O.nextIndex(steps, ev), part = O.part(ev);
    const off = st.dayOff.find(o => o.day === en.day && (o.factoryId === 'all' || o.factoryId === line.factoryId));
    const chip = part === 'full' ? '<span class="st st-ok">يوم كامل</span>' : part === 'half' ? '<span class="st st-info">نص يوم</span>' : '<span class="st st-off">لسه مبدأش</span>';
    let html = `<section class="glass card"><div class="dv-h"><div><h2>${esc(line.name)}</h2><div class="sub">${esc(f.name || '')}${line.morningTime ? ' · الصبح ' + esc(O.hm12(line.morningTime)) : ''}${line.eveningTime ? ' · الرجوع ' + esc(O.hm12(line.eveningTime)) : ''}</div></div>${chip}</div>`;
    if (en.isSub) html += `<div class="banner warn" style="margin-bottom:10px">${TP.icon('users')}<span>إنت السواق البديل على الخط ده النهارده.</span></div>`;
    if (en.day !== today) html += `<div class="banner info" style="margin-bottom:10px">${TP.icon('clock')}<span>ده يوم امبارح — لسه مخلصش.</span></div>`;
    if (off) html += `<div class="banner warn" style="margin-bottom:10px">${TP.icon('calendar')}<span>${off.type === 'cancelled' ? 'الإدارة لغت شغل النهارده' : 'النهارده إجازة'}${off.note ? ' — ' + esc(off.note) : ''}</span></div>`;
    if (line.notes) html += `<p class="small muted" style="margin-bottom:10px">${TP.icon('file', 15)} ${esc(line.notes)}</p>`;
    const next = steps[ni];
    if (next) {
      const pk = `${line.id}|${en.day}|${next.key}`, armed = st.armed === pk;
      const sub = armed ? 'دوس تاني للتأكيد' : (next.guests && next.guests.length && next.kind === 'arr' ? next.guests.length + ' عميل: ' + next.guests.slice(0, 4).join('، ') + (next.guests.length > 4 ? '…' : '') : (next.note || ''));
      html += `<button type="button" class="act ${armed ? 'armed' : ''}" data-press="${esc(pk)}">${TP.icon(next.kind === 'end' ? 'check' : next.kind === 'dep' ? 'arrow' : 'pin', 30)}<span><b>${esc(next.label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${armed ? '' : `<small>${distSpan(next.loc)}</small>`}</span></button>`;
      if (next.target === 'point') html += pointCustomers(line, en, next, ev);
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
    const skipped = (line.points || []).filter((p, i) => skipSet(line, en.day).has(i) && !ev[`p${i}_arr`]);
    if (skipped.length) html += `<div class="banner info" style="margin-top:10px">${TP.icon('users')}<span>مش هتعدي على: ${skipped.map(p => esc(p.name)).join('، ')} — العملاء قالوا مش راكبين النهارده.</span></div>`;
    // timeline
    html += `<ol class="tl">${steps.map((s, i) => {
      const e = ev[s.key], cls = e ? 'done' : i === ni ? 'next' : i < ni ? 'skipped' : '';
      const pk = `${line.id}|${en.day}|${s.key}`;
      const locked = s.phase === 'e' && !ev.fm_arr;   // the evening comes after the morning factory arrival
      const right = e ? `<span class="time">${esc(TP.fmtTime(e.at))}</span>`
        : i === ni || locked ? '' : `<button type="button" class="rec ${st.armed === pk ? 'armed' : ''}" data-press="${esc(pk)}">${st.armed === pk ? 'أكّد' : 'سجّل'}</button>`;
      const guests = s.kind === 'arr' && s.target === 'point' && s.guests.length ? `<div class="guests">${s.custs.map(c => esc(c.name) + (c.h && skipsDay(c, en.day) ? ' <span class="badge-s nogps">مش راكب</span>' : '')).join(' · ')}</div>` : '';
      return `<li class="${cls}"><span class="dot">${e ? '✓' : i + 1}</span><div><b>${esc(s.label)}</b>
        <div class="meta">${stepBadges(e)}${!e && s.kind !== 'end' ? mapLink(s.loc, s.target === 'factory' ? 'لوكيشن المصنع' : 'لوكيشن النقطة') : ''}${!e && i < ni ? '<span class="badge-s far">اتعدّت</span>' : ''}</div>${guests}</div>${right}</li>`;
    }).join('')}</ol></section>`;
    return html;
  }

  /** The customers of the point the car is going to / standing at: call, WhatsApp, "مجاش". */
  function pointCustomers(line, en, step, ev) {
    const cs = O.custsOf((line.points || [])[step.i]).filter(c => c.name);
    if (!cs.length) return '';
    const arr = ev[`p${step.i}_arr`], waited = arr ? (TP.now() - arr.at) / 60000 : 0, doc = en.doc || {};
    return `<div class="custs">${cs.map(c => custRow(c, en.day, {
      noshowOk: !!arr && !ev[`p${step.i}_dep`] && waited >= (Number(st.settings.noShowWaitMin) || 5) && !O.riderOf(doc, c.id),
      rider: O.riderOf(doc, c.id), key: `l|${line.id}|${en.day}|${c.id}`, where: step.name, arrived: !!arr
    })).join('')}</div>`;
  }
  function custRow(c, day, o) {
    const t = c.h ? st.track[c.h] : null, today = t && t.day === day;
    const skip = !!c.h && O.skipsOn(t, day);
    const seen = today && t.ack && t.ack.seq === t.seq && ['arrived', 'evening', 'near'].includes(t.st);
    const rider = o.rider;
    const chip = skip ? '<span class="st st-off">قال مش راكب</span>' : rider && rider.s === 'noshow' ? '<span class="st st-danger">مجاش</span>' : rider && rider.s === 'picked' ? '<span class="st st-ok">ركب</span>'
      : seen ? '<span class="st st-ok">شاف الرسالة ✓</span>' : today && t.st === 'arrived' ? '<span class="st st-warn">لسه مشافش</span>' : '';
    const msg = o.arrived ? `أنا وصلت 🚗 ومستنيك عند ${o.where || ''}.` : 'أنا في الطريق ليك 🚗.';
    const wa = c.phone ? TP.waLink(c.phone, `${msg}\nالسواق ${S.person.name}${S.person.code ? ' — كود ' + S.person.code : ''} من Three Pyramids Travel\nتابع العربية من اللينك اللي وصلك من الشركة.`) : '';
    const noPush = c.h && t && !t.fcm;
    const said = t && t.cust ? (t.cust.out ? '<span class="st st-ok">العميل طالع من الصالة ✓</span>' : t.cust.landed ? '<span class="st st-info">العميل نزل من الطيارة ✓</span>' : '') : '';
    const home = c.home && isFinite(c.home.lat) ? ` <a class="small" href="https://www.google.com/maps/search/?api=1&query=${c.home.lat},${c.home.lng}" target="_blank" rel="noopener">البيت 📍</a>` : '';
    return `<div class="cust"><div class="cust-n"><b>${esc(c.name)}</b>${home}${chip}${said}${noPush && !skip ? '<small class="muted">ماعندوش إشعارات — ابعتله واتساب</small>' : ''}</div>
      <div class="cust-a">${c.phone ? `<a class="icon-btn" href="${esc(TP.telLink(c.phone))}" title="اتصل">${TP.icon('phone', 18)}</a>` : ''}${wa ? `<a class="btn btn-sm ${noPush ? 'btn-primary' : 'btn-ghost'}" href="${esc(wa)}" target="_blank" rel="noopener">واتساب</a>` : ''}
        ${o.pickOk ? `<button type="button" class="btn btn-sm btn-primary ${st.armed === 'pk' + o.key ? 'armed' : ''}" data-pick="${esc(o.key)}">${st.armed === 'pk' + o.key ? 'أكّد' : 'ركب'}</button>` : ''}
        ${o.noshowOk && !skip ? `<button type="button" class="btn btn-sm btn-ghost" data-noshow="${esc(o.key)}">مجاش</button>` : ''}
        ${o.m && c.lang && c.lang !== 'ar' ? `<button type="button" class="btn btn-sm btn-gold" data-guestm="${esc(o.key)}">${esc(TP.i18n.info(c.lang).name)} — رسالة</button>` : ''}</div></div>`;
  }
  function bindCustomers(root) {
    root.querySelectorAll('[data-noshow]').forEach(b => b.onclick = () => {
      const [k, oid, day, cid] = b.dataset.noshow.split('|');
      if (k === 'l') { const en = todayEntries().find(x => x.line.id === oid && x.day === day); const c = en && O.lineCustomers(en.line).find(x => x.id === cid); if (c) noShow('line', en.line, c, day).catch(e => TP.toast(TP.errorText(e), 'warn')); }
      else { const m = allMissions().find(x => x.id === oid); const c = m && (m.customers || []).find(x => x.id === cid); if (c) noShow('mission', m, c, m.day).catch(e => TP.toast(TP.errorText(e), 'warn')); }
    });
    root.querySelectorAll('[data-guestm]').forEach(b => b.onclick = () => {
      const [, oid, , cid] = b.dataset.guestm.split('|'), m = allMissions().find(x => x.id === oid), c = m && (m.customers || []).find(x => x.id === cid);
      if (c) TP.guest.compose(m, c, null, S.person);   // the driver has no link to send — the ready messages + "ترجم وابعت"
    });
    root.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
      const [, oid, , cid] = b.dataset.pick.split('|'), m = allMissions().find(x => x.id === oid), c = m && (m.customers || []).find(x => x.id === cid);
      if (c) armOrRun('pk' + b.dataset.pick, () => picked(m, c));
    });
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
  function flightHtml(m) {
    const fl = m.flight; if (!fl || !fl.no) return '';
    const t = TP.flight.when(fl);
    return `<div class="flight"><b dir="ltr">✈ ${esc(fl.no)}</b><span>${fl.dir === 'arr' ? 'استقبال' : 'توصيل'}${fl.other ? (fl.dir === 'arr' ? ' — جاية من ' : ' — رايحة ') + esc(fl.other) : ''}</span>
      ${t ? `<span>${fl.dir === 'arr' ? 'الهبوط' : 'الإقلاع'} <b>${esc(TP.fmtTime(t))}</b>${fl.delayMin >= 10 ? ` <span class="badge-s far">متأخرة ${fl.delayMin} د</span>` : ''}</span>` : '<span class="muted">الميعاد لسه جاي</span>'}
      ${fl.terminal ? `<span>صالة <b>${esc(fl.terminal)}</b></span>` : ''}${fl.status ? `<span class="muted">${esc(TP.flight.statusName(fl.status))}</span>` : ''}${fl.src === 'api' ? '<span class="muted" style="font-size:11px">بيانات الرحلات: AeroDataBox</span>' : ''}</div>`;
  }
  function renderMissions() {
    const root = TP.$('#tab-missions'), today = TP.dayKey(TP.now());
    const list = allMissions().filter(m => m.status !== 'cancelled').sort((a, b) => (a.day + (a.time || '')).localeCompare(b.day + (b.time || '')));
    const open = list.filter(m => m.status !== 'done'), done = list.filter(m => m.status === 'done').reverse().slice(0, 15);
    const card = m => {
      const f = st.companies[m.factoryId], steps = O.missionSteps(m);
      const ev = m.events || {}, ni = O.nextIndex(steps, ev), next = steps[ni];
      const s = O.MISSION_STATUS[m.status] || ['', 'st-off'];
      const pay = seesMoney() && st.missionPay[m.id] !== undefined ? `<span class="tag gold">${esc(TP.money(st.missionPay[m.id]))}</span>` : '';
      const active = m.status === 'active' || (m.status === 'assigned' && m.day <= today);
      let action = '';
      if (next && m.status !== 'done') {
        if (m.day > today) action = `<div class="banner info" style="margin-top:10px">${TP.icon('calendar')}<span>ميعاده ${esc(TP.fmtDay(m.day + 'T12:00:00'))}</span></div>`;
        else {
          const pk = 'm|' + m.id + '|' + next.key, armed = st.armed === pk;
          action = `<button type="button" class="act ${armed ? 'armed' : ''}" data-mpress="${esc(pk)}">${TP.icon(next.key === 'done' ? 'check' : next.key === 'start' ? 'arrow' : 'pin', 26)}<span><b>${esc(next.label)}</b><small>${armed ? 'دوس تاني للتأكيد' : distSpan(next.loc)}</small></span></button>`;
        }
      }
      // customers: after "وصلت مكان العميل" each one is "ركب" or "مجاش"
      const atPickup = !!ev.pickup && !ev.arrive, waited = ev.pickup ? (TP.now() - ev.pickup.at) / 60000 : 0;
      const custs = (m.customers || []).length && active ? `<div class="custs">${(m.customers || []).map(c => custRow(c, m.day, {
        rider: O.riderOf(m, c.id), key: `m|${m.id}|${m.day}|${c.id}`, arrived: !!ev.pickup, where: (m.from && m.from.name) || '', m,
        pickOk: atPickup && !O.riderOf(m, c.id), noshowOk: atPickup && waited >= (Number(st.settings.noShowWaitMin) || 5) && !O.riderOf(m, c.id)
      })).join('')}</div>` : (m.customers || []).length ? `<div class="small"><b>العملاء:</b> ${(m.customers || []).map(c => esc(c.name)).join('، ')}</div>` : '';
      const air = m.type === 'airport' && m.flight;
      const extras = active && m.status !== 'done' || (m.status === 'done' && m.day === today) ? `<div class="ms-tools">
          ${air && air.dir === 'arr' && (m.customers || []).length ? `<button type="button" class="btn btn-gold btn-sm" data-sign="${esc(m.id)}">${TP.icon('users', 16)}لافتة الاسم</button><label class="btn btn-ghost btn-sm">${TP.icon('plus', 16)}صوّر اللافتة للضيف<input type="file" accept="image/*" capture="environment" data-signph="${esc(m.id)}" hidden></label>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-exp="${esc(m.id)}">${TP.icon('money', 16)}مصروف (باركينج / كارتة)</button></div>` : '';
      const cash = m.cash ? (m.cashGot ? `<div class="banner ok" style="margin-top:8px">${TP.icon('check')}<span>استلمت ${esc(TP.money(m.cash.amount))} كاش ✓</span></div>`
        : `<div class="banner warn" style="margin-top:8px">${TP.icon('money')}<span class="grow">استلم من العميل <b>${esc(TP.money(m.cash.amount))}</b> كاش${m.cash.note ? ' — ' + esc(m.cash.note) : ''}</span>${ev.pickup || ev.arrive || ev.done ? `<button type="button" class="btn btn-primary btn-sm ${st.armed === 'cash' + m.id ? 'armed' : ''}" data-cash="${esc(m.id)}">${st.armed === 'cash' + m.id ? 'أكّد' : 'استلمت'}</button>` : ''}</div>`) : '';
      return `<div class="ms"><div class="ms-when"><b>${esc(TP.fmtDay(m.day + 'T12:00:00'))}${m.time ? ' · ' + esc(O.hm12(m.time)) : ''}</b><span class="st ${s[1]}">${s[0]}</span></div>
        <div style="font-weight:900;font-size:16px">${air ? '✈ ' : ''}${esc(m.title || 'مشوار')} ${pay}</div>
        ${f || m.client ? `<div class="muted small">${esc(f ? f.name : m.client)}</div>` : ''}
        ${flightHtml(m)}
        <div class="ms-route">${TP.icon('pin', 16)}<div>من: ${esc((m.from && m.from.name) || '—')} ${mapLink(m.from && m.from.location, '')}</div>
          ${TP.icon('map', 16)}<div>إلى: ${esc((m.to && m.to.name) || '—')} ${mapLink(m.to && m.to.location, '')}</div></div>
        ${m.guests ? `<div class="small"><b>الضيوف:</b> ${esc(m.guests)}</div>` : ''}
        ${m.notes ? `<div class="small muted">${esc(m.notes)}</div>` : ''}
        ${Object.keys(ev).length ? `<div class="meta small muted" style="margin-top:6px">${steps.filter(x => ev[x.key]).map(x => `${esc(x.short)} ${esc(TP.fmtTime(ev[x.key].at))} ${stepBadges(ev[x.key])}`).join(' · ')}</div>` : ''}
        ${custs}${cash}${action}${extras}</div>`;
    };
    root.innerHTML = `<section class="glass card"><div class="dv-h"><h2>المشاوير</h2></div>${open.length ? open.map(card).join('') : '<div class="empty">مفيش مشاوير عليك دلوقتي.</div>'}</section>
      ${st.myExpenses.length ? `<section class="glass card"><div class="dv-h"><h2>مصاريفي الشهر ده</h2></div>${st.myExpenses.map(x => `<div class="exp-row"><span>${esc((EXP[x.kind] || x.kind))} — ${esc(TP.money(x.amount))}<small class="muted"> ${esc(x.day)}</small></span><span class="st ${x.status === 'approved' ? 'st-ok' : x.status === 'rejected' ? 'st-danger' : 'st-warn'}">${x.status === 'approved' ? 'اتقبل' : x.status === 'rejected' ? 'اترفض' + (x.decisionNote ? ': ' + esc(x.decisionNote) : '') : 'مستني'}</span></div>`).join('')}</section>` : ''}
      ${done.length ? `<section class="glass card"><div class="dv-h"><h2>اللي خلص</h2></div>${done.map(card).join('')}</section>` : ''}`;
    const find = id => allMissions().find(x => x.id === id);
    root.querySelectorAll('[data-mpress]').forEach(b => b.onclick = () => {
      const [, mid, key] = b.dataset.mpress.split('|');
      const m = find(mid), step = m && O.missionSteps(m).find(x => x.key === key);
      if (m && step) armOrRun(b.dataset.mpress, () => recordMission(m, step));
    });
    root.querySelectorAll('[data-sign]').forEach(b => b.onclick = () => showSign(find(b.dataset.sign)));
    root.querySelectorAll('[data-signph]').forEach(i => i.onchange = () => { const f = i.files && i.files[0]; if (f) signPhoto(find(i.dataset.signph), f); });
    root.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => addExpense(find(b.dataset.exp)));
    root.querySelectorAll('[data-cash]').forEach(b => b.onclick = () => { const m = find(b.dataset.cash); if (!m || !m.cash) return; armOrRun('cash' + m.id, () => track(TP.fb.update('missions/' + m.id, { cashGot: { at: TP.now(), sv: TP.fb.ts(), amount: m.cash.amount }, updatedAt: TP.fb.ts() }), 'اتسجل استلام الكاش ✓')); });
    bindCustomers(root);
  }
  /** Arrivals hall: the phone becomes a big name board. */
  function showSign(m) {
    if (!m) return;
    let o = TP.$('#signOv');
    if (!o) { o = document.createElement('div'); o.id = 'signOv'; o.className = 'sign-ov'; document.body.appendChild(o); }
    o.innerHTML = `<img src="../shared/logo.png" alt="Three Pyramids Travel"><div class="sign-names">${(m.customers || []).map(c => `<div>${esc(c.name)}</div>`).join('')}</div>
      <div class="sign-sub">THREE PYRAMIDS TRAVEL</div><button type="button" class="btn btn-ghost" id="signClose">قفل</button>`;
    o.hidden = false;
    try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); } catch (e) { /* not allowed */ }
    TP.$('#signClose', o).onclick = () => { o.hidden = true; try { document.fullscreenElement && document.exitFullscreen(); } catch (e) { /* ignore */ } };
  }
  /**
   * The photo of the sign in the arrivals hall: it shows on each guest's page with
   * "Your driver is waiting for you in front of the arrivals hall", and can go to the car's group.
   */
  async function signPhoto(m, file) {
    if (!m) return;
    let photo;
    try { photo = await TP.compressImage(file, 1000, 0.6); if (photo.length > 380000) photo = await TP.compressImage(file, 720, 0.5); } catch (e) { return TP.toast('الصورة مش مقروءة', 'warn'); }
    if (photo.length > 380000) return TP.toast('الصورة كبيرة — صوّرها تاني من قريب', 'warn');
    const hs = (m.customers || []).map(c => c.h).filter(h => /^[0-9a-f]{64}$/.test(h || ''));
    track(Promise.all(hs.map(h => TP.fb.set('signs/' + h, { photo, missionId: m.id, driverId: me(), at: TP.now() }))), 'الصورة وصلت للضيف ✓');
    // to the car's group too (the phone's share sheet → WhatsApp)
    try {
      const blob = await (await fetch(photo)).blob(), f = new File([blob], 'sign.jpg', { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [f] }) && await TP.confirm('تبعتها للجروب؟', 'الصورة وصلت لصفحة الضيف. تحب تبعتها لجروب العربية كمان؟', 'ابعت')) await navigator.share({ files: [f], text: `لافتة ${(m.customers || []).map(c => c.name).join('، ')} — ${(m.flight && m.flight.no) || ''}` });
    } catch (e) { /* sharing cancelled or not available */ }
  }
  const EXP = { parking: 'باركينج', toll: 'كارتة', fuel: 'بنزين', other: 'مصروف تاني' };
  /** Parking / toll paid by the driver: amount + the receipt photo → management approves. */
  function addExpense(m) {
    let photo = null, kindSel = 'parking';
    TP.openModal('تسجيل مصروف', `<div class="opt-list" style="grid-template-columns:repeat(2,1fr)">${Object.keys(EXP).map(k => `<button type="button" class="opt ${k === 'parking' ? 'on' : ''}" data-ek="${k}">${esc(EXP[k])}</button>`).join('')}</div>
      <label class="fld" style="margin-top:10px">المبلغ (جنيه)<input class="input" id="eAmt" inputmode="decimal" dir="ltr"></label>
      <label class="fld" style="margin-top:10px">ملاحظة (اختياري)<input class="input" id="eNote" maxlength="200"></label>
      <label class="btn btn-ghost btn-block" style="margin-top:10px">${TP.icon('plus', 18)}صوّر الإيصال<input type="file" accept="image/*" capture="environment" id="ePhoto" hidden></label>
      <div id="ePrev" class="muted small" style="margin-top:6px"></div>`, async () => {
      const amt = TP.num(TP.ui_val('eAmt'));
      if (!(amt > 0 && amt <= 100000)) { TP.toast('اكتب المبلغ'); return false; }
      if (!photo && !(await TP.confirm('من غير إيصال؟', 'المصروف من غير صورة الإيصال ممكن يترفض. تكمل؟', 'كمّل'))) return false;
      const day = TP.dayKey(TP.now()), data = { driverId: me(), missionId: m ? m.id : '', lineId: '', day, month: O.monthOf(day), kind: kindSel, amount: Math.round(amt * 100) / 100, note: TP.ui_val('eNote').slice(0, 200), at: TP.now(), sv: TP.fb.ts(), status: 'pending' };
      if (photo) data.photo = photo;
      track(TP.fb.add('expenses', data), 'المصروف اتبعت للإدارة ✓');
    }, { saveLabel: 'ابعت', noFocus: true });
    TP.$$('#tp-modal [data-ek]').forEach(b => b.onclick = () => { kindSel = b.dataset.ek; TP.$$('#tp-modal [data-ek]').forEach(x => x.classList.toggle('on', x === b)); });
    TP.$('#ePhoto').onchange = async e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try { photo = await TP.compressImage(f, 1000, 0.6); if (photo.length > 380000) photo = await TP.compressImage(f, 700, 0.5); if (photo.length > 380000) { photo = null; TP.toast('الصورة كبيرة — صوّرها تاني من قريب', 'warn'); return; } TP.$('#ePrev').innerHTML = `<img src="${esc(photo)}" alt="" style="max-width:100%;max-height:180px;border-radius:12px">`; } catch (err) { TP.toast('الصورة مش مقروءة', 'warn'); }
    };
  }

  /* ---------- حسابي ---------- */
  async function loadAccount(month) {
    st.acct = { month, data: null, loading: true, error: '' }; render();
    const w = [['driverId', '==', me()], ['month', '==', month]];
    try {
      const [days, missions, pay, rates, adj, dpay] = await Promise.all([
        TP.fb.list('days', { where: w }), TP.fb.list('missions', { where: w }),
        seesMoney() ? TP.fb.list('missionDriver', { where: w }) : [],
        seesMoney() ? TP.fb.get('driverRates/' + me()) : null,
        seesMoney() ? TP.fb.list('adjustments', { where: w }) : [],
        seesMoney() ? TP.fb.list('dayPay', { where: w }) : []
      ]);
      const missionPay = {}; pay.forEach(x => { missionPay[x.id] = x.amount; });
      const dayPay = {}; dpay.forEach(x => { dayPay[x.id] = x.amount; });
      if (st.acct.month !== month) return;
      st.acct.data = O.statement({ days, missions, missionPay, rateHistory: (rates && rates.history) || [], adjustments: adj, dayPay, manualDays: kind() === 'external' });
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


  /* ---------- wake-up ---------- */
  const WK = () => TP.wakeCore;
  /** My next wake-up: the first job of today (if not over) or tomorrow. */
  function myWake() {
    const now = TP.now(), today = TP.dayKey(now), s = Object.assign({}, WK().DEFAULTS, st.settings);
    const seen = new Set(), lines = st.linesMain.concat(st.linesSub).filter(l => !seen.has(l.id) && seen.add(l.id));
    for (const day of [today, O.addDays(today, 1)]) {
      const job = WK().firstJob(day, me(), { lines, missions: allMissions(), dayOff: st.dayOff });
      if (!job || now > job.at + 2 * 3600000) continue;
      const lead = WK().leadMin(S.person, s);
      return { day, job, lead, wakeAt: job.at - lead * 60000, ack: st.acks[day] || null, today };
    }
    return null;
  }
  function wakeCard() {
    const w = myWake(), push = TP.push.state();
    const pushHtml = push === 'granted' ? '' : push === 'denied'
      ? `<div class="banner danger">${TP.icon('bell')}<span>التنبيهات مقفولة — افتحها من إعدادات المتصفح لموقعنا، علشان المنبه يوصلك والموبايل مقفول.</span></div>`
      : push === 'unsupported' ? `<div class="banner warn">${TP.icon('bell')}<span>المتصفح ده مش بيدعم التنبيهات — افتح التطبيق من Chrome.</span></div>`
        : `<div class="banner warn">${TP.icon('bell')}<span style="flex:1">فعّل التنبيهات علشان منبه الصحيان يوصلك</span><button type="button" class="btn btn-primary btn-sm" id="wPush">فعّل</button></div>`;
    if (!w) return pushHtml ? `<section class="glass card wake-card">${pushHtml}</section>` : '';
    const awake = w.ack && w.ack.awakeAt, ready = w.ack && w.ack.readyAt, tomorrow = w.day !== w.today;
    const evening = TP.now() >= WK().cairoMs(w.today, '16:00');
    return `<section class="glass card wake-card">
      <div class="wake-row">${TP.icon('alarm', 30)}<div style="flex:1"><div class="muted small">ميعاد صحيانك ${tomorrow ? 'بكره' : 'النهارده'}</div><div class="wake-time">${esc(WK().hm12(w.wakeAt))}</div></div>
        ${awake ? `<span class="st st-ok">صحيت ${esc(TP.fmtTime(w.ack.awakeAt))}</span>` : ready ? '<span class="st st-ok">جاهز ✓</span>' : ''}</div>
      <div class="small">${esc(w.job.label)} الساعة <b>${esc(WK().hm12(w.job.at))}</b> — المنبه قبلها بـ ${w.lead >= 60 ? Math.round(w.lead / 6) / 10 + ' ساعة' : w.lead + ' دقيقة'}</div>
      ${pushHtml}
      ${tomorrow && evening && !ready ? `<button type="button" class="act" id="wReady">${TP.icon('check', 28)}<span><b>جاهز لبكره</b><small>اتأكد إن الموبايل مشحون والتنبيهات شغالة</small></span></button>` : ''}
      ${kind() === 'line' && !awake ? `<button type="button" class="btn btn-ghost btn-block" id="wChange">${TP.icon('clock', 18)}غيّر ميعاد صحياني</button>` : ''}
    </section>`;
  }
  async function battery() { try { if (navigator.getBattery) { const b = await navigator.getBattery(); return Math.round(b.level * 100); } } catch (e) { /* no battery API */ } return null; }
  async function markReady() {
    const w = myWake(); if (!w) return;
    const data = { driverId: me(), day: w.day, readyAt: TP.now(), readySv: TP.fb.ts(), notif: TP.push.state(), geo: st.gps };
    const b = await battery(); if (b !== null) data.battery = b;
    track(TP.fb.set('wakeAcks/' + w.day + '_' + me(), data, true), 'تمام — تصبح على خير 🌙');
    if (b !== null && b < (Number(st.settings.lowBatteryPct) || 20)) TP.toast('البطارية ' + b + '% — حط الموبايل على الشاحن', 'warn');
  }
  function markAwake(w, method) {
    if (st.inflight.has('awake' + w.day)) return;
    st.inflight.add('awake' + w.day);
    stopRing();
    const p = TP.fb.set('wakeAcks/' + w.day + '_' + me(), { driverId: me(), day: w.day, awakeAt: TP.now(), awakeSv: TP.fb.ts(), method }, true);
    track(p, method === 'pressed' ? 'صباح الفل ☀️ يوم موفق' : '');
    p.catch(() => {}).finally(() => st.inflight.delete('awake' + w.day));
    st.acks[w.day] = Object.assign({}, st.acks[w.day] || {}, { awakeAt: TP.now(), method });
    checkWake();
  }
  function changeWake() {
    const w = myWake(); if (!w) return;
    TP.openModal('ميعاد صحياني', `<p class="modal-text" style="margin-bottom:10px">${esc(w.job.label)} الساعة ${esc(WK().hm12(w.job.at))}. اختار الساعة اللي تحب المنبه يرن فيها (من نص ساعة لـ 6 ساعات قبل الشغل). بيتغيّر لكل الأيام الجاية.</p>
      <label class="fld">المنبه يرن الساعة<input class="input" type="time" id="wTime" value="${esc(WK().hm(w.wakeAt))}"></label>`, async () => {
      const v = TP.ui_val('wTime');
      if (!/^\d{2}:\d{2}$/.test(v)) { TP.toast('اختار الساعة'); return false; }
      let ms = WK().cairoMs(w.day, v);
      if (ms > w.job.at) ms -= 86400000;
      const lead = Math.round((w.job.at - ms) / 60000);
      if (lead < 30 || lead > 360) { TP.toast('لازم يكون من نص ساعة لـ 6 ساعات قبل الشغل'); return false; }
      if (!(await S.confirmPin('تأكيد ميعاد الصحيان بالرقم السري'))) return false;
      await TP.fb.update('people/' + me(), { wakeLeadMin: lead });
      TP.fb.set('wake/' + w.day, { rebuildDriver: true, day: w.day }, true).catch(() => {});
      TP.toast('ميعادك الجديد ' + WK().hm12(ms) + ' ✓ — المنبه بيتظبط عليه خلال نص ساعة');
    }, { saveLabel: 'حفظ' });
  }
  /* the full-screen "صباح الخير" — rings while the app is open */
  let ringTimer = null, audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      for (let i = 0; i < 4; i++) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + i * 0.25;
        o.type = 'square'; o.frequency.value = i % 2 ? 990 : 740; g.gain.value = 0.12;
        o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.18);
      }
    } catch (e) { /* no sound */ }
    try { navigator.vibrate && navigator.vibrate([500, 200, 500]); } catch (e) { /* no vibration */ }
  }
  function startRing() { if (!ringTimer) { beep(); ringTimer = setInterval(beep, 2000); } }
  function stopRing() { clearInterval(ringTimer); ringTimer = null; try { navigator.vibrate && navigator.vibrate(0); } catch (e) { /* ignore */ } }
  function checkWake(forceRing) {
    const ov = TP.$('#wakeOv'); if (!ov || !S.ready) return;
    const w = myWake(), now = TP.now();
    const show = !!w && !(w.ack && w.ack.awakeAt) && now >= w.wakeAt - 30 * 60000 && now <= w.job.at + 2 * 3600000;
    if (!show) { ov.hidden = true; ov.innerHTML = ''; stopRing(); return; }
    // opened the app inside the wake window → he is awake
    if (!document.hidden && st.openedAt >= w.wakeAt - 15 * 60000 && TP.now() - st.openedAt >= 3000) { markAwake(w, 'opened'); return; }
    if (ov.hidden || !ov.dataset.key || ov.dataset.key !== w.day) {
      ov.dataset.key = w.day;
      ov.innerHTML = `<div class="sun">☀️</div><h1>صباح الخير يا ${esc((S.person.name || '').split(' ')[0])}</h1>
        <p>${esc(w.job.label)} الساعة ${esc(WK().hm12(w.job.at))}<br>ميعاد صحيانك ${esc(WK().hm12(w.wakeAt))}</p>
        <button type="button" class="big" id="gmBtn">صباح الخير</button>
        <p class="small">لو مش هتقدر تشتغل النهارده، كلّم المشرف على طول</p>`;
      ov.hidden = false;
      TP.$('#gmBtn', ov).onclick = () => markAwake(myWake() || w, 'pressed');
    }
    if (now >= w.wakeAt || forceRing) startRing();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { st.openedAt = TP.now(); setTimeout(() => checkWake(), 3200); } });
  document.addEventListener('tp:push', e => {
    const d = (e.detail && e.detail.data) || {};
    if (d.type === 'wake') checkWake(true);
    else if (e.detail && e.detail.notification && e.detail.notification.title) TP.toast(e.detail.notification.title);
  });
  document.addEventListener('tp:push-state', () => render());
  setInterval(() => { if (S.ready) checkWake(); }, 10000);

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
  /** What the other parts of the driver app (fleet.js) may use. */
  TP.dv = { settings: () => st.settings, queue: () => queue(), render: () => render(), track: (p, msg) => track(p, msg) };

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
    TP.$('#meKind').textContent = (S.person.code ? 'كود ' + S.person.code + ' · ' : '') + TP.driverKindName(kind());
    st.acct = { month: null, data: null, loading: false, error: '' };
    st.subsKey = '';
    subscribe();
    startGps();
    render();
  });
  document.addEventListener('tp:session-end', () => {
    TP.$('#app').hidden = true; stop(); stopTrack(); st.subsKey = ''; if (TP.dvCar) TP.dvCar.stop();
    if (watchId !== null && navigator.geolocation) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  });
  S.start({ kind: 'driver', base: '../shared/' });
})(window.TP = window.TP || {});
