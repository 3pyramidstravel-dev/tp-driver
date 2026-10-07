/* ==========================================================================
   Factories (clients)
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const D = TP.D, U = TP.ui;

  function openEditor(fid) {
    const f = fid ? TP.q.company(fid) : { active: true };
    if (!f) return;
    TP.openModal(fid ? 'تعديل ' + f.name : 'إضافة مصنع', `
      <div class="form-grid">
        <label class="fld">اسم المصنع (عربي)<input class="input" id="fName" value="${esc(f.name || '')}" required></label>
        <label class="fld">الاسم بالإنجليزي <small>بيظهر في التقارير</small><input class="input" id="fNameEn" dir="ltr" value="${esc(f.nameEn || '')}"></label>
        <label class="fld full">لوكيشن المصنع <small>الصق لينك خرائط جوجل أو اكتب الإحداثيات (30.29, 31.74)</small>
          <input class="input" id="fLoc" dir="ltr" value="${esc(U.locText(f.location))}"></label>
        <div class="full" id="fLocCheck"></div>
        <label class="fld">اسم المسؤول عندهم<input class="input" id="fContact" value="${esc(f.contactName || '')}"></label>
        <label class="fld">موبايل المسؤول<input class="input" id="fContactPhone" inputmode="tel" value="${esc(f.contactPhone || '')}"></label>
        <label class="check full"><input type="checkbox" id="fActive" ${f.active !== false ? 'checked' : ''}><span>المصنع شغال معانا</span></label>
      </div>`, () => save(fid), { saveLabel: fid ? 'حفظ' : 'إضافة' });
    const check = () => {
      const raw = U.val('fLoc'), loc = TP.parseLocation(raw);
      TP.$('#fLocCheck').innerHTML = !raw ? '' : loc ? `<span class="st st-ok">اللوكيشن مقروء</span> ${U.mapLink(loc, 'جرّب افتحه')}` : '<span class="st st-danger">مش قادر أقرا اللوكيشن ده</span>';
    };
    TP.$('#fLoc').oninput = check; check();
  }

  async function save(fid) {
    const name = U.val('fName');
    if (!name) { TP.toast('اكتب اسم المصنع'); return false; }
    if (D.companies.some(c => c.id !== fid && U.norm(c.name) === U.norm(name))) { TP.toast('في مصنع بنفس الاسم'); return false; }
    const raw = U.val('fLoc'), loc = TP.parseLocation(raw);
    if (raw && !loc) { TP.toast('اللوكيشن مش مقروء — الصق لينك جوجل ماب صح'); return false; }
    const data = { name, nameEn: U.val('fNameEn'), location: loc || null, contactName: U.val('fContact'), contactPhone: U.val('fContactPhone'), active: U.checked('fActive'), updatedAt: TP.fb.ts() };
    if (!fid) data.createdAt = TP.fb.ts();
    const id = fid || TP.newId('F');
    await TP.fb.set('companies/' + id, data, true);
    TP.audit(fid ? 'factory.update' : 'factory.create', name);
    TP.toast('تم الحفظ ✓');
  }

  async function remove(fid) {
    const f = TP.q.company(fid);
    if (!f) return;
    const lines = D.lines.filter(l => l.factoryId === fid).length, hr = D.people.filter(p => p.factoryId === fid).length;
    if (lines || hr) return TP.toast(`المصنع عليه ${lines} خط و${hr} حساب HR — انقلهم أو اقفل المصنع بدل الحذف`, 'warn');
    if (!(await TP.confirm('حذف المصنع', `هيتحذف ${f.name}.`, 'حذف', true))) return;
    await TP.fb.remove('companies/' + fid);
    TP.audit('factory.delete', f.name);
  }

  TP.views.factories = {
    deps: ['companies', 'lines', 'people'],
    render(root) {
      root.innerHTML = `
        <div class="toolbar"><span class="muted">المصانع اللي بنشغّل لها خطوط ومشاوير.</span>
          <button class="btn btn-primary" id="addF">${TP.icon('plus', 18)}إضافة مصنع</button></div>
        ${D.companies.length ? `<div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${D.companies.map(f => {
          const lines = D.lines.filter(l => l.factoryId === f.id).length, hr = D.people.filter(p => p.type === 'hr' && p.factoryId === f.id).length;
          return `<div class="card" style="margin:0">
            <div class="card-head" style="margin-bottom:8px"><div><h3>${esc(f.name)}</h3><span class="muted small" dir="ltr">${esc(f.nameEn || '')}</span></div>
              ${f.active === false ? '<span class="st st-off">متوقف</span>' : '<span class="st st-ok">شغال</span>'}</div>
            <div class="chips" style="margin-bottom:10px"><span class="tag">${lines} خط</span><span class="tag">${hr} حساب HR</span></div>
            <div>${U.mapLink(f.location, 'لوكيشن المصنع')}</div>
            ${f.contactName ? `<div class="muted small" style="margin-top:6px">${esc(f.contactName)} ${f.contactPhone ? '· <span dir="ltr">' + esc(f.contactPhone) + '</span>' : ''}</div>` : ''}
            <div style="display:flex;gap:6px;margin-top:12px"><button class="btn btn-ghost btn-sm" data-edit="${f.id}">${TP.icon('edit', 16)}تعديل</button>
              <button class="icon-btn danger" title="حذف" data-del="${f.id}">${TP.icon('trash', 16)}</button></div>
          </div>`;
        }).join('')}</div>` : `<section class="card">${U.empty('لسه مفيش مصانع — ابدأ بإضافة المصانع الستة')}</section>`}`;
      root.querySelector('#addF').onclick = () => openEditor(null);
      root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
      root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remove(b.dataset.del).catch(e => TP.toast(TP.errorText(e), 'warn')));
    }
  };
})(window.TP = window.TP || {});
