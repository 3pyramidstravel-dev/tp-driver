/* ==========================================================================
   نقل البرنامج القديم (أمر الشغل على Netlify) — GM only, inside "أمر الشغل".
   What the old program kept in its database moves with its numbers:
     · cash custody balance of each car
     · fuel card balance + its last operations
     · the driver's salary: base, extras, deductions
   What it kept only on the drivers' phones cannot be read from here:
     · the last odometer → typed once per car (in "إعداد" or here)
     · old trips → from the Excel files the drivers downloaded (optional)
   Pressing it again later reads the latest numbers again (same entries are
   replaced, not added twice) — the final move on the switch-over day.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui, O = TP.ops;
  const RTDB = 'https://three-pyramids-d8ce7-default-rtdb.firebaseio.com/tp/';
  // the old program's cars (its ids and names — never its codes or group links)
  const OLD = [{ id: 'toyota2023', name: 'تويوتا 2023' }, { id: 'elantra2025', name: 'هيونداي إلنترا 2025' }, { id: 'toyota2022', name: 'تويوتا 2022' }, { id: 'cn7', name: 'هيونداي CN7' }];
  const st = { map: TP.store.get('tp-migrate-map', {}), data: null, loading: false, error: '', imported: {} };
  const money = n => TP.money(Math.round((Number(n) || 0) * 100) / 100);
  const today = () => TP.dayKey(TP.now());
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const hash = s => TP.sha256(String(s)).then(h => h.slice(0, 16));

  async function readOld() {
    st.loading = true; st.error = ''; TP.rerender();
    try {
      const get = key => fetch(RTDB + encodeURIComponent(key) + '.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)));
      const out = {};
      for (const c of OLD) {
        const [cust, fuel, sal] = await Promise.all([get('tp_custody_' + c.id), get('tp_fuel_' + c.id), get('tp_salary_' + c.id)]);
        out[c.id] = { custody: cust && cust.balance !== undefined ? Number(cust.balance) || 0 : null, custodyAt: cust && cust.updated || '', fuel: fuel || null, salary: sal || null };
      }
      st.data = out;
    } catch (e) { console.error(e); st.error = 'مقدرناش نقرا البرنامج القديم — اتأكد من الإنترنت وحاول تاني (' + (e.message || '') + ')'; }
    st.loading = false; TP.rerender();
  }
  const sum = l => (l || []).reduce((a, x) => a + (Number(x && x.amount) || 0), 0);

  async function move() {
    const rows = OLD.filter(c => st.map[c.id] && st.data && st.data[c.id]);
    if (!rows.length) return TP.toast('اختار العربية الجديدة قدام كل عربية قديمة', 'warn');
    for (const c of rows) {
      const car = D.fleet.find(f => f.id === st.map[c.id]);
      if (!car) return TP.toast(`العربية المختارة لـ ${c.name} لسه مش متشغّل عليها أمر الشغل`, 'warn');
    }
    const lines = rows.map(c => { const d = st.data[c.id]; return `${c.name} ← ${TP.fleetView.carName(st.map[c.id])}: عهدة ${money(d.custody)} · بنزين ${money(d.fuel && d.fuel.balance)}${d.salary ? ' · مرتب ' + money(d.salary.baseSalary) : ''}`; });
    const again = rows.filter(c => (D.fleet.find(f => f.id === st.map[c.id]) || {}).migratedAt);
    const warnAgain = again.length ? '\n\n⚠ ' + again.map(c => c.name).join('، ') + ' اتنقلت قبل كده: رصيد العهدة والبنزين هيتكتب فوق الرصيد الحالي هنا. لو السواقين بدأوا يسجلوا على البرنامج الجديد، الرصيد الجديد هيضيع — انقل تاني بس يوم التحويل النهائي قبل ما يبدأوا.' : '';
    if (!(await TP.confirm('نقل البيانات', 'الأرصدة دي هتتكتب على العربيات الجديدة:\n' + lines.join('\n') + warnAgain, 'انقل'))) return;
    if (TP.needsPin(S.perms) && !(await S.confirmPin('تأكيد نقل البيانات'))) return;
    const M = O.monthOf(today()), ops = [], at = TP.now();
    for (const c of rows) {
      const vid = st.map[c.id], d = st.data[c.id], drv = TP.fleetView.driverOf(vid), carDoc = D.fleet.find(f => f.id === vid) || {};
      const note = 'نقل من البرنامج القديم (' + c.name + ')';
      const patch = { migratedAt: at, migratedFrom: c.id, updatedAt: TP.fb.ts() };
      const log = { cash: {}, fuel: {} };
      if (d.custody !== null) { patch.custody = Math.round(d.custody * 100) / 100; log.cash['old-set-' + c.id] = { day: today(), kind: 'set', amount: patch.custody, before: Number(carDoc.custody) || 0, note, by: S.person.id, byName: S.person.name, at }; }
      if (d.fuel) {
        patch.fuel = Math.round((Number(d.fuel.balance) || 0) * 100) / 100;
        log.fuel['old-set-' + c.id] = { day: today(), kind: 'set', amount: patch.fuel, before: Number(carDoc.fuel) || 0, note, by: S.person.id, byName: S.person.name, at };
      }
      ops.push({ op: 'update', path: 'fleet/' + vid, data: patch });
      // the old fuel operations go into the month they happened (they are history — the balance above is the truth)
      const byMonth = {};
      if (d.fuel && Array.isArray(d.fuel.history)) for (const [i, h] of d.fuel.history.entries()) {
        if (!h || !DAY.test(h.date || '') || !Number(h.amount)) continue;
        const kind = Number(h.amount) < 0 || /تعبئة/.test(h.type || '') ? 'fill' : 'charge';
        const id = 'old-' + await hash([c.id, h.date, h.type, h.amount, h.note, i].join('|'));
        (byMonth[O.monthOf(h.date)] = byMonth[O.monthOf(h.date)] || {})[id] = { day: h.date, kind, amount: Math.abs(Number(h.amount)), note: [h.note && h.note !== '-' ? h.note : '', 'البرنامج القديم'].filter(Boolean).join(' — '), by: S.person.id, byName: S.person.name, at, old: true };
      }
      (byMonth[M] = byMonth[M] || {});
      Object.assign(byMonth[M], log.fuel);
      Object.entries(byMonth).forEach(([m, f]) => ops.push({ op: 'set', path: `fleetLog/${vid}_${m}`, data: Object.assign({ vehicleId: vid, month: m, fuel: f, updatedAt: TP.fb.ts() }, m === M ? { cash: log.cash } : {}), merge: true }));
      // the salary of the driver of that car
      if (d.salary && drv && S.can('salary.manage')) {
        const ex = {}, de = {};
        (d.salary.extra || []).forEach((x, i) => { if (Number(x && x.amount)) ex['old-' + i] = { amount: Number(x.amount), note: x.note && x.note !== '-' ? x.note : 'إضافي', day: DAY.test(x.date || '') ? x.date : today(), by: 'البرنامج القديم', at }; });
        (d.salary.deductions || []).forEach((x, i) => { if (Number(x && x.amount)) de['old-' + i] = { amount: Number(x.amount), note: x.note && x.note !== '-' ? x.note : 'خصم', day: DAY.test(x.date || '') ? x.date : today(), by: 'البرنامج القديم', at }; });
        const base = Number(d.salary.baseSalary) || 0;
        ops.push({ op: 'set', path: 'salaryBase/' + drv.id, data: { base, updatedAt: TP.fb.ts(), by: S.person.name } });
        ops.push({ op: 'set', path: `salary/${drv.id}_${M}`, data: { driverId: drv.id, month: M, base, extra: ex, ded: de, updatedAt: TP.fb.ts(), migrated: true }, merge: true });
      }
    }
    for (let i = 0; i < ops.length; i += 400) await TP.fb.batch(ops.slice(i, i + 400));
    TP.audit('fleet.migrate', rows.map(c => c.name).join('، '), lines.join(' | '));
    TP.toast('اتنقل ✓ — راجع الأرقام في صفحة العربيات');
  }

  /* ---------- old trips from the drivers' Excel files (سجل_مشاوير_*.xlsx) ---------- */
  let lib = null;
  const loadLib = () => lib || (lib = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => { lib = null; rej(new Error('lib')); }; document.head.appendChild(s); }));
  /** "02:05 مساءً" → "14:05" */
  const to24 = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*(صباح|مساء)?/); if (!m) return ''; let h = Number(m[1]) % 12; if (m[3] === 'مساء') h += 12; else if (!m[3]) h = Number(m[1]); return String(h).padStart(2, '0') + ':' + m[2]; };
  async function importTrips(file, vid) {
    const X = await loadLib().catch(() => null);
    if (!X) return TP.toast('مقدرناش نفتح ملف الإكسيل — اتأكد من الإنترنت', 'warn');
    const wb = X.read(await file.arrayBuffer(), { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]];
    const rows = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    const hi = rows.findIndex(r => r.some(c => /بيان المأمورية/.test(c)));
    if (hi < 0) return TP.toast('الملف ده مش شيت مشاوير من البرنامج القديم', 'warn');
    const H = rows[hi].map(String), col = re => H.findIndex(h => re.test(h));
    const c = { day: col(/التاريخ/), time: col(/وقت/), task: col(/بيان المأمورية/), before: col(/قبل/), after: col(/بعد/), exp: col(/المصروف \(/), note: col(/بيان المصروف/) };
    const byMonth = {}, drv = TP.fleetView.driverOf(vid);
    let n = 0;
    for (const r of rows.slice(hi + 1)) {
      let day = String(r[c.day] || '').trim();
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(day)) { const [a, b, y] = day.split('/'); day = `${y.length === 2 ? '20' + y : y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`; }
      if (!DAY.test(day)) continue;
      const num = v => Math.max(0, Math.round(TP.num(String(v).replace(/[^\d.]/g, '')) || 0));
      const t = { day, time: to24(r[c.time]), task: String(r[c.task] || '').slice(0, 500), before: num(r[c.before]), after: num(r[c.after]), expense: Math.round((TP.num(String(r[c.exp]).replace(/[^\d.]/g, '')) || 0) * 100) / 100, expNote: String(r[c.note] || '').replace(/^-$/, '').slice(0, 120), by: drv ? drv.id : S.person.id, at: TP.now(), old: true };
      const id = 'old-' + await hash([vid, t.day, t.time, t.task, t.before, t.after].join('|'));
      (byMonth[O.monthOf(day)] = byMonth[O.monthOf(day)] || {})[id] = t; n++;
    }
    if (!n) return TP.toast('مفيش مشاوير في الملف ده', 'warn');
    await TP.fb.batch(Object.entries(byMonth).map(([m, trips]) => ({ op: 'set', path: `fleetLog/${vid}_${m}`, data: { vehicleId: vid, month: m, trips, updatedAt: TP.fb.ts() }, merge: true })));
    st.imported[vid] = (st.imported[vid] || 0) + n;
    TP.audit('fleet.import', TP.fleetView.carName(vid), n + ' مشوار من ' + file.name);
    TP.toast(`اتضاف ${n} مشوار ✓ (من غير ما يتخصم من العهدة — دي مشاوير قديمة)`);
    TP.rerender();
  }

  TP.fleetMigrate = {
    html() {
      const cars = D.fleet.filter(c => c.on !== false);
      const d = st.data;
      return `<div class="banner info" style="margin-bottom:12px">${TP.icon('file')}<span class="grow">بينقل من البرنامج القديم: رصيد العهدة، ورصيد فيزا البنزين وآخر عملياتها، ومرتب السواق (الأساسي والإضافي والخصومات). لو دوست تاني بعدين، بياخد الأرقام الأحدث ومش بيكرر حاجة — علشان يوم التحويل.</span></div>
        <div class="banner warn" style="margin-bottom:12px">${TP.icon('warn')}<span class="grow">آخر عداد ومشاوير البرنامج القديم كانت محفوظة على موبايلات السواقين بس. العداد اكتبه من "إعداد" العربية، والمشاوير القديمة ضيفها من ملفات الإكسيل اللي السواقين نزّلوها (اختياري).</span></div>
        ${cars.length ? '' : '<div class="banner danger" style="margin-bottom:12px"><span>شغّل أمر الشغل على العربيات الأول من تبويب "العربيات".</span></div>'}
        <div class="table-wrap"><table class="tbl"><thead><tr><th>العربية في البرنامج القديم</th><th>العربية هنا</th><th>العهدة</th><th>البنزين</th><th>المرتب</th><th>مشاوير قديمة (إكسيل)</th></tr></thead><tbody>
          ${OLD.map(c => { const x = d && d[c.id]; return `<tr><td><b>${esc(c.name)}</b></td>
            <td><select class="input" data-mapc="${c.id}"><option value="">—</option>${cars.map(f => `<option value="${esc(f.id)}" ${st.map[c.id] === f.id ? 'selected' : ''}>${esc(TP.fleetView.carName(f.id))}</option>`).join('')}</select></td>
            <td class="num">${x ? (x.custody === null ? '—' : esc(money(x.custody))) : ''}</td>
            <td class="num">${x ? (x.fuel ? esc(money(x.fuel.balance)) + `<div class="muted small">${(x.fuel.history || []).length} عملية</div>` : '—') : ''}</td>
            <td class="num">${x ? (x.salary ? esc(money(x.salary.baseSalary)) + `<div class="muted small">+${esc(money(sum(x.salary.extra)))} −${esc(money(sum(x.salary.deductions)))}</div>` : '—') : ''}</td>
            <td>${st.map[c.id] ? `<label class="btn btn-ghost btn-sm">${TP.icon('plus', 15)}ملف إكسيل<input type="file" accept=".xlsx,.xls" data-imp="${esc(st.map[c.id])}" hidden></label>${st.imported[st.map[c.id]] ? ` <span class="st st-ok">${st.imported[st.map[c.id]]} مشوار</span>` : ''}` : ''}</td></tr>`; }).join('')}
        </tbody></table></div>
        ${st.error ? `<div class="banner danger" style="margin-top:10px">${esc(st.error)}</div>` : ''}
        <div class="toolbar" style="margin-top:12px"><button class="btn btn-ghost" id="mgRead" ${st.loading ? 'disabled' : ''}>${TP.icon('refresh', 18)}${st.loading ? 'بيقرا…' : d ? 'اقرا تاني' : 'اقرا البرنامج القديم'}</button>
          ${d ? `<button class="btn btn-primary" id="mgMove">${TP.icon('check', 18)}انقل الأرصدة والمرتبات</button>` : ''}</div>`;
    },
    bind(root) {
      root.querySelectorAll('[data-mapc]').forEach(s => s.onchange = () => { st.map[s.dataset.mapc] = s.value; TP.store.set('tp-migrate-map', st.map); TP.rerender(); });
      const r = root.querySelector('#mgRead'); if (r) r.onclick = () => readOld();
      const m = root.querySelector('#mgMove'); if (m) m.onclick = () => move().catch(e => { console.error(e); TP.toast(TP.errorText(e), 'warn'); });
      root.querySelectorAll('[data-imp]').forEach(i => i.onchange = () => { const f = i.files && i.files[0]; if (f) importTrips(f, i.dataset.imp).catch(e => { console.error(e); TP.toast('الملف مش مقروء', 'warn'); }); });
    }
  };
})(window.TP = window.TP || {});
