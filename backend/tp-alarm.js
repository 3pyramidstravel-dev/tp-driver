/* tp-alarm — built 2026-10-11T00:38Z. Paste this whole file into the Cloudflare editor. */
/* ==========================================================================
   Wake-up core — pure logic shared by the driver app, the Control Tower AND
   the cloud alarm (Cloudflare worker, which inlines this file).
   No DOM, no Firebase. Times are epoch ms; days are 'YYYY-MM-DD' in Cairo.

   Plan document:  wake/{day}  (built by the cloud alarm, day = day of the job)
     d.{personId} = { name, code, kind, phone, job:{type:'line'|'mission', id, label, at},
                      leadMin, wakeAt, watch, tokens[],
                      // filled while it runs:
                      p1, p2, supAt, mgmtAt, remind, awakeAt, awakeMethod,
                      claim:{by, at}, outcome:{type:'woke'|'replaced', by, at, subId}, gone }
     notify = { sup:[tokens], mgmt:[tokens] }
   Driver acknowledgement:  wakeAcks/{day}_{personId}  { readyAt, awakeAt, method, … }
   ========================================================================== */
(function (root) {
  'use strict';
  const TZ = 'Africa/Cairo';
  const W = {};

  /* ---------- Cairo time ---------- */
  const fmtParts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function wall(ms) { const o = {}; fmtParts.formatToParts(new Date(ms)).forEach(p => { if (p.type !== 'literal') o[p.type] = Number(p.value); }); o.hour %= 24; return o; }
  function offsetAt(ms) { const w = wall(ms); return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000; }
  const memo = new Map();
  W.cairoMs = (day, hhmm) => {
    const key = day + ' ' + hhmm;
    if (memo.has(key)) return memo.get(key);
    const [y, m, d] = day.split('-').map(Number), [h, mi] = String(hhmm).split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, h, mi);
    let ms = guess - offsetAt(guess); ms = guess - offsetAt(ms);
    if (memo.size > 2000) memo.clear();
    memo.set(key, ms);
    return ms;
  };
  W.dayKey = ms => { const w = wall(ms); return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`; };
  W.hm = ms => { const w = wall(ms); return String(w.hour).padStart(2, '0') + ':' + String(w.minute).padStart(2, '0'); };
  W.addDays = (day, n) => { const t = new Date(day + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  W.hm12 = ms => { const w = wall(ms); const h = w.hour % 12 || 12; return `${h}:${String(w.minute).padStart(2, '0')} ${w.hour >= 12 ? 'م' : 'ص'}`; };

  W.DEFAULTS = {
    wakeLeadHoursLine: 2, wakeLeadHoursTourism: 2, wakeResponseMin: 5, wakeEscalateMin: 8,
    wakeSecondMin: 2, watchLateCount: 3, watchSupMin: 2, readyReminderTime: '21:00', nightCheckTime: '22:00', wakeGiveUpMin: 180,
    claimTimeoutMin: 10
  };
  const S = s => Object.assign({}, W.DEFAULTS, s || {});

  /** Minutes before the job: the driver's own choice (line drivers, with their PIN) or the default for his kind. */
  W.leadMin = function (person, settings) {
    const s = S(settings);
    const own = Number(person && person.wakeLeadMin);
    if (own >= 30 && own <= 360) return Math.round(own);
    return Math.round(((person && person.driverKind === 'line') ? s.wakeLeadHoursLine : s.wakeLeadHoursTourism) * 60);
  };

  /** All jobs of `day` per driver: fixed lines (or the day's substitute) and assigned missions. */
  W.jobsOf = function (day, data) {
    const out = {};
    const add = (pid, job) => { if (!pid) return; (out[pid] = out[pid] || []).push(job); };
    const off = fid => (data.dayOff || []).some(o => o.day === day && (o.factoryId === 'all' || o.factoryId === fid));
    (data.lines || []).forEach(l => {
      if (l.active === false || !l.morningTime || !/^\d{2}:\d{2}$/.test(l.morningTime) || off(l.factoryId)) return;
      const pid = (l.subDay === day && l.subDriverId) ? l.subDriverId : l.driverId;
      add(pid, { type: 'line', id: l.id, label: l.name || 'الخط', at: W.cairoMs(day, l.morningTime) });
    });
    (data.missions || []).forEach(m => {
      if (m.day !== day || m.status !== 'assigned' || !m.time || !/^\d{2}:\d{2}$/.test(m.time)) return;
      add(m.driverId, { type: 'mission', id: m.id, label: m.title || 'مشوار', at: W.cairoMs(day, m.time) });
    });
    Object.keys(out).forEach(k => out[k].sort((a, b) => a.at - b.at));
    return out;
  };

  /** The driver's first job on `day` (what the alarm is for). */
  W.firstJob = (day, pid, data) => ((W.jobsOf(day, data)[pid]) || [])[0] || null;

  const DYNAMIC = ['p1', 'p2', 'supAt', 'mgmtAt', 'remind', 'awakeAt', 'awakeMethod', 'awakeKept', 'claim', 'outcome'];
  const hasHistory = e => DYNAMIC.some(k => e && e[k] !== undefined && e[k] !== null);

  /**
   * Builds the plan of `day`. Keeps what already happened (pushes, claims, outcomes) when the job is the same,
   * and keeps entries with history even if the job moved to someone else (marked gone) so the record stays.
   */
  W.buildPlan = function (day, data, prev) {
    const s = S(data.settings), jobs = W.jobsOf(day, data), people = {}, d = {};
    (data.people || []).forEach(p => { people[p.id] = p; });
    const tokensOf = pid => (data.devices || []).filter(x => x.personId === pid && x.active !== false && x.fcm).map(x => x.fcm);
    const late = (data.watch && data.watch.late) || {};
    const since = W.addDays(day, -30);
    Object.keys(jobs).forEach(pid => {
      const p = people[pid];
      if (!p || p.type !== 'driver' || p.active === false) return;
      const job = jobs[pid][0], lead = W.leadMin(p, s);
      const e = { name: p.name || '', code: p.code || null, kind: p.driverKind || '', phone: p.phone || '', job, leadMin: lead, wakeAt: job.at - lead * 60000,
        watch: (late[pid] || []).filter(x => x >= since && x < day).length >= s.watchLateCount, tokens: tokensOf(pid) };
      const old = prev && prev.d && prev.d[pid];
      if (old && old.job && old.job.id === job.id && old.job.at === job.at && old.wakeAt === e.wakeAt) DYNAMIC.forEach(k => { if (old[k] !== undefined) e[k] = old[k]; });
      else if (old && old.job && old.job.id === job.id) {
        // the same job moved (e.g. the flight changed): someone already awake stays awake, a decision stays
        if (W.validAwake(old, old.awakeAt)) { e.awakeAt = old.awakeAt; e.awakeMethod = old.awakeMethod || 'pressed'; e.awakeKept = true; }
        if (old.outcome) e.outcome = old.outcome;
      }
      d[pid] = e;
    });
    if (prev && prev.d) Object.keys(prev.d).forEach(pid => { if (!d[pid] && hasHistory(prev.d[pid])) d[pid] = Object.assign({}, prev.d[pid], { gone: true }); });
    const staff = (data.people || []).filter(p => p.type === 'staff' && p.active !== false);
    const has = (p, k) => Array.isArray(p.perms) && (p.perms.includes('all') || p.perms.includes(k));
    const sup = staff.filter(p => has(p, 'wake.supervise')).flatMap(p => tokensOf(p.id));
    const mgmt = staff.filter(p => (p.perms || []).includes('all') || p.role === 'gm' || p.role === 'operations').flatMap(p => tokensOf(p.id));
    return { day, d, notify: { sup: Array.from(new Set(sup)), mgmt: Array.from(new Set(mgmt)) } };
  };

  /** Where a driver's wake-up stands right now (for screens and for the alarm). */
  /** An "awake" only counts if it came near the alarm (not pressed the night before). */
  W.validAwake = (e, at) => !!at && ((e.awakeKept && at === e.awakeAt) || at >= e.wakeAt - 30 * 60000);
  /** Lateness is counted from the first ring (or the wake time when already rung on time). */
  W.lateMin = (e, now) => e.p1 ? (now - Math.max(e.wakeAt, e.p1)) / 60000 : 0;
  W.status = function (e, ack, now, settings) {
    const s = S(settings);
    if (!e || e.gone) return 'gone';
    if (e.outcome && e.outcome.type === 'replaced') return 'replaced';
    if (e.outcome && e.outcome.type === 'woke') return 'woke';
    if (W.validAwake(e, e.awakeAt) || (ack && W.validAwake(e, ack.awakeAt))) return 'awake';
    if (now > e.job.at + s.wakeGiveUpMin * 60000) return 'expired';
    if (now < e.wakeAt) return 'upcoming';
    const mins = W.lateMin(e, now);
    const supMin = e.watch ? s.watchSupMin : s.wakeResponseMin;
    if (e.claim) return 'claimed';
    if (mins >= s.wakeEscalateMin) return 'escalated';
    if (mins >= supMin) return 'late';
    return 'waiting';
  };
  W.STATUS = {
    upcoming: ['جاي', 'st-info'], waiting: ['مستني صباح الخير', 'st-warn'], late: ['متأخر — محتاج مشرف', 'st-danger'],
    escalated: ['متأخر — وصل للإدارة', 'st-danger'], claimed: ['المشرف ماسكه', 'st-warn'], awake: ['صحي', 'st-ok'],
    woke: ['صحي (المشرف)', 'st-ok'], replaced: ['اتعيّن بديل', 'st-off'], expired: ['عدّى ميعاده', 'st-off'], gone: ['اتشال', 'st-off']
  };

  /**
   * What the cloud alarm must do now for one entry (pure — the worker sends and records).
   * Returns a list of steps: 'p1' push driver · 'p2' second ring · 'sup' supervisors · 'mgmt' management.
   */
  W.due = function (e, now, settings) {
    const s = S(settings), st = W.status(e, null, now, s), out = [];
    if (['upcoming', 'awake', 'woke', 'replaced', 'expired', 'gone'].includes(st)) return out;
    if (!e.p1) { out.push('p1'); return out; }           // first ring now — the clock for the rest starts here
    const mins = W.lateMin(e, now);
    if (!e.p2 && mins >= s.wakeSecondMin && !e.claim) out.push('p2');
    const supMin = e.watch ? s.watchSupMin : s.wakeResponseMin;
    if (!e.supAt && !e.claim && mins >= supMin) out.push('sup');
    // management: nobody took the case, or the supervisor has held it too long without an answer
    if (!e.mgmtAt && ((!e.claim && mins >= s.wakeEscalateMin) || (e.claim && now - e.claim.at >= s.claimTimeoutMin * 60000))) out.push('mgmt');
    return out;
  };

  root.TPWake = W;
  if (root.TP) root.TP.wakeCore = W;
})(typeof self !== 'undefined' ? self : globalThis);

/* ==========================================================================
   Flight core — pure logic shared by the Control Tower and the cloud alarm
   (the worker inlines this file). No DOM, no Firebase.

   mission.flight = { no, date, dir: 'arr'|'dep', airport, airportName, terminal,
                      other (city at the other end), airline, sched, est, status,
                      src: 'api'|'manual'|'wait', checkedAt, alert, delayMin }
   The trip's own time (mission.day / mission.time) comes from the flight:
     توصيل (dep): pickup = flight − 3h at the airport − the drive
     استقبال (arr): the driver is at the airport 30 min before landing
   ========================================================================== */
(function (root) {
  'use strict';
  const F = {};
  const H = 3600000;

  /** "ms 777" → "MS777" */
  F.norm = no => String(no || '').toUpperCase().replace(/[٠-٩]/g, d => d.charCodeAt(0) - 1632).replace(/[^A-Z0-9]/g, '');
  F.valid = no => /^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$/.test(F.norm(no));
  /** "2026-10-10 05:30Z" / "2026-10-10T05:30Z" → epoch ms */
  F.parseTime = v => {
    if (!v) return null;
    const s = typeof v === 'object' ? (v.utc || '') : String(v);
    if (!s) return null;
    const t = Date.parse(s.trim().replace(' ', 'T').replace(/(T\d{2}:\d{2})Z$/, '$1:00Z'));
    return isFinite(t) ? t : null;
  };
  const localDate = v => { const s = v && typeof v === 'object' ? (v.local || '') : ''; return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''; };
  const homeList = s => String(s || 'CAI,SPX').toUpperCase().split(/[^A-Z]+/).filter(Boolean);

  F.STATUS = {
    Expected: 'في ميعادها', Scheduled: 'في ميعادها', CheckIn: 'بدأ تسجيل الركاب', Boarding: 'الركاب بيطلعوا', GateClosed: 'البوابة اتقفلت',
    Departed: 'طارت', EnRoute: 'في الجو', Approaching: 'بتقرّب', Arrived: 'هبطت', Landed: 'هبطت', Delayed: 'متأخرة',
    Canceled: 'اتلغت', CanceledUncertain: 'ممكن تكون اتلغت', Diverted: 'اتحولت لمطار تاني', Unknown: 'مش معروف'
  };
  F.statusName = s => F.STATUS[s] || s || '';

  /**
   * One flight from the AeroDataBox answer (a list): the leg that touches one of our airports on `date`.
   * Returns the normalized flight, or null when nothing matches.
   */
  F.fromApi = function (list, date, homeAirports, wantDir) {
    const home = homeList(homeAirports);
    const legs = (Array.isArray(list) ? list : [list]).filter(x => x && x.departure && x.arrival && !x.isCargo);
    const side = (f, dir) => (dir === 'dep' ? f.departure : f.arrival);
    const dirOf = f => {
      const d = ((f.departure.airport || {}).iata || '').toUpperCase(), a = ((f.arrival.airport || {}).iata || '').toUpperCase();
      if (wantDir === 'dep' || wantDir === 'arr') return wantDir;
      if (home.includes(d)) return 'dep';
      if (home.includes(a)) return 'arr';
      if ((f.departure.airport || {}).countryCode === 'EG') return 'dep';
      if ((f.arrival.airport || {}).countryCode === 'EG') return 'arr';
      return '';
    };
    let best = null;
    for (const f of legs) {
      const dir = dirOf(f); if (!dir) continue;
      const s = side(f, dir), ld = localDate(s.scheduledTime);
      const score = (ld === date ? 2 : 0) + (f.codeshareStatus === 'IsOperator' ? 1 : 0);
      if (!best || score > best.score) best = { f, dir, score };
    }
    if (!best) return null;
    const { f, dir } = best, s = side(f, dir), o = dir === 'dep' ? f.arrival : f.departure;
    const sched = F.parseTime(s.scheduledTime);
    const est = F.parseTime(s.revisedTime) || F.parseTime(s.predictedTime) || F.parseTime(s.runwayTime) || null;
    const ap = s.airport || {}, oa = o.airport || {};
    const out = {
      no: F.norm(f.number), dir, airport: ap.iata || ap.icao || '', airportName: ap.shortName || ap.name || ap.municipalityName || '',
      terminal: String(s.terminal || ''), gate: String(s.gate || ''), belt: String(s.baggageBelt || ''),
      other: oa.municipalityName || oa.shortName || oa.name || oa.iata || '', airline: (f.airline && f.airline.name) || '',
      sched: sched || null, est: est && sched && Math.abs(est - sched) >= 60000 ? est : null, status: f.status || ''
    };
    out.delayMin = out.est && out.sched ? Math.round((out.est - out.sched) / 60000) : 0;
    return out;
  };

  /** The time that matters: the expected one when the airline changed it. */
  F.when = fl => (fl && (fl.est || fl.sched)) || null;

  /**
   * The driver's job time for the trip (ms): pickup for a departure, at the airport for an arrival.
   * Departures move later only for a real delay (an hour or more): airlines keep check-in on the old time otherwise.
   */
  F.jobAt = function (fl, settings, driveMin) {
    const s = settings || {};
    if (!fl || !fl.sched) return null;
    const lead = (Number(s.airportDepartLeadMin) || 180) * 60000, early = (Number(s.airportArriveEarlyMin) || 30) * 60000;
    if (fl.dir === 'dep') {
      const t = fl.est && (fl.est < fl.sched || fl.est - fl.sched >= H) ? fl.est : fl.sched;
      return t - lead - (Number(driveMin) || Number(s.airportDriveMin) || 75) * 60000;
    }
    if (fl.dir === 'arr') return F.when(fl) - early;
    return null;
  };

  /**
   * When to look at the flight again: 5 hours before it, then 2 hours before — each one once only,
   * even when a delay moves the flight later (fl.done keeps the looks already made).
   */
  F.NEVER = 9e15;
  F.nextCheck = function (fl, now) {
    const t = F.when(fl);
    if (!t) return F.NEVER;
    const done = (fl && fl.done) || [];
    for (const k of [5, 2]) if (!done.includes(k) && now < t - k * H - 30000) return t - k * H;
    return F.NEVER;
  };
  /** Same, and remembers which look it is (fl.nextK) so it is counted once it happens. */
  F.schedule = function (fl, now) {
    const at = F.nextCheck(fl, now), t = F.when(fl);
    fl.nextK = at === F.NEVER ? 0 : ([5, 2].find(k => t - k * H === at) || 0);
    return at;
  };
  /** A planned look just happened. */
  F.markChecked = function (fl) {
    if (fl.nextK) fl.done = Array.from(new Set((fl.done || []).concat(fl.nextK)));
    fl.nextK = 0;
  };

  root.TPFlight = F;
  if (root.TP) root.TP.flight = F;
})(typeof self !== 'undefined' ? self : globalThis);

/* ==========================================================================
   Fleet core — trip orders (أمر الشغل), maintenance by kilometres, document
   expiry and the WhatsApp texts. Pure logic shared by the Control Tower, the
   driver app and the cloud alarm (the worker inlines this file). No DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const FL = {};

  /* ---------- maintenance plan (the GM's numbers — editable from the Control Tower) ---------- */
  // km: per model (null = not for that model). check: an inspection item on every oil change.
  FL.MODELS = [{ id: 'corolla', name: 'تويوتا كورولا' }, { id: 'elantra', name: 'هيونداي إلنترا' }];
  FL.PARTS = [
    { k: 'oil', n: 'زيت الموتور', km: { corolla: 9000, elantra: 9000 } },
    { k: 'airf', n: 'فلتر الهوا', km: { corolla: 30000, elantra: 30000 } },
    { k: 'gearoil', n: 'زيت الفتيس', km: { corolla: 40000, elantra: 80000 } },
    { k: 'gearf', n: 'فلتر الفتيس الداخلي', km: { corolla: 80000, elantra: null }, note: 'مرة زيت بس، ومرة زيت + فلتر' },
    { k: 'belt', n: 'سير الدينامو', km: { corolla: 80000, elantra: 80000 } },
    { k: 'plugs', n: 'البوجيهات', km: { corolla: 80000, elantra: 80000 } },
    { k: 'fuelf', n: 'فلتر البنزين', km: { corolla: 80000, elantra: 80000 } },
    { k: 'tires', n: 'الكاوتش', km: { corolla: 120000, elantra: 120000 }, checkKm: 100000, months: 18 },
    { k: 'coolant', n: 'مياه التبريد', yearly: '05-01' }
  ];
  FL.CHECKS = ['افحص فلتر التكييف', 'افحص تيل الفرامل'];
  FL.SOON_KM = 500;

  /** The plan with the GM's changes (settings.maintPlan = { partKey: { corolla, elantra, checkKm, months, yearly } }). */
  FL.plan = function (settings) {
    const over = (settings && settings.maintPlan) || {};
    return FL.PARTS.map(p => {
      const o = over[p.k] || {}, km = Object.assign({}, p.km || {});
      FL.MODELS.forEach(m => { if (o[m.id] !== undefined) km[m.id] = o[m.id] === null || o[m.id] === '' ? null : Number(o[m.id]); });
      return Object.assign({}, p, { km: p.km ? km : undefined, checkKm: o.checkKm !== undefined ? Number(o.checkKm) || null : p.checkKm, months: o.months !== undefined ? Number(o.months) || null : p.months, yearly: o.yearly !== undefined ? o.yearly : p.yearly });
    });
  };
  const dayMs = d => Date.parse(d + 'T00:00:00Z');
  const addMonths = (d, n) => { const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, dd)); return t.toISOString().slice(0, 10); };
  FL.daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / 86400000);

  /**
   * Every part of a car: when it is due and how it stands.
   * stage: 'ok' | 'soon' (≤ 500 km / 2 weeks) | 'check' (tyres: look at them) | 'due' | 'unknown' (no last change recorded)
   */
  FL.status = function (car, plan, today) {
    const model = car && car.model, odo = Number(car && car.odo) || 0, maint = (car && car.maint) || {};
    return plan.filter(p => p.yearly || (p.km && p.km[model])).map(p => {
      const last = maint[p.k] || null, row = { k: p.k, n: p.n, note: p.note || '', last, stage: 'unknown', left: null, next: null, nextDay: null };
      if (p.yearly) {
        // every year before the summer: done in the two months before the date (or after it) counts for that year
        const y = Number(today.slice(0, 4)), T = `${y}-${p.yearly}`;
        const D = today >= T ? T : `${y - 1}-${p.yearly}`, N = today >= T ? `${y + 1}-${p.yearly}` : T;
        row.nextDay = N;
        if (!last || !last.day) row.stage = 'unknown';
        else if (last.day >= addMonths(D, -2)) row.stage = FL.daysBetween(today, N) <= 14 ? 'soon' : 'ok';
        else { row.stage = 'due'; row.nextDay = D; }
        row.left = FL.daysBetween(today, row.nextDay);
        return row;
      }
      const every = p.km[model];
      if (!last || !isFinite(last.odo)) return Object.assign(row, { every });
      row.every = every; row.next = last.odo + every; row.left = row.next - odo;
      row.stage = row.left <= 0 ? 'due' : row.left <= FL.SOON_KM ? 'soon' : 'ok';
      if (p.checkKm && row.stage === 'ok' && odo - last.odo >= p.checkKm) row.stage = 'check';
      if (p.months && last.day) {
        row.nextDay = addMonths(last.day, p.months);
        const dl = FL.daysBetween(today, row.nextDay);
        if (dl <= 0) row.stage = 'due'; else if (dl <= 14 && row.stage === 'ok') row.stage = 'soon';
      }
      return row;
    });
  };
  FL.STAGE = { ok: ['تمام', 'st-ok'], soon: ['قرّب', 'st-warn'], check: ['افحصه', 'st-warn'], due: ['لازم يتغير', 'st-danger'], unknown: ['مش متسجل', 'st-off'] };

  /** A typed odometer reading: '' when fine, otherwise the reason (the app asks before saving). */
  FL.odoProblem = function (lastOdo, lastDay, before, after, day) {
    const b = Number(before) || 0, a = Number(after) || 0, L = Number(lastOdo) || 0;
    if (b && a && a < b) return 'العداد بعد المشوار أقل من قبله';
    if (L && b && b < L) return `العداد ${b} أقل من آخر قراءة للعربية (${L})`;
    if (b && a && a - b > 1500) return `المشوار ${a - b} كيلو — رقم كبير جداً`;
    if (L && b && lastDay && day) {
      const days = Math.max(1, FL.daysBetween(lastDay, day) + 1);
      if (b - L > 1500 * days) return `العداد زاد ${b - L} كيلو من آخر قراءة — رقم مش منطقي`;
    }
    return '';
  };

  /* ---------- WhatsApp texts (same shape as the old program) ---------- */
  FL.ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر'];
  const hm12 = t => { if (!t || !/^\d{1,2}:\d{2}/.test(t)) return t || '-'; let [h, m] = t.split(':').map(Number); const per = h >= 12 ? 'مساءً' : 'صباحاً'; h = h % 12 || 12; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${per}`; };
  FL.hm12 = hm12;
  /** The driver's report of his trips to the car's group. */
  FL.tripMessage = function (carName, trips) {
    let msg = '*أمر شغل - Three Pyramids Travel*\n--------------------------\n';
    msg += `العربية: ${carName}\n--------------------------\n`;
    trips.forEach((t, i) => {
      msg += `${i > 0 ? '\n' : ''}\n*مشوار ${i + 1}*\n`;
      msg += `التاريخ: ${t.day || '-'} | وقت التحرك: *${t.time ? hm12(t.time) : '-'}*\n`;
      msg += `المأمورية: ${t.task || '-'}\n`;
      msg += `العداد قبل: ${t.before || '-'} | العداد بعد: ${t.after || '-'}\n`;
      msg += `المصروف: ${Number(t.expense) || 0} جنيه${t.expNote ? ' (' + t.expNote + ')' : ''}\n`;
    });
    msg += '\n--------------------------\nملحوظة: صور العدادات يتم إرسالها كمرفقات في نفس محادثة الجروب بعد اللصق';
    return msg;
  };
  /** Operations' schedule of a car's trips to its group. */
  FL.scheduleMessage = function (carName, items) {
    let msg = '*تعليمات مدير التشغيل - Three Pyramids Travel*\n--------------------------\n';
    msg += `العربية: ${carName}\n--------------------------\n`;
    items.forEach((m, i) => {
      if (i > 0) msg += '\n➖➖➖➖➖➖➖➖➖➖\n\n';
      msg += `\n*المشوار ${FL.ORD[i] || i + 1}*\n`;
      const f = [['المشوار', m.when], ['وقت الوصول', `*${m.time ? hm12(m.time) : '-'}*`], ['نوع المشوار', m.type], ['من', m.from || '-'], ['إلى', m.to || '-']];
      if (m.flight) f.push(['رقم الرحلة', `*${m.flight}*`]);
      if (m.terminal) f.push(['رقم الصالة', `*${m.terminal}*`]);
      f.push(['اسم العميل', m.client || '-'], ['رقم العميل', m.phone || '-'], ['اسم المصنع', m.factory || '-'], ['ملاحظات', m.notes ? `*${m.notes}*` : '-']);
      f.forEach((x, j) => { msg += `*${j + 1}.* ${x[0]}: ${x[1]}\n`; });
    });
    return msg + '\n--------------------------';
  };

  /** Document expiry: 'expired' | 'soon' (within `warnDays`) | 'ok' | 'none'. */
  FL.docStage = (day, today, warnDays) => { if (!day) return 'none'; const d = FL.daysBetween(today, day); return d < 0 ? 'expired' : d <= (warnDays || 30) ? 'soon' : 'ok'; };
  /** Net salary of a month document. */
  FL.salaryNet = s => { const sum = o => Object.values(o || {}).reduce((a, x) => a + (Number(x && x.amount) || 0), 0); const base = Number(s && s.base) || 0, ex = sum(s && s.extra), de = sum(s && s.ded); return { base, extra: Math.round(ex * 100) / 100, ded: Math.round(de * 100) / 100, net: Math.round((base + ex - de) * 100) / 100 }; };

  root.TPFleet = FL;
  if (root.TP) root.TP.fleet = FL;
})(typeof self !== 'undefined' ? self : globalThis);

