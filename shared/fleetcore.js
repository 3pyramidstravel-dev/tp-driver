/* ==========================================================================
   Fleet core — trip orders (أمر الشغل), maintenance by kilometres, document
   expiry and the WhatsApp texts. Pure logic shared by the Control Tower, the
   driver app and the cloud alarm (the worker inlines this file). No DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const FL = {};

  /* ---------- maintenance plan (the GM's numbers — editable from the Control Tower) ---------- */
  // km: per model (null = not for that model). check: an inspection item on every oil change.
  FL.MODELS = [{ id: 'corolla', name: 'تويوتا كورولا' }, { id: 'elantra', name: 'هيونداي إلنترا' }];
  FL.PARTS = [
    { k: 'oil', n: 'زيت الموتور', km: { corolla: 9000, elantra: 9000 } },
    { k: 'airf', n: 'فلتر الهوا', km: { corolla: 30000, elantra: 30000 } },
    { k: 'gearoil', n: 'زيت الفتيس', km: { corolla: 40000, elantra: 80000 } },
    { k: 'gearf', n: 'فلتر الفتيس الداخلي', km: { corolla: 80000, elantra: null }, note: 'مرة زيت بس، ومرة زيت + فلتر' },
    { k: 'belt', n: 'سير الدينامو', km: { corolla: 80000, elantra: 80000 } },
    { k: 'plugs', n: 'البوجيهات', km: { corolla: 80000, elantra: 80000 } },
    { k: 'fuelf', n: 'فلتر البنزين', km: { corolla: 80000, elantra: 80000 } },
    { k: 'tires', n: 'الكاوتش', km: { corolla: 120000, elantra: 120000 }, checkKm: 100000, months: 18 },
    { k: 'coolant', n: 'مياه التبريد', yearly: '05-01' }
  ];
  FL.CHECKS = ['افحص فلتر التكييف', 'افحص تيل الفرامل'];
  FL.SOON_KM = 500;

  /** The plan with the GM's changes (settings.maintPlan = { partKey: { corolla, elantra, checkKm, months, yearly } }). */
  FL.plan = function (settings) {
    const over = (settings && settings.maintPlan) || {};
    return FL.PARTS.map(p => {
      const o = over[p.k] || {}, km = Object.assign({}, p.km || {});
      FL.MODELS.forEach(m => { if (o[m.id] !== undefined) km[m.id] = o[m.id] === null || o[m.id] === '' ? null : Number(o[m.id]); });
      return Object.assign({}, p, { km: p.km ? km : undefined, checkKm: o.checkKm !== undefined ? Number(o.checkKm) || null : p.checkKm, months: o.months !== undefined ? Number(o.months) || null : p.months, yearly: o.yearly !== undefined ? o.yearly : p.yearly });
    });
  };
  const dayMs = d => Date.parse(d + 'T00:00:00Z');
  const addMonths = (d, n) => { const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, dd)); return t.toISOString().slice(0, 10); };
  FL.daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / 86400000);

  /**
   * Every part of a car: when it is due and how it stands.
   * stage: 'ok' | 'soon' (≤ 500 km / 2 weeks) | 'check' (tyres: look at them) | 'due' | 'unknown' (no last change recorded)
   */
  FL.status = function (car, plan, today) {
    const model = car && car.model, odo = Number(car && car.odo) || 0, maint = (car && car.maint) || {};
    return plan.filter(p => p.yearly || (p.km && p.km[model])).map(p => {
      const last = maint[p.k] || null, row = { k: p.k, n: p.n, note: p.note || '', last, stage: 'unknown', left: null, next: null, nextDay: null };
      if (p.yearly) {
        // every year before the summer: done in the two months before the date (or after it) counts for that year
        const y = Number(today.slice(0, 4)), T = `${y}-${p.yearly}`;
        const D = today >= T ? T : `${y - 1}-${p.yearly}`, N = today >= T ? `${y + 1}-${p.yearly}` : T;
        row.nextDay = N;
        if (!last || !last.day) row.stage = 'unknown';
        else if (last.day >= addMonths(D, -2)) row.stage = FL.daysBetween(today, N) <= 14 ? 'soon' : 'ok';
        else { row.stage = 'due'; row.nextDay = D; }
        row.left = FL.daysBetween(today, row.nextDay);
        return row;
      }
      const every = p.km[model];
      if (!last || !isFinite(last.odo)) return Object.assign(row, { every });
      row.every = every; row.next = last.odo + every; row.left = row.next - odo;
      row.stage = row.left <= 0 ? 'due' : row.left <= FL.SOON_KM ? 'soon' : 'ok';
      if (p.checkKm && row.stage === 'ok' && odo - last.odo >= p.checkKm) row.stage = 'check';
      if (p.months && last.day) {
        row.nextDay = addMonths(last.day, p.months);
        const dl = FL.daysBetween(today, row.nextDay);
        if (dl <= 0) row.stage = 'due'; else if (dl <= 14 && row.stage === 'ok') row.stage = 'soon';
      }
      return row;
    });
  };
  FL.STAGE = { ok: ['تمام', 'st-ok'], soon: ['قرّب', 'st-warn'], check: ['افحصه', 'st-warn'], due: ['لازم يتغير', 'st-danger'], unknown: ['مش متسجل', 'st-off'] };

  /** A typed odometer reading: '' when fine, otherwise the reason (the app asks before saving). */
  FL.odoProblem = function (lastOdo, lastDay, before, after, day) {
    const b = Number(before) || 0, a = Number(after) || 0, L = Number(lastOdo) || 0;
    if (b && a && a < b) return 'العداد بعد المشوار أقل من قبله';
    if (L && b && b < L) return `العداد ${b} أقل من آخر قراءة للعربية (${L})`;
    if (b && a && a - b > 1500) return `المشوار ${a - b} كيلو — رقم كبير جداً`;
    if (L && b && lastDay && day) {
      const days = Math.max(1, FL.daysBetween(lastDay, day) + 1);
      if (b - L > 1500 * days) return `العداد زاد ${b - L} كيلو من آخر قراءة — رقم مش منطقي`;
    }
    return '';
  };

  /* ---------- WhatsApp texts (same shape as the old program) ---------- */
  FL.ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر'];
  const hm12 = t => { if (!t || !/^\d{1,2}:\d{2}/.test(t)) return t || '-'; let [h, m] = t.split(':').map(Number); const per = h >= 12 ? 'مساءً' : 'صباحاً'; h = h % 12 || 12; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${per}`; };
  FL.hm12 = hm12;
  /** The driver's report of his trips to the car's group. */
  FL.tripMessage = function (carName, trips) {
    let msg = '*أمر شغل - Three Pyramids Travel*\n--------------------------\n';
    msg += `العربية: ${carName}\n--------------------------\n`;
    trips.forEach((t, i) => {
      msg += `${i > 0 ? '\n' : ''}\n*مشوار ${i + 1}*\n`;
      msg += `التاريخ: ${t.day || '-'} | وقت التحرك: *${t.time ? hm12(t.time) : '-'}*\n`;
      msg += `المأمورية: ${t.task || '-'}\n`;
      msg += `العداد قبل: ${t.before || '-'} | العداد بعد: ${t.after || '-'}\n`;
      msg += `المصروف: ${Number(t.expense) || 0} جنيه${t.expNote ? ' (' + t.expNote + ')' : ''}\n`;
    });
    msg += '\n--------------------------\nملحوظة: صور العدادات يتم إرسالها كمرفقات في نفس محادثة الجروب بعد اللصق';
    return msg;
  };
  /** Operations' schedule of a car's trips to its group. */
  FL.scheduleMessage = function (carName, items) {
    let msg = '*تعليمات مدير التشغيل - Three Pyramids Travel*\n--------------------------\n';
    msg += `العربية: ${carName}\n--------------------------\n`;
    items.forEach((m, i) => {
      if (i > 0) msg += '\n➖➖➖➖➖➖➖➖➖➖\n\n';
      msg += `\n*المشوار ${FL.ORD[i] || i + 1}*\n`;
      const f = [['المشوار', m.when], ['وقت الوصول', `*${m.time ? hm12(m.time) : '-'}*`], ['نوع المشوار', m.type], ['من', m.from || '-'], ['إلى', m.to || '-']];
      if (m.flight) f.push(['رقم الرحلة', `*${m.flight}*`]);
      if (m.terminal) f.push(['رقم الصالة', `*${m.terminal}*`]);
      f.push(['اسم العميل', m.client || '-'], ['رقم العميل', m.phone || '-'], ['اسم المصنع', m.factory || '-'], ['ملاحظات', m.notes ? `*${m.notes}*` : '-']);
      f.forEach((x, j) => { msg += `*${j + 1}.* ${x[0]}: ${x[1]}\n`; });
    });
    return msg + '\n--------------------------';
  };

  /** Document expiry: 'expired' | 'soon' (within `warnDays`) | 'ok' | 'none'. */
  FL.docStage = (day, today, warnDays) => { if (!day) return 'none'; const d = FL.daysBetween(today, day); return d < 0 ? 'expired' : d <= (warnDays || 30) ? 'soon' : 'ok'; };
  /** Net salary of a month document. */
  FL.salaryNet = s => { const sum = o => Object.values(o || {}).reduce((a, x) => a + (Number(x && x.amount) || 0), 0); const base = Number(s && s.base) || 0, ex = sum(s && s.extra), de = sum(s && s.ded); return { base, extra: Math.round(ex * 100) / 100, ded: Math.round(de * 100) / 100, net: Math.round((base + ex - de) * 100) / 100 }; };

  root.TPFleet = FL;
  if (root.TP) root.TP.fleet = FL;
})(typeof self !== 'undefined' ? self : globalThis);
