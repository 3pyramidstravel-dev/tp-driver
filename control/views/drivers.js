/* ==========================================================================
   Drivers — line, tourism, external
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui;
  const state = { kind: '' };

  /** Next free driver code (codes are never reused, even after a driver is deleted). */
  function nextCode() {
    const used = D.driverCodes.map(c => Number(c.id)).concat(D.people.map(p => Number(p.code) || 0)).filter(n => n > 0);
    return Math.max(100, ...used) + 1;
  }
  const lineOf = pid => D.lines.find(l => l.driverId === pid);

  function openEditor(pid) {
    const p = pid ? TP.q.person(pid) : { type: 'driver', driverKind: state.kind || 'line', active: true };
    if (!p) return;
    const cur = pid ? lineOf(pid) : null;
    const canLine = S.can('lines.manage');
    TP.openModal(pid ? 'تعديل بيانات ' + TP.driverLabel(p) : 'إضافة سواق', `
      <div class="form-grid">
        ${pid && p.code ? `<div class="full"><span class="tag gold">كود السواق ${esc(p.code)}</span> <span class="muted small">ثابت ومبيتغيرش</span></div>` : ''}
        <label class="fld">الاسم<input class="input" id="dName" value="${esc(p.name || '')}"></label>
        <label class="fld">الاسم بالإنجليزي <small>للضيوف الأجانب</small><input class="input" id="dNameEn" dir="ltr" maxlength="60" placeholder="Sameh Fathy" value="${esc(p.nameEn || '')}"></label>
        <label class="fld">الموبايل<input class="input" id="dPhone" inputmode="tel" dir="ltr" value="${esc(p.phone || '')}"></label>
        <label class="fld full">نوع السواق<select class="input" id="dKind">${U.opts(TP.DRIVER_KINDS, p.driverKind, k => k.id, k => k.name)}</select><small id="dKindNote"></small></label>
        <div class="full form-grid" id="dLineBox" style="padding:12px;border:1px dashed var(--line-strong);border-radius:14px;background:#fffaf1">
          <label class="fld">المصنع<select class="input" id="dFactory" ${canLine ? '' : 'disabled'}>${U.opts(D.companies, cur ? cur.factoryId : '', c => c.id, c => c.name, 'اختار المصنع')}</select></label>
          <label class="fld">الخط<select class="input" id="dLine" ${canLine ? '' : 'disabled'}></select></label>
          <small class="full muted" id="dLineNote">${canLine ? 'سواق الخط الثابت لازم يتحدد مصنعه وخطه. لو الخط لسه معمولش، اختار "لسه مالوش خط" وارجع اربطه بعدين.' : 'ربط الخط محتاج صلاحية إدارة الخطوط.'}</small>
        </div>
        <div class="full photo-pick"><div class="photo-prev" id="dPhotoPrev">${TP.icon('user', 34)}</div>
          <div><b>صورة السواق <small class="muted">(اختيارية)</small></b><div class="muted small">بتظهر للعميل في كارنيه الشركة مع الاسم والكود بس. بتتصغّر لوحدها.</div>
            <label class="btn btn-ghost btn-sm" style="margin-top:6px">${TP.icon('plus', 16)}اختار صورة<input type="file" accept="image/*" id="dPhoto" hidden></label>
            <button type="button" class="btn btn-ghost btn-sm" id="dPhotoRm" hidden>شيل الصورة</button></div></div>
        <label class="fld">العربية المعتادة<select class="input" id="dVehicle">${U.opts(D.vehicles.filter(v => v.active !== false), p.vehicleId, v => v.id, v => `${v.plate} — ${v.model || ''}`, 'بدون')}</select></label>
        <label class="fld">رقم رخصة القيادة<input class="input" id="dLicense" dir="ltr" value="${esc(p.licenseNo || '')}"></label>
        <label class="fld">تاريخ انتهاء الرخصة<input class="input" id="dLicenseExp" type="date" value="${esc(p.licenseExpiry || '')}"></label>
        <label class="fld full">ملاحظات<textarea class="input" id="dNotes" rows="2">${esc(p.notes || '')}</textarea></label>
        <label class="check full"><input type="checkbox" id="dActive" ${p.active !== false ? 'checked' : ''}><span>السواق شغال<small>لو شلت العلامة: موبايله هيخرج من التطبيق فوراً</small></span></label>
        ${!pid ? '<p class="muted small full">هياخد كود ثابت أوتوماتيك. الرقم السري الأول 1234 (بيستخدمه لتغيير ميعاد صحيانه). بعد الحفظ هيطلعلك كود تفعيل لموبايله.</p>' : ''}
      </div>`, () => save(pid, p), { wide: true, saveLabel: pid ? 'حفظ' : 'إضافة' });
    const fillLines = keep => {
      const fid = U.val('dFactory'), sel = TP.$('#dLine');
      const lines = D.lines.filter(l => l.factoryId === fid && l.active !== false);
      const want = keep ? (cur ? cur.id : '') : '';
      sel.innerHTML = `<option value="">لسه مالوش خط</option>` + lines.map(l => {
        const other = l.driverId && l.driverId !== pid ? ` — عليه ${TP.q.dname(l.driverId)}` : '';
        return `<option value="${esc(l.id)}" ${l.id === want ? 'selected' : ''}>${esc(l.name + other)}</option>`;
      }).join('');
    };
    const sync = () => {
      const k = U.val('dKind');
      TP.$('#dKindNote').textContent = (TP.DRIVER_KINDS.find(x => x.id === k) || {}).note || '';
      TP.$('#dLineBox').hidden = k !== 'line';
    };
    TP.$('#dKind').onchange = sync;
    TP.$('#dFactory').onchange = () => fillLines(false);
    fillLines(true); sync();
    // photo: kept apart from the person (cardPhotos/), loaded only here
    photo = { current: null, next: undefined };
    const prev = TP.$('#dPhotoPrev'), rm = TP.$('#dPhotoRm');
    const show = src => { prev.innerHTML = src ? `<img src="${esc(src)}" alt="">` : TP.icon('user', 34); rm.hidden = !src; };
    if (pid) TP.fb.get('cardPhotos/' + pid).then(d => { photo.current = d && d.photo; if (photo.next === undefined) show(photo.current); }).catch(() => {});
    TP.$('#dPhoto').onchange = async e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try { photo.next = await TP.compressImage(f, 360, 0.75, true); show(photo.next); } catch (err) { TP.toast('الصورة مش مقروءة', 'warn'); }
    };
    rm.onclick = () => { photo.next = null; show(null); };
  }
  let photo = { current: null, next: undefined };

  /** What a customer sees: name, code, the car (and the photo, kept in cardPhotos/). */
  function cardFor(p) {
    const line = D.lines.find(l => l.driverId === p.id && l.active !== false);
    const v = TP.q.vehicle(p.vehicleId) || (line && TP.q.vehicle(line.vehicleId));
    return { name: p.name || '', code: p.code || null, car: v ? { model: v.model || '', color: v.color || '', plate: v.plate || '' } : null };
  }
  const sameCard = (a, b) => !!a && a.name === b.name && (a.code || null) === (b.code || null) && JSON.stringify(a.car || null) === JSON.stringify(b.car || null);
  /** Keeps every driver's card in step with his name, code and car (cheap: only differences are written). */
  let syncing = false;
  TP.actions.syncCards = async function () {
    if (syncing || !(S.can('drivers.manage') || S.can('vehicles.manage')) || !D.loaded.people || !D.loaded.cards || !D.loaded.vehicles || !D.loaded.lines) return;
    const ops = [];
    TP.q.drivers().forEach(p => { const want = cardFor(p), have = D.cards.find(c => c.id === p.id); if (!sameCard(have, want)) ops.push({ op: 'set', path: 'cards/' + p.id, data: Object.assign(want, { updatedAt: TP.fb.ts() }), merge: true }); });
    if (!ops.length) return;
    syncing = true;
    try { for (let i = 0; i < ops.length; i += 400) await TP.fb.batch(ops.slice(i, i + 400)); } catch (e) { console.warn('cards', e); } finally { syncing = false; }
  };

  async function save(pid, old) {
    const name = U.val('dName'), phone = TP.latinDigits(U.val('dPhone'));
    if (!name) { TP.toast('اكتب اسم السواق'); return false; }
    if (phone && !/^\+?[\d\s-]{8,15}$/.test(phone)) { TP.toast('رقم الموبايل مش مظبوط'); return false; }
    if (phone && D.people.some(x => x.id !== pid && x.type === 'driver' && x.phone === phone)) { TP.toast('في سواق تاني بنفس الموبايل'); return false; }
    const kind = U.val('dKind');
    const id = pid || TP.newId('P');
    // read the whole form first (a confirmation below replaces the dialog)
    const person = { id, type: 'driver', perms: [], name, nameEn: U.val('dNameEn').slice(0, 60), phone, driverKind: kind, vehicleId: U.val('dVehicle'), licenseNo: U.val('dLicense'), licenseExpiry: U.val('dLicenseExp'), notes: U.val('dNotes'), active: U.checked('dActive') };
    const wantFactory = U.val('dFactory'), wantLineSel = U.val('dLine');
    // fixed line: factory + line (or "no line yet")
    const lineOps = [];
    let lineMsg = '';
    if (S.can('lines.manage')) {
      const wantLine = kind === 'line' ? wantLineSel : '';
      if (kind === 'line' && !wantFactory) { TP.toast('اختار مصنع سواق الخط'); return false; }
      const target = wantLine ? TP.q.line(wantLine) : null;
      if (target && target.driverId && target.driverId !== id) {
        if (!(await TP.confirm('الخط عليه سواق', `خط "${target.name}" عليه ${TP.q.dname(target.driverId)}. لو كملت هيتنقل لـ ${name} و${TP.q.dname(target.driverId)} هيبقى من غير خط.`, 'أيوه، انقله'))) return false;
      }
      if (target && target.driverId !== id) lineOps.push({ op: 'update', path: 'lines/' + target.id, data: { driverId: id, updatedAt: TP.fb.ts() } });
      D.lines.filter(l => l.driverId === id && l.id !== wantLine).forEach(l => {
        lineOps.push({ op: 'update', path: 'lines/' + l.id, data: { driverId: '', updatedAt: TP.fb.ts() } });
        lineMsg = ` — اتشال من خط ${l.name}`;
      });
    }
    const data = Object.assign({}, person, { updatedAt: TP.fb.ts() });
    delete data.id;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ops = [];
      let code = old && old.code;
      if (!pid) {
        code = nextCode() + attempt;
        ops.push({ op: 'set', path: 'people/' + id, data: Object.assign({}, data, { code, createdAt: TP.fb.ts(), createdBy: S.person.name, pinIsDefault: true }) });
        ops.push({ op: 'set', path: 'driverCodes/' + code, data: { personId: id, at: TP.fb.ts() } });
        ops.push({ op: 'set', path: 'pins/' + id, data: await TP.pinDoc(id, '1234') });
      } else {
        ops.push({ op: 'update', path: 'people/' + id, data });
        ops.push(...TP.actions.deviceSyncOps(person));
      }
      ops.push(...lineOps);
      if (photo.next !== undefined) {
        if (photo.next) ops.push({ op: 'set', path: 'cardPhotos/' + id, data: { photo: photo.next, at: TP.fb.ts() } }, { op: 'set', path: 'cards/' + id, data: { hasPhoto: true }, merge: true });
        else if (pid) ops.push({ op: 'delete', path: 'cardPhotos/' + id }, { op: 'set', path: 'cards/' + id, data: { hasPhoto: false }, merge: true });
      }
      try { await TP.fb.batch(ops); }
      catch (e) { if (!pid && /permission/i.test(e.code || e.message || '') && attempt < 2) continue; throw e; }   // code taken meanwhile → next one
      TP.audit(pid ? 'driver.update' : 'driver.create', (code ? code + ' ' : '') + name, TP.driverKindName(kind) + lineMsg);
      if (lineOps.length) { const today2 = TP.dayKey(TP.now()); TP.wakeTouch && TP.wakeTouch([today2, TP.ops.addDays(today2, 1)]); }
      TP.toast((pid ? 'تم الحفظ ✓' : `تم ✓ — كود السواق ${code}`) + lineMsg);
      if (!pid && person.active && S.can('devices.manage')) setTimeout(() => TP.actions.newCode(id, { quiet: true }).catch(() => {}), 400);
      return;
    }
  }

  /** Drivers added before codes existed get theirs once, in the order they were added. */
  let backfilling = false;
  async function backfillCodes() {
    if (backfilling || !S.can('drivers.manage') || !D.loaded.people || !D.loaded.driverCodes) return;
    const missing = TP.q.drivers().filter(p => !p.code).sort((a, b) => ((TP.toDate(a.createdAt) || 0) - (TP.toDate(b.createdAt) || 0)));
    if (!missing.length) return;
    backfilling = true;
    try {
      let next = nextCode();
      const ops = [];
      missing.forEach(p => {
        ops.push({ op: 'update', path: 'people/' + p.id, data: { code: next } });
        ops.push({ op: 'set', path: 'driverCodes/' + next, data: { personId: p.id, at: TP.fb.ts() } });
        next++;
      });
      await TP.fb.batch(ops);
      TP.audit('driver.codes', `${missing.length} سواق`, 'أكواد للسواقين القدام');
      TP.toast(`اتعمل كود لـ ${missing.length} سواق ✓`);
    } catch (e) { console.warn('codes', e); }
    finally { backfilling = false; }
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
    await TP.fb.batch([...TP.q.devicesOf(pid).map(d => ({ op: 'delete', path: 'devices/' + d.id })), { op: 'delete', path: 'pins/' + pid }, { op: 'delete', path: 'people/' + pid }, { op: 'delete', path: 'cards/' + pid }, { op: 'delete', path: 'cardPhotos/' + pid }]);
    TP.audit('driver.delete', p.name);
  }

  TP.views.drivers = {
    deps: ['people', 'devices', 'lines', 'vehicles', 'driverCodes', 'companies', 'cards'],
    render(root) {
      TP.actions.syncCards();
      const q = U.norm(U.filters.drivers || '');
      let list = TP.q.drivers(state.kind || null);
      if (q) list = list.filter(p => U.norm(p.name).includes(q) || String(p.phone || '').includes(q) || String(p.code || '') === q.trim());
      list = list.slice().sort((a, b) => (Number(a.code) || 9e9) - (Number(b.code) || 9e9));
      backfillCodes();
      const counts = k => TP.q.drivers(k).length;
      root.innerHTML = `
        <section class="card">
          <div class="toolbar">
            <div class="chips"><button class="chip ${!state.kind ? 'active' : ''}" data-k="">الكل (${counts(null)})</button>${TP.DRIVER_KINDS.map(k => `<button class="chip ${state.kind === k.id ? 'active' : ''}" data-k="${k.id}">${esc(k.name)} (${counts(k.id)})</button>`).join('')}</div>
            <div class="toolbar-end">${U.filterBox('drvQ', 'بحث بالاسم أو الموبايل أو الكود', U.filters.drivers)}
              <button class="btn btn-primary" id="addD">${TP.icon('plus', 18)}إضافة سواق</button></div>
          </div>
          ${list.length ? `<div class="table-wrap"><table class="tbl">
            <thead><tr><th>السواق</th><th>النوع</th><th>الخط</th><th>العربية</th><th>الرخصة</th><th>الموبايل/التطبيق</th><th></th></tr></thead>
            <tbody>${list.map(p => {
              const lines = D.lines.filter(l => l.driverId === p.id), v = TP.q.vehicle(p.vehicleId), devs = TP.q.devicesOf(p.id), on = devs.some(TP.q.online);
              return `<tr>
                <td>${U.who(p.name, `${p.code ? `<span class="tag gold">${esc(p.code)}</span> ` : ''}<span dir="ltr">${esc(p.phone || '')}</span>${(D.cards.find(c => c.id === p.id) || {}).hasPhoto ? ' · 📷' : ''}`, p.active === false)}${p.active === false ? '<span class="st st-off">موقوف</span>' : ''}</td>
                <td>${esc(TP.driverKindName(p.driverKind))}</td>
                <td>${lines.length ? lines.map(l => `<span class="tag">${esc(l.name)}</span>`).join('') : p.driverKind === 'line' ? '<span class="st st-warn">لسه مالوش خط</span>' : '<span class="muted small">—</span>'}</td>
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