/* ==========================================================================
   Guests' languages — the customer page and the ready messages to guests.
   ar (default) · en · de · fr · ru · zh · ko
   Pure data + small helpers: used by the customer page, the Control Tower,
   the driver app and the cloud alarm (inlined there). No DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const LANGS = [
    { id: 'ar', name: 'العربية', dir: 'rtl', loc: 'ar-EG-u-nu-latn' },
    { id: 'en', name: 'English', dir: 'ltr', loc: 'en-GB' },
    { id: 'de', name: 'Deutsch', dir: 'ltr', loc: 'de-DE' },
    { id: 'fr', name: 'Français', dir: 'ltr', loc: 'fr-FR' },
    { id: 'ru', name: 'Русский', dir: 'ltr', loc: 'ru-RU' },
    { id: 'zh', name: '中文', dir: 'ltr', loc: 'zh-CN' },
    { id: 'ko', name: '한국어', dir: 'ltr', loc: 'ko-KR' }
  ];
  // [ar, en, de, fr, ru, zh, ko]
  const T = {
    hello: ['أهلاً {n} 👋', 'Hello {n} 👋', 'Hallo {n} 👋', 'Bonjour {n} 👋', 'Здравствуйте, {n} 👋', '{n}，您好 👋', '{n}님, 안녕하세요 👋'],
    yourRide: ['مشوارك', 'Your ride', 'Ihre Fahrt', 'Votre trajet', 'Ваша поездка', '您的行程', '고객님의 이동'],
    st_near: ['العربية في الطريق ليك', 'Your car is on the way', 'Ihr Fahrzeug ist unterwegs', 'Votre voiture est en route', 'Машина уже едет к вам', '车辆正在前往接您', '차량이 고객님께 가고 있습니다'],
    st_arrived: ['العربية وصلت وجاهزة', 'Your car has arrived', 'Ihr Fahrzeug ist angekommen', 'Votre voiture est arrivée', 'Машина прибыла', '车辆已到达', '차량이 도착했습니다'],
    st_arrivedAir: ['السواق وصل المطار ومستنيك', 'Your driver is at the airport waiting for you', 'Ihr Fahrer wartet am Flughafen auf Sie', "Votre chauffeur vous attend à l'aéroport", 'Водитель ждёт вас в аэропорту', '司机已在机场等候您', '기사님이 공항에서 기다리고 있습니다'],
    st_picked: ['رحلة سعيدة', 'Have a pleasant ride', 'Gute Fahrt', 'Bon trajet', 'Приятной поездки', '祝您旅途愉快', '즐거운 이동 되세요'],
    st_dropped: ['وصلت بالسلامة', 'You have arrived safely', 'Sie sind sicher angekommen', 'Vous êtes bien arrivé(e)', 'Вы благополучно прибыли', '您已安全抵达', '안전하게 도착하셨습니다'],
    st_evening: ['العربية مستنياك للرجوع', 'Your car is waiting to take you back', 'Ihr Fahrzeug wartet für die Rückfahrt', 'Votre voiture vous attend pour le retour', 'Машина ждёт вас для обратной поездки', '车辆正在等候接您返回', '복귀 차량이 기다리고 있습니다'],
    st_done: ['الرحلة خلصت', 'Your ride is complete', 'Ihre Fahrt ist beendet', 'Votre trajet est terminé', 'Поездка завершена', '行程已结束', '이동이 완료되었습니다'],
    st_skip: ['مسجلين إنك مش راكب النهارده', "We know you're not riding today", 'Sie fahren heute nicht mit — notiert', "C'est noté : vous ne venez pas aujourd'hui", 'Отмечено: сегодня вы не едете', '已记录：您今天不乘车', '오늘은 탑승하지 않으시는 것으로 기록했습니다'],
    st_noshow: ['العربية استنتك ومشيت', 'The car waited for you and has left', 'Das Fahrzeug hat gewartet und ist abgefahren', 'La voiture vous a attendu puis est repartie', 'Машина ждала вас и уехала', '车辆已等候并已离开', '차량이 기다리다가 출발했습니다'],
    st_cancelled: ['المشوار ده اتلغى', 'This ride has been cancelled', 'Diese Fahrt wurde storniert', 'Ce trajet a été annulé', 'Эта поездка отменена', '此行程已取消', '이 이동은 취소되었습니다'],
    st_idleLine: ['لما العربية تتحرك ليك هيوصلك إشعار هنا', "You'll be notified here when the car sets off to you", 'Sie werden hier benachrichtigt, sobald das Fahrzeug losfährt', 'Vous serez prévenu(e) ici dès que la voiture partira vers vous', 'Здесь появится уведомление, когда машина выедет к вам', '车辆出发时您会在这里收到通知', '차량이 출발하면 여기에서 알려 드립니다'],
    eta: ['هتوصلك في حوالي', 'Arriving in about', 'Ankunft in etwa', 'Arrivée dans environ', 'Прибудет примерно через', '预计到达还需约', '도착까지 약'],
    min1: ['دقيقة', '1 minute', '1 Minute', '1 minute', '1 минуту', '1 分钟', '1분'],
    mins: ['{n} دقيقة', '{n} minutes', '{n} Minuten', '{n} minutes', '{n} мин', '{n} 分钟', '{n}분'],
    updated: ['آخر تحديث من {n} دقيقة', 'Updated {n} min ago', 'Aktualisiert vor {n} Min.', 'Mis à jour il y a {n} min', 'Обновлено {n} мин назад', '{n} 分钟前更新', '{n}분 전 업데이트'],
    card: ['كارنيه الشركة', 'Company ID', 'Firmenausweis', 'Carte de la société', 'Удостоверение компании', '公司证件', '회사 신분증'],
    code: ['كود {n}', 'ID {n}', 'Nr. {n}', 'N° {n}', '№ {n}', '编号 {n}', '번호 {n}'],
    sound: ['🔔 دوس هنا علشان صوت "العربية وصلت" يشتغل', '🔔 Tap here to turn on the "car has arrived" sound', '🔔 Hier tippen, um den Ton „Fahrzeug angekommen" einzuschalten', '🔔 Touchez ici pour activer le son « voiture arrivée »', '🔔 Нажмите, чтобы включить звук «машина прибыла»', '🔔 点击此处开启"车辆已到达"提示音', '🔔 "차량 도착" 알림음을 켜려면 여기를 누르세요'],
    landed: ['✈ نزلت من الطيارة', "✈ I've landed", '✈ Ich bin gelandet', "✈ J'ai atterri", '✈ Я приземлился(-ась)', '✈ 我已落地', '✈ 착륙했습니다'],
    out: ['🧳 خلصت الجوازات والشنط وطالع', "🧳 Passport & bags done — I'm coming out", '🧳 Pass & Gepäck erledigt — ich komme raus', '🧳 Passeport et bagages OK — je sors', '🧳 Паспорт и багаж готовы — выхожу', '🧳 入境和行李已办完，正在出来', '🧳 입국 심사와 짐 찾기 완료 — 나가는 중입니다'],
    landedOk: ['السواق هيعرف إنك نزلت ✓', 'Your driver knows you have landed ✓', 'Ihr Fahrer weiß, dass Sie gelandet sind ✓', 'Votre chauffeur sait que vous avez atterri ✓', 'Водитель знает, что вы приземлились ✓', '司机已知道您落地 ✓', '기사님께 착륙 사실을 알렸습니다 ✓'],
    outOk: ['السواق هيعرف إنك طالع ✓', 'Your driver knows you are coming out ✓', 'Ihr Fahrer weiß, dass Sie herauskommen ✓', 'Votre chauffeur sait que vous sortez ✓', 'Водитель знает, что вы выходите ✓', '司机已知道您正在出来 ✓', '기사님께 나가는 중이라고 알렸습니다 ✓'],
    told: ['السواق هيعرف ✓', 'Your driver has been told ✓', 'Ihr Fahrer wurde informiert ✓', 'Votre chauffeur est prévenu ✓', 'Водитель предупреждён ✓', '已通知司机 ✓', '기사님께 알렸습니다 ✓'],
    rateQ: ['إيه رأيك في المشوار؟', 'How was your ride?', 'Wie war Ihre Fahrt?', 'Comment était votre trajet ?', 'Как прошла поездка?', '您对本次行程满意吗？', '이동은 어떠셨나요?'],
    rateNote: ['ملاحظة (اختياري)', 'Comment (optional)', 'Kommentar (optional)', 'Commentaire (facultatif)', 'Комментарий (необязательно)', '备注（可选）', '의견 (선택)'],
    rateSend: ['ابعت التقييم', 'Send rating', 'Bewertung senden', 'Envoyer la note', 'Отправить оценку', '提交评价', '평가 보내기'],
    rateThanks: ['شكراً على تقييمك 🌟', 'Thank you for your rating 🌟', 'Danke für Ihre Bewertung 🌟', 'Merci pour votre note 🌟', 'Спасибо за оценку 🌟', '感谢您的评价 🌟', '평가해 주셔서 감사합니다 🌟'],
    pickStars: ['اختار عدد النجوم', 'Please choose the stars', 'Bitte Sterne wählen', 'Choisissez les étoiles', 'Выберите количество звёзд', '请选择星级', '별점을 선택해 주세요'],
    pushBanner: ['فعّل الإشعارات علشان يوصلك لما العربية تقرب وتوصل حتى والصفحة مقفولة', 'Turn on notifications to know when your car is near and arrives — even with this page closed', 'Aktivieren Sie Benachrichtigungen, um zu erfahren, wann Ihr Fahrzeug naht und ankommt — auch bei geschlossener Seite', "Activez les notifications pour savoir quand votre voiture approche et arrive — même page fermée", 'Включите уведомления, чтобы узнать, когда машина подъезжает и прибывает — даже при закрытой странице', '开启通知，即使关闭页面也能知道车辆何时接近和到达', '페이지를 닫아도 차량이 가까워지거나 도착하면 알림을 받으려면 알림을 켜세요'],
    pushOn: ['فعّل', 'Turn on', 'Aktivieren', 'Activer', 'Включить', '开启', '켜기'],
    pushOk: ['الإشعارات اتفعلت ✓', 'Notifications are on ✓', 'Benachrichtigungen sind aktiv ✓', 'Notifications activées ✓', 'Уведомления включены ✓', '通知已开启 ✓', '알림이 켜졌습니다 ✓'],
    pushFail: ['مقدرناش نفعّل الإشعارات — اسمح بيها من إعدادات المتصفح', 'Could not turn on notifications — please allow them in your browser settings', 'Benachrichtigungen konnten nicht aktiviert werden — bitte in den Browsereinstellungen erlauben', "Impossible d'activer les notifications — autorisez-les dans les réglages du navigateur", 'Не удалось включить уведомления — разрешите их в настройках браузера', '无法开启通知 — 请在浏览器设置中允许', '알림을 켤 수 없습니다 — 브라우저 설정에서 허용해 주세요'],
    pushNo: ['الموبايل ده مش بيدعم الإشعارات — خلي الصفحة مفتوحة', "This phone doesn't support notifications — please keep this page open", 'Dieses Telefon unterstützt keine Benachrichtigungen — bitte Seite geöffnet lassen', 'Ce téléphone ne prend pas en charge les notifications — gardez cette page ouverte', 'Этот телефон не поддерживает уведомления — держите страницу открытой', '此手机不支持通知 — 请保持此页面打开', '이 휴대폰은 알림을 지원하지 않습니다 — 이 페이지를 열어 두세요'],
    pushIos: ['، أو ضيفها للشاشة الرئيسية (مشاركة ← Add to Home Screen) وافتحها من هناك', ', or add it to your Home Screen (Share → Add to Home Screen) and open it from there', ' oder zum Home-Bildschirm hinzufügen (Teilen → Zum Home-Bildschirm) und dort öffnen', " ou ajoutez-la à l'écran d'accueil (Partager → Sur l'écran d'accueil) et ouvrez-la depuis là", ' или добавьте её на экран «Домой» (Поделиться → На экран «Домой») и откройте оттуда', '，或添加到主屏幕（分享 → 添加到主屏幕）后从那里打开', ' 또는 홈 화면에 추가(공유 → 홈 화면에 추가)한 뒤 그곳에서 여세요'],
    call: ['كلّم الشركة', 'Call the company', 'Firma anrufen', "Appeler l'agence", 'Позвонить в компанию', '致电公司', '회사에 전화'],
    emergency: ['🆘 طوارئ — كلّم الشركة على واتساب', '🆘 Emergency — WhatsApp the company', '🆘 Notfall — Firma per WhatsApp', "🆘 Urgence — WhatsApp à l'agence", '🆘 Экстренно — WhatsApp компании', '🆘 紧急情况 — 通过 WhatsApp 联系公司', '🆘 긴급 — 회사에 WhatsApp 보내기'],
    emergencyMsg: ['طوارئ — أنا {n}{f}. محتاج مساعدة من فضلك.', 'Emergency — this is {n}{f}. I need help, please.', 'Notfall — hier ist {n}{f}. Ich brauche bitte Hilfe.', "Urgence — ici {n}{f}. J'ai besoin d'aide, s'il vous plaît.", 'Экстренно — это {n}{f}. Мне нужна помощь.', '紧急情况 — 我是 {n}{f}，需要帮助。', '긴급 — {n}{f}입니다. 도움이 필요합니다.'],
    flightTag: [' — رحلة {f}', ', flight {f}', ', Flug {f}', ', vol {f}', ', рейс {f}', '，航班 {f}', ', 항공편 {f}'],
    okComing: ['تمام، جاي', "OK, I'm coming", 'OK, ich komme', "D'accord, j'arrive", 'Хорошо, иду', '好的，我马上来', '네, 지금 갑니다'],
    withSign: ['صالة {t} — معاه لافتة باسمك', 'Terminal {t} — holding a sign with your name', 'Terminal {t} — mit einem Schild mit Ihrem Namen', 'Terminal {t} — avec une pancarte à votre nom', 'Терминал {t} — с табличкой с вашим именем', '{t} 号航站楼 — 手持写有您名字的接机牌', '{t} 터미널 — 고객님 성함이 적힌 피켓을 들고 있습니다'],
    signWait: ['السواق مستنيك قدام صالة الوصول', 'Your driver is waiting for you in front of the arrivals hall', 'Ihr Fahrer wartet vor der Ankunftshalle auf Sie', 'Votre chauffeur vous attend devant le hall des arrivées', 'Водитель ждёт вас у зала прилёта', '您的司机正在到达大厅前等候您', '기사님이 도착 홀 앞에서 기다리고 있습니다'],
    meet: ['مكان المقابلة', 'Where to meet your driver', 'Treffpunkt mit Ihrem Fahrer', 'Où retrouver votre chauffeur', 'Где встретить водителя', '与司机会面的地点', '기사님을 만나는 장소'],
    delayed: ['الطيارة متأخرة {n} دقيقة — السواق عارف وهيستناك', 'Your flight is delayed by {n} min — your driver knows and will wait for you', 'Ihr Flug hat {n} Min. Verspätung — Ihr Fahrer weiß Bescheid und wartet auf Sie', 'Votre vol a {n} min de retard — votre chauffeur est informé et vous attendra', 'Ваш рейс задерживается на {n} мин — водитель знает и подождёт вас', '您的航班延误 {n} 分钟 — 司机已知悉并会等候您', '항공편이 {n}분 지연됩니다 — 기사님이 알고 있으며 기다릴 예정입니다'],
    delayedDep: ['الطيارة اتأخرت — ميعاد العربية بقى {t}', 'Your flight is delayed — your pickup is now at {t}', 'Ihr Flug ist verspätet — Abholung jetzt um {t}', 'Votre vol est retardé — prise en charge désormais à {t}', 'Рейс задерживается — машина подъедет в {t}', '航班延误 — 接您的时间改为 {t}', '항공편이 지연되어 픽업 시간이 {t}(으)로 변경되었습니다'],
    landing: ['الهبوط', 'Landing', 'Landung', 'Atterrissage', 'Посадка', '降落', '착륙'],
    takeoff: ['الإقلاع', 'Departure', 'Abflug', 'Décollage', 'Вылет', '起飞', '출발'],
    from: ['جاية من', 'from', 'aus', 'en provenance de', 'из', '来自', '출발지:'],
    to: ['رايحة', 'to', 'nach', 'à destination de', 'в', '前往', '도착지:'],
    terminal: ['صالة', 'Terminal', 'Terminal', 'Terminal', 'Терминал', '航站楼', '터미널'],
    flightData: ['بيانات الرحلات: AeroDataBox', 'Flight data: AeroDataBox', 'Flugdaten: AeroDataBox', 'Données de vol : AeroDataBox', 'Данные о рейсах: AeroDataBox', '航班数据：AeroDataBox', '항공편 정보: AeroDataBox'],
    pickupAt: ['ميعاد العربية', 'Pickup time', 'Abholzeit', 'Heure de prise en charge', 'Время подачи', '接送时间', '픽업 시간'],
    linkMissing: ['اللينك ناقص', 'This link is incomplete', 'Dieser Link ist unvollständig', 'Ce lien est incomplet', 'Ссылка неполная', '链接不完整', '링크가 완전하지 않습니다'],
    linkMissing2: ['افتح اللينك اللي وصلك على الواتساب زي ما هو.', 'Please open the link you received on WhatsApp exactly as it is.', 'Bitte öffnen Sie den per WhatsApp erhaltenen Link unverändert.', 'Ouvrez le lien reçu sur WhatsApp tel quel.', 'Откройте ссылку из WhatsApp без изменений.', '请按原样打开您在 WhatsApp 收到的链接。', 'WhatsApp으로 받은 링크를 그대로 열어 주세요.'],
    linkDead: ['اللينك ده مش شغال', 'This link is not active', 'Dieser Link ist nicht aktiv', "Ce lien n'est pas actif", 'Ссылка неактивна', '此链接已失效', '이 링크는 사용할 수 없습니다'],
    linkDead2: ['يمكن المشوار اتلغى أو اللينك اتغيّر. كلّم الشركة.', 'The ride may have been cancelled or the link changed. Please contact the company.', 'Die Fahrt wurde evtl. storniert oder der Link geändert. Bitte kontaktieren Sie die Firma.', "Le trajet a peut-être été annulé ou le lien modifié. Contactez l'agence.", 'Возможно, поездку отменили или ссылка изменилась. Свяжитесь с компанией.', '行程可能已取消或链接已更改，请联系公司。', '이동이 취소되었거나 링크가 변경되었을 수 있습니다. 회사에 문의해 주세요.'],
    noNet: ['مفيش اتصال', 'No connection', 'Keine Verbindung', 'Pas de connexion', 'Нет соединения', '无网络连接', '연결 없음'],
    noNet2: ['اتأكد من الإنترنت وافتح اللينك تاني.', 'Please check your internet and open the link again.', 'Bitte Internet prüfen und Link erneut öffnen.', 'Vérifiez votre connexion et rouvrez le lien.', 'Проверьте интернет и откройте ссылку снова.', '请检查网络后重新打开链接。', '인터넷 연결을 확인한 뒤 링크를 다시 열어 주세요.'],
    onlyYou: ['اللينك ده ليك انت بس — متبعتهوش لحد', 'This link is for you only — please do not share it', 'Dieser Link ist nur für Sie — bitte nicht weitergeben', 'Ce lien est personnel — merci de ne pas le partager', 'Эта ссылка только для вас — не передавайте её', '此链接仅供您本人使用，请勿转发', '이 링크는 고객님 전용입니다 — 공유하지 마세요'],
    lang: ['اللغة', 'Language', 'Sprache', 'Langue', 'Язык', '语言', '언어'],
    // ready messages (WhatsApp, sent by the staff or the driver with one tap)
    msgWelcome: ['أهلاً {n} 👋\nأهلاً بيك في مصر! معاك Three Pyramids Travel، وإحنا مسئولين عنك من أول ما توصل.\nرحلتك: {f}\nالسواق: {d}\nتابع عربيتك من هنا: {link}',
      'Hello {n} 👋\nWelcome to Egypt! This is Three Pyramids Travel — we will take care of you from the moment you arrive.\nYour flight: {f}\nYour driver: {d}\nFollow your car here: {link}',
      'Hallo {n} 👋\nWillkommen in Ägypten! Hier ist Three Pyramids Travel — ab Ihrer Ankunft kümmern wir uns um Sie.\nIhr Flug: {f}\nIhr Fahrer: {d}\nVerfolgen Sie Ihr Fahrzeug hier: {link}',
      'Bonjour {n} 👋\nBienvenue en Égypte ! Ici Three Pyramids Travel — nous prenons soin de vous dès votre arrivée.\nVotre vol : {f}\nVotre chauffeur : {d}\nSuivez votre voiture ici : {link}',
      'Здравствуйте, {n} 👋\nДобро пожаловать в Египет! Это Three Pyramids Travel — мы позаботимся о вас с момента прилёта.\nВаш рейс: {f}\nВаш водитель: {d}\nСледите за машиной здесь: {link}',
      '{n}，您好 👋\n欢迎来到埃及！我们是 Three Pyramids Travel，从您抵达的那一刻起由我们负责照顾您。\n您的航班：{f}\n您的司机：{d}\n在此查看车辆位置：{link}',
      '{n}님, 안녕하세요 👋\n이집트에 오신 것을 환영합니다! Three Pyramids Travel입니다. 도착하시는 순간부터 저희가 모시겠습니다.\n항공편: {f}\n기사: {d}\n차량 위치 확인: {link}'],
    msgPickup: ['أهلاً {n} 👋\nمعاك Three Pyramids Travel. السواق {d} هيكون عندك {w}.\nتابع عربيتك من هنا: {link}',
      'Hello {n} 👋\nThis is Three Pyramids Travel. Your driver {d} will pick you up {w}.\nFollow your car here: {link}',
      'Hallo {n} 👋\nHier ist Three Pyramids Travel. Ihr Fahrer {d} holt Sie {w} ab.\nVerfolgen Sie Ihr Fahrzeug hier: {link}',
      'Bonjour {n} 👋\nIci Three Pyramids Travel. Votre chauffeur {d} viendra vous chercher {w}.\nSuivez votre voiture ici : {link}',
      'Здравствуйте, {n} 👋\nЭто Three Pyramids Travel. Ваш водитель {d} заберёт вас {w}.\nСледите за машиной здесь: {link}',
      '{n}，您好 👋\n我们是 Three Pyramids Travel。您的司机 {d} 将于 {w} 接您。\n在此查看车辆位置：{link}',
      '{n}님, 안녕하세요 👋\nThree Pyramids Travel입니다. 기사 {d}님이 {w} 모시러 갑니다.\n차량 위치 확인: {link}'],
    msgWaiting: ['السواق {d} مستنيك قدام صالة الوصول{t}، ومعاه لافتة باسمك.', 'Your driver {d} is waiting for you in front of the arrivals hall{t}, holding a sign with your name.', 'Ihr Fahrer {d} wartet vor der Ankunftshalle{t} mit einem Schild mit Ihrem Namen.', "Votre chauffeur {d} vous attend devant le hall des arrivées{t} avec une pancarte à votre nom.", 'Водитель {d} ждёт вас у зала прилёта{t} с табличкой с вашим именем.', '您的司机 {d} 正在到达大厅前{t}等候，手持写有您名字的接机牌。', '기사 {d}님이 도착 홀 앞{t}에서 고객님 성함이 적힌 피켓을 들고 기다리고 있습니다.'],
    msgDelay: ['رحلتك {f} متأخرة — السواق {d} عارف وهيستناك. مش محتاج تعمل حاجة.', 'Your flight {f} is delayed — your driver {d} knows and will wait for you. No need to do anything.', 'Ihr Flug {f} ist verspätet — Ihr Fahrer {d} weiß Bescheid und wartet. Sie müssen nichts tun.', "Votre vol {f} est retardé — votre chauffeur {d} est informé et vous attendra. Rien à faire de votre côté.", 'Ваш рейс {f} задерживается — водитель {d} знает и подождёт. Ничего делать не нужно.', '您的航班 {f} 延误 — 司机 {d} 已知悉并会等候您，您无需做任何事。', '항공편 {f}이(가) 지연되었습니다 — 기사 {d}님이 알고 기다릴 예정이니 따로 하실 일은 없습니다.'],
    termTag: [' (صالة {t})', ' (Terminal {t})', ' (Terminal {t})', ' (Terminal {t})', ' (терминал {t})', '（{t} 号航站楼）', ' ({t} 터미널)']
  };
  const STATUS = {
    Expected: 'ontime', Scheduled: 'ontime', CheckIn: 'checkin', Boarding: 'boarding', GateClosed: 'gate', Departed: 'departed', EnRoute: 'air', Approaching: 'approaching',
    Arrived: 'landed', Landed: 'landed', Delayed: 'delayed', Canceled: 'cancelled', CanceledUncertain: 'maybe', Diverted: 'diverted', Unknown: 'unknown'
  };
  const ST = {
    ontime: ['في ميعادها', 'On time', 'Pünktlich', "À l'heure", 'По расписанию', '准点', '정시'],
    checkin: ['بدأ تسجيل الركاب', 'Check-in open', 'Check-in geöffnet', 'Enregistrement ouvert', 'Идёт регистрация', '正在值机', '체크인 중'],
    boarding: ['الركاب بيطلعوا', 'Boarding', 'Boarding', 'Embarquement', 'Посадка', '正在登机', '탑승 중'],
    gate: ['البوابة اتقفلت', 'Gate closed', 'Gate geschlossen', 'Porte fermée', 'Выход закрыт', '登机口已关闭', '탑승구 마감'],
    departed: ['طارت', 'Departed', 'Abgeflogen', 'Parti', 'Вылетел', '已起飞', '출발함'],
    air: ['في الجو', 'In the air', 'In der Luft', 'En vol', 'В полёте', '飞行中', '비행 중'],
    approaching: ['بتقرّب', 'Approaching', 'Im Anflug', 'En approche', 'Заходит на посадку', '即将到达', '접근 중'],
    landed: ['هبطت', 'Landed', 'Gelandet', 'Atterri', 'Приземлился', '已降落', '착륙함'],
    delayed: ['متأخرة', 'Delayed', 'Verspätet', 'Retardé', 'Задерживается', '延误', '지연'],
    cancelled: ['اتلغت', 'Cancelled', 'Annulliert', 'Annulé', 'Отменён', '已取消', '취소됨'],
    maybe: ['ممكن تكون اتلغت', 'May be cancelled', 'Evtl. annulliert', 'Peut-être annulé', 'Возможно, отменён', '可能取消', '취소 가능성'],
    diverted: ['اتحولت لمطار تاني', 'Diverted', 'Umgeleitet', 'Dérouté', 'Перенаправлен', '已备降', '회항'],
    unknown: ['مش معروف', 'Unknown', 'Unbekannt', 'Inconnu', 'Неизвестно', '未知', '알 수 없음']
  };
  const idx = l => Math.max(0, LANGS.findIndex(x => x.id === l));
  const I = {
    LANGS,
    ok: l => LANGS.some(x => x.id === l),
    info: l => LANGS[idx(l)],
    /** text in a language, with {n}-style values */
    t(l, key, vars) {
      const row = T[key]; if (!row) return key;
      let s = row[idx(l)] || row[0];
      Object.keys(vars || {}).forEach(k => { s = s.split('{' + k + '}').join(String(vars[k] ?? '')); });
      return s;
    },
    flightStatus: (l, s) => { const k = STATUS[s]; return k ? ST[k][idx(l)] : (s || ''); },
    /** time / day in the guest's language, in Cairo time */
    fmtTime(l, v) { const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? '' : new Intl.DateTimeFormat(I.info(l).loc, { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: l !== 'de' && l !== 'fr' && l !== 'ru' }).format(d); },
    fmtDay(l, v) { const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? '' : new Intl.DateTimeFormat(I.info(l).loc, { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long' }).format(d); },
    /** the browser's own language, if it is one of ours */
    guess() { try { const n = String((navigator.languages && navigator.languages[0]) || navigator.language || '').slice(0, 2).toLowerCase(); return I.ok(n) ? n : 'ar'; } catch (e) { return 'ar'; } }
  };
  root.TPI18N = I;
  if (root.TP) root.TP.i18n = I;
})(typeof self !== 'undefined' ? self : globalThis);

