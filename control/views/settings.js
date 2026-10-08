/* ==========================================================================
   System settings (wake-up, alerts, GPS, airport, tax…)
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const D = TP.D, U = TP.ui;

  const GROUPS = [
    { title: 'الصحيان', items: [
      ['wakeLeadHoursLine', 'المنبّه قبل ميعاد سواق الخط بكام ساعة', 'سواق الخط يقدر يغيّر ميعاده بنفسه بالرقم السري', 'num', 0, 6, 0.25],
      ['wakeLeadHoursTourism', 'المنبّه قبل مأمورية السياحة بكام ساعة', '', 'num', 0, 6, 0.25],
      ['wakeResponseMin', 'بعد كام دقيقة من المنبّه يرن جرس المشرف', 'لو السواق مداسش "صباح الخير"', 'int', 1, 30],
      ['wakeEscalateMin', 'بعد كام دقيقة من المنبّه يطلع التنبيه للإدارة', 'لازم يكون أكبر من وقت جرس المشرف', 'int', 2, 60],
      ['nightCheckTime', 'ميعاد فحص الليل', 'المنبّه والبطارية والصلاحيات عند سواقين بكره', 'time'],
      ['lowBatteryPct', 'تنبيه البطارية الضعيفة عند أقل من', '%', 'int', 5, 60]
    ] },
    { title: 'المتابعة والمكان', items: [
      ['gpsEveryMin', 'إرسال مكان السواق كل كام دقيقة (أثناء المهمة)', 'أقل من 3 بيقرب من الحد المجاني اليومي', 'int', 1, 15],
      ['geofenceM', 'المسافة المقبولة لزرار "وصلت" (متر)', 'لو أبعد من كده الضغطة بتتسجل بعلامة تحذير للإدارة', 'int', 50, 2000],
      ['autoGps', 'التسجيل التلقائي بالموقع', 'التطبيق يسجل الوصول والتحرك لوحده وهو مفتوح (لو السواق نسي يدوس)', 'bool'],
      ['morningAutoLeadMin', 'التسجيل التلقائي الصبح يبدأ قبل ميعاد الخط بكام دقيقة', '', 'int', 15, 240],
      ['eveningAutoWindowMin', 'وصول المصنع المسا يتسجل تلقائي من قبل ميعاد الرجوع بكام دقيقة', 'علشان الانتظار ميتحسبش وهو راكن في المصنع من بدري', 'int', 0, 180],
      ['dayRolloverHour', 'اليوم اللي لسه مخلصش يفضل مفتوح لحد الساعة', 'للمسا اللي بيعدّي نص الليل (5 = 5 الفجر)', 'int', 0, 10]
    ] },
    { title: 'المطار', items: [
      ['airportLeadMin', 'سواق السياحة يتحرك قبل وصول الطيارة بكام دقيقة', '75 = ساعة وربع', 'int', 15, 240],
      ['airportFreeWaitMin', 'مشوار المطار شامل انتظار كام دقيقة', 'بعدها كسر الساعة بساعة', 'int', 0, 240]
    ] },
    { title: 'المالية والتنبيهات', items: [
      ['taxPct', 'نسبة الضريبة من إجمالي الفواتير', '%', 'num', 0, 30, 0.5],
      ['expiryWarnDays', 'التنبيه قبل انتهاء الرخص والتأمين بكام يوم', '', 'int', 1, 120]
    ] }
  ];

  async function save() {
    const out = {};
    for (const g of GROUPS) for (const [k, label, , type, min, max] of g.items) {
      const raw = U.val('s_' + k);
      if (type === 'time') { if (!/^\d{2}:\d{2}$/.test(raw)) return TP.toast(`"${label}" محتاج وقت`); out[k] = raw; continue; }
      if (type === 'bool') { out[k] = U.checked('s_' + k); continue; }
      const n = TP.num(raw);
      if (!isFinite(n) || n < min || n > max || (type === 'int' && n % 1)) return TP.toast(`"${label}" لازم يكون بين ${min} و ${max}`);
      out[k] = n;
    }
    if (out.wakeEscalateMin <= out.wakeResponseMin) return TP.toast('تنبيه الإدارة لازم يكون بعد جرس المشرف');
    const ends = ['ot_end1', 'ot_end2', 'ot_end3'].map(id => U.val(id));
    if (ends.some(e => !/^\d{2}:\d{2}$/.test(e))) return TP.toast('اكتب نهاية كل شريحة سهرة');
    out.overtimeTierEnds = ends.map(e => e === '00:00' ? '24:00' : e);
    if (!(out.overtimeTierEnds[0] < out.overtimeTierEnds[1] && out.overtimeTierEnds[1] < out.overtimeTierEnds[2])) return TP.toast('شرائح السهرة لازم تكون بالترتيب');
    await TP.fb.set('system/settings', Object.assign(out, { updatedAt: TP.fb.ts() }), true);
    const diff = Object.keys(out).filter(k => k !== 'updatedAt' && JSON.stringify(out[k]) !== JSON.stringify(D.settings[k]));
    TP.audit('settings.update', 'الإعدادات', diff.join(', '));
    TP.toast('تم حفظ الإعدادات ✓');
  }

  TP.views.settings = {
    deps: ['settings'],
    render(root) {
      const s = D.settings, ends = s.overtimeTierEnds || ['21:00', '23:00', '24:00'];
      const input = (k, type, min, max, step) => type === 'bool'
        ? `<label class="check"><input type="checkbox" id="s_${k}" ${s[k] !== false ? 'checked' : ''}><span>شغال</span></label>`
        : type === 'time'
        ? `<input class="input" id="s_${k}" type="time" value="${esc(s[k])}">`
        : `<input class="input" id="s_${k}" type="number" inputmode="decimal" dir="ltr" min="${min}" max="${max}" step="${step || 1}" value="${esc(s[k])}">`;
      root.innerHTML = GROUPS.map(g => `<section class="card"><div class="card-head"><h3>${esc(g.title)}</h3></div>
        ${g.items.map(([k, label, note, type, min, max, step]) => `<div class="set-row"><div><b>${esc(label)}</b>${note ? `<small>${esc(note)}</small>` : ''}</div>${input(k, type, min, max, step)}</div>`).join('')}</section>`).join('') + `
        <section class="card"><div class="card-head"><h3>شرائح السهرة</h3><span class="muted small">الأسعار نفسها في صفحة الأسعار</span></div>
          ${['الشريحة الأولى — لحد', 'الشريحة التانية — لحد', 'الشريحة التالتة — لحد'].map((l, i) => `<div class="set-row"><div><b>${l}</b></div><input class="input" id="ot_end${i + 1}" type="time" value="${esc(ends[i] === '24:00' ? '00:00' : ends[i])}"></div>`).join('')}
        </section>
        <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn btn-primary btn-lg" id="saveS">${TP.icon('check', 18)}حفظ الإعدادات</button></div>`;
      root.querySelector('#saveS').onclick = () => save().catch(e => TP.toast(TP.errorText(e), 'warn'));
    }
  };
})(window.TP = window.TP || {});
