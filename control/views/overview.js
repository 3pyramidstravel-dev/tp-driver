/* ==========================================================================
   Overview — what needs attention right now
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui;

  function kpi(cls, icon, label, value, href) {
    return `<${href ? `a href="${href}" style="text-decoration:none;color:inherit"` : 'div'} class="kpi ${cls}"><span class="kpi-ic">${TP.icon(icon, 22)}</span><div><span>${esc(label)}</span><strong>${value}</strong></div></${href ? 'a' : 'div'}>`;
  }

  TP.views.overview = {
    deps: null,
    render(root) {
      const p = S.person || {};
      const online = D.devices.filter(TP.q.online);
      const waiting = D.requests.filter(r => r.status === 'matched');
      const drivers = TP.q.drivers().filter(d => d.active !== false);
      const notActivated = drivers.filter(d => !TP.q.devicesOf(d.id).length);
      const warn = D.settings.expiryWarnDays || 30;
      const exp = [];
      D.vehicles.filter(v => v.active !== false).forEach(v => {
        [['licenseExpiry', 'رخصة العربية'], ['insuranceExpiry', 'تأمين العربية']].forEach(([k, l]) => { if (v[k] && TP.daysUntil(v[k]) <= warn) exp.push({ what: `${l} ${v.plate}`, day: v[k] }); });
      });
      drivers.forEach(d => { if (d.licenseExpiry && TP.daysUntil(d.licenseExpiry) <= warn) exp.push({ what: `رخصة ${d.name}`, day: d.licenseExpiry }); });
      exp.sort((a, b) => (a.day < b.day ? -1 : 1));
      const setupSteps = [
        [D.companies.length > 0, 'ضيف المصانع', '#/factories', 'factories.manage'],
        [drivers.length > 0, 'ضيف السواقين', '#/drivers', 'drivers.manage'],
        [D.vehicles.length > 0, 'ضيف العربيات', '#/vehicles', 'vehicles.manage'],
        [D.lines.length > 0, 'ضيف الخطوط بنقطها وعملائها', '#/lines', 'lines.manage'],
        ...(TP.financeOn(D.settings) ? [[Object.keys(D.factoryRates).length > 0, 'حط أسعار المصانع والسواقين', '#/prices', 'prices.edit']] : []),
        [TP.q.staff().length > 1, 'ضيف فريق الإدارة وHR المصانع', '#/staff', 'staff.manage']
      ].filter(s => S.can(s[3]));
      const pendingSetup = setupSteps.filter(s => !s[0]);

      root.innerHTML = `
        ${TP.needsPin(S.perms) && p.pinIsDefault ? `<div class="banner warn">${TP.icon('lock')}<span class="grow">رقمك السري لسه 1234 — غيّره من صفحة حسابي.</span><a class="btn btn-ghost btn-sm" href="#/account">غيّره دلوقتي</a></div>` : ''}
        ${waiting.length && S.can('devices.manage') ? `<div class="banner danger">${TP.icon('device')}<span class="grow">${waiting.length} جهاز مستني موافقتك عشان يدخل.</span><a class="btn btn-primary btn-sm" href="#/devices">راجع الطلبات</a></div>` : ''}
        <div class="kpis">
          ${TP.staffSeesDays(S.perms) ? kpi('', 'route', 'خطوط اشتغلت النهارده', D.todayDays.filter(d => d.events && Object.keys(d.events).length).length + ' / ' + D.lines.filter(l => l.active !== false).length, '#/today') : ''}
          ${kpi('ok', 'wifi', 'متصلين الآن', online.length, (S.can('devices.manage') || S.can('tracking.view')) ? '#/devices' : '')}
          ${kpi('', 'steering', 'السواقين', drivers.length, S.can('drivers.manage') ? '#/drivers' : '')}
          ${kpi('', 'factory', 'المصانع', D.companies.length, S.can('factories.manage') ? '#/factories' : '')}
          ${kpi(exp.length ? 'warn' : '', 'calendar', 'رخص قربت تخلص', exp.length, S.can('vehicles.manage') ? '#/vehicles' : '')}
        </div>
        <div class="split">
          ${pendingSetup.length ? `<section class="card"><div class="card-head"><h3>خطوات تجهيز النظام</h3><span class="muted small">${setupSteps.length - pendingSetup.length} من ${setupSteps.length}</span></div>
            ${setupSteps.map(([done, label, href]) => `<a href="${href}" class="check ${done ? 'on' : ''}" style="text-decoration:none;color:inherit;margin-bottom:8px">${TP.icon(done ? 'check' : 'plus', 18)}<span>${esc(label)}</span></a>`).join('')}</section>` : ''}
          ${(S.can('devices.manage') || S.can('tracking.view')) ? `<section class="card"><div class="card-head"><h3>مين جوّه دلوقتي</h3><span class="st st-ok">${online.length}</span></div>
            ${online.length ? online.slice(0, 12).map(d => `<div style="padding:8px 0;border-top:1px solid var(--line)">${U.who(d.name, d.kind === 'driver' ? 'سواق' : d.kind === 'hr' ? 'مصنع' : 'إدارة')}</div>`).join('') : U.empty('محدش فاتح دلوقتي')}
            ${notActivated.length && S.can('devices.manage') ? `<p class="muted small" style="margin-top:10px">${notActivated.length} سواق لسه مفعّلوش التطبيق على موبايلاتهم.</p>` : ''}</section>` : ''}
          <section class="card"><div class="card-head"><h3>رخص وتأمينات</h3><span class="muted small">خلال ${warn} يوم</span></div>
            ${exp.length ? `<div class="table-wrap"><table class="tbl"><tbody>${exp.slice(0, 12).map(e => `<tr><td>${esc(e.what)}</td><td>${U.expiry(e.day)}</td></tr>`).join('')}</tbody></table></div>` : U.empty('كله سليم')}</section>
          ${(() => {
            const links = [['#/requests', 'طلبات المصانع والمصاريف', D.factoryRequests.length + D.expensesPending.length, ['missions.manage', 'lines.manage', 'airport.manage', 'advances.manage']],
              ['#/missions', 'المشاوير والمطار', 0, ['missions.manage', 'tracking.view', 'times.correct', 'airport.manage']], ['#/reports', 'التقارير والتصدير', 0, ['reports.attendance', 'reports.finance', 'month.close']]]
              .filter(l => l[3].some(p => S.can(p)));
            return links.length ? `<section class="card"><div class="card-head"><h3>اختصارات</h3></div>${links.map(([h, l, n]) => `<a href="${h}" style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line);text-decoration:none;color:inherit;font-weight:800"><span>${esc(l)}</span>${n ? `<b class="badge">${n}</b>` : ''}</a>`).join('')}</section>` : '';
          })()}
        </div>`;
    }
  };
})(window.TP = window.TP || {});