/* ==========================================================================
   Three Pyramids — cloud alarm (Cloudflare Worker, free plan, cron every minute)
   - builds the wake-up plan of today & tomorrow from Firestore (hourly, or when asked)
   - pushes the driver at his wake time, a second ring, then the supervisors,
     then management — even when every phone has the app closed
   - the evening reminder ("جاهز لبكره") and the 22:00 night check
   - customers' notifications ("العربية في الطريق" / "العربية وصلت") queued by the driver's phone
   - airport trips: looks the flight up (AeroDataBox, free plan) when the trip is saved, then
     5 hours and 2 hours before it, and moves the trip's time (and the wake-up) with the flight
   Secrets (Settings → Variables and Secrets): GOOGLE_SA = the service-account JSON,
   FLIGHT_KEY = the AeroDataBox key (optional — without it flight times are typed by hand).
   The shared logic (wakecore.js, flightcore.js) is inlined above this file at build time.
   ========================================================================== */
const W = globalThis.TPWake;
const F = globalThis.TPFlight;
const FC = globalThis.TPFleet;
const I18 = globalThis.TPI18N;
const PROJECT = 'three-pyramids-d8ce7';
const SITE = 'https://3pyramidstravel-dev.github.io/tp-driver/';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const DOCNAME = `projects/${PROJECT}/databases/(default)/documents`;
const REQ_LIMIT = 46;                 // the free plan allows 50 outgoing requests per run — keep a margin
const RESERVE = 6;                    // requests kept for the writes that follow the pushes
let cachedToken = null, cachedKey = null;
/** the hour (0–23) in Cairo for a moment in ms */
const cairoHour = ms => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms))) % 24;

