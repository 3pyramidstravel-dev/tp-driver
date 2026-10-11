/* ==========================================================================
   Guests (foreign passengers) — ready WhatsApp messages in their language,
   and "ترجم وابعت" for anything else (the cloud alarm translates for free).
   Used by the Control Tower (trip links) and the driver app (his guests).
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP, I = () => TP.i18n;
  TP.WORKER_URL = TP.WORKER_URL || 'https://tp-alarm.3pyramidstravel.workers.dev';
  const first = n => String(n || '').trim().split(/\s+/)[0] || '';

  /** Arabic text → the guest's language (signed-in staff or drivers only). */
  TP.translate = async function (text, to) {
    const tok = await TP.fb.idToken().catch(() => null);
    if (!tok) throw new Error('not-signed-in');
    const r = await fetch(TP.WORKER_URL + '/translate', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ text: String(text).slice(0, 1200), from: 'ar', to }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.text) throw new Error(j.error || ('http ' + r.status));
    return j.text;
  };

  /**
   * The ready messages for one guest of a trip. m = the trip, c = the guest ({name, phone, lang}),
   * link = his page (staff only — the driver does not hold the link), drv = the driver (his English name goes to foreign guests) or a name.
   */
  function messages(m, c, link, drv) {
    const L = I().ok(c.lang) ? c.lang : 'ar',
      driver = drv && typeof drv === 'object' ? (L !== 'ar' && drv.nameEn ? drv.nameEn : drv.name || '') : drv || '', t = (k, v) => I().t(L, k, v), fl = m.flight || {};
    const arr = m.type === 'airport' && fl.dir === 'arr', term = fl.terminal ? t('termTag', { t: fl.terminal }) : '';
    const when = (() => {
      const ms = TP.ops.cairoMs(m.day, m.time || '00:00');
      return L === 'ar' ? `${TP.fmtDay(m.day + 'T12:00:00')} الساعة ${TP.ops.hm12(m.time || '')}` : `${I().fmtDay(L, ms)} — ${I().fmtTime(L, ms)}`;
    })();
    const out = [];
    if (link) out.push(arr
      ? { k: 'welcome', label: 'رسالة الترحيب', text: t('msgWelcome', { n: first(c.name), f: fl.no || '', d: driver || '', link }) }
      : { k: 'pickup', label: 'رسالة الميعاد', text: t('msgPickup', { n: first(c.name), d: driver || '', w: when, link }) });
    if (arr) out.push({ k: 'waiting', label: 'السواق مستنيك', text: t('msgWaiting', { d: driver || '', t: term }) });
    if (m.type === 'airport' && Number(fl.delayMin) >= 15) out.push({ k: 'delay', label: 'الطيارة متأخرة', text: t('msgDelay', { f: fl.no || '', d: driver || '' }) });
    return out;
  }

  /** One window: the ready messages + "ترجم وابعت", sent on WhatsApp to that guest. */
  function compose(m, c, link, driver) {
    const L0 = I().ok(c.lang) ? c.lang : 'ar';
    let L = L0;
    const draw = () => {
      const list = messages(m, Object.assign({}, c, { lang: L }), link, driver);
      const wa = text => TP.waLink(c.phone, text);
      TP.openModal('رسالة لـ ' + c.name, `
        <div class="chips" style="margin-bottom:10px">${I().LANGS.map(l => `<button type="button" class="chip ${l.id === L ? 'active' : ''}" data-gl="${l.id}">${esc(l.name)}</button>`).join('')}</div>
        ${list.map(x => `<div class="gm"><div class="gm-h"><b>${esc(x.label)}</b>${c.phone ? `<a class="btn btn-primary btn-sm" href="${esc(wa(x.text))}" target="_blank" rel="noopener">واتساب</a>` : ''}<button type="button" class="btn btn-ghost btn-sm" data-gcopy="${esc(x.k)}">انسخ</button></div><p class="gm-t" dir="${I().info(L).dir}">${esc(x.text)}</p></div>`).join('')}
        <div class="gm"><div class="gm-h"><b>ترجم وابعت</b><small class="muted">اكتب بالعربي، والرسالة تطلع بـ ${esc(I().info(L).name)}</small></div>
          <textarea class="input" id="gIn" rows="3" maxlength="1000" placeholder="مثال: السواق قدام البوابة رقم 2، العربية بيضا"></textarea>
          <div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" id="gGo" ${L === 'ar' ? 'disabled' : ''}>ترجم</button><span class="muted small" id="gSt"></span></div>
          <textarea class="input" id="gOut" rows="3" dir="${I().info(L).dir}" style="margin-top:8px" placeholder="الترجمة هتظهر هنا — تقدر تعدّل فيها"></textarea>
          <div style="display:flex;gap:8px;margin-top:8px">${c.phone ? '<button type="button" class="btn btn-primary btn-sm" id="gSend">ابعت واتساب</button>' : ''}<button type="button" class="btn btn-ghost btn-sm" id="gCopy">انسخ</button></div></div>
        ${c.phone ? '' : '<p class="muted small">الضيف ده مالوش موبايل متسجل — انسخ الرسالة وابعتها.</p>'}`, null, { noSave: true, wide: true, noFocus: true });
      TP.$$('#tp-modal [data-gl]').forEach(b => b.onclick = () => { L = b.dataset.gl; draw(); });
      TP.$$('#tp-modal [data-gcopy]').forEach(b => b.onclick = () => { const x = list.find(y => y.k === b.dataset.gcopy); copy(x.text); });
      const go = TP.$('#gGo'), out = TP.$('#gOut'), stEl = TP.$('#gSt');
      go.onclick = async () => {
        const txt = TP.$('#gIn').value.trim(); if (!txt) return TP.toast('اكتب الرسالة بالعربي');
        go.disabled = true; stEl.textContent = 'بيترجم…';
        try { out.value = await TP.translate(txt, L); stEl.textContent = 'اتترجمت ✓ — راجعها قبل ما تبعت'; }
        catch (e) { console.warn(e); stEl.textContent = 'الترجمة مش متاحة دلوقتي — اكتبها بإيدك أو استخدم ترجمة الكيبورد'; }
        finally { go.disabled = false; }
      };
      const send = TP.$('#gSend'); if (send) send.onclick = () => { const v = out.value.trim() || TP.$('#gIn').value.trim(); if (!v) return TP.toast('اكتب الرسالة'); window.open(wa(v), '_blank'); };
      TP.$('#gCopy').onclick = () => copy(out.value.trim() || TP.$('#gIn').value.trim());
    };
    draw();
  }
  function copy(text) {
    if (!text) return;
    (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => TP.toast('اتنسخ ✓')).catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); TP.toast('اتنسخ ✓'); } catch (e) { /* ignore */ } ta.remove(); });
  }
  TP.guest = { messages, compose };
})(window.TP = window.TP || {});
