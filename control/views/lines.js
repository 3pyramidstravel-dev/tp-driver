/* ==========================================================================
   Fixed lines: points (each with its customers & location) → factory
   A new or substitute driver gets everything from here.
   Every customer has a permanent link (c/#token → track/{sha256(token)}) sent once by WhatsApp:
   it shows him his car coming, "العربية وصلت", and lets him say "مش راكب".
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const D = TP.D, U = TP.ui, O = TP.ops;
  const MAX_POINTS = 10;
  const state = { factory: '' };
  const maxCust = () => Math.max(1, Number(D.settings.maxCustomersPerCar) || 3);

  /* ---------- points editor (inside the modal) ---------- */
  let points = [];
  function readPoints() {
    TP.$$('.point[data-i]').forEach(el => {
      const i = Number(el.dataset.i);
      const custs = TP.$$('.cust-row', el).map(r => ({
        id: r.dataset.id || '', h: r.dataset.h || '',
        name: r.querySelector('[data-c=name]').value.trim(), phone: TP.latinDigits(r.querySelector('[data-c=phone]').value.trim()),
        homeText: r.querySelector('[data-c=home]').value.trim()
      }));
      points[i] = { name: el.querySelector('[data-f=name]').value.trim(), locText: el.querySelector('[data-f=loc]').value.trim(), customers: custs };
    });
  }
  const totalCust = () => points.reduce((a, p) => a + (p.customers || []).length, 0);
  function custRow(c, i, ci) {
    return `<div class="cust-row" data-id="${esc(c.id || '')}" data-h="${esc(c.h || '')}">
      <input class="input" data-c="name" placeholder="اسم العميل" value="${esc(c.name || '')}" maxlength="60">
      <input class="input" data-c="phone" placeholder="الموبايل" inputmode="tel" dir="ltr" value="${esc(c.phone || '')}" maxlength="16">
      <input class="input" data-c="home" placeholder="لوكيشن البيت (اختياري)" dir="ltr" value="${esc(c.homeText || '')}">
      <button type="button" class="icon-btn danger" title="شيل العميل" data-rmc="${i}|${ci}">${TP.icon('trash', 16)}</button></div>`;
  }
  function drawPoints(factory) {
    const box = TP.$('#pBox'), full = totalCust() >= maxCust();
    box.innerHTML = `<div class="banner ${full ? 'warn' : 'info'}" style="margin-bottom:10px">${TP.icon('users')}<span class="grow">العملاء في العربية: <b>${totalCust()}</b> من ${maxCust()} (عربية ملاكي)</span></div>` + points.map((p, i) => `
      <div class="point" data-i="${i}">
        <div class="point-head"><span class="point-no">${i + 1}</span>
          <input class="input" data-f="name" placeholder="اسم النقطة (مثال: ميدان الحصري)" value="${esc(p.name || '')}">
          <button type="button" class="icon-btn" title="لفوق" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-btn" title="لتحت" data-down="${i}" ${i === points.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="icon-btn danger" title="حذف النقطة" data-rm="${i}">${TP.icon('trash', 16)}</button></div>
        <label class="fld">لوكيشن النقطة<input class="input" data-f="loc" dir="ltr" placeholder="لينك جوجل ماب أو 30.29, 31.74" value="${esc(p.locText || '')}"><span data-loccheck></span></label>
        <div class="cust-box"><div class="muted small" style="font-weight:800;margin:8px 0 6px">العملاء في النقطة دي</div>
          ${(p.customers || []).map((c, ci) => custRow(c, i, ci)).join('')}
          <button type="button" class="link" data-addc="${i}" ${full ? 'disabled title="العربية مليانة"' : ''}>+ عميل</button></div>
      </div>`).join('') + `
      <div class="point factory"><div class="point-head"><span class="point-no">${TP.icon('factory', 16)}</span><b>الوجهة: ${esc((factory && factory.name) || 'المصنع')}</b></div>
        ${factory ? U.mapLink(factory.location, 'لوكيشن المصنع') : '<span class="muted small">اختار المصنع</span>'}</div>
      ${points.length < MAX_POINTS ? '<button type="button" class="btn btn-ghost" id="pAdd">+ إضافة نقطة</button>' : ''}`;
    const check = el => {
      const span = el.parentElement.querySelector('[data-loccheck]'), raw = el.value.trim(), loc = TP.parseLocation(raw);
      span.innerHTML = !raw ? '<small class="muted">بدون لوكيشن — السواق الجديد مش هيعرف يوصل، والعميل مش هيعرف العربية قربت</small>' : loc ? `<small>${U.mapLink(loc, 'جرّب')}</small>` : '<small style="color:var(--danger)">مش مقروء</small>';
    };
    box.querySelectorAll('[data-f=loc]').forEach(el => { el.oninput = () => check(el); check(el); });
    const redraw = () => drawPoints(TP.q.company(U.val('lFactory')));
    const act = (sel, fn) => box.querySelectorAll(sel).forEach(b => b.onclick = () => { readPoints(); fn(Object.values(b.dataset)[0]); redraw(); });
    act('[data-rm]', i => points.splice(Number(i), 1));
    act('[data-up]', i => { i = Number(i); [points[i - 1], points[i]] = [points[i], points[i - 1]]; });
    act('[data-down]', i => { i = Number(i); [points[i + 1], points[i]] = [points[i], points[i + 1]]; });
    act('[data-addc]', i => { if (totalCust() < maxCust()) (points[Number(i)].customers = points[Number(i)].customers || []).push({}); else TP.toast(`العربية فيها ${maxCust()} عملاء بس`); });
    act('[data-rmc]', v => { const [i, ci] = v.split('|').map(Number); points[i].customers.splice(ci, 1); });
    const add = TP.$('#pAdd');
    if (add) add.onclick = () => { readPoints(); points.push({ customers: [] }); redraw(); };
  }

  function openEditor(lid) {
    const l = lid ? TP.q.line(lid) : { factoryId: state.factory || '', active: true, points: [{}] };
    if (!l) return;
    points = (l.points || []).map(p => ({ name: p.name, locText: U.locText(p.location),
      customers: O.custsOf(p).map(c => ({ id: c.id || '', h: c.h || '', name: c.name || '', phone: c.phone || '', homeText: U.locText(c.home) })) }));
    if (!points.length) points = [{ customers: [] }];
    const lineDrivers = TP.q.drivers('line').filter(p => p.active !== false);
    TP.openModal(lid ? 'تعديل خط ' + l.name : 'إضافة خط', `
      <div class="form-grid">
        <label class="fld">اسم الخط<input class="input" id="lName" value="${esc(l.name || '')}" placeholder="مثال: خط العاشر 1"></label>
        <label class="fld">المصنع<select class="input" id="lFactory">${U.opts(D.companies, l.factoryId, c => c.id, c => c.name, 'اختار المصنع')}</select></label>
        <label class="fld">السواق<select class="input" id="lDriver">${U.opts(lineDrivers, l.driverId, p => p.id, p => TP.driverLabel(p), 'بدون سواق')}</select></label>
        <label class="fld">العربية<select class="input" id="lVehicle">${U.opts(D.vehicles.filter(v => v.active !== false), l.vehicleId, v => v.id, v => `${v.plate} — ${v.model || ''}`, 'بدون عربية')}</select></label>
        <label class="fld">ميعاد أول نقطة الصبح<input class="input" id="lMorning" type="time" value="${esc(l.morningTime || '')}"></label>
        <label class="fld">ميعاد الرجوع من المصنع<input class="input" id="lEvening" type="time" value="${esc(l.eveningTime || '')}"></label>
        <div class="full"><h4 style="margin:6px 0 10px;color:var(--maroon-2)">النقط بالترتيب وعملاء كل نقطة</h4><div class="points" id="pBox"></div></div>
        <label class="fld full">ملاحظات للسواق<textarea class="input" id="lNotes" rows="2">${esc(l.notes || '')}</textarea></label>
        <label class="check full"><input type="checkbox" id="lActive" ${l.active !== false ? 'checked' : ''}><span>الخط شغال</span></label>
      </div>`, () => save(lid), { wide: true, saveLabel: lid ? 'حفظ' : 'إضافة' });
    drawPoints(TP.q.company(l.factoryId));
    TP.$('#lFactory').onchange = () => { readPoints(); drawPoints(TP.q.company(U.val('lFactory'))); };
  }

  /** The fixed part of a customer's link document (the car's part is written by the driver's phone). */
  function trackStatic(line, lid, c, i, p) {
    const f = TP.q.company(line.factoryId) || {};
    const loc = p.location && isFinite(p.location.lat) ? { lat: p.location.lat, lng: p.location.lng } : null;
    return { kind: 'line', custId: c.id, name: c.name, lineId: lid, lineName: line.name, factoryId: line.factoryId, factoryName: f.name || '',
      pointIdx: i, pointName: p.name, pointLoc: loc, morningTime: line.morningTime || '', eveningTime: line.eveningTime || '', updatedAt: TP.fb.ts() };
  }
  /** Line + every customer link in one batch (removed customers lose their link). `fresh` = { h: token } of new customers. */
  TP.actions.lineSaveOps = function (lid, data, oldLine, fresh) {
    const ops = [{ op: 'set', path: 'lines/' + lid, data, merge: true }];
    const keep = new Set();
    (data.points || []).forEach((p, i) => (p.customers || []).forEach(c => {
      keep.add(c.h);
      const isNew = !(oldLine && O.lineCustomers(oldLine).some(x => x.h === c.h));
      ops.push({ op: 'set', path: 'track/' + c.h, data: Object.assign(trackStatic(data, lid, c, i, p), isNew ? { st: 'idle', seq: 0, createdAt: TP.fb.ts() } : {}), merge: true });
      if (fresh && fresh[c.h]) ops.push(TP.cust.linkOp(c.h, fresh[c.h], { kind: 'line', custId: c.id, lineId: lid }));
    }));
    if (oldLine) O.lineCustomers(oldLine).forEach(c => { if (c.h && !keep.has(c.h)) ops.push(...TP.cust.dropOps(c.h)); });
    return ops;
  };

  async function save(lid) {
    readPoints();
    const name = U.val('lName'), factoryId = U.val('lFactory');
    if (!name) { TP.toast('اكتب اسم الخط'); return false; }
    if (!factoryId) { TP.toast('اختار المصنع'); return false; }
    if (totalCust() > maxCust()) { TP.toast(`العربية فيها ${maxCust()} عملاء بس`); return false; }
    const clean = [], fresh = {};
    for (let i = 0; i < points.length; i++) {
      const p = points[i], custs = (p.customers || []).filter(c => c.name || c.phone || c.homeText);
      if (!p.name && !p.locText && !custs.length) continue;
      if (!p.name) { TP.toast(`اكتب اسم النقطة رقم ${i + 1}`); return false; }
      const loc = p.locText ? TP.parseLocation(p.locText) : null;
      if (p.locText && !loc) { TP.toast(`لوكيشن نقطة "${p.name}" مش مقروء`); return false; }
      const customers = [];
      for (const c of custs) {
        if (!c.name) { TP.toast(`اكتب اسم العميل في نقطة "${p.name}"`); return false; }
        if (c.phone && !TP.phoneIntl(c.phone)) { TP.toast(`موبايل ${c.name} مش مظبوط`); return false; }
        const home = c.homeText ? TP.parseLocation(c.homeText) : null;
        if (c.homeText && !home) { TP.toast(`لوكيشن بيت ${c.name} مش مقروء`); return false; }
        let h = c.h;
        if (!h) { const k = await TP.cust.newLink(); h = k.h; fresh[h] = k.token; }
        customers.push({ id: c.id || TP.newId('C'), h, name: c.name.slice(0, 60), phone: c.phone || '', home: home || null });
      }
      clean.push({ name: p.name, location: loc, customers });
    }
    if (!clean.length) { TP.toast('ضيف نقطة واحدة على الأقل'); return false; }
    const driverId = U.val('lDriver');
    const form = { vehicleId: U.val('lVehicle') || '', morningTime: U.val('lMorning'), eveningTime: U.val('lEvening'), notes: U.val('lNotes'), active: U.checked('lActive') };
    const clash = driverId && D.lines.find(x => x.id !== lid && x.driverId === driverId && x.active !== false);
    if (clash && !(await TP.confirm('السواق على خط تاني', `${(TP.q.person(driverId) || {}).name} متسجل على خط "${clash.name}". تكمل؟`, 'أيوه، كمّل'))) return false;
    const data = Object.assign({ name, factoryId, driverId: driverId || '', points: clean, updatedAt: TP.fb.ts() }, form);
    if (!lid) data.createdAt = TP.fb.ts();
    const id = lid || TP.newId('L');
    await TP.fb.batch(TP.actions.lineSaveOps(id, data, lid ? TP.q.line(lid) : null, fresh));
    TP.audit(lid ? 'line.update' : 'line.create', name, `${clean.length} نقط · ${clean.reduce((a, p) => a + p.customers.length, 0)} عميل`);
    { const today2 = TP.dayKey(TP.now()); TP.wakeTouch && TP.wakeTouch([today2, O.addDays(today2, 1)]); }
    TP.toast('تم حفظ الخط ✓');
  }

  async function remove(lid) {
    const l = TP.q.line(lid);
    if (!l || !(await TP.confirm('حذف الخط', `هيتحذف خط ${l.name} ولينكات عملائه هتقف. لو مؤقتاً متوقف، الأفضل تشيل علامة "الخط شغال".`, 'حذف', true))) return;
    await TP.fb.batch([{ op: 'delete', path: 'lines/' + lid }].concat(...O.lineCustomers(l).filter(c => c.h).map(c => TP.cust.dropOps(c.h))));
    TP.audit('line.delete', l.name);
  }

  /** The WhatsApp message that carries the customer's link. */
  TP.actions.custMessage = (name, token, what) => `أهلاً ${String(name || '').split(' ')[0]} 👋\nده لينك ${what || 'عربيتك'} من Three Pyramids Travel:\n${TP.custUrl(token)}\nافتحه ودوس "فعّل الإشعارات" — هيوصلك لما العربية تتحرك ليك ولما توصل.`;
  TP.actions.copy = function (text) {
    const done = () => TP.toast('اتنسخ ✓');
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done, () => TP.toast(text));
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); done(); } catch (e) { TP.toast(text); } t.remove();
  };
  /** Links of every customer of a line. */
  async function openLinks(lid) {
    const l = TP.q.line(lid); if (!l) return;
    const tok = await TP.cust.tokens(O.lineCustomers(l));
    const list = O.lineCustomers(l).filter(c => tok[c.h]).map(c => Object.assign({}, c, { token: tok[c.h] }));
    TP.openModal('لينكات عملاء ' + l.name, list.length ? `<p class="muted small" style="margin-bottom:10px">كل عميل ليه لينك ثابت — بيتبعت مرة واحدة بس. اللينك بيوري رحلته هو بس، من غير أسعار.</p>
      <div class="table-wrap"><table class="tbl"><tbody>${list.map(c => {
        const wa = TP.waLink(c.phone, TP.actions.custMessage(c.name, c.token));
        return `<tr><td><b>${esc(c.name)}</b><div class="muted small">${esc(c.pointName)} · <span dir="ltr">${esc(c.phone || 'من غير موبايل')}</span></div></td>
          <td class="acts"><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(TP.custUrl(c.token))}">${TP.icon('copy', 16)}انسخ</button>
          ${wa ? `<a class="btn btn-primary btn-sm" href="${esc(wa)}" target="_blank" rel="noopener">واتساب</a>` : ''}
          <a class="icon-btn" href="${esc(TP.custUrl(c.token))}" target="_blank" rel="noopener" title="افتح">${TP.icon('external', 16)}</a></td></tr>`;
      }).join('')}</tbody></table></div>` : U.empty('الخط ده مفيهوش عملاء لسه — ضيفهم من تعديل الخط'), null, { noSave: true, wide: true });
    TP.$$('#tp-modal [data-copy]').forEach(b => b.onclick = () => TP.actions.copy(b.dataset.copy));
  }

  TP.views.lines = {
    deps: ['lines', 'companies', 'people', 'vehicles', 'settings'],
    render(root) {
      const q = U.norm(U.filters.lines || '');
      let list = D.lines.filter(l => !state.factory || l.factoryId === state.factory);
      if (q) list = list.filter(l => U.norm(l.name).includes(q) || U.norm((TP.q.person(l.driverId) || {}).name).includes(q) || O.lineCustomers(l).some(c => U.norm(c.name).includes(q) || String(c.phone || '').includes(q)));
      root.innerHTML = `
        <section class="card">
          <div class="toolbar">
            <div class="chips"><button class="chip ${!state.factory ? 'active' : ''}" data-f="">كل المصانع</button>${D.companies.map(c => `<button class="chip ${state.factory === c.id ? 'active' : ''}" data-f="${c.id}">${esc(c.name)}</button>`).join('')}</div>
            <div class="toolbar-end">${U.filterBox('linesQ', 'بحث بالخط أو السواق أو العميل', U.filters.lines)}
              <button class="btn btn-primary" id="addL" ${D.companies.length ? '' : 'disabled title="ضيف المصانع الأول"'}>${TP.icon('plus', 18)}إضافة خط</button></div>
          </div>
          ${list.length ? `<div class="table-wrap"><table class="tbl">
            <thead><tr><th>الخط</th><th>المصنع</th><th>السواق</th><th>العربية</th><th>المواعيد</th><th>النقط والعملاء</th><th></th></tr></thead>
            <tbody>${list.map(l => {
              const d = TP.q.person(l.driverId), v = TP.q.vehicle(l.vehicleId), f = TP.q.company(l.factoryId);
              const custs = O.lineCustomers(l), noPhone = custs.filter(c => !c.phone).length;
              const noLoc = (l.points || []).filter(p => !p.location).length;
              return `<tr>
                <td><b>${esc(l.name)}</b>${l.active === false ? ' <span class="st st-off">متوقف</span>' : ''}</td>
                <td>${esc(f ? f.name : '—')}</td>
                <td>${d ? esc(TP.driverLabel(d)) : '<span class="st st-warn">بدون سواق</span>'}</td>
                <td class="mono">${v ? esc(v.plate) : '—'}</td>
                <td class="small">الصبح ${esc(l.morningTime || '—')}<br>الرجوع ${esc(l.eveningTime || '—')}</td>
                <td class="small">${(l.points || []).length} نقط · ${custs.length} عميل${noLoc ? `<br><span class="st st-warn">${noLoc} بدون لوكيشن</span>` : ''}${noPhone ? `<br><span class="st st-warn">${noPhone} من غير موبايل</span>` : ''}</td>
                <td class="acts"><button class="icon-btn" title="لينكات العملاء" data-links="${l.id}">${TP.icon('external', 16)}</button><button class="icon-btn" title="تعديل" data-edit="${l.id}">${TP.icon('edit', 16)}</button><button class="icon-btn danger" title="حذف" data-del="${l.id}">${TP.icon('trash', 16)}</button></td></tr>`;
            }).join('')}</tbody></table></div>` : U.empty(D.companies.length ? 'مفيش خطوط هنا لسه' : 'ضيف المصانع الأول من صفحة المصانع')}
        </section>`;
      U.bindFilter(root, 'linesQ', 'lines');
      root.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.factory = b.dataset.f; TP.rerender(); });
      root.querySelector('#addL').onclick = () => openEditor(null);
      root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
      root.querySelectorAll('[data-links]').forEach(b => b.onclick = () => openLinks(b.dataset.links).catch(e => TP.toast(TP.errorText(e), 'warn')));
      root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remove(b.dataset.del).catch(e => TP.toast(TP.errorText(e), 'warn')));
    }
  };
})(window.TP = window.TP || {});
