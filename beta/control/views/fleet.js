/* ==========================================================================
   أمر الشغل والعربيات — the program the tourism drivers used (now inside):
     العربيات  : each car's custody, fuel card, odometer, maintenance, papers,
                 its WhatsApp group, the driver's request for custody
     المشاوير  : the trips the drivers recorded (Excel / PDF)
     العهدة / البنزين : top-ups and fill-ups, month by month
     المرتبات  : base + extras − deductions of the tourism drivers (PIN)
     الصيانة   : what is due by kilometres, and the plan's numbers
     نقل القديم: brings the old program's balances (GM only)
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui, O = TP.ops;
  const FL = () => TP.fleet;
  const state = { tab: 'cars', month: '', vid: '' };
  let live = { month: null, unsub: null, logs: {} }, sal = { month: null, unsub: null, docs: {} };
  const money = n => TP.money(Math.round((Number(n) || 0) * 100) / 100);
  const today = () => TP.dayKey(TP.now());
  const low = () => Number(D.settings.custodyLow) || 100, fuelLow = () => Number(D.settings.fuelLow) || 1000;

  function watchLogs(month) {
    if (live.month === month) return;
    if (live.unsub) live.unsub();
    live = { month, unsub: null, logs: {} };
    live.unsub = TP.data.watch('fleetLog', { where: [['month', '==', month]] }, l => { if (live.month !== month) return; live.logs = {}; l.forEach(x => { live.logs[x.vehicleId] = x; }); TP.rerender(); });
  }
  function watchSalary(month) {
    if (!S.can('salary.manage') || sal.month === month) return;
    if (sal.unsub) sal.unsub();
    sal = { month, unsub: null, docs: {} };
    sal.unsub = TP.data.watch('salary', { where: [['month', '==', month]] }, l => { if (sal.month !== month) return; sal.docs = {}; l.forEach(x => { sal.docs[x.driverId] = x; }); TP.rerender(); });
  }

  /* ---------- lookups ---------- */
  const cars = () => D.fleet.slice().sort((a, b) => String((TP.q.vehicle(a.id) || {}).plate || '').localeCompare(String((TP.q.vehicle(b.id) || {}).plate || '')));
  const vehicleOf = vid => TP.q.vehicle(vid) || {};
  const carName = vid => { const v = vehicleOf(vid); return [v.model, v.plate].filter(Boolean).join(' — ') || vid; };
  const driverOf = vid => D.people.find(p => p.type === 'driver' && p.vehicleId === vid && p.active !== false) || null;
  const entries = (k, vid) => Object.values(live.logs).filter(l => !vid || l.vehicleId === vid).flatMap(l => Object.entries(l[k] || {}).map(([id, e]) => Object.assign({ id, vid: l.vehicleId }, e)))
    .sort((a, b) => (a.day + (a.time || '') + (a.at || 0)).localeCompare(b.day + (b.time || '') + (b.at || 0)));
  const who = id => { const p = TP.q.person(id); return p ? p.name : ''; };
  const plan = () => FL().plan(D.settings);
  const maintOf = car => FL().status(car, plan(), today());

  /* ---------- car setup ---------- */
  function setup(vid) {
    const car = vid ? D.fleet.find(c => c.id === vid) : { on: true, model: '', custody: 0, fuel: 0, odo: 0 };
    if (!car) return;
    const free = D.vehicles.filter(v => v.active !== false && !D.fleet.some(c => c.id === v.id));
    if (!vid && !free.length) return TP.toast('كل العربيات اللي في الخدمة عليها أمر الشغل — ضيف العربية الأول من صفحة العربيات', 'warn');
    TP.openModal(vid ? 'إعداد ' + carName(vid) : 'تشغيل أمر الشغل لعربية', `<div class="form-grid">
      ${vid ? '' : `<label class="fld full">العربية<select class="input" id="fcV">${U.opts(free, '', v => v.id, v => `${v.plate} — ${v.model || ''}`, 'اختار العربية')}</select></label>`}
      <label class="fld">جدول الصيانة<select class="input" id="fcModel"><option value="">من غير جدول صيانة</option>${FL().MODELS.map(m => `<option value="${m.id}" ${car.model === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <label class="fld">العداد دلوقتي (كم)<input class="input" id="fcOdo" inputmode="numeric" dir="ltr" value="${esc(car.odo || '')}"></label>
      <label class="fld full">لينك جروب الواتساب بتاع العربية <small>بيظهر للسواق بتاعها بس</small><input class="input" id="fcGroup" dir="ltr" placeholder="https://chat.whatsapp.com/..." value="${esc(car.group || '')}"></label>
      ${vid ? '' : `<label class="fld">رصيد العهدة اللي معاه (جنيه)<input class="input" id="fcCust" inputmode="decimal" dir="ltr" value="0"></label>
      <label class="fld">رصيد فيزا البنزين (جنيه)<input class="input" id="fcFuel" inputmode="decimal" dir="ltr" value="0"></label>`}
      <label class="check full"><input type="checkbox" id="fcOn" ${car.on !== false ? 'checked' : ''}><span>أمر الشغل شغال للعربية دي<small>السواق اللي عليها بيشوف "عربيتي" في التطبيق. السواق بيتربط بالعربية من صفحة السواقين (العربية المعتادة).</small></span></label>
    </div>`, async () => {
      const id = vid || U.val('fcV');
      if (!id) { TP.toast('اختار العربية'); return false; }
      const group = U.val('fcGroup');
      if (group && !/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/.test(group)) { TP.toast('لينك الجروب لازم يبدأ بـ https://chat.whatsapp.com/'); return false; }
      const odo = Math.round(TP.num(U.val('fcOdo') || 0));
      if (!(odo >= 0)) { TP.toast('العداد مش مظبوط'); return false; }
      const data = { vehicleId: id, on: U.checked('fcOn'), model: U.val('fcModel'), group, updatedAt: TP.fb.ts() };
      if (!vid || odo !== (Number(car.odo) || 0)) Object.assign(data, { odo, odoDay: today() });
      if (!vid) {
        const c = U.money('fcCust'), f = U.money('fcFuel');
        if (Number.isNaN(c) || Number.isNaN(f)) { TP.toast('الرصيد مش مظبوط'); return false; }
        Object.assign(data, { custody: c || 0, fuel: f || 0, maint: {}, createdAt: TP.fb.ts() });
      }
      await TP.fb.set('fleet/' + id, data, true);
      TP.audit(vid ? 'fleet.update' : 'fleet.create', carName(id), data.on ? 'شغال' : 'متوقف');
      TP.toast('تم الحفظ ✓');
    }, { saveLabel: vid ? 'حفظ' : 'تشغيل' });
  }

  /* ---------- custody & fuel: management's side ---------- */
  function money2(vid, what) {
    const car = D.fleet.find(c => c.id === vid); if (!car) return;
    const cust = what === 'custody', bal = Number(car[what]) || 0;
    TP.openModal((cust ? 'عهدة المصروفات — ' : 'فيزا البنزين — ') + carName(vid), `
      <p class="modal-text" style="margin-bottom:10px">الرصيد دلوقتي: <b>${esc(money(bal))}</b>${cust && car.req ? ` · <span class="st st-warn">السواق طالب عهدة من ${esc(TP.ago(car.req.at))}</span>` : ''}</p>
      <div class="opt-list" style="grid-template-columns:1fr 1fr"><button type="button" class="opt on" data-mk="${cust ? 'topup' : 'charge'}">${cust ? 'تسليم عهدة (إضافة)' : 'شحن الفيزا (إضافة)'}</button><button type="button" class="opt" data-mk="set">تحديد الرصيد</button></div>
      <label class="fld" style="margin-top:10px">المبلغ (جنيه)<input class="input" id="mAmt" inputmode="decimal" dir="ltr"></label>
      <label class="fld" style="margin-top:10px">ملاحظة<input class="input" id="mNote" maxlength="120"></label>`, async () => {
      const amt = U.money('mAmt'), kind = TP.$('#tp-modal [data-mk].on').dataset.mk;
      if (!(amt > 0) && !(kind === 'set' && amt === 0)) { TP.toast('اكتب المبلغ'); return false; }
      const day = today(), month = O.monthOf(day), id = TP.newId('C'), k = cust ? 'cash' : 'fuel';
      const entry = { day, kind, amount: amt, note: U.val('mNote').slice(0, 120), by: S.person.id, byName: S.person.name, at: TP.now(), sv: TP.fb.ts(), before: bal };
      const carPatch = { [what]: kind === 'set' ? amt : TP.fb.inc(amt), updatedAt: TP.fb.ts() };
      if (cust) carPatch.req = TP.fb.del();
      await TP.fb.batch([
        { op: 'set', path: `fleetLog/${vid}_${month}`, data: { vehicleId: vid, month, [k]: { [id]: entry }, updatedAt: TP.fb.ts() }, merge: true },
        { op: 'update', path: 'fleet/' + vid, data: carPatch }
      ]);
      TP.audit(cust ? 'fleet.custody' : 'fleet.fuel', carName(vid), `${kind === 'set' ? 'تحديد' : 'إضافة'} ${amt}`);
      TP.toast('تم ✓');
    }, { saveLabel: 'تم' });
    TP.$$('#tp-modal [data-mk]').forEach(b => b.onclick = () => TP.$$('#tp-modal [data-mk]').forEach(x => x.classList.toggle('on', x === b)));
  }

  /* ---------- the car's schedule to its WhatsApp group (like the old manager screen) ---------- */
  async function schedule(vid) {
    const car = D.fleet.find(c => c.id === vid), drv = driverOf(vid);
    if (!drv) return TP.toast('مفيش سواق على العربية دي — اربطه من صفحة السواقين', 'warn');
    const t = today(), tm = O.addDays(t, 1);
    TP.openModal('جدول المشاوير لجروب ' + carName(vid), '<div class="spinner"></div>', null, { noSave: true, wide: true });
    const list = (await TP.fb.list('missions', { where: [['driverId', '==', drv.id], ['day', 'in', [t, tm]]] }).catch(() => []))
      .filter(m => m.status === 'assigned' || m.status === 'active').sort((a, b) => (a.day + (a.time || '')).localeCompare(b.day + (b.time || '')));
    const items = list.map(m => {
      const f = TP.q.company(m.factoryId), air = m.type === 'airport' && m.flight;
      return { id: m.id, when: m.day === t ? 'النهاردة' : 'بكرة', time: m.time || '', type: air ? (m.flight.dir === 'dep' ? 'سفر' : 'استقبال مطار') : 'مشوار', from: (m.from && m.from.name) || '', to: (m.to && m.to.name) || '',
        flight: air && m.flight.dir === 'arr' ? m.flight.no : '', terminal: air ? (m.flight.terminal || '') : '', client: (m.customers || []).map(c => c.name).join('، '), phone: (m.customers || []).map(c => c.phone).filter(Boolean).join(' / '),
        factory: f ? f.name : (m.client || ''), notes: m.notes || '' };
    });
    const body = items.length ? `<p class="modal-text">${items.length} مشوار لـ ${esc(drv.name)} (النهارده وبكره). علّم على اللي يتبعت:</p>
      <div class="opt-list">${items.map((x, i) => `<label class="check"><input type="checkbox" data-si="${i}" checked><span>${esc(x.when)} ${esc(O.hm12(x.time) || '')} — ${esc(x.type)}: ${esc(x.from)} ← ${esc(x.to)}${x.client ? ' · ' + esc(x.client) : ''}</span></label>`).join('')}</div>
      <p class="muted small" style="margin-top:8px">${car && car.group ? 'هيتنسخ الجدول ويفتح جروب العربية — دوس لصق وابعت.' : 'جروب العربية لسه متحطش — الجدول هيتنسخ بس.'}</p>`
      : `<div class="empty">مفيش مشاوير على ${esc(drv.name)} النهارده أو بكره. اعمل المشوار الأول من "المشاوير والمطار".</div>`;
    TP.openModal('جدول المشاوير لجروب ' + carName(vid), body, items.length ? async () => {
      const pick = items.filter((_, i) => { const el = TP.$(`#tp-modal [data-si="${i}"]`); return el && el.checked; });
      if (!pick.length) { TP.toast('علّم على مشوار واحد على الأقل'); return false; }
      const msg = FL().scheduleMessage(carName(vid), pick);
      try { await navigator.clipboard.writeText(msg); } catch (e) { /* the text is shown below if copying is blocked */ }
      if (car && car.group) window.open(car.group, '_blank');
      TP.toast('الجدول اتنسخ ✓');
      TP.audit('fleet.schedule', carName(vid), pick.length + ' مشوار');
    } : null, { noSave: !items.length, saveLabel: 'انسخ وافتح الجروب', wide: true });
  }

  /* ---------- trips: management may remove a wrong one (its expense goes back to the custody) ---------- */
  async function removeTrip(vid, id) {
    const t = entries('trips', vid).find(x => x.id === id); if (!t) return;
    if (!(await TP.confirm('حذف المشوار', `"${t.task}" (${t.day}) هيتحذف، ومصروفه (${money(t.expense)}) هيرجع لعهدة العربية.`, 'حذف', true))) return;
    await TP.fb.batch([{ op: 'update', path: `fleetLog/${vid}_${live.month}`, data: { ['trips.' + id]: TP.fb.del(), updatedAt: TP.fb.ts() } }, { op: 'update', path: 'fleet/' + vid, data: { custody: TP.fb.inc(Number(t.expense) || 0), updatedAt: TP.fb.ts() } }]);
    TP.audit('fleet.trip.delete', carName(vid), `${t.day} — ${t.task} — ${t.expense}`);
    TP.toast('اتحذف ✓');
  }

  /* ---------- salary (tourism drivers): PIN for every change ---------- */
  const salaryDrivers = () => D.people.filter(p => p.type === 'driver' && p.active !== false && (p.driverKind === 'tourism' || D.fleet.some(c => c.id === p.vehicleId) || D.salaryBase[p.id] || sal.docs[p.id]))
    .sort((a, b) => (Number(a.code) || 9e9) - (Number(b.code) || 9e9));
  const salOf = pid => { const d = sal.docs[pid], base = d ? d.base : (D.salaryBase[pid] || {}).base; return FL().salaryNet(Object.assign({}, d || {}, { base: base || 0 })); };
  async function pin(title) { return !TP.needsPin(S.perms) || S.confirmPin(title); }
  function salaryEdit(pid, kind) {
    const p = TP.q.person(pid), month = sal.month;
    const title = { base: 'المرتب الأساسي', extra: 'إضافي / سهرة', ded: 'خصم' }[kind] + ' — ' + TP.driverLabel(p);
    const curBase = (sal.docs[pid] || {}).base ?? (D.salaryBase[pid] || {}).base ?? '';
    TP.openModal(title, kind === 'base'
      ? `<label class="fld">المرتب الأساسي (جنيه)<input class="input" id="sAmt" inputmode="decimal" dir="ltr" value="${esc(curBase)}"></label><p class="muted small" style="margin-top:8px">بيتسجل لشهر ${esc(O.monthName(month))} والشهور الجاية.</p>`
      : `<label class="fld">المبلغ (جنيه)<input class="input" id="sAmt" inputmode="decimal" dir="ltr"></label>
         <label class="fld" style="margin-top:10px">${kind === 'extra' ? 'البيان (مثال: سهرة 14/10)' : 'سبب الخصم'}<input class="input" id="sNote" maxlength="120"></label>
         <label class="fld" style="margin-top:10px">التاريخ<input class="input" type="date" id="sDay" value="${esc(month === O.monthOf(today()) ? today() : month + '-01')}"></label>`, async () => {
      const amt = U.money('sAmt');
      if (!(amt >= 0) || (kind !== 'base' && !(amt > 0))) { TP.toast('اكتب المبلغ'); return false; }
      if (kind !== 'base' && !U.val('sNote')) { TP.toast(kind === 'extra' ? 'اكتب البيان' : 'اكتب السبب'); return false; }
      const day = kind === 'base' ? '' : U.val('sDay');
      if (kind !== 'base' && O.monthOf(day || '') !== month) { TP.toast('التاريخ لازم يكون في شهر ' + O.monthName(month)); return false; }
      if (!(await pin('تأكيد تعديل المرتب'))) return false;
      const path = `salary/${pid}_${month}`, doc = sal.docs[pid];
      const ops = [];
      if (kind === 'base') {
        ops.push({ op: 'set', path: 'salaryBase/' + pid, data: { base: amt, updatedAt: TP.fb.ts(), by: S.person.name } });
        ops.push({ op: 'set', path, data: { driverId: pid, month, base: amt, updatedAt: TP.fb.ts() }, merge: true });
      } else {
        const id = TP.newId(kind === 'extra' ? 'E' : 'X');
        ops.push({ op: 'set', path, data: Object.assign({ driverId: pid, month, updatedAt: TP.fb.ts(), [kind]: { [id]: { amount: amt, note: U.val('sNote').slice(0, 120), day, by: S.person.name, at: TP.now() } } }, doc ? {} : { base: Number(curBase) || 0 }), merge: true });
      }
      await TP.fb.batch(ops);
      TP.audit('salary.' + kind, p ? p.name : pid, `${amt} ${month}`);
      TP.toast('تم ✓');
    }, { saveLabel: 'حفظ' });
  }
  function salaryDetails(pid) {
    const d = sal.docs[pid] || {}, p = TP.q.person(pid), n = salOf(pid);
    const rows = [['extra', 'إضافي'], ['ded', 'خصم']].flatMap(([k, l]) => Object.entries(d[k] || {}).map(([id, x]) => ({ k, l, id, x }))).sort((a, b) => String(a.x.day).localeCompare(String(b.x.day)));
    TP.openModal(`مرتب ${TP.driverLabel(p)} — ${O.monthName(sal.month)}`, `<table class="stmt"><tbody><tr><td>الأساسي</td><td>${esc(money(n.base))}</td></tr>
      ${rows.map(r => `<tr><td>${esc(r.l)}: ${esc(r.x.note || '')} <span class="muted small">${esc(r.x.day || '')} · ${esc(r.x.by || '')}</span> <button type="button" class="link" data-sdel="${esc(r.k)}|${esc(r.id)}">حذف</button></td><td>${r.k === 'ded' ? '−' : '+'}${esc(money(r.x.amount))}</td></tr>`).join('')}
      <tr class="total"><td>الصافي</td><td>${esc(money(n.net))}</td></tr></tbody></table>`, null, { noSave: true, wide: true });
    TP.$$('#tp-modal [data-sdel]').forEach(b => b.onclick = async () => {
      const [k, id] = b.dataset.sdel.split('|');
      if (!(await TP.confirm('حذف البند', 'البند ده هيتشال من المرتب.', 'حذف', true)) || !(await pin('تأكيد تعديل المرتب'))) return;
      await TP.fb.update(`salary/${pid}_${sal.month}`, { [`${k}.${id}`]: TP.fb.del(), updatedAt: TP.fb.ts() });
      TP.audit('salary.delete', p ? p.name : pid, `${k} ${(d[k][id] || {}).amount}`);
      TP.closeModal();
    });
  }

  /* ---------- maintenance ---------- */
  function partDone(vid, k) {
    const car = D.fleet.find(c => c.id === vid), part = plan().find(p => p.k === k);
    if (!car || !part) return;
    TP.openModal(`${part.n} — ${carName(vid)}`, `<p class="modal-text" style="margin-bottom:10px">سجّل آخر مرة اتغيرت فيها. الميعاد الجاي بيتحسب لوحده.</p>
      <div class="form-grid">${part.yearly ? '' : `<label class="fld">العداد وقت التغيير (كم)<input class="input" id="pOdo" inputmode="numeric" dir="ltr" value="${esc(car.odo || '')}"></label>`}
      <label class="fld">التاريخ<input class="input" type="date" id="pDay" value="${esc(today())}"></label></div>
      ${k === 'oil' ? `<p class="muted small" style="margin-top:8px">مع تغيير الزيت: ${FL().CHECKS.map(esc).join(' · ')}.</p>` : ''}`, async () => {
      const odo = part.yearly ? null : Math.round(TP.num(U.val('pOdo')));
      const day = U.val('pDay');
      if (!part.yearly && !(odo >= 0)) { TP.toast('اكتب العداد'); return false; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { TP.toast('اختار التاريخ'); return false; }
      const v = { day, by: S.person.name, at: TP.now() }; if (odo !== null) v.odo = odo;
      await TP.fb.update('fleet/' + vid, { ['maint.' + k]: v, updatedAt: TP.fb.ts() });
      TP.audit('fleet.maint', carName(vid), `${part.n} ${odo !== null ? odo + ' كم' : ''} ${day}`);
      TP.toast('اتسجل ✓');
    }, { saveLabel: 'سجّل' });
  }
  function editPlan() {
    if (!S.can('settings.edit')) return TP.toast('تعديل الجدول محتاج صلاحية الإعدادات', 'warn');
    const P = plan();
    TP.openModal('جدول الصيانة (كيلومترات)', `<p class="muted small" style="margin-bottom:8px">التغيير الجاي = عداد آخر تغيير + كيلومترات القطعة. سيب الخانة فاضية لو القطعة مش للموديل ده.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>القطعة</th>${FL().MODELS.map(m => `<th>${esc(m.name)}</th>`).join('')}<th>تنبيه بالمدة</th></tr></thead><tbody>${P.map(p => `<tr><td><b>${esc(p.n)}</b>${p.note ? `<div class="muted small">${esc(p.note)}</div>` : ''}</td>
        ${p.yearly ? `<td colspan="${FL().MODELS.length}" class="muted small">كل سنة قبل الصيف</td><td><input class="input" data-py="${p.k}" value="${esc(p.yearly)}" dir="ltr" placeholder="05-01"></td>` : FL().MODELS.map(m => `<td><input class="input" data-pk="${p.k}|${m.id}" inputmode="numeric" dir="ltr" value="${esc(p.km[m.id] ?? '')}"></td>`).join('') + `<td>${p.months !== undefined ? `<input class="input" data-pm="${p.k}" inputmode="numeric" dir="ltr" value="${esc(p.months || '')}" placeholder="شهور">` : ''}${p.checkKm ? `<div class="muted small">افحصه عند <input class="input" data-pc="${p.k}" inputmode="numeric" dir="ltr" value="${esc(p.checkKm)}" style="width:90px;display:inline-block"></div>` : ''}</td>`}</tr>`).join('')}</tbody></table></div>`, async () => {
      const out = {};
      TP.$$('#tp-modal [data-pk]').forEach(el => { const [k, m] = el.dataset.pk.split('|'), v = el.value.trim(); (out[k] = out[k] || {})[m] = v === '' ? null : Math.round(TP.num(v)); });
      TP.$$('#tp-modal [data-pm]').forEach(el => { (out[el.dataset.pm] = out[el.dataset.pm] || {}).months = Math.round(TP.num(el.value || 0)) || null; });
      TP.$$('#tp-modal [data-pc]').forEach(el => { (out[el.dataset.pc] = out[el.dataset.pc] || {}).checkKm = Math.round(TP.num(el.value || 0)) || null; });
      TP.$$('#tp-modal [data-py]').forEach(el => { if (!/^\d{2}-\d{2}$/.test(el.value.trim())) return; (out[el.dataset.py] = out[el.dataset.py] || {}).yearly = el.value.trim(); });
      if (Object.values(out).some(o => Object.values(o).some(v => v !== null && typeof v === 'number' && !(v > 0)))) { TP.toast('في رقم مش مظبوط'); return false; }
      await TP.fb.set('system/settings', { maintPlan: out }, true);
      TP.audit('settings.update', 'جدول الصيانة', '');
      TP.toast('اتحفظ ✓');
    }, { saveLabel: 'حفظ', wide: true });
  }

  /* ---------- reports ---------- */
  const tripCols = [{ h: 'التاريخ', t: 'center' }, { h: 'الوقت', t: 'center' }, { h: 'العربية' }, { h: 'السواق' }, { h: 'بيان المأمورية', w: 40 }, { h: 'العداد قبل', t: 'int' }, { h: 'العداد بعد', t: 'int' }, { h: 'كيلومترات', t: 'int', sum: true }, { h: 'المصروف (ج.م)', t: 'money', sum: true }, { h: 'بيان المصروف' }];
  const tripRow = t => [t.day, t.time ? O.hm12(t.time) : '', (vehicleOf(t.vid).plate || ''), who(t.by), t.task, t.before || '', t.after || '', t.after && t.before ? t.after - t.before : '', Number(t.expense) || 0, t.expNote || ''];
  function tripsReport() {
    const vids = state.vid ? [state.vid] : cars().map(c => c.id);
    const all = entries('trips', state.vid);
    TP.report.choose({ title: 'سجل مشاوير العربيات', subtitle: state.vid ? carName(state.vid) : 'كل العربيات', period: O.monthName(live.month), fileName: `TP-trips-${state.vid ? vehicleOf(state.vid).plate || 'car' : 'all'}-${live.month}`,
      kpis: [['المشاوير', all.length], ['الكيلومترات', all.reduce((a, t) => a + (t.after && t.before ? t.after - t.before : 0), 0)], ['المصروفات', money(all.reduce((a, t) => a + (Number(t.expense) || 0), 0))]],
      sections: vids.map(v => ({ title: carName(v), sheet: vehicleOf(v).plate || v, columns: tripCols, rows: entries('trips', v).map(tripRow), totals: true })) });
  }
  const ledgerCols = [{ h: 'التاريخ', t: 'center' }, { h: 'العربية' }, { h: 'النوع', t: 'center' }, { h: 'البيان', w: 36 }, { h: 'داخل (ج.م)', t: 'money', sum: true }, { h: 'خارج (ج.م)', t: 'money', sum: true }, { h: 'بواسطة' }];
  function ledger(kind, vid) {
    const K = { topup: 'عهدة', set: 'تحديد الرصيد', charge: 'شحن', fill: 'تعبئة' };
    const setNote = e => [e.note, e.kind === 'set' ? `الرصيد بقى ${money(e.amount)} (كان ${money(e.before)})` : ''].filter(Boolean).join(' — ');
    if (kind === 'custody') return entries('cash', vid).map(e => [e.day, vehicleOf(e.vid).plate || '', K[e.kind] || e.kind, setNote(e), e.kind === 'set' ? '' : Number(e.amount) || 0, '', e.byName || who(e.by)])
      .concat(entries('trips', vid).filter(t => Number(t.expense) > 0).map(t => [t.day, vehicleOf(t.vid).plate || '', 'مصروف مشوار', (t.expNote ? t.expNote + ' — ' : '') + t.task, '', Number(t.expense) || 0, who(t.by)])).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return entries('fuel', vid).map(e => [e.day, vehicleOf(e.vid).plate || '', K[e.kind] || e.kind, setNote(e), e.kind === 'charge' ? Number(e.amount) || 0 : '', e.kind === 'fill' ? Number(e.amount) || 0 : '', e.byName || who(e.by)]);
  }
  function ledgerReport(kind) {
    const title = kind === 'custody' ? 'حركة عهدة المصروفات' : 'حركة فيزا البنزين', vids = state.vid ? [state.vid] : cars().map(c => c.id);
    TP.report.choose({ title, subtitle: state.vid ? carName(state.vid) : 'كل العربيات', period: O.monthName(live.month), fileName: `TP-${kind}-${live.month}`,
      kpis: vids.map(v => [vehicleOf(v).plate || v, money((D.fleet.find(c => c.id === v) || {})[kind])]),
      sections: [{ title, columns: ledgerCols, rows: ledger(kind, state.vid), totals: true, note: 'الأرصدة اللي فوق هي الرصيد دلوقتي. "تحديد الرصيد" بيغيّر الرصيد للرقم المكتوب.' }] });
  }
  function salaryReport() {
    const list = salaryDrivers();
    TP.report.choose({ title: 'مرتبات سواقين السياحة', subtitle: 'Three Pyramids Travel', period: O.monthName(sal.month), fileName: `TP-salaries-${sal.month}`,
      kpis: [['السواقين', list.length], ['إجمالي الصافي', money(list.reduce((a, p) => a + salOf(p.id).net, 0)), 'gold']],
      sections: [{ title: 'المرتبات', columns: [{ h: 'الكود', t: 'center' }, { h: 'السواق' }, { h: 'العربية' }, { h: 'الأساسي (ج.م)', t: 'money', sum: true }, { h: 'الإضافي (ج.م)', t: 'money', sum: true }, { h: 'الخصومات (ج.م)', t: 'money', sum: true }, { h: 'الصافي (ج.م)', t: 'money', sum: true }],
        rows: list.map(p => { const n = salOf(p.id); return [p.code || '', p.name, vehicleOf(p.vehicleId).plate || '', n.base, n.extra, n.ded, n.net]; }), totals: true },
        { title: 'التفاصيل', columns: [{ h: 'الكود', t: 'center' }, { h: 'السواق' }, { h: 'التاريخ', t: 'center' }, { h: 'النوع', t: 'center' }, { h: 'البيان', w: 36 }, { h: 'المبلغ (ج.م)', t: 'money' }],
          rows: list.flatMap(p => [['extra', 'إضافي'], ['ded', 'خصم']].flatMap(([k, l]) => Object.values((sal.docs[p.id] || {})[k] || {}).map(x => [p.code || '', p.name, x.day || '', l, x.note || '', k === 'ded' ? -(Number(x.amount) || 0) : Number(x.amount) || 0]))) }] });
  }
  function maintReport() {
    const rows = cars().flatMap(c => maintOf(c).map(r => [carName(c.id), r.n, r.last && r.last.odo !== undefined ? r.last.odo : '', r.last ? r.last.day || '' : '', r.next || r.nextDay || '', r.left ?? '', (FL().STAGE[r.stage] || [''])[0]]));
    TP.report.choose({ title: 'الصيانة بالكيلومتر', subtitle: 'كل العربيات', period: TP.fmtDate(TP.now()), fileName: `TP-maintenance-${today()}`,
      kpis: [['لازم يتغير', rows.filter(r => r[6] === 'لازم يتغير').length, 'bad'], ['قرّب', rows.filter(r => r[6] === 'قرّب' || r[6] === 'افحصه').length, 'gold'], ['مش متسجل', rows.filter(r => r[6] === 'مش متسجل').length]],
      sections: [{ title: 'القطع', columns: [{ h: 'العربية' }, { h: 'القطعة' }, { h: 'عداد آخر تغيير', t: 'int' }, { h: 'تاريخ آخر تغيير', t: 'center' }, { h: 'الجاي (كم / تاريخ)', t: 'center' }, { h: 'الباقي', t: 'int' }, { h: 'الحالة', t: 'center' }], rows }] });
  }

  /* ---------- view ---------- */
  const tile = (label, value, tone) => `<div class="rep-kpi ${tone || ''}"><span>${esc(label)}</span><b>${value}</b></div>`;
  function carsHtml() {
    const list = cars();
    if (!list.length) return U.empty('لسه مفيش عربية عليها أمر الشغل — دوس "تشغيل أمر الشغل لعربية".');
    const warn = Number(D.settings.expiryWarnDays) || 30;
    return `<div class="fleet-grid">${list.map(c => {
      const v = vehicleOf(c.id), drv = driverOf(c.id), m = maintOf(c), due = m.filter(r => r.stage === 'due').length, soon = m.filter(r => r.stage === 'soon' || r.stage === 'check').length, unk = m.filter(r => r.stage === 'unknown').length;
      const cl = (Number(c.custody) || 0) <= low(), fl = (Number(c.fuel) || 0) < fuelLow();
      const docs = [['رخصة العربية', v.licenseExpiry], ['التأمين', v.insuranceExpiry], ['رخصة السواق', drv && drv.licenseExpiry]].map(([l, d]) => { const s = FL().docStage(d, today(), warn); return s === 'expired' || s === 'soon' ? `<span class="st ${s === 'expired' ? 'st-danger' : 'st-warn'}">${esc(l)} ${s === 'expired' ? 'منتهية' : 'باقي ' + TP.daysUntil(d) + ' يوم'}</span>` : ''; }).join('');
      return `<section class="card fleet-card ${c.on === false ? 'off' : ''}">
        <div class="fleet-h"><div><b>${esc(v.model || '')}</b> <span class="mono">${esc(v.plate || c.id)}</span><div class="muted small">${drv ? esc(TP.driverLabel(drv)) : '<span class="st st-warn">مفيش سواق مربوط</span>'}${c.on === false ? ' · <span class="st st-off">متوقف</span>' : ''}</div></div>
          <button class="icon-btn" title="إعداد" data-setup="${esc(c.id)}">${TP.icon('settings', 16)}</button></div>
        ${c.req ? `<div class="banner warn" style="margin:8px 0">${TP.icon('money')}<span class="grow">السواق طالب عهدة — رصيده ${esc(money(c.req.bal))} (${esc(TP.ago(c.req.at))})</span><button class="btn btn-primary btn-sm" data-money="${esc(c.id)}|custody">تسليم</button></div>` : ''}
        <div class="rep-kpis" style="margin:8px 0">${tile('العهدة', esc(money(c.custody)), cl ? 'bad' : 'good')}${tile('فيزا البنزين', esc(money(c.fuel)), fl ? 'bad' : 'good')}${tile('العداد', esc(String(c.odo || '—')), '')}</div>
        <div class="small">${due ? `<span class="st st-danger">${due} صيانة لازم تتعمل</span>` : ''}${soon ? `<span class="st st-warn">${soon} قرّبت</span>` : ''}${unk && c.model ? `<span class="st st-off">${unk} قطعة آخر تغيير ليها مش متسجل</span>` : ''}${!due && !soon && !unk && c.model ? '<span class="st st-ok">الصيانة تمام</span>' : ''}${!c.model ? '<span class="st st-off">من غير جدول صيانة</span>' : ''}${docs}${c.group ? '' : '<span class="st st-warn">الجروب مش متحط</span>'}</div>
        <div class="fleet-acts"><button class="btn btn-ghost btn-sm" data-money="${esc(c.id)}|custody">${TP.icon('money', 15)}العهدة</button><button class="btn btn-ghost btn-sm" data-money="${esc(c.id)}|fuel">${TP.icon('plus', 15)}البنزين</button><button class="btn btn-ghost btn-sm" data-sched="${esc(c.id)}">${TP.icon('calendar', 15)}جدول للجروب</button></div>
      </section>`;
    }).join('')}</div>`;
  }
  function tableHtml(cols, rows, actions) {
    if (!rows.length) return U.empty('مفيش حاجة في الشهر ده');
    const num = c => c.t && c.t !== 'text';
    return `<div class="table-wrap"><table class="tbl rep"><thead><tr>${cols.map(c => `<th>${esc(c.h)}</th>`).join('')}${actions ? '<th></th>' : ''}</tr></thead><tbody>${rows.map((r, ri) => `<tr>${cols.map((c, i) => `<td class="${num(c) ? 'num' : ''}">${esc(c.t === 'money' && typeof r[i] === 'number' ? TP.money(r[i]) : TP.report.fmt(r[i], c.t === 'money' ? 'int' : c.t))}</td>`).join('')}${actions ? `<td class="acts">${actions(ri)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }
  function filters() {
    const M0 = O.monthOf(today()), months = [O.addMonths(M0, -2), O.addMonths(M0, -1), M0];
    return `<div class="toolbar"><div class="chips">${months.map(m => `<button class="chip ${state.month === m ? 'active' : ''}" data-month="${m}">${esc(O.monthName(m))}</button>`).join('')}</div>
      <div class="toolbar-end"><select class="input" id="fVid" style="min-width:200px"><option value="">كل العربيات</option>${cars().map(c => `<option value="${esc(c.id)}" ${state.vid === c.id ? 'selected' : ''}>${esc(carName(c.id))}</option>`).join('')}</select></div></div>`;
  }

  TP.views.fleet = {
    deps: ['fleet', 'vehicles', 'people', 'settings', 'salaryBase'],
    leave() { if (live.unsub) live.unsub(); live = { month: null, unsub: null, logs: {} }; if (sal.unsub) sal.unsub(); sal = { month: null, unsub: null, docs: {} }; },
    render(root) {
      if (!state.month) state.month = O.monthOf(today());
      const tabs = (S.can('fleet.manage') || S.can('tracking.view') ? [['cars', 'العربيات'], ['trips', 'المشاوير'], ['custody', 'العهدة'], ['fuel', 'البنزين']] : [])
        .concat(S.can('salary.manage') ? [['salary', 'المرتبات']] : [], S.can('fleet.manage') || S.can('tracking.view') ? [['maint', 'الصيانة']] : [], S.can('all') ? [['migrate', 'نقل البرنامج القديم']] : []);
      if (!tabs.some(t => t[0] === state.tab)) state.tab = (tabs[0] || [])[0];
      if (['trips', 'custody', 'fuel'].includes(state.tab)) watchLogs(state.month);
      if (state.tab === 'salary') watchSalary(state.month);
      let body = '';
      const can = S.can('fleet.manage');
      if (state.tab === 'cars') body = `<div class="toolbar"><p class="muted small grow">العهدة بتنبّه عند ${esc(money(low()))} أو أقل، والبنزين تحت ${esc(money(fuelLow()))} (من الإعدادات).</p>${can ? `<button class="btn btn-primary" id="fcAdd">${TP.icon('plus', 18)}تشغيل أمر الشغل لعربية</button>` : ''}</div>${carsHtml()}`;
      else if (state.tab === 'trips') {
        const list = entries('trips', state.vid);
        body = filters() + `<div class="rep-kpis">${tile('المشاوير', list.length)}${tile('الكيلومترات', list.reduce((a, t) => a + (t.after && t.before ? t.after - t.before : 0), 0))}${tile('المصروفات', esc(money(list.reduce((a, t) => a + (Number(t.expense) || 0), 0))))}</div>`
          + tableHtml(tripCols, list.map(tripRow), can ? i => `<button class="icon-btn danger" title="حذف" data-rmtrip="${esc(list[i].vid)}|${esc(list[i].id)}">${TP.icon('trash', 15)}</button>` : null)
          + (list.length ? `<button class="btn btn-primary" id="dlTrips" style="margin-top:12px">${TP.icon('file', 18)}تنزيل التقرير</button>` : '');
      } else if (state.tab === 'custody' || state.tab === 'fuel') {
        const rows = ledger(state.tab, state.vid);
        body = filters() + `<div class="rep-kpis">${(state.vid ? cars().filter(c => c.id === state.vid) : cars()).map(c => tile(vehicleOf(c.id).plate || c.id, esc(money(c[state.tab])), (Number(c[state.tab]) || 0) <= (state.tab === 'custody' ? low() : fuelLow()) ? 'bad' : 'good')).join('')}</div>`
          + tableHtml(ledgerCols, rows) + (rows.length ? `<button class="btn btn-primary" id="dlLedger" style="margin-top:12px">${TP.icon('file', 18)}تنزيل التقرير</button>` : '');
      } else if (state.tab === 'salary') {
        const list = salaryDrivers(), M0 = O.monthOf(today()), months = [O.addMonths(M0, -2), O.addMonths(M0, -1), M0];
        body = `<div class="toolbar"><div class="chips">${months.map(m => `<button class="chip ${state.month === m ? 'active' : ''}" data-month="${m}">${esc(O.monthName(m))}</button>`).join('')}</div><div class="toolbar-end">${list.length ? `<button class="btn btn-primary" id="dlSal">${TP.icon('file', 18)}تنزيل المرتبات</button>` : ''}</div></div>
          <p class="muted small" style="margin-bottom:10px">السواق بيشوف مرتبه بس في "عربيتي" (حتى لو الحسابات مقفولة). أي تعديل بالرقم السري.</p>
          ${list.length ? `<div class="table-wrap"><table class="tbl rep"><thead><tr><th>السواق</th><th>العربية</th><th>الأساسي</th><th>الإضافي</th><th>الخصومات</th><th>الصافي</th><th></th></tr></thead><tbody>${list.map(p => { const n = salOf(p.id); return `<tr><td>${U.who(p.name, esc(p.code || ''))}</td><td>${esc(vehicleOf(p.vehicleId).plate || '—')}</td><td class="num">${esc(money(n.base))}</td><td class="num">${esc(money(n.extra))}</td><td class="num">${esc(money(n.ded))}</td><td class="num"><b>${esc(money(n.net))}</b></td>
            <td class="acts"><button class="btn btn-ghost btn-sm" data-sal="${esc(p.id)}|base">الأساسي</button><button class="btn btn-ghost btn-sm" data-sal="${esc(p.id)}|extra">+ إضافي</button><button class="btn btn-ghost btn-sm" data-sal="${esc(p.id)}|ded">− خصم</button><button class="btn btn-ghost btn-sm" data-sald="${esc(p.id)}">التفاصيل</button></td></tr>`; }).join('')}</tbody></table></div>` : U.empty('مفيش سواقين سياحة أو سواقين على عربيات أمر الشغل.')}`;
      } else if (state.tab === 'maint') {
        body = `<div class="toolbar"><p class="muted small grow">التنبيه بيوصل للسواق ومدير المطارات والمدير العام قبل الميعاد بـ ${FL().SOON_KM} كم وعند الميعاد.</p>${S.can('settings.edit') ? `<button class="btn btn-ghost" id="mPlan">${TP.icon('settings', 18)}جدول الكيلومترات</button>` : ''}<button class="btn btn-primary" id="dlMaint">${TP.icon('file', 18)}تنزيل التقرير</button></div>`
          + (cars().filter(c => c.model).map(c => `<section class="card" style="margin-bottom:12px"><div class="card-head"><h3>${esc(carName(c.id))}</h3><span class="muted small">العداد ${esc(String(c.odo || '—'))} كم${c.odoDay ? ' · ' + esc(c.odoDay) : ''}</span></div>
            <div class="table-wrap"><table class="tbl"><thead><tr><th>القطعة</th><th>آخر تغيير</th><th>الجاي</th><th>الباقي</th><th>الحالة</th><th></th></tr></thead><tbody>${maintOf(c).map(r => { const sg = FL().STAGE[r.stage] || ['', 'st-off']; return `<tr><td><b>${esc(r.n)}</b>${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}</td><td>${r.last ? `${r.last.odo !== undefined ? esc(String(r.last.odo)) + ' كم · ' : ''}${esc(r.last.day || '')}` : '<span class="muted">—</span>'}</td><td>${r.next ? esc(String(r.next)) + ' كم' : r.nextDay ? esc(r.nextDay) : '—'}</td><td class="num">${r.left !== null ? esc(String(r.left)) + (r.next ? ' كم' : ' يوم') : '—'}</td><td><span class="st ${sg[1]}">${sg[0]}</span></td><td class="acts">${can ? `<button class="btn btn-ghost btn-sm" data-part="${esc(c.id)}|${esc(r.k)}">سجّل تغيير</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></section>`).join('') || U.empty('حدد جدول الصيانة لكل عربية من "إعداد" في صفحة العربيات.'));
      } else if (state.tab === 'migrate') body = TP.fleetMigrate ? TP.fleetMigrate.html() : '';
      root.innerHTML = `<section class="card"><div class="chips" style="margin-bottom:14px">${tabs.map(([k, l]) => `<button class="chip ${state.tab === k ? 'active' : ''}" data-tab="${k}">${l}${k === 'cars' && D.fleet.some(c => c.req) ? ' <b class="badge">' + D.fleet.filter(c => c.req).length + '</b>' : ''}</button>`).join('')}</div>${body}</section>`;
      const guard = p => p && p.catch && p.catch(e => { console.error(e); TP.toast(TP.errorText(e), 'warn'); });
      root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; TP.rerender(); });
      root.querySelectorAll('[data-month]').forEach(b => b.onclick = () => { state.month = b.dataset.month; TP.rerender(); });
      const fv = root.querySelector('#fVid'); if (fv) fv.onchange = () => { state.vid = fv.value; TP.rerender(); };
      const add = root.querySelector('#fcAdd'); if (add) add.onclick = () => setup(null);
      root.querySelectorAll('[data-setup]').forEach(b => b.onclick = () => can ? setup(b.dataset.setup) : TP.toast('محتاج صلاحية أمر الشغل', 'warn'));
      root.querySelectorAll('[data-money]').forEach(b => b.onclick = () => { if (!can) return TP.toast('محتاج صلاحية أمر الشغل', 'warn'); const [v, w] = b.dataset.money.split('|'); money2(v, w); });
      root.querySelectorAll('[data-sched]').forEach(b => b.onclick = () => guard(schedule(b.dataset.sched)));
      root.querySelectorAll('[data-rmtrip]').forEach(b => b.onclick = () => { const [v, id] = b.dataset.rmtrip.split('|'); guard(removeTrip(v, id)); });
      root.querySelectorAll('[data-sal]').forEach(b => b.onclick = () => { const [p, k] = b.dataset.sal.split('|'); salaryEdit(p, k); });
      root.querySelectorAll('[data-sald]').forEach(b => b.onclick = () => salaryDetails(b.dataset.sald));
      root.querySelectorAll('[data-part]').forEach(b => b.onclick = () => { const [v, k] = b.dataset.part.split('|'); partDone(v, k); });
      const mp = root.querySelector('#mPlan'); if (mp) mp.onclick = editPlan;
      const dt = root.querySelector('#dlTrips'); if (dt) dt.onclick = tripsReport;
      const dlg = root.querySelector('#dlLedger'); if (dlg) dlg.onclick = () => ledgerReport(state.tab);
      const ds = root.querySelector('#dlSal'); if (ds) ds.onclick = salaryReport;
      const dm = root.querySelector('#dlMaint'); if (dm) dm.onclick = maintReport;
      if (state.tab === 'migrate' && TP.fleetMigrate) TP.fleetMigrate.bind(root);
    }
  };
  TP.fleetView = { carName, driverOf, entries: (k, vid) => entries(k, vid), ledger, tripCols, tripRow };
})(window.TP = window.TP || {});
