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
    await set(row, 'claim', { by: S.person.name, byId: S.person.id, at: TP.now() });
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
        ops.push({ op: 'update', path: 'missions/' + job.id, data: { driverId: sid, subFrom: row.pid, updatedAt: TP.fb.ts() } });
      }
      ops.push({ op: 'update', path: 'wake/' + row.day, data: { ['d.' + row.pid + '.outcome']: { type: 'replaced', subId: sid, by: S.person.name, at: TP.now() }, lastEdit: row.pid, rebuild: true } });
      await TP.fb.batch(ops);
      TP.audit('wake.substitute', TP.driverLabel({ code: row.e.code, name: row.e.name }), `${job.label} ← ${TP.q.dname(sid)}`);
      TP.toast('البديل اتعيّن ✓ — هيوصله تنبيه');
    }, { saveLabel: 'تعيين البديل' });
  }

  function card(r, urgent) {
    const e = r.e, st = TP.wakeCore.STATUS[r.status] || ['', 'st-off'], late = Math.max(0, Math.round((TP.now() - e.wakeAt) / 60000));
    const canAct = S.can('wake.supervise') || S.can('times.correct');
    const noPush = e.noToken || !(e.tokens || []).length;
    return `<div class="request-card ${urgent ? 'sos' : ''}" style="${urgent ? '' : 'border-color:var(--line);box-shadow:none'}">
      <span class="st ${st[1]}">${esc(st[0])}</span>
      <div class="grow"><b>${esc(TP.driverLabel({ code: e.code, name: e.name }))}</b> ${e.watch ? '<span class="badge-s far">تحت المتابعة</span>' : ''} ${noPush ? '<span class="badge-s nogps">التنبيهات مش متفعلة عنده</span>' : ''}
        <div class="small muted">${esc(e.job.label)} الساعة ${esc(W().hm12(e.job.at))} · ميعاد صحيانه ${esc(W().hm12(e.wakeAt))}${r.status === 'late' || r.status === 'escalated' || r.status === 'claimed' ? ` · متأخر ${late} دقيقة` : ''}</div>
        ${e.claim ? `<div class="small" style="color:var(--warn)">ماسكه: ${esc(e.claim.by)} (${esc(TP.ago(e.claim.at))})</div>` : ''}
        ${e.mgmtAt ? '<div class="small" style="color:var(--danger)">وصل للإدارة</div>' : ''}</div>
      ${e.phone ? `<a class="btn btn-ghost btn-sm" href="tel:${esc(e.phone)}">${TP.icon('phone', 16)}اتصل</a>` : ''}
      ${canAct && !e.claim ? `<button class="btn btn-primary btn-sm" data-claim="${esc(r.day + '|' + r.pid)}">استلمت</button>` : ''}
      ${canAct ? `<button class="btn btn-ghost btn-sm" data-woke="${esc(r.day + '|' + r.pid)}">${TP.icon('check', 16)}صحي</button>` : ''}
      ${canAct && (e.job.type === 'line' || S.can('wake.supervise') || S.can('missions.manage')) ? `<button class="btn btn-ghost btn-sm" data-sub="${esc(r.day + '|' + r.pid)}">${TP.icon('users', 16)}بديل</button>` : ''}
    </div>`;
  }

  TP.views.wake = {
    deps: ['wake', 'wakeAcks', 'people', 'settings', 'todayDays'],
    render(root) {
      const rows = TP.q.wakeRows(), now = TP.now(), today = D.todayKey, tomorrow = O.addDays(today, 1);
      const urgent = rows.filter(r => r.status === 'late' || r.status === 'escalated');
      const claimed = rows.filter(r => r.status === 'claimed');
      const waiting = rows.filter(r => r.status === 'waiting');
      const upcoming = rows.filter(r => r.status === 'upcoming');
      const done = rows.filter(r => ['awake', 'woke', 'replaced'].includes(r.status));
      const s = Object.assign({}, TP.wakeCore.DEFAULTS, D.settings);
      const nightOn = now >= TP.wakeCore.cairoMs(today, s.nightCheckTime);
      const tomorrowRows = rows.filter(r => r.day === tomorrow && r.status === 'upcoming');
      const notReady = tomorrowRows.filter(r => !(r.ack && r.ack.readyAt));
      const built = [today, tomorrow].map(d => D.wakePlans[d] && D.wakePlans[d].builtAt).filter(Boolean);
      const push = TP.push.state();
      root.innerHTML = `
        ${push !== 'granted' ? `<div class="banner warn">${TP.icon('bell')}<span class="grow">${push === 'denied' ? 'التنبيهات مقفولة على الجهاز ده — افتحها من إعدادات المتصفح للموقع ده.' : push === 'unsupported' ? 'المتصفح ده مش بيدعم التنبيهات — استخدم Chrome على الموبايل.' : 'فعّل التنبيهات على الجهاز ده علشان جرس الصحيان يوصلك حتى لو الشاشة مقفولة.'}</span>${push === 'default' ? '<button class="btn btn-primary btn-sm" id="wPush">فعّل التنبيهات</button>' : ''}</div>` : ''}
        ${!built.length ? `<div class="banner info">${TP.icon('clock')}<span class="grow">لسه مفيش خطة صحيان — المنبه السحابي بيعملها أوتوماتيك أول ما يشتغل (بعد تركيب Cloudflare).</span></div>` : ''}
        <div class="kpis">
          <div class="kpi ${urgent.length ? 'danger' : ''}"><span class="kpi-ic">${TP.icon('alarm', 22)}</span><div><span>محتاج تدخل</span><strong>${urgent.length}</strong></div></div>
          <div class="kpi ${claimed.length ? 'warn' : ''}"><span class="kpi-ic">${TP.icon('phone', 22)}</span><div><span>مع المشرف</span><strong>${claimed.length}</strong></div></div>
          <div class="kpi"><span class="kpi-ic">${TP.icon('clock', 22)}</span><div><span>مستني صباح الخير</span><strong>${waiting.length}</strong></div></div>
          <div class="kpi ok"><span class="kpi-ic">${TP.icon('check', 22)}</span><div><span>صحيوا</span><strong>${done.length}</strong></div></div>
        </div>
        ${urgent.length || claimed.length ? `<section class="card"><div class="card-head"><h3>محتاج تدخل دلوقتي</h3></div>${urgent.map(r => card(r, true)).join('')}${claimed.map(r => card(r, false)).join('')}</section>` : ''}
        ${waiting.length ? `<section class="card"><div class="card-head"><h3>المنبه رن — مستنيين "صباح الخير"</h3></div>${waiting.map(r => card(r, false)).join('')}</section>` : ''}
        <section class="card"><div class="card-head"><h3>الصحيان الجاي</h3>
          <div class="toolbar-end"><span class="muted small">${built.length ? 'الخطة اتحدثت ' + esc(TP.ago(Math.max(...built))) : ''}</span>${S.can('wake.supervise') || S.can('times.correct') || S.can('lines.manage') ? `<button class="btn btn-ghost btn-sm" id="wRebuild">${TP.icon('refresh', 16)}حدّث الخطة</button>` : ''}</div></div>
          ${upcoming.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>السواق</th><th>الشغل</th><th>ميعاد الصحيان</th><th>جاهز لبكره</th><th></th></tr></thead><tbody>${upcoming.map(r => `<tr>
            <td><b>${esc(TP.driverLabel({ code: r.e.code, name: r.e.name }))}</b>${r.e.watch ? ' <span class="badge-s far">تحت المتابعة</span>' : ''}<div class="muted small">${esc(TP.driverKindName(r.e.kind))}</div></td>
            <td>${esc(r.e.job.label)}<div class="muted small">${r.day === today ? 'النهارده' : 'بكره'} الساعة ${esc(W().hm12(r.e.job.at))}</div></td>
            <td class="num"><b>${esc(W().hm12(r.e.wakeAt))}</b><div class="muted small">قبلها بـ ${Math.round(r.e.leadMin / 6) / 10} ساعة</div></td>
            <td>${r.ack && r.ack.readyAt ? `<span class="st st-ok">جاهز</span>${r.ack.battery ? `<div class="muted small">بطارية ${esc(r.ack.battery)}%</div>` : ''}` : (r.day === tomorrow ? '<span class="st st-warn">لسه</span>' : '—')}</td>
            <td>${!(r.e.tokens || []).length ? '<span class="badge-s nogps">التنبيهات مش متفعلة</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : U.empty('مفيش صحيان جاي')}
        </section>
        ${nightOn && notReady.length ? `<section class="card"><div class="card-head"><h3>فحص الليل — مأكدوش "جاهز لبكره"</h3><span class="st st-warn">${notReady.length}</span></div>${notReady.map(r => card(r, false)).join('')}</section>` : ''}
        ${done.length ? `<section class="card"><details><summary class="link">صحيوا (${done.length})</summary>
          <div class="table-wrap" style="margin-top:8px"><table class="tbl"><tbody>${done.map(r => `<tr><td>${esc(TP.driverLabel({ code: r.e.code, name: r.e.name }))}</td><td>${esc(r.e.job.label)}</td>
            <td><span class="st ${TP.wakeCore.STATUS[r.status][1]}">${esc(TP.wakeCore.STATUS[r.status][0])}</span></td>
            <td class="small muted">${r.e.awakeAt || (r.ack && r.ack.awakeAt) ? esc(TP.fmtTime(r.e.awakeAt || r.ack.awakeAt)) + ((r.e.awakeMethod || (r.ack && r.ack.method)) === 'opened' ? ' (فتح التطبيق)' : '') : r.e.outcome ? esc(r.e.outcome.by || '') : ''}${r.e.supAt ? ' · اتأخر' : ''}</td></tr>`).join('')}</tbody></table></div></details></section>` : ''}`;
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
