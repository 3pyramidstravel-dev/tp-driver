/* ==========================================================================
   Factory portal (HR of one factory — it never sees another factory)
     النهارده : its lines and trips of today — where each car is, who rode,
                who said "مش راكب", who did not come
     الغياب   : the month per employee (اعتذر / مجاش, with the days)
     الطلبات  : ask for a trip or an airport transfer, or a change of the
                customers (applied by the Control Tower) — and follow them
     الكشوفات : the monthly sheets the GM approved (PDF or Excel)
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP, S = TP.session, O = TP.ops;
  const st = { tab: 'today', factory: null, settings: {}, excused: {}, absExc: null, lines: [], days: [], missions: [], requests: [], sheets: [], dayOff: [], cards: {}, track: {}, absMonth: '', absDays: null, sheetOpen: null };
  let unsubs = [], trackSubs = {};
  const fid = () => S.person.factoryId;
  const today = () => TP.dayKey(TP.now());
  const val = id => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };

  /* ---------- data ---------- */
  function stop() { unsubs.forEach(u => { try { u(); } catch (e) { /* ignore */ } }); unsubs = []; Object.values(trackSubs).forEach(u => u()); trackSubs = {}; }
  function start() {
    stop();
    const f = fid(), d = today(), on = u => unsubs.push(u), warn = w => e => console.warn(w, e && e.code);
    on(TP.fb.onDoc('companies/' + f, c => { st.factory = c; render(); }, warn('company')));
    on(TP.fb.onDoc('system/settings', s => { st.settings = s || {}; render(); }, warn('settings')));
    on(TP.fb.onCol('lines', { where: [['factoryId', '==', f]] }, l => { st.lines = l.filter(x => x.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar')); syncTrack(); render(); }, warn('lines')));
    on(TP.fb.onCol('days', { where: [['factoryId', '==', f], ['day', '==', d]] }, l => { st.days = l; render(); }, warn('days')));
    on(TP.fb.onCol('missions', { where: [['factoryId', '==', f], ['day', '==', d]] }, l => { st.missions = l.filter(m => m.status !== 'cancelled'); render(); }, warn('missions')));
    on(TP.fb.onCol('requests', { where: [['factoryId', '==', f]] }, l => { st.requests = l.sort((a, b) => ((TP.toDate(b.at) || 0) - (TP.toDate(a.at) || 0))); render(); }, warn('requests')));
    on(TP.fb.onCol('sheets', { where: [['factoryId', '==', f], ['status', '==', 'approved']] }, l => { st.sheets = l.sort((a, b) => (a.month < b.month ? 1 : -1)); render(); }, warn('sheets')));
    on(TP.fb.onCol('dayOff', { where: [['day', '==', d]] }, l => { st.dayOff = l; render(); }, warn('dayOff')));
    on(TP.fb.onCol('excused', { where: [['factoryId', '==', f], ['day', '==', d]] }, l => { st.excused = {}; l.forEach(x => { st.excused[x.lineId] = x; }); render(); }, warn('excused')));
  }
  function syncTrack() {
    const want = new Set(st.lines.flatMap(l => O.lineCustomers(l).map(c => c.h).filter(Boolean)));
    Object.keys(trackSubs).forEach(t => { if (!want.has(t)) { trackSubs[t](); delete trackSubs[t]; } });
    want.forEach(t => { if (!trackSubs[t]) trackSubs[t] = TP.fb.onDoc('track/' + t, x => { st.track[t] = x; render(); }, () => {}); });
  }
  function card(pid) {
    if (!pid) return null;
    if (!(pid in st.cards)) { st.cards[pid] = null; TP.fb.get('cards/' + pid).then(c => { st.cards[pid] = c || { name: '' }; render(); }).catch(() => {}); }
    return st.cards[pid];
  }
  const dlabel = pid => { const c = card(pid); return c ? TP.driverLabel(c) : '…'; };

  /* ---------- النهارده ---------- */
  function lineState(line, doc) {
    const ev = (doc && doc.events) || {};
    if (ev.fe_dep || ev.end) return ['رجعوا — اليوم خلص', 'st-ok'];
    if (ev.fe_arr) return ['العربية عند المصنع للرجوع', 'st-warn'];
    if (ev.fm_arr) return ['وصلوا المصنع', 'st-ok'];
    const keys = Object.keys(ev).filter(k => /^p\d_(arr|dep)$/.test(k)).sort((a, b) => ev[a].at - ev[b].at);
    if (keys.length) { const k = keys[keys.length - 1], i = Number(k[1]), p = (line.points || [])[i]; return [(k.endsWith('arr') ? 'عند ' : 'اتحرك من ') + ((p && p.name) || 'النقطة'), 'st-info']; }
    return ['لسه متحركش', 'st-off'];
  }
  function custState(c, doc, lid) {
    const r = O.riderOf(doc, c.id, st.excused[lid]), t = st.track[c.h];
    if (r && r.s === 'picked') return ['ركب', 'st-ok'];
    if (r && r.s === 'noshow') return ['مجاش', 'st-danger'];
    if ((r && r.s === 'skip') || O.skipsOn(t, today())) return ['اعتذر النهارده', 'st-off'];
    if (t && t.day === today() && t.st === 'arrived') return ['العربية عنده', 'st-warn'];
    if (t && t.day === today() && t.st === 'near') return ['العربية جاية له', 'st-info'];
    return ['—', 'st-off'];
  }
  function renderToday() {
    const off = st.dayOff.find(o => o.factoryId === 'all' || o.factoryId === fid());
    let h = off ? `<div class="banner warn">${TP.icon('calendar')}<span>${off.type === 'cancelled' ? 'شغل النهارده اتلغى' : 'النهارده إجازة'}${off.note ? ' — ' + esc(off.note) : ''}</span></div>` : '';
    h += st.lines.map(l => {
      const doc = st.days.find(d => d.lineId === l.id), s = lineState(l, doc), cs = O.lineCustomers(l);
      const did = (doc && doc.driverId) || (l.subDay === today() && l.subDriverId) || l.driverId;
      return `<section class="glass card"><div class="dv-h"><div><h2>${esc(l.name)}</h2><div class="sub">${did ? esc(dlabel(did)) : 'بدون سواق'}${l.morningTime ? ' · الصبح ' + esc(O.hm12(l.morningTime)) : ''}${l.eveningTime ? ' · الرجوع ' + esc(O.hm12(l.eveningTime)) : ''}</div></div><span class="st ${s[1]}">${esc(s[0])}</span></div>
        ${cs.length ? `<div class="p-custs">${cs.map(c => { const x = custState(c, doc, l.id); return `<div class="p-cust"><span><b>${esc(c.name)}</b><small class="muted"> ${esc(c.pointName)}</small></span><span class="st ${x[1]}">${esc(x[0])}</span></div>`; }).join('')}</div>` : '<p class="muted small">الخط ده مفيهوش عملاء متسجلين.</p>'}</section>`;
    }).join('') || '<section class="glass card"><div class="empty">مفيش خطوط متسجلة للمصنع.</div></section>';
    if (st.missions.length) h += `<section class="glass card"><div class="dv-h"><h2>مشاوير النهارده</h2></div>${st.missions.map(m => { const ms = O.MISSION_STATUS[m.status] || ['', 'st-off']; return `<div class="p-cust"><span><b>${m.type === 'airport' ? '✈ ' : ''}${esc(m.title || 'مشوار')}</b><small class="muted"> ${m.time ? esc(O.hm12(m.time)) + ' · ' : ''}${esc((m.customers || []).map(c => c.name).join('، '))}</small></span><span class="st ${ms[1]}">${esc(ms[0])}</span></div>`; }).join('')}</section>`;
    return h;
  }

  /* ---------- الغياب ---------- */
  function loadAbs(month) {
    st.absMonth = month; st.absDays = null; render();
    const w = { where: [['factoryId', '==', fid()], ['month', '==', month]] };
    Promise.all([TP.fb.list('days', w), TP.fb.list('excused', w).catch(() => [])]).then(([l, ex]) => {
      if (st.absMonth !== month) return;
      const exOf = {}; ex.forEach(x => { exOf[x.lineId + '_' + x.day] = x; });
      ex.forEach(x => { if (!l.some(d => d.lineId === x.lineId && d.day === x.day)) l.push({ lineId: x.lineId, factoryId: x.factoryId, day: x.day }); });
      st.absDays = l.map(d => Object.assign({}, d, { _r: O.ridersOf(d, exOf[d.lineId + '_' + d.day]) })); render();
    }).catch(e => { st.absDays = []; TP.toast(TP.errorText(e), 'warn'); render(); });
  }
  function renderAbs() {
    const M = O.monthOf(today());
    if (!st.absMonth) { loadAbs(M); return '<div class="spinner"></div>'; }
    const months = [M, O.addMonths(M, -1), O.addMonths(M, -2)];
    let body = '<div class="spinner"></div>';
    if (st.absDays) {
      const names = {}, out = {};
      st.lines.forEach(l => O.lineCustomers(l).forEach(c => { names[c.id] = { name: c.name, line: l.name }; }));
      st.absDays.forEach(d => Object.entries(d._r || {}).forEach(([cid, r]) => {
        if (!r || (r.s !== 'skip' && r.s !== 'noshow')) return;
        const o = out[cid] = out[cid] || { name: (names[cid] || {}).name || r.n || 'موظف اتشال من الخط', line: (names[cid] || {}).line || '', skip: 0, noshow: 0, days: [] };
        o[r.s]++; o.days.push(`${d.day.slice(8)}/${d.day.slice(5, 7)} ${r.s === 'skip' ? 'اعتذر' : 'مجاش'}`);
      }));
      const rows = Object.values(out).sort((a, b) => (b.skip + b.noshow) - (a.skip + a.noshow));
      st.absRows = rows;
      body = rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>الموظف</th><th>اعتذر</th><th>مجاش</th><th>الأيام</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(r.name)}</b><div class="muted small">${esc(r.line)}</div></td><td class="num">${r.skip}</td><td class="num">${r.noshow ? `<b style="color:var(--danger)">${r.noshow}</b>` : 0}</td><td class="small">${esc(r.days.join(' · '))}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted small" style="margin-top:8px">"اعتذر" = الموظف بلّغ من لينكه إنه مش راكب. "مجاش" = العربية استنته في النقطة ومجاش (المكان متسجل).</p>` : '<div class="empty">مفيش غياب في الشهر ده.</div>';
    }
    return `<section class="glass card"><div class="dv-h"><h2>غياب الموظفين</h2>${st.absDays && (st.absRows || []).length ? `<button type="button" class="btn btn-ghost btn-sm" id="absDown">${TP.icon('file', 16)}تنزيل</button>` : ''}</div><div class="month-pick">${months.map(m => `<button type="button" class="chip ${m === st.absMonth ? 'active' : ''}" data-am="${m}">${esc(O.monthName(m))}</button>`).join('')}</div>${body}</section>`;
  }

  /* ---------- الطلبات ---------- */
  const REQ = { mission: 'مشوار', airport: 'مطار', customer: 'تعديل عملاء' }, RS = { pending: ['مستني', 'st-warn'], done: ['اتنفذ', 'st-ok'], rejected: ['اترفض', 'st-danger'], cancelled: ['اتلغى', 'st-off'] };
  const ACT = { add: 'إضافة موظف', edit: 'تعديل بيانات موظف', remove: 'شيل موظف' };
  function placeIn(prefix, label) { return `<label class="fld">${label}<input class="input" id="${prefix}N" maxlength="80"></label><label class="fld">اللوكيشن <small>اختياري — لينك جوجل ماب</small><input class="input" id="${prefix}L" dir="ltr"></label>`; }
  function readPlace(prefix) { const name = val(prefix + 'N'), raw = val(prefix + 'L'), location = raw ? TP.parseLocation(raw) : null; if (raw && !location) return { error: 'اللوكيشن مش مقروء' }; return { name, location }; }
  function newRequest(type) {
    const base = { type, factoryId: fid(), by: S.person.id, byName: S.person.name, status: 'pending', at: TP.fb.ts() };
    if (type === 'customer') {
      TP.openModal('طلب تعديل عملاء', `<div class="form-grid">
        <label class="fld full">الطلب<select class="input" id="qAct">${Object.keys(ACT).map(k => `<option value="${k}">${ACT[k]}</option>`).join('')}</select></label>
        <label class="fld full">الخط<select class="input" id="qLine">${st.lines.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select></label>
        <label class="fld full" id="qCustBox">الموظف<select class="input" id="qCust"></select></label>
        <label class="fld full" id="qPointBox">النقطة<select class="input" id="qPoint"></select></label>
        <label class="fld" id="qNameBox">الاسم<input class="input" id="qName" maxlength="60"></label>
        <label class="fld" id="qPhoneBox">الموبايل<input class="input" id="qPhone" inputmode="tel" dir="ltr" maxlength="16"></label>
        <label class="fld full" id="qHomeBox">لوكيشن البيت <small>اختياري</small><input class="input" id="qHome" dir="ltr"></label>
        <label class="fld full">ملاحظة<input class="input" id="qNotes" maxlength="200"></label></div>`, async () => {
        const action = val('qAct'), line = st.lines.find(l => l.id === val('qLine'));
        if (!line) { TP.toast('اختار الخط'); return false; }
        const data = Object.assign({}, base, { action, lineId: line.id, notes: val('qNotes') });
        if (action !== 'add') { data.custId = val('qCust'); if (!data.custId) { TP.toast('اختار الموظف'); return false; } }
        if (action !== 'remove') {
          const name = val('qName'), phone = TP.latinDigits(val('qPhone')), homeRaw = val('qHome'), home = homeRaw ? TP.parseLocation(homeRaw) : null;
          if (action === 'add' && !name) { TP.toast('اكتب الاسم'); return false; }
          if (phone && !TP.phoneIntl(phone)) { TP.toast('رقم الموبايل مش مظبوط'); return false; }
          if (homeRaw && !home) { TP.toast('لوكيشن البيت مش مقروء'); return false; }
          data.cust = { name, phone }; if (home) data.cust.home = home;
          const cur = action === 'edit' ? O.lineCustomers(line).find(x => x.id === data.custId) : null;
          const pi = Number(val('qPoint')) || 0;
          data.pointIdx = cur && cur.pointIdx === pi ? -1 : pi;   // -1 = stays on his point
        }
        await TP.fb.add('requests', data);
        TP.toast('الطلب اتبعت ✓ — هيوصلك الرد هنا');
      }, { saveLabel: 'ابعت الطلب', wide: true });
      const fill = () => {
        const act = val('qAct'), line = st.lines.find(l => l.id === val('qLine'));
        const keep = val('qCust');
        TP.$('#qCust').innerHTML = line ? O.lineCustomers(line).map(c => `<option value="${esc(c.id)}" ${c.id === keep ? 'selected' : ''}>${esc(c.name)} — ${esc(c.pointName)}</option>`).join('') : '';
        const cur = line && act === 'edit' ? O.lineCustomers(line).find(x => x.id === val('qCust')) : null;
        TP.$('#qPoint').innerHTML = line ? (line.points || []).map((p, i) => `<option value="${i}" ${cur && cur.pointIdx === i ? 'selected' : ''}>${esc(p.name)}</option>`).join('') : '';
        TP.$('#qCustBox').hidden = act === 'add';
        ['qPointBox', 'qNameBox', 'qPhoneBox', 'qHomeBox'].forEach(id => { TP.$('#' + id).hidden = act === 'remove'; });
      };
      TP.$('#qAct').onchange = fill; TP.$('#qLine').onchange = fill; TP.$('#qCust').onchange = fill; fill();
      return;
    }
    const air = type === 'airport';
    TP.openModal(air ? 'طلب مشوار مطار' : 'طلب مشوار', `<div class="form-grid">
      ${air ? `<label class="fld">رقم الرحلة<input class="input" id="qFlight" dir="ltr" placeholder="MS 777" maxlength="10"></label>
        <label class="fld">النوع<select class="input" id="qDir"><option value="arr">استقبال (جاي من السفر)</option><option value="dep">توصيل (مسافر)</option></select></label>
        <label class="fld">تاريخ الطيارة<input class="input" type="date" id="qDay" value="${esc(today())}"></label>` : `<label class="fld">اليوم<input class="input" type="date" id="qDay" value="${esc(today())}"></label>
        <label class="fld">الميعاد<input class="input" type="time" id="qTime"></label>`}
      <label class="fld">اسم الضيف / الموظف<input class="input" id="qPax" maxlength="60"></label>
      <label class="fld">موبايله<input class="input" id="qPaxPh" inputmode="tel" dir="ltr" maxlength="16"></label>
      ${placeIn('qF', air ? 'هيتاخد منين (لو مسافر)' : 'من')}${placeIn('qT', air ? 'هيروح فين (لو جاي)' : 'إلى')}
      <label class="fld full">ملاحظات<textarea class="input" id="qNotes" rows="2" maxlength="300"></textarea></label></div>`, async () => {
      const day = val('qDay'); if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { TP.toast('اختار اليوم'); return false; }
      const from = readPlace('qF'), to = readPlace('qT'); if (from.error || to.error) { TP.toast(from.error || to.error); return false; }
      const phone = TP.latinDigits(val('qPaxPh')); if (phone && !TP.phoneIntl(phone)) { TP.toast('رقم الموبايل مش مظبوط'); return false; }
      const data = Object.assign({}, base, { day, from, to, notes: val('qNotes'), pax: { name: val('qPax'), phone } });
      if (air) { data.flightNo = TP.flight.norm(val('qFlight')); data.dir = val('qDir'); if (!TP.flight.valid(data.flightNo)) { TP.toast('اكتب رقم الرحلة صح (مثال MS777)'); return false; } }
      else { data.time = val('qTime'); }
      if (!data.pax.name) { TP.toast('اكتب اسم الضيف'); return false; }
      await TP.fb.add('requests', data);
      TP.toast('الطلب اتبعت ✓ — هيوصلك الرد هنا');
    }, { saveLabel: 'ابعت الطلب', wide: true });
  }
  function reqLine(r) {
    if (r.type === 'customer') { const l = st.lines.find(x => x.id === r.lineId); return `${ACT[r.action] || ''} — ${esc(l ? l.name : '')}${r.cust && r.cust.name ? ' — ' + esc(r.cust.name) : ''}`; }
    return `${r.type === 'airport' ? `✈ <span dir="ltr">${esc(r.flightNo || '')}</span> · ` : ''}<bdi dir="ltr">${esc(r.day || '')}</bdi>${r.time ? ' ' + esc(O.hm12(r.time)) : ''}${r.pax && r.pax.name ? ' — ' + esc(r.pax.name) : ''}`;
  }
  function renderReq() {
    return `<section class="glass card"><div class="dv-h"><h2>طلب جديد</h2></div><div class="p-new">
      <button type="button" class="act" data-new="mission">${TP.icon('file', 26)}<span><b>طلب مشوار</b><small>ضيف أو وفد أو مأمورية</small></span></button>
      <button type="button" class="act" data-new="airport">${TP.icon('plane', 26)}<span><b>طلب مطار</b><small>رقم الرحلة كفاية</small></span></button>
      <button type="button" class="act" data-new="customer">${TP.icon('users', 26)}<span><b>تعديل الموظفين على الخطوط</b><small>إضافة / تعديل / شيل</small></span></button></div></section>
      <section class="glass card"><div class="dv-h"><h2>طلباتي</h2></div>${st.requests.length ? st.requests.slice(0, 40).map(r => { const s = RS[r.status] || ['', 'st-off']; return `<div class="p-cust"><span><b>${esc(REQ[r.type] || '')}</b><small class="muted"> ${reqLine(r)}</small>${r.decisionNote ? `<small class="muted" style="display:block">الرد: ${esc(r.decisionNote)}</small>` : ''}</span><span style="display:flex;gap:6px;align-items:center"><span class="st ${s[1]}">${esc(s[0])}</span>${r.status === 'pending' ? `<button type="button" class="btn btn-ghost btn-sm" data-cancel="${esc(r.id)}">إلغاء</button>` : ''}</span></div>`; }).join('') : '<div class="empty">لسه مفيش طلبات.</div>'}</section>`;
  }

  /* ---------- الكشوفات ---------- */
  function renderSheets() {
    if (st.sheetOpen) {
      const sh = st.sheets.find(x => x.id === st.sheetOpen); if (!sh) { st.sheetOpen = null; return renderSheets(); }
      const sd = sh.data || {}, fin = sd.finance && TP.financeOn(st.settings), money = v => v === null || v === undefined ? '—' : esc(TP.money(v));
      return `<section class="glass card"><div class="dv-h"><div><h2>كشف ${esc(O.monthName(sh.month))}</h2><div class="sub">معتمد من ${esc(sh.approvedBy || '')}</div></div><button type="button" class="btn btn-ghost btn-sm" id="shBack">رجوع</button></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>الخط</th><th>كامل</th><th>نص</th><th>سهرات</th><th>انتظار</th>${fin ? '<th>المبلغ</th>' : ''}</tr></thead><tbody>${(sd.lines || []).map(l => `<tr><td>${esc(l.name)}</td><td class="num">${l.full}</td><td class="num">${l.half}</td><td class="num">${l.ot}</td><td class="num">${l.wait} د</td>${fin ? `<td class="num">${money(l.amount)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
        ${(sd.missions || []).length ? `<h3 class="p-h3">المشاوير (${sd.missions.length})</h3><div class="table-wrap"><table class="tbl"><tbody>${sd.missions.map(m => `<tr><td><bdi dir="ltr">${esc(m.day)}</bdi></td><td>${m.type === 'airport' ? '✈ ' : ''}${esc(m.title)}</td>${fin ? `<td class="num">${money(m.amount)}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : ''}
        ${(sd.absences || []).length ? `<h3 class="p-h3">الغياب</h3><div class="table-wrap"><table class="tbl"><tbody>${sd.absences.map(a => `<tr><td>${esc(a.name)}<div class="muted small">${esc(a.line)}</div></td><td class="num">اعتذر ${a.skip}</td><td class="num">مجاش ${a.noshow}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${fin && sd.totals ? `<table class="stmt" style="margin-top:12px"><tbody><tr><td>الخطوط</td><td>${money(sd.totals.lines)}</td></tr><tr><td>المشاوير</td><td>${money(sd.totals.missions)}</td></tr><tr class="total"><td>الإجمالي</td><td>${money(sd.totals.total)}</td></tr><tr><td>الضريبة ${esc(sd.totals.pct)}%</td><td>${money(sd.totals.tax)}</td></tr></tbody></table>` : ''}
        <div class="p-tools"><button type="button" class="btn btn-primary" id="shDown">${TP.icon('file', 18)}تنزيل الكشف (PDF أو Excel)</button></div></section>`;
    }
    return `<section class="glass card"><div class="dv-h"><h2>الكشوفات الشهرية</h2></div>${st.sheets.length ? st.sheets.map(sh => `<button type="button" class="p-sheet" data-sheet="${esc(sh.id)}"><b>${esc(O.monthName(sh.month))}</b><span class="st st-ok">معتمد</span></button>`).join('') : '<div class="empty">لسه مفيش كشوفات معتمدة. الكشف بيظهر هنا بعد ما الإدارة تعتمده.</div>'}</section>`;
  }

  /* ---------- shell ---------- */
  function draw() {
    if (!S.ready) return;
    TP.$('#hello').innerHTML = `<span class="caps">CLIENT PORTAL</span><h1>أهلاً ${esc(S.person.name)}</h1><p class="muted">${esc(st.factory ? st.factory.name : '')}</p>`;
    const pend = st.requests.filter(r => r.status === 'pending').length;
    TP.$('#tabs').innerHTML = [['today', 'النهارده'], ['abs', 'الغياب'], ['req', 'الطلبات' + (pend ? ` (${pend})` : '')], ['sheets', 'الكشوفات']].map(([k, l]) => `<button type="button" class="chip ${st.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('');
    const root = TP.$('#info');
    root.innerHTML = st.tab === 'today' ? renderToday() : st.tab === 'abs' ? renderAbs() : st.tab === 'req' ? renderReq() : renderSheets();
    TP.hydrateIcons(root);
    TP.$$('#tabs [data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; st.sheetOpen = null; render(); window.scrollTo(0, 0); });
    TP.$$('[data-am]', root).forEach(b => b.onclick = () => loadAbs(b.dataset.am));
    TP.$$('[data-new]', root).forEach(b => b.onclick = () => newRequest(b.dataset.new));
    TP.$$('[data-cancel]', root).forEach(b => b.onclick = async () => { if (await TP.confirm('إلغاء الطلب', 'الطلب هيتلغي.', 'إلغاء الطلب', true)) TP.fb.update('requests/' + b.dataset.cancel, { status: 'cancelled' }).catch(e => TP.toast(TP.errorText(e), 'warn')); });
    TP.$$('[data-sheet]', root).forEach(b => b.onclick = () => { st.sheetOpen = b.dataset.sheet; render(); });
    const back = TP.$('#shBack', root); if (back) back.onclick = () => { st.sheetOpen = null; render(); };
    const dl = TP.$('#shDown', root); if (dl) dl.onclick = () => {
      const sh = st.sheets.find(x => x.id === st.sheetOpen), sd = Object.assign({}, sh.data || {});
      if (!TP.financeOn(st.settings)) { sd.finance = false; delete sd.totals; }
      const f = st.factory && st.factory.name;
      TP.report.choose(Object.assign(TP.xlsx.sheetReport(sd, f, O.monthName(sh.month)), { fileName: `TP-${(st.factory && st.factory.nameEn) || 'sheet'}-${sh.month}`, by: 'معتمد من ' + (sh.approvedBy || ''), audit: false }));
    };
    const ad = TP.$('#absDown', root); if (ad) ad.onclick = () => TP.report.choose({ title: 'غياب الموظفين', subtitle: st.factory ? st.factory.name : '', period: O.monthName(st.absMonth), fileName: `TP-absences-${st.absMonth}`, audit: false,
      kpis: [['موظفين غابوا', st.absRows.length], ['اعتذر', st.absRows.reduce((a, r) => a + r.skip, 0)], ['مجاش', st.absRows.reduce((a, r) => a + r.noshow, 0), 'bad']],
      sections: [{ title: 'غياب الموظفين', columns: [{ h: 'الموظف' }, { h: 'الخط' }, { h: 'اعتذر', t: 'int', sum: true }, { h: 'مجاش', t: 'int', sum: true }, { h: 'الأيام', w: 44 }], rows: st.absRows.map(r => [r.name, r.line, r.skip, r.noshow, r.days.join(' · ')]), totals: true,
        note: '"اعتذر" = الموظف بلّغ من لينكه إنه مش راكب. "مجاش" = العربية استنته في النقطة ومجاش (المكان متسجل).' }] });
  }
  /** Many live documents change together — draw once per frame. */
  let queued = false;
  function render() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); }

  document.addEventListener('tp:session', () => { TP.$('#app').hidden = false; start(); draw(); });
  document.addEventListener('tp:session-end', () => { TP.$('#app').hidden = true; stop(); });
  let shownDay = '';
  document.addEventListener('tp:session', () => { shownDay = today(); });
  setInterval(() => { if (S.ready && shownDay && today() !== shownDay) { shownDay = today(); start(); } }, 60000);   // a new day
  S.start({ kind: 'hr', base: '../shared/' });
})(window.TP = window.TP || {});
