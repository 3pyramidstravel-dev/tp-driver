/* tp-alarm — built 2026-10-10T17:34Z. Paste this whole file into the Cloudflare editor. */
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
const PROJECT = 'three-pyramids-d8ce7';
const SITE = 'https://3pyramidstravel-dev.github.io/tp-driver/';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const DOCNAME = `projects/${PROJECT}/databases/(default)/documents`;
const REQ_LIMIT = 46;                 // the free plan allows 50 outgoing requests per run — keep a margin
const RESERVE = 6;                    // requests kept for the writes that follow the pushes
let cachedToken = null, cachedKey = null;

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
        notification: { title: m.title, body: m.body, icon: SITE + 'shared/icon-192.png', badge: SITE + 'shared/icon-192.png', tag: m.tag, renotify: true, requireInteraction: true, vibrate: [500, 200, 500, 200, 900], lang: 'ar', dir: 'rtl' },
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
    const tf = { no: fl.no, dir: fl.dir, terminal: fl.terminal || '', airportName: fl.airportName || '', other: fl.other || '', airline: fl.airline || '', sched: fl.sched || null, est: fl.est || null, status: fl.status || '' };
    for (const c of (m.customers || []).slice(0, 4)) if (c && /^[0-9a-f]{64}$/.test(c.h || '')) await patch(ctx, 'track/' + c.h, { flight: tf, day: fields.day || m.day, time: fields.time || m.time || '' }, ['flight', 'day', 'time'], true);
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
      if (!(await push(ctx, [t.fcm], { type: 'cust', tag: 'cust-' + t.id.slice(0, 8), link: SITE + 'c/', title: t.pq.t, body: t.pq.b || '', ttl: 600 }))) break;
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
    if (url.pathname === '/check') {
      try {
        if (!env.GOOGLE_SA) return Response.json({ ok: false, error: 'GOOGLE_SA secret is missing' }, { status: 500 });
        const sa = JSON.parse(env.GOOGLE_SA);
        if (sa.project_id && sa.project_id !== PROJECT) return Response.json({ ok: false, error: 'key belongs to ' + sa.project_id }, { status: 500 });
        await accessToken({ env, now: Date.now(), f: (u, o) => fetch(u, o) });   // fetch must not be called as a method (Cloudflare: Illegal invocation)
        return Response.json({ ok: true, project: PROJECT, google: 'key accepted', flights: env.FLIGHT_KEY ? 'key set' : 'no key — flight times typed by hand', time: new Date().toISOString() });
      } catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e) }, { status: 500 }); }
    }
    return new Response('tp-alarm — Three Pyramids cloud alarm is running.', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
};
