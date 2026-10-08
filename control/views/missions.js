/* ==========================================================================
   المشاوير والمطار — one-off trips and airport transfers.
   Each trip has two separate prices written for that trip only: what the
   factory pays (missionFactory/) and what the driver earns (missionDriver/).
   Neither side can read the other. Prices show only when the accounts are on.
   Airport: the flight number is enough — the cloud alarm brings the times
   (and checks again 5 h and 2 h before); the trip's time follows the flight.
   Every customer of a trip gets a link for that trip only (c/#token → track/{sha256(token)}).
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui, O = TP.ops;
  const FL = () => TP.flight;
  const state = { month: '', filter: 'open', type: '' };
  let live = { month: null, unsubs: [], list: [], pd: {}, pf: {} };
  const money = () => TP.financeOn(D.settings);
  const MAX_TRIP_CUST = 4;   // a private car: 4 passengers at most (the cloud alarm updates up to 4 links per trip)

  function watch(month) {
    if (live.month === month) return;
    live.unsubs.forEach(u => u());
    live = { month, unsubs: [], list: [], pd: {}, pf: {} };
    const w = { where: [['month', '==', month]] };
    live.unsubs.push(TP.data.watch('missions', w, l => { if (live.month === month) { live.list = l; TP.rerender(); } }));
    if (S.can('prices.view')) {
      live.unsubs.push(TP.data.watch('missionDriver', w, l => { if (live.month !== month) return; live.pd = {}; l.forEach(x => { live.pd[x.id] = x; }); TP.rerender(); }));
      live.unsubs.push(TP.data.watch('missionFactory', w, l => { if (live.month !== month) return; live.pf = {}; l.forEach(x => { live.pf[x.id] = x; }); TP.rerender(); }));
    }
  }
  const find = id => live.list.find(m => m.id === id);
  const placeHtml = (prefix, p, label) => `
    <label class="fld">${label || (prefix === 'from' ? 'من (المكان)' : 'إلى (المكان)')}<input class="input" id="${prefix}Name" value="${esc((p && p.name) || '')}"></label>
    <label class="fld">لوكيشن ${prefix === 'from' ? 'البداية' : 'الوجهة'} <small>اختياري — بيسجّل الوصول لوحده</small><input class="input" id="${prefix}Loc" dir="ltr" placeholder="لينك جوجل ماب أو 30.29, 31.74" value="${esc(U.locText(p && p.location))}"></label>`;
  function readPlace(prefix) {
    const name = U.val(prefix + 'Name'), raw = U.val(prefix + 'Loc');
    const location = raw ? TP.parseLocation(raw) : null;
    if (raw && !location) return { error: `لوكيشن "${prefix === 'from' ? 'من' : 'إلى'}" مش مقروء` };
    return { name, location };
  }
  const priceFields = (m, pd, pf) => `
    <div class="full"><h4 style="margin:6px 0 8px;color:var(--maroon-2)">سعر المشوار ده</h4><p class="muted small">كل مشوار بسعره. السواق بيشوف أجره بس، والمصنع بيشوف سعره بس.</p></div>
    <label class="fld">سعر المصنع<input class="input" id="mPF" inputmode="decimal" dir="ltr" value="${pf ? esc(pf.amount) : ''}" placeholder="${m.factoryId ? '0' : 'مفيش مصنع'}" ${m.factoryId === '' ? 'disabled' : ''}></label>
    <label class="fld">أجر السواق<input class="input" id="mPD" inputmode="decimal" dir="ltr" value="${pd ? esc(pd.amount) : ''}" placeholder="0"></label>`;
  /** Price docs ops (only for prices.edit). Empty field = leave as is; unchanged prices are not rewritten. */
  function priceOps(id, m) {
    const ops = [], pf = U.money('mPF'), pd = U.money('mPD');
    if (Number.isNaN(pf) || Number.isNaN(pd)) return { error: 'السعر لازم يكون رقم' };
    const meta = { month: m.month, setBy: S.person.name, setAt: TP.fb.ts() };
    const oldD = live.pd[id], oldF = live.pf[id];
    if (pd !== null && !(oldD && oldD.amount === pd && oldD.driverId === m.driverId && oldD.month === m.month)) ops.push({ op: 'set', path: 'missionDriver/' + id, data: Object.assign({ driverId: m.driverId, amount: pd }, meta) });
    if (pf !== null && m.factoryId && !(oldF && oldF.amount === pf && oldF.factoryId === m.factoryId && oldF.month === m.month)) ops.push({ op: 'set', path: 'missionFactory/' + id, data: Object.assign({ factoryId: m.factoryId, amount: pf }, meta) });
    return { ops, pd, pf };
  }

  /* ---------- customers of a trip ---------- */
  let custs = [];
  function readCusts() { custs = TP.$$('#mCusts .cust-row').map(r => ({ id: r.dataset.id || '', h: r.dataset.h || '', name: r.querySelector('[data-c=name]').value.trim(), phone: TP.latinDigits(r.querySelector('[data-c=phone]').value.trim()) })); }
  function drawCusts() {
    const box = TP.$('#mCusts');
    box.innerHTML = custs.map((c, i) => `<div class="cust-row two" data-id="${esc(c.id)}" data-h="${esc(c.h || '')}">
        <input class="input" data-c="name" placeholder="اسم العميل" value="${esc(c.name)}" maxlength="60">
        <input class="input" data-c="phone" placeholder="الموبايل" inputmode="tel" dir="ltr" value="${esc(c.phone)}" maxlength="16">
        <button type="button" class="icon-btn danger" data-rmc="${i}" title="شيل">${TP.icon('trash', 16)}</button></div>`).join('') +
      (custs.length < MAX_TRIP_CUST ? '<button type="button" class="link" id="mAddC">+ عميل</button>' : '');
    box.querySelectorAll('[data-rmc]').forEach(b => b.onclick = () => { readCusts(); custs.splice(Number(b.dataset.rmc), 1); drawCusts(); });
    const add = TP.$('#mAddC'); if (add) add.onclick = () => { readCusts(); custs.push({ id: '', h: '', name: '', phone: '' }); drawCusts(); };
  }

  /** The fixed part of a trip customer's link. */
  function trackStatic(id, m, c) {
    const f = TP.q.company(m.factoryId);
    const loc = l => l && isFinite(l.lat) ? { lat: l.lat, lng: l.lng } : null;
    const fl = m.flight ? { no: m.flight.no || '', dir: m.flight.dir || '', terminal: m.flight.terminal || '', airportName: m.flight.airportName || '', other: m.flight.other || '', airline: m.flight.airline || '', sched: m.flight.sched || null, est: m.flight.est || null, status: m.flight.status || '' } : null;
    return { kind: 'mission', custId: c.id, name: c.name, missionId: id, factoryId: m.factoryId || '', factoryName: f ? f.name : (m.client || ''), title: m.title || '',
      type: m.type || '', day: m.day, time: m.time || '', fromName: (m.from && m.from.name) || '', toName: (m.to && m.to.name) || '', fromLoc: loc(m.from && m.from.location), toLoc: loc(m.to && m.to.location), flight: fl, updatedAt: TP.fb.ts() };
  }
  function trackOps(id, m, old, fresh) {
    const ops = [], keep = new Set();
    (m.customers || []).forEach(c => {
      keep.add(c.h);
      const isNew = !(old && (old.customers || []).some(x => x.h === c.h));
      ops.push({ op: 'set', path: 'track/' + c.h, data: Object.assign(trackStatic(id, m, c), isNew ? { st: 'idle', seq: 0, createdAt: TP.fb.ts() } : {}), merge: true });
      if (fresh && fresh[c.h]) ops.push(TP.cust.linkOp(c.h, fresh[c.h], { kind: 'mission', custId: c.id, missionId: id }));
    });
    if (old) (old.customers || []).forEach(c => { if (c.h && !keep.has(c.h)) ops.push(...TP.cust.dropOps(c.h)); });
    return ops;
  }

  /* ---------- editor ---------- */
  let onSavedHook = null;
  function openEditor(mid, prefill, onSaved) {
    const base = { day: TP.dayKey(), factoryId: '', status: 'assigned', type: '' };
    const m = mid ? find(mid) : Object.assign(base, prefill || {});
    if (!m) return;
    onSavedHook = onSaved || null;
    const canPrice = S.can('prices.edit') && money();
    const drivers = TP.q.drivers().filter(p => p.active !== false || p.id === m.driverId);
    const fl = m.flight || {};
    custs = (m.customers || []).map(c => ({ id: c.id || '', h: c.h || '', name: c.name || '', phone: c.phone || '' }));
    if (!custs.length && !mid) custs = [{ id: '', h: '', name: '', phone: '' }];
    const manualTime = fl.src === 'manual' && fl.sched ? O.hm(fl.sched) : '';
    TP.openModal(mid ? 'تعديل مشوار' : 'مشوار جديد', `
      <div class="chips" style="margin-bottom:12px"><button type="button" class="chip ${m.type !== 'airport' ? 'active' : ''}" data-mt="">${TP.icon('file', 16)}مشوار عادي</button><button type="button" class="chip ${m.type === 'airport' ? 'active' : ''}" data-mt="airport">${TP.icon('plane', 16)}مطار</button></div>
      <div class="form-grid">
        <div class="full form-grid" id="mAir" style="padding:12px;border:1px dashed var(--line-strong);border-radius:14px;background:#fffaf1">
          <label class="fld">رقم الرحلة<input class="input" id="fNo" dir="ltr" placeholder="MS 777" value="${esc(fl.no || '')}" maxlength="10"></label>
          <label class="fld">تاريخ الطيارة<input class="input" type="date" id="fDate" value="${esc(fl.date || m.day || '')}"></label>
          <label class="fld">النوع<select class="input" id="fDir"><option value="">يتعرف لوحده من رقم الرحلة</option><option value="arr" ${fl.dir === 'arr' && fl.dirSet ? 'selected' : ''}>استقبال (العميل جاي)</option><option value="dep" ${fl.dir === 'dep' && fl.dirSet ? 'selected' : ''}>توصيل (العميل مسافر)</option></select></label>
          <label class="fld">ميعاد الطيارة <small>سيبه فاضي — بييجي لوحده</small><input class="input" type="time" id="fTime" value="${esc(manualTime)}"></label>
          <label class="fld">الصالة <small>اختياري</small><input class="input" id="fTerm" value="${esc(fl.terminalSet ? fl.terminal : '')}" maxlength="10" placeholder="${esc(fl.terminal || '')}"></label>
          <label class="fld" id="fDriveBox">مدة الطريق للمطار (دقيقة)<input class="input" id="fDrive" type="number" min="15" max="300" dir="ltr" value="${esc(m.driveMin || D.settings.airportDriveMin || 75)}"></label>
          <div class="full small muted" id="fInfo">${flightLine(m)}</div>
        </div>
        <label class="fld full">وصف المشوار<input class="input" id="mTitle" value="${esc(m.title || '')}" placeholder="مثال: توصيل وفد من الفندق للمصنع — للمطار بيتكتب لوحده" maxlength="120"></label>
        <label class="fld" data-reg>اليوم<input class="input" type="date" id="mDay" value="${esc(m.day || '')}"></label>
        <label class="fld" data-reg>الميعاد (عند العميل)<input class="input" type="time" id="mTime" value="${esc(m.time || '')}"></label>
        <label class="fld">المصنع (العميل)<select class="input" id="mFactory">${U.opts(D.companies, m.factoryId, c => c.id, c => c.name, 'جهة تانية / عميل فرد')}</select></label>
        <label class="fld">اسم الجهة <small>لو مش مصنع</small><input class="input" id="mClient" value="${esc(m.client || '')}" maxlength="80"></label>
        <label class="fld full">السواق<select class="input" id="mDriver">${U.opts(drivers, m.driverId, p => p.id, p => `${TP.driverLabel(p)} — ${TP.driverKindName(p.driverKind)}`, 'اختار السواق')}</select></label>
        ${placeHtml('from', m.from)}${placeHtml('to', m.to)}
        <div class="full"><div class="muted small" style="font-weight:800;margin-bottom:6px">العملاء <small>كل عميل بياخد لينك للمشوار ده بس</small></div><div id="mCusts"></div></div>
        <label class="fld">كاش مع السواق <small>عميل فرد بيدفع للسواق</small><input class="input" id="mCash" inputmode="decimal" dir="ltr" value="${m.cash ? esc(m.cash.amount) : ''}" placeholder="0"></label>
        <label class="fld">ملاحظة الكاش<input class="input" id="mCashNote" value="${m.cash ? esc(m.cash.note || '') : ''}" maxlength="120"></label>
        <label class="fld full">ملاحظات للسواق<textarea class="input" id="mNotes" rows="2" maxlength="500">${esc(m.notes || '')}</textarea></label>
        ${canPrice ? priceFields(m, live.pd[mid], live.pf[mid]) : (money() ? '<p class="muted small full">السعر بيحطه المدير المالي أو المدير العام من نفس الصفحة.</p>' : '')}
      </div>`, () => save(mid, m), { wide: true, saveLabel: mid ? 'حفظ' : 'إضافة' });
    let type = m.type || '';
    const syncType = () => {
      TP.$('#mAir').hidden = type !== 'airport';
      TP.$$('#tp-modal [data-reg]').forEach(el => { el.hidden = type === 'airport'; });
      const dir = U.val('fDir') || fl.dir || '';
      TP.$('#fDriveBox').hidden = dir === 'arr';
      TP.$('#fromName').closest('.fld').firstChild.textContent = type === 'airport' ? (dir === 'arr' ? 'من (المطار/الصالة)' : 'من (مكان العميل)') : 'من (المكان)';
      TP.$('#toName').closest('.fld').firstChild.textContent = type === 'airport' ? (dir === 'dep' ? 'إلى (المطار)' : 'إلى (وجهة العميل)') : 'إلى (المكان)';
    };
    TP.$$('#tp-modal [data-mt]').forEach(b => b.onclick = () => { type = b.dataset.mt; TP.$$('#tp-modal [data-mt]').forEach(x => x.classList.toggle('active', x === b)); syncType(); });
    TP.$('#fDir').onchange = syncType;
    syncType(); drawCusts();
    const fsel = TP.$('#mFactory'), pfIn = TP.$('#mPF');
    if (fsel && pfIn) fsel.onchange = () => { pfIn.disabled = !fsel.value; if (!fsel.value) pfIn.value = ''; };
    TP.$('#tp-modal').__mtype = () => type;
  }
  /** One line about the flight for the editor and the list. */
  function flightLine(m) {
    const fl = m.flight; if (!fl || !fl.no) return '';
    const t = FL().when(fl);
    const parts = [`✈ <b dir="ltr">${esc(fl.no)}</b>`, fl.dir === 'arr' ? 'استقبال' : fl.dir === 'dep' ? 'توصيل' : '',
      fl.airline ? esc(fl.airline) : '', fl.other ? (fl.dir === 'arr' ? 'جاية من ' : 'رايحة ') + esc(fl.other) : '',
      t ? (fl.dir === 'arr' ? 'الهبوط ' : 'الإقلاع ') + esc(TP.fmtDateTime(t)) : '', fl.terminal ? 'صالة ' + esc(fl.terminal) : '',
      fl.delayMin >= 10 ? `<span class="badge-s far">متأخرة ${fl.delayMin} د</span>` : '', fl.status ? esc(FL().statusName(fl.status)) : ''].filter(Boolean);
    let warn = '';
    if (fl.src === 'wait') warn = '<span class="badge-s nogps">بيانات الرحلة جاية خلال دقيقتين…</span>';
    if (fl.alert === 'retry') warn = '<span class="badge-s nogps">خدمة الرحلات مشغولة — هنحاول تاني بعد ربع ساعة</span>';
    if (fl.alert === 'notfound') warn = '<span class="badge-s far">الرحلة مش لاقيينها — اكتب الميعاد بإيدك</span>';
    if (fl.alert === 'nokey' || fl.alert === 'limit' || fl.alert === 'error') warn = '<span class="badge-s far">البحث الأوتوماتيك واقف — اكتب الميعاد بإيدك</span>';
    if (fl.status === 'Canceled' || fl.status === 'CanceledUncertain') warn = '<span class="badge-s far">الرحلة ممكن تكون اتلغت — اتأكد</span>';
    const radar = ` <a class="small" href="https://www.flightradar24.com/data/flights/${encodeURIComponent(fl.no.toLowerCase())}" target="_blank" rel="noopener">FlightRadar ↗</a>`;
    return parts.join(' · ') + (warn ? ' ' + warn : '') + radar;
  }
  TP.actions.flightLine = flightLine;

  async function save(mid, old) {
    const type = (TP.$('#tp-modal').__mtype || (() => ''))();
    const driverId = U.val('mDriver');
    let title = U.val('mTitle'), day = U.val('mDay'), time = U.val('mTime');
    if (!driverId) { TP.toast('اختار السواق'); return false; }
    const from = readPlace('from'), to = readPlace('to');
    if (from.error || to.error) { TP.toast(from.error || to.error); return false; }
    readCusts();
    const customers = [], fresh = {};
    for (const c of custs.filter(x => x.name || x.phone)) {
      if (!c.name) { TP.toast('اكتب اسم العميل'); return false; }
      if (c.phone && !TP.phoneIntl(c.phone)) { TP.toast(`موبايل ${c.name} مش مظبوط`); return false; }
      let h = c.h;
      if (!h) { const k = await TP.cust.newLink(); h = k.h; fresh[h] = k.token; }
      customers.push({ id: c.id || TP.newId('C'), h, name: c.name.slice(0, 60), phone: c.phone || '' });
    }
    const cashAmt = U.money('mCash');
    if (Number.isNaN(cashAmt)) { TP.toast('مبلغ الكاش لازم يكون رقم'); return false; }
    let flight = null, flightCheckAt = null, driveMin = null;
    if (type === 'airport') {
      const no = FL().norm(U.val('fNo')), fdate = U.val('fDate'), dirSel = U.val('fDir'), ftime = U.val('fTime'), term = U.val('fTerm');
      if (!FL().valid(no)) { TP.toast('اكتب رقم الرحلة صح (مثال MS777)'); return false; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fdate)) { TP.toast('اختار تاريخ الطيارة'); return false; }
      if (!dirSel && ftime) { TP.toast('لو كتبت الميعاد بإيدك اختار استقبال ولا توصيل'); return false; }
      driveMin = Math.round(TP.num(U.val('fDrive')) || Number(D.settings.airportDriveMin) || 75);
      if (!(driveMin >= 15 && driveMin <= 300)) { TP.toast('مدة الطريق من 15 لـ 300 دقيقة'); return false; }
      const prev = old && old.flight || {};
      const same = prev.no === no && prev.date === fdate;
      flight = same ? Object.assign({}, prev) : { no, date: fdate };
      flight.no = no; flight.date = fdate;
      if (dirSel) { flight.dir = dirSel; flight.dirSet = true; } else delete flight.dirSet;
      if (term) { flight.terminal = term; flight.terminalSet = true; } else if (flight.terminalSet) { delete flight.terminalSet; flight.terminal = ''; }
      if (ftime) {
        flight.sched = O.cairoMs(fdate, ftime); flight.est = null; flight.src = 'manual'; flight.delayMin = 0; delete flight.alert; flight.done = [];
        flightCheckAt = FL().schedule(flight, TP.now());
      } else if (!same || !flight.sched || flight.src === 'manual') {
        ['sched', 'est', 'status', 'airport', 'airportName', 'other', 'airline', 'delayMin', 'alert', 'gate', 'belt'].forEach(k => { delete flight[k]; });
        if (!flight.terminalSet) flight.terminal = '';
        flight.src = 'wait'; flight.done = []; flight.nextK = 0; flightCheckAt = 1;                                        // the cloud alarm looks it up within a minute
      } else flightCheckAt = old.flightCheckAt || FL().schedule(flight, TP.now());
      const job = FL().jobAt(flight, D.settings, driveMin);
      if (job) { day = TP.dayKey(job); time = O.hm(job); }
      else { day = fdate; time = ''; }
      if (!title || (old && old.type === 'airport' && old.title === autoTitle(old.flight))) title = autoTitle(flight);
    } else {
      if (!title) { TP.toast('اكتب وصف المشوار'); return false; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { TP.toast('اختار اليوم'); return false; }
    }
    const id = mid || TP.newId('M');
    const data = { title, day, month: O.monthOf(day), time, factoryId: U.val('mFactory'), client: U.val('mFactory') ? '' : U.val('mClient'), driverId, from, to,
      customers, notes: U.val('mNotes'), type, updatedAt: TP.fb.ts() };
    if (cashAmt) data.cash = { amount: cashAmt, note: U.val('mCashNote') };
    else if (mid && old.cash) data.cash = TP.fb.del();
    if (type === 'airport') Object.assign(data, { flight, flightCheckAt, driveMin });
    else if (mid && old.flight) Object.assign(data, { flight: TP.fb.del(), flightCheckAt: TP.fb.del() });
    if (mid && ['done', 'active'].includes(old.status)) Object.assign(data, TP.lockFix(old.day < day ? old.day : day, 'تعديل المشوار بعد التصدير'));
    const ops = [];
    if (mid) ops.push({ op: 'update', path: 'missions/' + id, data });
    else ops.push({ op: 'set', path: 'missions/' + id, data: Object.assign(data, { status: 'assigned', events: {}, createdAt: TP.fb.ts(), createdBy: S.person.name }) });
    ops.push(...trackOps(id, Object.assign({}, data, { flight }), mid ? old : null, fresh));
    let note = '';
    if (S.can('prices.edit') && money()) {
      const p = priceOps(id, data);
      if (p.error) { TP.toast(p.error); return false; }
      ops.push(...p.ops);   // the price fields come pre-filled, so a new driver / month / factory re-saves them
      if (mid && !data.factoryId && live.pf[mid]) ops.push({ op: 'delete', path: 'missionFactory/' + id });
      if (p.ops.length && TP.needsPin(S.perms) && !(await S.confirmPin('تأكيد سعر المشوار'))) return false;
    } else if (mid && (old.driverId !== data.driverId || old.month !== data.month || old.factoryId !== data.factoryId)) {
      // the old prices belonged to the old driver / month / factory: remove them so they get set again
      ops.push({ op: 'delete', path: 'missionDriver/' + id }, { op: 'delete', path: 'missionFactory/' + id });
      if (money()) note = ' — السعر محتاج يتحط تاني';
    }
    await TP.fb.batch(ops);
    TP.wakeTouch && TP.wakeTouch([day, old && old.day]);
    TP.audit(mid ? 'mission.update' : 'mission.create', title, `${day} — ${(TP.q.person(driverId) || {}).name || ''}${type === 'airport' ? ' — ✈ ' + flight.no : ''}`);
    TP.toast('تم الحفظ ✓' + note + (type === 'airport' && flight.src === 'wait' ? ' — بيانات الرحلة جاية خلال دقيقتين' : ''));
    if (onSavedHook) { const h = onSavedHook; onSavedHook = null; h(id); }
  }
  const autoTitle = fl => fl ? `${fl.dir === 'dep' ? 'توصيل للمطار' : fl.dir === 'arr' ? 'استقبال من المطار' : 'مطار'} — ${fl.no}` : '';

  function openPrice(mid) {
    const m = find(mid); if (!m) return;
    TP.openModal('سعر المشوار — ' + (m.title || ''), `<div class="form-grid">${priceFields(m, live.pd[mid], live.pf[mid])}</div>`, async () => {
      const p = priceOps(mid, m);
      if (p.error) { TP.toast(p.error); return false; }
      if (!p.ops.length) { TP.toast('مفيش تغيير في السعر'); return false; }
      if (!(await S.confirmPin('تأكيد سعر المشوار'))) return false;
      await TP.fb.batch(p.ops);
      TP.audit('mission.price', m.title, `${p.pf !== null ? 'المصنع ' + p.pf : ''} ${p.pd !== null ? 'السواق ' + p.pd : ''}`);
      TP.toast('تم حفظ السعر ✓');
    }, { saveLabel: 'حفظ السعر' });
  }
  async function openLinks(mid) {
    const m = find(mid); if (!m) return;
    const tok = await TP.cust.tokens(m.customers);
    const list = (m.customers || []).filter(c => tok[c.h]).map(c => Object.assign({}, c, { token: tok[c.h] }));
    TP.openModal('لينكات العملاء — ' + (m.title || ''), list.length ? `<p class="muted small" style="margin-bottom:10px">لينك للمشوار ده بس، بيوري رحلة العميل من غير أسعار.</p><div class="table-wrap"><table class="tbl"><tbody>${list.map(c => {
      const wa = TP.waLink(c.phone, TP.actions.custMessage(c.name, c.token, m.type === 'airport' ? 'رحلتك للمطار' : 'مشوارك'));
      return `<tr><td><b>${esc(c.name)}</b><div class="muted small" dir="ltr">${esc(c.phone || '')}</div></td><td class="acts"><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(TP.custUrl(c.token))}">${TP.icon('copy', 16)}انسخ</button>${wa ? `<a class="btn btn-primary btn-sm" href="${esc(wa)}" target="_blank" rel="noopener">واتساب</a>` : ''}<a class="icon-btn" href="${esc(TP.custUrl(c.token))}" target="_blank" rel="noopener">${TP.icon('external', 16)}</a></td></tr>`;
    }).join('')}</tbody></table></div>` : U.empty('المشوار ده مفيهوش عملاء — ضيفهم من التعديل'), null, { noSave: true, wide: true });
    TP.$$('#tp-modal [data-copy]').forEach(b => b.onclick = () => TP.actions.copy(b.dataset.copy));
  }

  async function cancel(mid) {
    const m = find(mid);
    if (!m || !(await TP.confirm('إلغاء المشوار', `المشوار "${m.title}" هيتلغي ويختفي من عند السواق، ولينك العميل هيقوله إنه اتلغى.`, 'إلغاء المشوار', true))) return;
    await TP.fb.batch([{ op: 'update', path: 'missions/' + mid, data: Object.assign({ status: 'cancelled', flightCheckAt: FL().NEVER, updatedAt: TP.fb.ts() }, ['done', 'active'].includes(m.status) ? TP.lockFix(m.day, 'إلغاء مشوار بعد التصدير') : {}) }]
      .concat((m.customers || []).filter(c => c.h).map(c => ({ op: 'set', path: 'track/' + c.h, data: { st: 'cancelled', stAt: TP.now() }, merge: true }))));
    TP.audit('mission.cancel', m.title, m.day);
    TP.wakeTouch && TP.wakeTouch(m.day);
  }
  async function remove(mid) {
    const m = find(mid);
    if (!m) return;
    // an exported trip is never deleted (the accounts already have it) — cancel it instead
    if (TP.isLocked(m.day) && ['done', 'active'].includes(m.status)) return TP.toast('المشوار ده اتصدّر للحسابات — الغيه بدل ما تحذفه', 'warn');
    if (!(await TP.confirm('حذف المشوار', `"${m.title}" هيتحذف نهائياً هو وأسعاره ولينكات عملائه.`, 'حذف', true))) return;
    await TP.fb.batch([{ op: 'delete', path: 'missions/' + mid }, { op: 'delete', path: 'missionDriver/' + mid }, { op: 'delete', path: 'missionFactory/' + mid }]
      .concat(...(m.customers || []).filter(c => c.h).map(c => TP.cust.dropOps(c.h))));
    TP.audit('mission.delete', m.title, m.day);
    TP.wakeTouch && TP.wakeTouch(m.day);
  }

  /** Opened from a factory request: a new trip with the request's details. */
  TP.actions.openMission = function (prefill, onSaved) {
    const day = prefill.day || TP.dayKey();
    state.month = O.monthOf(day); watch(state.month);
    openEditor(null, prefill, onSaved);
  };

  TP.views.missions = {
    deps: null,
    leave() { live.unsubs.forEach(u => u()); live = { month: null, unsubs: [], list: [], pd: {}, pf: {} }; },
    render(root) {
      const M = O.monthOf(TP.dayKey());
      if (!state.month) state.month = M;
      watch(state.month);
      const canEdit = S.can('missions.manage'), canPrice = S.can('prices.edit') && money(), seePrice = S.can('prices.view') && money();
      const q = U.norm(U.filters.missions || ''), today = TP.dayKey();
      let list = live.list.slice().sort((a, b) => (a.day + (a.time || '')).localeCompare(b.day + (b.time || '')));
      if (state.type) list = list.filter(m => (m.type || '') === (state.type === 'airport' ? 'airport' : ''));
      if (state.filter === 'open') list = list.filter(m => m.status === 'assigned' || m.status === 'active');
      else if (state.filter === 'done') list = list.filter(m => m.status === 'done');
      else if (state.filter === 'unpriced') list = list.filter(m => m.status !== 'cancelled' && (!live.pd[m.id] || (m.factoryId && !live.pf[m.id])));
      if (q) list = list.filter(m => U.norm(m.title).includes(q) || U.norm(TP.q.dname(m.driverId)).includes(q) || U.norm((TP.q.company(m.factoryId) || {}).name || m.client).includes(q) || U.norm((m.flight && m.flight.no) || '').includes(q) || (m.customers || []).some(c => U.norm(c.name).includes(q)));
      const months = [O.addMonths(M, -1), M, O.addMonths(M, 1)];
      const filters = [['open', 'المفتوحة'], ['done', 'اللي خلصت'], ['all', 'الكل']].concat(seePrice ? [['unpriced', 'من غير سعر']] : []);
      const usage = D.flightUsage && D.flightUsage.month === M ? D.flightUsage.calls || 0 : 0, limit = Number(D.settings.flightMonthlyLimit) || 190;
      root.innerHTML = `<section class="card">
        <div class="toolbar">
          <div class="chips">${months.map(m => `<button class="chip ${state.month === m ? 'active' : ''}" data-month="${m}">${esc(O.monthName(m))}</button>`).join('')}</div>
          <div class="toolbar-end">${U.filterBox('missionsQ', 'بحث بالوصف أو السواق أو رقم الرحلة', U.filters.missions)}${canEdit ? `<button class="btn btn-primary" id="addM">${TP.icon('plus', 18)}مشوار جديد</button>` : ''}</div>
        </div>
        <div class="chips" style="margin-bottom:12px">${[['', 'الكل'], ['regular', 'مشاوير'], ['airport', '✈ مطار']].map(([k, l]) => `<button class="chip ${state.type === k ? 'active' : ''}" data-type="${k}">${l}</button>`).join('')}<span style="width:12px"></span>${filters.map(([k, l]) => `<button class="chip ${state.filter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
        ${state.type === 'airport' ? `<p class="muted small" style="margin-bottom:10px">${TP.icon('plane', 15)} البحث الأوتوماتيك عن الرحلات الشهر ده: ${usage} من ${limit}. بعد كده الميعاد بيتكتب باليد.</p>` : ''}
        ${list.length ? `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>الميعاد</th><th>المشوار</th><th>السواق</th><th>من → إلى</th><th>الحالة</th>${seePrice ? '<th>سعر المصنع</th><th>أجر السواق</th>' : ''}<th></th></tr></thead>
          <tbody>${list.map(m => {
            const p = TP.q.person(m.driverId), f = TP.q.company(m.factoryId), s = O.MISSION_STATUS[m.status] || ['', 'st-off'], ev = m.events || {};
            const steps = O.missionSteps(m).filter(x => ev[x.key]).map(x => `${x.short} ${O.hm(ev[x.key].at)}${ev[x.key].far ? ' ⚠' : ''}`).join(' · ');
            const cs = m.customers || [];
            return `<tr>
              <td class="small"><bdi dir="ltr">${esc(m.day)}</bdi>${m.time ? `<br>${esc(O.hm12(m.time))}` : (m.type === 'airport' ? '<br><span class="badge-s nogps">مستني الرحلة</span>' : '')}${m.day === today ? ' <span class="tag gold">النهارده</span>' : ''}</td>
              <td><b>${m.type === 'airport' ? '✈ ' : ''}${esc(m.title)}</b><div class="muted small">${esc(f ? f.name : m.client || '')}${cs.length ? ' · ' + cs.length + ' عميل' : ''}${m.cash ? ` · <span class="tag gold">كاش ${esc(TP.money(m.cash.amount))}${m.cashGot ? ' ✓' : ''}</span>` : ''}</div>${m.flight ? `<div class="small">${flightLine(m)}</div>` : ''}</td>
              <td>${esc(TP.driverLabel(p))}${p && p.driverKind === 'tourism' ? '<div class="muted small">سياحة</div>' : ''}${m.subFrom ? `<div><span class="badge-s far">بديل عن ${esc(TP.q.dname(m.subFrom))}${seePrice ? ' — راجع السعر' : ''}</span></div>` : ''}</td>
              <td class="small">${esc((m.from && m.from.name) || '—')} ← ${esc((m.to && m.to.name) || '—')}</td>
              <td><span class="st ${s[1]}">${s[0]}</span>${steps ? `<div class="muted small">${esc(steps)}</div>` : ''}</td>
              ${seePrice ? `<td class="num">${m.factoryId ? (live.pf[m.id] ? esc(TP.money(live.pf[m.id].amount)) : '<span class="st st-warn">لسه</span>') : '—'}</td><td class="num">${live.pd[m.id] ? esc(TP.money(live.pd[m.id].amount)) : '<span class="st st-warn">لسه</span>'}</td>` : ''}
              <td class="acts">${cs.length ? `<button class="icon-btn" title="لينكات العملاء" data-links="${esc(m.id)}">${TP.icon('external', 16)}</button>` : ''}
                ${canEdit ? `<button class="icon-btn" title="تعديل" data-edit="${esc(m.id)}">${TP.icon('edit', 16)}</button>` : ''}
                ${canPrice && m.status !== 'cancelled' ? `<button class="icon-btn" title="السعر" data-price="${esc(m.id)}">${TP.icon('money', 16)}</button>` : ''}
                ${canEdit && m.status !== 'done' && m.status !== 'cancelled' ? `<button class="icon-btn" title="إلغاء" data-cancel="${esc(m.id)}">${TP.icon('x', 16)}</button>` : ''}
                ${canEdit ? `<button class="icon-btn danger" title="حذف" data-del="${esc(m.id)}">${TP.icon('trash', 16)}</button>` : ''}</td></tr>`;
          }).join('')}</tbody></table></div>` : U.empty('مفيش مشاوير هنا')}
      </section>`;
      U.bindFilter(root, 'missionsQ', 'missions');
      const guard = fn => id => fn(id).catch(e => TP.toast(TP.errorText(e), 'warn'));
      root.querySelectorAll('[data-month]').forEach(b => b.onclick = () => { state.month = b.dataset.month; TP.rerender(); });
      root.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { state.filter = b.dataset.filter; TP.rerender(); });
      root.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { state.type = b.dataset.type; TP.rerender(); });
      const add = root.querySelector('#addM'); if (add) add.onclick = () => openEditor(null, state.type === 'airport' ? { type: 'airport' } : null);
      root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
      root.querySelectorAll('[data-links]').forEach(b => b.onclick = () => openLinks(b.dataset.links).catch(e => TP.toast(TP.errorText(e), 'warn')));
      root.querySelectorAll('[data-price]').forEach(b => b.onclick = () => openPrice(b.dataset.price));
      root.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => guard(cancel)(b.dataset.cancel));
      root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => guard(remove)(b.dataset.del));
    }
  };
})(window.TP = window.TP || {});
