/* ==========================================================================
   جروبات واتساب المصانع (agreed 18 Oct): name + factory (or "جهة تانية / عميل فرد") + link.
   The dispatcher picks one on a trip; the driver gets a button with its name in every message window.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = TP.session, D = TP.D, U = TP.ui;
  const LINK = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/;
  const OTHER = '_other';

  /** the list, kept for the page and the trip editor (read when needed — a few documents) */
  TP.waGroups = {
    list: null, loading: null,
    load(force) {
      if (force) this.loading = null;
      if (!this.loading) this.loading = TP.fb.list('waGroups').then(l => { this.list = l.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar')); return this.list; }).catch(e => { this.loading = null; throw e; });
      return this.loading;
    },
    /** the groups of one factory ('' = جهة تانية / عميل فرد) */
    of(factoryId) { return (this.list || []).filter(g => (g.factoryId || OTHER) === (factoryId || OTHER)); },
    factoryName: id => id && id !== OTHER ? ((TP.q.company(id) || {}).name || '—') : 'جهة تانية / عميل فرد'
  };

  function edit(id) {
    const g = id ? (TP.waGroups.list || []).find(x => x.id === id) : { name: '', factoryId: '', link: '' };
    if (!g) return;
    TP.openModal(id ? 'تعديل جروب' : 'جروب واتساب جديد', `
      <div class="form-grid">
        <label class="fld full">اسم الجروب <small>زي ما هو في الواتساب</small><input class="input" id="wgName" maxlength="60" value="${esc(g.name)}" placeholder="مثال: Transportation Alpla"></label>
        <label class="fld full">المصنع<select class="input" id="wgFactory">${U.opts(D.companies, g.factoryId === OTHER ? '' : g.factoryId, c => c.id, c => c.name, 'جهة تانية / عميل فرد')}</select></label>
        <label class="fld full">لينك الجروب <small>من الواتساب: معلومات الجروب ← دعوة عبر رابط ← نسخ الرابط</small><input class="input" id="wgLink" dir="ltr" maxlength="120" value="${esc(g.link)}" placeholder="https://chat.whatsapp.com/…"></label>
      </div>`, async () => {
      const name = U.val('wgName').trim().slice(0, 60), link = U.val('wgLink').trim(), factoryId = U.val('wgFactory') || OTHER;
      if (!name) { TP.toast('اكتب اسم الجروب'); return false; }
      if (!LINK.test(link)) { TP.toast('اللينك لازم يبدأ بـ https://chat.whatsapp.com/'); return false; }
      const data = { name, factoryId, link: link.slice(0, 120), at: TP.fb.ts(), by: S.person.name };
      await TP.fb.set('waGroups/' + (id || TP.newId('G')), data);
      TP.audit(id ? 'wagroup.update' : 'wagroup.create', name, TP.waGroups.factoryName(factoryId));
      await TP.waGroups.load(true).catch(() => {});
      TP.toast('اتحفظ ✓'); TP.rerender();
    }, { saveLabel: 'حفظ' });
  }
  async function remove(id) {
    const g = (TP.waGroups.list || []).find(x => x.id === id); if (!g) return;
    if (!(await TP.confirm('حذف الجروب', `"${g.name}" هيتشال من القايمة. المشاوير اللي اتعملت بيه قبل كده بتفضل شايلة اللينك.`, 'حذف', true))) return;
    await TP.fb.remove('waGroups/' + id);
    TP.audit('wagroup.delete', g.name, TP.waGroups.factoryName(g.factoryId));
    await TP.waGroups.load(true).catch(() => {});
    TP.rerender();
  }

  TP.views.groups = {
    deps: ['companies'],
    render(root) {
      const list = TP.waGroups.list;
      if (!list) { root.innerHTML = '<div class="spinner"></div>'; TP.waGroups.load().then(() => TP.rerender()).catch(e => TP.toast(TP.errorText(e), 'warn')); return; }
      root.innerHTML = `<section class="card"><div class="card-head"><h3>جروبات واتساب المصانع</h3><button class="btn btn-primary btn-sm" id="wgAdd">${TP.icon('plus', 16)}إضافة جروب</button></div>
        <p class="muted small" style="margin-bottom:10px">الجروب اللي تختاره في المشوار بيظهر للسواق زرار باسمه في كل رسالة (اتحركت، وصلت، اتحركنا، وصلت الوجهة، نهاية المهمة).</p>
        ${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>اسم الجروب</th><th>المصنع</th><th>اللينك</th><th></th></tr></thead><tbody>${list.map(g => `<tr>
          <td><b>${esc(g.name)}</b></td><td>${esc(TP.waGroups.factoryName(g.factoryId))}</td>
          <td class="small" dir="ltr"><a href="${esc(g.link)}" target="_blank" rel="noopener">${esc(g.link.replace('https://', ''))}</a></td>
          <td class="acts"><button class="icon-btn" title="تعديل" data-wged="${esc(g.id)}">${TP.icon('edit', 16)}</button><button class="icon-btn danger" title="حذف" data-wgrm="${esc(g.id)}">${TP.icon('trash', 16)}</button></td></tr>`).join('')}</tbody></table></div>` : U.empty('مفيش جروبات لسه — دوس "إضافة جروب"')}</section>`;
      root.querySelector('#wgAdd').onclick = () => edit(null);
      root.querySelectorAll('[data-wged]').forEach(b => b.onclick = () => edit(b.dataset.wged));
      root.querySelectorAll('[data-wgrm]').forEach(b => b.onclick = () => remove(b.dataset.wgrm).catch(e => TP.toast(TP.errorText(e), 'warn')));
    }
  };
})(window.TP = window.TP || {});
