/* ==========================================================================
   الصحيان — the supervisor's screen.
   The cloud alarm rings the driver at his wake time and again after 2 minutes;
   no "صباح الخير" after 5 minutes (2 for drivers under watch) → the supervisors,
   after 8 minutes with nobody holding the case → the GM and operations manager.
   Here: استلمت (the case is mine) · اتصل · صحي · بديل (takes the whole job).
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui, O = TP.ops;
  const W = () => TP.wakeCore;

  /** Ask the cloud alarm to rebuild the plan of these days now (after a change that moves someone's wake-up). */
  TP.wakeTouch = function (days) {
    const list = Array.from(new Set((Array.isArray(days) ? days : [days]).filter(Boolean)));
    return Promise.all(list.map(d => TP.fb.set('wake/' + d, { rebuild: true, day: d }, true).catch(() => {})));
  };

  const set = (row, key, val) => TP.fb.update('wake/' + row.day, { ['d.' + row.pid + '.' + key]: val, lastEdit: row.pid });
  async function claim(row) {
    await set(row, 'claim', { by: S.person.name, byId: S.person.id, role: S.person.role || '', at: TP.now() });
    TP.audit('wake.claim', TP.driverLabel({ code: row.e.code, name: row.e.name }), row.e.job.label);
  }
  async function woke(row) {
    await set(row, 'outcome', { type: 'woke', by: S.person.name, at: TP.now() });
    TP.audit('wake.woke', TP.driverLabel({ code: row.e.code, name: row.e.name }), row.e.job.label);
    TP.toast('تم ✓');
  }
  function substitute(row) {
    const job = row.e.job, drivers = TP.q.drivers().filter(p => p.active !== false && p.id !== row.pid);
    TP.openModal('بديل — ' + TP.driverLabel({ code: row.e.code, name: row.e.name }), `
      <p class="muted small" style="margin-bottom:10px">${esc(job.type === 'line' ? 'الخط' : 'المشوار')}: <b>${esc(job.label)}</b> الساعة ${esc(W().hm12(job.at))} (<bdi dir="ltr">${esc(row.day)}</bdi>). البديل بياخد كل حاجة، وهيوصله تنبيه صحيان على طول.</p>
      <label class="fld">البديل<select class="input" id="wSub">${U.opts(drivers, '', p => p.id, p => `${TP.driverLabel(p)} — ${TP.driverKindName(p.driverKind)}`, 'اختار السواق')}</select></label>`, async () => {
      const sid = U.val('wSub');
      if (!sid) { TP.toast('اختار البديل'); return false; }
      const ops = [];
      if (job.type === 'line') {
        ops.push({ op: 'update', path: 'lines/' + job.id, data: { subDriverId: sid, subDay: row.day, subBy: S.person.name, subAt: TP.fb.ts() } });
        const doc = row.day === D.todayKey ? D.todayDays.find(x => x.lineId === job.id) : null;
        if (doc && doc.driverId !== sid && S.can('times.correct')) ops.push({ op: 'update', path: 'days/' + doc.id, data: { driverId: sid, updatedAt: TP.fb.ts() } });
      } else {
        ops.push({ op: 'update', path: 'missions/' + job.id, data: { driverId: sid, subFrom: row.pid, ack: TP.fb.del(), updatedAt: TP.fb.ts() } });
      }
      ops.push({ op: 'update', path: 'wake/' + row.day, data: { ['d.' + row.pid + '.outcome']: { type: 'replaced', subId: sid, by: S.person.name, at: TP.now() }, lastEdit: row.pid, rebuild: true } });
      await TP.fb.batch(ops);
      TP.audit('wake.substitute', TP.driverLabel({ code: row.e.code, name: row.e.name }), `${job.label} ← ${TP.q.dname(sid)}`);
      TP.toast('البديل اتعيّن ✓ — هيوصله تنبيه');
    }, { saveLabel: 'تعيين البديل' });
  }

  /** "المشرف" / "المدير العام" / "مدير المطارات"… — who holds the case, by his job (agreed wording). */
  function claimRole(c) {
    const role = c.role || ((TP.q.person(c.byId) || {}).role) || '';
    if (!role || role === 'supervisor' || role === 'custom') return 'المشرف';
    return (TP.ROLES.find(x => x.id === role) || {}).name || 'المشرف';
  }
  /* ---------- the board: one short row per driver, colored by his state (approved design) ---------- */
  const GROUP = { late: 'r', escalated: 'r', claimed: 'o', waiting: 'y', upcoming: 'w', awake: 'g', woke: 'g', replaced: 'g' };
  const ORDER = { r: 0, o: 1, y: 2, w: 3, g: 4 };
  const FILTERS = [['r', 'محتاج تدخل'], ['o', 'مع المشرف'], ['y', 'مستني'], ['g', 'صحيوا']];
  const ui = { flt: '', open: '' };
  const mins = ms => Math.max(0, Math.round(ms / 60000));
  const inTime = ms => { const m = mins(ms); return m < 60 ? `بعد ${m} د` : `بعد ${Math.floor(m / 60)} س${m % 60 ? ' و' + (m % 60) + ' د' : ''}`; };
  /** the short status at the row's end */
  function stText(r, now) {
    const e = r.e, late = mins(now - e.wakeAt);
    if (r.status === 'late') return `متأخر ${late} د`;
    if (r.status === 'escalated') return `متأخر ${late} د · وصل للإدارة`;
    if (r.status === 'claimed') return `مع ${e.claim ? claimRole(e.claim) : 'المشرف'} · ${late} د`;
    if (r.status === 'waiting') return `رن من ${late} د`;
    if (r.status === 'upcoming') return inTime(e.wakeAt - now);
    if (r.status === 'replaced') return 'اتعيّن بديل';
    const at = e.awakeAt || (r.ack && r.ack.awakeAt);
    return (r.status === 'woke' ? 'صحي (المشرف)' : 'صحي') + (at ? ' ' + W().hm12(at) : '');
  }
  function readyText(r, tomorrow) {
    const a = r.ack || {};
    if (a.readyAt) return `<span class="wb-ok">جاهز${a.battery ? ' ' + esc(a.battery) + '%' : ''}</span>`;
    return r.day === tomorrow && r.status === 'upcoming' ? '<span class="wb-no">مأكدش جاهز</span>' : '';
  }
  function boardRow(r, now, tomorrow) {
    const e = r.e, g = GROUP[r.status] || 'w', key = r.day + '|' + r.pid, open = ui.open === key;
    const canAct = S.can('wake.supervise') || S.can('times.correct');
    const noPush = e.noToken || !(e.tokens || []).length;
    const live = !['awake', 'woke', 'replaced'].includes(r.status);
    const ready = readyText(r, tomorrow);
    const l2 = [`${esc(e.job.label)} ${esc(W().hm12(e.job.at))}`, `صحيان ${esc(W().hm12(e.wakeAt))}`, ready].filter(Boolean).join(' · ');
    const badges = (e.watch ? ' <span class="badge-s far">تحت المتابعة</span>' : '') + (noPush && live ? ' <span class="badge-s nogps">التنبيهات مش متفعلة</span>' : '');
    const how = (e.awakeMethod || (r.ack && r.ack.method)) === 'opened' ? ' (فتح التطبيق)' : '';
    return `<div class="wb-row ${g} ${open ? 'open' : ''}" data-wrow="${esc(key)}">
      <div class="wb-main"><div class="wb-l1"><span class="wb-name">${esc(TP.driverLabel({ code: e.code, name: e.name }))}</span><span class="wb-st">${esc(stText(r, now))}${esc(how)}</span></div>
        <div class="wb-l2">${l2}${badges}</div>
        ${open ? `<div class="wb-more">
          ${r.status === 'claimed' && e.claim ? `<div class="small">المخالفة مع ${esc(claimRole(e.claim))} الآن</div>` : ''}
          ${e.claim ? `<div class="small" style="color:var(--warn)">تم المتابعة واستلام المخالفة من خلال: ${esc(String(e.claim.by || '').split(/\s*[-–—(|]\s*/)[0])} (${esc(TP.ago(e.claim.at))})</div>` : ''}
          ${e.mgmtAt ? '<div class="small" style="color:var(--danger)">وصل للإدارة</div>' : ''}
          ${e.outcome && e.outcome.by ? `<div class="small muted">${esc(e.outcome.by)}${e.supAt ? ' · اتأخر' : ''}</div>` : ''}
          <div class="small muted">${esc(TP.driverKindName(e.kind))} · ${r.day === D.todayKey ? 'النهارده' : 'بكره'} · قبلها بـ ${Math.round(e.leadMin / 6) / 10} ساعة</div>
          ${canAct && live ? `<div class="wb-acts">
            ${!e.claim ? `<button class="btn btn-primary btn-sm" data-claim="${esc(key)}">استلمت</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-woke="${esc(key)}">${TP.icon('check', 16)}صحي</button>
            ${e.job.type === 'line' || S.can('wake.supervise') || S.can('missions.manage') ? `<button class="btn btn-ghost btn-sm" data-sub="${esc(key)}">${TP.icon('users', 16)}بديل</button>` : ''}</div>` : ''}</div>` : ''}</div>
      ${e.phone ? `<a class="wb-call" href="tel:${esc(e.phone)}" title="اتصل" data-nocollapse>${TP.icon('phone', 18)}</a>` : '<span class="wb-call off"></span>'}
    </div>`;
  }

  TP.views.wake = {
    deps: ['wake', 'wakeAcks', 'people', 'settings', 'todayDays'],
    render(root) {
      const rows = TP.q.wakeRows().filter(r => GROUP[r.status]), now = TP.now(), today = D.todayKey, tomorrow = O.addDays(today, 1);
      const count = g => rows.filter(r => GROUP[r.status] === g).length;
      const s = Object.assign({}, TP.wakeCore.DEFAULTS, D.settings);
      const nightOn = now >= TP.wakeCore.cairoMs(today, s.nightCheckTime);
      const notReady = rows.filter(r => r.day === tomorrow && r.status === 'upcoming' && !(r.ack && r.ack.readyAt));
      const built = [today, tomorrow].map(d => D.wakePlans[d] && D.wakePlans[d].builtAt).filter(Boolean);
      const push = TP.push.state();
      const shown = rows.filter(r => !ui.flt || GROUP[r.status] === ui.flt)
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || ORDER[GROUP[a.status]] - ORDER[GROUP[b.status]] || a.e.wakeAt - b.e.wakeAt);
      const days = [today, tomorrow].concat(Array.from(new Set(shown.map(r => r.day))).filter(d => d !== today && d !== tomorrow));
      const dayName = d => d === today ? 'النهارده' : d === tomorrow ? 'بكره' : d;
      root.innerHTML = `
        ${push !== 'granted' ? `<div class="banner warn">${TP.icon('bell')}<span class="grow">${push === 'denied' ? 'التنبيهات مقفولة على الجهاز ده — افتحها من إعدادات المتصفح للموقع ده.' : push === 'unsupported' ? 'المتصفح ده مش بيدعم التنبيهات — استخدم Chrome على الموبايل.' : 'فعّل التنبيهات على الجهاز ده علشان جرس الصحيان يوصلك حتى لو الشاشة مقفولة.'}</span>${push === 'default' ? '<button class="btn btn-primary btn-sm" id="wPush">فعّل التنبيهات</button>' : ''}</div>` : ''}
        ${!built.length ? `<div class="banner info">${TP.icon('clock')}<span class="grow">لسه مفيش خطة صحيان — المنبه السحابي بيعملها أوتوماتيك أول ما يشتغل (بعد تركيب Cloudflare).</span></div>` : ''}
        ${nightOn && notReady.length ? `<div class="banner warn">${TP.icon('clock')}<span class="grow">فحص الليل: ${notReady.length} سواق مأكدوش "جاهز لبكره" — مكتوب جنبهم بالأحمر.</span></div>` : ''}
        <div class="wb-chips">${FILTERS.map(([g, l]) => `<button type="button" class="wb-chip ${g} ${ui.flt === g ? 'on' : ''}" data-wflt="${g}"><b>${count(g)}</b><span>${l}</span></button>`).join('')}</div>
        <div class="wb-tools"><span class="muted small">${ui.flt ? `<button type="button" class="link" data-wflt="">اعرض الكل</button> · ` : ''}${built.length ? 'الخطة اتحدثت ' + esc(TP.ago(Math.max(...built))) : ''}</span>${S.can('wake.supervise') || S.can('times.correct') || S.can('lines.manage') ? `<button class="btn btn-ghost btn-sm" id="wRebuild">${TP.icon('refresh', 16)}حدّث الخطة</button>` : ''}</div>
        ${days.map(d => { const list = shown.filter(r => r.day === d); return list.length ? `<h3 class="wb-day">${esc(dayName(d))} · ${list.length} ${list.length === 1 ? 'سواق' : 'سواقين'}</h3>${list.map(r => boardRow(r, now, tomorrow)).join('')}` : ''; }).join('')}
        ${!shown.length ? U.empty(ui.flt ? 'مفيش حد في الخانة دي' : 'مفيش صحيان جاي') : `<p class="wb-note">دوس على أي سطر ← استلمت · صحي · بديل</p>`}`;
      root.querySelectorAll('[data-wflt]').forEach(b => b.onclick = () => { ui.flt = ui.flt === b.dataset.wflt ? '' : b.dataset.wflt; TP.rerender(); });
      root.querySelectorAll('[data-wrow]').forEach(el => el.onclick = ev => {
        if (ev.target.closest('a,button')) return;
        ui.open = ui.open === el.dataset.wrow ? '' : el.dataset.wrow; TP.rerender();
      });
      const find = v => { const [day, pid] = v.split('|'); return TP.q.wakeRows().find(r => r.day === day && r.pid === pid); };
      const guard = p => p.catch(e => TP.toast(TP.errorText(e), 'warn'));
      root.querySelectorAll('[data-claim]').forEach(b => b.onclick = () => { const r = find(b.dataset.claim); if (r) guard(claim(r)); });
      root.querySelectorAll('[data-woke]').forEach(b => b.onclick = () => { const r = find(b.dataset.woke); if (r) guard(woke(r)); });
      root.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { const r = find(b.dataset.sub); if (r) substitute(r); });
      const rb = root.querySelector('#wRebuild'); if (rb) rb.onclick = () => TP.wakeTouch([today, tomorrow]).then(() => TP.toast('المنبه السحابي هيحدّث الخطة خلال دقيقة'));
      const wp = root.querySelector('#wPush'); if (wp) wp.onclick = () => TP.push.enable().then(okk => { TP.toast(okk ? 'التنبيهات اتفعلت ✓' : 'مقدرناش نفعّل التنبيهات', okk ? '' : 'warn'); TP.rerender(); });
    }
  };
})(window.TP = window.TP || {});
