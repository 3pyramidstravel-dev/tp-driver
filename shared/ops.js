/* ==========================================================================
   Operations logic shared by the driver app, the Control Tower and (later)
   the reports: the steps of a line day, half/full day, evening waiting,
   overtime, missions, incidents and the driver's month statement.

   One document per line per day:  days/{lineId}_{YYYY-MM-DD}
     { lineId, factoryId, driverId, day, month, lastKey,
       events: { p0_arr: {at, lat, lng, acc, dist, far, auto, noGps, by}, … },
       ot: { tier, status: pending|approved|rejected|cancelled, … } }
   Times are epoch milliseconds taken on the phone when the button was
   pressed, so presses made without internet keep their real time.
   ========================================================================== */
(function (TP) {
  'use strict';
  const ops = TP.ops = {};

  /* ---------- Cairo wall-clock helpers (DST safe) ---------- */
  const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TP.TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function wall(ms) {
    const o = {};
    partsFmt.formatToParts(new Date(ms)).forEach(p => { if (p.type !== 'literal') o[p.type] = Number(p.value); });
    o.hour = o.hour % 24;
    return o;
  }
  function offsetAt(ms) { const w = wall(ms); return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000; }
  /** Epoch ms of a Cairo wall time: day 'YYYY-MM-DD' + 'HH:MM'. */
  ops.cairoMs = function (day, hhmm) {
    const [y, m, d] = day.split('-').map(Number), [h, mi] = String(hhmm).split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, h, mi);
    let ms = guess - offsetAt(guess);
    ms = guess - offsetAt(ms);
    return ms;
  };
  /** 'HH:MM' (24h) in Cairo. */
  ops.hm = ms => { const w = wall(ms); return String(w.hour).padStart(2, '0') + ':' + String(w.minute).padStart(2, '0'); };
  ops.hourOf = ms => wall(ms).hour;
  ops.addDays = (day, n) => { const t = new Date(day + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  ops.monthOf = day => String(day || '').slice(0, 7);
  ops.addMonths = (month, n) => { const [y, m] = month.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 15)); return t.toISOString().slice(0, 7); };
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  ops.monthName = month => { const [y, m] = String(month).split('-').map(Number); return (MONTHS[m - 1] || '') + ' ' + y; };
  /** 'HH:MM' → '9:30 م' */
  ops.hm12 = hhmm => {
    if (!/^\d{1,2}:\d{2}$/.test(hhmm || '')) return '—';
    let [h, m] = hhmm.split(':').map(Number);
    if (h === 24) h = 0;
    const pm = h >= 12, h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${pm ? 'م' : 'ص'}`;
  };

  /* ---------- distance ---------- */
  ops.dist = function (a, b) {
    if (!a || !b || !isFinite(a.lat) || !isFinite(b.lat)) return null;
    const R = 6371000, rad = x => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(s)));
  };
  ops.fmtDist = m => m === null || m === undefined ? '' : m >= 1000 ? (m / 1000).toFixed(1) + ' كم' : m + ' م';

  /* ---------- line day steps ---------- */
  ops.KEY_RE = /^(p[0-9]_(arr|dep)|fm_arr|fe_arr|fe_dep|end)$/;
  ops.dayId = (lineId, day) => lineId + '_' + day;

  /** Customers of a point (older lines kept plain guest names). */
  ops.custsOf = p => (p && Array.isArray(p.customers)) ? p.customers : ((p && p.guests) || []).map(n => ({ name: n }));
  /** Every customer of a line, with the index of his point. */
  ops.lineCustomers = line => (line.points || []).flatMap((p, i) => ops.custsOf(p).map(c => Object.assign({ pointIdx: i, pointName: p.name, pointLoc: p.location || null }, c)));
  /**
   * Who rode: the driver records `picked.{custId}` / `noshow.{custId}` on the day or trip; an excuse ("مش راكب")
   * comes only from the customer himself (`excused/{lineId}_{day}`, written by the cloud alarm) — the driver cannot write one.
   * Returns { s: picked | noshow | skip, at, n, … } or null. Riding beats an excuse.
   */
  ops.riderOf = (doc, cid, exc) => {
    const g = k => doc && doc[k] && typeof doc[k] === 'object' ? doc[k][cid] : null;
    if (g('noshow')) return Object.assign({ s: 'noshow' }, g('noshow'));
    if (g('picked')) return Object.assign({ s: 'picked' }, g('picked'));
    const e = exc && exc.c && exc.c[cid];
    return e ? Object.assign({ s: 'skip' }, e) : null;
  };
  /** custId → rider for everyone recorded on a day / trip (+ its excuses). */
  ops.ridersOf = (doc, exc) => {
    const ids = new Set([].concat(Object.keys((doc && doc.picked) || {}), Object.keys((doc && doc.noshow) || {}), Object.keys((exc && exc.c) || {})));
    const out = {}; ids.forEach(id => { out[id] = ops.riderOf(doc, id, exc); }); return out;
  };
  /** Did the customer say "مش راكب" for `day` (his answers, copied to his link by the cloud alarm)? */
  ops.skipsOn = (t, day) => !!(t && t.skips && typeof t.skips === 'object' && t.skips[day]);
  /**
   * Ordered steps of a line day. `factory` is the companies doc (for its location).
   * `skip` = point indexes the car does not need to pass today (every customer there said "مش راكب")
   * unless the driver already recorded something there.
   */
  ops.steps = function (line, factory, skip, events) {
    const out = [], ev = events || {};
    (line.points || []).slice(0, 10).forEach((p, i) => {
      if (skip && skip.has && skip.has(i) && !ev[`p${i}_arr`] && !ev[`p${i}_dep`]) return;
      const custs = ops.custsOf(p), guests = custs.map(c => c.name).filter(Boolean);
      out.push({ key: `p${i}_arr`, phase: 'm', kind: 'arr', target: 'point', i, name: p.name, loc: p.location, custs, guests, label: `وصلت ${p.name}`, short: `وصول ${i + 1}` });
      out.push({ key: `p${i}_dep`, phase: 'm', kind: 'dep', target: 'point', i, name: p.name, loc: p.location, custs, guests, label: `اتحركت من ${p.name}`, short: `تحرك ${i + 1}` });
    });
    const fl = factory && factory.location, fname = (factory && factory.name) || 'المصنع';
    out.push({ key: 'fm_arr', phase: 'm', kind: 'arr', target: 'factory', name: fname, loc: fl, label: 'وصلت المصنع (الصبح)', short: 'المصنع ص', note: 'كده اتحسب نص يوم' });
    out.push({ key: 'fe_arr', phase: 'e', kind: 'arr', target: 'factory', name: fname, loc: fl, label: 'وصلت المصنع (المسا)', short: 'وصول م', note: 'الانتظار بيتحسب من هنا' });
    out.push({ key: 'fe_dep', phase: 'e', kind: 'dep', target: 'factory', name: fname, loc: fl, label: 'اتحركت من المصنع (المسا)', short: 'تحرك م', note: 'الانتظار بيقف هنا' });
    out.push({ key: 'end', phase: 'e', kind: 'end', target: null, name: '', loc: null, label: 'إنهاء اليوم', short: 'إنهاء', note: 'كده اتحسب يوم كامل' });
    return out;
  };
  ops.stepLabel = key => {
    const m = /^p(\d)_(arr|dep)$/.exec(key);
    if (m) return (m[2] === 'arr' ? 'وصول النقطة ' : 'تحرك من النقطة ') + (Number(m[1]) + 1);
    return { fm_arr: 'وصول المصنع الصبح', fe_arr: 'وصول المصنع المسا', fe_dep: 'تحرك من المصنع المسا', end: 'إنهاء اليوم' }[key] || key;
  };
  /** Index of the step that comes after the last one done (skipped steps stay skipped). */
  ops.nextIndex = function (steps, events) {
    let last = -1;
    steps.forEach((s, i) => { if (events && events[s.key]) last = i; });
    return last + 1;
  };

  /** Agreed rule: morning factory arrival = half day; evening departure or "end day" = full day. */
  ops.part = function (events) {
    const e = events || {};
    if (e.fe_dep || e.end) return 'full';
    if (e.fm_arr) return 'half';
    return null;
  };
  ops.partName = p => p === 'full' ? 'يوم كامل' : p === 'half' ? 'نص يوم' : 'لسه';
  /** Evening factory wait in whole minutes ("arrived evening" → "moved evening"). */
  ops.waitMin = function (events) {
    const e = events || {};
    if (!e.fe_arr || !e.fe_dep) return 0;
    return Math.max(0, Math.round((e.fe_dep.at - e.fe_arr.at) / 60000));
  };
  ops.flags = function (events) {
    const e = events || {}, out = { far: 0, auto: 0, staff: 0, noGps: 0, late: 0 };
    Object.values(e).forEach(v => { if (!v) return; if (v.far) out.far++; if (v.auto) out.auto++; if (v.by === 'staff') out.staff++; if (v.noGps) out.noGps++; if (ops.lateMin(v) >= 10) out.late++; });
    return out;
  };
  /** Minutes between the press on the phone and its arrival at the server (sent later = no internet then). */
  ops.lateMin = function (v) {
    const sv = v && TP.toDate(v.sv);
    return sv && isFinite(v.at) ? Math.max(0, Math.round((sv.getTime() - v.at) / 60000)) : 0;
  };

  /* ---------- overtime ---------- */
  ops.otTierLabel = function (tier, settings) {
    const ends = (settings && settings.overtimeTierEnds) || ['21:00', '23:00', '24:00'];
    const prev = tier > 1 ? ends[tier - 2] : null;
    if (tier === 3) return `من ${ops.hm12(prev)} لـ ${ops.hm12(ends[2])}`;
    return `لحد ${ops.hm12(ends[tier - 1])}`;
  };
  ops.OT_STATUS = { pending: ['مستني الموافقة', 'st-warn'], approved: ['معتمدة', 'st-ok'], rejected: ['مرفوضة', 'st-danger'], cancelled: ['ملغية', 'st-off'] };

  /* ---------- missions ---------- */
  ops.MISSION_STEPS = [
    { key: 'start', label: 'اتحركت للمشوار', short: 'اتحرك' },
    { key: 'pickup', label: 'وصلت مكان العميل', short: 'عند العميل' },
    { key: 'arrive', label: 'وصلت الوجهة', short: 'وصل' },
    { key: 'done', label: 'خلصت المشوار', short: 'خلص' }
  ];
  ops.MISSION_KEYS = ops.MISSION_STEPS.map(x => x.key);
  /** The steps of one trip, worded for its kind (airport pickup = the arrivals hall). */
  ops.missionSteps = function (m) {
    const arr = m && m.type === 'airport' && m.flight && m.flight.dir === 'arr', dep = m && m.type === 'airport' && m.flight && m.flight.dir === 'dep';
    return ops.MISSION_STEPS.map(x => {
      const o = Object.assign({}, x);
      if (arr && x.key === 'pickup') { o.label = 'وصلت المطار'; o.short = 'في المطار'; }
      if (dep && x.key === 'arrive') { o.label = 'وصلت المطار'; o.short = 'المطار'; }
      o.loc = x.key === 'pickup' ? (m && m.from && m.from.location) : x.key === 'arrive' ? (m && m.to && m.to.location) : null;
      return o;
    });
  };
  ops.MISSION_STATUS = { assigned: ['متعيّن', 'st-info'], active: ['شغال', 'st-warn'], done: ['خلص', 'st-ok'], cancelled: ['ملغي', 'st-off'] };

  /* ---------- customers: where their car is (what the customer link shows) ---------- */
  ops.TRACK = {
    idle: ['مستني', 'st-off'], near: ['العربية في الطريق', 'st-info'], arrived: ['العربية وصلت', 'st-warn'],
    picked: ['ركب', 'st-ok'], dropped: ['وصل', 'st-ok'], evening: ['العربية مستنياه للرجوع', 'st-warn'], done: ['خلص', 'st-ok'],
    skip: ['مش راكب النهارده', 'st-off'], noshow: ['مجاش', 'st-danger'], cancelled: ['اتلغى', 'st-off']
  };
  /** Minutes until the car reaches the point: from earlier days on the same stretch when known, else distance ÷ speed. */
  ops.etaMin = function (fix, target, opts) {
    const o = opts || {}, d = ops.dist(fix, target);
    if (d === null) return null;
    if (d <= (o.radius || 300)) return 0;
    const road = d * 1.35;                                   // straight line → road
    let speed = Number(o.speedKmh) || 0;                       // measured on the way
    speed = speed >= 12 ? Math.min(speed, 80) : 32;            // town average when standing / unknown
    let m = road / (speed * 1000 / 60);
    if (o.histMin && o.histDist && o.histDist > 0) m = (m + o.histMin * Math.min(1.5, d / o.histDist)) / 2;  // blend with the usual time
    return Math.max(1, Math.round(m));
  };
  /** The usual minutes of a stretch (previous point left → this point reached) over earlier days. */
  ops.usualLeg = function (days, i) {
    const list = (days || []).map(d => {
      const e = d.events || {}, a = e[`p${i}_arr`], b = i === 0 ? null : e[`p${i - 1}_dep`];
      return a && b && a.at > b.at ? (a.at - b.at) / 60000 : null;
    }).filter(x => x && x < 180).sort((x, y) => x - y);
    return list.length ? list[Math.floor(list.length / 2)] : null;
  };

  /* ---------- incidents ---------- */
  ops.INCIDENT_KINDS = [
    { id: 'sos', name: 'استغاثة — محتاج مساعدة فوراً' },
    { id: 'breakdown', name: 'عطل في العربية' },
    { id: 'accident', name: 'حادثة' },
    { id: 'other', name: 'مشكلة تانية' }
  ];
  ops.incidentName = id => ((ops.INCIDENT_KINDS.find(k => k.id === id) || {}).name || id).split(' — ')[0];

  /* ---------- driver month statement ---------- */
  /**
   * days: day docs of the driver for the month · missions: his missions of the month
   * missionPay: {missionId: amount} · rateHistory: driverRates history · adjustments: advances & deductions
   */
  ops.statement = function ({ days, missions, missionPay, rateHistory, adjustments, dayPay, manualDays }) {
    const r2 = TP.round2;
    const out = { rows: [], missionRows: [], adjustments: [], full: 0, half: 0, waitMin: 0, otCount: 0, daysTotal: 0, waitTotal: 0, otTotal: 0, missionsTotal: 0, gross: 0, deductTotal: 0, net: 0, missingRates: 0, unpricedMissions: 0 };
    (days || []).slice().sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).forEach(d => {
      const part = ops.part(d.events);
      const otOk = d.ot && d.ot.status === 'approved';
      // a day priced by hand (e.g. a trips driver covering a line): one all-inclusive amount
      const manual = dayPay && dayPay[d.id] !== undefined && dayPay[d.id] !== null ? Number(dayPay[d.id]) : null;
      if (!part && !otOk && manual === null) return;
      const rate = manualDays ? null : TP.rateAt(rateHistory || [], d.day);
      const row = { day: d.day, lineId: d.lineId, part, waitMin: ops.waitMin(d.events), otTier: otOk ? d.ot.tier : 0, noRate: manual === null && !rate, manual: manual !== null, dayAmt: 0, waitAmt: 0, otAmt: 0 };
      if (manual !== null) {
        row.dayAmt = manual;
      } else if (rate) {
        row.dayAmt = part ? TP.calc.dayAmount(Number(rate.lineDay) || 0, part) : 0;
        row.waitAmt = TP.calc.waitAmount(row.waitMin, rate.waitHour);
        row.otAmt = otOk ? TP.calc.overtimeAmount(d.ot.tier, [rate.ot1, rate.ot2, rate.ot3]) : 0;
      } else out.missingRates++;
      row.total = r2(row.dayAmt + row.waitAmt + row.otAmt);
      if (part === 'full') out.full++; else if (part === 'half') out.half++;
      out.waitMin += row.waitMin; if (otOk) out.otCount++;
      out.daysTotal = r2(out.daysTotal + row.dayAmt); out.waitTotal = r2(out.waitTotal + row.waitAmt); out.otTotal = r2(out.otTotal + row.otAmt);
      out.rows.push(row);
    });
    (missions || []).filter(m => m.status === 'done').sort((a, b) => (a.day < b.day ? -1 : 1)).forEach(m => {
      const amt = missionPay && missionPay[m.id] !== undefined ? Number(missionPay[m.id]) : null;
      if (amt === null) out.unpricedMissions++;
      out.missionRows.push({ id: m.id, day: m.day, title: m.title, amount: amt });
      out.missionsTotal = r2(out.missionsTotal + (amt || 0));
    });
    (adjustments || []).slice().sort((a, b) => (a.day < b.day ? -1 : 1)).forEach(a => {
      out.adjustments.push({ id: a.id, day: a.day, type: a.type, amount: Number(a.amount) || 0, reason: a.reason || '' });
      out.deductTotal = r2(out.deductTotal + (Number(a.amount) || 0));
    });
    out.gross = r2(out.daysTotal + out.waitTotal + out.otTotal + out.missionsTotal);
    out.net = r2(out.gross - out.deductTotal);
    return out;
  };
  ops.ADJ_TYPES = { advance: 'سلفة', deduction: 'خصم' };

  /** Statement as HTML (same look in the driver app and the Control Tower). money=false → counts only. */
  ops.statementHtml = function (d, money) {
    const esc = TP.esc;
    let h = `<div class="sum-row" style="margin-top:0"><div class="pill"><span>أيام كاملة</span><strong>${d.full}</strong></div><div class="pill"><span>أنصاص أيام</span><strong>${d.half}</strong></div>
      <div class="pill"><span>انتظار المسا</span><strong>${d.waitMin} د</strong></div><div class="pill"><span>سهرات</span><strong>${d.otCount}</strong></div><div class="pill"><span>مشاوير</span><strong>${d.missionRows.length}</strong></div></div>`;
    if (money) {
      const row = (label, v, cls) => `<tr class="${cls || ''}"><td>${label}</td><td>${esc(TP.money(v))}</td></tr>`;
      h += `<table class="stmt" style="margin-top:14px"><tbody>
        ${row(`الأيام (${d.full} كامل + ${d.half} نص)`, d.daysTotal)}
        ${row(`الانتظار (${d.waitMin} دقيقة)`, d.waitTotal)}
        ${row(`السهرات (${d.otCount})`, d.otTotal)}
        ${row(`المشاوير (${d.missionRows.length})`, d.missionsTotal)}
        ${row('الإجمالي', d.gross, 'total')}
        ${d.adjustments.map(x => `<tr class="minus"><td>${esc(ops.ADJ_TYPES[x.type] || 'خصم')} — ${esc(x.reason)} <span class="muted small"><bdi dir="ltr">${esc(x.day)}</bdi></span></td><td>− ${esc(TP.money(x.amount))}</td></tr>`).join('')}
        ${row('الصافي', d.net, 'net')}
      </tbody></table>`;
      if (d.missingRates || d.unpricedMissions) h += `<div class="banner warn" style="margin-top:12px">${TP.icon('warn')}<span>${d.missingRates ? `${d.missingRates} يوم لسه سعره متحطش` : ''}${d.missingRates && d.unpricedMissions ? ' · ' : ''}${d.unpricedMissions ? `${d.unpricedMissions} مشوار لسه سعره متحطش` : ''}</span></div>`;
    } else {
      h += '<p class="muted small" style="margin-top:12px">الحساب المالي عند الإدارة.</p>';
    }
    if (d.rows.length) h += `<details class="history" style="margin-top:14px"><summary>تفاصيل الأيام (${d.rows.length})</summary><table class="stmt"><tbody>${d.rows.map(r => `<tr><td><bdi dir="ltr">${esc(r.day)}</bdi> — ${esc(ops.partName(r.part))}${r.waitMin ? ` · انتظار ${r.waitMin} د` : ''}${r.otTier ? ' · سهرة' : ''}${money && r.noRate ? ' <span class="badge-s far">بدون سعر</span>' : ''}${money && r.manual ? ' <span class="badge-s staff">مبلغ شامل</span>' : ''}</td><td>${money ? esc(TP.money(r.total)) : ''}</td></tr>`).join('')}</tbody></table></details>`;
    if (d.missionRows.length) h += `<details class="history" style="margin-top:8px"><summary>تفاصيل المشاوير (${d.missionRows.length})</summary><table class="stmt"><tbody>${d.missionRows.map(r => `<tr><td><bdi dir="ltr">${esc(r.day)}</bdi> — ${esc(r.title || 'مشوار')}</td><td>${money ? (r.amount === null ? '<span class="muted">لسه</span>' : esc(TP.money(r.amount))) : ''}</td></tr>`).join('')}</tbody></table></details>`;
    return h;
  };
})(window.TP = window.TP || {});
