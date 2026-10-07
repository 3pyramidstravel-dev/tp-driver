/* ==========================================================================
   Fixed lines: points (with guests & locations) → factory
   A new or substitute driver gets everything from here.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const D = TP.D, U = TP.ui;
  const MAX_POINTS = 10;
  const state = { factory: '' };

  /* ---------- points editor (inside the modal) ---------- */
  let points = [];
  function readPoints() {
    TP.$$('.point[data-i]').forEach(el => {
      const i = Number(el.dataset.i);
      points[i] = { name: el.querySelector('[data-f=name]').value.trim(), locText: el.querySelector('[data-f=loc]').value.trim(), guestsText: el.querySelector('[data-f=guests]').value };
    });
  }
  function drawPoints(factory) {
    const box = TP.$('#pBox');
    box.innerHTML = points.map((p, i) => `
      <div class="point" data-i="${i}">
        <div class="point-head"><span class="point-no">${i + 1}</span>
          <input class="input" data-f="name" placeholder="اسم النقطة (مثال: ميدان الحصري)" value="${esc(p.name || '')}">
          <button type="button" class="icon-btn" title="لفوق" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-btn" title="لتحت" data-down="${i}" ${i === points.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="icon-btn danger" title="حذف النقطة" data-rm="${i}">${TP.icon('trash', 16)}</button></div>
        <div class="form-grid">
          <label class="fld">لوكيشن النقطة<input class="input" data-f="loc" dir="ltr" placeholder="لينك جوجل ماب أو 30.29, 31.74" value="${esc(p.locText || '')}"><span data-loccheck></span></label>
          <label class="fld">الضيوف في النقطة دي <small>كل اسم في سطر</small><textarea class="input" data-f="guests" rows="3">${esc(p.guestsText || '')}</textarea></label>
        </div>
      </div>`).join('') + `
      <div class="point factory"><div class="point-head"><span class="point-no">${TP.icon('factory', 16)}</span><b>الوجهة: ${esc((factory && factory.name) || 'المصنع')}</b></div>
        ${factory ? U.mapLink(factory.location, 'لوكيشن المصنع') : '<span class="muted small">اختار المصنع</span>'}</div>
      ${points.length < MAX_POINTS ? '<button type="button" class="btn btn-ghost" id="pAdd">+ إضافة نقطة</button>' : ''}`;
    const check = el => {
      const span = el.parentElement.querySelector('[data-loccheck]'), raw = el.value.trim(), loc = TP.parseLocation(raw);
      span.innerHTML = !raw ? '<small class="muted">بدون لوكيشن — السواق الجديد مش هيعرف يوصل</small>' : loc ? `<small>${U.mapLink(loc, 'جرّب')}</small>` : '<small style="color:var(--danger)">مش مقروء</small>';
    };
    box.querySelectorAll('[data-f=loc]').forEach(el => { el.oninput = () => check(el); check(el); });
    const act = (sel, fn) => box.querySelectorAll(sel).forEach(b => b.onclick = () => { readPoints(); fn(Number(Object.values(b.dataset)[0])); drawPoints(TP.q.company(U.val('lFactory'))); });
    act('[data-rm]', i => points.splice(i, 1));
    act('[data-up]', i => { [points[i - 1], points[i]] = [points[i], points[i - 1]]; });
    act('[data-down]', i => { [points[i + 1], points[i]] = [points[i], points[i + 1]]; });
    const add = TP.$('#pAdd');
    if (add) add.onclick = () => { readPoints(); points.push({}); drawPoints(TP.q.company(U.val('lFactory'))); };
  }

  function openEditor(lid) {
    const l = lid ? TP.q.line(lid) : { factoryId: state.factory || '', active: true, points: [{}] };
    if (!l) return;
    points = (l.points || []).map(p => ({ name: p.name, locText: U.locText(p.location), guestsText: (p.guests || []).join('\n') }));
    if (!points.length) points = [{}];
    const lineDrivers = TP.q.drivers('line').filter(p => p.active !== false);
    TP.openModal(lid ? 'تعديل خط ' + l.name : 'إضافة خط', `
      <div class="form-grid">
        <label class="fld">اسم الخط<input class="input" id="lName" value="${esc(l.name || '')}" placeholder="مثال: خط العاشر 1"></label>
        <label class="fld">المصنع<select class="input" id="lFactory">${U.opts(D.companies, l.factoryId, c => c.id, c => c.name, 'اختار المصنع')}</select></label>
        <label class="fld">السواق<select class="input" id="lDriver">${U.opts(lineDrivers, l.driverId, p => p.id, p => p.name, 'بدون سواق')}</select></label>
        <label class="fld">العربية<select class="input" id="lVehicle">${U.opts(D.vehicles.filter(v => v.active !== false), l.vehicleId, v => v.id, v => `${v.plate} — ${v.model || ''}`, 'بدون عربية')}</select></label>
        <label class="fld">ميعاد أول نقطة الصبح<input class="input" id="lMorning" type="time" value="${esc(l.morningTime || '')}"></label>
        <label class="fld">ميعاد الرجوع من المصنع<input class="input" id="lEvening" type="time" value="${esc(l.eveningTime || '')}"></label>
        <div class="full"><h4 style="margin:6px 0 10px;color:var(--maroon-2)">النقط بالترتيب</h4><div class="points" id="pBox"></div></div>
        <label class="fld full">ملاحظات للسواق<textarea class="input" id="lNotes" rows="2">${esc(l.notes || '')}</textarea></label>
        <label class="check full"><input type="checkbox" id="lActive" ${l.active !== false ? 'checked' : ''}><span>الخط شغال</span></label>
      </div>`, () => save(lid), { wide: true, saveLabel: lid ? 'حفظ' : 'إضافة' });
    drawPoints(TP.q.company(l.factoryId));
    TP.$('#lFactory').onchange = () => { readPoints(); drawPoints(TP.q.company(U.val('lFactory'))); };
  }

  async function save(lid) {
    readPoints();
    const name = U.val('lName'), factoryId = U.val('lFactory');
    if (!name) { TP.toast('اكتب اسم الخط'); return false; }
    if (!factoryId) { TP.toast('اختار المصنع'); return false; }
    const clean = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!p.name && !p.locText && !(p.guestsText || '').trim()) continue;
      if (!p.name) { TP.toast(`اكتب اسم النقطة رقم ${i + 1}`); return false; }
      const loc = p.locText ? TP.parseLocation(p.locText) : null;
      if (p.locText && !loc) { TP.toast(`لوكيشن نقطة "${p.name}" مش مقروء`); return false; }
      clean.push({ name: p.name, location: loc, guests: String(p.guestsText || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 60) });
    }
    if (!clean.length) { TP.toast('ضيف نقطة واحدة على الأقل'); return false; }
    const driverId = U.val('lDriver');
    const clash = driverId && D.lines.find(x => x.id !== lid && x.driverId === driverId && x.active !== false);
    if (clash && !(await TP.confirm('السواق على خط تاني', `${(TP.q.person(driverId) || {}).name} متسجل على خط "${clash.name}". تكمل؟`, 'أيوه، كمّل'))) return false;
    const data = {
      name, factoryId, driverId: driverId || '', vehicleId: U.val('lVehicle') || '',
      morningTime: U.val('lMorning'), eveningTime: U.val('lEvening'),
      points: clean, notes: U.val('lNotes'), active: U.checked('lActive'), updatedAt: TP.fb.ts()
    };
    if (!lid) data.createdAt = TP.fb.ts();
    await TP.fb.set('lines/' + (lid || TP.newId('L')), data, true);
    TP.audit(lid ? 'line.update' : 'line.create', name, `${clean.length} نقط`);
    TP.toast('تم حفظ الخط ✓');
  }

  async function remove(lid) {
    const l = TP.q.line(lid);
    if (!l || !(await TP.confirm('حذف الخط', `هيتحذف خط ${l.name}. لو مؤقتاً متوقف، الأفضل تشيل علامة "الخط شغال".`, 'حذف', true))) return;
    await TP.fb.remove('lines/' + lid);
    TP.audit('line.delete', l.name);
  }

  TP.views.lines = {
    deps: ['lines', 'companies', 'people', 'vehicles'],
    render(root) {
      const q = U.norm(U.filters.lines || '');
      let list = D.lines.filter(l => !state.factory || l.factoryId === state.factory);
      if (q) list = list.filter(l => U.norm(l.name).includes(q) || U.norm((TP.q.person(l.driverId) || {}).name).includes(q));
      root.innerHTML = `
        <section class="card">
          <div class="toolbar">
            <div class="chips"><button class="chip ${!state.factory ? 'active' : ''}" data-f="">كل المصانع</button>${D.companies.map(c => `<button class="chip ${state.factory === c.id ? 'active' : ''}" data-f="${c.id}">${esc(c.name)}</button>`).join('')}</div>
            <div class="toolbar-end">${U.filterBox('linesQ', 'بحث بالخط أو السواق', U.filters.lines)}
              <button class="btn btn-primary" id="addL" ${D.companies.length ? '' : 'disabled title="ضيف المصانع الأول"'}>${TP.icon('plus', 18)}إضافة خط</button></div>
          </div>
          ${list.length ? `<div class="table-wrap"><table class="tbl">
            <thead><tr><th>الخط</th><th>المصنع</th><th>السواق</th><th>العربية</th><th>المواعيد</th><th>النقط</th><th></th></tr></thead>
            <tbody>${list.map(l => {
              const d = TP.q.person(l.driverId), v = TP.q.vehicle(l.vehicleId), f = TP.q.company(l.factoryId);
              const guests = (l.points || []).reduce((a, p) => a + (p.guests || []).length, 0);
              const noLoc = (l.points || []).filter(p => !p.location).length;
              return `<tr>
                <td><b>${esc(l.name)}</b>${l.active === false ? ' <span class="st st-off">متوقف</span>' : ''}</td>
                <td>${esc(f ? f.name : '—')}</td>
                <td>${d ? esc(d.name) : '<span class="st st-warn">بدون سواق</span>'}</td>
                <td class="mono">${v ? esc(v.plate) : '—'}</td>
                <td class="small">الصبح ${esc(l.morningTime || '—')}<br>الرجوع ${esc(l.eveningTime || '—')}</td>
                <td class="small">${(l.points || []).length} نقط · ${guests} ضيف${noLoc ? `<br><span class="st st-warn">${noLoc} بدون لوكيشن</span>` : ''}</td>
                <td class="acts"><button class="icon-btn" title="تعديل" data-edit="${l.id}">${TP.icon('edit', 16)}</button><button class="icon-btn danger" title="حذف" data-del="${l.id}">${TP.icon('trash', 16)}</button></td></tr>`;
            }).join('')}</tbody></table></div>` : U.empty(D.companies.length ? 'مفيش خطوط هنا لسه' : 'ضيف المصانع الأول من صفحة المصانع')}
        </section>`;
      U.bindFilter(root, 'linesQ', 'lines');
      root.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.factory = b.dataset.f; TP.rerender(); });
      root.querySelector('#addL').onclick = () => openEditor(null);
      root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
      root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remove(b.dataset.del).catch(e => TP.toast(TP.errorText(e), 'warn')));
    }
  };
})(window.TP = window.TP || {});
