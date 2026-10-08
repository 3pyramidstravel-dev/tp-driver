/* ==========================================================================
   المشاوير — one-off trips. Each trip has two separate prices written for
   that trip only: what the factory pays (missionFactory/) and what the
   driver earns (missionDriver/). Neither side can read the other.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui, O = TP.ops;
  const state = { month: '', filter: 'open' };
  let live = { month: null, unsubs: [], list: [], pd: {}, pf: {} };

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
  const placeHtml = (prefix, p) => `
    <label class="fld">${prefix === 'from' ? 'من (المكان)' : 'إلى (المكان)'}<input class="input" id="${prefix}Name" value="${esc((p && p.name) || '')}"></label>
    <label class="fld">لوكيشن ${prefix === 'from' ? 'البداية' : 'الوجهة'}<input class="input" id="${prefix}Loc" dir="ltr" placeholder="لينك جوجل ماب أو 30.29, 31.74" value="${esc(U.locText(p && p.location))}"></label>`;
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

  function openEditor(mid) {
    const m = mid ? find(mid) : { day: TP.dayKey(), factoryId: '', status: 'assigned' };
    if (!m) return;
    const canPrice = S.can('prices.edit');
    const drivers = TP.q.drivers().filter(p => p.active !== false || p.id === m.driverId);
    TP.openModal(mid ? 'تعديل مشوار' : 'مشوار جديد', `
      <div class="form-grid">
        <label class="fld full">وصف المشوار<input class="input" id="mTitle" value="${esc(m.title || '')}" placeholder="مثال: توصيل وفد من الفندق للمصنع" maxlength="120"></label>
        <label class="fld">اليوم<input class="input" type="date" id="mDay" value="${esc(m.day || '')}"></label>
        <label class="fld">الميعاد<input class="input" type="time" id="mTime" value="${esc(m.time || '')}"></label>
        <label class="fld">المصنع (العميل)<select class="input" id="mFactory">${U.opts(D.companies, m.factoryId, c => c.id, c => c.name, 'جهة تانية (مش مصنع)')}</select></label>
        <label class="fld">اسم الجهة <small>لو مش مصنع</small><input class="input" id="mClient" value="${esc(m.client || '')}" maxlength="80"></label>
        <label class="fld full">السواق<select class="input" id="mDriver">${U.opts(drivers, m.driverId, p => p.id, p => `${p.name} — ${TP.driverKindName(p.driverKind)}`, 'اختار السواق')}</select></label>
        ${placeHtml('from', m.from)}${placeHtml('to', m.to)}
        <label class="fld full">الضيوف<input class="input" id="mGuests" value="${esc(m.guests || '')}" maxlength="300" placeholder="الأسماء أو العدد"></label>
        <label class="fld full">ملاحظات للسواق<textarea class="input" id="mNotes" rows="2" maxlength="500">${esc(m.notes || '')}</textarea></label>
        ${canPrice ? priceFields(m, live.pd[mid], live.pf[mid]) : '<p class="muted small full">السعر بيحطه المدير المالي أو المدير العام من نفس الصفحة.</p>'}
      </div>`, () => save(mid, m), { wide: true, saveLabel: mid ? 'حفظ' : 'إضافة' });
    const fsel = TP.$('#mFactory'), pfIn = TP.$('#mPF');
    if (fsel && pfIn) fsel.onchange = () => { pfIn.disabled = !fsel.value; if (!fsel.value) pfIn.value = ''; };
  }

  async function save(mid, old) {
    const title = U.val('mTitle'), day = U.val('mDay'), driverId = U.val('mDriver');
    if (!title) { TP.toast('اكتب وصف المشوار'); return false; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { TP.toast('اختار اليوم'); return false; }
    if (!driverId) { TP.toast('اختار السواق'); return false; }
    const from = readPlace('from'), to = readPlace('to');
    if (from.error || to.error) { TP.toast(from.error || to.error); return false; }
    const id = mid || TP.newId('M');
    const data = { title, day, month: O.monthOf(day), time: U.val('mTime'), factoryId: U.val('mFactory'), client: U.val('mFactory') ? '' : U.val('mClient'), driverId, from, to, guests: U.val('mGuests'), notes: U.val('mNotes'), updatedAt: TP.fb.ts() };
    const ops = [];
    if (mid) ops.push({ op: 'update', path: 'missions/' + id, data });
    else ops.push({ op: 'set', path: 'missions/' + id, data: Object.assign(data, { status: 'assigned', events: {}, createdAt: TP.fb.ts(), createdBy: S.person.name }) });
    let note = '';
    if (S.can('prices.edit')) {
      const p = priceOps(id, data);
      if (p.error) { TP.toast(p.error); return false; }
      ops.push(...p.ops);   // the price fields come pre-filled, so a new driver / month / factory re-saves them
      if (mid && !data.factoryId && live.pf[mid]) ops.push({ op: 'delete', path: 'missionFactory/' + id });
      if (p.ops.length && TP.needsPin(S.perms) && !(await S.confirmPin('تأكيد سعر المشوار'))) return false;
    } else if (mid && (old.driverId !== data.driverId || old.month !== data.month || old.factoryId !== data.factoryId)) {
      // the old prices belonged to the old driver / month / factory: remove them so they get set again
      ops.push({ op: 'delete', path: 'missionDriver/' + id }, { op: 'delete', path: 'missionFactory/' + id });
      note = ' — السعر محتاج يتحط تاني';
    }
    await TP.fb.batch(ops);
    TP.audit(mid ? 'mission.update' : 'mission.create', title, `${day} — ${(TP.q.person(driverId) || {}).name || ''}`);
    TP.toast('تم الحفظ ✓' + note);
  }

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

  async function cancel(mid) {
    const m = find(mid);
    if (!m || !(await TP.confirm('إلغاء المشوار', `المشوار "${m.title}" هيتلغي ويختفي من عند السواق.`, 'إلغاء المشوار', true))) return;
    await TP.fb.update('missions/' + mid, { status: 'cancelled', updatedAt: TP.fb.ts() });
    TP.audit('mission.cancel', m.title, m.day);
  }
  async function remove(mid) {
    const m = find(mid);
    if (!m || !(await TP.confirm('حذف المشوار', `"${m.title}" هيتحذف نهائياً هو وأسعاره.`, 'حذف', true))) return;
    await TP.fb.batch([{ op: 'delete', path: 'missions/' + mid }, { op: 'delete', path: 'missionDriver/' + mid }, { op: 'delete', path: 'missionFactory/' + mid }]);
    TP.audit('mission.delete', m.title, m.day);
  }

  TP.views.missions = {
    deps: null,
    leave() { live.unsubs.forEach(u => u()); live = { month: null, unsubs: [], list: [], pd: {}, pf: {} }; },
    render(root) {
      const M = O.monthOf(TP.dayKey());
      if (!state.month) state.month = M;
      watch(state.month);
      const canEdit = S.can('missions.manage'), canPrice = S.can('prices.edit'), seePrice = S.can('prices.view');
      const q = U.norm(U.filters.missions || ''), today = TP.dayKey();
      let list = live.list.slice().sort((a, b) => (a.day + (a.time || '')).localeCompare(b.day + (b.time || '')));
      if (state.filter === 'open') list = list.filter(m => m.status === 'assigned' || m.status === 'active');
      else if (state.filter === 'done') list = list.filter(m => m.status === 'done');
      else if (state.filter === 'unpriced') list = list.filter(m => m.status !== 'cancelled' && (!live.pd[m.id] || (m.factoryId && !live.pf[m.id])));
      if (q) list = list.filter(m => U.norm(m.title).includes(q) || U.norm((TP.q.person(m.driverId) || {}).name).includes(q) || U.norm((TP.q.company(m.factoryId) || {}).name || m.client).includes(q));
      const months = [O.addMonths(M, -1), M, O.addMonths(M, 1)];
      const filters = [['open', 'المفتوحة'], ['done', 'اللي خلصت'], ['all', 'الكل']].concat(seePrice ? [['unpriced', 'من غير سعر']] : []);
      root.innerHTML = `<section class="card">
        <div class="toolbar">
          <div class="chips">${months.map(m => `<button class="chip ${state.month === m ? 'active' : ''}" data-month="${m}">${esc(O.monthName(m))}</button>`).join('')}</div>
          <div class="toolbar-end">${U.filterBox('missionsQ', 'بحث', U.filters.missions)}${canEdit ? `<button class="btn btn-primary" id="addM">${TP.icon('plus', 18)}مشوار جديد</button>` : ''}</div>
        </div>
        <div class="chips" style="margin-bottom:12px">${filters.map(([k, l]) => `<button class="chip ${state.filter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
        ${list.length ? `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>الميعاد</th><th>المشوار</th><th>السواق</th><th>من → إلى</th><th>الحالة</th>${seePrice ? '<th>سعر المصنع</th><th>أجر السواق</th>' : ''}<th></th></tr></thead>
          <tbody>${list.map(m => {
            const p = TP.q.person(m.driverId), f = TP.q.company(m.factoryId), s = O.MISSION_STATUS[m.status] || ['', 'st-off'], ev = m.events || {};
            const steps = O.MISSION_STEPS.filter(x => ev[x.key]).map(x => `${x.short} ${O.hm(ev[x.key].at)}${ev[x.key].far ? ' ⚠' : ''}`).join(' · ');
            return `<tr>
              <td class="small"><bdi dir="ltr">${esc(m.day)}</bdi>${m.time ? `<br>${esc(O.hm12(m.time))}` : ''}${m.day === today ? ' <span class="tag gold">النهارده</span>' : ''}</td>
              <td><b>${esc(m.title)}</b><div class="muted small">${esc(f ? f.name : m.client || '')}</div></td>
              <td>${esc(p ? p.name : '—')}${p && p.driverKind === 'tourism' ? '<div class="muted small">سياحة</div>' : ''}</td>
              <td class="small">${esc((m.from && m.from.name) || '—')} ← ${esc((m.to && m.to.name) || '—')}</td>
              <td><span class="st ${s[1]}">${s[0]}</span>${steps ? `<div class="muted small">${esc(steps)}</div>` : ''}</td>
              ${seePrice ? `<td class="num">${m.factoryId ? (live.pf[m.id] ? esc(TP.money(live.pf[m.id].amount)) : '<span class="st st-warn">لسه</span>') : '—'}</td><td class="num">${live.pd[m.id] ? esc(TP.money(live.pd[m.id].amount)) : '<span class="st st-warn">لسه</span>'}</td>` : ''}
              <td class="acts">${canEdit ? `<button class="icon-btn" title="تعديل" data-edit="${esc(m.id)}">${TP.icon('edit', 16)}</button>` : ''}
                ${canPrice && m.status !== 'cancelled' ? `<button class="icon-btn" title="السعر" data-price="${esc(m.id)}">${TP.icon('money', 16)}</button>` : ''}
                ${canEdit && m.status !== 'done' && m.status !== 'cancelled' ? `<button class="icon-btn" title="إلغاء" data-cancel="${esc(m.id)}">${TP.icon('x', 16)}</button>` : ''}
                ${canEdit ? `<button class="icon-btn danger" title="حذف" data-del="${esc(m.id)}">${TP.icon('trash', 16)}</button>` : ''}</td></tr>`;
          }).join('')}</tbody></table></div>` : U.empty('مفيش مشاوير هنا')}
      </section>`;
      U.bindFilter(root, 'missionsQ', 'missions');
      const guard = fn => id => fn(id).catch(e => TP.toast(TP.errorText(e), 'warn'));
      root.querySelectorAll('[data-month]').forEach(b => b.onclick = () => { state.month = b.dataset.month; TP.rerender(); });
      root.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { state.filter = b.dataset.filter; TP.rerender(); });
      const add = root.querySelector('#addM'); if (add) add.onclick = () => openEditor(null);
      root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
      root.querySelectorAll('[data-price]').forEach(b => b.onclick = () => openPrice(b.dataset.price));
      root.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => guard(cancel)(b.dataset.cancel));
      root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => guard(remove)(b.dataset.del));
    }
  };
})(window.TP = window.TP || {});
