/* ==========================================================================
   Permissions catalogue & ready-made roles
   The keys are what firestore.rules checks. Labels are what the GM sees.
   ========================================================================== */
(function (TP) {
  'use strict';

  TP.PERMS = [
    { group: 'الإدارة العليا', items: [
      { key: 'staff.manage', label: 'إدارة الموظفين والصلاحيات', note: 'أعلى صلاحية بعد المدير العام', top: true },
      { key: 'devices.manage', label: 'تفعيل الأجهزة وإزالتها' },
      { key: 'settings.edit', label: 'تعديل إعدادات النظام' },
      { key: 'audit.view', label: 'عرض سجل العمليات' }
    ] },
    { group: 'التشغيل', items: [
      { key: 'tracking.view', label: 'متابعة السواقين والخريطة ومين متصل' },
      { key: 'wake.supervise', label: 'متابعة الصحيان (جرس المشرف)' },
      { key: 'missions.manage', label: 'إنشاء المهام والمشاوير وتعيينها' },
      { key: 'factories.manage', label: 'إدارة المصانع' },
      { key: 'lines.manage', label: 'إدارة الخطوط والنقط والعملاء' },
      { key: 'drivers.manage', label: 'إدارة السواقين' },
      { key: 'vehicles.manage', label: 'إدارة العربيات والرخص' },
      { key: 'times.correct', label: 'تسجيل وتصحيح أوقات السواقين والبديل (بسبب)' }
    ] },
    { group: 'المطار', items: [
      { key: 'airport.manage', label: 'مأموريات المطار ومتابعة الرحلات' },
      { key: 'airport.prices', label: 'أسعار المطار والسواق الخارجي' }
    ] },
    { group: 'المالية', items: [
      { key: 'prices.view', label: 'عرض الأسعار', money: true },
      { key: 'prices.edit', label: 'تعديل الأسعار', money: true },
      { key: 'overtime.approve', label: 'اعتماد السهرة وتعديلها', money: true },
      { key: 'advances.manage', label: 'السلف والخصومات', money: true },
      { key: 'month.close', label: 'قفل الشهر', money: true },
      { key: 'reports.finance', label: 'التقارير المالية والأرباح', money: true }
    ] },
    { group: 'التقارير', items: [
      { key: 'reports.attendance', label: 'شيت حضور العربيات (بدون أسعار)' }
    ] }
  ];
  TP.PERM_KEYS = TP.PERMS.flatMap(g => g.items.map(i => i.key));
  TP.permLabel = k => (TP.PERMS.flatMap(g => g.items).find(i => i.key === k) || {}).label || k;
  /** Any permission that shows money → that person must also enter a PIN. */
  TP.MONEY_PERMS = TP.PERMS.flatMap(g => g.items).filter(i => i.money).map(i => i.key);

  TP.ROLES = [
    { id: 'gm', name: 'المدير العام', perms: ['all'] },
    { id: 'finance', name: 'المدير المالي', perms: ['prices.view', 'prices.edit', 'overtime.approve', 'advances.manage', 'month.close', 'reports.finance', 'reports.attendance', 'audit.view', 'tracking.view'] },
    { id: 'airports', name: 'مدير المطارات', perms: ['airport.manage', 'airport.prices', 'missions.manage', 'tracking.view', 'drivers.manage'] },
    { id: 'operations', name: 'مدير التشغيل', perms: ['tracking.view', 'wake.supervise', 'missions.manage', 'lines.manage', 'drivers.manage', 'vehicles.manage', 'times.correct', 'reports.attendance'] },
    { id: 'supervisor', name: 'مشرف الحركة', perms: ['tracking.view', 'wake.supervise', 'times.correct', 'reports.attendance'] },
    { id: 'custom', name: 'مخصص', perms: [] }
  ];

  TP.DRIVER_KINDS = [
    { id: 'line', name: 'سواق خط ثابت', note: 'يشوف أجره بس' },
    { id: 'tourism', name: 'سواق سياحة', note: 'ممنوع يشوف أي أسعار أو تقارير' },
    { id: 'external', name: 'سواق مشاوير', note: 'مشاوير واحتياطي للخطوط — يشوف سعره بس' }
  ];
  TP.driverKindName = id => (TP.DRIVER_KINDS.find(k => k.id === id) || {}).name || '—';
  /** "101 · محمد علي" — every driver has a fixed code that never changes or repeats. */
  TP.driverLabel = p => !p ? '—' : (p.code ? p.code + ' · ' : '') + (p.name || '');

  /** Does a permission list grant p? */
  TP.has = (perms, p) => Array.isArray(perms) && (perms.includes('all') || perms.includes(p));
  /** Same list as isSensitive() in firestore.rules: only the GM can approve such a device. */
  TP.SENSITIVE = ['all', 'staff.manage', 'devices.manage', 'prices.view', 'prices.edit', 'overtime.approve', 'advances.manage', 'month.close', 'reports.finance', 'airport.prices'];
  TP.isSensitive = perms => Array.isArray(perms) && perms.some(p => TP.SENSITIVE.includes(p));
  TP.needsPin = perms => Array.isArray(perms) && (perms.includes('all') || perms.some(p => TP.MONEY_PERMS.includes(p)));
  /** Who sees the working day (same list as staffDays() in firestore.rules). */
  TP.staffSeesDays = perms => ['tracking.view', 'times.correct', 'wake.supervise', 'reports.attendance', 'reports.finance', 'prices.view', 'overtime.approve', 'month.close'].some(p => TP.has(perms, p));
  /** Granting staff.manage needs devices.manage too (deactivation touches devices). */
  TP.normalizePerms = function (list) {
    let out = Array.from(new Set((list || []).filter(p => p === 'all' || TP.PERM_KEYS.includes(p))));
    if (out.includes('all')) return ['all'];
    if (out.includes('staff.manage') && !out.includes('devices.manage')) out.push('devices.manage');
    if (out.includes('prices.edit') && !out.includes('prices.view')) out.push('prices.view');
    return out.sort();
  };
})(window.TP = window.TP || {});
