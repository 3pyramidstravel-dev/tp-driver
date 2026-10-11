/* ==========================================================================
   My account — PIN change, this device, lock
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, U = TP.ui;

  TP.views.account = {
    deps: [],
    render(root) {
      const p = S.person || {}, needs = TP.needsPin(S.perms);
      const role = (TP.ROLES.find(r => r.id === p.role) || {}).name || 'موظف';
      root.innerHTML = `
        ${needs && p.pinIsDefault ? `<div class="banner warn">${TP.icon('warn')}<span class="grow">رقمك السري لسه 1234. غيّره دلوقتي عشان حسابك فيه أسعار.</span></div>` : ''}
        <div class="split">
          <section class="card">
            <div class="card-head"><h3>بياناتي</h3></div>
            ${U.who(p.name, esc(role))}
            <div style="margin-top:14px" class="chips">${S.can('all') ? '<span class="tag gold">كل الصلاحيات</span>' : S.perms.map(k => `<span class="tag">${esc(TP.permLabel(k))}</span>`).join('')}</div>
            <p class="muted small" style="margin-top:14px">رقم الجهاز ده: <b class="mono">${esc(String(S.uid).slice(-6).toUpperCase())}</b> — الجهاز بيفضل داخل لحد ما الإدارة تشيله.</p>
            ${needs ? '<button class="btn btn-ghost" id="lockNow" style="margin-top:12px">' + TP.icon('lock', 18) + 'قفل الشاشة (يطلب الرقم السري تاني)</button>' : ''}
          </section>
          <section class="card">
            <div class="card-head"><h3>تغيير الرقم السري</h3></div>
            ${needs ? `<form id="pinForm" class="form-grid">
              <label class="fld full">الرقم الحالي<input class="input" id="pOld" type="password" inputmode="numeric" autocomplete="current-password"></label>
              <label class="fld">الجديد <small>4 أرقام أو أكتر</small><input class="input" id="pNew" type="password" inputmode="numeric" autocomplete="new-password"></label>
              <label class="fld">تأكيد الجديد<input class="input" id="pNew2" type="password" inputmode="numeric" autocomplete="new-password"></label>
              <button class="btn btn-primary full" type="submit">حفظ الرقم السري</button></form>`
              : '<p class="muted">حسابك مش محتاج رقم سري لأنه مفيهوش أسعار.</p>'}
          </section>
        </div>`;
      const f = root.querySelector('#pinForm');
      if (f) f.onsubmit = async e => {
        e.preventDefault();
        const n1 = TP.latinDigits(U.val('pNew')), n2 = TP.latinDigits(U.val('pNew2'));
        if (!/^\d{4,12}$/.test(n1)) return TP.toast('الرقم السري لازم يكون 4 أرقام أو أكتر');
        if (n1 !== n2) return TP.toast('التأكيد مش مطابق');
        if (n1 === '1234') return TP.toast('اختار رقم غير 1234');
        try {
          await S.changeOwnPin(U.val('pOld'), n1);
          TP.audit('pin.change', p.name);
          TP.toast('تم تغيير الرقم السري ✓');
          f.reset();
        } catch (err) { TP.toast(err.message === 'old-pin' ? 'الرقم الحالي غلط' : TP.errorText(err), 'warn'); }
      };
      const l = root.querySelector('#lockNow');
      if (l) l.onclick = () => { TP.store.del('tp-unlocked-' + S.uid, true); location.reload(); };
    }
  };
})(window.TP = window.TP || {});
