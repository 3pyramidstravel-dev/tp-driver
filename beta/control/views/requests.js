/* ==========================================================================
   طلبات المصانع والمصاريف
     · factory HR asks for a trip / an airport transfer → one click opens the
       trip form filled in; saving it closes the request
     · factory HR asks to add / change / remove a customer → applied to the
       line (the car's 3-customer limit is kept) after the Control Tower agrees
     · driver expenses (parking, toll…) with the receipt photo → approve / refuse
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui, O = TP.ops;
  const state = { tab: '' };
  const TYPE = { mission: ['مشوار', 'file'], airport: ['مطار', 'plane'], customer: ['تعديل عملاء', 'users'] };
  const ACTION = { add: 'إضافة عميل', edit: 'تعديل بيانات عميل', remove: 'شيل عميل' };
  const EXP = { parking: 'باركينج', toll: 'كارتة', fuel: 'بنزين', other: 'مصروف تاني' };
  TP.EXPENSE_KINDS = EXP;

  const canReq = () => S.can('missions.manage') || S.can('lines.manage') || S.can('airport.manage');
  const canExp = () => S.can('missions.manage') || S.can('advances.manage');

  async function decide(r, status, extra) {
    await TP.fb.update('requests/' + r.id, Object.assign({ status, decidedBy: S.person.name, decidedAt: TP.fb.ts() }, extra || {}));
    TP.audit('request.' + status, (TP.q.company(r.factoryId) || {}).name || '', (TYPE[r.type] || [''])[0] + (extra && extra.decisionNote ? ' — ' + extra.decisionNote : ''));
  }
  function reject(r) {
    TP.openModal('رفض الطلب', `<label class="fld">السبب <small>بيظهر للمصنع</small><input class="input" id="rjNote" maxlength="200"></label>`, async () => {
      const note = U.val('rjNote');
      if (!note) { TP.toast('اكتب السبب'); return false; }
      await decide(r, 'rejected', { decisionNote: note });
      TP.toast('اترفض ✓');
    }, { saveLabel: 'رفض', danger: true });
  }
  function makeTrip(r) {
    if (!S.can('missions.manage')) return TP.toast('محتاج صلاحية إنشاء المشاوير');
    const prefill = { type: r.type === 'airport' ? 'airport' : '', factoryId: r.factoryId, day: r.day || TP.dayKey(), time: r.time || '', notes: r.notes || '',
      from: r.from || { name: '' }, to: r.to || { name: '' }, customers: r.pax && r.pax.name ? [{ name: r.pax.name, phone: r.pax.phone || '' }] : [] };
    if (r.type === 'airport') prefill.flight = { no: r.flightNo || '', date: r.day || '', dir: r.dir || '', dirSet: !!r.dir };
    TP.actions.openMission(prefill, id => decide(r, 'done', { missionId: id }).then(() => TP.toast('الطلب اتقفل ✓')).catch(e => TP.toast(TP.errorText(e), 'warn')));
  }
  /** Applies a customer change to its line. */
  async function applyCustomer(r) {
    if (!S.can('lines.manage')) return TP.toast('محتاج صلاحية إدارة الخطوط');
    const line = TP.q.line(r.lineId);
    if (!line || line.factoryId !== r.factoryId) return TP.toast('الخط مش موجود عند المصنع ده — ارفض الطلب', 'warn');
    const points = JSON.parse(JSON.stringify(line.points || [])).map(p => Object.assign(p, { customers: O.custsOf(p).map(c => Object.assign({}, c)) }));
    const max = Math.max(1, Number(D.settings.maxCustomersPerCar) || 3), total = points.reduce((a, p) => a + p.customers.length, 0);
    const c = r.cust || {}, fresh = {};
    if (r.action === 'add') {
      if (total >= max) return TP.toast(`العربية مليانة (${max} عملاء) — شيل حد الأول أو انقل العميل لخط تاني`, 'warn');
      const p = points[Number(r.pointIdx) || 0]; if (!p) return TP.toast('النقطة مش موجودة', 'warn');
      const k = await TP.cust.newLink(); fresh[k.h] = k.token;
      p.customers.push({ id: TP.newId('C'), h: k.h, name: String(c.name || '').slice(0, 60), phone: TP.latinDigits(c.phone || ''), home: c.home || null });
    } else {
      const pi = points.findIndex(p => p.customers.some(x => x.id === r.custId));
      if (pi < 0) return TP.toast('العميل مش موجود على الخط ده', 'warn');
      if (r.action === 'remove') points[pi].customers = points[pi].customers.filter(x => x.id !== r.custId);
      else {
        const x = points[pi].customers.find(y => y.id === r.custId);
        if (c.name) x.name = String(c.name).slice(0, 60);
        if (c.phone) x.phone = TP.latinDigits(c.phone);
        if (c.home) x.home = c.home;
        const to = r.pointIdx !== undefined && r.pointIdx !== null && r.pointIdx !== '' && Number(r.pointIdx) >= 0 ? Number(r.pointIdx) : pi;
        if (to !== pi && points[to]) { points[pi].customers = points[pi].customers.filter(y => y.id !== x.id); points[to].customers.push(x); }
      }
    }
    if (!(await TP.confirm('تنفيذ الطلب', `${ACTION[r.action] || ''} على خط "${line.name}"${c.name ? ' — ' + c.name : ''}.`, 'نفّذ'))) return;
    const data = Object.assign({}, line, { points, updatedAt: TP.fb.ts() }); delete data.id;
    await TP.fb.batch(TP.actions.lineSaveOps(line.id, data, line, fresh).concat([{ op: 'update', path: 'requests/' + r.id, data: { status: 'done', decidedBy: S.person.name, decidedAt: TP.fb.ts() } }]));
    TP.audit('request.done', line.name, ACTION[r.action] + (c.name ? ' ' + c.name : ''));
    TP.toast('اتنفذ ✓' + (r.action === 'add' ? ' — ابعت للعميل اللينك من صفحة الخطوط' : ''));
  }

  function reqDetails(r) {
    const f = TP.q.company(r.factoryId), place = p => p && p.name ? esc(p.name) : '—';
    if (r.type === 'customer') {
      const l = TP.q.line(r.lineId), pt = l && (l.points || [])[Number(r.pointIdx)];
      const cur = l && O.lineCustomers(l).find(x => x.id === r.custId);
      return `<b>${esc(ACTION[r.action] || '')}</b> — خط ${esc(l ? l.name : '؟')}${pt ? ' · نقطة ' + esc(pt.name) : ''}<br>${esc((r.cust && r.cust.name) || (cur && cur.name) || '')} <span dir="ltr">${esc((r.cust && r.cust.phone) || '')}</span>${r.cust && r.cust.home ? ' · ' + U.mapLink(r.cust.home, 'البيت') : ''}`;
    }
    return `${r.type === 'airport' ? `✈ <b dir="ltr">${esc(r.flightNo || '')}</b> · ${r.dir === 'arr' ? 'استقبال' : r.dir === 'dep' ? 'توصيل' : ''} · ` : ''}<bdi dir="ltr">${esc(r.day || '')}</bdi>${r.time ? ' ' + esc(O.hm12(r.time)) : ''}<br>${place(r.from)} ← ${place(r.to)}${r.pax && r.pax.name ? ` · ${esc(r.pax.name)} <span dir="ltr">${esc(r.pax.phone || '')}</span>` : ''}${r.notes ? `<div class="muted small">${esc(r.notes)}</div>` : ''}<div class="muted small">${esc(f ? f.name : '')}</div>`;
  }

  async function decideExpense(x, status, note) {
    await TP.fb.update('expenses/' + x.id, { status, decidedBy: S.person.name, decidedAt: TP.fb.ts(), decisionNote: note || '' });
    TP.audit('expense.' + status, TP.q.dname(x.driverId), `${EXP[x.kind] || ''} ${x.amount}${note ? ' — ' + note : ''}`);
    TP.toast(status === 'approved' ? 'اتقبل ✓' : 'اترفض');
  }
  function rejectExpense(x) {
    TP.openModal('رفض المصروف', `<label class="fld">السبب <small>بيظهر للسواق</small><input class="input" id="xNote" maxlength="200"></label>`, async () => {
      const note = U.val('xNote');
      if (!note) { TP.toast('اكتب السبب'); return false; }
      await decideExpense(x, 'rejected', note);
    }, { saveLabel: 'رفض', danger: true });
  }
  function showPhoto(x) {
    TP.openModal('الإيصال — ' + TP.q.dname(x.driverId), x.photo ? `<img src="${esc(x.photo)}" alt="الإيصال" style="width:100%;border-radius:14px;border:1px solid var(--line)">` : U.empty('من غير صورة'), null, { noSave: true });
  }

  TP.views.requests = {
    deps: ['factoryRequests', 'expensesPending', 'companies', 'lines', 'people', 'settings'],
    render(root) {
      const tabs = [];
      if (canReq()) tabs.push(['factory', 'طلبات المصانع', D.factoryRequests.length]);
      if (canExp()) tabs.push(['expenses', 'مصاريف السواقين', D.expensesPending.length]);
      if (!tabs.some(t => t[0] === state.tab)) state.tab = (tabs[0] || [''])[0];
      let body = '';
      if (state.tab === 'factory') {
        const list = D.factoryRequests;
        body = list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>الطلب</th><th>التفاصيل</th><th>من</th><th></th></tr></thead><tbody>${list.map(r => `<tr>
          <td><span class="tag">${TP.icon((TYPE[r.type] || [, 'file'])[1], 15)} ${esc((TYPE[r.type] || [''])[0])}</span></td>
          <td class="small">${reqDetails(r)}</td>
          <td class="small">${esc(r.byName || '')}<div class="muted">${esc(TP.ago(r.at))}</div></td>
          <td class="acts">${r.type === 'customer' ? `<button class="btn btn-primary btn-sm" data-apply="${esc(r.id)}">نفّذ</button>` : `<button class="btn btn-primary btn-sm" data-trip="${esc(r.id)}">اعمل المشوار</button>`}<button class="btn btn-ghost btn-sm" data-reject="${esc(r.id)}">رفض</button></td></tr>`).join('')}</tbody></table></div>`
          : U.empty('مفيش طلبات مستنية');
      } else if (state.tab === 'expenses') {
        const list = D.expensesPending;
        body = list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>السواق</th><th>المصروف</th><th>اليوم</th><th>الإيصال</th><th></th></tr></thead><tbody>${list.map(x => `<tr>
          <td><b>${esc(TP.q.dname(x.driverId))}</b></td>
          <td><b>${esc(EXP[x.kind] || x.kind)}</b> — ${esc(TP.money(x.amount))}${x.note ? `<div class="muted small">${esc(x.note)}</div>` : ''}</td>
          <td class="small"><bdi dir="ltr">${esc(x.day)}</bdi><div class="muted">${esc(TP.fmtTime(x.at))}</div></td>
          <td>${x.photo ? `<button class="link" data-photo="${esc(x.id)}"><img src="${esc(x.photo)}" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:10px;border:1px solid var(--line)"></button>` : '<span class="st st-warn">من غير صورة</span>'}</td>
          <td class="acts"><button class="btn btn-primary btn-sm" data-xok="${esc(x.id)}">قبول</button><button class="btn btn-ghost btn-sm" data-xno="${esc(x.id)}">رفض</button></td></tr>`).join('')}</tbody></table></div>`
          : U.empty('مفيش مصاريف مستنية');
      }
      root.innerHTML = `<section class="card"><div class="chips" style="margin-bottom:14px">${tabs.map(([k, l, n]) => `<button class="chip ${state.tab === k ? 'active' : ''}" data-tab="${k}">${l}${n ? ` <b class="badge">${n}</b>` : ''}</button>`).join('')}</div>${body}</section>`;
      const reqOf = id => D.factoryRequests.find(r => r.id === id), expOf = id => D.expensesPending.find(x => x.id === id);
      const guard = p => p && p.catch && p.catch(e => TP.toast(TP.errorText(e), 'warn'));
      root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; TP.rerender(); });
      root.querySelectorAll('[data-trip]').forEach(b => b.onclick = () => makeTrip(reqOf(b.dataset.trip)));
      root.querySelectorAll('[data-apply]').forEach(b => b.onclick = () => guard(applyCustomer(reqOf(b.dataset.apply))));
      root.querySelectorAll('[data-reject]').forEach(b => b.onclick = () => reject(reqOf(b.dataset.reject)));
      root.querySelectorAll('[data-photo]').forEach(b => b.onclick = () => showPhoto(expOf(b.dataset.photo)));
      root.querySelectorAll('[data-xok]').forEach(b => b.onclick = () => guard(decideExpense(expOf(b.dataset.xok), 'approved')));
      root.querySelectorAll('[data-xno]').forEach(b => b.onclick = () => rejectExpense(expOf(b.dataset.xno)));
    }
  };
})(window.TP = window.TP || {});
