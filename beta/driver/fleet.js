/* ==========================================================================
   Driver app — "عربيتي": the trip order of the driver's own car
     أمر الشغل : the day's trips (odometer before/after, expense) → saved, and
                 the report goes to the car's WhatsApp group in the same shape
     العهدة    : the cash for the road; at the low mark he asks his manager
     البنزين   : the fuel card and its fill-ups
     راتبي     : base, extras, deductions, net so far (tourism drivers' salary)
     الصيانة   : what is due by kilometres, and the papers that run out
   Only for a driver whose car has the trip order switched on (fleet/{car}.on).
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP, S = TP.session, O = TP.ops;
  const FL = () => TP.fleet;
  const st = { vid: null, car: null, vehicle: null, logs: {}, salary: {}, base: null, sub: 'trips', draft: null, unsubs: [], key: '', salMonth: null, saving: false };
  const me = () => S.person && S.person.id;
  const today = () => TP.dayKey(TP.now());
  const M = () => O.monthOf(today());
  const dv = () => TP.dv || {};
  const settings = () => (dv().settings ? dv().settings() : TP.DEFAULT_SETTINGS);
  const money = n => TP.money(Math.round((Number(n) || 0) * 100) / 100);
  const draftKey = () => 'tp-trip-draft-' + st.vid;
  const carName = () => { const v = st.vehicle || {}; return [v.model, v.plate].filter(Boolean).join(' — ') || 'العربية'; };

  /* ---------- data ---------- */
  function stop() { st.unsubs.forEach(u => { try { u(); } catch (e) { /* ignore */ } }); st.unsubs = []; st.key = ''; }
  function start() {
    const vid = S.person && S.person.vehicleId, m = M(), key = [vid, m, me()].join('|');
    if (key === st.key) return;
    stop(); st.key = key; st.vid = vid || null; st.car = null; st.vehicle = null; st.logs = {}; st.salary = {}; st.base = null;
    const on = u => st.unsubs.push(u), q = () => dv().queue && dv().queue();
    // the salary shows to every driver who has one (no car needed)
    [m, O.addMonths(m, -1)].forEach(mm => on(TP.fb.onDoc(`salary/${me()}_${mm}`, d => { st.salary[mm] = d; q(); }, () => {})));
    on(TP.fb.onDoc('salaryBase/' + me(), d => { st.base = d; q(); }, () => {}));
    if (!vid) return;
    on(TP.fb.onDoc('fleet/' + vid, d => { st.car = d; q(); }, () => { st.car = null; q(); }));
    TP.fb.get('vehicles/' + vid).then(v => { st.vehicle = v; q(); }).catch(() => {});
    [m, O.addMonths(m, -1)].forEach(mm => on(TP.fb.onDoc(`fleetLog/${vid}_${mm}`, d => { st.logs[mm] = d; q(); }, () => {})));
  }
  const hasCar = () => !!(st.car && st.car.on);
  const hasSalary = () => !!(st.base || Object.values(st.salary).some(Boolean));
  const entries = (k, months) => (months || [M(), O.addMonths(M(), -1)]).flatMap(mm => Object.entries(((st.logs[mm] || {})[k]) || {}).map(([id, e]) => Object.assign({ id, month: mm }, e)));
  const sortDesc = l => l.sort((a, b) => (b.day + (b.time || '') + (b.at || 0)).localeCompare(a.day + (a.time || '') + (a.at || 0)));
  /** The last odometer: the car's (every sent trip moves it — also while offline, on the phone's copy). */
  function lastOdo() { return Number(st.car && st.car.odo) || 0; }

  /* ---------- the trip form (kept on the phone until it is sent) ---------- */
  const blank = before => ({ id: TP.newId('T'), day: today(), time: '', task: '', before: before || '', after: '', expense: '', expNote: '' });
  function loadDraft() {
    if (st.draft && st.draft.vid === st.vid) return st.draft;
    const saved = TP.store.get(draftKey(), null);
    st.draft = saved && saved.vid === st.vid && Array.isArray(saved.trips) && saved.trips.length ? saved : { vid: st.vid, trips: [blank(lastOdo() || '')] };
    return st.draft;
  }
  const saveDraft = () => TP.store.set(draftKey(), st.draft);
  function readForm(root) {
    const d = loadDraft();
    d.trips.forEach(t => {
      const g = f => { const el = root.querySelector(`[data-f="${f}"][data-t="${t.id}"]`); return el ? el.value : t[f]; };
      ['day', 'time', 'task', 'before', 'after', 'expense', 'expNote'].forEach(f => { t[f] = g(f); });
    });
    saveDraft();
    return d;
  }

  async function sendTrips(root) {
    if (st.saving) return;
    const d = readForm(root), s = settings();
    const trips = d.trips.filter(t => t.task.trim() || t.before || t.after || t.expense);
    if (!trips.length) return TP.toast('اكتب المشوار الأول');
    let prevOdo = lastOdo(), prevDay = (st.car && st.car.odoDay) || '';
    const clean = [];
    for (const [i, t] of trips.entries()) {
      const n = i + 1, before = Math.round(TP.num(t.before) || 0), after = Math.round(TP.num(t.after) || 0), exp = TP.num(t.expense || 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.day)) return TP.toast(`اختار تاريخ المشوار ${n}`);
      if (t.day > today()) return TP.toast(`تاريخ المشوار ${n} لسه مجاش`);
      if (t.day < O.addDays(today(), -39)) return TP.toast(`تاريخ المشوار ${n} قديم أوي (أكتر من 40 يوم) — كلّم الإدارة تسجّله`);
      if (!t.task.trim()) return TP.toast(`اكتب بيان المأمورية للمشوار ${n}`);
      if (!(exp >= 0 && exp <= 20000)) return TP.toast(`المصروف في المشوار ${n} مش مظبوط`);
      if (after && before && after < before) return TP.toast(`المشوار ${n}: العداد بعد أقل من قبل`);
      if (after && before && after - before > 3000) return TP.toast(`المشوار ${n}: ${after - before} كيلو — راجع العداد`);
      const why = FL().odoProblem(prevOdo, prevDay, before, after, t.day);
      if (why && !(await TP.confirm('راجع العداد', `المشوار ${n}: ${why}. لو الرقم صح دوس "أيوه، صح".`, 'أيوه، صح'))) return;
      clean.push({ id: t.id, day: t.day, time: /^\d{2}:\d{2}$/.test(t.time) ? t.time : '', task: t.task.trim().slice(0, 500), before, after, expense: Math.round(exp * 100) / 100, expNote: String(t.expNote || '').trim().slice(0, 120) });
      if (after) { prevOdo = Math.max(prevOdo, after); prevDay = t.day; }
    }
    const spent = clean.reduce((a, t) => a + t.expense, 0), left = (Number(st.car.custody) || 0) - spent;
    if (left < -20000) return TP.toast('المصروفات أكتر من العهدة بكتير — كلّم مديرك يسلّمك عهدة الأول', 'warn');
    if (spent && left < 0 && !(await TP.confirm('العهدة مش مكفية', `المصروفات ${money(spent)} أكتر من رصيد العهدة (${money(st.car.custody)}). تسجّلها برضه؟`, 'سجّل'))) return;
    st.saving = true;
    try {
      // one write per trip: the trip goes into the month's log, the expense off the custody and the odometer forward
      let odoNow = Number(st.car.odo) || 0;
      const writes = clean.map(t => {
        const month = O.monthOf(t.day), trip = { day: t.day, time: t.time, task: t.task, before: t.before, after: t.after, expense: t.expense, expNote: t.expNote, by: me(), at: TP.now(), sv: TP.fb.ts() };
        const car = { custody: TP.fb.inc(-t.expense), odoDay: t.day, lm: month, updatedAt: TP.fb.ts() };
        // forward only, at most 3000 km a trip (the same as the database rule — a bigger jump stays for management to check)
        if (t.after && t.after > odoNow && (odoNow === 0 || t.after - odoNow <= 3000)) { car.odo = t.after; odoNow = t.after; }
        return TP.fb.batch([
          { op: 'set', path: `fleetLog/${st.vid}_${month}`, data: { vehicleId: st.vid, month, trips: { [t.id]: trip }, last: { k: 'trips', id: t.id }, updatedAt: TP.fb.ts() }, merge: true },
          { op: 'update', path: 'fleet/' + st.vid, data: car }
        ]);
      });
      const all = Promise.all(writes);
      if (dv().track) dv().track(all, clean.length > 1 ? `اتسجلوا ${clean.length} مشاوير ✓` : 'المشوار اتسجل ✓'); else all.catch(e => TP.toast(TP.errorText(e), 'warn'));
      // the report to the car's group, in the same shape as before
      const msg = FL().tripMessage(carName(), clean);
      st.draft = { vid: st.vid, trips: [blank(odoNow || '')] }; saveDraft();
      await shareToGroup(msg);
      dv().render && dv().render();
    } finally { st.saving = false; }
  }
  /** Copies the text and opens the car's WhatsApp group (the link is never in the code — it comes with the car). */
  async function shareToGroup(msg) {
    let copied = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(msg); copied = true; } } catch (e) { /* no clipboard */ }
    if (!copied) { try { const ta = document.createElement('textarea'); ta.value = msg; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); copied = document.execCommand('copy'); ta.remove(); } catch (e) { /* ignore */ } }
    const link = st.car && st.car.group;
    if (link && /^https:\/\/chat\.whatsapp\.com\//.test(link)) {
      TP.toast(copied ? 'التقرير اتنسخ ✓ — الجروب هيفتح: دوس لصق وابعت' : 'الجروب هيفتح — انسخ التقرير وابعته', '');
      setTimeout(() => window.open(link, '_blank'), 600);
    } else {
      TP.toast(copied ? 'التقرير اتنسخ ✓ — جروب العربية لسه متحطش، ابعته بإيدك' : 'جروب العربية لسه متحطش', 'warn');
    }
  }

  /* ---------- fuel & custody ---------- */
  function addFill() {
    TP.openModal('تعبئة بنزين', `<label class="fld">المبلغ (جنيه)<input class="input" id="fAmt" inputmode="decimal" dir="ltr"></label>
      <label class="fld" style="margin-top:10px">ملاحظة (اختياري)<input class="input" id="fNote" maxlength="120" placeholder="مثال: بنزينة موبيل — 40 لتر"></label>`, async () => {
      const amt = TP.num(TP.ui_val('fAmt'));
      if (!(amt > 0 && amt <= 20000)) { TP.toast('اكتب المبلغ'); return false; }
      const a = Math.round(amt * 100) / 100, day = today(), month = O.monthOf(day), id = TP.newId('F');
      if (a > (Number(st.car.fuel) || 0) && !(await TP.confirm('رصيد الفيزا مش مكفي', `التعبئة ${money(a)} أكتر من رصيد الفيزا (${money(st.car.fuel)}). تسجّلها برضه؟`, 'سجّل'))) return false;
      const p = TP.fb.batch([
        { op: 'set', path: `fleetLog/${st.vid}_${month}`, data: { vehicleId: st.vid, month, fuel: { [id]: { day, kind: 'fill', amount: a, note: TP.ui_val('fNote').slice(0, 120), by: me(), at: TP.now(), sv: TP.fb.ts() } }, last: { k: 'fuel', id }, updatedAt: TP.fb.ts() }, merge: true },
        { op: 'update', path: 'fleet/' + st.vid, data: { fuel: TP.fb.inc(-a), lm: month, updatedAt: TP.fb.ts() } }
      ]);
      if (dv().track) dv().track(p, 'التعبئة اتسجلت ✓ — اتخصم ' + money(a)); else p.catch(e => TP.toast(TP.errorText(e), 'warn'));
    }, { saveLabel: 'سجّل' });
  }
  function askCustody() {
    const bal = Number(st.car.custody) || 0;
    const p = TP.fb.update('fleet/' + st.vid, { req: { at: TP.now(), bal: Math.round(bal * 100) / 100 }, updatedAt: TP.fb.ts() });
    if (dv().track) dv().track(p, 'طلبك اتبعت لمدير التشغيل ✓'); else p.catch(e => TP.toast(TP.errorText(e), 'warn'));
  }

  /* ---------- rendering ---------- */
  const low = () => hasCar() && (Number(st.car.custody) || 0) <= (Number(settings().custodyLow) || 100);
  /** The custody message — also shown on the "النهارده" tab. */
  function custodyBanner() {
    if (!low()) return '';
    const bal = money(st.car.custody), asked = st.car.req && st.car.req.at;
    return `<div class="banner danger" style="flex-wrap:wrap">${TP.icon('money')}<span class="grow">عهدة المصروفات وصلت <b>${esc(bal)}</b></span>
      ${asked ? `<span class="st st-warn">طلبت عهدة ${esc(TP.ago(asked))} — مستني مديرك</span>` : `<button type="button" class="btn btn-primary btn-sm" data-askc="1">خد عهدة مصروفات من مديرك — رصيدك ${esc(bal)}</button>`}</div>`;
  }
  const tile = (label, value, tone, sub) => `<div class="pill ${tone || ''}"><span>${esc(label)}</span><strong>${value}</strong>${sub ? `<small class="muted">${sub}</small>` : ''}</div>`;

  function tripsHtml() {
    const d = loadDraft(), bal = Number(st.car.custody) || 0;
    let spent = 0;
    const cards = d.trips.map((t, i) => {
      spent += TP.num(t.expense || 0) || 0;
      const f = (k, label, attrs) => `<label class="fld">${label}<input class="input" data-f="${k}" data-t="${esc(t.id)}" value="${esc(t[k])}" ${attrs || ''}></label>`;
      return `<div class="trip-form"><div class="trip-h"><b>مشوار ${i + 1}</b>${d.trips.length > 1 ? `<button type="button" class="link" data-rmtrip="${esc(t.id)}">حذف</button>` : ''}</div>
        <div class="form-grid two">${f('day', 'التاريخ', 'type="date"')}${f('time', 'وقت التحرك', 'type="time"')}</div>
        <label class="fld">بيان المأمورية<textarea class="input" rows="2" data-f="task" data-t="${esc(t.id)}" maxlength="500" placeholder="مثال: من البيت إلى مطار القاهرة ثم إلى مقر الشركة">${esc(t.task)}</textarea></label>
        <div class="form-grid two">${f('before', 'العداد قبل التحرك', 'inputmode="numeric" dir="ltr"')}${f('after', 'العداد بعد', 'inputmode="numeric" dir="ltr"')}</div>
        <div class="form-grid two">${f('expense', 'المصروف (جنيه)', 'inputmode="decimal" dir="ltr" placeholder="0"')}${f('expNote', 'بيان المصروف', 'maxlength="120" placeholder="مثال: كارتة / باركينج"')}</div>
        <div class="cust-left">رصيد العهدة بعد المشوار ده: <b data-left="${esc(t.id)}" class="${bal - spent < 200 ? 'neg' : 'pos'}">${esc(money(bal - spent))}</b></div></div>`;
    }).join('');
    const month = sortDesc(entries('trips', [M()]));
    const km = month.reduce((a, t) => a + (t.after && t.before ? t.after - t.before : 0), 0), exp = month.reduce((a, t) => a + (Number(t.expense) || 0), 0);
    return `<section class="glass card"><div class="dv-h"><div><h2>أمر الشغل</h2><div class="sub">${esc(carName())}</div></div></div>
        <div class="sum-row">${tile('رصيد العهدة', esc(money(bal)), bal <= (Number(settings().custodyLow) || 100) ? 'neg' : '')}${tile('آخر عداد', esc(String(lastOdo() || '—')))}</div>
        ${cards}
        <button type="button" class="btn btn-ghost btn-block" id="addTrip" style="margin-top:10px">${TP.icon('plus', 18)}مشوار تاني</button>
        <button type="button" class="act" id="sendTrips" style="margin-top:12px">${TP.icon('check', 28)}<span><b>سجّل وابعت للجروب</b><small>بيتسجل في البرنامج، والتقرير بيتنسخ ويفتح جروب العربية</small></span></button>
      </section>
      <section class="glass card"><div class="dv-h"><div><h2>مشاوير الشهر</h2><div class="sub">${esc(O.monthName(M()))} — ${month.length} مشوار · ${km} كم · ${esc(money(exp))}</div></div>${month.length ? `<button type="button" class="btn btn-ghost btn-sm" id="tripsDown">${TP.icon('file', 16)}تنزيل</button>` : ''}</div>
        ${month.length ? month.slice(0, 40).map(t => `<div class="exp-row"><span><b>${esc(t.task)}</b><small class="muted"> ${esc(t.day)}${t.time ? ' · ' + esc(O.hm12(t.time)) : ''} · ${t.before || '-'} ← ${t.after || '-'}</small></span><span>${Number(t.expense) ? esc(money(t.expense)) : ''}</span></div>`).join('') : '<div class="empty">لسه مفيش مشاوير الشهر ده.</div>'}</section>`;
  }
  function fuelHtml() {
    const bal = Number(st.car.fuel) || 0, lowF = bal < (Number(settings().fuelLow) || 1000);
    const list = sortDesc(entries('fuel'));
    const K = { fill: 'تعبئة بنزين', charge: 'شحن الفيزا', set: 'تحديد الرصيد' };
    return `<section class="glass card"><div class="dv-h"><div><h2>فيزا البنزين</h2><div class="sub">${esc(carName())}</div></div></div>
      <div class="big-bal ${lowF ? 'neg' : ''}">${esc(money(bal))}</div>
      ${lowF ? `<div class="banner warn">${TP.icon('warn')}<span>رصيد الفيزا أقل من ${esc(money(settings().fuelLow || 1000))} — الإدارة عرفت.</span></div>` : ''}
      <button type="button" class="act" id="addFill">${TP.icon('plus', 26)}<span><b>تسجيل تعبئة بنزين</b><small>المبلغ بيتخصم من رصيد الفيزا</small></span></button></section>
      <section class="glass card"><div class="dv-h"><h2>آخر العمليات</h2></div>${list.length ? list.slice(0, 30).map(e => `<div class="exp-row"><span>${esc(K[e.kind] || e.kind)}${e.note ? ' — ' + esc(e.note) : ''}<small class="muted"> ${esc(e.day)}</small></span><b class="${e.kind === 'fill' ? 'neg' : 'pos'}">${e.kind === 'fill' ? '−' : e.kind === 'charge' ? '+' : '='}${esc(money(e.amount))}</b></div>`).join('') : '<div class="empty">مفيش عمليات لسه.</div>'}</section>`;
  }
  function custodyHtml() {
    const bal = Number(st.car.custody) || 0;
    const K = { topup: 'عهدة من الإدارة', set: 'تحديد الرصيد' };
    const list = sortDesc(entries('cash').map(e => Object.assign({ kind2: 'cash' }, e)).concat(entries('trips').filter(t => Number(t.expense) > 0).map(t => ({ kind2: 'trip', day: t.day, time: t.time, at: t.at, amount: t.expense, note: t.expNote || t.task }))));
    return `<section class="glass card"><div class="dv-h"><div><h2>عهدة المصروفات</h2><div class="sub">${esc(carName())}</div></div></div>
      <div class="big-bal ${low() ? 'neg' : ''}">${esc(money(bal))}</div>${custodyBanner()}</section>
      <section class="glass card"><div class="dv-h"><h2>حركة العهدة</h2></div>${list.length ? list.slice(0, 40).map(e => `<div class="exp-row"><span>${e.kind2 === 'trip' ? 'مصروف مشوار' : esc(K[e.kind] || e.kind)}${e.note ? ' — ' + esc(e.note) : ''}<small class="muted"> ${esc(e.day)}</small></span><b class="${e.kind2 === 'trip' ? 'neg' : 'pos'}">${e.kind2 === 'trip' ? '−' : e.kind === 'set' ? '=' : '+'}${esc(money(e.amount))}</b></div>`).join('') : '<div class="empty">مفيش حركة لسه.</div>'}</section>`;
  }
  function salaryHtml() {
    const m = st.salMonth || M(), doc = st.salary[m] || null, base = doc ? doc.base : (m === M() && st.base ? st.base.base : 0);
    const n = FL().salaryNet(Object.assign({}, doc || {}, { base }));
    const items = (o, sign) => Object.values(o || {}).sort((a, b) => String(a.day).localeCompare(String(b.day))).map(x => `<div class="exp-row"><span>${esc(x.note || (sign > 0 ? 'إضافي' : 'خصم'))}<small class="muted"> ${esc(x.day || '')}</small></span><b class="${sign > 0 ? 'pos' : 'neg'}">${sign > 0 ? '+' : '−'}${esc(money(x.amount))}</b></div>`).join('');
    return `<section class="glass card"><div class="dv-h"><div><h2>راتبي</h2><div class="sub">${esc(O.monthName(m))}${m === M() ? ' — لحد النهارده' : ''}</div></div>${doc || base ? '<button type="button" class="btn btn-ghost btn-sm" id="salDown">' + TP.icon('file', 16) + 'تنزيل</button>' : ''}</div>
      <div class="month-pick">${[M(), O.addMonths(M(), -1)].map(mm => `<button type="button" class="chip ${mm === m ? 'active' : ''}" data-salm="${mm}">${esc(O.monthName(mm))}</button>`).join('')}</div>
      <table class="stmt"><tbody><tr><td>المرتب الأساسي</td><td>${esc(money(n.base))}</td></tr><tr><td>الإضافي والسهرات</td><td>${esc(money(n.extra))}</td></tr><tr><td>الخصومات</td><td>${esc(money(n.ded))}</td></tr><tr class="total"><td>الصافي ${m === M() ? 'لحد النهارده' : ''}</td><td>${esc(money(n.net))}</td></tr></tbody></table>
      ${doc && (Object.keys(doc.extra || {}).length || Object.keys(doc.ded || {}).length) ? `<h3 class="sec-h">التفاصيل</h3>${items(doc.extra, 1)}${items(doc.ded, -1)}` : ''}
      <p class="muted small" style="margin-top:8px">التعديل من الإدارة بس. لو في حاجة مش مظبوطة كلّم مديرك.</p></section>`;
  }
  function maintHtml() {
    const plan = FL().plan(settings()), rows = FL().status(Object.assign({}, st.car, { odo: lastOdo() }), plan, today());
    const v = st.vehicle || {}, p = S.person || {}, warn = Number(settings().expiryWarnDays) || 30;
    const doc = (label, day) => { const s = FL().docStage(day, today(), warn), d = day ? TP.daysUntil(day) : null; return `<div class="exp-row"><span>${esc(label)}<small class="muted"> ${esc(day || 'مش متسجل')}</small></span><span class="st ${s === 'expired' ? 'st-danger' : s === 'soon' ? 'st-warn' : s === 'ok' ? 'st-ok' : 'st-off'}">${s === 'expired' ? 'منتهية من ' + -d + ' يوم' : s === 'soon' ? 'باقي ' + d + ' يوم' : s === 'ok' ? 'سارية' : 'مش متسجل'}</span></div>`; };
    return `<section class="glass card"><div class="dv-h"><div><h2>الصيانة</h2><div class="sub">العداد دلوقتي ${lastOdo() || '—'} كم</div></div></div>
      ${st.car.model ? rows.map(r => { const sg = FL().STAGE[r.stage] || ['', 'st-off']; return `<div class="exp-row"><span><b>${esc(r.n)}</b><small class="muted"> ${r.next ? 'الجاي عند ' + r.next + ' كم' + (r.left !== null ? ` (باقي ${r.left} كم)` : '') : r.nextDay ? 'الجاي ' + esc(r.nextDay) : 'آخر تغيير مش متسجل'}${r.note ? ' · ' + esc(r.note) : ''}</small></span><span class="st ${sg[1]}">${sg[0]}</span></div>`; }).join('')
        + `<p class="muted small" style="margin-top:8px">مع كل تغيير زيت: ${FL().CHECKS.map(esc).join(' · ')}.</p>` : '<div class="empty">جدول صيانة العربية لسه متحددش من الإدارة.</div>'}</section>
      <section class="glass card"><div class="dv-h"><h2>الأوراق</h2></div>${doc('رخصة العربية', v.licenseExpiry)}${doc('تأمين العربية', v.insuranceExpiry)}${doc('رخصة القيادة بتاعتك', p.licenseExpiry)}</section>`;
  }

  /* ---------- downloads ---------- */
  function tripsReport() {
    const list = sortDesc(entries('trips', [M()])).reverse();
    const km = t => t.after && t.before ? t.after - t.before : '';
    TP.report.choose({ title: 'سجل مشاوير ' + carName(), subtitle: (S.person.code ? S.person.code + ' · ' : '') + S.person.name, period: O.monthName(M()), fileName: `مشاوير-${(st.vehicle && st.vehicle.plate) || 'car'}-${M()}`, audit: false,
      kpis: [['المشاوير', list.length], ['الكيلومترات', list.reduce((a, t) => a + (Number(km(t)) || 0), 0)], ['المصروفات', money(list.reduce((a, t) => a + (Number(t.expense) || 0), 0))], ['رصيد العهدة', money(st.car.custody), 'gold']],
      sections: [{ title: 'المشاوير', columns: [{ h: 'التاريخ', t: 'center' }, { h: 'وقت التحرك', t: 'center' }, { h: 'بيان المأمورية', w: 40 }, { h: 'العداد قبل', t: 'int' }, { h: 'العداد بعد', t: 'int' }, { h: 'كيلومترات', t: 'int', sum: true }, { h: 'المصروف (ج.م)', t: 'money', sum: true }, { h: 'بيان المصروف' }],
        rows: list.map(t => [t.day, t.time ? O.hm12(t.time) : '', t.task, t.before || '', t.after || '', km(t), Number(t.expense) || 0, t.expNote || '']), totals: true }] });
  }
  function salaryReport() {
    const m = st.salMonth || M(), doc = st.salary[m] || {}, base = doc.base ?? (st.base ? st.base.base : 0), n = FL().salaryNet(Object.assign({}, doc, { base }));
    const rows = [['المرتب الأساسي', '', n.base]].concat(Object.values(doc.extra || {}).map(x => ['إضافي: ' + (x.note || ''), x.day || '', Number(x.amount) || 0]), Object.values(doc.ded || {}).map(x => ['خصم: ' + (x.note || ''), x.day || '', -(Number(x.amount) || 0)]));
    TP.report.choose({ title: 'كشف المرتب', subtitle: (S.person.code ? S.person.code + ' · ' : '') + S.person.name, period: O.monthName(m), fileName: `مرتب-${S.person.code || ''}-${m}`, audit: false,
      kpis: [['الأساسي', money(n.base)], ['الإضافي', money(n.extra), 'good'], ['الخصومات', money(n.ded), 'bad'], ['الصافي', money(n.net), 'gold']],
      sections: [{ title: 'المرتب', columns: [{ h: 'البند', w: 36 }, { h: 'التاريخ', t: 'center' }, { h: 'المبلغ (ج.م)', t: 'money', sum: true }], rows, totals: ['الصافي', '', n.net] }] });
  }

  /* ---------- the tab ---------- */
  function render(root) {
    if (!hasCar() && !hasSalary()) { root.innerHTML = '<section class="glass card"><div class="empty">مفيش عربية عليك في أمر الشغل.</div></section>'; return; }
    const subs = (hasCar() ? [['trips', 'أمر الشغل'], ['custody', 'العهدة'], ['fuel', 'البنزين']] : []).concat(hasSalary() ? [['salary', 'راتبي']] : [], hasCar() ? [['maint', 'الصيانة والأوراق']] : []);
    if (!subs.some(s => s[0] === st.sub)) st.sub = subs[0][0];
    const body = st.sub === 'trips' ? tripsHtml() : st.sub === 'custody' ? custodyHtml() : st.sub === 'fuel' ? fuelHtml() : st.sub === 'salary' ? salaryHtml() : maintHtml();
    root.innerHTML = `${st.sub !== 'custody' ? custodyBanner() : ''}<div class="month-pick car-subs">${subs.map(([k, l]) => `<button type="button" class="chip ${st.sub === k ? 'active' : ''}" data-sub="${k}">${l}</button>`).join('')}</div>${body}`;
    root.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { if (st.sub === 'trips') readForm(root); st.sub = b.dataset.sub; render(root); window.scrollTo(0, 0); });
    bindBanner(root);
    if (st.sub === 'trips') {
      // the custody left after each trip follows what is typed (no redraw — the keyboard stays open)
      const lefts = () => { const d = loadDraft(), bal = Number(st.car.custody) || 0; let spent = 0;
        d.trips.forEach(t => { spent += TP.num(t.expense || 0) || 0; const el = root.querySelector(`[data-left="${t.id}"]`); if (el) { el.textContent = money(bal - spent); el.className = bal - spent < 200 ? 'neg' : 'pos'; } }); };
      root.querySelectorAll('[data-f]').forEach(el => el.addEventListener('input', () => { readForm(root); if (el.dataset.f === 'expense') lefts(); }));
      const add = root.querySelector('#addTrip');
      if (add) add.onclick = () => { const d = readForm(root), lastT = d.trips[d.trips.length - 1]; d.trips.push(blank(lastT && lastT.after ? lastT.after : (lastT && lastT.before) || lastOdo() || '')); saveDraft(); render(root); };
      root.querySelectorAll('[data-rmtrip]').forEach(b => b.onclick = () => { const d = readForm(root); d.trips = d.trips.filter(t => t.id !== b.dataset.rmtrip); saveDraft(); render(root); });
      root.querySelector('#sendTrips').onclick = () => sendTrips(root).catch(e => { console.error(e); TP.toast(TP.errorText(e), 'warn'); });
      const dl = root.querySelector('#tripsDown'); if (dl) dl.onclick = tripsReport;
    }
    const af = root.querySelector('#addFill'); if (af) af.onclick = addFill;
    root.querySelectorAll('[data-salm]').forEach(b => b.onclick = () => { st.salMonth = b.dataset.salm; render(root); });
    const sd = root.querySelector('#salDown'); if (sd) sd.onclick = salaryReport;
  }
  function bindBanner(root) { root.querySelectorAll('[data-askc]').forEach(b => b.onclick = askCustody); }

  TP.dvCar = {
    start, stop, render, custodyBanner, bindBanner,
    /** Is there anything to show in "عربيتي"? */
    available: () => hasCar() || hasSalary(),
    /** Keeps what is typed in the trip form when the screen is redrawn from outside. */
    keep(root) { if (root && st.sub === 'trips' && root.querySelector('[data-f]')) readForm(root); }
  };
})(window.TP = window.TP || {});
