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
