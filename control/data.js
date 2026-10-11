/* ==========================================================================
   Control Tower — live data
   Subscribes only to what the signed-in person is allowed to read
   (anything else would just be refused by the security rules).
   ========================================================================== */
(function (TP) {
  'use strict';
  const S = TP.session;
  const D = TP.D = {
    people: [], devices: [], codes: [], requests: [], companies: [], lines: [], vehicles: [], cards: [],
    factoryRequests: [], expensesPending: [], lock: null, flightUsage: null,
    todayDays: [], pendingOT: [], incidents: [], dayOff: [], todayKey: '', driverCodes: [],
    wakePlans: {}, wakeAcks: [], wakeWatch: null,
    factoryRates: {}, driverRates: {}, airportRates: {}, settings: Object.assign({}, TP.DEFAULT_SETTINGS), audit: [],
    fleet: [], salaryBase: {},
    loaded: {}
  };
  let unsubs = [];

  const emit = key => { D.loaded[key] = true; document.dispatchEvent(new CustomEvent('tp:data', { detail: key })); };
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar');
  const toMap = list => { const m = {}; list.forEach(x => { m[x.id] = x; }); return m; };

  function sub(key, colPath, opts, transform) {
    unsubs.push(TP.fb.onCol(colPath, opts, list => {
      D[key] = transform ? transform(list) : list;
      emit(key);
    }, err => { console.warn(key, err && err.code); D[key] = D[key] || []; emit(key); }));
  }

  TP.data = {
    start() {
      TP.data.stop();
      const can = S.can;
      if (can('staff.manage') || can('drivers.manage') || can('devices.manage') || can('tracking.view') || can('factories.manage') || can('prices.view') || can('lines.manage') || can('airport.prices') || can('missions.manage') || can('wake.supervise') || can('reports.attendance') || can('times.correct') || can('overtime.approve') || can('advances.manage') || can('reports.finance')) {
        sub('people', 'people', null, l => l.sort(byName));
      }
      if (can('devices.manage') || can('tracking.view') || can('staff.manage') || can('drivers.manage')) sub('devices', 'devices', null);
      if (can('drivers.manage')) sub('driverCodes', 'driverCodes', null);
      if (can('drivers.manage') || can('vehicles.manage')) sub('cards', 'cards', null);
      /* phase 5–6 — factory requests, driver expenses, export lock */
      if (can('missions.manage') || can('lines.manage') || can('airport.manage')) sub('factoryRequests', 'requests', { where: [['status', '==', 'pending']] }, l => l.sort((a, b) => ((TP.toDate(a.at) || 0) - (TP.toDate(b.at) || 0))));
      if (can('missions.manage') || can('advances.manage')) sub('expensesPending', 'expenses', { where: [['status', '==', 'pending']] }, l => l.sort((a, b) => (a.at || 0) - (b.at || 0)));
      unsubs.push(TP.fb.onDoc('system/lock', d => { D.lock = d; emit('lock'); }, () => emit('lock')));
      unsubs.push(TP.fb.onDoc('system/flightUsage', d => { D.flightUsage = d; emit('flightUsage'); }, () => {}));
      if (can('devices.manage')) {
        sub('codes', 'activationCodes', null, l => l.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)));
        sub('requests', 'activationRequests', null);
      }
      sub('companies', 'companies', null, l => l.sort(byName));
      if (can('lines.manage') || can('tracking.view') || can('wake.supervise') || can('missions.manage') || can('reports.attendance') || can('times.correct') || can('overtime.approve')) sub('lines', 'lines', null, l => l.sort(byName));
      sub('vehicles', 'vehicles', null, l => l.sort((a, b) => String(a.plate).localeCompare(String(b.plate))));
      if (can('prices.view')) {
        sub('factoryRates', 'factoryRates', null, toMap);
        sub('driverRates', 'driverRates', null, toMap);
      }
      if (can('prices.view') || can('airport.prices')) sub('airportRates', 'airportRates', null, toMap);
      /* phase 7 — trip orders (أمر الشغل): the cars' custody, fuel, odometer; the tourism drivers' base salary */
      if (can('fleet.manage') || can('salary.manage') || can('tracking.view') || can('reports.finance') || can('month.close')) sub('fleet', 'fleet', null);
      if (can('salary.manage')) sub('salaryBase', 'salaryBase', null, toMap);
      unsubs.push(TP.fb.onDoc('system/settings', s => { D.settings = Object.assign({}, TP.DEFAULT_SETTINGS, s || {}); emit('settings'); }, () => emit('settings')));
      if (can('audit.view')) sub('audit', 'audit', { orderBy: ['at', 'desc'], limit: 300 });
      /* phase 2 — the working day */
      const today = D.todayKey = TP.dayKey();
      if (TP.staffSeesDays(S.perms)) {
        sub('todayDays', 'days', { where: [['day', '==', today]] });
        sub('pendingOT', 'days', { where: [['ot.status', '==', 'pending']] }, l => l.sort((a, b) => (a.ot.reqAt || 0) - (b.ot.reqAt || 0)));
      }
      if (can('tracking.view')) sub('incidents', 'incidents', { where: [['status', '==', 'open']] }, l => l.sort((a, b) => (b.at || 0) - (a.at || 0)));
      sub('dayOff', 'dayOff', { where: [['day', '>=', TP.ops.addDays(today, -1)]] });
      /* phase 3 — the wake-up (plans are written by the cloud alarm) */
      D.wakePlans = {}; D.wakeAcks = [];
      if (can('wake.supervise') || can('tracking.view') || can('times.correct')) {
        const days = [today, TP.ops.addDays(today, 1)];
        days.forEach(day => unsubs.push(TP.fb.onDoc('wake/' + day, d => { D.wakePlans[day] = d; emit('wake'); }, err => { console.warn('wake', err && err.code); emit('wake'); })));
        sub('wakeAcks', 'wakeAcks', { where: [['day', 'in', days]] });
        if (can('wake.supervise') || can('tracking.view')) unsubs.push(TP.fb.onDoc('system/wakeWatch', d => { D.wakeWatch = d; emit('wake'); }, () => {}));
      }
    },
    stop() { unsubs.forEach(u => { try { u(); } catch (e) { /* ignore */ } }); unsubs = []; D.loaded = {}; },
    /** One extra live query owned by a view (closed when the view is left). */
    watch(colPath, opts, cb) {
      return TP.fb.onCol(colPath, opts, cb, err => { console.warn(colPath, err && err.code); cb([]); });
    }
  };

  /* ---------- lookups ---------- */
  TP.q = {
    person: id => D.people.find(p => p.id === id),
    /** "101 · name" for a person id */
    dname: id => TP.driverLabel(D.people.find(p => p.id === id)),
    company: id => D.companies.find(c => c.id === id),
    line: id => D.lines.find(l => l.id === id),
    vehicle: id => D.vehicles.find(v => v.id === id),
    drivers: kind => D.people.filter(p => p.type === 'driver' && (!kind || p.driverKind === kind)),
    staff: () => D.people.filter(p => p.type === 'staff' || p.type === 'hr'),
    devicesOf: pid => D.devices.filter(d => d.personId === pid),
    online: d => { const t = TP.toDate(d.lastSeen); return !!t && (Date.now() - t.getTime()) < 7 * 60 * 1000; },
    activeCodeFor: pid => D.codes.find(c => c.personId === pid && !c.used && c.expiresAtMs > Date.now()),
    /** Wake-up rows of today & tomorrow with their live status. */
    wakeRows: () => {
      const W = TP.wakeCore, now = TP.now(), rows = [];
      Object.keys(D.wakePlans).sort().forEach(day => {
        const plan = D.wakePlans[day]; if (!plan || !plan.d) return;
        const s = Object.assign({}, W.DEFAULTS, D.settings, plan.s || {});
        Object.keys(plan.d).forEach(pid => {
          const e = plan.d[pid], ack = D.wakeAcks.find(a => a.id === day + '_' + pid) || null;
          rows.push({ day, pid, e, ack, status: W.status(e, ack, now, s), s });
        });
      });
      return rows.sort((a, b) => a.e.wakeAt - b.e.wakeAt);
    },
    wakeNeedsAction: () => TP.q.wakeRows().filter(r => r.status === 'late' || r.status === 'escalated')
  };
  /**
   * Customer links. The secret token is known only to the customer and to the staff who send it
   * (custLinks/{h}); lines, trips, drivers and HR only know h = sha256(token). The car's status lives in
   * track/{h}; the customer's own answers go to ans/{token}, which only the token can address.
   */
  TP.cust = {
    async newLink() { const token = TP.token(); return { token, h: await TP.sha256(token) }; },
    linkOp: (h, token, meta) => ({ op: 'set', path: 'custLinks/' + h, data: Object.assign({ token, at: TP.fb.ts() }, meta) }),
    dropOps: h => [{ op: 'delete', path: 'track/' + h }, { op: 'delete', path: 'custLinks/' + h }, { op: 'delete', path: 'live/' + h }, { op: 'delete', path: 'signs/' + h }],
    /** h → token for the given customers (staff only). */
    async tokens(list) {
      const out = {};
      await Promise.all((list || []).filter(c => c && c.h).map(c => TP.fb.get('custLinks/' + c.h).then(d => { if (d && d.token) out[c.h] = d.token; }).catch(() => {})));
      return out;
    }
  };
  /** A day already exported to the accounts: the change is marked so it shows in the next export. */
  TP.lockFix = function (day, reason) {
    const L = TP.D.lock;
    return L && L.until && day && day <= L.until ? { lateFix: { at: TP.now(), sv: TP.fb.ts(), by: TP.session.person.name, reason: String(reason || '').slice(0, 300) } } : {};
  };
  TP.isLocked = day => !!(TP.D.lock && TP.D.lock.until && day && day <= TP.D.lock.until);
})(window.TP = window.TP || {});
