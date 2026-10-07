/* ==========================================================================
   Staff & permissions — Three Pyramids team + factory HR accounts
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui;
  const state = { tab: 'all' };

  /** Batch ops that copy a person's current access onto all of their devices. */
  function deviceSyncOps(person) {
    return TP.q.devicesOf(person.id).map(d => {
      if (person.active === false) return { op: 'delete', path: 'devices/' + d.id };
      return { op: 'update', path: 'devices/' + d.id, data: {
        perms: person.perms || [], kind: person.type, name: person.name,
        factoryId: person.factoryId || TP.fb.del(), driverKind: person.driverKind || TP.fb.del()
      } };
    });
  }
  TP.actions.deviceSyncOps = deviceSyncOps;

  function permsEditor(perms) {
    const canTop = S.can('all');
    return TP.PERMS.map(g => `<div class="perm-group"><h4>${esc(g.group)}</h4><div class="perm-grid">${g.items.map(i => {
      const on = perms.includes('all') || perms.includes(i.key), lock = i.top && !canTop;
      return `<label class="check ${on ? 'on' : ''}"><input type="checkbox" data-perm="${i.key}" ${on ? 'checked' : ''} ${lock ? 'disabled' : ''}><span>${esc(i.label)}${i.note ? `<small>${esc(i.note)}</small>` : ''}${i.money ? '<small>فيها أسعار — بتطلب رقم سري</small>' : ''}</span></label>`;
    }).join('')}</div></div>`).join('');
  }

  function openEditor(pid) {
    const p = pid ? TP.q.person(pid) : { type: 'staff', role: 'supervisor', perms: TP.ROLES.find(r => r.id === 'supervisor').perms.slice(), active: true };
    if (!p) return;
    const isGm = (p.perms || []).includes('all');
    if (isGm && !S.can('all')) return TP.toast('مينفعش تعدّل حساب المدير العام', 'warn');
    const roles = TP.ROLES.filter(r => r.id !== 'gm' || S.can('all'));
    TP.openModal(pid ? 'تعديل بيانات ' + p.name : 'إضافة موظف أو حساب مصنع', `
      <div class="form-grid">
        <label class="fld">الاسم<input class="input" id="fName" value="${esc(p.name || '')}" required></label>
        <label class="fld">الموبايل<input class="input" id="fPhone" inputmode="tel" value="${esc(p.phone || '')}"></label>
        <label class="fld">نوع الحساب
          <select class="input" id="fType" ${isGm ? 'disabled' : ''}>
            <option value="staff" ${p.type === 'staff' ? 'selected' : ''}>موظف ثري بيراميدز</option>
            <option value="hr" ${p.type === 'hr' ? 'selected' : ''}>HR مصنع (عميل)</option>
          </select></label>
        <label class="fld" id="fFactoryWrap">المصنع<select class="input" id="fFactory">${U.opts(D.companies, p.factoryId, c => c.id, c => c.name, 'اختار المصنع')}</select></label>
        <label class="fld" id="fRoleWrap">الدور<select class="input" id="fRole" ${isGm ? 'disabled' : ''}>${U.opts(roles, isGm ? 'gm' : p.role, r => r.id, r => r.name)}</select><small>الدور بيعلّم الصلاحيات، وتقدر تعدّل عليها</small></label>
        <label class="check full"><input type="checkbox" id="fActive" ${p.active !== false ? 'checked' : ''} ${isGm && pid === S.person.id ? 'disabled' : ''}><span>الحساب شغال<small>لو شلت العلامة: كل أجهزته هتخرج فوراً</small></span></label>
        <div class="full" id="fPermsWrap">${isGm ? '<div class="banner info" style="margin:0">المدير العام معاه كل الصلاحيات دايماً.</div>' : permsEditor(p.perms || [])}</div>
        ${!pid ? '<p class="muted small full">الرقم السري الافتراضي 1234 (للي معاهم أسعار). وبعد الحفظ هيطلعلك كود تفعيل الجهاز.</p>' : ''}
      </div>`, () => save(pid, p), { wide: true, saveLabel: pid ? 'حفظ التعديلات' : 'إضافة' });

    const sync = () => {
      const hr = U.val('fType') === 'hr';
      TP.$('#fFactoryWrap').hidden = !hr;
      TP.$('#fRoleWrap').hidden = hr;
      TP.$('#fPermsWrap').hidden = hr;
    };
    TP.$('#fType').onchange = sync; sync();
    TP.$('#fRole').onchange = () => {
      const r = TP.ROLES.find(x => x.id === U.val('fRole'));
      if (!r || r.id === 'custom') return;
      TP.$$('[data-perm]').forEach(c => { if (!c.disabled) c.checked = r.perms.includes('all') || r.perms.includes(c.dataset.perm); c.closest('.check').classList.toggle('on', c.checked); });
    };
    TP.$$('[data-perm]').forEach(c => c.onchange = () => { c.closest('.check').classList.toggle('on', c.checked); TP.$('#fRole').value = 'custom'; });
  }

  async function save(pid, old) {
    const name = U.val('fName');
    if (!name) { TP.toast('اكتب الاسم'); return false; }
    const isGm = (old.perms || []).includes('all');
    const type = isGm ? 'staff' : U.val('fType');
    const person = Object.assign({}, old, { name, phone: U.val('fPhone'), type, active: U.checked('fActive') || (isGm && pid === S.person.id) });
    if (type === 'hr') {
      person.factoryId = U.val('fFactory');
      if (!person.factoryId) { TP.toast('اختار المصنع'); return false; }
      person.perms = []; person.role = 'hr';
    } else {
      delete person.factoryId;
      person.role = isGm ? 'gm' : U.val('fRole');
      person.perms = isGm ? ['all'] : TP.normalizePerms(TP.$$('[data-perm]').filter(c => c.checked).map(c => c.dataset.perm));
      if (!person.perms.length) { TP.toast('اختار صلاحية واحدة على الأقل'); return false; }
    }
    const id = pid || TP.newId('P');
    const data = { type: person.type, name: person.name, phone: person.phone || '', role: person.role, perms: person.perms, active: person.active, updatedAt: TP.fb.ts() };
    if (person.factoryId) data.factoryId = person.factoryId; else if (pid) data.factoryId = TP.fb.del();
    const ops = [];
    const needsPinNow = TP.needsPin(person.perms), neededBefore = pid && TP.needsPin(old.perms || []);
    if (!pid) { data.createdAt = TP.fb.ts(); data.createdBy = S.person.name; }
    if (needsPinNow && !neededBefore) {
      data.pinIsDefault = true;
      ops.push({ op: 'set', path: 'pins/' + id, data: await TP.pinDoc(id, '1234') });
    }
    ops.unshift({ op: pid ? 'update' : 'set', path: 'people/' + id, data });
    if (pid) ops.push(...deviceSyncOps(Object.assign({ id }, person)));
    await TP.fb.batch(ops);
    TP.audit(pid ? 'person.update' : 'person.create', name, person.type === 'hr' ? 'HR' : person.perms.join(', '));
    TP.toast(pid ? 'تم حفظ التعديلات ✓' : 'تمت الإضافة ✓');
    if (!pid && person.active) setTimeout(() => TP.actions.newCode(id, { quiet: true }).catch(() => {}), 400);
  }

  async function resetPin(pid) {
    const p = TP.q.person(pid);
    if (!p || !(await TP.confirm('إعادة الرقم السري', `الرقم السري لـ ${p.name} هيرجع 1234، ولازم يغيّره من "حسابي".`, 'إعادة لـ 1234'))) return;
    await TP.fb.batch([
      { op: 'set', path: 'pins/' + pid, data: await TP.pinDoc(pid, '1234') },
      { op: 'update', path: 'people/' + pid, data: { pinIsDefault: true, updatedAt: TP.fb.ts() } }
    ]);
    TP.audit('pin.reset', p.name);
    TP.toast('الرقم السري رجع 1234');
  }

  async function removePerson(pid) {
    const p = TP.q.person(pid);
    if (!p) return;
    if ((p.perms || []).includes('all')) return TP.toast('مينفعش تحذف حساب المدير العام', 'warn');
    if (!(await TP.confirm('حذف الحساب', `هيتحذف حساب ${p.name} وكل أجهزته هتخرج. السجل القديم بيفضل محفوظ.`, 'حذف', true))) return;
    await TP.fb.batch([...TP.q.devicesOf(pid).map(d => ({ op: 'delete', path: 'devices/' + d.id })), { op: 'delete', path: 'pins/' + pid }, { op: 'delete', path: 'people/' + pid }]);
    TP.audit('person.delete', p.name);
    TP.toast('تم الحذف');
  }

  TP.views.staff = {
    deps: ['people', 'devices', 'companies'],
    render(root) {
      const q = U.norm(U.filters.staff || '');
      let list = TP.q.staff();
      if (state.tab !== 'all') list = list.filter(p => p.type === state.tab);
      if (q) list = list.filter(p => U.norm(p.name).includes(q) || String(p.phone || '').includes(q));
      root.innerHTML = `
        <section class="card">
          <div class="toolbar">
            <div class="chips">${[['all', 'الكل'], ['staff', 'فريق ثري بيراميدز'], ['hr', 'HR المصانع']].map(([k, l]) => `<button class="chip ${state.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
            <div class="toolbar-end">${U.filterBox('staffQ', 'بحث بالاسم أو الموبايل', U.filters.staff)}
              <button class="btn btn-primary" id="addStaff">${TP.icon('plus', 18)}إضافة</button></div>
          </div>
          ${list.length ? `<div class="table-wrap"><table class="tbl">
            <thead><tr><th>الاسم</th><th>الدور / المصنع</th><th>الصلاحيات</th><th>الأجهزة</th><th>الرقم السري</th><th></th></tr></thead>
            <tbody>${list.map(p => {
              const devs = TP.q.devicesOf(p.id), on = devs.some(TP.q.online);
              const roleName = p.type === 'hr' ? 'HR — ' + esc((TP.q.company(p.factoryId) || {}).name || 'بدون مصنع') : esc((TP.ROLES.find(r => r.id === p.role) || {}).name || 'مخصص');
              const perms = (p.perms || []).includes('all') ? '<span class="tag gold">كل الصلاحيات</span>' : (p.perms || []).slice(0, 4).map(k => `<span class="tag">${esc(TP.permLabel(k))}</span>`).join('') + ((p.perms || []).length > 4 ? `<span class="tag">+${p.perms.length - 4}</span>` : '');
              return `<tr>
                <td>${U.who(p.name, esc(p.phone || ''), p.active === false)}${p.active === false ? '<span class="st st-off">موقوف</span>' : ''}</td>
                <td>${roleName}</td>
                <td style="max-width:360px">${perms || '<span class="muted small">—</span>'}</td>
                <td><span class="dot ${on ? 'on' : ''}"></span>${devs.length} ${devs.length === 1 ? 'جهاز' : 'أجهزة'}</td>
                <td>${TP.needsPin(p.perms) ? (p.pinIsDefault ? '<span class="st st-warn">لسه 1234</span>' : '<span class="st st-ok">متغير</span>') : '<span class="muted small">مش مطلوب</span>'}</td>
                <td class="acts">
                  <button class="icon-btn" title="تعديل" data-edit="${p.id}">${TP.icon('edit', 16)}</button>
                  <button class="icon-btn" title="كود تفعيل" data-code="${p.id}">${TP.icon('key', 16)}</button>
                  ${TP.needsPin(p.perms) ? `<button class="icon-btn" title="إعادة الرقم السري لـ 1234" data-pin="${p.id}">${TP.icon('lock', 16)}</button>` : ''}
                  ${(p.perms || []).includes('all') ? '' : `<button class="icon-btn danger" title="حذف" data-del="${p.id}">${TP.icon('trash', 16)}</button>`}
                </td></tr>`;
            }).join('')}</tbody></table></div>` : U.empty('مفيش حسابات لسه — اضغط إضافة')}
        </section>
        <section class="card">
          <div class="card-head"><h3>الأدوار الجاهزة</h3><span class="muted small">بتختار الدور فيعلّم الصلاحيات، وبعدين تعدّل براحتك</span></div>
          <div class="perm-grid">${TP.ROLES.filter(r => r.id !== 'custom').map(r => `<div class="check" style="cursor:default"><span><b>${esc(r.name)}</b><small>${r.perms.includes('all') ? 'كل الصلاحيات' : r.perms.map(TP.permLabel).map(esc).join(' · ')}</small></span></div>`).join('')}</div>
        </section>`;
      U.bindFilter(root, 'staffQ', 'staff');
      root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; TP.rerender(); });
      root.querySelector('#addStaff').onclick = () => openEditor(null);
      const wrap = fn => e => fn(e.currentTarget.dataset[Object.keys(e.currentTarget.dataset)[0]]).catch(err => TP.toast(TP.errorText(err), 'warn'));
      root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
      root.querySelectorAll('[data-code]').forEach(b => b.onclick = wrap(TP.actions.newCode));
      root.querySelectorAll('[data-pin]').forEach(b => b.onclick = wrap(resetPin));
      root.querySelectorAll('[data-del]').forEach(b => b.onclick = wrap(removePerson));
    }
  };
})(window.TP = window.TP || {});