/* ---------------- Firestore values ---------------- */
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  const fields = {};
  Object.keys(v).forEach(k => { if (v[k] !== undefined) fields[k] = enc(v[k]); });
  return { mapValue: { fields } };
}
function dec(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) { const o = {}; const f = v.mapValue.fields || {}; Object.keys(f).forEach(k => { o[k] = dec(f[k]); }); return o; }
  return null;
}
const toObj = doc => { const o = dec({ mapValue: { fields: doc.fields || {} } }); o.id = doc.name.split('/').pop(); if (doc.updateTime) Object.defineProperty(o, '_ut', { value: doc.updateTime }); return o; };
const seg = s => /^[A-Za-z_][A-Za-z_0-9]*$/.test(s) ? s : '`' + String(s).replace(/[`\\]/g, m => '\\' + m) + '`';

/* ---------------- Google service-account token ---------------- */
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = s => b64url(new TextEncoder().encode(s));
function pemToDer(pem) {
  const b = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out.buffer;
}
async function accessToken(ctx) {
  if (cachedToken && cachedToken.exp > ctx.now + 120000) return cachedToken.value;
  const sa = JSON.parse(ctx.env.GOOGLE_SA);
  const iat = Math.floor(ctx.now / 1000);
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64urlStr(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging', aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  if (!cachedKey || cachedKey.email !== sa.client_email) cachedKey = { email: sa.client_email, key: await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']) };
  const key = cachedKey.key;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + body));
  const r = await ctx.f(sa.token_uri || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + body + '.' + b64url(sig) });
  if (!r.ok) throw new Error('google token ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  cachedToken = { value: j.access_token, exp: ctx.now + (j.expires_in || 3600) * 1000 };
  return cachedToken.value;
}
async function api(ctx, url, opts) {
  const t = await accessToken(ctx);
  const r = await ctx.f(url, Object.assign({}, opts, { headers: Object.assign({ authorization: 'Bearer ' + t, 'content-type': 'application/json' }, (opts && opts.headers) || {}) }));
  return r;
}

