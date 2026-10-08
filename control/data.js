/* ==========================================================================
   Control Tower — live data
   Subscribes only to what the signed-in person is allowed to read
   (anything else would just be refused by the security rules).
   ========================================================================== */
(function (TP) {
  'use strict';
  const S = TP.session;
  const D = TP.D = {
    people: [], devices: [], codes: [], requests: [], companies: [], lines: [], vehicles: [],
    todayDays: [], pendingOT: [], incidents: [], dayOff: [], todayKey: '',
    factoryRates: {}, driverRates: {}, airportRates: {}, settings: Object.assign({}, TP.DEFAULT_SETTINGS), audit: [],
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
    company: id => D.companies.find(c => c.id === id),
    line: id => D.lines.find(l => l.id === id),
    vehicle: id => D.vehicles.find(v => v.id === id),
    drivers: kind => D.people.filter(p => p.type === 'driver' && (!kind || p.driverKind === kind)),
    staff: () => D.people.filter(p => p.type === 'staff' || p.type === 'hr'),
    devicesOf: pid => D.devices.filter(d => d.personId === pid),
    online: d => { const t = TP.toDate(d.lastSeen); return !!t && (Date.now() - t.getTime()) < 7 * 60 * 1000; },
    activeCodeFor: pid => D.codes.find(c => c.personId === pid && !c.used && c.expiresAtMs > Date.now())
  };
})(window.TP = window.TP || {});
