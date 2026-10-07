/* Factory portal — Phase 1 shell: activation + which factory.
   Attendance, invoices and Excel reports arrive in Phase 5. */
(function (TP) {
  'use strict';
  const { esc } = TP, S = TP.session;
  document.addEventListener('tp:session', async () => {
    TP.$('#app').hidden = false;
    const p = S.person;
    const f = await TP.fb.get('companies/' + p.factoryId).catch(() => null);
    TP.$('#hello').innerHTML = `<span class="caps">CLIENT PORTAL</span><h1>أهلاً ${esc(p.name)}</h1><p class="muted">${esc(f ? f.name : '')} — جهازك متفعّل.</p>`;
    TP.$('#info').innerHTML = '<p class="muted">الحضور اليومي والفواتير والتقارير هتظهر هنا في المرحلة الخامسة.</p>';
  });
  document.addEventListener('tp:session-end', () => { TP.$('#app').hidden = true; });
  S.start({ kind: 'hr', base: '../shared/' });
})(window.TP = window.TP || {});
