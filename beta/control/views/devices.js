/* ==========================================================================
   Devices & access: activation codes, approval of new devices, who is online
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui;
  const CODE_MINUTES = 10;
  const KIND = { staff: 'غرفة التحكم', driver: 'تطبيق السائق', hr: 'بوابة المصنع' };
  const shortId = uid => String(uid || '').slice(-6).toUpperCase();
  const personSub = p => !p ? '' : p.type === 'driver' ? TP.driverKindName(p.driverKind) : p.type === 'hr' ? 'HR — ' + esc((TP.q.company(p.factoryId) || {}).name || '') : esc((TP.ROLES.find(r => r.id === p.role) || {}).name || 'موظف');

  /* ======================= actions ======================= */
  TP.actions = TP.actions || {};

  /** Creates a one-time 3-digit code valid for 10 minutes. */
  TP.actions.newCode = async function (pid, opts) {
    let p = TP.q.person(pid);
    for (let i = 0; !p && i < 15; i++) { await new Promise(r => setTimeout(r, 200)); p = TP.q.person(pid); } // just-created person may still be arriving
    if (!p) return TP.toast('الحساب لسه بيتحفظ — جرّب تاني', 'warn');
    if (p.active === false) return TP.toast('الحساب موقوف — فعّله الأول', 'warn');
    const busy = new Set(D.codes.filter(c => !c.used && c.expiresAtMs > Date.now()).map(c => c.code));
    let code = TP.newCode(), guard = 0;
    while (busy.has(code) && guard++ < 50) code = TP.newCode();
    const now = Date.now();
    // An older open code for the same person is closed first.
    const ops = D.codes.filter(c => c.personId === pid && !c.used && c.expiresAtMs > now)
      .map(c => ({ op: 'update', path: 'activationCodes/' + c.id, data: { used: true, cancelled: true } }));
    const id = TP.newId('C');
    ops.push({ op: 'set', path: 'activationCodes/' + id, data: { code, personId: pid, personName: p.name, kind: p.type, createdAt: TP.fb.ts(), createdAtMs: now, expiresAtMs: now + CODE_MINUTES * 60000, used: false, createdBy: S.person.name } });
    await TP.fb.batch(ops);
    TP.audit('activation.code', p.name, 'كود تفعيل جديد');
    const busy2 = TP.$('#tp-modal') && TP.$('#tp-modal').classList.contains('show');
    if (busy2 && opts && opts.quiet) TP.toast(`اتعمل كود تفعيل لـ ${p.name} — تلاقيه في "الأجهزة والدخول"`);
    else TP.actions.showCode(id);
  };

  TP.actions.showCode = function (cid) {
    const c = D.codes.find(x => x.id === cid);
    const render = () => {
      const cc = D.codes.find(x => x.id === cid) || c;
      if (!cc) return '';
      const left = Math.max(0, (cc.expiresAtMs || 0) - Date.now());
      const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
      return `<p class="modal-text" style="text-align:center">كود تفعيل <b>${esc(cc.personName)}</b> — يتكتب مرة واحدة على الجهاز اللي هيستخدمه.</p>
        <div class="code-big">${String(cc.code).split('').map(d => `<span>${d}</span>`).join('')}</div>
        <div class="countdown" id="cdown">${cc.used ? 'تم استخدامه' : left ? `ينتهي بعد ${mm}:${String(ss).padStart(2, '0')}` : 'انتهى'}</div>
        <p class="muted small" style="text-align:center;margin-top:8px">بعد ما يكتبه، هيظهرلك طلب الجهاز في "طلبات التفعيل" عشان توافق عليه.</p>`;
    };
    TP.openModal('كود التفعيل', render(), null, { noSave: true, cancelLabel: 'تمام' });
    const seq = TP.$('#tp-modal').dataset.seq;
    const t = setInterval(() => {
      const m = TP.$('#tp-modal');
      if (!m || !m.classList.contains('show') || m.dataset.seq !== seq) return clearInterval(t);
      const body = TP.$('#tp-modal-body'); if (body) body.innerHTML = render();
    }, 1000);
  };

  TP.actions.cancelCode = async function (cid) {
    await TP.fb.update('activationCodes/' + cid, { used: true, cancelled: true });
    TP.toast('تم إلغاء الكود');
  };

  /** Approve: create the device with exactly the person's permissions. */
  TP.actions.approve = async function (uid) {
    const req = D.requests.find(r => r.id === uid);
    const p = req && TP.q.person(req.personId);
    if (!req || !p) return TP.toast('الطلب مش موجود', 'warn');
    const code = D.codes.find(c => c.personId === p.id && c.code === req.code && !c.used);
    const dev = { personId: p.id, name: p.name, kind: p.type, perms: p.perms || [], active: true, approvedAt: TP.fb.ts(), approvedBy: S.person.name, approvedAtMs: Date.now() };
    if (p.factoryId) dev.factoryId = p.factoryId;
    if (p.driverKind) dev.driverKind = p.driverKind;
    const ops = [{ op: 'set', path: 'devices/' + uid, data: dev }, { op: 'delete', path: 'activationRequests/' + uid }];
    if (code) ops.push({ op: 'update', path: 'activationCodes/' + code.id, data: { used: true, usedBy: uid, usedAtMs: Date.now() } });
    await TP.fb.batch(ops);
    TP.audit('device.approve', p.name, 'جهاز ' + shortId(uid));
    TP.toast('تمت الموافقة — ' + p.name + ' دخل ✓');
  };

  TP.actions.reject = async function (uid) {
    const req = D.requests.find(r => r.id === uid);
    await TP.fb.update('activationRequests/' + uid, { status: 'rejected' });
    TP.audit('device.reject', (req && req.personName) || shortId(uid), 'جهاز ' + shortId(uid));
    TP.toast('تم رفض الطلب');
  };

  TP.actions.removeDevice = async function (uid) {
    const d = D.devices.find(x => x.id === uid);
    if (!d) return;
    if (uid === S.uid) return TP.toast('مينفعش تشيل الجهاز اللي إنت فاتح منه', 'warn');
    if (!(await TP.confirm('إزالة الجهاز', `الجهاز ده هيخرج فوراً من النظام (${d.name}). عشان يدخل تاني لازم كود تفعيل جديد وموافقة.`, 'إزالة', true))) return;
    await TP.fb.remove('devices/' + uid);
    TP.audit('device.remove', d.name, 'جهاز ' + shortId(uid));
    TP.toast('تمت إزالة الجهاز');
  };

  /* ---------- auto-check new requests against open codes (runs on any open control screen) ---------- */
  const checking = new Set();
  document.addEventListener('tp:data', e => {
    if (!S.can('devices.manage') || (e.detail !== 'requests' && e.detail !== 'codes') || !D.loaded.codes || !D.loaded.people) return;
    const key = r => r.id + ':' + r.attempts + ':' + r.code + ':' + ((TP.toDate(r.updatedAt) || TP.toDate(r.createdAt) || 0) - 0);
    D.requests.filter(r => r.status === 'pending' && !checking.has(key(r))).forEach(r => {
      checking.add(key(r));
      const c = D.codes.find(x => x.code === r.code && !x.used && x.expiresAtMs > Date.now());
      const p = c && TP.q.person(c.personId);
      const patch = (c && p && p.active !== false) ? { status: 'matched', personId: p.id, personName: p.name, codeId: c.id } : { status: 'invalid' };
      TP.fb.update('activationRequests/' + r.id, patch).catch(err => console.warn('match', err));
    });
  });

  /* ======================= view ======================= */
  const state = { tab: 'all' };

  TP.views.devices = {
    deps: ['devices', 'codes', 'requests', 'people', 'companies'],
    render(root) {
      const manage = S.can('devices.manage');
      const reqs = D.requests.filter(r => r.status === 'matched' || r.status === 'pending');
      const open = D.codes.filter(c => !c.used && c.expiresAtMs > Date.now());
      const q = U.norm(U.filters.dev || '');
      let devs = D.devices.slice().sort((a, b) => (TP.toDate(b.lastSeen) || 0) - (TP.toDate(a.lastSeen) || 0));
      if (state.tab === 'online') devs = devs.filter(TP.q.online);
      else if (state.tab !== 'all') devs = devs.filter(d => d.kind === state.tab);
      if (q) devs = devs.filter(d => U.norm(d.name).includes(q) || shortId(d.id).toLowerCase().includes(q));
      const onlineCount = D.devices.filter(TP.q.online).length;
      const people = D.people.filter(p => p.active !== false);

      root.innerHTML = `
        ${manage ? `
        <div class="split">
          <section class="card">
            <div class="card-head"><h3>طلبات التفعيل</h3><span class="muted small">بتظهر هنا أول ما حد يكتب الكود</span></div>
            ${reqs.length ? reqs.map(r => `
              <div class="request-card">
                ${U.who(r.personName || 'بيتحقق من الكود…', `${esc(KIND[(r.device || {}).app] || '')} · ${TP.ago(r.updatedAt || r.createdAt)}<br>رقم الجهاز <bdi class="mono"><b>${shortId(r.id)}</b></bdi> · الكود <bdi class="mono"><b>${esc(r.code || '')}</b></bdi>`)}
                <div class="grow"></div>
                ${r.status === 'matched' && TP.isSensitive((TP.q.person(r.personId) || {}).perms) && !S.can('all') ? '<span class="st st-warn">حساب فيه أسعار — موافقة المدير العام بس</span>' : ''}
                ${r.status === 'matched' && (!TP.isSensitive((TP.q.person(r.personId) || {}).perms) || S.can('all')) ? `<button class="btn btn-primary btn-sm" data-approve="${r.id}">${TP.icon('check', 16)}موافقة</button>
                <button class="btn btn-ghost btn-sm" data-reject="${r.id}">رفض</button>` : ''}
                ${r.status === 'pending' ? '<span class="st st-warn">بيتحقق</span>' : ''}
              </div>`).join('') : U.empty('مفيش طلبات دلوقتي')}
          </section>
          <section class="card">
            <div class="card-head"><h3>كود تفعيل جديد</h3><span class="muted small">صالح ${CODE_MINUTES} دقايق ولمرة واحدة</span></div>
            <form id="codeForm" class="form-grid">
              <label class="fld full">لمين الكود؟
                <select class="input" id="codePerson" required>${U.opts(people, '', p => p.id, p => `${p.name} — ${p.type === 'driver' ? TP.driverKindName(p.driverKind) : p.type === 'hr' ? 'HR ' + ((TP.q.company(p.factoryId) || {}).name || '') : 'إدارة'}`, 'اختار الشخص')}</select>
              </label>
              <button class="btn btn-primary full" type="submit">${TP.icon('key', 18)}إنشاء الكود</button>
            </form>
            ${open.length ? `<h4 style="margin:16px 0 8px;font-size:14px;color:var(--maroon-2)">أكواد سارية</h4>
              <div class="table-wrap"><table class="tbl"><tbody>${open.map(c => `<tr><td>${esc(c.personName)}</td><td class="mono"><b>${esc(c.code)}</b></td>
              <td class="muted small">${Math.max(0, Math.ceil((c.expiresAtMs - Date.now()) / 60000))} د</td>
              <td class="acts"><button class="icon-btn" title="عرض" data-showcode="${c.id}">${TP.icon('key', 16)}</button><button class="icon-btn danger" title="إلغاء" data-cancelcode="${c.id}">${TP.icon('x', 16)}</button></td></tr>`).join('')}</tbody></table></div>` : ''}
          </section>
        </div>` : ''}

        <section class="card" style="margin-top:16px">
          <div class="card-head"><h3>الأجهزة المفعّلة <span class="muted small">(${D.devices.length})</span></h3>
            <span class="st st-ok">${onlineCount} متصل الآن</span></div>
          <div class="toolbar">
            <div class="chips">
              ${[['all', 'الكل'], ['online', 'متصل الآن'], ['staff', 'الإدارة'], ['driver', 'السواقين'], ['hr', 'المصانع']].map(([k, l]) => `<button class="chip ${state.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}
            </div>
            ${U.filterBox('devQ', 'بحث بالاسم أو رقم الجهاز', U.filters.dev)}
          </div>
          ${devs.length ? `<div class="table-wrap"><table class="tbl">
            <thead><tr><th>الشخص</th><th>الشاشة</th><th>الجهاز</th><th>آخر ظهور</th><th>البطارية</th><th>اتفعّل</th>${manage ? '<th></th>' : ''}</tr></thead>
            <tbody>${devs.map(d => {
              const p = TP.q.person(d.personId), on = TP.q.online(d);
              return `<tr>
                <td>${U.who(d.name, personSub(p), !on)}</td>
                <td>${esc(KIND[d.kind] || d.kind)}</td>
                <td class="mono">${shortId(d.id)}${d.id === S.uid ? ' <span class="tag gold">ده جهازك</span>' : ''}</td>
                <td><span class="dot ${on ? 'on' : ''}"></span>${on ? 'متصل الآن' : TP.ago(d.lastSeen)}</td>
                <td>${d.battery !== undefined ? `<span class="${d.battery < (D.settings.lowBatteryPct || 20) ? 'st st-danger' : ''}">${d.battery}%</span>` : '—'}</td>
                <td class="muted small">${d.approvedAtMs ? TP.fmtDate(d.approvedAtMs) : '—'}<br>${esc(d.approvedBy || '')}</td>
                ${manage ? `<td class="acts">${d.id !== S.uid ? `<button class="btn btn-ghost btn-sm" data-remove="${d.id}">${TP.icon('trash', 16)}إزالة</button>` : ''}</td>` : ''}
              </tr>`;
            }).join('')}</tbody></table></div>` : U.empty('مفيش أجهزة في الفلتر ده')}
        </section>`;

      U.bindFilter(root, 'devQ', 'dev');
      root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; TP.rerender(); });
      root.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => TP.actions.approve(b.dataset.approve).catch(e => TP.toast(TP.errorText(e), 'warn')));
      root.querySelectorAll('[data-reject]').forEach(b => b.onclick = () => TP.actions.reject(b.dataset.reject).catch(e => TP.toast(TP.errorText(e), 'warn')));
      root.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => TP.actions.removeDevice(b.dataset.remove).catch(e => TP.toast(TP.errorText(e), 'warn')));
      root.querySelectorAll('[data-showcode]').forEach(b => b.onclick = () => TP.actions.showCode(b.dataset.showcode));
      root.querySelectorAll('[data-cancelcode]').forEach(b => b.onclick = () => TP.actions.cancelCode(b.dataset.cancelcode).catch(e => TP.toast(TP.errorText(e), 'warn')));
      const f = root.querySelector('#codeForm');
      if (f) f.onsubmit = e => { e.preventDefault(); const pid = U.val('codePerson'); if (!pid) return TP.toast('اختار الشخص'); TP.actions.newCode(pid).catch(err => TP.toast(TP.errorText(err), 'warn')); };
    }
  };
})(window.TP = window.TP || {});
