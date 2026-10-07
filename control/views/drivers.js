/* ==========================================================================
   Drivers — line, tourism, external
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui;
  const state = { kind: '' };

  function openEditor(pid) {
    const p = pid ? TP.q.person(pid) : { type: 'driver', driverKind: state.kind || 'line', active: true };
    if (!p) return;
    TP.openModal(pid ? 'تعديل بيانات ' + p.name : 'إضافة سواق', `
      <div class="form-grid">
        <label class="fld">الاسم<input class="input" id="dName" value="${esc(p.name || '')}"></label>
        <label class="fld">الموبايل<input class="input" id="dPhone" inputmode="tel" dir="ltr" value="${esc(p.phone || '')}"></label>
        <label class="fld">نوع السواق<select class="input" id="dKind">${U.opts(TP.DRIVER_KINDS, p.driverKind, k => k.id, k => k.name)}</select><small id="dKindNote"></small></label>
        <label class="fld">العربية المعتادة<select class="input" id="dVehicle">${U.opts(D.vehicles.filter(v => v.active !== false), p.vehicleId, v => v.id, v => `${v.plate} — ${v.model || ''}`, 'بدون')}</select></label>
        <label class="fld">رقم رخصة القيادة<input class="input" id="dLicense" dir="ltr" value="${esc(p.licenseNo || '')}"></label>
        <label class="fld">تاريخ انتهاء الرخصة<input class="input" id="dLicenseExp" type="date" value="${esc(p.licenseExpiry || '')}"></label>
        <label class="fld full">ملاحظات<textarea class="input" id="dNotes" rows="2">${esc(p.notes || '')}</textarea></label>
        <label class="check full"><input type="checkbox" id="dActive" ${p.active !== false ? 'checked' : ''}><span>السواق شغال<small>لو شلت العلامة: موبايله هيخرج من التطبيق فوراً</small></span></label>
        ${!pid ? '<p class="muted small full">الرقم السري الأول للسواق 1234 (بيستخدمه لتغيير ميعاد صحيانه). بعد الحفظ هيطلعلك كود تفعيل لموبايله.</p>' : ''}
      </div>`, () => save(pid, p), { saveLabel: pid ? 'حفظ' : 'إضافة' });
    const note = () => { TP.$('#dKindNote').textContent = (TP.DRIVER_KINDS.find(k => k.id === U.val('dKind')) || {}).note || ''; };
    TP.$('#dKind').onchange = note; note();
  }

  async function save(pid, old) {
    const name = U.val('dName'), phone = TP.latinDigits(U.val('dPhone'));
    if (!name) { TP.toast('اكتب اسم السواق'); return false; }
    if (phone && !/^\+?[\d\s-]{8,15}$/.test(phone)) { TP.toast('رقم الموبايل مش مظبوط'); return false; }
    if (phone && D.people.some(x => x.id !== pid && x.type === 'driver' && x.phone === phone)) { TP.toast('في سواق تاني بنفس الموبايل'); return false; }
    const id = pid || TP.newId('P');
    const person = { id, type: 'driver', perms: [], name, phone, driverKind: U.val('dKind'), vehicleId: U.val('dVehicle'), licenseNo: U.val('dLicense'), licenseExpiry: U.val('dLicenseExp'), notes: U.val('dNotes'), active: U.checked('dActive') };
    const data = Object.assign({}, person, { updatedAt: TP.fb.ts() });
    delete data.id;
    const ops = [{ op: pid ? 'update' : 'set', path: 'people/' + id, data: pid ? data : Object.assign(data, { createdAt: TP.fb.ts(), createdBy: S.person.name, pinIsDefault: true }) }];
    if (!pid) ops.push({ op: 'set', path: 'pins/' + id, data: await TP.pinDoc(id, '1234') });
    if (pid) ops.push(...TP.actions.deviceSyncOps(person));
    await TP.fb.batch(ops);
    TP.audit(pid ? 'driver.update' : 'driver.create', name, TP.driverKindName(person.driverKind));
    TP.toast('تم الحفظ ✓');
    if (!pid && person.active && S.can('devices.manage')) setTimeout(() => TP.actions.newCode(id, { quiet: true }).catch(() => {}), 400);
  }

  async function resetPin(pid) {
    const p = TP.q.person(pid);
    if (!p || !(await TP.confirm('إعادة الرقم السري', `الرقم السري لـ ${p.name} هيرجع 1234.`, 'إعادة لـ 1234'))) return;
    await TP.fb.batch([{ op: 'set', path: 'pins/' + pid, data: await TP.pinDoc(pid, '1234') }, { op: 'update', path: 'people/' + pid, data: { pinIsDefault: true } }]);
    TP.audit('pin.reset', p.name);
    TP.toast('الرقم السري رجع 1234');
  }

  async function remove(pid) {
    const p = TP.q.person(pid);
    if (!p) return;
    const onLine = D.lines.filter(l => l.driverId === pid);
    if (onLine.length) return TP.toast(`السواق متسجل على ${onLine.length} خط — شيله من الخطوط الأول، أو اقفل حسابه بدل الحذف`, 'warn');
    if (!(await TP.confirm('حذف السواق', `هيتحذف ${p.name} وموبايله هيخرج. الأفضل تقفل الحساب لو ليه شغل قديم.`, 'حذف', true))) return;
    await TP.fb.batch([...TP.q.devicesOf(pid).map(d => ({ op: 'delete', path: 'devices/' + d.id })), { op: 'delete', path: 'pins/' + pid }, { op: 'delete', path: 'people/' + pid }]);
    TP.audit('driver.delete', p.name);
  }

  TP.views.drivers = {
    deps: ['people', 'devices', 'lines', 'vehicles'],
    render(root) {
      const q = U.norm(U.filters.drivers || '');
      let list = TP.q.drivers(state.kind || null);
      if (q) list = list.filter(p => U.norm(p.name).includes(q) || String(p.phone || '').includes(q));
      const counts = k => TP.q.drivers(k).length;
      root.innerHTML = `
        <section class="card">
          <div class="toolbar">
            <div class="chips"><button class="chip ${!state.kind ? 'active' : ''}" data-k="">الكل (${counts(null)})</button>${TP.DRIVER_KINDS.map(k => `<button class="chip ${state.kind === k.id ? 'active' : ''}" data-k="${k.id}">${esc(k.name)} (${counts(k.id)})</button>`).join('')}</div>
            <div class="toolbar-end">${U.filterBox('drvQ', 'بحث بالاسم أو الموبايل', U.filters.drivers)}
              <button class="btn btn-primary" id="addD">${TP.icon('plus', 18)}إضافة سواق</button></div>
          </div>
          ${list.length ? `<div class="table-wrap"><table class="tbl">
            <thead><tr><th>السواق</th><th>النوع</th><th>الخط</th><th>العربية</th><th>الرخصة</th><th>الموبايل/التطبيق</th><th></th></tr></thead>
            <tbody>${list.map(p => {
              const lines = D.lines.filter(l => l.driverId === p.id), v = TP.q.vehicle(p.vehicleId), devs = TP.q.devicesOf(p.id), on = devs.some(TP.q.online);
              return `<tr>
                <td>${U.who(p.name, `<span dir="ltr">${esc(p.phone || '')}</span>`, p.active === false)}${p.active === false ? '<span class="st st-off">موقوف</span>' : ''}</td>
                <td>${esc(TP.driverKindName(p.driverKind))}</td>
                <td>${lines.length ? lines.map(l => `<span class="tag">${esc(l.name)}</span>`).join('') : '<span class="muted small">—</span>'}</td>
                <td class="mono">${v ? esc(v.plate) : '—'}</td>
                <td>${U.expiry(p.licenseExpiry)}</td>
                <td>${devs.length ? `<span class="dot ${on ? 'on' : ''}"></span>${on ? 'متصل' : TP.ago(devs[0].lastSeen)}` : '<span class="st st-warn">مش متفعل</span>'}</td>
                <td class="acts"><button class="icon-btn" title="تعديل" data-edit="${p.id}">${TP.icon('edit', 16)}</button>
                  ${S.can('devices.manage') ? `<button class="icon-btn" title="كود تفعيل" data-code="${p.id}">${TP.icon('key', 16)}</button>` : ''}
                  <button class="icon-btn" title="رقم سري 1234" data-pin="${p.id}">${TP.icon('lock', 16)}</button>
                  <button class="icon-btn danger" title="حذف" data-del="${p.id}">${TP.icon('trash', 16)}</button></td></tr>`;
            }).join('')}</tbody></table></div>` : U.empty('مفيش سواقين هنا لسه')}
        </section>`;
      U.bindFilter(root, 'drvQ', 'drivers');
      root.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { state.kind = b.dataset.k; TP.rerender(); });
      root.querySelector('#addD').onclick = () => openEditor(null);
      const run = fn => e => fn(Object.values(e.currentTarget.dataset)[0]).catch(err => TP.toast(TP.errorText(err), 'warn'));
      root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
      root.querySelectorAll('[data-code]').forEach(b => b.onclick = run(TP.actions.newCode));
      root.querySelectorAll('[data-pin]').forEach(b => b.onclick = run(resetPin));
      root.querySelectorAll('[data-del]').forEach(b => b.onclick = run(remove));
    }
  };
})(window.TP = window.TP || {});
