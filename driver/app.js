/* Driver app — Phase 1 shell: activation + who am I + my line.
   The full mission flow (Design A) arrives in Phase 2. */
(function (TP) {
  'use strict';
  const { esc } = TP, S = TP.session;
  let unsub = null;
  document.addEventListener('tp:session', () => {
    TP.$('#app').hidden = false;
    const p = S.person;
    TP.$('#hello').innerHTML = `<span class="caps">DRIVER</span><h1>أهلاً ${esc(p.name)}</h1><p class="muted">${esc(TP.driverKindName(p.driverKind))} — جهازك متفعّل وهيفضل داخل لحد ما الإدارة تشيله.</p>`;
    if (unsub) unsub();
    unsub = TP.fb.onCol('lines', { where: [['driverId', '==', p.id]] }, lines => {
      TP.$('#info').innerHTML = lines.length ? lines.map(l => `<h3 style="color:var(--maroon-2);font-weight:900">${esc(l.name)}</h3>
        <p class="muted small">الصبح ${esc(l.morningTime || '—')} · الرجوع ${esc(l.eveningTime || '—')}</p>
        ${(l.points || []).map((pt, i) => `<div style="padding:10px 0;border-top:1px solid var(--line)"><b>${i + 1}. ${esc(pt.name)}</b>
          <div class="small muted">${(pt.guests || []).map(esc).join(' · ')}</div>
          ${TP.mapsUrl(pt.location) ? `<a class="link" href="${esc(TP.mapsUrl(pt.location))}" target="_blank" rel="noopener">افتح في الخرائط</a>` : ''}</div>`).join('')}`).join('<hr>')
        : '<p class="muted">لسه مفيش خط متسجل باسمك.</p>';
      TP.$('#info').insertAdjacentHTML('beforeend', '<p class="muted small" style="margin-top:12px">خطوات المهمة والمنبّه والـ GPS جايين في المرحلة الجاية.</p>');
    }, () => { TP.$('#info').innerHTML = '<p class="muted">تعذر تحميل الخط.</p>'; });
  });
  document.addEventListener('tp:session-end', () => { TP.$('#app').hidden = true; if (unsub) { unsub(); unsub = null; } });
  S.start({ kind: 'driver', base: '../shared/' });
})(window.TP = window.TP || {});
