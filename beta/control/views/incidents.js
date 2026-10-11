/* ==========================================================================
   البلاغات — SOS, breakdowns and accidents sent from the driver app.
   Open ones ring in every Control Tower that can follow the drivers.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui, O = TP.ops;
  let hist = { on: false, unsub: null, list: [] };

  function handle(id) {
    const i = D.incidents.find(x => x.id === id); if (!i) return;
    TP.openModal('تم التعامل مع البلاغ', `<p class="modal-text">${esc(O.incidentName(i.kind))} — ${esc(i.driverName || '')}</p>
      <label class="fld" style="margin-top:10px">اللي اتعمل<textarea class="input" id="hNote" rows="3" maxlength="400" placeholder="مثال: كلمته وبعتنا ونش"></textarea></label>`, async () => {
      const note = U.val('hNote');
      if (!note) { TP.toast('اكتب اللي اتعمل'); return false; }
      await TP.fb.update('incidents/' + id, { status: 'handled', handledBy: S.person.name, handledAt: TP.fb.ts(), handlerNote: note });
      TP.audit('incident.handled', i.driverName, `${O.incidentName(i.kind)} — ${note}`);
      TP.toast('تم ✓');
    }, { saveLabel: 'تم' });
  }
  const card = (i, open) => {
    const line = TP.q.line(i.lineId), loc = isFinite(i.lat) ? { lat: i.lat, lng: i.lng } : null;
    return `<div class="request-card ${open && i.kind === 'sos' ? 'sos' : ''}" style="${open ? '' : 'border-color:var(--line);box-shadow:none'}">
      <span class="st ${open ? (i.kind === 'sos' ? 'st-danger' : 'st-warn') : 'st-ok'}">${esc(O.incidentName(i.kind))}</span>
      <div class="grow"><b>${esc(i.driverName || '—')}</b>${line ? ` <span class="muted small">— ${esc(line.name)}</span>` : ''}
        <div class="small muted">${esc(TP.fmtDateTime(i.at))} · ${esc(TP.ago(i.at))}</div>
        ${i.note ? `<div class="small" style="margin-top:4px">${esc(i.note)}</div>` : ''}
        ${!open && i.handlerNote ? `<div class="small" style="margin-top:4px;color:var(--ok)">${esc(i.handledBy || '')}: ${esc(i.handlerNote)}</div>` : ''}</div>
      ${i.phone ? `<a class="btn btn-ghost btn-sm" href="tel:${esc(i.phone)}">${TP.icon('phone', 16)}${esc(i.phone)}</a>` : ''}
      ${loc ? U.mapLink(loc, 'مكانه') : '<span class="muted small">بدون موقع</span>'}
      ${open ? `<button class="btn btn-primary btn-sm" data-handle="${esc(i.id)}">${TP.icon('check', 16)}اتعاملت معاه</button>` : ''}</div>`;
  };

  TP.views.incidents = {
    deps: null,
    leave() { if (hist.unsub) hist.unsub(); hist = { on: false, unsub: null, list: [] }; },
    render(root) {
      root.innerHTML = `<section class="card"><div class="card-head"><h3>بلاغات مفتوحة</h3><span class="st ${D.incidents.length ? 'st-danger' : 'st-ok'}">${D.incidents.length}</span></div>
          ${D.incidents.length ? D.incidents.map(i => card(i, true)).join('') : U.empty('مفيش بلاغات مفتوحة')}</section>
        <section class="card"><div class="card-head"><h3>آخر البلاغات</h3>${hist.on ? '' : '<button class="btn btn-ghost btn-sm" id="hLoad">اعرض</button>'}</div>
          ${hist.on ? (hist.list.filter(i => i.status !== 'open').map(i => card(i, false)).join('') || U.empty('مفيش')) : '<p class="muted small">البلاغات اللي اتقفلت.</p>'}</section>`;
      root.querySelectorAll('[data-handle]').forEach(b => b.onclick = () => handle(b.dataset.handle));
      const hl = root.querySelector('#hLoad');
      if (hl) hl.onclick = () => {
        hist.on = true;
        hist.unsub = TP.data.watch('incidents', { orderBy: ['at', 'desc'], limit: 40 }, l => { hist.list = l; TP.rerender(); });
        TP.rerender();
      };
    }
  };
})(window.TP = window.TP || {});
