/* ==========================================================================
   يوم الخطوط — live board of every line for a day
     · where each line reached (with auto / far / no-GPS / by-management marks)
     · half day / full day / evening waiting / overtime
     · record or correct a time (with a reason) · one-day substitute driver
     · overtime requests → approve / edit / reject with the PIN
     · days off & cancelled days
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui, O = TP.ops;
  const state = { day: '', factory: '' };
  let other = { day: null, unsub: null, list: [] };
  // all-inclusive pay for a covered day (finance enters it by hand — e.g. a trips driver on a line)
  let pay = { day: null, unsub: null, map: {} };
  function payFor(day) {
    if (!S.can('prices.view') || !TP.financeOn(D.settings)) return {};
    if (pay.day !== day) {
      if (pay.unsub) pay.unsub();
      pay = { day, unsub: null, map: {} };
      pay.unsub = TP.data.watch('dayPay', { where: [['day', '==', day]] }, l => { if (pay.day !== day) return; pay.map = {}; l.forEach(x => { pay.map[x.id] = x; }); TP.rerender(); });
    }
    return pay.map;
  }
  function openPay(line, doc) {
    const f = TP.q.company(line.factoryId), steps = O.steps(line, f), ev = doc.events || {}, p = TP.q.person(doc.driverId), cur = pay.map[doc.id];
    const ot = doc.ot, wait = O.waitMin(ev), fl = O.flags(ev);
    TP.openModal('أجر اليوم — ' + TP.driverLabel(p), `
      <div class="banner info" style="margin-bottom:10px">${TP.icon('route')}<span class="grow"><b>${esc(line.name)}</b> — ${esc(f ? f.name : '')} · <bdi dir="ltr">${esc(doc.day)}</bdi> · ${esc(TP.driverKindName(p && p.driverKind))}</span></div>
      <div class="table-wrap" style="margin-bottom:10px"><table class="tbl"><tbody>${steps.map(st => { const e = ev[st.key]; return `<tr><td>${esc(st.label)}</td><td class="num">${e ? esc(TP.fmtTime(e.at)) : '<span class="muted">—</span>'}</td><td class="small">${e ? [e.auto ? 'تلقائي' : '', e.far ? 'بعيد ' + O.fmtDist(e.dist) : '', e.by === 'staff' ? 'سجلتها الإدارة' : '', O.lateMin(e) >= 10 ? 'اتبعتت متأخر' : ''].filter(Boolean).map(esc).join(' · ') : ''}</td></tr>`; }).join('')}</tbody></table></div>
      <div class="sum-row" style="margin:0 0 12px"><div class="pill"><span>الحالة</span><strong>${esc(O.partName(O.part(ev)))}</strong></div><div class="pill"><span>انتظار المسا</span><strong>${wait} د</strong></div>
        <div class="pill"><span>السهرة</span><strong>${ot ? esc(O.otTierLabel(ot.tier, D.settings)) + ' — ' + esc((O.OT_STATUS[ot.status] || [''])[0]) : 'مفيش'}</strong></div>${fl.far ? `<div class="pill"><span>ضغطات بعيدة</span><strong>${fl.far}</strong></div>` : ''}</div>
      <label class="fld">المبلغ الشامل لليوم ده <small>اليوم + الانتظار + السهرة — بيتحسب للسواق ده بس، ومش بيأثر على سعر المصنع</small><input class="input" id="dpAmount" inputmode="decimal" dir="ltr" value="${cur ? esc(cur.amount) : ''}"></label>`, async () => {
      const amount = U.money('dpAmount');
      if (!(amount >= 0) || amount === null) { TP.toast('اكتب المبلغ'); return false; }
      if (!(await S.confirmPin('تأكيد أجر اليوم'))) return false;
      await TP.fb.set('dayPay/' + doc.id, { driverId: doc.driverId, lineId: doc.lineId, day: doc.day, month: doc.month || O.monthOf(doc.day), amount, setBy: S.person.name, setAt: TP.fb.ts() });
      TP.audit('daypay.set', `${TP.driverLabel(p)} ${doc.day}`, `${line.name}: ${amount}`);
      TP.toast('تم حفظ أجر اليوم ✓');
    }, { wide: true, saveLabel: 'حفظ بالرقم السري' });
  }

  /** Excuses ("مش راكب") the customers sent for that day — by line. */
  let exc = { day: null, unsub: null, map: {} };
  function excFor(day) {
    if (exc.day !== day) {
      if (exc.unsub) exc.unsub();
      exc = { day, unsub: null, map: {} };
      exc.unsub = TP.data.watch('excused', { where: [['day', '==', day]] }, l => { if (exc.day === day) { exc.map = {}; l.forEach(x => { exc.map[x.lineId] = x; }); TP.rerender(); } });
    }
    return exc.map;
  }
  function docsFor(day) {
    if (day === D.todayKey) return D.todayDays;
    if (other.day !== day) {
      if (other.unsub) other.unsub();
      other = { day, list: [], unsub: null };
      other.unsub = TP.data.watch('days', { where: [['day', '==', day]] }, l => { if (other.day === day) { other.list = l; TP.rerender(); } });
    }
    return other.list;
  }
  /** Who drives the line that day: the day's record, else the substitute for that day, else the line's driver. */
  function driverOf(line, doc, day) {
    if (doc && doc.driverId) return doc.driverId;
    if (line.subDay === day && line.subDriverId) return line.subDriverId;
    return line.driverId || '';
  }
  const rollover = () => Number(D.settings.dayRolloverHour) || 5;
  /** Time typed for a step → epoch ms; evening steps before the rollover hour belong to the next calendar day. */
  function stepMs(day, step, hhmm) {
    const h = Number(hhmm.split(':')[0]);
    const d = step.phase === 'e' && h < rollover() ? O.addDays(day, 1) : day;
    return O.cairoMs(d, hhmm);
  }

  function pills(steps, ev) {
    return `<div class="sp-row">${steps.map(s => {
      const e = ev[s.key];
      const late = e ? O.lateMin(e) : 0;
      const cls = ['sp', e ? 'on' : '', e && e.far ? 'far' : '', e && e.auto ? 'auto' : '', e && e.by === 'staff' ? 'staff' : '', e && e.noGps ? 'nogps' : '', late >= 10 ? 'late' : ''].join(' ');
      const tip = s.label + (e ? ' — ' + TP.fmtTime(e.at) + (e.far ? ` (بعيد ${O.fmtDist(e.dist)})` : '') + (e.auto ? ' (تلقائي)' : '') + (late >= 10 ? ` (وصلت للسيستم بعد ${late} دقيقة — كان من غير نت)` : '') + (e.by === 'staff' ? ` (سجلها ${e.byName || 'الإدارة'}: ${e.reason || ''})` : '') : '');
      return `<span class="${cls}" title="${esc(tip)}">${esc(s.short)}<b>${e ? esc(O.hm(e.at)) : '—'}</b></span>`;
    }).join('')}</div>`;
  }

  /* ---------- record / correct ---------- */
  function openCorrect(line, doc, day) {
    const f = TP.q.company(line.factoryId), steps = O.steps(line, f), ev = (doc && doc.events) || {};
    const did = driverOf(line, doc, day), drv = TP.q.person(did);
    if (!did) return TP.toast('الخط مالوش سواق — حدد سواق أو بديل الأول');
    TP.openModal(`تسجيل / تصحيح — ${line.name}`, `
      <p class="muted small" style="margin-bottom:10px">${esc(drv ? drv.name : '')} · <bdi dir="ltr">${esc(day)}</bdi>. سيب الخانة فاضية لو الخطوة متعملتش. أي تعديل بيتسجل باسمك وبالسبب.</p>
      ${TP.isLocked(day) ? `<div class="banner warn" style="margin-bottom:10px">${TP.icon('lock')}<span>اليوم ده اتصدّر للحسابات — أي تعديل هيظهر في التصدير الجاي.</span></div>` : ''}
      <div class="corr">${steps.map(s => { const e = ev[s.key]; return `<label class="corr-row"><span><b>${esc(s.label)}</b>${e ? `<small>${e.by === 'staff' ? 'متسجلة من الإدارة' : e.auto ? 'تلقائي' : 'السواق'}${e.far ? ' · بعيد ' + esc(O.fmtDist(e.dist)) : ''}</small>` : ''}</span>
        <input class="input" type="time" data-step="${s.key}" value="${e ? esc(O.hm(e.at)) : ''}"></label>`; }).join('')}</div>
      <label class="fld" style="margin-top:12px">السبب <small>مطلوب</small><textarea class="input" id="cReason" rows="2" maxlength="300" placeholder="مثال: الموبايل كان فاصل شحن"></textarea></label>`, async () => {
      const reason = U.val('cReason');
      const patch = {}, created = {};
      let n = 0;
      for (const s of steps) {
        const raw = (TP.$(`[data-step="${s.key}"]`) || {}).value || '', e = ev[s.key];
        if (!raw && e) { patch['events.' + s.key] = TP.fb.del(); n++; continue; }
        if (!raw) continue;
        const at = stepMs(day, s, raw);
        if (e && O.hm(e.at) === raw) continue;
        const val = { at, by: 'staff', byName: S.person.name, reason };
        if (e) val.prevAt = e.at;
        patch['events.' + s.key] = val; created[s.key] = val; n++;
      }
      if (!n) { TP.toast('مفيش تغيير'); return false; }
      if (!reason) { TP.toast('اكتب السبب'); return false; }
      // a period already exported to the accounts: mark it so it shows in the next export
      const locked = TP.isLocked(day), fix = TP.lockFix(day, reason);
      if (doc) await TP.fb.update('days/' + doc.id, Object.assign(patch, fix, { updatedAt: TP.fb.ts() }));
      // merge: if the driver's presses reached the server meanwhile, they are kept
      else await TP.fb.set('days/' + O.dayId(line.id, day), Object.assign({ lineId: line.id, factoryId: line.factoryId, driverId: did, day, month: O.monthOf(day), events: created, lastKey: 'staff', updatedAt: TP.fb.ts() }, fix), true);
      if (locked) TP.toast('الفترة دي اتصدّرت — التعديل هيظهر في التصدير الجاي', 'warn');
      TP.audit('day.correct', `${line.name} ${day}`, `${n} خطوة — ${reason}`);
      TP.toast('اتسجل ✓');
    }, { wide: true, saveLabel: 'حفظ' });
  }

  function openSub(line, doc, day) {
    const cur = line.subDay === day ? line.subDriverId : '';
    const drivers = TP.q.drivers().filter(p => p.active !== false && p.id !== line.driverId);
    TP.openModal(`سواق بديل — ${line.name}`, `
      <p class="muted small" style="margin-bottom:10px">ليوم <bdi dir="ltr">${esc(day)}</bdi> بس. البديل بياخد الخط بنقطه وعملائه ولوكيشناته، والسواق الأصلي مش هيسجّل اليوم ده.</p>
      <label class="fld">البديل<select class="input" id="subD">${U.opts(drivers, cur, p => p.id, p => `${TP.driverLabel(p)} — ${TP.driverKindName(p.driverKind)}`, 'بدون بديل (السواق الأصلي)')}</select></label>`, async () => {
      const sid = U.val('subD');
      const ops = [{ op: 'update', path: 'lines/' + line.id, data: { subDriverId: sid, subDay: sid ? day : '', subBy: S.person.name, subAt: TP.fb.ts() } }];
      const want = sid || line.driverId;
      if (doc && doc.driverId !== want) {
        if (!S.can('times.correct')) { TP.toast('اليوم بدأ بالفعل — محتاج صلاحية تصحيح الأوقات علشان تنقله'); return false; }
        ops.push({ op: 'update', path: 'days/' + doc.id, data: Object.assign({ driverId: want, updatedAt: TP.fb.ts() }, TP.lockFix(day, 'تغيير السواق')) });
      }
      await TP.fb.batch(ops);
      TP.wakeTouch && TP.wakeTouch(day);
      TP.audit('line.substitute', line.name, `${day}: ${sid ? (TP.q.person(sid) || {}).name : 'رجوع السواق الأصلي'}`);
      TP.toast('تم ✓');
    }, { saveLabel: 'حفظ' });
  }

  /* ---------- overtime ---------- */
  async function decideOT(doc, status, tier, note) {
    if (!(await S.confirmPin(status === 'approved' ? 'اعتماد السهرة' : 'تعديل السهرة'))) return false;
    const ot = Object.assign({}, doc.ot || { by: 'staff', reqAt: Date.now() }, { tier, status, decidedBy: S.person.name, decidedAt: Date.now() });
    if (note) ot.note = note; else delete ot.note;
    await TP.fb.update('days/' + doc.id, Object.assign({ ot, updatedAt: TP.fb.ts() }, TP.lockFix(doc.day, 'السهرة: ' + (O.OT_STATUS[status] || [''])[0])));
    const line = TP.q.line(doc.lineId);
    TP.audit('overtime.' + status, `${line ? line.name : doc.lineId} ${doc.day}`, O.otTierLabel(tier, D.settings) + (note ? ' — ' + note : ''));
    TP.toast((O.OT_STATUS[status] || [''])[0] + ' ✓');
  }
  function openOT(doc) {
    const ot = doc.ot || {};
    TP.openModal('السهرة', `
      <div class="form-grid">
        <label class="fld">الشريحة<select class="input" id="otTier">${[1, 2, 3].map(t => `<option value="${t}" ${ot.tier === t ? 'selected' : ''}>${esc(O.otTierLabel(t, D.settings))}</option>`).join('')}</select></label>
        <label class="fld">الحالة<select class="input" id="otStatus">${['approved', 'rejected', 'cancelled'].map(s => `<option value="${s}" ${ot.status === s ? 'selected' : ''}>${O.OT_STATUS[s][0]}</option>`).join('')}</select></label>
        <label class="fld full">ملاحظة<input class="input" id="otNote" value="${esc(ot.note || '')}" maxlength="200"></label>
      </div>`, () => decideOT(doc, U.val('otStatus'), Number(U.val('otTier')), U.val('otNote')), { saveLabel: 'حفظ بالرقم السري' });
  }

  /* ---------- days off ---------- */
  function openDayOff(day) {
    const list = D.dayOff.filter(o => o.day === day);
    TP.openModal('إجازة / يوم ملغي', `
      ${list.length ? `<div class="table-wrap" style="margin-bottom:12px"><table class="tbl"><tbody>${list.map(o => `<tr><td>${esc(o.factoryId === 'all' ? 'كل المصانع' : (TP.q.company(o.factoryId) || {}).name || '')}</td><td>${o.type === 'cancelled' ? 'يوم ملغي' : 'إجازة'}</td><td class="small">${esc(o.note || '')}</td><td class="acts"><button type="button" class="icon-btn danger" data-rmoff="${esc(o.id)}">${TP.icon('trash', 16)}</button></td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="form-grid">
        <label class="fld">المصنع<select class="input" id="offF"><option value="all">كل المصانع</option>${U.opts(D.companies, '', c => c.id, c => c.name)}</select></label>
        <label class="fld">النوع<select class="input" id="offT"><option value="holiday">إجازة</option><option value="cancelled">يوم ملغي</option></select></label>
        <label class="fld full">ملاحظة<input class="input" id="offN" maxlength="200" placeholder="مثال: إجازة رسمية"></label>
      </div><p class="muted small" style="margin-top:8px">السواق بيشوف الملاحظة دي في التطبيق. الحساب أصلاً بيحسب الشغل الفعلي بس.</p>`, async () => {
      const fid = U.val('offF');
      await TP.fb.set('dayOff/' + day + '_' + fid, { day, factoryId: fid, type: U.val('offT'), note: U.val('offN'), by: S.person.name, at: TP.fb.ts() });
      TP.audit('dayoff.set', day, fid);
      TP.wakeTouch && TP.wakeTouch(day);
      TP.toast('تم ✓');
    }, { saveLabel: 'إضافة' });
    TP.$$('#tp-modal [data-rmoff]').forEach(b => b.onclick = async () => { await TP.fb.remove('dayOff/' + b.dataset.rmoff); TP.closeModal(); TP.toast('اتشال ✓'); TP.wakeTouch && TP.wakeTouch(day); });
  }

  /** A substitute is for one day: once that day is over, take it off the line. */
  let cleanedFor = '';
  function clearOldSubstitutes() {
    const today = D.todayKey;
    if (!today || cleanedFor === today || !(S.can('times.correct') || S.can('wake.supervise'))) return;
    const y = O.addDays(today, -1), early = O.hourOf(TP.now()) < rollover();
    const old = D.lines.filter(l => l.subDriverId && l.subDay && (l.subDay < y || (l.subDay === y && !early)));
    if (!D.loaded.lines) return;
    cleanedFor = today;
    if (!old.length) return;
    TP.fb.batch(old.map(l => ({ op: 'update', path: 'lines/' + l.id, data: { subDriverId: '', subDay: '', subBy: S.person.name, subAt: TP.fb.ts() } }))).catch(e => console.warn('clear substitutes', e));
  }

  TP.views.today = {
    deps: null,
    leave() { if (other.unsub) other.unsub(); other = { day: null, unsub: null, list: [] }; if (exc.unsub) exc.unsub(); exc = { day: null, unsub: null, map: {} }; if (pay.unsub) pay.unsub(); pay = { day: null, unsub: null, map: {} }; },
    render(root) {
      if (!state.day) state.day = D.todayKey || TP.dayKey();
      clearOldSubstitutes();
      const day = state.day, isToday = day === D.todayKey, now = Date.now();
      const docs = docsFor(day), pays = payFor(day), excs = excFor(day);
      const canFix = S.can('times.correct'), canSub = canFix || S.can('wake.supervise'), canOT = S.can('overtime.approve');
      let lines = D.lines.filter(l => l.active !== false && (!state.factory || l.factoryId === state.factory));
      const extra = docs.filter(d => !lines.some(l => l.id === d.lineId) && (!state.factory || d.factoryId === state.factory)).map(d => TP.q.line(d.lineId)).filter(Boolean);
      lines = lines.concat(extra);
      const rows = lines.map(l => {
        const doc = docs.find(d => d.lineId === l.id) || null, ev = (doc && doc.events) || {};
        const part = O.part(ev), started = Object.keys(ev).length > 0;
        const morning = l.morningTime ? O.cairoMs(day, l.morningTime) : null;
        const late = isToday && !started && morning && now > morning + 15 * 60000;
        return { l, doc, ev, part, started, late, flags: O.flags(ev) };
      });
      const k = { all: rows.length, started: rows.filter(r => r.started).length, half: rows.filter(r => r.part === 'half').length, full: rows.filter(r => r.part === 'full').length, late: rows.filter(r => r.late).length, far: rows.reduce((a, r) => a + r.flags.far, 0) };
      const offs = D.dayOff.filter(o => o.day === day);
      const pend = D.pendingOT;

      root.innerHTML = `
        ${pend.length && (canOT || S.can('tracking.view')) ? `<section class="card"><div class="card-head"><h3>طلبات السهرة</h3><span class="st st-warn">${pend.length}</span></div>
          <div class="table-wrap"><table class="tbl"><tbody>${pend.map(d => { const l = TP.q.line(d.lineId), p = TP.q.person(d.driverId); return `<tr>
            <td><b>${esc(TP.driverLabel(p))}</b><div class="muted small">${esc(l ? l.name : '')}</div></td><td class="mono">${esc(d.day)}</td>
            <td>${esc(O.otTierLabel(d.ot.tier, D.settings))}</td><td class="small muted">${esc(TP.ago(d.ot.reqAt))}</td>
            <td class="acts">${canOT ? `<button class="btn btn-primary btn-sm" data-otok="${esc(d.id)}">${TP.icon('check', 16)}اعتماد</button><button class="btn btn-ghost btn-sm" data-otedit="${esc(d.id)}">تعديل</button><button class="btn btn-ghost btn-sm" data-otno="${esc(d.id)}">رفض</button>` : '<span class="muted small">مستني الإدارة المالية</span>'}</td></tr>`; }).join('')}</tbody></table></div></section>` : ''}
        <section class="card">
          <div class="toolbar">
            <div class="chips"><button class="chip ${!state.factory ? 'active' : ''}" data-f="">كل المصانع</button>${D.companies.map(c => `<button class="chip ${state.factory === c.id ? 'active' : ''}" data-f="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>
            <div class="toolbar-end"><input class="input" type="date" id="bDay" value="${esc(day)}" style="width:auto">
              ${!isToday ? `<button class="btn btn-ghost btn-sm" id="bToday">النهارده</button>` : ''}
              ${S.can('lines.manage') || canFix ? `<button class="btn btn-ghost" id="bOff">${TP.icon('calendar', 18)}إجازة / يوم ملغي</button>` : ''}</div>
          </div>
          ${offs.map(o => `<div class="banner warn">${TP.icon('calendar')}<span class="grow">${o.type === 'cancelled' ? 'يوم ملغي' : 'إجازة'} — ${esc(o.factoryId === 'all' ? 'كل المصانع' : (TP.q.company(o.factoryId) || {}).name || '')}${o.note ? ': ' + esc(o.note) : ''}</span></div>`).join('')}
          <div class="kpis">
            <div class="kpi"><span class="kpi-ic">${TP.icon('route', 22)}</span><div><span>الخطوط</span><strong>${k.all}</strong></div></div>
            <div class="kpi ok"><span class="kpi-ic">${TP.icon('check', 22)}</span><div><span>يوم كامل</span><strong>${k.full}</strong></div></div>
            <div class="kpi"><span class="kpi-ic">${TP.icon('clock', 22)}</span><div><span>نص يوم</span><strong>${k.half}</strong></div></div>
            <div class="kpi"><span class="kpi-ic">${TP.icon('steering', 22)}</span><div><span>بدأوا</span><strong>${k.started}</strong></div></div>
            <div class="kpi ${k.late ? 'danger' : ''}"><span class="kpi-ic">${TP.icon('alarm', 22)}</span><div><span>متأخرين ومبدأوش</span><strong>${k.late}</strong></div></div>
            <div class="kpi ${k.far ? 'warn' : ''}"><span class="kpi-ic">${TP.icon('warn', 22)}</span><div><span>ضغطات بعيدة</span><strong>${k.far}</strong></div></div>
          </div>
          ${rows.length ? `<div class="table-wrap"><table class="tbl board">
            <thead><tr><th>الخط والسواق</th><th>الخطوات</th><th>الحالة</th><th>الانتظار</th><th>السهرة</th>${canFix || canSub || canOT ? '<th></th>' : ''}</tr></thead>
            <tbody>${rows.map(r => {
              const l = r.l, did = driverOf(l, r.doc, day), p = TP.q.person(did), f = TP.q.company(l.factoryId);
              const isSub = (r.doc && r.doc.driverId && r.doc.driverId !== l.driverId) || (l.subDay === day && l.subDriverId);
              const status = r.part === 'full' ? '<span class="st st-ok">يوم كامل</span>' : r.part === 'half' ? '<span class="st st-info">نص يوم</span>' : r.late ? '<span class="st st-danger">متأخر</span>' : r.started ? '<span class="st st-warn">في الطريق</span>' : '<span class="st st-off">لسه</span>';
              const ot = r.doc && r.doc.ot, ots = ot ? O.OT_STATUS[ot.status] : null;
              const liveWait = r.ev.fe_arr && !r.ev.fe_dep ? Math.max(0, Math.round((now - r.ev.fe_arr.at) / 60000)) : null;
              return `<tr>
                <td><b>${esc(l.name)}</b><div class="muted small">${esc(f ? f.name : '')}</div><div class="small">${p ? esc(TP.driverLabel(p)) : '<span class="st st-warn">بدون سواق</span>'}${isSub ? ' <span class="tag gold">بديل</span>' : ''}</div></td>
                <td>${pills(O.steps(l, f), r.ev)}</td>
                <td>${status}${(() => {
                  const cs = O.lineCustomers(l); if (!cs.length) return '';
                  const rd = O.ridersOf(r.doc, excs[l.id]), n = s => cs.filter(c => rd[c.id] && rd[c.id].s === s).length;
                  return `<div class="small muted">${TP.icon('users', 14)} ${n('picked')}/${cs.length} ركبوا${n('skip') ? ` · ${n('skip')} اعتذر` : ''}${n('noshow') ? ` · <b style="color:var(--danger)">${n('noshow')} مجاش</b>` : ''}</div>`;
                })()}${r.flags.far ? `<div><span class="badge-s far">${r.flags.far} بعيد</span></div>` : ''}${r.flags.staff ? `<div><span class="badge-s staff">${r.flags.staff} من الإدارة</span></div>` : ''}${r.flags.late ? `<div><span class="badge-s nogps">${r.flags.late} اتبعتت متأخر</span></div>` : ''}${(() => {
                  if (!r.doc || !r.started) return '';
                  const dp = pays[r.doc.id], drv = TP.q.person(r.doc.driverId), manual = drv && drv.driverKind === 'external';
                  if (!TP.financeOn(D.settings)) return '';
                  if (dp && S.can('prices.view')) return `<div><span class="tag gold">أجر اليوم ${esc(TP.money(dp.amount))}</span>${S.can('prices.edit') ? ` <button class="link" data-pay="${esc(l.id)}">تعديل</button>` : ''}</div>`;
                  if (!manual) return '';
                  return `<div><span class="badge-s far">أجر اليوم لسه متحطش</span>${S.can('prices.edit') ? ` <button class="link" data-pay="${esc(l.id)}">حط المبلغ</button>` : ''}</div>`;
                })()}</td>
                <td class="num">${r.ev.fe_arr ? (liveWait !== null ? `<span class="st st-warn">${liveWait} د شغال</span>` : O.waitMin(r.ev) + ' د') : '—'}</td>
                <td>${ot ? `<span class="st ${ots[1]}">${ots[0]}</span><div class="small muted">${esc(O.otTierLabel(ot.tier, D.settings))}</div>` : '—'}</td>
                ${canFix || canSub || canOT ? `<td class="acts">
                  ${canFix ? `<button class="icon-btn" title="تسجيل / تصحيح" data-fix="${esc(l.id)}">${TP.icon('edit', 16)}</button>` : ''}
                  ${canSub ? `<button class="icon-btn" title="سواق بديل" data-sub="${esc(l.id)}">${TP.icon('users', 16)}</button>` : ''}
                  ${canOT && r.doc && r.started ? `<button class="icon-btn" title="السهرة" data-ot="${esc(r.doc.id)}">${TP.icon('clock', 16)}</button>` : ''}</td>` : ''}
              </tr>`;
            }).join('')}</tbody></table></div>
            <p class="muted small" style="margin-top:10px"><span class="badge-s auto">أزرق</span> اتسجل تلقائي بالموقع · <span class="badge-s far">أصفر</span> الضغطة كانت بعيدة عن المكان · <span class="badge-s staff">بنفسجي</span> سجلتها الإدارة · <span class="badge-s nogps">رمادي</span> من غير موقع أو اتبعتت متأخر (كان من غير نت). حط الماوس على أي خطوة تشوف التفاصيل.</p>`
            : U.empty(D.lines.length ? 'مفيش خطوط هنا' : 'ضيف الخطوط الأول من صفحة الخطوط')}
        </section>`;
      root.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.factory = b.dataset.f; TP.rerender(); });
      root.querySelector('#bDay').onchange = e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { state.day = e.target.value; TP.rerender(); } };
      const bt = root.querySelector('#bToday'); if (bt) bt.onclick = () => { state.day = D.todayKey; TP.rerender(); };
      const bo = root.querySelector('#bOff'); if (bo) bo.onclick = () => openDayOff(day);
      const rowOf = lid => rows.find(r => r.l.id === lid);
      const guard = p => p && p.catch && p.catch(e => TP.toast(TP.errorText(e), 'warn'));
      root.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => { const r = rowOf(b.dataset.fix); openCorrect(r.l, r.doc, day); });
      root.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { const r = rowOf(b.dataset.sub); openSub(r.l, r.doc, day); });
      root.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => { const r = rowOf(b.dataset.pay); if (r && r.doc) openPay(r.l, r.doc); });
      const findDoc = id => docs.find(d => d.id === id) || D.pendingOT.find(d => d.id === id);
      root.querySelectorAll('[data-ot],[data-otedit]').forEach(b => b.onclick = () => openOT(findDoc(b.dataset.ot || b.dataset.otedit)));
      root.querySelectorAll('[data-otok]').forEach(b => b.onclick = () => { const d = findDoc(b.dataset.otok); guard(decideOT(d, 'approved', d.ot.tier, '')); });
      root.querySelectorAll('[data-otno]').forEach(b => b.onclick = () => { const d = findDoc(b.dataset.otno); guard(decideOT(d, 'rejected', d.ot.tier, '')); });
    }
  };
})(window.TP = window.TP || {});
