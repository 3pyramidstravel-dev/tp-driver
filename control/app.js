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
    { id: 'devices', label: 'الأجهزة والدخول', icon: 'device', any: ['devices.manage', 'tracking.view'], eyebrow: 'ACCESS & DEVICES', badge: () => TP.D.requests.filter(r => r.status === 'matched').length },
    { id: 'staff', label: 'الموظفين والصلاحيات', icon: 'shield', any: ['staff.manage'], eyebrow: 'PEOPLE & PERMISSIONS' },
    { sep: true },
    { id: 'factories', label: 'المصانع', icon: 'factory', any: ['factories.manage'], eyebrow: 'CLIENTS' },
    { id: 'lines', label: 'الخطوط', icon: 'route', any: ['lines.manage'], eyebrow: 'FIXED LINES' },
    { id: 'drivers', label: 'السواقين', icon: 'steering', any: ['drivers.manage'], eyebrow: 'DRIVERS' },
    { id: 'vehicles', label: 'العربيات', icon: 'car', any: ['vehicles.manage'], eyebrow: 'FLEET' },
    { id: 'prices', label: 'الأسعار', icon: 'money', any: ['prices.view', 'airport.prices'], eyebrow: 'PRICING' },
    { sep: true },
    { label: 'المهام والمشاوير', icon: 'file', soon: 'المرحلة 2' },
    { label: 'الصحيان', icon: 'alarm', soon: 'المرحلة 3' },
    { label: 'المطار والرحلات', icon: 'plane', soon: 'المرحلة 4' },
    { label: 'التقارير والأرباح', icon: 'chart', soon: 'المرحلة 5' },
    { sep: true },
    { id: 'settings', label: 'الإعدادات', icon: 'settings', any: ['settings.edit'], eyebrow: 'SETTINGS' },
    { id: 'audit', label: 'سجل العمليات', icon: 'history', any: ['audit.view'], eyebrow: 'AUDIT TRAIL' },
    { id: 'account', label: 'حسابي', icon: 'user', eyebrow: 'MY ACCOUNT' }
  ];
  const allowed = n => !n.any || n.any.some(p => S.can(p));

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
    current = id;
    const meta = NAV.find(n => n.id === id);
    $('#vTitle').textContent = meta.label;
    $('#vEyebrow').textContent = meta.eyebrow || '';
    document.title = meta.label + ' — Three Pyramids Control Tower';
    renderNav();
    render();
    window.scrollTo(0, 0);
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

  document.addEventListener('tp:data', e => scheduleRender(e.detail));
  window.addEventListener('hashchange', go);
  window.addEventListener('online', () => $('#live').classList.remove('off'));
  window.addEventListener('offline', () => $('#live').classList.add('off'));
  setInterval(() => { if (current === 'devices' || current === 'overview') scheduleRender(); }, 30000); // refresh "online now" & countdowns

  let permsKey = null;
  document.addEventListener('tp:session', () => {
    const k = JSON.stringify(S.perms);
    if (k !== permsKey) { permsKey = k; TP.data.start(); }   // re-subscribe only when access changed
    $('#ct').hidden = false; go();
  });
  document.addEventListener('tp:session-end', () => { permsKey = null; TP.data.stop(); $('#ct').hidden = true; });

  S.start({ kind: 'staff', base: '../shared/', onReady() { /* tp:session handles everything */ } });
})(window.TP = window.TP || {});
