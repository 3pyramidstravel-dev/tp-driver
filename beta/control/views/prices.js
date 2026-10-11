/* ==========================================================================
   Prices — two separate sides, never mixed:
     factoryRates/{factory}  what the factory pays   (factory HR can see its own)
     driverRates/{driver}    what the driver earns   (the driver sees only his own)
     airportRates/{factory}  airport trips for the factory
   Every change starts from a date; older months keep the old price.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui;
  const state = { tab: 'factory' };
  const money = v => (v === null || v === undefined) ? '<span class="muted">—</span>' : esc(TP.money(v));

  const FACTORY_FIELDS = [
    ['lineDay', 'سعر اليوم (ذهاب وعودة)', 'نص اليوم بيتحسب 50% أوتوماتيك'],
    ['waitHour', 'ساعة الانتظار (المسا)', 'بيتحسب بالدقيقة = السعر ÷ 60'],
    ['ot1', 'سهرة لحد 9 مساءً', ''], ['ot2', 'سهرة لحد 11 مساءً', ''], ['ot3', 'سهرة من 11 لنص الليل', '']
  ];
  const DRIVER_FIELDS = [
    ['lineDay', 'أجر اليوم (ذهاب وعودة)', 'نص اليوم 50%'],
    ['waitHour', 'ساعة الانتظار (المسا)', 'بالدقيقة = السعر ÷ 60'],
    ['ot1', 'سهرة لحد 9 مساءً', ''], ['ot2', 'سهرة لحد 11 مساءً', ''], ['ot3', 'سهرة من 11 لنص الليل', ''],
    ['tripDefault', 'سعر المشوار الافتراضي', 'للمشاوير والمأموريات — بيتعدل لكل مشوار']
  ];
  const AIRPORT_FIELDS = [
    ['trip', 'سعر مشوار المطار للمصنع', 'شامل أول ساعة انتظار'],
    ['extraHour', 'الساعة الإضافية بعد أول ساعة', 'كسر الساعة = ساعة كاملة']
  ];
  const EXTERNAL_FIELDS = [['tripDefault', 'سعر مشوار المطار للسواق الخارجي', 'يشوفه السواق الخارجي بس']];

  /* External-driver prices for an airport manager without "prices.view" (one doc each). */
  const extCache = {}, extSubs = {};
  function watchExternal() {
    if (S.can('prices.view') || !S.can('airport.prices')) return;
    TP.q.drivers('external').forEach(p => {
      if (extSubs[p.id]) return;
      extSubs[p.id] = TP.fb.onDoc('driverRates/' + p.id, d => { extCache[p.id] = d; TP.rerender(); }, () => {});
    });
  }
  const driverRatesDoc = id => D.driverRates[id] || extCache[id];

  /* ---------- value cards ---------- */
  function valuesHtml(entry, fields, extra) {
    if (!entry) return '<div class="banner warn" style="margin:0">لسه متحطش سعر</div>';
    return `<div class="rate-vals">${fields.map(([k, label]) => `<div class="rate-val"><span>${esc(label)}</span><strong>${money(entry[k])}</strong>${k === 'waitHour' && entry[k] != null ? `<small>الدقيقة ${esc(TP.money(TP.calc.perMinute(entry[k])))}</small>` : ''}${k === 'lineDay' && entry[k] != null ? `<small>نص اليوم ${esc(TP.money(TP.calc.dayAmount(entry[k], 'half')))}</small>` : ''}</div>`).join('')}${extra || ''}</div>`;
  }
  function historyHtml(history, fields) {
    if (!history || history.length < 2) return '';
    const today = TP.dayKey();
    return `<details class="history"><summary>سجل الأسعار (${history.length})</summary><div class="table-wrap" style="margin-top:8px"><table class="tbl">
      <thead><tr><th>من تاريخ</th>${fields.map(f => `<th>${esc(f[1])}</th>`).join('')}<th>بواسطة</th></tr></thead>
      <tbody>${history.slice().reverse().map(h => `<tr><td class="mono">${esc(h.from)}${h.from > today ? ' <span class="tag gold">قادم</span>' : ''}</td>${fields.map(f => `<td class="num">${money(h[f[0]])}</td>`).join('')}<td class="small">${esc(h.setBy || '')}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function card(title, sub, doc, fields, editAttr, extra) {
    const today = TP.dayKey(), hist = (doc && doc.history) || [];
    const cur = TP.rateAt(hist, today), next = hist.filter(h => h.from > today);
    return `<div class="rate-card"><div class="rate-head"><div><b>${esc(title)}</b>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>
      <div style="display:flex;gap:6px;align-items:center">${cur ? `<span class="muted small">ساري من <bdi dir="ltr">${esc(cur.from)}</bdi></span>` : ''}
      ${editAttr ? `<button class="btn btn-ghost btn-sm" ${editAttr}>${TP.icon('edit', 16)}سعر جديد</button>` : ''}</div></div>
      ${valuesHtml(cur, fields, extra && extra(cur))}
      ${next.length ? `<div class="banner info" style="margin:10px 0 0">${TP.icon('calendar', 18)}سعر جديد هيبدأ من <bdi dir="ltr">${esc(next[0].from)}</bdi></div>` : ''}
      ${historyHtml(hist, fields)}</div>`;
  }

  /* ---------- edit ---------- */
  async function edit(col, id, title, fields, extraFields) {
    const doc = col === 'driverRates' ? driverRatesDoc(id) : D[col][id];
    const cur = TP.rateAt((doc && doc.history) || [], TP.dayKey()) || {};
    const extras = extraFields ? extraFields(cur) : '';
    TP.openModal('سعر جديد — ' + title, `
      <div class="form-grid">
        <label class="fld full">يبدأ من تاريخ <small>الأيام اللي قبله بتفضل بالسعر القديم</small><input class="input" id="rFrom" type="date" value="${TP.dayKey()}"></label>
        ${fields.map(([k, label, note]) => `<label class="fld">${esc(label)}${note ? `<small>${esc(note)}</small>` : ''}<input class="input" id="r_${k}" inputmode="decimal" dir="ltr" value="${cur[k] ?? ''}" placeholder="0"></label>`).join('')}
        ${extras}
      </div>`, async () => {
      const from = U.val('rFrom');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) { TP.toast('اختار تاريخ البداية'); return false; }
      const entry = { from, setAt: Date.now(), setBy: S.person.name };
      for (const [k, label] of fields) {
        const v = U.money('r_' + k);
        if (Number.isNaN(v)) { TP.toast(`"${label}" لازم يكون رقم`); return false; }
        if (v !== null) entry[k] = v;
      }
      if (extraFields && extraFields.read) { const r = extraFields.read(entry); if (r === false) return false; }
      if (Object.keys(entry).length <= 3) { TP.toast('اكتب سعر واحد على الأقل'); return false; }
      if (TP.needsPin(S.perms) && !(await S.confirmPin('تأكيد تعديل الأسعار'))) return false;
      const history = TP.addRate((doc && doc.history) || [], entry);
      await TP.fb.set(col + '/' + id, { history, updatedAt: TP.fb.ts(), updatedBy: S.person.name });
      TP.audit('price.' + col, title, 'من ' + from + ': ' + fields.filter(f => entry[f[0]] != null).map(f => f[1] + ' ' + entry[f[0]]).join(' · '));
      TP.toast('تم حفظ السعر ✓');
    }, { saveLabel: 'حفظ السعر' });
  }

  /* line-specific prices inside a factory entry */
  function lineOverrideFields(factoryId) {
    const lines = D.lines.filter(l => l.factoryId === factoryId);
    const fn = cur => !lines.length ? '' : `<div class="full"><h4 style="margin:8px 0;color:var(--maroon-2)">سعر خاص لخط معين (اختياري)</h4>
      <div class="form-grid">${lines.map(l => `<label class="fld">${esc(l.name)}<input class="input" data-ov="${l.id}" inputmode="decimal" dir="ltr" placeholder="نفس سعر المصنع" value="${(cur.lineOverrides || {})[l.id] ?? ''}"></label>`).join('')}</div></div>`;
    fn.read = entry => {
      const ov = {};
      for (const el of TP.$$('[data-ov]')) {
        const raw = el.value.trim();
        if (!raw) continue;
        const n = TP.num(raw);
        if (!(n >= 0)) { TP.toast('سعر الخط لازم يكون رقم'); return false; }
        ov[el.dataset.ov] = TP.round2(n);
      }
      if (Object.keys(ov).length) entry.lineOverrides = ov;
    };
    return fn;
  }

  TP.views.prices = {
    deps: ['factoryRates', 'driverRates', 'airportRates', 'companies', 'people', 'lines'],
    render(root) {
      const view = S.can('prices.view'), editP = S.can('prices.edit'), air = S.can('airport.prices');
      if (!view && state.tab !== 'airport') state.tab = 'airport';
      watchExternal();
      const tabs = [view && ['factory', 'أسعار المصانع'], view && ['driver', 'أجور السواقين'], (view || air) && ['airport', 'المطار']].filter(Boolean);
      let body = '';
      if (state.tab === 'factory') {
        body = D.companies.length ? D.companies.map(f => card(f.name, 'اللي المصنع بيدفعه — بيظهر لـ HR المصنع ده بس', D.factoryRates[f.id], FACTORY_FIELDS,
          editP ? `data-edit="factoryRates|${f.id}"` : '',
          cur => cur && cur.lineOverrides && Object.keys(cur.lineOverrides).length ? `<div class="rate-val" style="grid-column:1/-1"><span>أسعار خاصة لخطوط</span>${Object.entries(cur.lineOverrides).map(([lid, v]) => `<span class="tag">${esc((TP.q.line(lid) || {}).name || 'خط محذوف')}: ${esc(TP.money(v))}</span>`).join('')}</div>` : '')).join('')
          : U.empty('ضيف المصانع الأول');
      } else if (state.tab === 'driver') {
        const drivers = TP.q.drivers().filter(p => p.active !== false);
        body = drivers.length ? TP.DRIVER_KINDS.map(k => {
          const list = drivers.filter(p => p.driverKind === k.id);
          if (!list.length) return '';
          return `<h4 style="margin:18px 0 10px;color:var(--maroon-2)">${esc(k.name)} <span class="muted small">— ${esc(k.note)}</span></h4>` +
            list.map(p => card(p.name, k.id === 'tourism' ? 'مش بيشوف أي سعر في التطبيق' : 'بيشوف أجره هو بس', D.driverRates[p.id], DRIVER_FIELDS, editP ? `data-edit="driverRates|${p.id}"` : '')).join('');
        }).join('') : U.empty('ضيف السواقين الأول');
      } else {
        const airEdit = editP || air;
        body = `<h4 style="margin:4px 0 10px;color:var(--maroon-2)">مشوار المطار — سعر المصنع</h4>` +
          (D.companies.length ? D.companies.map(f => card(f.name, 'بيضاف عليه رسوم الكارتة (على المصنع بس)', D.airportRates[f.id], AIRPORT_FIELDS, airEdit ? `data-edit="airportRates|${f.id}"` : '')).join('') : U.empty('ضيف المصانع الأول')) +
          `<h4 style="margin:22px 0 10px;color:var(--maroon-2)">السواقين الخارجيين</h4>` +
          (TP.q.drivers('external').length ? TP.q.drivers('external').map(p => card(p.name, 'يشوف سعره بس', driverRatesDoc(p.id), view ? DRIVER_FIELDS : EXTERNAL_FIELDS, airEdit ? `data-edit="driverRates|${p.id}|ext"` : '')).join('') : U.empty('مفيش سواقين خارجيين متسجلين'));
      }
      root.innerHTML = `
        <div class="banner info">${TP.icon('shield')}<span class="grow">سعر المصنع وأجر السواق محفوظين في مكانين منفصلين. المصنع ميقدرش يوصل لأجر السواق، والسواق ميقدرش يوصل لسعر المصنع، حتى لو حاول من برّه التطبيق.</span></div>
        <div class="chips" style="margin-bottom:14px">${tabs.map(([k, l]) => `<button class="chip ${state.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
        <section class="card">${body}</section>`;
      root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; TP.rerender(); });
      root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
        const [col, id, ext] = b.dataset.edit.split('|');
        if (col === 'factoryRates') return edit(col, id, TP.q.company(id).name, FACTORY_FIELDS, lineOverrideFields(id));
        if (col === 'airportRates') return edit(col, id, 'المطار — ' + TP.q.company(id).name, AIRPORT_FIELDS);
        return edit(col, id, TP.q.person(id).name, ext && !view ? EXTERNAL_FIELDS : DRIVER_FIELDS);
      });
    }
  };
})(window.TP = window.TP || {});
