/* ==========================================================================
   Vehicles — plates, licence & insurance expiry
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const D = TP.D, U = TP.ui;

  function openEditor(vid) {
    const v = vid ? TP.q.vehicle(vid) : { active: true };
    if (!v) return;
    TP.openModal(vid ? 'تعديل العربية ' + v.plate : 'إضافة عربية', `
      <div class="form-grid">
        <label class="fld">رقم اللوحة<input class="input" id="vPlate" value="${esc(v.plate || '')}" placeholder="أ ب ج 1234"></label>
        <label class="fld">الماركة والموديل<input class="input" id="vModel" value="${esc(v.model || '')}" placeholder="هيونداي إلنترا 2025"></label>
        <label class="fld">اللون<input class="input" id="vColor" value="${esc(v.color || '')}"></label>
        <label class="fld">الملكية<select class="input" id="vOwner"><option value="company" ${v.owner !== 'driver' ? 'selected' : ''}>عربية الشركة</option><option value="driver" ${v.owner === 'driver' ? 'selected' : ''}>عربية السواق</option></select></label>
        <label class="fld">انتهاء رخصة العربية<input class="input" id="vLic" type="date" value="${esc(v.licenseExpiry || '')}"></label>
        <label class="fld">انتهاء التأمين<input class="input" id="vIns" type="date" value="${esc(v.insuranceExpiry || '')}"></label>
        <label class="check full"><input type="checkbox" id="vActive" ${v.active !== false ? 'checked' : ''}><span>العربية في الخدمة</span></label>
      </div>`, () => save(vid), { saveLabel: vid ? 'حفظ' : 'إضافة' });
  }

  async function save(vid) {
    const plate = U.val('vPlate');
    if (!plate) { TP.toast('اكتب رقم اللوحة'); return false; }
    if (D.vehicles.some(x => x.id !== vid && U.norm(x.plate).replace(/\s/g, '') === U.norm(plate).replace(/\s/g, ''))) { TP.toast('اللوحة دي متسجلة قبل كده'); return false; }
    const data = { plate, model: U.val('vModel'), color: U.val('vColor'), owner: U.val('vOwner'), licenseExpiry: U.val('vLic'), insuranceExpiry: U.val('vIns'), active: U.checked('vActive'), updatedAt: TP.fb.ts() };
    if (!vid) data.createdAt = TP.fb.ts();
    await TP.fb.set('vehicles/' + (vid || TP.newId('V')), data, true);
    TP.audit(vid ? 'vehicle.update' : 'vehicle.create', plate);
    TP.toast('تم الحفظ ✓');
  }

  async function remove(vid) {
    const v = TP.q.vehicle(vid);
    if (!v) return;
    const used = D.lines.filter(l => l.vehicleId === vid).length;
    if (used) return TP.toast(`العربية متسجلة على ${used} خط — غيّرها في الخطوط الأول`, 'warn');
    if (!(await TP.confirm('حذف العربية', `هتتحذف العربية ${v.plate}.`, 'حذف', true))) return;
    await TP.fb.remove('vehicles/' + vid);
    TP.audit('vehicle.delete', v.plate);
  }

  TP.views.vehicles = {
    deps: ['vehicles', 'lines', 'people', 'settings'],
    render(root) {
      const q = U.norm(U.filters.veh || '');
      const list = D.vehicles.filter(v => !q || U.norm(v.plate).includes(q) || U.norm(v.model).includes(q));
      const warn = D.settings.expiryWarnDays || 30;
      const soon = d => d && TP.daysUntil(d) <= warn;
      const alerts = D.vehicles.filter(v => v.active !== false && (soon(v.licenseExpiry) || soon(v.insuranceExpiry))).length;
      root.innerHTML = `
        ${alerts ? `<div class="banner warn">${TP.icon('warn')}<span class="grow">${alerts} عربية رخصتها أو تأمينها خلص أو هيخلص خلال ${warn} يوم.</span></div>` : ''}
        <section class="card">
          <div class="toolbar">${U.filterBox('vehQ', 'بحث باللوحة أو الموديل', U.filters.veh)}
            <button class="btn btn-primary" id="addV">${TP.icon('plus', 18)}إضافة عربية</button></div>
          ${list.length ? `<div class="table-wrap"><table class="tbl">
            <thead><tr><th>اللوحة</th><th>العربية</th><th>السواق / الخط</th><th>الرخصة</th><th>التأمين</th><th></th></tr></thead>
            <tbody>${list.map(v => {
              const lines = D.lines.filter(l => l.vehicleId === v.id), drv = D.people.find(p => p.vehicleId === v.id);
              return `<tr>
                <td class="mono"><b>${esc(v.plate)}</b>${v.active === false ? ' <span class="st st-off">خارج الخدمة</span>' : ''}</td>
                <td>${esc(v.model || '')}<br><span class="muted small">${esc(v.color || '')} · ${v.owner === 'driver' ? 'عربية السواق' : 'عربية الشركة'}</span></td>
                <td>${drv ? esc(drv.name) : ''}${lines.map(l => `<span class="tag">${esc(l.name)}</span>`).join('')}${!drv && !lines.length ? '<span class="muted small">—</span>' : ''}</td>
                <td>${U.expiry(v.licenseExpiry)}</td><td>${U.expiry(v.insuranceExpiry)}</td>
                <td class="acts"><button class="icon-btn" title="تعديل" data-edit="${v.id}">${TP.icon('edit', 16)}</button><button class="icon-btn danger" title="حذف" data-del="${v.id}">${TP.icon('trash', 16)}</button></td></tr>`;
            }).join('')}</tbody></table></div>` : U.empty('مفيش عربيات متسجلة لسه')}
        </section>`;
      U.bindFilter(root, 'vehQ', 'veh');
      root.querySelector('#addV').onclick = () => openEditor(null);
      root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
      root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remove(b.dataset.del).catch(e => TP.toast(TP.errorText(e), 'warn')));
    }
  };
})(window.TP = window.TP || {});
