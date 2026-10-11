/* ==========================================================================
   Control Tower — shell & router
   ========================================================================== */
(function (TP) {
  'use strict';
  const { $, esc } = TP;
  const S = TP.session;

  /* perm: one key, or any of a list. Items marked phase are shown as "coming". */
  const NAV = [
    { id: 'overview', label: 'لوحة التحكم', icon: 'home', eyebrow: 'OPERATIONS CONTROL' },
    { id: 'today', label: 'يوم الخطوط', icon: 'route', any: ['tracking.view', 'times.correct', 'overtime.approve', 'wake.supervise'], eyebrow: 'LIVE DAY BOARD', badge: () => S.can('overtime.approve') ? TP.D.pendingOT.length : 0 },
    { id: 'missions', label: 'المشاوير والمطار', icon: 'plane', any: ['missions.manage', 'tracking.view', 'prices.view', 'times.correct', 'airport.manage'], eyebrow: 'MISSIONS & AIRPORT' },
    { id: 'requests', label: 'طلبات المصانع والمصاريف', icon: 'file', any: ['missions.manage', 'lines.manage', 'airport.manage', 'advances.manage'], eyebrow: 'REQUESTS & EXPENSES', badge: () => TP.D.factoryRequests.length + TP.D.expensesPending.length },
    { id: 'wake', label: 'الصحيان', icon: 'alarm', any: ['wake.supervise', 'tracking.view', 'times.correct'], eyebrow: 'WAKE-UP', badge: () => TP.q.wakeNeedsAction().length },
    { id: 'incidents', label: 'البلاغات', icon: 'bell', any: ['tracking.view'], eyebrow: 'SOS & INCIDENTS', badge: () => TP.D.incidents.length },
    { sep: true },
    { id: 'devices', label: 'الأجهزة والدخول', icon: 'device', any: ['devices.manage', 'tracking.view'], eyebrow: 'ACCESS & DEVICES', badge: () => TP.D.requests.filter(r => r.status === 'matched').length },
    { id: 'staff', label: 'الموظفين والصلاحيات', icon: 'shield', any: ['staff.manage'], eyebrow: 'PEOPLE & PERMISSIONS' },
    { sep: true },
    { id: 'factories', label: 'المصانع', icon: 'factory', any: ['factories.manage'], eyebrow: 'CLIENTS' },
    { id: 'lines', label: 'الخطوط', icon: 'route', any: ['lines.manage'], eyebrow: 'FIXED LINES' },
    { id: 'drivers', label: 'السواقين', icon: 'steering', any: ['drivers.manage'], eyebrow: 'DRIVERS' },
    { id: 'vehicles', label: 'العربيات', icon: 'car', any: ['vehicles.manage'], eyebrow: 'FLEET' },
    { id: 'fleet', label: 'أمر الشغل والعهدة', icon: 'steering', any: ['fleet.manage', 'salary.manage'], eyebrow: 'TRIP ORDERS · CUSTODY · FUEL', badge: () => S.can('fleet.manage') ? TP.D.fleet.filter(c => c.req).length : 0 },
    { id: 'prices', label: 'الأسعار', icon: 'money', any: ['prices.view', 'airport.prices'], eyebrow: 'PRICING', finance: true },
    { id: 'advances', label: 'السلف والخصومات', icon: 'money', any: ['advances.manage'], eyebrow: 'ADVANCES & DEDUCTIONS', finance: true },
    { sep: true },
    { id: 'reports', label: 'التقارير والتصدير', icon: 'chart', any: ['reports.attendance', 'reports.finance', 'month.close'], eyebrow: 'REPORTS & EXPORT' },
    { sep: true },
    { id: 'settings', label: 'الإعدادات', icon: 'settings', any: ['settings.edit'], eyebrow: 'SETTINGS' },
    { id: 'audit', label: 'سجل العمليات', icon: 'history', any: ['audit.view'], eyebrow: 'AUDIT TRAIL' },
    { id: 'account', label: 'حسابي', icon: 'user', eyebrow: 'MY ACCOUNT' }
  ];
  // prices & statements show only while the accounts are on (settings) — the data stays protected either way
  const allowed = n => (!n.any || n.any.some(p => S.can(p))) && (!n.finance || TP.financeOn(TP.D.settings));

  TP.views = TP.views || {};
  let current = null;

  function renderNav() {
    $('#nav').innerHTML = NAV.map(n => {
      if (n.sep) return '<div class="ct-nav-sep"></div>';
      if (n.soon) return `<a class="soon" aria-disabled="true">${TP.icon(n.icon)}<span>${esc(n.label)}</span><span class="soon-tag">${esc(n.soon)}</span></a>`;
      if (!allowed(n)) return '';
      const b = n.badge ? n.badge() : 0;
      return `<a href="#/${n.id}" data-nav="${n.id}" class="${current === n.id ? 'active' : ''}">${TP.icon(n.icon)}<span>${esc(n.label)}</span>${b ? `<b class="badge">${b}</b>` : ''}</a>`;
    }).join('');
    const p = S.person || {};
    const role = (TP.ROLES.find(r => r.id === p.role) || {}).name || (S.can('all') ? 'المدير العام' : 'موظف');
    $('#me').innerHTML = `<span class="av">${esc((p.name || '?').trim()[0] || '?')}</span><div><b>${esc(p.name || '')}</b><small>${esc(role)}</small></div>`;
  }

  function go() {
    const want = (location.hash.match(/^#\/([\w-]+)/) || [])[1] || 'overview';
    const nav = NAV.find(n => n.id === want && !n.soon);
    const id = nav && allowed(nav) && TP.views[want] ? want : 'overview';
    if (id !== want) history.replaceState(null, '', '#/' + id);
    if (current && current !== id && TP.views[current] && TP.views[current].leave) { try { TP.views[current].leave(); } catch (e) { console.warn(e); } }
    current = id;
    const meta = NAV.find(n => n.id === id);
    $('#vTitle').textContent = meta.label;
    $('#vEyebrow').textContent = meta.eyebrow || '';
    document.title = meta.label + ' — Three Pyramids Control Tower';
    renderNav();
    renderAlerts();
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- alerts on every page: open SOS / incidents and overtime waiting for approval ---------- */
  const seenIncidents = new Set(), seenWake = new Set();
  let audio = null;
  function ring(urgent) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const n = urgent ? 8 : 3;
      for (let i = 0; i < n; i++) {
        const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.28;
        o.type = 'square'; o.frequency.value = i % 2 ? 880 : 660; g.gain.value = 0.07;
        o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.2);
      }
    } catch (e) { /* no sound available */ }
  }
  function renderAlerts() {
    const el = $('#alerts'); if (!el) return;
    const D = TP.D; let h = '';
    if (S.can('tracking.view') && D.incidents.length) {
      const i = D.incidents[0];
      h += `<a class="banner danger alert-link" href="#/incidents">${TP.icon('bell')}<span class="grow">${D.incidents.length > 1 ? D.incidents.length + ' بلاغات مفتوحة — ' : ''}${esc(TP.ops.incidentName(i.kind))}: ${esc(i.driverName || '')} (${esc(TP.ago(i.at))})</span><b>افتح</b></a>`;
      let fresh = false, urgent = false;
      D.incidents.forEach(x => { if (!seenIncidents.has(x.id)) { seenIncidents.add(x.id); fresh = true; if (x.kind === 'sos') urgent = true; } });
      if (fresh) ring(urgent);
    }
    if (S.can('wake.supervise') || S.can('times.correct')) {
      const need = TP.q.wakeNeedsAction();
      if (need.length) {
        const r = need[0];
        h += `<a class="banner danger alert-link" href="#/wake">${TP.icon('alarm')}<span class="grow">${need.length > 1 ? need.length + ' سواقين مصحيوش — ' : 'مصحيش: '}${esc(TP.driverLabel({ code: r.e.code, name: r.e.name }))} (${esc(r.e.job.label)})</span><b>الصحيان</b></a>`;
        const fresh = need.filter(x => !seenWake.has(x.day + x.pid));
        fresh.forEach(x => seenWake.add(x.day + x.pid));
        if (fresh.length) ring(true);
      }
    }
    if (S.can('overtime.approve') && D.pendingOT.length) h += `<a class="banner warn alert-link" href="#/today">${TP.icon('clock')}<span class="grow">${D.pendingOT.length} طلب سهرة مستني موافقتك</span><b>راجع</b></a>`;
    if (D.factoryRequests.length) h += `<a class="banner warn alert-link" href="#/requests">${TP.icon('file')}<span class="grow">${D.factoryRequests.length} طلب من المصانع مستني</span><b>راجع</b></a>`;
    const asks = S.can('fleet.manage') ? D.fleet.filter(c => c.req) : [];
    if (asks.length) h += `<a class="banner warn alert-link" href="#/fleet">${TP.icon('money')}<span class="grow">${asks.length > 1 ? asks.length + ' سواقين طالبين عهدة مصروفات' : 'سواق طالب عهدة مصروفات — رصيده ' + esc(TP.money(asks[0].req.bal))}</span><b>سلّم</b></a>`;
    el.innerHTML = h;
  }

  function render() {
    const v = TP.views[current];
    if (!v) return;
    const root = $('#view');
    try { v.render(root); } catch (e) { console.error(e); root.innerHTML = '<div class="empty">حصلت مشكلة في عرض الصفحة.</div>'; }
    TP.hydrateIcons(root);
  }

  let pending = null;
  function scheduleRender(key) {
    const v = TP.views[current];
    if (!v) return;
    if (v.deps && key && !v.deps.includes(key)) { renderNav(); return; }
    clearTimeout(pending);
    pending = setTimeout(() => {
      // keep what the user is typing in a search box
      const active = document.activeElement, id = active && active.id, val = active && active.value, pos = active && active.selectionStart;
      renderNav(); render();
      if (id) { const el = document.getElementById(id); if (el && el !== active) { el.focus(); if (val !== undefined && el.value !== undefined) { el.value = val; try { el.setSelectionRange(pos, pos); } catch (e) { /* not a text input */ } } } }
    }, 60);
  }
  TP.rerender = () => scheduleRender();

  let cardTimer = null;
  document.addEventListener('tp:data', e => {
    if (['incidents', 'pendingOT', 'wake', 'wakeAcks', 'factoryRequests', 'expensesPending', 'fleet'].includes(e.detail)) { renderAlerts(); renderNav(); }
    if (e.detail === 'settings' && current && NAV.find(n => n.id === current && n.finance) && !TP.financeOn(TP.D.settings)) { go(); return; }
    // driver cards (what customers see) follow names, codes and cars
    if (['people', 'cards', 'vehicles', 'lines'].includes(e.detail) && TP.actions.syncCards) { clearTimeout(cardTimer); cardTimer = setTimeout(() => TP.actions.syncCards(), 1200); }
    scheduleRender(e.detail);
  });
  document.addEventListener('tp:push', e => {   // a push while the Control Tower is open
    const n = (e.detail && e.detail.notification) || {};
    if (n.title) TP.toast(n.title, 'warn');
    ring(true);
  });
  setInterval(() => { if (S.ready && TP.D.todayKey && TP.dayKey() !== TP.D.todayKey) TP.data.start(); }, 60000);   // a new day
  window.addEventListener('hashchange', go);
  window.addEventListener('online', () => $('#live').classList.remove('off'));
  window.addEventListener('offline', () => $('#live').classList.add('off'));
  setInterval(() => { if (current === 'devices' || current === 'overview' || current === 'today' || current === 'wake') scheduleRender(); if (S.ready) { renderAlerts(); renderNav(); } }, 30000); // refresh "online now" & countdowns

  let permsKey = null;
  document.addEventListener('tp:session', () => {
    const k = JSON.stringify(S.perms);
    if (k !== permsKey) { permsKey = k; TP.data.start(); }   // re-subscribe only when access changed
    $('#ct').hidden = false; go();
  });
  document.addEventListener('tp:session-end', () => { permsKey = null; TP.data.stop(); $('#ct').hidden = true; });

  S.start({ kind: 'staff', base: '../shared/', onReady() { /* tp:session handles everything */ } });
})(window.TP = window.TP || {});
