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
      ['lowBatteryPct', 'تنبيه البطارية الضعيفة عند أقل من', '%', 'int', 5, 60],
      ['wakeSecondMin', 'الرنة التانية للسواق بعد كام دقيقة', '', 'int', 1, 10],
      ['readyReminderTime', 'ميعاد تذكير السواقين بـ "جاهز لبكره"', 'فحص الليل للمشرف بيبقى في الميعاد اللي فوق', 'time'],
      ['watchLateCount', 'السواق يبقى "تحت المتابعة" لو اتأخر كام مرة في 30 يوم', '', 'int', 1, 10],
      ['watchSupMin', 'السواق اللي تحت المتابعة: جرس المشرف بعد كام دقيقة', 'بدل الـ 5 دقايق العادية', 'int', 1, 10],
      ['wakeGiveUpMin', 'المنبه يبطّل يدوّر بعد ميعاد الشغل بكام دقيقة', '', 'int', 30, 480]
    ] },
    { title: 'المتابعة والمكان', items: [
      ['gpsEveryMin', 'إرسال مكان السواق كل كام دقيقة (أثناء المهمة)', 'أقل من 3 بيقرب من الحد المجاني اليومي', 'int', 1, 15],
      ['geofenceM', 'المسافة المقبولة لزرار "وصلت" (متر)', 'لو أبعد من كده الضغطة بتتسجل بعلامة تحذير للإدارة', 'int', 50, 2000],
      ['autoGps', 'التسجيل التلقائي بالموقع', 'التطبيق يسجل الوصول والتحرك لوحده وهو مفتوح (لو السواق نسي يدوس)', 'bool'],
      ['morningAutoLeadMin', 'التسجيل التلقائي الصبح يبدأ قبل ميعاد الخط بكام دقيقة', '', 'int', 15, 240],
      ['eveningAutoWindowMin', 'وصول المصنع المسا يتسجل تلقائي من قبل ميعاد الرجوع بكام دقيقة', 'علشان الانتظار ميتحسبش وهو راكن في المصنع من بدري', 'int', 0, 180],
      ['dayRolloverHour', 'اليوم اللي لسه مخلصش يفضل مفتوح لحد الساعة', 'للمسا اللي بيعدّي نص الليل (5 = 5 الفجر)', 'int', 0, 10]
    ] },
    { title: 'العملاء والتتبع', items: [
      ['maxCustomersPerCar', 'أقصى عدد عملاء في العربية', 'عربيات ملاكي — 3', 'int', 1, 8],
      ['nearLeadMin', 'عملاء أول نقطة يجيلهم "العربية في الطريق" قبل ميعاد الخط بكام دقيقة', 'لو التطبيق مفتوح والسواق بيتحرك', 'int', 10, 180],
      ['noShowWaitMin', 'زرار "مجاش" يظهر للسواق بعد انتظار كام دقيقة', '', 'int', 1, 30],
      ['liveEverySec', 'مكان العربية يتبعت للعميل كل كام ثانية (وهي جاية له)', '60 مناسب — أقل من 30 بيقرب من الحد المجاني', 'int', 15, 120],
      ['opsPhone', 'رقم التشغيل اللي بيظهر للعميل', 'العميل يقدر يكلم الشركة منه', 'text']
    ] },
    { title: 'المطار', items: [
      ['airportDepartLeadMin', 'المسافر يوصل المطار قبل الطيارة بكام دقيقة', '180 = 3 ساعات', 'int', 60, 300],
      ['airportArriveEarlyMin', 'في الاستقبال: السواق يبقى في المطار قبل الهبوط بكام دقيقة', '', 'int', 0, 120],
      ['airportDriveMin', 'مدة الطريق للمطار (الافتراضي — بيتعدل لكل مشوار)', 'دقيقة', 'int', 15, 300],
      ['homeAirports', 'مطاراتنا (أكواد IATA)', 'الطالع منها = توصيل، والنازل فيها = استقبال. مثال: CAI,SPX', 'text'],
      ['flightMonthlyLimit', 'أقصى عدد بحث أوتوماتيك عن الرحلات في الشهر', '190 مناسب للخطة المجانية — راجع الاستهلاك في صفحة RapidAPI. بعد الحد الميعاد بيتكتب باليد', 'int', 0, 3000],
      ['airportFreeWaitMin', 'سعر المطار شامل انتظار كام دقيقة (للأسعار بس)', 'الانتظار نفسه بيتسجل للمعلومة', 'int', 0, 240]
    ] },
    { title: 'الحسابات', items: [
      ['financeOn', 'تشغيل الحسابات جوه التطبيق', 'مقفولة = تشغيل بس: الأسعار والكشوفات بتستخبى، والشغل بيتصدّر Excel لسيستم الحسابات. البيانات بتفضل محفوظة.', 'bool'],
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
      if (type === 'text') {
        if (k === 'homeAirports') { const v = raw.toUpperCase().split(/[^A-Z]+/).filter(x => /^[A-Z]{3}$/.test(x)); if (!v.length) return TP.toast('اكتب كود مطار واحد على الأقل (مثال CAI)'); out[k] = v.join(','); continue; }
        if (k === 'opsPhone' && raw && !TP.phoneIntl(raw)) return TP.toast('رقم التشغيل مش مظبوط');
        out[k] = raw.slice(0, 40); continue;
      }
      const n = TP.num(raw);
      if (!isFinite(n) || n < min || n > max || (type === 'int' && n % 1)) return TP.toast(`"${label}" لازم يكون بين ${min} و ${max}`);
      out[k] = n;
    }
    if (out.wakeEscalateMin <= out.wakeResponseMin) return TP.toast('تنبيه الإدارة لازم يكون بعد جرس المشرف');
    const ends = ['ot_end1', 'ot_end2', 'ot_end3'].map(id => U.val(id));
    if (ends.some(e => !/^\d{2}:\d{2}$/.test(e))) return TP.toast('اكتب نهاية كل شريحة سهرة');
    out.overtimeTierEnds = ends.map(e => e === '00:00' ? '24:00' : e);
    if (!(out.overtimeTierEnds[0] < out.overtimeTierEnds[1] && out.overtimeTierEnds[1] < out.overtimeTierEnds[2])) return TP.toast('شرائح السهرة لازم تكون بالترتيب');
    await TP.fb.batch([{ op: 'set', path: 'system/settings', data: Object.assign(out, { updatedAt: TP.fb.ts() }), merge: true },
      { op: 'set', path: 'public/info', data: { opsPhone: out.opsPhone || '', updatedAt: TP.fb.ts() }, merge: true }]);
    const diff = Object.keys(out).filter(k => k !== 'updatedAt' && JSON.stringify(out[k]) !== JSON.stringify(D.settings[k]));
    TP.audit('settings.update', 'الإعدادات', diff.join(', '));
    { const today2 = TP.dayKey(TP.now()); TP.wakeTouch && TP.wakeTouch([today2, TP.ops.addDays(today2, 1)]); }
    TP.toast('تم حفظ الإعدادات ✓');
  }

  TP.views.settings = {
    deps: ['settings'],
    render(root) {
      const s = D.settings, ends = s.overtimeTierEnds || ['21:00', '23:00', '24:00'];
      const input = (k, type, min, max, step) => type === 'bool'
        ? `<label class="check"><input type="checkbox" id="s_${k}" ${(k === 'financeOn' ? s[k] === true : s[k] !== false) ? 'checked' : ''}><span>شغال</span></label>`
        : type === 'text'
        ? `<input class="input" id="s_${k}" dir="ltr" value="${esc(s[k] || '')}" style="max-width:220px">`
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
