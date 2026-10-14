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

  /* ---------- the database's use of today's free quota (design A: the big gauge) ---------- */
  function usageCard() {
    const u = D.usage;
    if (!S.can('all')) return '';
    if (!u || !u.at) return `<section class="us-card"><div class="us-hd"><h3><span class="us-ico">📊</span>استهلاك قاعدة البيانات — النهارده</h3></div><p class="us-wait">بيتحسب… أول قراءة بتوصل خلال ربع ساعة.</p></section>`;
    const L = u.lim || { reads: 50000, writes: 20000, deletes: 20000 };
    const fresh = TP.now() < (u.resetAt || 0);
    const rows = [['📖', 'القراءة', fresh ? u.reads || 0 : 0, L.reads], ['✏️', 'الكتابة', fresh ? u.writes || 0 : 0, L.writes], ['🗑️', 'المسح', fresh ? u.deletes || 0 : 0, L.deletes]];
    const pc = (a, b) => Math.min(100, Math.round(a / b * 100));
    const tot = Math.max(...rows.map(r => pc(r[2], r[3])));
    const f = n => Number(n || 0).toLocaleString('en-US');
    const col = x => x >= 80 ? 'linear-gradient(90deg,#e0675a,#c0392b)' : x >= 60 ? 'linear-gradient(90deg,#f3c561,#d39a24)' : 'linear-gradient(90deg,#4cc28d,#1f8a5b)';
    const st = tot >= 80 ? ['r', '🔴 خطر — فوق <bdi dir="ltr">80%</bdi>'] : tot >= 60 ? ['y', '🟡 انتبه — فوق <bdi dir="ltr">60%</bdi>'] : ['g', '🟢 تمام'];
    const R = 82, C = 2 * Math.PI * R;
    const left = Math.max(0, (u.resetAt || 0) - TP.now()), lh = Math.floor(left / 3600000), lm = Math.floor(left % 3600000 / 60000);
    const passed = Math.max(0.05, Math.min(1, (TP.now() - (u.dayStart || TP.now() - 3600000)) / 86400000));
    const fc = Math.min(999, Math.round(tot / passed));
    const days = Object.keys(u.hist || {}).sort().slice(-7);
    const ago = Math.max(0, Math.round((TP.now() - u.at) / 60000));
    return `<section class="us-card">
      <div class="us-hd"><h3><span class="us-ico">📊</span>استهلاك قاعدة البيانات — النهارده</h3><span class="us-live"><i class="${u.error ? 'off' : ''}"></i>${u.error ? 'مستني صلاحية القراءة من جوجل' : `آخر تحديث من ${ago} دقيقة`}</span></div>
      <div class="us-body">
        <div class="us-gauge"><svg viewBox="0 0 200 200" width="190" height="190"><defs><linearGradient id="usg" x1="0" x2="1"><stop offset="0" stop-color="#e7b860"/><stop offset="1" stop-color="#7a1f22"/></linearGradient></defs>
          <circle cx="100" cy="100" r="${R}" fill="none" stroke="#f1e7d8" stroke-width="18"/>
          <circle cx="100" cy="100" r="${R}" fill="none" stroke="url(#usg)" stroke-width="18" stroke-linecap="round" stroke-dasharray="${C * tot / 100} ${C}" transform="rotate(-90 100 100)"/>
          <text x="100" y="98" text-anchor="middle" font-weight="900" font-size="44" fill="#5e1e15">${tot}%</text><text x="100" y="128" text-anchor="middle" font-weight="700" font-size="14" fill="#8b7464">الإجمالي المستهلك</text></svg>
          <span class="us-pill ${st[0]}">${st[1]}</span></div>
        <div class="us-rows">${rows.map(r => { const x = pc(r[2], r[3]); return `<div class="us-row"><div class="us-top"><span class="us-nm"><i>${r[0]}</i>${r[1]}</span><span class="us-val"><b>${f(r[2])}</b> من ${f(r[3])} · <bdi dir="ltr">${x}%</bdi></span></div>
          <div class="us-bar"><div style="width:${Math.max(x, 1)}%;background:${col(x)}"></div><i style="right:60%"></i><i style="right:80%"></i></div>
          <div class="us-rem"><span>الباقي: <b>${f(Math.max(0, r[3] - r[2]))}</b></span><span><bdi dir="ltr">${100 - x}%</bdi> متاح</span></div></div>`; }).join('')}</div>
      </div>
      <div class="us-foot"><div><small>⏱️ بيتجدد بعد</small><b>${lh} ساعة و${lm} دقيقة</b><small>الساعة 10:00 الصبح</small></div>
        <div><small>📈 التوقع لآخر اليوم</small><b><bdi dir="ltr">${fc}%</bdi></b><small>بنفس سرعة الاستهلاك</small></div>
        <div><small>آخر 7 أيام</small><div class="us-spark"><i style="bottom:${80 * 0.3}px"></i>${days.map((d, i) => `<span class="${i === days.length - 1 ? 'today' : ''}" title="${esc(d)}: ${u.hist[d]}%" style="height:${Math.max(2, Math.min(100, u.hist[d]) * 0.3)}px"></span>`).join('')}</div></div></div>
    </section>`;
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
        ${usageCard()}
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
