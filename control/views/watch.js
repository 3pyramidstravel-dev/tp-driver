/* ==========================================================================
   المحاضر — the smart monitoring's cases (agreed 9 Nov).
   The cloud alarm opens a case when a car moves outside its driver's work
   order; the driver presses "بلّغت" or not; here the managers see each case
   on the map and decide: مقبول / إنذار / خصم.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const st = { list: null, unsub: null, driver: '', show: 'all' };
  const STATE = {
    asked: ['مستني رد السواق', 'st-warn'], acked: ['بلّغ — بيتبعت للإدارة', 'st-info'],
    reported: ['بلّغ الشركة', 'st-info'], noreply: ['مبلّغش', 'st-danger']
  };
  const DEC = { ok: ['مقبول', 'st-ok'], warn: ['إنذار', 'st-warn'], deduct: ['خصم', 'st-danger'] };

  function sub() {
    if (st.unsub) return;
    const from = TP.ops.addDays(TP.dayKey(), -60);
    st.unsub = TP.fb.onCol('watch', { where: [['day', '>=', from]] }, l => { st.list = l.sort((a, b) => (b.at || 0) - (a.at || 0)); TP.rerender && TP.rerender(); },
      e => { console.warn('watch', e && e.code); st.list = []; TP.rerender && TP.rerender(); });
  }

  async function decide(w, d) {
    const note = d === 'ok' ? '' : (prompt(d === 'deduct' ? 'قيمة الخصم والسبب (اختياري):' : 'ملاحظة على الإنذار (اختياري):') || '');
    if (note === null) return;
    try {
      await TP.fb.update('watch/' + w.id, { decision: d, decisionNote: String(note).slice(0, 300), decidedBy: (TP.session.person || {}).name || '', decidedAt: TP.now() });
      TP.audit('watch.decide', (w.code ? w.code + ' ' : '') + (w.driverName || ''), DEC[d][0] + (note ? ' — ' + note : ''));
      TP.toast('اتسجل القرار ✓');
    } catch (e) { console.error(e); TP.toast('مقدرتش أحفظ — جرّب تاني', 'warn'); }
  }

  function render(root) {
    sub();
    if (!st.list) { root.innerHTML = '<section class="card"><p class="muted">بيحمّل…</p></section>'; return; }
    const on = !!(TP.appTexts && TP.appTexts.watch && TP.appTexts.watch.on);
    const drivers = Array.from(new Map(st.list.map(w => [w.driverId, w])).values());
    let rows = st.list.filter(w => !st.driver || w.driverId === st.driver);
    if (st.show === 'open') rows = rows.filter(w => !w.decision);
    if (st.show === 'noreply') rows = rows.filter(w => w.state === 'noreply');
    const n = { all: st.list.length, open: st.list.filter(w => !w.decision).length, noreply: st.list.filter(w => w.state === 'noreply').length };
    root.innerHTML = `<section class="card">
      ${on ? '' : '<div class="banner warn" style="margin-bottom:12px">المراقبة الذكية مقفولة دلوقتي — بتتشغل من "تعديل التطبيق".</div>'}
      <div class="toolbar" style="gap:8px;flex-wrap:wrap">
        <select class="input" id="wDrv" style="max-width:260px"><option value="">كل السواقين</option>${drivers.map(w => `<option value="${esc(w.driverId)}" ${st.driver === w.driverId ? 'selected' : ''}>${esc((w.code ? w.code + ' · ' : '') + (w.driverName || ''))}</option>`).join('')}</select>
        <div class="chips">${[['all', 'الكل'], ['open', 'من غير قرار'], ['noreply', 'مبلّغش']].map(([k, l]) => `<button type="button" class="chip ${st.show === k ? 'active' : ''}" data-wshow="${k}">${l} <small>${n[k]}</small></button>`).join('')}</div>
      </div>
      ${rows.length ? rows.map(w => {
        const s = STATE[w.state] || ['—', ''], d = DEC[w.decision];
        const map = isFinite(w.lat) ? `https://www.google.com/maps?q=${w.lat},${w.lng}` : '';
        return `<div class="gm"><div class="gm-h"><b>${esc((w.code ? w.code + ' · ' : '') + (w.driverName || 'سواق'))}</b><span class="st ${s[1]}">${s[0]}</span>${d ? `<span class="st ${d[1]}">${d[0]}</span>` : ''}</div>
          <p class="small" style="margin:6px 0">🚗 ${esc(w.car || '')} · ${esc(TP.fmtDateTime(w.at))}${w.speed ? ' · ' + esc(String(w.speed)) + ' كم/س' : ''}${w.ackAt ? ' · بلّغ ' + esc(TP.fmtDateTime(w.ackAt)) : ''}</p>
          ${w.decisionNote ? `<p class="small muted">${esc(w.decidedBy || '')}: ${esc(w.decisionNote)}</p>` : ''}
          <div class="btn-row" style="gap:8px;margin-top:6px">${map ? `<a class="btn btn-ghost btn-sm" href="${map}" target="_blank" rel="noopener">${TP.icon('pin', 16)} الخريطة</a>` : ''}
            ${w.state === 'asked' ? '' : Object.keys(DEC).map(k => `<button type="button" class="btn btn-sm ${w.decision === k ? 'btn-primary' : 'btn-ghost'}" data-wdec="${k}" data-wid="${esc(w.id)}">${DEC[k][0]}</button>`).join('')}</div></div>`;
      }).join('') : '<p class="muted">مفيش محاضر.</p>'}
    </section>`;
    const sel = root.querySelector('#wDrv'); if (sel) sel.onchange = () => { st.driver = sel.value; render(root); };
    TP.$$('[data-wshow]', root).forEach(b => b.onclick = () => { st.show = b.dataset.wshow; render(root); });
    TP.$$('[data-wdec]', root).forEach(b => b.onclick = () => { const w = st.list.find(x => x.id === b.dataset.wid); if (w) decide(w, b.dataset.wdec); });
    TP.hydrateIcons && TP.hydrateIcons(root);
  }

  TP.views = TP.views || {};
  TP.views.watch = { render };
})(window.TP = window.TP || {});