/* ---------------- Firestore REST ---------------- */
async function getDoc(ctx, path) {
  const r = await api(ctx, `${BASE}/${path}`);
  ctx.reads++;
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('get ' + path + ' ' + r.status);
  return toObj(await r.json());
}
/**
 * Writes only the listed field paths (a listed path with no value is deleted).
 * `must`: true = only if the document still exists; { updateTime } = only if nobody changed it since it was read.
 * Returns false when that condition failed.
 */
async function patch(ctx, path, fieldsObj, mask, must) {
  const cond = must && must.updateTime ? '&currentDocument.updateTime=' + encodeURIComponent(must.updateTime) : must ? '&currentDocument.exists=true' : '';
  const q = mask.map(m => 'updateMask.fieldPaths=' + encodeURIComponent(m)).join('&') + cond;
  const mustExist = !!must;
  const fields = enc(fieldsObj).mapValue.fields;
  const r = await api(ctx, `${BASE}/${path}?${q}`, { method: 'PATCH', body: JSON.stringify({ fields }) });
  ctx.writes++;
  if (mustExist && [404, 409, 412].includes(r.status)) return false;   // deleted / changed meanwhile
  if (mustExist && r.status === 400) {
    const body = await r.text();
    if (/FAILED_PRECONDITION|NOT_FOUND/.test(body)) return false;
    throw new Error('patch ' + path + ' 400 ' + body.slice(0, 200));
  }
  if (!r.ok) throw new Error('patch ' + path + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return true;
}
async function query(ctx, collectionId, select, where, limit) {
  const sq = { from: [{ collectionId }], select: { fields: select.map(fieldPath => ({ fieldPath })) } };
  if (where) sq.where = where;
  if (limit) sq.limit = limit;
  const r = await api(ctx, `${BASE}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: sq }) });
  if (!r.ok) throw new Error('query ' + collectionId + ' ' + r.status);
  const rows = (await r.json()).filter(x => x.document).map(x => toObj(x.document));
  ctx.reads += Math.max(1, rows.length);
  return rows;
}
const num = (field, op, n) => ({ fieldFilter: { field: { fieldPath: field }, op, value: { integerValue: String(Math.round(n)) } } });
const inDays = days => ({ fieldFilter: { field: { fieldPath: 'day' }, op: 'IN', value: { arrayValue: { values: days.map(d => ({ stringValue: d })) } } } });
async function batchGet(ctx, paths) {
  if (!paths.length) return {};
  const r = await api(ctx, `${BASE}:batchGet`, { method: 'POST', body: JSON.stringify({ documents: paths.map(p => `${DOCNAME}/${p}`) }) });
  if (!r.ok) throw new Error('batchGet ' + r.status);
  const out = {};
  (await r.json()).forEach(x => { ctx.reads++; if (x.found) out[x.found.name.split('/').slice(-2).join('/')] = toObj(x.found); });
  return out;
}

/* ---------------- push ---------------- */
/** Sends to every token; false (nothing recorded) when the per-run request budget would run out — retried next minute. */
async function push(ctx, tokens, m) {
  const list = tokens || [];
  if (ctx.calls + list.length > REQ_LIMIT - RESERVE) { ctx.log.push('request budget reached — rest next minute'); ctx.full = true; return false; }
  for (const token of list) {
    ctx.sent++;
    const body = { message: { token, data: { type: m.type, day: m.day || '', pid: m.pid || '' },
      webpush: { headers: { Urgency: 'high', TTL: String(m.ttl || 900) },
        notification: { title: m.title, body: m.body, icon: SITE + 'shared/icon-192.png', badge: SITE + 'shared/icon-192.png', tag: m.tag, renotify: true, requireInteraction: true, vibrate: [500, 200, 500, 200, 900], lang: m.lang || 'ar', dir: m.lang && I18 && I18.ok(m.lang) ? I18.info(m.lang).dir : 'rtl' },
        fcm_options: { link: m.link } } } };
    try {
      const r = await api(ctx, `https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`, { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) ctx.log.push('fcm ' + r.status + (r.status === 404 ? ' (old token — the phone must open the app again)' : ''));
      else ctx.pushed.push({ type: m.type, pid: m.pid, to: String(token).slice(0, 8) + '…' });   // never the whole token in the logs
    } catch (e) { ctx.log.push('fcm error ' + e.message); }
  }
  return true;
}
const first = n => String(n || '').trim().split(/\s+/)[0] || '';
/** JSON with sorted keys (Firestore returns map keys in its own order). */
const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v);
const who = e => `${e.code ? e.code + ' ' : ''}${e.name}`;

/* ---------------- airport: look the flights up ---------------- */
const FLIGHT_HOST = 'aerodatabox.p.rapidapi.com';
async function lookUp(ctx, no, date) {
  const via = ctx.env.FLIGHT_VIA === 'apimarket';
  const url = via ? `https://prod.api.market/api/v1/aedbx/aerodatabox/flights/Number/${encodeURIComponent(no)}/${date}?dateLocalRole=Both&withAircraftImage=false&withLocation=false`
    : `https://${FLIGHT_HOST}/flights/number/${encodeURIComponent(no)}/${date}?dateLocalRole=Both&withAircraftImage=false&withLocation=false`;
  const headers = via ? { 'x-magicapi-key': ctx.env.FLIGHT_KEY, accept: 'application/json' } : { 'x-rapidapi-key': ctx.env.FLIGHT_KEY, 'x-rapidapi-host': FLIGHT_HOST, accept: 'application/json' };
  const r = await ctx.f(url, { headers });
  if (r.status === 204 || r.status === 404) return { notFound: true };
  if (!r.ok) return { error: r.status };
  try { return { list: await r.json() }; } catch (e) { return { notFound: true }; }
}
/** Trips whose flight must be looked at now (just saved, or 5 h / 2 h before it). Returns the days whose trips moved. */
async function flights(ctx) {
  const movedDays = new Set();
  const rows = await query(ctx, 'missions', ['flight', 'flightCheckAt', 'status', 'driveMin', 'day', 'time', 'month', 'customers', 'type'], num('flightCheckAt', 'LESS_THAN_OR_EQUAL', ctx.now), 2);
  if (!rows.length) return movedDays;
  const s = Object.assign({}, W.DEFAULTS, (await getDoc(ctx, 'system/settings')) || {});
  const month = W.dayKey(ctx.now).slice(0, 7);
  const u = (await getDoc(ctx, 'system/flightUsage')) || {};
  let calls = u.month === month ? Number(u.calls) || 0 : 0, used = 0;
  const limit = Number(s.flightMonthlyLimit) >= 0 ? Number(s.flightMonthlyLimit) : 190;
  for (const m of rows) {
    if (ctx.calls > REQ_LIMIT - 9) break;   // a trip needs up to 6 calls, then 3 for the usage + the wake-up plans
    const fl = Object.assign({}, m.flight || {});
    const done = () => patch(ctx, 'missions/' + m.id, { flight: fl, flightCheckAt: F.NEVER }, ['flight', 'flightCheckAt'], true);
    if (m.type !== 'airport' || !fl.no || !['assigned', 'active'].includes(m.status)) { await patch(ctx, 'missions/' + m.id, { flightCheckAt: F.NEVER }, ['flightCheckAt'], true); continue; }
    if (!ctx.env.FLIGHT_KEY || calls >= limit) {
      fl.alert = !ctx.env.FLIGHT_KEY ? 'nokey' : 'limit';
      if (fl.src === 'wait') fl.src = 'manual-needed';
      await done(); ctx.log.push('flight ' + fl.no + ' ' + fl.alert); continue;
    }
    let res;
    try { res = await lookUp(ctx, fl.no, fl.date || m.day); } catch (e) { res = { error: 'net' }; }
    calls++; used++;
    // a passing error (network / the service is busy): try again in 15 minutes, 3 times at most
    if (res.error && (res.error === 'net' || res.error === 429 || res.error >= 500) && (Number(fl.tries) || 0) < 3) {
      fl.tries = (Number(fl.tries) || 0) + 1; fl.alert = 'retry';
      await patch(ctx, 'missions/' + m.id, { flight: fl, flightCheckAt: ctx.now + 15 * 60000 }, ['flight', 'flightCheckAt'], true);
      ctx.log.push('flight ' + fl.no + ' retry ' + fl.tries); continue;
    }
    fl.tries = 0;
    F.markChecked(fl);
    let got = null;
    try { got = res.list ? F.fromApi(res.list, fl.date || m.day, s.homeAirports, fl.dirSet ? fl.dir : '') : null; } catch (e) { got = null; }
    if (!got) {
      fl.alert = res.error ? 'error' : 'notfound'; fl.checkedAt = ctx.now;
      if (fl.src === 'wait') fl.src = 'manual-needed';
      // typed by hand: keep checking at 5 h / 2 h — maybe the flight shows up later
      await patch(ctx, 'missions/' + m.id, { flight: fl, flightCheckAt: fl.sched ? F.schedule(fl, ctx.now) : F.NEVER }, ['flight', 'flightCheckAt'], true);
      ctx.log.push('flight ' + fl.no + ' ' + fl.alert); continue;
    }
    ['no', 'airport', 'airportName', 'gate', 'belt', 'other', 'airline', 'sched', 'est', 'status', 'delayMin'].forEach(k => { fl[k] = got[k]; });
    if (!fl.dirSet) fl.dir = got.dir;
    if (!fl.terminalSet) fl.terminal = got.terminal;
    fl.src = 'api'; fl.checkedAt = ctx.now; delete fl.alert;
    const fields = { flight: fl, flightCheckAt: F.schedule(fl, ctx.now) }, mask = ['flight', 'flightCheckAt'];
    const job = F.jobAt(fl, s, m.driveMin);
    if (job && m.status === 'assigned') {
      const day = W.dayKey(job), time = W.hm(job);
      if (day !== m.day || time !== m.time) { Object.assign(fields, { day, time, month: day.slice(0, 7) }); mask.push('day', 'time', 'month'); movedDays.add(m.day).add(day); }
    }
    if (!(await patch(ctx, 'missions/' + m.id, fields, mask, true))) continue;
    // the customers' links show the new times too
    const tf = { no: fl.no, dir: fl.dir, terminal: fl.terminal || '', airport: fl.airport || '', airportName: fl.airportName || '', other: fl.other || '', airline: fl.airline || '', sched: fl.sched || null, est: fl.est || null, status: fl.status || '', delayMin: Number(fl.delayMin) || 0 };
    // a real delay (15 minutes or more, newly): the guest hears it in his own language — the driver knows and waits
    const oldDelay = Number((m.flight || {}).delayMin) || 0, newDelay = Number(fl.delayMin) || 0;
    // (a departure: only when the pickup time really moved — the message gives the new time)
    const tell = newDelay >= 15 && newDelay - oldDelay >= 15 && !/Cancel/.test(fl.status || '') && (fl.dir === 'arr' || !!fields.time);
    for (const c of (m.customers || []).slice(0, 4)) {
      if (!c || !/^[0-9a-f]{64}$/.test(c.h || '')) continue;
      const tFields = { flight: tf, day: fields.day || m.day, time: fields.time || m.time || '' }, tMask = ['flight', 'day', 'time'];
      if (tell && I18) {
        const L = I18.ok(c.lang) ? c.lang : 'ar', jobMs = job || null;
        const b = fl.dir === 'arr' ? I18.t(L, 'delayed', { n: newDelay }) : I18.t(L, 'delayedDep', { t: jobMs ? (L === 'ar' ? W.hm12(jobMs) : I18.fmtTime(L, jobMs)) : '' });
        Object.assign(tFields, { pq: { seq: 0, t: '✈ ' + fl.no, b: b.slice(0, 200), l: L }, pqAt: ctx.now }); tMask.push('pq', 'pqAt');
      }
      await patch(ctx, 'track/' + c.h, tFields, tMask, true);
    }
    ctx.log.push('flight ' + fl.no + ' ' + (fl.status || '') + (fields.day ? ' — time moved' : ''));
  }
  if (used) await patch(ctx, 'system/flightUsage', { month, calls, at: ctx.now }, ['month', 'calls', 'at']);
  return movedDays;
}

/* ---------------- customers: their answers to the driver, the driver's news to them ---------------- */
const ANS = ['ack', 'skips', 'fcm', 'fcmAt', 'cust', 'rateDay'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RODE = ['dropped', 'evening', 'done', 'picked'];
/** Only well-formed answers are copied (the page is open to whoever holds the link). */
function cleanAnswers(a) {
  const out = {};
  if (a.ack && Number.isInteger(a.ack.seq)) out.ack = { seq: a.ack.seq, at: Number(a.ack.at) || 0 };
  if (a.skips && typeof a.skips === 'object') { out.skips = {}; Object.keys(a.skips).filter(k => DAY.test(k)).slice(0, 14).forEach(k => { out.skips[k] = Number(a.skips[k]) || 1; }); }
  if (typeof a.fcm === 'string' && a.fcm.length < 400) { out.fcm = a.fcm; out.fcmAt = Number(a.fcmAt) || 0; }
  if (a.cust && typeof a.cust === 'object') { out.cust = {}; ['landed', 'out'].forEach(k => { if (Number(a.cust[k])) out.cust[k] = Number(a.cust[k]); }); }
  if (typeof a.rateDay === 'string' && DAY.test(a.rateDay)) out.rateDay = a.rateDay;
  return out;
}
/**
 * ans/{token} (written by the customer's page) → track/{h} (read by the driver and the factory),
 * "مش راكب" → excused/{lineId}_{day} (the factory's absence sheet), a rating → ratings/{h}_{day}.
 */
async function customerAnswers(ctx) {
  if (ctx.calls > REQ_LIMIT - RESERVE - 3) return;
  const rows = await query(ctx, 'ans', ['h', 'rate'].concat(ANS), { fieldFilter: { field: { fieldPath: 'dirty' }, op: 'EQUAL', value: { booleanValue: true } } }, 5);
  const today = W.dayKey(ctx.now);
  for (const a of rows) {
    if (ctx.calls > REQ_LIMIT - RESERVE - 7) break;   // one answer needs up to 6 calls
    const t = a.h && /^[0-9a-f]{64}$/.test(a.h) ? await getDoc(ctx, 'track/' + a.h) : null;
    if (t) {
      const fields = cleanAnswers(a), mask = Object.keys(fields);
      if (mask.length) await patch(ctx, 'track/' + a.h, fields, mask, true);
      // excuses of a line customer, from today on (an undo removes it)
      if (t.kind === 'line' && t.lineId && t.custId && fields.skips) {
        const old = t.skips || {}, days = new Set(Object.keys(fields.skips).concat(Object.keys(old)).filter(d => d >= today));
        for (const d of [...days].sort().slice(0, 3)) {
          if (!!fields.skips[d] === !!old[d]) continue;
          const f = { lineId: t.lineId, factoryId: t.factoryId || '', day: d, month: d.slice(0, 7), c: {} };
          if (fields.skips[d]) f.c[t.custId] = { at: fields.skips[d], n: String(t.name || '').slice(0, 60) };
          await patch(ctx, `excused/${t.lineId}_${d}`, f, ['lineId', 'factoryId', 'day', 'month', 'c.' + seg(t.custId)]);
        }
      }
      // a rating: once a day, only for a ride that happened, with that ride's driver
      const rt = a.rate;
      if (rt && rt.day === t.day && RODE.includes(t.st) && t.driverId && Number.isInteger(rt.stars) && rt.stars >= 1 && rt.stars <= 5) {
        const r = { h: a.h, custId: t.custId || '', kind: t.kind || '', lineId: t.lineId || '', missionId: t.missionId || '', factoryId: t.factoryId || '',
          driverId: t.driverId, day: rt.day, month: rt.day.slice(0, 7), stars: rt.stars, note: String(rt.note || '').slice(0, 300), at: ctx.now };
        const q = Object.keys(r).map(k => 'updateMask.fieldPaths=' + k).join('&') + '&currentDocument.exists=false';
        const res = await api(ctx, `${BASE}/ratings/${a.h}_${rt.day}?${q}`, { method: 'PATCH', body: JSON.stringify({ fields: enc(r).mapValue.fields }) });
        ctx.writes++;
        if (!res.ok && ![400, 409].includes(res.status)) ctx.log.push('rating ' + res.status);   // already rated today = fine
      }
    }
    // cleared only if the customer did not answer again meanwhile (then it is copied next minute)
    await patch(ctx, 'ans/' + a.id, { dirty: false }, ['dirty'], a._ut ? { updateTime: a._ut } : true);
  }
}
/** The driver's phone queued a notification on the link (pq) — send it once. The link opens with the customer's own token, so it is not in the push. */
async function customerPushes(ctx) {
  if (ctx.calls > REQ_LIMIT - RESERVE - 3) return;
  const rows = await query(ctx, 'track', ['pq', 'pqAt', 'fcm'], num('pqAt', 'GREATER_THAN', 0), 8);
  for (const t of rows) {
    if (ctx.calls > REQ_LIMIT - RESERVE - 2) break;
    if (t.fcm && t.pq && t.pq.t && ctx.now - (t.pqAt || 0) < 3 * 3600000) {
      if (!(await push(ctx, [t.fcm], { type: 'cust', tag: 'cust-' + t.id.slice(0, 8), link: SITE + 'c/', title: t.pq.t, body: t.pq.b || '', lang: t.pq.l || '', ttl: 600 }))) break;
    }
    // cleared only if the driver did not queue a newer one meanwhile
    await patch(ctx, 'track/' + t.id, { pqAt: 0 }, ['pqAt'], t._ut ? { updateTime: t._ut } : true);
  }
}

/* ---------------- build the plans ---------------- */
async function loadData(ctx, days) {
  const [settings, watch, lines, people, devices, missions, dayOff] = await Promise.all([
    getDoc(ctx, 'system/settings'), getDoc(ctx, 'system/wakeWatch'),
    query(ctx, 'lines', ['name', 'factoryId', 'driverId', 'subDriverId', 'subDay', 'morningTime', 'active']),
    query(ctx, 'people', ['name', 'code', 'type', 'driverKind', 'role', 'perms', 'active', 'phone', 'wakeLeadMin']),
    query(ctx, 'devices', ['personId', 'fcm', 'active']),
    query(ctx, 'missions', ['driverId', 'day', 'time', 'status', 'title'], inDays(days)),
    query(ctx, 'dayOff', ['day', 'factoryId'], inDays(days))
  ]);
  return { settings: Object.assign({}, W.DEFAULTS, settings || {}), watch, lines, people, devices, missions, dayOff };
}
const SETTINGS_KEYS = Object.keys(W.DEFAULTS);
async function writePlan(ctx, day, plan, prev, s) {
  const fields = { day, notify: plan.notify, builtAt: ctx.now, rebuild: false, rebuildDriver: false, rebuildFlight: false, s: {}, d: {} };
  SETTINGS_KEYS.forEach(k => { fields.s[k] = s[k]; });
  const mask = ['day', 'notify', 'builtAt', 'rebuild', 'rebuildDriver', 'rebuildFlight', 's'];
  const pids = new Set(Object.keys(plan.d).concat(prev && prev.d ? Object.keys(prev.d) : []));
  pids.forEach(pid => {
    const now = plan.d[pid], before = prev && prev.d && prev.d[pid];
    if (now && before && stable(now) === stable(before)) return;
    mask.push('d.' + seg(pid));
    if (now) fields.d[pid] = now;
  });
  if (!Object.keys(fields.d).length) delete fields.d;
  await patch(ctx, 'wake/' + day, fields, mask);
}

/* ---------------- trip orders: custody, fuel card, maintenance, papers (every 5 minutes) ---------------- */
async function recipients(ctx) {
  if (ctx.rcpt) return ctx.rcpt;
  const [people, devices] = await Promise.all([
    query(ctx, 'people', ['name', 'type', 'role', 'perms', 'active', 'vehicleId', 'licenseExpiry']),
    query(ctx, 'devices', ['personId', 'fcm', 'active'])
  ]);
  const tokens = pid => devices.filter(d => d.personId === pid && d.active === true && d.fcm).map(d => d.fcm);
  const live = people.filter(p => p.active !== false);
  const role = r => live.filter(p => p.type === 'staff' && (p.role === r)).map(p => p.id);
  const gm = live.filter(p => p.type === 'staff' && (p.perms || []).includes('all')).map(p => p.id);
  ctx.rcpt = { tokens, people: live, ops: role('operations'), airports: role('airports'), gm, driverOf: vid => (live.find(p => p.type === 'driver' && p.vehicleId === vid) || {}).id || '' };
  return ctx.rcpt;
}
/** One message to a list of people (each of their phones); staff open the Control Tower, drivers their app. */
async function tell(ctx, pids, staffLink, msg) {
  const R = await recipients(ctx), uniq = [...new Set(pids.filter(Boolean))];
  // all of them or none this minute (so nobody gets the same message twice next minute)
  if (ctx.calls + uniq.reduce((a, pid) => a + R.tokens(pid).length, 0) > REQ_LIMIT - RESERVE) { ctx.full = true; return false; }
  for (const pid of uniq) {
    const isDrv = (R.people.find(p => p.id === pid) || {}).type === 'driver';
    if (!(await push(ctx, R.tokens(pid), Object.assign({ pid, link: SITE + (isDrv ? 'driver/' : staffLink), ttl: 3600 }, msg)))) return false;
  }
  return true;
}
async function fleetAlerts(ctx) {
  const cars = await query(ctx, 'fleet', ['on', 'custody', 'fuel', 'odo', 'model', 'maint', 'alert']);
  if (!cars.length) return;
  const s = Object.assign({}, W.DEFAULTS, { custodyLow: 100, fuelLow: 1000, expiryWarnDays: 30 }, (await getDoc(ctx, 'system/settings')) || {});
  const today = W.dayKey(ctx.now), plan = FC.plan(s), lowC = Number(s.custodyLow) || 100, lowF = Number(s.fuelLow) || 1000;
  const R = () => recipients(ctx);
  let vehicles = null;
  const carName = async vid => { vehicles = vehicles || await query(ctx, 'vehicles', ['plate', 'model']); const v = vehicles.find(x => x.id === vid) || {}; return [v.model, v.plate].filter(Boolean).join(' ') || vid; };
  for (const c of cars) {
    if (c.on !== true || ctx.full || ctx.calls > REQ_LIMIT - RESERVE - 6) continue;
    const a = c.alert || {}, set = {}, mask = [];
    const mark = (k, v) => { set[k] = v; mask.push('alert.' + k); };
    // cash custody at the low mark: the driver and the operations manager (once — again only after a top-up)
    const cLow = (Number(c.custody) || 0) <= lowC;
    if (cLow && !a.custodyAt) {
      const r = await R(), name = await carName(c.id), bal = Math.round((Number(c.custody) || 0) * 100) / 100;
      if (!(await tell(ctx, [r.driverOf(c.id)].concat(r.ops.length ? r.ops : r.gm), 'control/#/fleet', { type: 'fleet', tag: 'custody-' + c.id,
        title: `عهدة المصروفات وصلت ${bal} جنيه`, body: `${name} — ${(r.people.find(p => p.id === r.driverOf(c.id)) || {}).name || ''} · خد عهدة مصروفات من مديرك` }))) break;
      mark('custodyAt', ctx.now);
    } else if (!cLow && a.custodyAt) mark('custodyAt', 0);
    // fuel card below its mark: the airports manager and the GM (once — again after it is charged and drops again)
    const fLow = (Number(c.fuel) || 0) < lowF;
    if (fLow && !a.fuelAt) {
      const r = await R(), name = await carName(c.id), bal = Math.round((Number(c.fuel) || 0) * 100) / 100;
      if (!(await tell(ctx, (r.airports.length ? r.airports : []).concat(r.gm), 'control/#/fleet', { type: 'fleet', tag: 'fuel-' + c.id, title: `فيزا البنزين أقل من ${lowF}`, body: `${name} — الرصيد ${bal} جنيه` }))) break;
      mark('fuelAt', ctx.now);
    } else if (!fLow && a.fuelAt) mark('fuelAt', 0);
    // maintenance by kilometres: 500 km before and when it is due (each stage once per change)
    if (c.model) for (const row of FC.status(c, plan, today)) {
      if (!['soon', 'due', 'check'].includes(row.stage)) continue;
      const key = `${row.stage}:${row.last ? (row.last.odo ?? row.last.day) : ''}`;
      if ((a.maint || {})[row.k] === key) continue;
      const r = await R(), name = await carName(c.id);
      const what = row.stage === 'due' ? 'لازم يتغير' : row.stage === 'check' ? 'افحصه' : `باقي ${row.left} ${row.next ? 'كم' : 'يوم'}`;
      if (!(await tell(ctx, [r.driverOf(c.id)].concat(r.airports, r.gm), 'control/#/fleet', { type: 'fleet', tag: 'maint-' + c.id + '-' + row.k, title: `صيانة ${name}: ${row.n}`, body: `${what}${row.next ? ' — عند ' + row.next + ' كم (العداد ' + (c.odo || 0) + ')' : ''}` }))) { ctx.full = true; break; }
      set.maint = Object.assign({}, a.maint || {}, set.maint || {}, { [row.k]: key }); if (!mask.includes('alert.maint')) mask.push('alert.maint');
    }
    if (mask.length) await patch(ctx, 'fleet/' + c.id, { alert: set }, mask, true);
  }
  // the papers, once a day from 9 in the morning: a month before (soon) and when they run out
  if (cairoHour(ctx.now) >= 9) {
    const fa = (await getDoc(ctx, 'system/fleetAlerts')) || {};
    if (fa.docsDay === today || ctx.full || ctx.calls > REQ_LIMIT - RESERVE - 8) return;
    const r = await R(); vehicles = vehicles || await query(ctx, 'vehicles', ['plate', 'model', 'licenseExpiry', 'insuranceExpiry']);
    const sent = Object.assign({}, fa.sent || {}), warn = Number(s.expiryWarnDays) || 30, keep = W.addDays(today, -60);
    Object.keys(sent).forEach(k => { if (sent[k] < keep) delete sent[k]; });
    const fullV = vehicles.some(v => 'licenseExpiry' in v) ? vehicles : await query(ctx, 'vehicles', ['plate', 'model', 'licenseExpiry', 'insuranceExpiry']);
    const items = [];
    for (const c of cars.filter(x => x.on === true)) {
      const v = fullV.find(x => x.id === c.id) || {}, drv = r.people.find(p => p.type === 'driver' && p.vehicleId === c.id);
      [['رخصة العربية', v.licenseExpiry, 'lic'], ['تأمين العربية', v.insuranceExpiry, 'ins']].forEach(([n, d, k]) => items.push({ n, d, key: `${k}:${c.id}`, car: c.id, name: [v.model, v.plate].filter(Boolean).join(' ') }));
      if (drv) items.push({ n: 'رخصة القيادة — ' + drv.name, d: drv.licenseExpiry, key: `dl:${drv.id}`, car: c.id, name: [v.model, v.plate].filter(Boolean).join(' ') });
    }
    for (const it of items) {
      const stg = FC.docStage(it.d, today, warn); if (stg !== 'soon' && stg !== 'expired') continue;
      const key = `${it.key}:${stg}:${it.d}`; if (sent[key]) continue;
      const left = FC.daysBetween(today, it.d);
      if (!(await tell(ctx, [r.driverOf(it.car)].concat(r.airports, r.gm), 'control/#/fleet', { type: 'fleet', tag: 'doc-' + it.key, title: `${it.n} ${stg === 'expired' ? 'خلصت' : 'هتخلص بعد ' + left + ' يوم'}`, body: `${it.name} — تاريخ الانتهاء ${it.d}` }))) break;
      sent[key] = today;
    }
    await patch(ctx, 'system/fleetAlerts', { docsDay: ctx.full ? (fa.docsDay || '') : today, sent }, ['docsDay', 'sent']);
  }
}

/* ---------------- keeping 3 months: old records go (only months already exported to the accounts) ---------------- */
const BY_MONTH = ['days', 'missionDriver', 'missionFactory', 'dayPay', 'adjustments', 'expenses', 'excused', 'ratings', 'sheets', 'fleetLog', 'salary'];
const BY_DAY = ['wake', 'wakeAcks', 'dayOff'];
const BY_TIME = [['requests', 'at'], ['audit', 'at'], ['activationRequests', 'createdAt'], ['exports', 'at']];
async function commitDeletes(ctx, paths) {
  // Firestore takes at most 500 writes in one commit
  for (let i = 0; i < paths.length; i += 450) {
    const part = paths.slice(i, i + 450);
    const r = await api(ctx, `${BASE}:commit`, { method: 'POST', body: JSON.stringify({ writes: part.map(p => ({ delete: `${DOCNAME}/${p}` })) }) });
    if (!r.ok) throw new Error('commit ' + r.status + ' ' + (await r.text()).slice(0, 160));
    ctx.writes += part.length;
  }
  return paths.length;
}
const lastDayOf = month => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const addMonths = (month, n) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 15)).toISOString().slice(0, 7); };
async function purge(ctx, s) {
  if (s.retentionOn !== true) return;
  const today = W.dayKey(ctx.now), done = (await getDoc(ctx, 'system/purge')) || {};
  if (done.day === today) return;
  const keep = Math.max(3, Number(s.retentionMonths) || 3);
  let cutM = addMonths(today.slice(0, 7), -(keep - 1));                   // the first month that stays
  const lock = (await getDoc(ctx, 'system/lock')) || {};
  // nothing goes that the accounts did not get: the month before the cut must be exported to its last day
  while (cutM > '2000-01' && !(lock.until && lock.until >= lastDayOf(addMonths(cutM, -1)))) cutM = addMonths(cutM, -1);
  if (cutM <= '2000-01') { await patch(ctx, 'system/purge', { day: today, note: 'nothing exported yet' }, ['day', 'note']); return; }
  const cutDay = cutM + '-01', cutMs = Date.parse(cutDay + 'T00:00:00Z') - 3 * 3600000;
  let removed = 0, more = false;
  const room = () => ctx.calls < REQ_LIMIT - RESERVE - 4;
  const strLt = (f, v) => ({ fieldFilter: { field: { fieldPath: f }, op: 'LESS_THAN', value: { stringValue: v } } });
  const tsLt = (f, ms) => ({ fieldFilter: { field: { fieldPath: f }, op: 'LESS_THAN', value: { timestampValue: new Date(ms).toISOString() } } });
  // trips first: their customers' links go with them (a line customer's link is for every day — it stays)
  if (room()) {
    const ms = await query(ctx, 'missions', ['customers'], strLt('month', cutM), 40);
    const hs = ms.flatMap(m => (m.customers || []).map(c => c && c.h).filter(h => /^[0-9a-f]{64}$/.test(h || '')));
    const links = hs.length ? await batchGet(ctx, hs.map(h => 'custLinks/' + h)) : {};
    const paths = ms.map(m => 'missions/' + m.id).concat(hs.flatMap(h => ['track/' + h, 'live/' + h, 'signs/' + h, 'custLinks/' + h]),
      Object.values(links).map(l => l.token && /^[A-Za-z0-9]{20,}$/.test(l.token) ? 'ans/' + l.token : null).filter(Boolean));
    removed += await commitDeletes(ctx, paths); if (ms.length === 40) more = true;
  }
  for (const col of BY_MONTH) { if (!room()) { more = true; break; } const rows = await query(ctx, col, ['__name__'], strLt('month', cutM), 300); removed += await commitDeletes(ctx, rows.map(r => col + '/' + r.id)); if (rows.length === 300) more = true; }
  for (const col of BY_DAY) { if (!room()) { more = true; break; } const rows = await query(ctx, col, ['__name__'], strLt('day', cutDay), 300); removed += await commitDeletes(ctx, rows.map(r => col + '/' + r.id)); if (rows.length === 300) more = true; }
  if (room()) { const rows = await query(ctx, 'incidents', ['__name__'], num('at', 'LESS_THAN', cutMs), 300); removed += await commitDeletes(ctx, rows.map(r => 'incidents/' + r.id)); }
  for (const [col, f] of BY_TIME) { if (!room()) { more = true; break; } const rows = await query(ctx, col, ['__name__'], tsLt(f, cutMs), 300); removed += await commitDeletes(ctx, rows.map(r => col + '/' + r.id)); if (rows.length === 300) more = true; }
  ctx.log.push(`purge before ${cutM}: ${removed}${more ? ' (more next run)' : ''}`);
  if (!more) await patch(ctx, 'system/purge', { day: today, before: cutM, removed: (done.day === today ? Number(done.removed) || 0 : 0) + removed, at: ctx.now }, ['day', 'before', 'removed', 'at']);
}

