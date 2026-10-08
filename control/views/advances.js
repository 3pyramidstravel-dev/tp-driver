/* ==========================================================================
   السلف والخصومات — management only. Each one has a reason and is deducted
   at the bottom of the driver's statement (total → deductions → net).
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui, O = TP.ops;
  const state = { month: '', driver: '' };
  let live = { month: null, unsub: null, list: [] };

  function watch(month) {
    if (live.month === month) return;
    if (live.unsub) live.unsub();
    live = { month, unsub: null, list: [] };
    live.unsub = TP.data.watch('adjustments', { where: [['month', '==', month]] }, l => { if (live.month === month) { live.list = l; TP.rerender(); } });
  }

  function openEditor(aid) {
    const a = aid ? live.list.find(x => x.id === aid) : { type: 'advance', day: TP.dayKey(), driverId: state.driver };
    if (!a) return;
    const drivers = TP.q.drivers().filter(p => p.active !== false || p.id === a.driverId);
    TP.openModal(aid ? 'تعديل' : 'سلفة أو خصم', `
      <div class="form-grid">
        <label class="fld full">السواق<select class="input" id="aDriver">${U.opts(drivers, a.driverId, p => p.id, p => `${p.name} — ${TP.driverKindName(p.driverKind)}`, 'اختار السواق')}</select></label>
        <label class="fld">النوع<select class="input" id="aType"><option value="advance" ${a.type === 'advance' ? 'selected' : ''}>سلفة</option><option value="deduction" ${a.type === 'deduction' ? 'selected' : ''}>خصم</option></select></label>
        <label class="fld">المبلغ<input class="input" id="aAmount" inputmode="decimal" dir="ltr" value="${a.amount ?? ''}"></label>
        <label class="fld">التاريخ <small>بيتخصم من حساب الشهر ده</small><input class="input" type="date" id="aDay" value="${esc(a.day || '')}"></label>
        <label class="fld full">السبب <small>بيظهر للسواق في حسابه</small><input class="input" id="aReason" maxlength="200" value="${esc(a.reason || '')}"></label>
      </div>`, async () => {
      const driverId = U.val('aDriver'), amount = U.money('aAmount'), day = U.val('aDay'), reason = U.val('aReason'), type = U.val('aType');
      if (!driverId) { TP.toast('اختار السواق'); return false; }
      if (!(amount > 0)) { TP.toast('اكتب المبلغ'); return false; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { TP.toast('اختار التاريخ'); return false; }
      if (!reason) { TP.toast('اكتب السبب'); return false; }
      const data = { driverId, type, amount, day, month: O.monthOf(day), reason, by: S.person.name, at: TP.fb.ts() };
      if (aid) await TP.fb.set('adjustments/' + aid, data);
      else await TP.fb.add('adjustments', data);
      const p = TP.q.person(driverId);
      TP.audit(aid ? 'adjustment.update' : 'adjustment.create', p ? p.name : driverId, `${O.ADJ_TYPES[type]} ${amount} — ${reason}`);
      TP.toast('تم الحفظ ✓');
    }, { saveLabel: aid ? 'حفظ' : 'إضافة' });
  }
  async function remove(aid) {
    const a = live.list.find(x => x.id === aid), p = a && TP.q.person(a.driverId);
    if (!a || !(await TP.confirm('حذف', `${O.ADJ_TYPES[a.type]} ${TP.money(a.amount)} لـ ${p ? p.name : ''} هتتحذف.`, 'حذف', true))) return;
    await TP.fb.remove('adjustments/' + aid);
    TP.audit('adjustment.delete', p ? p.name : a.driverId, `${O.ADJ_TYPES[a.type]} ${a.amount} — ${a.reason}`);
  }

  /** The driver's month statement exactly as he sees it in "حسابي". */
  TP.actions.showStatement = async function (driverId, month) {
    const p = TP.q.person(driverId);
    TP.openModal(`كشف حساب — ${p ? p.name : ''}`, '<div class="spinner"></div>', null, { noSave: true, wide: true });
    const w = { where: [['driverId', '==', driverId], ['month', '==', month]] };
    try {
      const [days, missions, pay, rates, adj] = await Promise.all([
        TP.fb.list('days', w), TP.fb.list('missions', w), TP.fb.list('missionDriver', w),
        TP.fb.get('driverRates/' + driverId), TP.fb.list('adjustments', w)
      ]);
      const missionPay = {}; pay.forEach(x => { missionPay[x.id] = x.amount; });
      const d = O.statement({ days, missions, missionPay, rateHistory: (rates && rates.history) || [], adjustments: adj });
      const body = TP.$('#tp-modal-body');
      if (body) body.innerHTML = `<p class="muted small" style="margin-bottom:10px">${esc(O.monthName(month))} · ${esc(TP.driverKindName(p && p.driverKind))}${p && p.driverKind === 'tourism' ? ' — السواق ده مبيشوفش المبالغ في تطبيقه' : ''}</p>` + O.statementHtml(d, true);
      if (body) TP.hydrateIcons(body);
    } catch (e) {
      const body = TP.$('#tp-modal-body'); if (body) body.innerHTML = `<div class="banner danger">${esc(TP.errorText(e))}</div>`;
    }
  };

  TP.views.advances = {
    deps: null,
    leave() { if (live.unsub) live.unsub(); live = { month: null, unsub: null, list: [] }; },
    render(root) {
      const M = O.monthOf(TP.dayKey());
      if (!state.month) state.month = M;
      watch(state.month);
      const months = [O.addMonths(M, -2), O.addMonths(M, -1), M];
      const list = live.list.filter(a => !state.driver || a.driverId === state.driver).sort((a, b) => (a.day < b.day ? 1 : -1));
      const byDriver = {};
      live.list.forEach(a => { byDriver[a.driverId] = TP.round2((byDriver[a.driverId] || 0) + (Number(a.amount) || 0)); });
      const canStmt = S.can('prices.view');
      const drivers = TP.q.drivers();
      root.innerHTML = `<section class="card">
        <div class="toolbar">
          <div class="chips">${months.map(m => `<button class="chip ${state.month === m ? 'active' : ''}" data-month="${m}">${esc(O.monthName(m))}</button>`).join('')}</div>
          <div class="toolbar-end"><select class="input" id="aFilter" style="width:auto">${U.opts(drivers, state.driver, p => p.id, p => p.name, 'كل السواقين')}</select>
            <button class="btn btn-primary" id="addA">${TP.icon('plus', 18)}سلفة أو خصم</button></div>
        </div>
        ${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>التاريخ</th><th>السواق</th><th>النوع</th><th>المبلغ</th><th>السبب</th><th>بواسطة</th><th></th></tr></thead>
          <tbody>${list.map(a => { const p = TP.q.person(a.driverId); return `<tr><td class="mono">${esc(a.day)}</td><td>${esc(p ? p.name : '—')}</td>
            <td><span class="st ${a.type === 'advance' ? 'st-info' : 'st-danger'}">${esc(O.ADJ_TYPES[a.type] || '')}</span></td><td class="num">${esc(TP.money(a.amount))}</td>
            <td>${esc(a.reason)}</td><td class="small muted">${esc(a.by || '')}</td>
            <td class="acts"><button class="icon-btn" title="تعديل" data-edit="${esc(a.id)}">${TP.icon('edit', 16)}</button><button class="icon-btn danger" title="حذف" data-del="${esc(a.id)}">${TP.icon('trash', 16)}</button></td></tr>`; }).join('')}</tbody></table></div>`
          : U.empty('مفيش سلف أو خصومات في الشهر ده')}
      </section>
      ${Object.keys(byDriver).length ? `<section class="card"><div class="card-head"><h3>إجمالي الشهر لكل سواق</h3></div>
        <div class="table-wrap"><table class="tbl"><tbody>${Object.entries(byDriver).map(([id, total]) => { const p = TP.q.person(id); return `<tr><td>${esc(p ? p.name : id)}</td><td class="num">${esc(TP.money(total))}</td>
          <td class="acts">${canStmt ? `<button class="btn btn-ghost btn-sm" data-stmt="${esc(id)}">${TP.icon('file', 16)}كشف الحساب</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></section>` : ''}
      ${canStmt ? `<section class="card"><div class="card-head"><h3>كشف حساب أي سواق</h3></div><div class="toolbar-end"><select class="input" id="stmtD" style="width:auto">${U.opts(drivers, '', p => p.id, p => p.name, 'اختار السواق')}</select><button class="btn btn-ghost" id="stmtGo">${TP.icon('file', 18)}اعرض الكشف</button></div></section>` : ''}`;
      root.querySelectorAll('[data-month]').forEach(b => b.onclick = () => { state.month = b.dataset.month; TP.rerender(); });
      root.querySelector('#aFilter').onchange = e => { state.driver = e.target.value; TP.rerender(); };
      root.querySelector('#addA').onclick = () => openEditor(null);
      root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
      root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remove(b.dataset.del).catch(e => TP.toast(TP.errorText(e), 'warn')));
      root.querySelectorAll('[data-stmt]').forEach(b => b.onclick = () => TP.actions.showStatement(b.dataset.stmt, state.month));
      const go = root.querySelector('#stmtGo'); if (go) go.onclick = () => { const id = U.val('stmtD'); if (id) TP.actions.showStatement(id, state.month); else TP.toast('اختار السواق'); };
    }
  };
})(window.TP = window.TP || {});
