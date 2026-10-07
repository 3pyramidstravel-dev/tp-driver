/* ==========================================================================
   Audit trail — who did what, when (append-only)
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const D = TP.D, U = TP.ui;

  const ACTIONS = {
    'activation.code': 'كود تفعيل', 'device.approve': 'موافقة على جهاز', 'device.reject': 'رفض جهاز', 'device.remove': 'إزالة جهاز',
    'person.create': 'إضافة حساب', 'person.update': 'تعديل حساب', 'person.delete': 'حذف حساب', 'pin.reset': 'إعادة رقم سري', 'pin.change': 'تغيير رقم سري',
    'driver.create': 'إضافة سواق', 'driver.update': 'تعديل سواق', 'driver.delete': 'حذف سواق',
    'factory.create': 'إضافة مصنع', 'factory.update': 'تعديل مصنع', 'factory.delete': 'حذف مصنع',
    'line.create': 'إضافة خط', 'line.update': 'تعديل خط', 'line.delete': 'حذف خط',
    'vehicle.create': 'إضافة عربية', 'vehicle.update': 'تعديل عربية', 'vehicle.delete': 'حذف عربية',
    'price.factoryRates': 'سعر مصنع', 'price.driverRates': 'أجر سواق', 'price.airportRates': 'سعر مطار',
    'settings.update': 'تعديل الإعدادات'
  };

  TP.views.audit = {
    deps: ['audit'],
    render(root) {
      const q = U.norm(U.filters.audit || '');
      const list = D.audit.filter(a => !q || U.norm(a.name).includes(q) || U.norm(a.target).includes(q) || U.norm(ACTIONS[a.action] || a.action).includes(q) || U.norm(a.details).includes(q));
      root.innerHTML = `<section class="card">
        <div class="toolbar"><span class="muted">آخر 300 عملية. السجل ده محدش يقدر يعدّله أو يمسحه.</span>${U.filterBox('auditQ', 'بحث بالاسم أو العملية', U.filters.audit)}</div>
        ${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>الوقت</th><th>مين</th><th>العملية</th><th>على</th><th>تفاصيل</th></tr></thead>
        <tbody>${list.map(a => `<tr><td class="small">${esc(TP.fmtDateTime(a.at))}</td><td>${esc(a.name)}</td><td><span class="tag">${esc(ACTIONS[a.action] || a.action)}</span></td><td>${esc(a.target)}</td><td class="small muted" style="max-width:420px">${esc(a.details)}</td></tr>`).join('')}</tbody></table></div>` : U.empty('مفيش عمليات')}
      </section>`;
      U.bindFilter(root, 'auditQ', 'audit');
    }
  };
})(window.TP = window.TP || {});
