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
