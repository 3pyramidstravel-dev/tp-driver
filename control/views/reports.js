/* ==========================================================================
   التقارير — everything comes from the work actually recorded
     · السواقين: days, trips, waiting, overtime, late wake-ups, ratings
     · المصانع: days, trips, absences and no-shows of their customers
     · الربح (accounts on): factory invoice − driver pay − expenses − tax
     · كشوف المصانع: the GM approves a factory's month → its HR sees it
     · التصدير للحسابات: an Excel of the period for the accounting system;
       the period is then locked (later corrections are listed next time)
   Every report downloads as PDF or Excel (TP.report — the company's style).
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui, O = TP.ops;
  const state = { month: '', tab: 'drivers', from: '', to: '' };
  let data = { month: null, loading: false, error: '', excused: {}, days: [], missions: [], ratings: [], expenses: [], wake: {}, md: {}, mf: {}, dayPay: {}, adj: [], sheets: {} };
  const money = () => TP.financeOn(D.settings) && (S.can('reports.finance') || S.can('prices.view'));
  const safe = p => p.catch(e => { console.warn('report', e && e.code); return null; });
  const PART = { full: 'يوم كامل', half: 'نص يوم' };

  async function load(month) {
    data = { month, loading: true, error: '', excused: {}, days: [], missions: [], ratings: [], expenses: [], wake: {}, md: {}, mf: {}, dayPay: {}, adj: [], sheets: {} };
    TP.rerender();
    const w = { where: [['month', '==', month]] };
    try {
      const sheetsOk = S.can('month.close') || S.can('reports.finance');
      const rateOk = ['reports.attendance', 'reports.finance', 'month.close', 'tracking.view'].some(p => S.can(p));
      const expOk = ['missions.manage', 'times.correct', 'advances.manage', 'reports.finance', 'prices.view'].some(p => S.can(p));
      const [excused, days, missions, ratings, expenses, sheets, md, mf, dp, adj] = await Promise.all([
        safe(TP.fb.list('excused', w)), safe(TP.fb.list('days', w)), safe(TP.fb.list('missions', w)), rateOk ? safe(TP.fb.list('ratings', w)) : null, expOk ? safe(TP.fb.list('expenses', w)) : null, sheetsOk ? safe(TP.fb.list('sheets', w)) : null,
        money() ? safe(TP.fb.list('missionDriver', w)) : null, money() ? safe(TP.fb.list('missionFactory', w)) : null,
        money() ? safe(TP.fb.list('dayPay', w)) : null, money() ? safe(TP.fb.list('adjustments', w)) : null
      ]);
      if (data.month !== month) return;
      (excused || []).forEach(x => { data.excused[x.lineId + '_' + x.day] = x; });
      Object.assign(data, { days: days || [], missions: (missions || []).filter(m => m.status !== 'cancelled'), ratings: ratings || [], expenses: (expenses || []).filter(x => x.status === 'approved'), adj: adj || [] });
      (sheets || []).forEach(s => { data.sheets[s.factoryId] = s; });
      (md || []).forEach(x => { data.md[x.id] = x.amount; }); (mf || []).forEach(x => { data.mf[x.id] = x.amount; }); (dp || []).forEach(x => { data.dayPay[x.id] = x.amount; });
      // late wake-ups: the supervisor had to be called (from the plans of each day)
      if (S.can('wake.supervise') || S.can('tracking.view') || S.can('times.correct')) {
        const [y, m] = month.split('-').map(Number), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), today = TP.dayKey();
        const list = Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`).filter(d => d <= today);
        const plans = await Promise.all(list.map(d => safe(TP.fb.get('wake/' + d))));
        plans.forEach((p, i) => { if (p) data.wake[list[i]] = p; });
      }
    } catch (e) { console.error(e); data.error = TP.errorText(e); }
    if (data.month === month) { data.loading = false; TP.rerender(); }
  }

  /* ---------- the numbers ---------- */
  const avg = list => list.length ? Math.round(list.reduce((a, r) => a + r.stars, 0) / list.length * 10) / 10 : null;
  function driverRows() {
    const rows = {};
    const row = pid => rows[pid] = rows[pid] || { pid, full: 0, half: 0, wait: 0, ot: 0, far: 0, staff: 0, missions: 0, airport: 0, lateWake: 0, ratings: [], expenses: 0 };
    data.days.forEach(d => {
      const p = O.part(d.events); if (!d.driverId) return;
      const r = row(d.driverId), f = O.flags(d.events);
      if (p === 'full') r.full++; else if (p === 'half') r.half++;
      r.wait += O.waitMin(d.events); if (d.ot && d.ot.status === 'approved') r.ot++; r.far += f.far; r.staff += f.staff;
    });
    data.missions.filter(m => m.status === 'done').forEach(m => { const r = row(m.driverId); r.missions++; if (m.type === 'airport') r.airport++; });
    Object.values(data.wake).forEach(p => Object.keys(p.d || {}).forEach(pid => { if (p.d[pid].supAt && !p.d[pid].gone) row(pid).lateWake++; }));
    data.ratings.forEach(x => row(x.driverId).ratings.push(x));
    data.expenses.forEach(x => { row(x.driverId).expenses += Number(x.amount) || 0; });
    return Object.values(rows).filter(r => TP.q.person(r.pid) || r.full || r.missions).sort((a, b) => (Number((TP.q.person(a.pid) || {}).code) || 9e9) - (Number((TP.q.person(b.pid) || {}).code) || 9e9));
  }
  function absences(fid) {
    const out = {};
    // every line-day with a record or an excuse
    const list = data.days.slice();
    Object.values(data.excused).forEach(x => { if (!list.some(d => d.lineId === x.lineId && d.day === x.day)) list.push({ lineId: x.lineId, factoryId: x.factoryId, day: x.day }); });
    list.filter(d => !fid || d.factoryId === fid).forEach(d => {
      const line = TP.q.line(d.lineId), names = {};
      if (line) O.lineCustomers(line).forEach(c => { names[c.id] = c.name; });
      Object.entries(O.ridersOf(d, data.excused[d.lineId + '_' + d.day])).forEach(([cid, r]) => {
        if (!r || (r.s !== 'skip' && r.s !== 'noshow')) return;
        const k = cid, o = out[k] = out[k] || { name: names[cid] || r.n || '—', line: line ? line.name : '', factoryId: d.factoryId, skip: 0, noshow: 0, days: [] };
        o[r.s]++; o.days.push(`${d.day.slice(5)} ${r.s === 'skip' ? 'اعتذر' : 'مجاش'}`);
      });
    });
    return Object.values(out).sort((a, b) => (b.skip + b.noshow) - (a.skip + a.noshow));
  }
  function factoryRows() {
    return D.companies.map(f => {
      const days = data.days.filter(d => d.factoryId === f.id), ms = data.missions.filter(m => m.factoryId === f.id && m.status === 'done');
      const ab = absences(f.id);
      return { f, full: days.filter(d => O.part(d.events) === 'full').length, half: days.filter(d => O.part(d.events) === 'half').length,
        ot: days.filter(d => d.ot && d.ot.status === 'approved').length, wait: days.reduce((a, d) => a + O.waitMin(d.events), 0),
        missions: ms.length, airport: ms.filter(m => m.type === 'airport').length, skip: ab.reduce((a, x) => a + x.skip, 0), noshow: ab.reduce((a, x) => a + x.noshow, 0),
        rating: avg(data.ratings.filter(x => x.factoryId === f.id)), nRatings: data.ratings.filter(x => x.factoryId === f.id).length };
    });
  }
  /** Factory invoice of the month from its own prices (effective-dated). */
  function invoice(fid) {
    const fr = (D.factoryRates[fid] || {}).history || [], items = [];
    let lines = 0, ms = 0;
    data.days.filter(d => d.factoryId === fid).forEach(d => {
      const part = O.part(d.events), otOk = d.ot && d.ot.status === 'approved'; if (!part && !otOk) return;
      const r = TP.rateAt(fr, d.day); if (!r) { items.push({ missing: true, day: d.day }); return; }
      const dayPrice = r.lineOverrides && r.lineOverrides[d.lineId] !== undefined ? Number(r.lineOverrides[d.lineId]) : Number(r.lineDay) || 0;
      const amt = TP.calc.dayAmount(dayPrice, part) + TP.calc.waitAmount(O.waitMin(d.events), r.waitHour) + (otOk ? TP.calc.overtimeAmount(d.ot.tier, [r.ot1, r.ot2, r.ot3]) : 0);
      lines = TP.round2(lines + amt); items.push({ day: d.day, lineId: d.lineId, part, amt: TP.round2(amt) });
    });
    const missions = data.missions.filter(m => m.factoryId === fid && m.status === 'done').map(m => ({ id: m.id, day: m.day, title: m.title, type: m.type, amt: data.mf[m.id] ?? null }));
    missions.forEach(m => { ms = TP.round2(ms + (m.amt || 0)); });
    const total = TP.round2(lines + ms), pct = Number(D.settings.taxPct) || 0;
    return { lines, missions, ms, total, tax: TP.calc.tax(total, pct), missing: items.filter(x => x.missing).length + missions.filter(m => m.amt === null).length, items };
  }
  /** Driver pay that belongs to a factory's work (days + trips), from each driver's own prices. */
  function driverCost(fid) {
    let total = 0, missing = 0;
    data.days.filter(d => d.factoryId === fid).forEach(d => {
      const part = O.part(d.events), otOk = d.ot && d.ot.status === 'approved'; if (!part && !otOk) return;
      if (data.dayPay[d.id] !== undefined) { total += Number(data.dayPay[d.id]) || 0; return; }
      const r = TP.rateAt((D.driverRates[d.driverId] || {}).history || [], d.day); if (!r) { missing++; return; }
      total += TP.calc.dayAmount(Number(r.lineDay) || 0, part) + TP.calc.waitAmount(O.waitMin(d.events), r.waitHour) + (otOk ? TP.calc.overtimeAmount(d.ot.tier, [r.ot1, r.ot2, r.ot3]) : 0);
    });
    data.missions.filter(m => m.factoryId === fid && m.status === 'done').forEach(m => { if (data.md[m.id] === undefined) missing++; else total += Number(data.md[m.id]) || 0; });
    const ids = new Set(data.missions.filter(m => m.factoryId === fid).map(m => m.id));
    const exp = data.expenses.filter(x => x.missionId && ids.has(x.missionId)).reduce((a, x) => a + (Number(x.amount) || 0), 0);
    return { pay: TP.round2(total), exp: TP.round2(exp), missing };
  }

  /* ---------- tables: one definition for the screen, PDF and Excel ---------- */
  const col = (h, t, sum, w) => ({ h, t: t || 'text', sum: !!sum, w });
  const sumOf = (rows, i) => TP.round2(rows.reduce((a, r) => a + (Number(r[i]) || 0), 0));
  const T = {
    drivers() {
      const columns = [col('الكود', 'center'), col('السواق'), col('النوع', 'center'), col('أيام كاملة', 'int', 1), col('أنصاص أيام', 'int', 1), col('انتظار المسا (د)', 'int', 1), col('سهرات', 'int', 1), col('مشاوير', 'int', 1), col('منها مطار', 'int', 1), col('صحيان متأخر', 'int', 1), col('ضغطات بعيدة', 'int', 1), col('سجلتها الإدارة', 'int', 1), col('التقييم', 'dec'), col('عدد التقييمات', 'int', 1)];
      const rows = driverRows().map(r => { const p = TP.q.person(r.pid) || {}; return [p.code || '', p.name || '—', TP.driverKindName(p.driverKind), r.full, r.half, r.wait, r.ot, r.missions, r.airport, r.lateWake, r.far, r.staff, avg(r.ratings) ?? '', r.ratings.length]; });
      const all = driverRows().flatMap(r => r.ratings);
      return { title: 'تقرير السواقين', kpis: [['السواقين', rows.length], ['أيام كاملة', sumOf(rows, 3)], ['أنصاص أيام', sumOf(rows, 4)], ['مشاوير', sumOf(rows, 7)], ['صحيان متأخر', sumOf(rows, 9), sumOf(rows, 9) ? 'bad' : 'good'], ['متوسط التقييم', avg(all) ?? '—', 'gold']],
        sections: [{ title: 'السواقين', columns, rows, totals: true }] };
    },
    factories() {
      const columns = [col('المصنع'), col('أيام كاملة', 'int', 1), col('أنصاص أيام', 'int', 1), col('انتظار (د)', 'int', 1), col('سهرات', 'int', 1), col('مشاوير', 'int', 1), col('منها مطار', 'int', 1), col('اعتذارات العملاء', 'int', 1), col('مجاش', 'int', 1), col('التقييم', 'dec')];
      const rows = factoryRows().map(r => [r.f.name, r.full, r.half, r.wait, r.ot, r.missions, r.airport, r.skip, r.noshow, r.rating ?? '']);
      return { title: 'تقرير المصانع', kpis: [['المصانع', rows.length], ['أيام كاملة', sumOf(rows, 1)], ['مشاوير', sumOf(rows, 5)], ['اعتذارات', sumOf(rows, 7)], ['مجاش', sumOf(rows, 8), sumOf(rows, 8) ? 'bad' : 'good']],
        sections: [{ title: 'المصانع', columns, rows, totals: true }] };
    },
    absences() {
      const list = absences();
      const columns = [col('العميل'), col('المصنع'), col('الخط'), col('اعتذر', 'int', 1), col('مجاش', 'int', 1), col('الأيام', 'text', 0, 44)];
      const rows = list.map(a => [a.name, (TP.q.company(a.factoryId) || {}).name || '', a.line, a.skip, a.noshow, a.days.join(' · ')]);
      return { title: 'غياب العملاء', kpis: [['موظفين غابوا', rows.length], ['اعتذر', sumOf(rows, 3)], ['مجاش', sumOf(rows, 4), sumOf(rows, 4) ? 'bad' : 'good']],
        sections: [{ title: 'غياب العملاء', columns, rows, totals: true, note: '"اعتذر" = الموظف بلّغ من لينكه إنه مش راكب. "مجاش" = العربية استنته في النقطة ومجاش (المكان متسجل).' }] };
    },
    profit() {
      const columns = [col('المصنع'), col('فاتورة الخطوط', 'money', 1), col('فاتورة المشاوير', 'money', 1), col('إجمالي الفاتورة', 'money', 1), col('الضريبة', 'money', 1), col('أجور السواقين', 'money', 1), col('المصاريف', 'money', 1), col('صافي الربح', 'money', 1), col('ناقص أسعار', 'int', 1)];
      const rows = D.companies.map(f => { const i = invoice(f.id), c = driverCost(f.id); return [f.name, i.lines, i.ms, i.total, i.tax, c.pay, c.exp, TP.round2(i.total - i.tax - c.pay - c.exp), i.missing + c.missing]; });
      const net = sumOf(rows, 7);
      return { title: 'الربح لكل مصنع', kpis: [['إجمالي الفواتير', TP.money(sumOf(rows, 3))], ['الضريبة', TP.money(sumOf(rows, 4))], ['أجور السواقين', TP.money(sumOf(rows, 5))], ['المصاريف', TP.money(sumOf(rows, 6))], ['صافي الربح', TP.money(net), net >= 0 ? 'good' : 'bad']],
        sections: [{ title: 'الربح لكل مصنع', columns, rows, totals: true, note: `الربح = الفاتورة − الضريبة (${D.settings.taxPct}%) − أجور السواقين − المصاريف المقبولة. "ناقص أسعار" = أيام أو مشاوير لسه سعرها متحطش.` }] };
    }
  };
  /** The full report definition of a tab (what PDF and Excel get). */
  const defOf = tab => Object.assign({ subtitle: 'Three Pyramids Travel', period: O.monthName(state.month), fileName: `TP-${tab}-${state.month}` }, T[tab]());
  function htmlTable(sec) {
    if (!(sec.rows || []).length) return U.empty('مفيش شغل متسجل في الشهر ده');
    const num = c => c.t && c.t !== 'text';
    const tot = sec.totals === true ? sec.columns.map((c, i) => i === 0 ? 'الإجمالي' : c.sum ? sumOf(sec.rows, i) : '') : null;
    const cell = (c, v) => esc(c.t === 'money' && typeof v === 'number' ? TP.money(v) : TP.report.fmt(v, c.t === 'money' ? 'int' : c.t));
    return `<div class="table-wrap"><table class="tbl rep"><thead><tr>${sec.columns.map(c => `<th>${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${sec.rows.map(r => `<tr>${sec.columns.map((c, i) => `<td class="${num(c) ? 'num' : ''}">${cell(c, r[i])}</td>`).join('')}</tr>`).join('')}</tbody>${tot && sec.rows.length > 1 ? `<tfoot><tr class="rep-total">${sec.columns.map((c, i) => `<td class="${i && num(c) ? 'num' : ''}"><b>${i ? cell(c, tot[i]) : esc(tot[0])}</b></td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
  }
  const kpiStrip = def => (def.kpis || []).length ? `<div class="rep-kpis">${def.kpis.map(k => `<div class="rep-kpi ${esc(k[2] || '')}"><span>${esc(k[0])}</span><b>${esc(typeof k[1] === 'number' ? TP.report.fmt(k[1], 'int') : k[1])}</b></div>`).join('')}</div>` : '';

  /* ---------- monthly factory sheet (approved → visible to the factory's HR) ---------- */
  function sheetData(fid) {
    const fin = TP.financeOn(D.settings) && S.can('prices.view');
    const inv = fin ? invoice(fid) : null;
    const lines = D.lines.filter(l => l.factoryId === fid).map(l => {
      const ds = data.days.filter(d => d.lineId === l.id);
      const amt = inv ? TP.round2(inv.items.filter(x => x.lineId === l.id && !x.missing).reduce((a, x) => a + x.amt, 0)) : null;
      return { name: l.name, full: ds.filter(d => O.part(d.events) === 'full').length, half: ds.filter(d => O.part(d.events) === 'half').length,
        ot: ds.filter(d => d.ot && d.ot.status === 'approved').length, wait: ds.reduce((a, d) => a + O.waitMin(d.events), 0), amount: amt };
    }).filter(l => l.full || l.half || l.ot);
    const missions = data.missions.filter(m => m.factoryId === fid && m.status === 'done').sort((a, b) => (a.day < b.day ? -1 : 1))
      .map(m => ({ day: m.day, title: m.title || '', type: m.type || '', flight: (m.flight && m.flight.no) || '', amount: inv ? (data.mf[m.id] ?? null) : null }));
    const ab = absences(fid).map(a => ({ name: a.name, line: a.line, skip: a.skip, noshow: a.noshow, days: a.days.join(' · ') }));
    const out = { lines, missions, absences: ab, finance: !!inv };
    if (inv) out.totals = { lines: inv.lines, missions: inv.ms, total: inv.total, tax: inv.tax, pct: Number(D.settings.taxPct) || 0 };
    return out;
  }
  async function approveSheet(fid) {
    const f = TP.q.company(fid);
    if (!(await TP.confirm('اعتماد كشف الشهر', `كشف ${f.name} لشهر ${O.monthName(data.month)} هيظهر لـ HR المصنع بالأرقام دي. أي تعديل بعد كده محتاج اعتماد تاني.`, 'اعتماد'))) return;
    if (TP.needsPin(S.perms) && !(await S.confirmPin('اعتماد كشف المصنع'))) return;
    const sd = sheetData(fid);
    await TP.fb.set(`sheets/${fid}_${data.month}`, { factoryId: fid, month: data.month, status: 'approved', approvedBy: S.person.name, approvedAt: TP.fb.ts(), data: sd });
    data.sheets[fid] = { factoryId: fid, month: data.month, status: 'approved', approvedBy: S.person.name, approvedAt: new Date(), data: sd };
    TP.audit('sheet.approve', f.name, data.month);
    TP.toast('اتعتمد ✓ — HR المصنع يقدر يشوفه');
    TP.rerender();
  }
  async function withdrawSheet(fid) {
    const f = TP.q.company(fid);
    if (!(await TP.confirm('سحب الاعتماد', `كشف ${f.name} هيختفي من عند HR المصنع لحد ما تعتمده تاني.`, 'سحب', true))) return;
    await TP.fb.set(`sheets/${fid}_${data.month}`, { factoryId: fid, month: data.month, status: 'draft', withdrawnBy: S.person.name, withdrawnAt: TP.fb.ts() }, true);
    data.sheets[fid] = Object.assign({}, data.sheets[fid], { status: 'draft' });
    TP.audit('sheet.withdraw', f.name, data.month);
    TP.rerender();
  }
  /* ---------- export for the accounting system (then the period is locked) ---------- */
  /** The day after the last export — or the start of this month (of last month on the 1st). */
  function defaultFrom() {
    const L = D.lock, y = O.addDays(TP.dayKey(TP.now()), -1);
    if (L && L.until && L.until < y) return O.addDays(L.until, 1);
    return y.slice(0, 8) + '01';
  }
  /**
   * Trip orders in the accounts' file: the cars' trips, cash custody and fuel card of the period, and the
   * tourism drivers' salaries of its months (old months are only deleted after they are in this file).
   */
  async function fleetSheets(from, to) {
    const months = []; for (let m = from.slice(0, 7); m <= to.slice(0, 7) && months.length < 30; m = O.addMonths(m, 1)) months.push(m);
    const [logs, sals] = await Promise.all([safe(TP.fb.list('fleetLog', { where: [['month', 'in', months]] })), S.can('salary.manage') ? safe(TP.fb.list('salary', { where: [['month', 'in', months]] })) : null]);
    if (!logs && !sals) return [];
    const P = id => TP.q.person(id) || {}, plate = vid => (TP.q.vehicle ? (TP.q.vehicle(vid) || {}).plate : '') || vid;
    const who = e => e.byName || P(e.by).name || e.by || '';
    const inP = d => d && d >= from && d <= to;
    const flat = k => (logs || []).flatMap(l => Object.entries(l[k] || {}).map(([id, e]) => Object.assign({ id, vid: l.vehicleId || String(l.id).split('_')[0] }, e))).filter(e => inP(e.day)).sort((a, b) => (a.day + (a.time || '') + a.vid).localeCompare(b.day + (b.time || '') + b.vid));
    const K = { topup: 'عهدة', set: 'تحديد الرصيد', charge: 'شحن', fill: 'تعبئة' };
    const trips = flat('trips'), out = [];
    if (logs) {
      out.push({ name: 'أمر الشغل', rows: [['التاريخ', 'الوقت', 'العربية', 'السواق', 'المأمورية', 'العداد قبل', 'العداد بعد', 'كيلومترات', 'المصروف', 'بيان المصروف']]
        .concat(trips.map(t => [t.day, t.time ? O.hm12(t.time) : '', plate(t.vid), who(t), t.task || '', Number(t.before) || '', Number(t.after) || '', t.after && t.before ? t.after - t.before : '', Number(t.expense) || 0, t.expNote || ''])) });
      const cash = flat('cash').map(e => [e.day, plate(e.vid), K[e.kind] || e.kind, e.note || '', e.kind === 'set' ? '' : Number(e.amount) || 0, '', e.kind === 'set' ? Number(e.amount) || 0 : '', who(e)])
        .concat(trips.filter(t => Number(t.expense) > 0).map(t => [t.day, plate(t.vid), 'مصروف مشوار', (t.expNote ? t.expNote + ' — ' : '') + (t.task || ''), '', Number(t.expense) || 0, '', who(t)]))
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      out.push({ name: 'العهدة', rows: [['التاريخ', 'العربية', 'النوع', 'البيان', 'داخل', 'خارج', 'الرصيد اتحدد بـ', 'بواسطة']].concat(cash) });
      out.push({ name: 'فيزا البنزين', rows: [['التاريخ', 'العربية', 'النوع', 'البيان', 'شحن', 'تعبئة', 'الرصيد اتحدد بـ', 'بواسطة']]
        .concat(flat('fuel').map(e => [e.day, plate(e.vid), K[e.kind] || e.kind, e.note || '', e.kind === 'charge' ? Number(e.amount) || 0 : '', e.kind === 'fill' ? Number(e.amount) || 0 : '', e.kind === 'set' ? Number(e.amount) || 0 : '', who(e)])) });
    }
    if (sals) {
      const FL = TP.fleet;
      out.push({ name: 'مرتبات السياحة', rows: [['الشهر', 'كود السواق', 'السواق', 'الأساسي', 'الإضافي', 'الخصومات', 'الصافي', 'ملحوظة']]
        .concat(sals.slice().sort((a, b) => (a.month + (P(a.driverId).code || '')).localeCompare(b.month + (P(b.driverId).code || ''))).map(x => { const n = FL.salaryNet(x); return [O.monthName(x.month), P(x.driverId).code || '', P(x.driverId).name || x.driverId, n.base, n.extra, n.ded, n.net, x.month === to.slice(0, 7) && to < O.addDays(O.addMonths(x.month, 1) + '-01', -1) ? 'لحد ' + to + ' — الشهر لسه مخلصش' : '']; })) });
    }
    return out;
  }
  async function doExport() {
    const from = U.val('xFrom'), to = U.val('xTo');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return TP.toast('اختار الفترة صح');
    // a day is exported once it is over (drivers may still record today; offline presses arrive later and are listed next time)
    if (to >= TP.dayKey(TP.now())) return TP.toast('آخر يوم في التصدير لازم يكون امبارح أو قبله — النهارده لسه شغال', 'warn');
    const lock = D.lock || {}, since = lock.atTs || null;
    // periods follow each other: no day exported twice, none left out (an old period can be downloaded again as a copy)
    const copy = !!(lock.until && to <= lock.until);
    if (lock.until && !copy && from !== O.addDays(lock.until, 1)) return TP.toast(`التصدير الجاي لازم يبدأ من ${O.addDays(lock.until, 1)} (اليوم اللي بعد آخر تصدير)`, 'warn');
    if (copy && !(await TP.confirm('نسخة من فترة اتصدّرت', `الفترة دي اتصدّرت قبل كده. هيطلع ملف نسخة بالأرقام الحالية، من غير ما يتغير القفل.`, 'نزّل النسخة'))) return;
    if (!copy && !(await TP.confirm('تصدير وقفل الفترة', `هيطلع ملف Excel بشغل الفترة من ${from} لـ ${to}، والفترة دي هتتقفل: أي تصحيح بعد كده هيظهر في التصدير الجاي كـ "تعديل على فترة مقفولة".`, 'صدّر'))) return;
    // the server time BEFORE reading: anything changed from now on shows in the next export
    let prepTs = null;
    if (!copy) { await TP.fb.set('system/lock', { prepTs: TP.fb.ts() }, true); prepTs = ((await TP.fb.get('system/lock')) || {}).prepTs || null; }
    const range = [['day', '>=', from], ['day', '<=', to]];
    // everything of an exported period that changed after the last export (server times on both sides)
    const [days, missions, expenses, fixesD, fixesM, fixesX] = await Promise.all([
      TP.fb.list('days', { where: range }), TP.fb.list('missions', { where: range }), safe(TP.fb.list('expenses', { where: range })),
      since ? safe(TP.fb.list('days', { where: [['updatedAt', '>', since]] })) : null, since ? safe(TP.fb.list('missions', { where: [['updatedAt', '>', since]] })) : null,
      since ? safe(TP.fb.list('expenses', { where: [['decidedAt', '>', since]] })) : null
    ]);
    const late = list => (list || []).filter(x => lock.until && x.day <= lock.until && x.day < from);
    const P = id => TP.q.person(id) || {}, F = id => (TP.q.company(id) || {}).name || '', L = id => (TP.q.line(id) || {}).name || '';
    const tm = e => e ? O.hm(e.at) : '';
    const daySheet = [['كود السواق', 'السواق', 'نوع السواق', 'المصنع', 'الخط', 'التاريخ', 'الحالة', 'وصول المصنع ص', 'وصول المصنع م', 'تحرك م', 'انتظار (د)', 'السهرة المعتمدة', 'بديل', 'سجلتها الإدارة']]
      .concat(days.filter(d => O.part(d.events) || (d.ot && d.ot.status === 'approved')).sort((a, b) => (a.day + a.lineId).localeCompare(b.day + b.lineId)).map(d => {
        const line = TP.q.line(d.lineId), e = d.events || {};
        return [P(d.driverId).code || '', P(d.driverId).name || '', TP.driverKindName(P(d.driverId).driverKind), F(d.factoryId), L(d.lineId), d.day, PART[O.part(e)] || '',
          tm(e.fm_arr), tm(e.fe_arr), tm(e.fe_dep), O.waitMin(e), d.ot && d.ot.status === 'approved' ? O.otTierLabel(d.ot.tier, D.settings) : '',
          line && line.driverId !== d.driverId ? 'نعم' : '', O.flags(e).staff];
      }));
    const ms = missions.filter(m => m.status === 'done' || m.status === 'active');
    const waitOf = m => { const e = m.events || {}, picked = Object.values(m.picked || {}).map(r => r.at).sort()[0]; return e.pickup && picked ? Math.max(0, Math.round((picked - e.pickup.at) / 60000)) : ''; };
    const mSheet = [['كود السواق', 'السواق', 'المصنع / الجهة', 'التاريخ', 'النوع', 'الوصف', 'رقم الرحلة', 'اتحرك', 'عند العميل', 'وصل الوجهة', 'خلص', 'انتظار العميل (د)', 'عدد العملاء', 'الحالة']]
      .concat(ms.sort((a, b) => (a.day + (a.time || '')).localeCompare(b.day + (b.time || ''))).map(m => {
        const e = m.events || {};
        return [P(m.driverId).code || '', P(m.driverId).name || '', F(m.factoryId) || m.client || '', m.day, m.type === 'airport' ? (m.flight && m.flight.dir === 'dep' ? 'مطار — توصيل' : 'مطار — استقبال') : 'مشوار',
          m.title || '', (m.flight && m.flight.no) || '', tm(e.start), tm(e.pickup), tm(e.arrive), tm(e.done), waitOf(m), (m.customers || []).length, (O.MISSION_STATUS[m.status] || [''])[0]];
      }));
    const xSheet = [['كود السواق', 'السواق', 'التاريخ', 'النوع', 'المبلغ', 'المشوار', 'ملاحظة', 'الحالة']]
      .concat((expenses || []).filter(x => x.status === 'approved').map(x => [P(x.driverId).code || '', P(x.driverId).name || '', x.day, (TP.EXPENSE_KINDS || {})[x.kind] || x.kind, Number(x.amount) || 0, ((missions.find(m => m.id === x.missionId) || {}).title) || '', x.note || '', 'مقبول']));
    const cSheet = [['كود السواق', 'السواق', 'التاريخ', 'المشوار', 'العميل', 'الكاش المطلوب', 'اتحصّل', 'وقت التحصيل']]
      .concat(missions.filter(m => m.cash && m.status !== 'cancelled').map(m => [P(m.driverId).code || '', P(m.driverId).name || '', m.day, m.title || '', (m.customers || []).map(c => c.name).join('، '), Number(m.cash.amount) || 0, m.cashGot ? 'نعم' : 'لأ', m.cashGot ? TP.fmtDateTime(m.cashGot.at) : '']));
    const abs = [['العميل', 'المصنع', 'الخط', 'التاريخ', 'الحالة']];
    const exList = (await safe(TP.fb.list('excused', { where: range }))) || [], exOf = {};
    exList.forEach(x => { exOf[x.lineId + '_' + x.day] = x; });
    const absDays = days.slice();
    exList.forEach(x => { if (!absDays.some(d => d.lineId === x.lineId && d.day === x.day)) absDays.push({ lineId: x.lineId, factoryId: x.factoryId, day: x.day }); });
    absDays.forEach(d => { const line = TP.q.line(d.lineId), names = {}; if (line) O.lineCustomers(line).forEach(c => { names[c.id] = c.name; });
      Object.entries(O.ridersOf(d, exOf[d.lineId + '_' + d.day])).forEach(([cid, r]) => { if (r && (r.s === 'skip' || r.s === 'noshow')) abs.push([names[cid] || r.n || cid, F(d.factoryId), L(d.lineId), d.day, r.s === 'skip' ? 'اعتذر' : 'مجاش']); }); });
    const msOf = v => { const d = TP.toDate(v); return d ? d.getTime() : 0; };
    const fx = x => x.lateFix && msOf(x.lateFix.sv) > msOf(since) ? [x.lateFix.by || '', x.lateFix.reason || ''] : ['السواق / السيستم', 'تسجيل وصل بعد التصدير (كان من غير نت) أو تحديث تلقائي'];
    const fixes = [['النوع', 'التاريخ', 'الخط / المشوار', 'كود السواق', 'السواق', 'اتعدّل بواسطة', 'وقت التعديل', 'السبب / التفاصيل']]
      .concat(late(fixesD).map(d => ['يوم خط', d.day, L(d.lineId), P(d.driverId).code || '', P(d.driverId).name || '', fx(d)[0], TP.fmtDateTime(d.updatedAt), fx(d)[1] + ` — الحالة دلوقتي: ${PART[O.part(d.events)] || 'من غير يوم'}${d.ot && d.ot.status === 'approved' ? ' + سهرة' : ''}`]),
        late(fixesM).map(m => ['مشوار', m.day, m.title || '', P(m.driverId).code || '', P(m.driverId).name || '', fx(m)[0], TP.fmtDateTime(m.updatedAt), fx(m)[1] + ` — الحالة دلوقتي: ${(O.MISSION_STATUS[m.status] || [''])[0]}${m.cashGot ? ' · الكاش اتحصّل' : ''}`]),
        late(fixesX).map(x => ['مصروف', x.day, (TP.EXPENSE_KINDS || {})[x.kind] || x.kind, P(x.driverId).code || '', P(x.driverId).name || '', x.decidedBy || '', TP.fmtDateTime(x.decidedAt), `${x.status === 'approved' ? 'اتقبل' : x.status === 'rejected' ? 'اترفض' : x.status} — ${Number(x.amount) || 0}`]));
    TP.xlsx.download(`TP-export-${from}_${to}${copy ? '-copy' : ''}`, [{ name: 'أيام الخطوط', rows: daySheet }, { name: 'المشاوير والمطار', rows: mSheet }, { name: 'المصاريف', rows: xSheet }, { name: 'الكاش', rows: cSheet }, { name: 'الغياب', rows: abs }, { name: 'تعديلات بعد القفل', rows: fixes }].concat(await fleetSheets(from, to)));
    if (copy) { TP.audit('export.copy', `${from} → ${to}`, ''); TP.toast('النسخة نزلت ✓'); return; }
    const until = lock.until && lock.until > to ? lock.until : to;
    await TP.fb.batch([{ op: 'set', path: 'exports/' + TP.newId('X'), data: { from, to, at: TP.fb.ts(), by: S.person.name, days: daySheet.length - 1, missions: mSheet.length - 1, fixes: fixes.length - 1 } },
      { op: 'set', path: 'system/lock', data: { until, at: TP.now(), atTs: prepTs || TP.fb.ts(), by: S.person.name, lastFrom: from, lastTo: to } }]);
    TP.audit('export', `${from} → ${to}`, `${daySheet.length - 1} يوم · ${mSheet.length - 1} مشوار`);
    state.from = ''; state.to = '';   // the next export starts after this one
    TP.toast('اتصدّر واتقفل ✓');
  }

  TP.views.reports = {
    deps: ['settings', 'lock', 'companies', 'lines', 'people', 'factoryRates', 'driverRates'],
    render(root) {
      const M = O.monthOf(TP.dayKey());
      if (!state.month) state.month = M;
      if (data.month !== state.month && !data.loading) load(state.month);
      const tabs = [['drivers', 'السواقين'], ['factories', 'المصانع'], ['absences', 'غياب العملاء']]
        .concat(money() && S.can('reports.finance') ? [['profit', 'الربح لكل مصنع']] : [])
        .concat(S.can('month.close') || S.can('reports.finance') ? [['sheets', 'كشوف المصانع']] : [])
        .concat(S.can('reports.finance') || S.can('month.close') ? [['export', 'التصدير للحسابات']] : []);
      if (!tabs.some(t => t[0] === state.tab)) state.tab = 'drivers';
      const months = [O.addMonths(M, -2), O.addMonths(M, -1), M];
      let body = '';
      if (data.loading) body = '<div class="spinner"></div>';
      else if (data.error) body = `<div class="banner danger">${esc(data.error)}</div>`;
      else if (state.tab === 'sheets') {
        body = `<p class="muted small" style="margin-bottom:10px">الكشف بيظهر لـ HR المصنع بعد ما تعتمده بس. ${TP.financeOn(D.settings) ? 'الحسابات شغالة: الكشف فيه المبالغ بأسعار المصنع.' : 'الحسابات مقفولة: الكشف تشغيل بس (أيام ومشاوير وغياب) من غير فلوس.'}</p>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>المصنع</th><th>الشغل</th><th>الحالة</th><th></th></tr></thead><tbody>${D.companies.map(f => {
            const sd = sheetData(f.id), sh = data.sheets[f.id], ok = sh && sh.status === 'approved';
            return `<tr><td><b>${esc(f.name)}</b></td><td class="small">${sd.lines.reduce((a, l) => a + l.full, 0)} يوم كامل · ${sd.lines.reduce((a, l) => a + l.half, 0)} نص · ${sd.missions.length} مشوار · ${sd.absences.reduce((a, x) => a + x.skip + x.noshow, 0)} غياب${sd.totals ? ` · <b>${esc(TP.money(sd.totals.total))}</b>` : ''}</td>
              <td>${ok ? `<span class="st st-ok">معتمد</span><div class="muted small">${esc(sh.approvedBy || '')}</div>` : '<span class="st st-off">لسه</span>'}</td>
              <td class="acts">${S.can('all') ? `<button class="btn btn-primary btn-sm" data-approve="${esc(f.id)}">${ok ? 'اعتماد تاني' : 'اعتماد'}</button>${ok ? `<button class="btn btn-ghost btn-sm" data-withdraw="${esc(f.id)}">سحب</button>` : ''}` : ''}<button class="btn btn-ghost btn-sm" data-sx="${esc(f.id)}">${TP.icon('file', 15)}تنزيل</button></td></tr>`;
          }).join('')}</tbody></table></div>`;
      } else if (state.tab === 'export') {
        const lock = D.lock;
        body = `<div class="banner info" style="margin-bottom:12px">${TP.icon('file')}<span class="grow">ملف Excel فيه كل الشغل الفعلي للفترة (أيام الخطوط، المشاوير والمطار، المصاريف، الكاش، الغياب)، بكود السواق الثابت — علشان المالية تنقله على سيستم الحسابات.</span></div>
          ${lock && lock.until ? `<p class="small" style="margin-bottom:10px">${TP.icon('lock', 15)} مقفول لحد <b dir="ltr">${esc(lock.until)}</b> — آخر تصدير بواسطة ${esc(lock.by || '')} (${esc(TP.fmtDateTime(lock.at))}). التعديلات اللي بعده هتظهر في صفحة "تعديلات بعد القفل".</p>` : ''}
          <div class="form-grid" style="max-width:560px"><label class="fld">من<input class="input" type="date" id="xFrom" value="${esc(state.from || defaultFrom())}"></label><label class="fld">لـ <small>لحد امبارح</small><input class="input" type="date" id="xTo" max="${esc(O.addDays(TP.dayKey(TP.now()), -1))}" value="${esc(state.to || O.addDays(TP.dayKey(TP.now()), -1))}"></label></div>
          <button class="btn btn-primary" id="xGo" style="margin-top:12px">${TP.icon('file', 18)}تصدير Excel وقفل الفترة</button>`;
      } else {
        const def = defOf(state.tab), sec = def.sections[0];
        body = kpiStrip(def) + htmlTable(sec) + (sec.note ? `<p class="muted small" style="margin-top:8px">${esc(sec.note)}</p>` : '');
      }
      root.innerHTML = `<section class="card">
        <div class="toolbar no-print">
          <div class="chips">${months.map(m => `<button class="chip ${state.month === m ? 'active' : ''}" data-month="${m}">${esc(O.monthName(m))}</button>`).join('')}</div>
          <div class="toolbar-end">${['drivers', 'factories', 'absences', 'profit'].includes(state.tab) && !data.loading ? `<button class="btn btn-primary" id="rDown">${TP.icon('file', 18)}تنزيل التقرير</button>` : ''}<button class="icon-btn" id="rRefresh" title="تحديث">${TP.icon('refresh', 18)}</button></div>
        </div>
        <div class="chips no-print" style="margin-bottom:14px">${tabs.map(([k, l]) => `<button class="chip ${state.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
        ${body}</section>`;
      const guard = p => p && p.catch && p.catch(e => TP.toast(TP.errorText(e), 'warn'));
      root.querySelectorAll('[data-month]').forEach(b => b.onclick = () => { state.month = b.dataset.month; TP.rerender(); });
      root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; TP.rerender(); });
      root.querySelector('#rRefresh').onclick = () => load(state.month);
      const dl = root.querySelector('#rDown');
      if (dl) dl.onclick = () => TP.report.choose(defOf(state.tab));
      root.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => guard(approveSheet(b.dataset.approve)));
      root.querySelectorAll('[data-withdraw]').forEach(b => b.onclick = () => guard(withdrawSheet(b.dataset.withdraw)));
      root.querySelectorAll('[data-sx]').forEach(b => b.onclick = () => { const f = TP.q.company(b.dataset.sx); TP.report.choose(Object.assign(TP.xlsx.sheetReport(sheetData(f.id), f.name, O.monthName(state.month)), { fileName: `TP-${f.nameEn || 'factory'}-${state.month}` })); });
      const xg = root.querySelector('#xGo');
      if (xg) {
        ['xFrom', 'xTo'].forEach(id => root.querySelector('#' + id).onchange = e => { state[id === 'xFrom' ? 'from' : 'to'] = e.target.value; });
        xg.onclick = () => guard(doExport());
      }
    }
  };
})(window.TP = window.TP || {});
