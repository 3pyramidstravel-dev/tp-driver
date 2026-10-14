/* ==========================================================================
   المشاوير والمطار — one-off trips and airport transfers.
   Each trip has two separate prices written for that trip only: what the
   factory pays (missionFactory/) and what the driver earns (missionDriver/).
   Neither side can read the other. Prices show only when the accounts are on.
   Airport: the flight number is enough — the cloud alarm brings the times
   (and checks again 5 h and 2 h before); the trip's time follows the flight.
   Every customer of a trip gets a link for that trip only (c/#token → track/{sha256(token)}).
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui, O = TP.ops;
  const FL = () => TP.flight;
  const state = { month: '', filter: 'open', type: '' };
  let live = { month: null, unsubs: [], list: [], pd: {}, pf: {} };
  const money = () => TP.financeOn(D.settings);
  // the company's safety rule: at most N passengers in a car (the setting, 3 by default; the cloud alarm updates up to 4 links per trip)
  const maxTripCust = () => Math.min(4, Math.max(1, Number(TP.D.settings.maxCustomersPerCar) || 3));

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
  const placeHtml = (prefix, p, label) => `
    <label class="fld">${label || (prefix === 'from' ? 'من (المكان)' : 'إلى (المكان)')}<input class="input" id="${prefix}Name" value="${esc((p && p.name) || '')}"></label>
    <div class="fld loc-drop" data-locbox="${prefix}"><span>لوكيشن ${prefix === 'from' ? 'البداية' : 'الوجهة'} <small>اسحبه من الواتساب هنا أو الصقه</small></span>
      <div class="loc-row"><input class="input" id="${prefix}Loc" dir="ltr" placeholder="لينك جوجل ماب أو 30.29, 31.74" value="${esc(U.locText(p && p.location))}"><button type="button" class="btn btn-ghost btn-sm" data-locpaste="${prefix}" title="لصق">📋</button></div>
      <small class="muted" id="${prefix}LocSt"></small><div class="loc-prev" id="${prefix}Prev"></div></div>`;
  /* ---------- a place from WhatsApp: dropped, pasted or typed — a short link is opened by the cloud alarm; a small map to check ---------- */
  const WURL = () => TP.WORKER_URL || 'https://tp-alarm.3pyramidstravel.workers.dev';
  async function resolveShort(url) {
    const tok = await TP.fb.idToken();
    const r = await fetch(WURL() + '/resolve', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ url }) });
    const j = await r.json().catch(() => ({}));
    return r.ok && isFinite(j.lat) ? { lat: j.lat, lng: j.lng } : null;
  }
  function locPreview(prefix, loc) {
    const box = TP.$('#' + prefix + 'Prev'); if (!box) return;
    if (!loc || !isFinite(loc.lat)) { box.innerHTML = ''; return; }
    const d = 0.004, bb = [loc.lng - d * 1.5, loc.lat - d, loc.lng + d * 1.5, loc.lat + d].map(x => x.toFixed(5)).join(',');
    box.innerHTML = `<iframe title="المكان" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${bb}&layer=mapnik&marker=${loc.lat},${loc.lng}"></iframe>`;
  }
  async function fixLoc(prefix) {
    const inp = TP.$('#' + prefix + 'Loc'), st = TP.$('#' + prefix + 'LocSt'); if (!inp) return;
    const raw = inp.value.trim(); st.textContent = '';
    if (!raw) return locPreview(prefix, null);
    const loc = TP.parseLocation(raw);
    if (loc && isFinite(loc.lat)) { if (loc.url && raw.length > 80) inp.value = `${loc.lat}, ${loc.lng}`; return locPreview(prefix, loc); }
    if (!loc || !loc.url) { st.textContent = 'مش مقروء — الصق لينك جوجل ماب أو الإحداثيات'; return locPreview(prefix, null); }
    st.textContent = 'بيقرا اللينك…';
    const c = await resolveShort(loc.url).catch(() => null);
    if (inp.value.trim() !== raw) return;                                   // changed meanwhile
    if (c) { inp.value = `${c.lat}, ${c.lng}`; st.textContent = 'اتقرا ✓ — اتأكد من المكان على الخريطة'; locPreview(prefix, c); }
    else { st.textContent = 'اللينك ده مفيهوش مكان واضح — افتحه في جوجل ماب وانسخ اللينك من فوق'; locPreview(prefix, null); }
  }
  async function pasteInto(inp) {
    try { const t = await navigator.clipboard.readText(); if (t) { inp.value = t.trim(); inp.dispatchEvent(new Event('change')); return true; } }
    catch (e) { /* not allowed */ }
    inp.focus(); TP.toast('دوس مطوّل في الخانة واختار "لصق"'); return false;
  }
  function bindLoc(prefix) {
    const box = TP.$(`#tp-modal [data-locbox="${prefix}"]`), inp = TP.$('#' + prefix + 'Loc'); if (!box || !inp) return;
    inp.addEventListener('change', () => fixLoc(prefix));
    TP.$(`#tp-modal [data-locpaste="${prefix}"]`).onclick = () => pasteInto(inp);
    box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('over'); });
    box.addEventListener('dragleave', () => box.classList.remove('over'));
    box.addEventListener('drop', e => {
      e.preventDefault(); box.classList.remove('over');
      const dt = e.dataTransfer, txt = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split(/\r?\n/).find(x => x && !x.startsWith('#')) || '';
      const html = dt.getData('text/html') || '', href = (html.match(/href="([^"]+)"/) || [])[1] || '';
      const v = (TP.parseLocation(txt) && txt) || href.replace(/&amp;/g, '&') || txt;
      if (!v) return TP.toast('مقدرتش أقرا اللي اتسحب — انسخ اللوكيشن والصقه');
      inp.value = v.trim(); fixLoc(prefix);
    });
    if (inp.value.trim()) fixLoc(prefix);
  }
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

  /* ---------- customers of a trip ---------- */
  let custs = [];
  // the customers this office used before (this month's trips + this browser's list) — typing a name or number fills the rest
  const BOOK = 'tp-custbook';
  function custBook() {
    const out = new Map();
    const add = c => { if (!c || !c.name) return; const k = (TP.phoneIntl(c.phone || '') || '') + '|' + c.name; if (!out.has(k)) out.set(k, { name: c.name, phone: c.phone || '', lang: c.lang || 'ar', sex: c.sex || '' }); };
    live.list.slice().reverse().forEach(m => (m.customers || []).forEach(add));
    (TP.store.get(BOOK, []) || []).forEach(add);
    return [...out.values()];
  }
  function rememberCusts(list) {
    const old = TP.store.get(BOOK, []) || [];
    const keep = list.filter(c => c.name).map(c => ({ name: c.name, phone: c.phone || '', lang: c.lang || 'ar', sex: c.sex || '' }));
    const seen = new Set(keep.map(c => c.name + '|' + c.phone));
    TP.store.set(BOOK, keep.concat(old.filter(c => !seen.has(c.name + '|' + c.phone))).slice(0, 300));
  }
  const cleanPhone = v => { let t = TP.latinDigits(String(v || '')).trim(); const plus = /^\s*(\+|00)/.test(t); t = t.replace(/\D/g, ''); if (/^00/.test(t)) t = t.slice(2); return (plus ? '+' : '') + t; };
  const canContacts = () => !!(navigator.contacts && navigator.contacts.select && window.ContactsManager);
  function readCusts() { custs = TP.$$('#mCusts .cust-row').map(r => ({ id: r.dataset.id || '', h: r.dataset.h || '', name: r.querySelector('[data-c=name]').value.trim(), phone: TP.latinDigits(r.querySelector('[data-c=phone]').value.trim()), lang: r.querySelector('[data-c=lang]').value, sex: '' })); }
  function drawCusts() {
    const box = TP.$('#mCusts');
    const book = custBook();
    box.innerHTML = `<datalist id="custBookN">${book.map(c => `<option value="${esc(c.name)}">${esc(c.phone)}</option>`).join('')}</datalist><datalist id="custBookP">${book.filter(c => c.phone).map(c => `<option value="${esc(c.phone)}">${esc(c.name)}</option>`).join('')}</datalist>` + custs.map((c, i) => `<div class="cust-row two" data-id="${esc(c.id)}" data-h="${esc(c.h || '')}">
        <div class="loc-row">${U.sexSel(c.sex)}<input class="input" data-c="name" placeholder="اسم العميل — اكتب أوله" list="custBookN" autocomplete="off" value="${esc(c.name)}" maxlength="60"></div>
        <div class="loc-row"><input class="input" data-c="phone" placeholder="الموبايل" inputmode="tel" dir="ltr" list="custBookP" autocomplete="off" value="${esc(c.phone)}" maxlength="20"><button type="button" class="btn btn-ghost btn-sm" data-ppaste="${i}" title="لصق الرقم">📋</button>${canContacts() ? `<button type="button" class="btn btn-ghost btn-sm" data-pbook="${i}" title="من الأسماء">📇</button>` : ''}</div>
        <select class="input" data-c="lang" title="لغة الضيف (صفحته ورسايله)">${TP.i18n.LANGS.map(l => `<option value="${l.id}" ${(c.lang || 'ar') === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
        <button type="button" class="icon-btn danger" data-rmc="${i}" title="شيل">${TP.icon('trash', 16)}</button></div>`).join('') +
      (custs.length < maxTripCust() ? '<button type="button" class="link" id="mAddC">+ عميل</button>' : '');
    box.querySelectorAll('[data-rmc]').forEach(b => b.onclick = () => { readCusts(); custs.splice(Number(b.dataset.rmc), 1); drawCusts(); });
    const rowOf = el => el.closest('.cust-row'), get = (r, k) => r.querySelector(`[data-c=${k}]`);
    const fillFrom = (r, hit) => { if (!hit) return; if (!get(r, 'name').value.trim()) get(r, 'name').value = hit.name; if (!get(r, 'phone').value.trim()) get(r, 'phone').value = hit.phone; get(r, 'lang').value = hit.lang || 'ar'; if (hit.sex) get(r, 'sex').value = hit.sex; };
    box.querySelectorAll('[data-c=name]').forEach(inp => inp.addEventListener('change', () => { const r = rowOf(inp), v = inp.value.trim(); fillFrom(r, book.find(c => c.name === v)); }));
    box.querySelectorAll('[data-c=phone]').forEach(inp => inp.addEventListener('change', () => {
      const r = rowOf(inp); inp.value = cleanPhone(inp.value);
      const n = TP.phoneIntl(inp.value); if (n) fillFrom(r, book.find(c => TP.phoneIntl(c.phone) === n));
    }));
    box.querySelectorAll('[data-ppaste]').forEach(b => b.onclick = () => pasteInto(get(rowOf(b), 'phone')));
    box.querySelectorAll('[data-pbook]').forEach(b => b.onclick = async () => {
      try {
        const [ct] = await navigator.contacts.select(['name', 'tel'], { multiple: false });
        if (!ct) return;
        const r = rowOf(b), tel = (ct.tel || [])[0], nm = (ct.name || [])[0];
        if (tel) { get(r, 'phone').value = cleanPhone(tel); }
        if (nm && !get(r, 'name').value.trim()) get(r, 'name').value = nm;
      } catch (e) { TP.toast('مقدرتش أفتح الأسماء — الصق الرقم'); }
    });
    const add = TP.$('#mAddC'); if (add) add.onclick = () => { readCusts(); custs.push({ id: '', h: '', name: '', phone: '', lang: 'ar', sex: '' }); drawCusts(); };
  }

  /** The fixed part of a trip customer's link. */
  function trackStatic(id, m, c) {
    const f = TP.q.company(m.factoryId);
    const loc = l => l && isFinite(l.lat) ? { lat: l.lat, lng: l.lng } : null;
    const fl = m.flight ? { no: m.flight.no || '', dir: m.flight.dir || '', terminal: m.flight.terminal || '', airport: m.flight.airport || '', airportName: m.flight.airportName || '', other: m.flight.other || '', airline: m.flight.airline || '', sched: m.flight.sched || null, est: m.flight.est || null, status: m.flight.status || '', delayMin: Number(m.flight.delayMin) || 0 } : null;
    return { kind: 'mission', custId: c.id, name: c.name, sex: c.sex || '', lang: c.lang || 'ar', missionId: id, factoryId: m.factoryId || '', factoryName: f ? f.name : (m.client || ''), title: m.title || '',
      type: m.type || '', day: m.day, time: m.time || '', fromName: (m.from && m.from.name) || '', toName: (m.to && m.to.name) || '', fromLoc: loc(m.from && m.from.location), toLoc: loc(m.to && m.to.location), flight: fl, updatedAt: TP.fb.ts() };
  }
  function trackOps(id, m, old, fresh) {
    const ops = [], keep = new Set();
    (m.customers || []).forEach(c => {
      keep.add(c.h);
      const isNew = !(old && (old.customers || []).some(x => x.h === c.h));
      ops.push({ op: 'set', path: 'track/' + c.h, data: Object.assign(trackStatic(id, m, c), isNew ? { st: 'idle', seq: 0, createdAt: TP.fb.ts() } : {}), merge: true });
      if (fresh && fresh[c.h]) ops.push(TP.cust.linkOp(c.h, fresh[c.h], { kind: 'mission', custId: c.id, missionId: id }));
    });
    if (old) (old.customers || []).forEach(c => { if (c.h && !keep.has(c.h)) ops.push(...TP.cust.dropOps(c.h)); });
    return ops;
  }

  /* ---------- editor ---------- */
  let onSavedHook = null;
  // several trips for the same driver: page k of n; the driver, day and client carry over, the prompts come once at the end
  let batch = null;
  function openEditor(mid, prefill, onSaved, bt) {
    batch = mid ? null : (bt || { n: 1, k: 1, saved: [] });
    const base = { day: TP.dayKey(), factoryId: '', status: 'assigned', type: '' };
    const m = mid ? find(mid) : Object.assign(base, prefill || {});
    if (!m) return;
    onSavedHook = onSaved || null;
    const canPrice = S.can('prices.edit') && money();
    const drivers = TP.q.drivers().filter(p => p.active !== false || p.id === m.driverId);
    const fl = m.flight || {};
    custs = (m.customers || []).map(c => ({ id: c.id || '', h: c.h || '', name: c.name || '', phone: c.phone || '', lang: c.lang || 'ar', sex: c.sex || '' }));
    if (!custs.length && !mid) custs = [{ id: '', h: '', name: '', phone: '', lang: 'ar', sex: '' }];
    const manualTime = fl.src === 'manual' && fl.sched ? O.hm(fl.sched) : '';
    const bk = batch;
    const saveLbl = () => mid ? 'حفظ' : bk.k < bk.n ? `حفظ والتالي (${bk.k} من ${bk.n})` : bk.n > 1 ? `إضافة (${bk.k} من ${bk.n})` : 'إضافة';
    TP.openModal(mid ? 'تعديل مشوار' : bk.n > 1 ? `مشوار جديد — ${bk.k} من ${bk.n}` : 'مشوار جديد', `
      ${!mid && bk.k === 1 ? `<label class="fld" style="max-width:260px;margin-bottom:10px">عدد المشاوير <small>لنفس السواق — صفحة لكل مشوار</small><select class="input" id="mCount">${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${bk.n === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}
      ${!mid && bk.k > 1 ? `<div class="banner" style="margin-bottom:10px">مشوار ${bk.k} من ${bk.n} — نفس السواق واليوم، غيّر اللي محتاج</div>` : ''}
      <div class="chips" style="margin-bottom:12px"><button type="button" class="chip ${m.type !== 'airport' ? 'active' : ''}" data-mt="">${TP.icon('file', 16)}مشوار عادي</button><button type="button" class="chip ${m.type === 'airport' ? 'active' : ''}" data-mt="airport">${TP.icon('plane', 16)}مطار</button></div>
      <div class="form-grid">
        <div class="full form-grid" id="mAir" style="padding:12px;border:1px dashed var(--line-strong);border-radius:14px;background:#fffaf1">
          <label class="fld">رقم الرحلة<input class="input" id="fNo" dir="ltr" placeholder="MS 777" value="${esc(fl.no || '')}" maxlength="10"></label>
          <label class="fld">تاريخ الطيارة<input class="input" type="date" id="fDate" value="${esc(fl.date || m.day || '')}"></label>
          <label class="fld">النوع<select class="input" id="fDir"><option value="">يتعرف لوحده من رقم الرحلة</option><option value="arr" ${fl.dir === 'arr' && fl.dirSet ? 'selected' : ''}>استقبال (العميل جاي)</option><option value="dep" ${fl.dir === 'dep' && fl.dirSet ? 'selected' : ''}>توصيل (العميل مسافر)</option></select></label>
          <div class="fld">ميعاد الطيارة <small>سيبه فاضي — بييجي لوحده</small>${U.timeField('fTime', manualTime)}</div>
          <label class="fld">الصالة <small>اختياري</small><input class="input" id="fTerm" value="${esc(fl.terminalSet ? fl.terminal : '')}" maxlength="10" placeholder="${esc(fl.terminal || '')}"></label>
          <label class="fld" id="fDriveBox">مدة الطريق للمطار (دقيقة)<input class="input" id="fDrive" type="number" min="15" max="300" dir="ltr" value="${esc(m.driveMin || D.settings.airportDriveMin || 75)}"></label>
          <div class="full small muted" id="fInfo">${flightLine(m)}</div>
        </div>
        <label class="fld full">وصف المشوار<input class="input" id="mTitle" value="${esc(m.title || '')}" placeholder="مثال: توصيل وفد من الفندق للمصنع — للمطار بيتكتب لوحده" maxlength="120"></label>
        <label class="fld" data-reg>اليوم<input class="input" type="date" id="mDay" value="${esc(m.day || '')}"></label>
        <div class="fld" data-reg>الميعاد (عند العميل)${U.timeField('mTime', m.time || '')}</div>
        <label class="fld">المصنع (العميل)<select class="input" id="mFactory">${U.opts(D.companies, m.factoryId, c => c.id, c => c.name, 'جهة تانية / عميل فرد')}</select></label>
        <label class="fld">اسم الجهة <small>لو مش مصنع</small><input class="input" id="mClient" value="${esc(m.client || '')}" maxlength="80"></label>
        <label class="fld full">السواق<select class="input" id="mDriver">${U.opts(drivers, m.driverId, p => p.id, p => `${TP.driverLabel(p)} — ${TP.driverKindName(p.driverKind)}`, 'اختار السواق')}</select></label>
        ${placeHtml('from', m.from)}${placeHtml('to', m.to)}
        <div class="full"><div class="muted small" style="font-weight:800;margin-bottom:6px">العملاء <small>كل عميل بياخد لينك للمشوار ده بس</small></div><div id="mCusts"></div></div>
        <label class="fld">كاش مع السواق <small>عميل فرد بيدفع للسواق</small><input class="input" id="mCash" inputmode="decimal" dir="ltr" value="${m.cash ? esc(m.cash.amount) : ''}" placeholder="0"></label>
        <label class="fld">ملاحظة الكاش<input class="input" id="mCashNote" value="${m.cash ? esc(m.cash.note || '') : ''}" maxlength="120"></label>
        <label class="fld full">ملاحظات للسواق<textarea class="input" id="mNotes" rows="2" maxlength="500">${esc(m.notes || '')}</textarea></label>
        ${canPrice ? priceFields(m, live.pd[mid], live.pf[mid]) : (money() ? '<p class="muted small full">السعر بيحطه المدير المالي أو المدير العام من نفس الصفحة.</p>' : '')}
      </div>`, () => save(mid, m), { wide: true, saveLabel: saveLbl(), onCancel: () => { if (!mid && bk.saved.length) setTimeout(() => afterSave(bk.saved), 300); } });
    const cnt = TP.$('#mCount'); if (cnt) cnt.onchange = () => { bk.n = Number(cnt.value) || 1; TP.$('#tp-modal-save').textContent = saveLbl(); TP.$('#tp-modal-title').textContent = bk.n > 1 ? `مشوار جديد — 1 من ${bk.n}` : 'مشوار جديد'; };
    let type = m.type || '';
    const syncType = () => {
      TP.$('#mAir').hidden = type !== 'airport';
      TP.$$('#tp-modal [data-reg]').forEach(el => { el.hidden = type === 'airport'; });
      const dir = U.val('fDir') || fl.dir || '';
      TP.$('#fDriveBox').hidden = dir === 'arr';
      TP.$('#fromName').closest('.fld').firstChild.textContent = type === 'airport' ? (dir === 'arr' ? 'من (المطار/الصالة)' : 'من (مكان العميل)') : 'من (المكان)';
      TP.$('#toName').closest('.fld').firstChild.textContent = type === 'airport' ? (dir === 'dep' ? 'إلى (المطار)' : 'إلى (وجهة العميل)') : 'إلى (المكان)';
    };
    TP.$$('#tp-modal [data-mt]').forEach(b => b.onclick = () => { type = b.dataset.mt; TP.$$('#tp-modal [data-mt]').forEach(x => x.classList.toggle('active', x === b)); syncType(); });
    TP.$('#fDir').onchange = syncType;
    syncType(); drawCusts(); bindLoc('from'); bindLoc('to'); U.bindTime(TP.$('#tp-modal'));
    const fsel = TP.$('#mFactory'), pfIn = TP.$('#mPF');
    if (fsel && pfIn) fsel.onchange = () => { pfIn.disabled = !fsel.value; if (!fsel.value) pfIn.value = ''; };
    TP.$('#tp-modal').__mtype = () => type;
  }
  /** One line about the flight for the editor and the list. */
  function flightLine(m) {
    const fl = m.flight; if (!fl || !fl.no) return '';
    const t = FL().when(fl);
    const parts = [`✈ <b dir="ltr">${esc(fl.no)}</b>`, fl.dir === 'arr' ? 'استقبال' : fl.dir === 'dep' ? 'توصيل' : '',
      fl.airline ? esc(fl.airline) : '', fl.other ? (fl.dir === 'arr' ? 'جاية من ' : 'رايحة ') + esc(fl.other) : '',
      t ? (fl.dir === 'arr' ? 'الهبوط ' : 'الإقلاع ') + esc(TP.fmtDateTime(t)) : '', fl.terminal ? 'صالة ' + esc(fl.terminal) : '',
      fl.delayMin >= 10 ? `<span class="badge-s far">متأخرة ${fl.delayMin} د</span>` : '', fl.status ? esc(FL().statusName(fl.status)) : ''].filter(Boolean);
    let warn = '';
    if (fl.src === 'wait') warn = '<span class="badge-s nogps">بيانات الرحلة جاية خلال دقيقتين…</span>';
    if (fl.alert === 'retry') warn = '<span class="badge-s nogps">خدمة الرحلات مشغولة — هنحاول تاني بعد ربع ساعة</span>';
    if (fl.alert === 'notfound') warn = '<span class="badge-s far">الرحلة مش لاقيينها — اكتب الميعاد بإيدك</span>';
    if (fl.alert === 'nokey' || fl.alert === 'limit' || fl.alert === 'error') warn = '<span class="badge-s far">البحث الأوتوماتيك واقف — اكتب الميعاد بإيدك</span>';
    if (fl.status === 'Canceled' || fl.status === 'CanceledUncertain') warn = '<span class="badge-s far">الرحلة ممكن تكون اتلغت — اتأكد</span>';
    const radar = ` <a class="small" href="https://airportinfo.live/flight/${encodeURIComponent(fl.no.toLowerCase().replace(/[^a-z0-9]/g, ""))}" target="_blank" rel="noopener" style="font-weight:700">✈ متابعة الرحلة ↗</a>`;
    const src = fl.src === 'api' ? ' <span class="muted small">· بيانات الرحلات: AeroDataBox</span>' : '';
    return parts.join(' · ') + (warn ? ' ' + warn : '') + radar + src;
  }
  TP.actions.flightLine = flightLine;
  /** What would stop an open mission from reaching or being done by its driver, in words the dispatcher can act on. */
  function problems(m) {
    if (!['assigned', 'active'].includes(m.status)) return [];
    const out = [], p = TP.q.person(m.driverId), today = TP.dayKey();
    const days = Math.round((Date.parse(m.day + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 864e5);
    if (!p) out.push('السواق مش موجود — اختار سواق تاني من تعديل ✎');
    else if (p.active === false) out.push('السواق موقوف — فعّله من صفحة السواقين أو اختار سواق تاني');
    else if (D.devices && (S.can('drivers.manage') || S.can('devices.manage') || S.can('tracking.view') || S.can('staff.manage')) && !TP.q.devicesOf(p.id).length)
      out.push('السواق مش متفعل على موبايله، فالمشوار مش هيوصله — من صفحة السواقين اضغط 🔑 وابعتله الكود');
    if (days > 7) out.push(`التاريخ بعد ${days} يوم — لو اليوم والشهر متبدلين صححه من تعديل ✎`);
    else if (days < 0 && m.status === 'assigned') out.push('ميعاده عدّى ولسه السواق مبدأش — كلمه أو عدّل الميعاد');
    return out;
  }
  TP.actions.missionProblems = problems;

  async function save(mid, old) {
    const type = (TP.$('#tp-modal').__mtype || (() => ''))();
    const driverId = U.val('mDriver');
    let title = U.val('mTitle'), day = U.val('mDay'), time = U.val('mTime');
    if (!driverId) { TP.toast('اختار السواق'); return false; }
    if (U.timeIncomplete('mTime') || U.timeIncomplete('fTime')) { TP.toast('اختار صباحًا ولا مساءً للميعاد'); return false; }
    const from = readPlace('from'), to = readPlace('to');
    if (from.error || to.error) { TP.toast(from.error || to.error); return false; }
    readCusts();
    const customers = [], fresh = {};
    for (const c of custs.filter(x => x.name || x.phone)) {
      if (!c.name) { TP.toast('اكتب اسم العميل'); return false; }
      if (c.phone && !TP.phoneIntl(c.phone)) { TP.toast(`موبايل ${c.name} مش مظبوط`); return false; }
      let h = c.h;
      if (!h) { const k = await TP.cust.newLink(); h = k.h; fresh[h] = k.token; }
      customers.push({ id: c.id || TP.newId('C'), h, name: c.name.slice(0, 60), phone: c.phone || '', lang: TP.i18n.ok(c.lang) ? c.lang : 'ar', sex: (c.sex === 'm' || c.sex === 'f' ? c.sex : '') });
    }
    if (customers.length > maxTripCust()) { TP.toast(`العربية فيها ${maxTripCust()} ركاب بس — سياسة الأمان`); return false; }
    const cashAmt = U.money('mCash');
    if (Number.isNaN(cashAmt)) { TP.toast('مبلغ الكاش لازم يكون رقم'); return false; }
    let flight = null, flightCheckAt = null, driveMin = null;
    if (type === 'airport') {
      const no = FL().norm(U.val('fNo')), fdate = U.val('fDate'), dirSel = U.val('fDir'), ftime = U.val('fTime'), term = U.val('fTerm');
      if (!FL().valid(no)) { TP.toast('اكتب رقم الرحلة صح (مثال MS777)'); return false; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fdate)) { TP.toast('اختار تاريخ الطيارة'); return false; }
      if (!dirSel && ftime) { TP.toast('لو كتبت الميعاد بإيدك اختار استقبال ولا توصيل'); return false; }
      driveMin = Math.round(TP.num(U.val('fDrive')) || Number(D.settings.airportDriveMin) || 75);
      if (!(driveMin >= 15 && driveMin <= 300)) { TP.toast('مدة الطريق من 15 لـ 300 دقيقة'); return false; }
      const prev = old && old.flight || {};
      const same = prev.no === no && prev.date === fdate;
      flight = same ? Object.assign({}, prev) : { no, date: fdate };
      flight.no = no; flight.date = fdate;
      if (dirSel) { flight.dir = dirSel; flight.dirSet = true; } else delete flight.dirSet;
      if (term) { flight.terminal = term; flight.terminalSet = true; } else if (flight.terminalSet) { delete flight.terminalSet; flight.terminal = ''; }
      if (ftime) {
        flight.sched = O.cairoMs(fdate, ftime); flight.est = null; flight.src = 'manual'; flight.delayMin = 0; delete flight.alert; flight.done = [];
        flightCheckAt = FL().schedule(flight, TP.now());
      } else if (!same || !flight.sched || flight.src === 'manual') {
        ['sched', 'est', 'status', 'airport', 'airportName', 'other', 'airline', 'delayMin', 'alert', 'gate', 'belt'].forEach(k => { delete flight[k]; });
        if (!flight.terminalSet) flight.terminal = '';
        flight.src = 'wait'; flight.done = []; flight.nextK = 0; flightCheckAt = 1;                                        // the cloud alarm looks it up within a minute
      } else flightCheckAt = old.flightCheckAt || FL().schedule(flight, TP.now());
      const job = FL().jobAt(flight, D.settings, driveMin);
      if (job) { day = TP.dayKey(job); time = O.hm(job); }
      else { day = fdate; time = ''; }
      if (!title || (old && old.type === 'airport' && old.title === autoTitle(old.flight))) title = autoTitle(flight);
    } else {
      if (!title) { TP.toast('اكتب وصف المشوار'); return false; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { TP.toast('اختار اليوم'); return false; }
    }
    const chk = type === 'airport' ? U.val('fDate') : day;                                            // catch a swapped day/month (12-10 vs 10-12)
    const ahead = Math.round((Date.parse(chk + 'T12:00:00Z') - Date.parse(TP.dayKey(TP.now()) + 'T12:00:00Z')) / 864e5);
    if ((!old || (old.flight && old.flight.date || old.day) !== chk) && ahead > 7
      && !(await TP.confirm('اتأكد من التاريخ', `المشوار ده هيتسجل يوم ${chk}، يعني بعد ${ahead} يوم من النهارده. السواق مش هيشوفه غير في اليوم ده. التاريخ مظبوط؟`, 'أيوه مظبوط'))) return false;
    const id = mid || TP.newId('M');
    const data = { title, day, month: O.monthOf(day), time, factoryId: U.val('mFactory'), client: U.val('mFactory') ? '' : U.val('mClient'), driverId, from, to,
      customers, notes: U.val('mNotes'), type, updatedAt: TP.fb.ts() };
    if (cashAmt) data.cash = { amount: cashAmt, note: U.val('mCashNote') };
    else if (mid && old.cash) data.cash = TP.fb.del();
    if (type === 'airport') Object.assign(data, { flight, flightCheckAt, driveMin });
    else if (mid && old.flight) Object.assign(data, { flight: TP.fb.del(), flightCheckAt: TP.fb.del() });
    const renotify = !mid || old.driverId !== driverId || old.day !== day || (old.time || '') !== (time || '');
    if (mid && renotify && old.ack) data.ack = TP.fb.del();                                   // the driver must take the changed trip again
    if (mid && ['done', 'active'].includes(old.status)) Object.assign(data, TP.lockFix(old.day < day ? old.day : day, 'تعديل المشوار بعد التصدير'));
    const ops = [];
    if (mid) ops.push({ op: 'update', path: 'missions/' + id, data });
    else ops.push({ op: 'set', path: 'missions/' + id, data: Object.assign(data, { status: 'assigned', events: {}, createdAt: TP.fb.ts(), createdBy: S.person.name }) });
    ops.push(...trackOps(id, Object.assign({}, data, { flight }), mid ? old : null, fresh));
    let note = '';
    if (S.can('prices.edit') && money()) {
      const p = priceOps(id, data);
      if (p.error) { TP.toast(p.error); return false; }
      ops.push(...p.ops);   // the price fields come pre-filled, so a new driver / month / factory re-saves them
      if (mid && !data.factoryId && live.pf[mid]) ops.push({ op: 'delete', path: 'missionFactory/' + id });
      if (p.ops.length && TP.needsPin(S.perms) && !(await S.confirmPin('تأكيد سعر المشوار'))) return false;
    } else if (mid && (old.driverId !== data.driverId || old.month !== data.month || old.factoryId !== data.factoryId)) {
      // the old prices belonged to the old driver / month / factory: remove them so they get set again
      ops.push({ op: 'delete', path: 'missionDriver/' + id }, { op: 'delete', path: 'missionFactory/' + id });
      if (money()) note = ' — السعر محتاج يتحط تاني';
    }
    await TP.fb.batch(ops);
    rememberCusts(customers);
    TP.wakeTouch && TP.wakeTouch([day, old && old.day]);
    TP.audit(mid ? 'mission.update' : 'mission.create', title, `${day} — ${(TP.q.person(driverId) || {}).name || ''}${type === 'airport' ? ' — ✈ ' + flight.no : ''}`);
    const probs = problems(Object.assign({ status: mid ? old.status : 'assigned' }, data));
    TP.toast('تم الحفظ ✓' + note + (probs.length ? ' — ⚠ ' + probs[0] : (type === 'airport' && flight.src === 'wait' ? ' — بيانات الرحلة جاية خلال دقيقتين' : '')));
    if (state.month && O.monthOf(day) !== state.month) { state.month = O.monthOf(day); TP.rerender && TP.rerender(); }   // keep the saved mission in sight
    if (onSavedHook) { const h = onSavedHook; onSavedHook = null; h(id); }
    const one = { id, data: Object.assign({}, data, { flight }), renotify, tell: renotify && (!mid || old.status === 'assigned') };
    if (!mid && batch && batch.k < batch.n) {                                       // the next page: same driver, day and client
      batch.saved.push(one);
      const next = { n: batch.n, k: batch.k + 1, saved: batch.saved };
      const pre = { driverId, day: type === 'airport' ? (U.val('fDate') || day) : day, factoryId: data.factoryId, client: data.client };
      setTimeout(() => openEditor(null, pre, null, next), 300);
      return;
    }
    const all = (!mid && batch ? batch.saved : []).concat([one]); batch = null;
    setTimeout(() => afterSave(all), 400);                                           // after the editor closes
  }
  /** After saving (one trip or the last page): the driver's phone rings, then "ابعت للعميل", then the car's group. */
  async function afterSave(all) {
    all.forEach(x => { if (x.tell) notifyDriver(x.id); });
    const toGroup = () => { if (TP.actions.missionToGroup) TP.actions.missionToGroup(all.map(x => Object.assign({ id: x.id }, x.data))); };
    const send = all.filter(x => x.renotify && (x.data.customers || []).some(c => TP.phoneIntl(c.phone || '')));
    if (!send.length) return toGroup();
    const tok = await TP.cust.tokens([].concat(...send.map(x => x.data.customers))).catch(() => ({}));
    const drv = TP.q.person(all[0].data.driverId) || '';
    const rows = [];
    send.forEach(x => (x.data.customers || []).forEach(c => {
      if (!TP.phoneIntl(c.phone || '') || !tok[c.h]) return;
      const msg = TP.guest.messages(x.data, c, TP.custUrl(tok[c.h]), drv)[0];
      if (msg) rows.push({ c, title: x.data.title || '', text: msg.text });
    }));
    if (!rows.length) return toGroup();
    const dirOf = l => TP.i18n.info(TP.i18n.ok(l) ? l : 'ar').dir;
    const waitFl = send.some(x => x.data.type === 'airport' && x.data.flight && x.data.flight.src === 'wait');
    // the buttons first (on a phone the window opens at its top), the message folded under them
    TP.openModal('ابعت للعميل', `<p class="modal-text">لكل عميل: <b>📱 للعميل</b> على رقمه، أو <b>👥 لجروب</b> والواتساب يوريك الجروبات. الرسالة جاهزة بلغته ومعاها لينك متابعة العربية.</p>
      ${waitFl ? `<div class="banner warn" style="margin-bottom:8px">${TP.icon('plane')}<span>ميعاد الطيارة لسه جاي (دقيقتين). لو عايز الميعاد يبقى في الرسالة، ابعتها بعدين من زرار ↗ لينكات العملاء في صف المشوار.</span></div>` : ''}
      ${rows.map((r, i) => `<div class="gm send-c"><div class="gm-h"><b>${esc(r.c.name)}</b>${r.c.lang && r.c.lang !== 'ar' ? ` <span class="tag">${esc(TP.i18n.info(r.c.lang).name)}</span>` : ''}${all.length > 1 ? ` <small class="muted">${esc(r.title)}</small>` : ''}</div>
        <div class="send-btns"><a class="btn btn-primary btn-sm" href="${esc(TP.waLink(r.c.phone, r.text))}" target="_blank" rel="noopener" data-wsent="${i}">📱 للعميل</a><a class="btn btn-ghost btn-sm" href="${esc('https://wa.me/?text=' + encodeURIComponent(r.text))}" target="_blank" rel="noopener">👥 لجروب</a><button type="button" class="btn btn-ghost btn-sm" data-wcopy="${i}">📋 بيانات الكابتن لأي جروب شركة</button></div>
        <details class="send-msg"><summary>شوف الرسالة</summary><p class="gm-t" dir="${dirOf(r.c.lang)}">${TP.waPreview(r.text)}</p></details></div>`).join('')}`, null,
      { noSave: true, wide: true, noFocus: true, cancelLabel: TP.actions.missionToGroup ? 'التالي: جروب العربية' : 'إغلاق', onCancel: toGroup });
    const ov = TP.$('#tp-modal'); if (ov) ov.scrollTop = 0;
    const card = TP.$('#tp-modal .tp-modal-card'); if (card) card.scrollTop = 0;
    const body = TP.$('#tp-modal-body'); if (body) body.scrollTop = 0;
    TP.$$('#tp-modal [data-wsent]').forEach(a => a.addEventListener('click', () => { a.textContent = 'اتبعت ✓'; a.classList.replace('btn-primary', 'btn-ghost'); }));
    TP.$$('#tp-modal [data-wcopy]').forEach(b => b.onclick = () => TP.actions.copy(rows[Number(b.dataset.wcopy)].text));
  }
  /** A push to the driver's phone right away (the cloud alarm sends it); the app rings until he presses "استلمت". */
  async function notifyDriver(id) {
    try {
      const tok = await TP.fb.idToken();
      await fetch((TP.WORKER_URL || 'https://tp-alarm.3pyramidstravel.workers.dev') + '/notify', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ id }) });
    } catch (e) { console.warn('notify', e); }
  }
  const autoTitle = fl => fl ? `${fl.dir === 'dep' ? 'توصيل للمطار' : fl.dir === 'arr' ? 'استقبال من المطار' : 'مطار'} — ${fl.no}` : '';

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
  async function openLinks(mid) {
    const m = find(mid); if (!m) return;
    const tok = await TP.cust.tokens(m.customers);
    const list = (m.customers || []).filter(c => tok[c.h]).map(c => Object.assign({}, c, { token: tok[c.h] }));
    TP.openModal('لينكات العملاء — ' + (m.title || ''), list.length ? `<p class="muted small" style="margin-bottom:10px">لينك للمشوار ده بس، بيوري رحلة العميل من غير أسعار.</p><div class="table-wrap"><table class="tbl"><tbody>${list.map(c => {
      const wa = TP.waLink(c.phone, TP.guest.rideCard(m, c, TP.custUrl(c.token), TP.q.person(m.driverId) || ''));
      const guest = (c.lang && c.lang !== 'ar') || m.type === 'airport';
      return `<tr><td><b>${esc(c.name)}</b>${c.lang && c.lang !== 'ar' ? ` <span class="tag">${esc(TP.i18n.info(c.lang).name)}</span>` : ''}<div class="muted small" dir="ltr">${esc(c.phone || '')}</div></td><td class="acts"><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(TP.custUrl(c.token))}">${TP.icon('copy', 16)}انسخ</button>${guest ? `<button type="button" class="btn btn-gold btn-sm" data-guest="${esc(c.h)}">${TP.icon('users', 16)}رسايل بلغته</button>` : ''}${wa ? `<a class="btn btn-primary btn-sm" href="${esc(wa)}" target="_blank" rel="noopener">واتساب</a>` : ''}<a class="icon-btn" href="${esc(TP.custUrl(c.token))}" target="_blank" rel="noopener">${TP.icon('external', 16)}</a></td></tr>`;
    }).join('')}</tbody></table></div>` : U.empty('المشوار ده مفيهوش عملاء — ضيفهم من التعديل'), null, { noSave: true, wide: true });
    TP.$$('#tp-modal [data-copy]').forEach(b => b.onclick = () => TP.actions.copy(b.dataset.copy));
    TP.$$('#tp-modal [data-guest]').forEach(b => b.onclick = () => { const c = list.find(x => x.h === b.dataset.guest); const drv = TP.q.person(m.driverId); TP.guest.compose(m, c, TP.custUrl(c.token), drv || ''); });
  }

  async function cancel(mid) {
    const m = find(mid);
    if (!m || !(await TP.confirm('إلغاء المشوار', `المشوار "${m.title}" هيتلغي ويختفي من عند السواق، ولينك العميل هيقوله إنه اتلغى.`, 'إلغاء المشوار', true))) return;
    await TP.fb.batch([{ op: 'update', path: 'missions/' + mid, data: Object.assign({ status: 'cancelled', flightCheckAt: FL().NEVER, updatedAt: TP.fb.ts() }, ['done', 'active'].includes(m.status) ? TP.lockFix(m.day, 'إلغاء مشوار بعد التصدير') : {}) }]
      .concat((m.customers || []).filter(c => c.h).map(c => ({ op: 'set', path: 'track/' + c.h, data: { st: 'cancelled', stAt: TP.now() }, merge: true }))));
    TP.audit('mission.cancel', m.title, m.day);
    TP.wakeTouch && TP.wakeTouch(m.day);
  }
  async function remove(mid) {
    const m = find(mid);
    if (!m) return;
    // an exported trip is never deleted (the accounts already have it) — cancel it instead
    if (TP.isLocked(m.day) && ['done', 'active'].includes(m.status)) return TP.toast('المشوار ده اتصدّر للحسابات — الغيه بدل ما تحذفه', 'warn');
    if (!(await TP.confirm('حذف المشوار', `"${m.title}" هيتحذف نهائياً هو وأسعاره ولينكات عملائه.`, 'حذف', true))) return;
    await TP.fb.batch([{ op: 'delete', path: 'missions/' + mid }, { op: 'delete', path: 'missionDriver/' + mid }, { op: 'delete', path: 'missionFactory/' + mid }]
      .concat(...(m.customers || []).filter(c => c.h).map(c => TP.cust.dropOps(c.h))));
    TP.audit('mission.delete', m.title, m.day);
    TP.wakeTouch && TP.wakeTouch(m.day);
  }

  /** Opened from a factory request: a new trip with the request's details. */
  TP.actions.openMission = function (prefill, onSaved) {
    const day = prefill.day || TP.dayKey();
    state.month = O.monthOf(day); watch(state.month);
    openEditor(null, prefill, onSaved);
  };

  TP.views.missions = {
    deps: null,
    leave() { live.unsubs.forEach(u => u()); live = { month: null, unsubs: [], list: [], pd: {}, pf: {} }; },
    render(root) {
      const M = O.monthOf(TP.dayKey());
      if (!state.month) state.month = M;
      watch(state.month);
      const canEdit = S.can('missions.manage'), canPrice = S.can('prices.edit') && money(), seePrice = S.can('prices.view') && money();
      const q = U.norm(U.filters.missions || ''), today = TP.dayKey();
      let list = live.list.slice().sort((a, b) => (a.day + (a.time || '')).localeCompare(b.day + (b.time || '')));
      if (state.type) list = list.filter(m => (m.type || '') === (state.type === 'airport' ? 'airport' : ''));
      if (state.filter === 'open') list = list.filter(m => m.status === 'assigned' || m.status === 'active');
      else if (state.filter === 'done') list = list.filter(m => m.status === 'done');
      else if (state.filter === 'unpriced') list = list.filter(m => m.status !== 'cancelled' && (!live.pd[m.id] || (m.factoryId && !live.pf[m.id])));
      if (q) list = list.filter(m => U.norm(m.title).includes(q) || U.norm(TP.q.dname(m.driverId)).includes(q) || U.norm((TP.q.company(m.factoryId) || {}).name || m.client).includes(q) || U.norm((m.flight && m.flight.no) || '').includes(q) || (m.customers || []).some(c => U.norm(c.name).includes(q)));
      const months = [O.addMonths(M, -1), M, O.addMonths(M, 1)];
      const filters = [['open', 'المفتوحة'], ['done', 'اللي خلصت'], ['all', 'الكل']].concat(seePrice ? [['unpriced', 'من غير سعر']] : []);
      const usage = D.flightUsage && D.flightUsage.month === M ? D.flightUsage.calls || 0 : 0, limit = Number(D.settings.flightMonthlyLimit) || 190;
      root.innerHTML = `<section class="card">
        <div class="toolbar">
          <div class="chips">${months.map(m => `<button class="chip ${state.month === m ? 'active' : ''}" data-month="${m}">${esc(O.monthName(m))}</button>`).join('')}<input class="input" type="month" id="mMonthPick" title="شهر تاني" style="width:auto;min-width:150px" value="${esc(state.month)}"></div>
          <div class="toolbar-end">${U.filterBox('missionsQ', 'بحث بالوصف أو السواق أو رقم الرحلة', U.filters.missions)}${canEdit ? `<button class="btn btn-primary" id="addM">${TP.icon('plus', 18)}مشوار جديد</button>` : ''}</div>
        </div>
        <div class="chips" style="margin-bottom:12px">${[['', 'الكل'], ['regular', 'مشاوير'], ['airport', '✈ مطار']].map(([k, l]) => `<button class="chip ${state.type === k ? 'active' : ''}" data-type="${k}">${l}</button>`).join('')}<span style="width:12px"></span>${filters.map(([k, l]) => `<button class="chip ${state.filter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
        ${state.type === 'airport' ? `<p class="muted small" style="margin-bottom:10px">${TP.icon('plane', 15)} البحث الأوتوماتيك عن الرحلات الشهر ده: ${usage} من ${limit}. بعد كده الميعاد بيتكتب باليد. <span class="muted">بيانات الرحلات: AeroDataBox</span></p>` : ''}
        ${list.length ? `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>الميعاد</th><th>المشوار</th><th>السواق</th><th>من → إلى</th><th>الحالة</th>${seePrice ? '<th>سعر المصنع</th><th>أجر السواق</th>' : ''}<th></th></tr></thead>
          <tbody>${list.map(m => {
            const p = TP.q.person(m.driverId), f = TP.q.company(m.factoryId), s = O.MISSION_STATUS[m.status] || ['', 'st-off'], ev = m.events || {};
            const steps = O.missionSteps(m).filter(x => ev[x.key]).map(x => `${x.short} ${O.hm12(O.hm(ev[x.key].at))}${ev[x.key].far ? ' ⚠' : ''}`).join(' · ');
            const cs = m.customers || [];
            return `<tr>
              <td class="small"><bdi dir="ltr">${esc(m.day)}</bdi>${m.time ? `<br>${esc(O.hm12(m.time))}` : (m.type === 'airport' ? '<br><span class="badge-s nogps">مستني الرحلة</span>' : '')}${m.day === today ? ' <span class="tag gold">النهارده</span>' : ''}</td>
              <td><b>${m.type === 'airport' ? '✈ ' : ''}${esc(m.title)}</b><div class="muted small">${esc(f ? f.name : m.client || '')}${cs.length ? ' · ' + cs.length + ' عميل' : ''}${m.cash ? ` · <span class="tag gold">كاش ${esc(TP.money(m.cash.amount))}${m.cashGot ? ' ✓' : ''}</span>` : ''}</div>${m.flight ? `<div class="small">${flightLine(m)}</div>` : ''}${problems(m).map(t => `<div><span class="badge-s far">⚠ ${esc(t)}</span></div>`).join('')}</td>
              <td>${esc(TP.driverLabel(p))}${p && p.driverKind === 'tourism' ? '<div class="muted small">سياحة</div>' : ''}${m.subFrom ? `<div><span class="badge-s far">بديل عن ${esc(TP.q.dname(m.subFrom))}${seePrice ? ' — راجع السعر' : ''}</span></div>` : ''}</td>
              <td class="small">${esc((m.from && m.from.name) || '—')} ← ${esc((m.to && m.to.name) || '—')}</td>
              <td><span class="st ${s[1]}">${s[0]}</span>${m.status === 'assigned' ? (m.ack ? `<div class="small" style="color:var(--ok,#1d7a46)">✓ السواق استلم ${esc(O.hm12(O.hm(m.ack.at)))}</div>` : '<div><span class="badge-s nogps">⏳ السواق لسه ما استلمش</span></div>') : ''}${steps ? `<div class="muted small">${esc(steps)}</div>` : ''}</td>
              ${seePrice ? `<td class="num">${m.factoryId ? (live.pf[m.id] ? esc(TP.money(live.pf[m.id].amount)) : '<span class="st st-warn">لسه</span>') : '—'}</td><td class="num">${live.pd[m.id] ? esc(TP.money(live.pd[m.id].amount)) : '<span class="st st-warn">لسه</span>'}</td>` : ''}
              <td class="acts">${cs.length ? `<button class="icon-btn" title="لينكات العملاء" data-links="${esc(m.id)}">${TP.icon('external', 16)}</button>` : ''}
                ${canEdit ? `<button class="icon-btn" title="تعديل" data-edit="${esc(m.id)}">${TP.icon('edit', 16)}</button>` : ''}
                ${canPrice && m.status !== 'cancelled' ? `<button class="icon-btn" title="السعر" data-price="${esc(m.id)}">${TP.icon('money', 16)}</button>` : ''}
                ${canEdit && m.status !== 'done' && m.status !== 'cancelled' ? `<button class="icon-btn" title="إلغاء" data-cancel="${esc(m.id)}">${TP.icon('x', 16)}</button>` : ''}
                ${canEdit ? `<button class="icon-btn danger" title="حذف" data-del="${esc(m.id)}">${TP.icon('trash', 16)}</button>` : ''}</td></tr>`;
          }).join('')}</tbody></table></div>` : U.empty('مفيش مشاوير هنا')}
      </section>`;
      U.bindFilter(root, 'missionsQ', 'missions');
      const guard = fn => id => fn(id).catch(e => TP.toast(TP.errorText(e), 'warn'));
      root.querySelectorAll('[data-month]').forEach(b => b.onclick = () => { state.month = b.dataset.month; TP.rerender(); });
      const mp = root.querySelector('#mMonthPick'); if (mp) mp.onchange = () => { if (/^\d{4}-\d{2}$/.test(mp.value)) { state.month = mp.value; TP.rerender(); } };
      root.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { state.filter = b.dataset.filter; TP.rerender(); });
      root.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { state.type = b.dataset.type; TP.rerender(); });
      const add = root.querySelector('#addM'); if (add) add.onclick = () => openEditor(null, state.type === 'airport' ? { type: 'airport' } : null);
      root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
      root.querySelectorAll('[data-links]').forEach(b => b.onclick = () => openLinks(b.dataset.links).catch(e => TP.toast(TP.errorText(e), 'warn')));
      root.querySelectorAll('[data-price]').forEach(b => b.onclick = () => openPrice(b.dataset.price));
      root.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => guard(cancel)(b.dataset.cancel));
      root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => guard(remove)(b.dataset.del));
    }
  };
})(window.TP = window.TP || {});