/* ---------------- translation for the guests' messages (signed-in staff and drivers) ---------------- */
let jwks = null;
async function verifyIdToken(ctx, tok) {
  const [h64, p64, s64] = String(tok || '').split('.');
  if (!h64 || !p64 || !s64) throw new Error('bad token');
  const dec64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
  const head = JSON.parse(new TextDecoder().decode(dec64(h64))), body = JSON.parse(new TextDecoder().decode(dec64(p64)));
  if (!jwks || jwks.exp < ctx.now) {
    const r = await ctx.f('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    if (!r.ok) throw new Error('keys ' + r.status);   // not cached — tried again on the next request
    const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
    jwks = { keys: (await r.json()).keys || [], exp: ctx.now + (m ? Number(m[1]) * 1000 : 3600000) };
  }
  const jwk = jwks.keys.find(k => k.kid === head.kid);
  if (!jwk || head.alg !== 'RS256') throw new Error('unknown key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, dec64(s64), new TextEncoder().encode(h64 + '.' + p64));
  const now = Math.floor(ctx.now / 1000);
  if (!ok || body.aud !== PROJECT || body.iss !== 'https://securetoken.google.com/' + PROJECT || !(body.exp > now) || !(body.iat <= now + 300) || !body.sub) throw new Error('invalid token');
  return body.sub;
}
const ORIGINS = ['https://3pyramidstravel-dev.github.io'];
const cors = req => { const o = req.headers.get('origin') || ''; return { 'access-control-allow-origin': ORIGINS.includes(o) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o) ? o : ORIGINS[0], 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' }; };
const perUid = new Map();
export async function translate(req, env, f, nowMs) {
  const H = cors(req), out = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, H) });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
  if (req.method !== 'POST') return out({ error: 'POST only' }, 405);
  if (!env.AI) return out({ error: 'translation is not set up' }, 501);
  const ctx = { env, now: nowMs || Date.now(), reads: 0, writes: 0, sent: 0, calls: 0, full: false, log: [], pushed: [] };
  ctx.f = (u, o) => { ctx.calls++; return f ? f(u, o) : fetch(u, o); };   // fetch is never called as a method (Cloudflare: Illegal invocation)
  let uid;
  try { uid = await verifyIdToken(ctx, (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')); } catch (e) { return out({ error: 'sign in first' }, 401); }
  const dev = await getDoc(ctx, 'devices/' + uid).catch(() => null);
  // staff and drivers only (a device added by hand may lack "kind" — then the person decides)
  const who = dev && dev.active === true && dev.personId ? (dev.kind ? { type: dev.kind, active: true } : await getDoc(ctx, 'people/' + dev.personId).catch(() => null)) : null;
  if (!who || who.active === false || !['staff', 'driver'].includes(who.type)) return out({ error: 'not allowed' }, 403);
  // a few per minute per phone (the free daily quota is shared)
  const hist = (perUid.get(uid) || []).filter(t => ctx.now - t < 60000); if (hist.length >= 8) return out({ error: 'too many — wait a minute' }, 429); hist.push(ctx.now); perUid.set(uid, hist);
  let body = {}; try { body = await req.json(); } catch (e) { /* empty */ }
  const text = String(body.text || '').slice(0, 1200).trim(), to = String(body.to || ''), from = String(body.from || 'ar');
  const langs = ['ar', 'en', 'de', 'fr', 'ru', 'zh', 'ko'];
  if (!text || !langs.includes(to) || !langs.includes(from)) return out({ error: 'text and language' }, 400);
  if (to === from) return out({ text });
  try {
    const r = await env.AI.run('@cf/meta/m2m100-1.2b', { text, source_lang: from, target_lang: to });
    const t = r && (r.translated_text || r.translation || r.text);
    return t ? out({ text: String(t) }) : out({ error: 'no translation' }, 502);
  } catch (e) { return out({ error: 'translation failed' }, 502); }
}

/* ---------------- one run (every minute) ---------------- */
export async function run(env, now, f) {
  const raw = f || ((u, o) => fetch(u, o));
  const ctx = { env, now, reads: 0, writes: 0, sent: 0, calls: 0, full: false, log: [], pushed: [] };
  ctx.f = (u, o) => { ctx.calls++; return raw(u, o); };
  const today = W.dayKey(now), tomorrow = W.addDays(today, 1), days = [today, tomorrow];
  let plans = {};
  for (const day of days) plans[day] = await getDoc(ctx, 'wake/' + day);

  // 1) (re)build: every hour, when a plan is missing, or when asked — the Control Tower at most every
  //    3 minutes, a driver (his own wake time / new phone) at most every 30 minutes, to protect the free quota
  const minute = Math.floor(now / 60000) % 60;
  const since = d => now - ((plans[d] && plans[d].builtAt) || 0);
  const built = minute === 0 || days.some(d => !plans[d] || plans[d].rebuildFlight || (plans[d].rebuild && since(d) >= 3 * 60000) || (plans[d].rebuildDriver && since(d) >= 30 * 60000));
  if (built) {
    const data = await loadData(ctx, days);
    for (const day of days) {
      const plan = W.buildPlan(day, data, plans[day]);
      await writePlan(ctx, day, plan, plans[day], data.settings);
      // keep the plan's own fields (night check …) that the build does not touch
      plans[day] = Object.assign({}, plans[day] || {}, plan, { s: data.settings, builtAt: now, rebuild: false, rebuildDriver: false, rebuildFlight: false });
    }
    ctx.log.push('built');
  }

  // 2) the wake-ups that are due now
  let lateMarks = [];
  for (const day of days) {
    const plan = plans[day]; if (!plan || !plan.d) continue;
    const s = Object.assign({}, W.DEFAULTS, plan.s || {});
    const ids = Object.keys(plan.d).filter(pid => {
      const e = plan.d[pid];
      return !e.gone && !e.awakeAt && !e.outcome && now >= e.wakeAt - 60000 && now <= e.job.at + s.wakeGiveUpMin * 60000;
    });
    if (!ids.length) continue;
    const acks = await batchGet(ctx, ids.map(pid => `wakeAcks/${day}_${pid}`));
    const upd = {}, mask = [];
    const set = (pid, k, v) => { (upd[pid] = upd[pid] || {})[k] = v; mask.push(`d.${seg(pid)}.${k}`); };
    for (const pid of ids) {
      const e = plan.d[pid], ack = acks[`wakeAcks/${day}_${pid}`];
      if (ack && W.validAwake(e, ack.awakeAt)) { set(pid, 'awakeAt', ack.awakeAt); set(pid, 'awakeMethod', ack.method || 'pressed'); continue; }
      for (const step of W.due(e, now, s)) {
        if (ctx.full) break;
        const at = W.hm12(e.job.at);
        if (step === 'p1' || step === 'p2') {
          if (!(await push(ctx, e.tokens, { type: 'wake', day, pid, tag: 'wake-' + day, link: SITE + 'driver/?wake=1',
            title: step === 'p1' ? `صباح الخير يا ${first(e.name)} ☀️` : 'لسه مستنيينك ⏰',
            body: `${e.job.label} الساعة ${at} — افتح التطبيق ودوس "صباح الخير"` }))) break;
          set(pid, step, now);
          if (step === 'p1' && !(e.tokens || []).length) set(pid, 'noToken', true);
        } else if (step === 'sup') {
          if (!(await push(ctx, plan.notify && plan.notify.sup, { type: 'sup', day, pid, tag: 'sup-' + pid, link: SITE + 'control/#/wake',
            title: `⚠️ ${who(e)} مصحيش`, body: `${e.job.label} الساعة ${at} — كان المفروض يصحى ${W.hm12(e.wakeAt)}${e.watch ? ' (تحت المتابعة)' : ''}` }))) break;
          set(pid, 'supAt', now); lateMarks.push([pid, day]);
        } else if (step === 'mgmt') {
          const held = e.claim ? ` — ${e.claim.by} ماسكه من ${Math.round((now - e.claim.at) / 60000)} دقيقة ومفيش رد` : ' ومحدش استلم';
          if (!(await push(ctx, plan.notify && plan.notify.mgmt, { type: 'mgmt', day, pid, tag: 'mgmt-' + pid, link: SITE + 'control/#/wake',
            title: `🚨 ${who(e)} مصحيش${held}`, body: `${e.job.label} الساعة ${at} — اتأخر ${Math.round((now - e.wakeAt) / 60000)} دقيقة` }))) break;
          set(pid, 'mgmtAt', now);
        }
      }
    }
    if (mask.length) await patch(ctx, 'wake/' + day, { d: upd }, mask);
  }

  // 2b) customers: "العربية في الطريق" / "العربية وصلت" (after the wake-ups, with what is left of the budget)
  if (!ctx.full) { try { await customerAnswers(ctx); await customerPushes(ctx); } catch (e) { ctx.log.push('customers: ' + e.message); } }

  // 3) late record (for "تحت المتابعة")
  if (lateMarks.length && ctx.calls <= REQ_LIMIT - 2) {
    const w = (await getDoc(ctx, 'system/wakeWatch')) || {};
    const late = w.late || {}, keep = W.addDays(today, -40), fields = { late: {} }, mask = [];
    lateMarks.forEach(([pid, day]) => { fields.late[pid] = Array.from(new Set((late[pid] || []).filter(x => x >= keep).concat(day))).sort(); mask.push('late.' + seg(pid)); });
    await patch(ctx, 'system/wakeWatch', fields, mask);
  }

  // 4) evening: remind tomorrow's drivers to confirm, then tell the supervisors who did not
  //    (not in a run that rebuilt or ran out of budget — one minute later is fine)
  const tp = plans[tomorrow];
  if (tp && tp.d && !built && !ctx.full && ctx.calls <= REQ_LIMIT - RESERVE) {
    const s = Object.assign({}, W.DEFAULTS, tp.s || {});
    const live = Object.keys(tp.d).filter(pid => !tp.d[pid].gone);
    if (now >= W.cairoMs(today, s.readyReminderTime)) {
      const ids = live.filter(pid => !tp.d[pid].remind && tp.d[pid].wakeAt - now > 2 * 3600000);
      if (ids.length) {
        const acks = await batchGet(ctx, ids.map(pid => `wakeAcks/${tomorrow}_${pid}`));
        const upd = {}, mask = [];
        for (const pid of ids) {
          const e = tp.d[pid];
          if (!(acks[`wakeAcks/${tomorrow}_${pid}`] || {}).readyAt && !(await push(ctx, e.tokens, { type: 'ready', day: tomorrow, pid, tag: 'ready-' + tomorrow, link: SITE + 'driver/',
            title: 'عندك شغل بكره 🌙', body: `${e.job.label} الساعة ${W.hm12(e.job.at)} — افتح التطبيق ودوس "جاهز لبكره"` }))) break;
          (upd[pid] = {}).remind = now; mask.push(`d.${seg(pid)}.remind`);
        }
        if (mask.length) await patch(ctx, 'wake/' + tomorrow, { d: upd }, mask);
      }
    }
    if (now >= W.cairoMs(today, s.nightCheckTime) && !tp.nightSent && !ctx.full) {
      const acks = await batchGet(ctx, live.map(pid => `wakeAcks/${tomorrow}_${pid}`));
      const notReady = live.filter(pid => !(acks[`wakeAcks/${tomorrow}_${pid}`] || {}).readyAt && tp.d[pid].wakeAt - now > 3600000);
      const sentOk = !notReady.length || await push(ctx, tp.notify && tp.notify.sup, { type: 'night', day: tomorrow, tag: 'night-' + tomorrow, link: SITE + 'control/#/wake',
        title: `فحص الليل: ${notReady.length} سواق مأكدوش "جاهز لبكره"`, body: notReady.slice(0, 6).map(pid => who(tp.d[pid])).join('، ') + (notReady.length > 6 ? '…' : '') });
      if (sentOk) await patch(ctx, 'wake/' + tomorrow, { nightSent: now, notReady }, ['nightSent', 'notReady']);
    }
  }
  // 5) airport trips: flight look-ups, last — the wake-ups always come first. A trip whose time moved
  //    has its day's wake-up plan rebuilt in the next minute.
  if (!ctx.full && ctx.calls <= REQ_LIMIT - 12 && minute % 2 === 0) {   // every 2 minutes (a just-saved trip is looked up within 2 minutes)
    try {
      const movedDays = await flights(ctx);
      for (const d of days) if (movedDays.has(d) && plans[d]) await patch(ctx, 'wake/' + d, { rebuildFlight: true }, ['rebuildFlight']);
    } catch (e) { ctx.log.push('flights: ' + e.message); }
  }
  // 6) trip orders (every 5 minutes): custody, fuel card, maintenance, papers
  if (FC && !ctx.full && ctx.calls <= REQ_LIMIT - 14 && minute % 5 === 3) {
    try { await fleetAlerts(ctx); } catch (e) { ctx.log.push('fleet: ' + e.message); }
  }
  // 7) keeping 3 months: at night, every 10 minutes until the old months are gone (only if switched on)
  const hr = cairoHour(now);
  if (!ctx.full && ctx.calls <= REQ_LIMIT - 16 && minute % 10 === 7 && hr >= 1 && hr < 5) {
    try { const s = (await getDoc(ctx, 'system/settings')) || {}; await purge(ctx, s); } catch (e) { ctx.log.push('purge: ' + e.message); }
  }
  return { today, reads: ctx.reads, writes: ctx.writes, sent: ctx.sent, calls: ctx.calls, pushed: ctx.pushed, log: ctx.log };
}

export default {
  async scheduled(event, env, ctx) {
    const now = (event && event.scheduledTime) || Date.now();
    ctx.waitUntil(run(env, now).then(r => console.log(JSON.stringify(r)), e => console.log('ERROR', (e && e.stack) || e)));
  },
  /** /check — is the secret in place and does Google accept it? (no database reads, nothing sent) */
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/translate') return translate(req, env);
    if (url.pathname === '/check') {
      try {
        if (!env.GOOGLE_SA) return Response.json({ ok: false, error: 'GOOGLE_SA secret is missing' }, { status: 500 });
        const sa = JSON.parse(env.GOOGLE_SA);
        if (sa.project_id && sa.project_id !== PROJECT) return Response.json({ ok: false, error: 'key belongs to ' + sa.project_id }, { status: 500 });
        await accessToken({ env, now: Date.now(), f: (u, o) => fetch(u, o) });   // fetch must not be called as a method (Cloudflare: Illegal invocation)
        return Response.json({ ok: true, project: PROJECT, google: 'key accepted', flights: env.FLIGHT_KEY ? 'key set' : 'no key — flight times typed by hand', translate: env.AI ? 'on' : 'off', time: new Date().toISOString() });
      } catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e) }, { status: 500 }); }
    }
    return new Response('tp-alarm — Three Pyramids cloud alarm is running.', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
};
