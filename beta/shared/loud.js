/* ==========================================================================
   The loud ring (ntfy) — agreed for every device.
   Each person gets a secret topic (ntfy/{personId}). The cloud alarm sends the urgent alerts
   (wake-up, the wake ladder, a new trip) to it at the highest priority; the free ntfy app rings
   like an alarm, even on silent. The normal notifications keep working as before.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const S = () => TP.session;
  const PLAY = 'https://play.google.com/store/apps/details?id=io.heckel.ntfy';
  const APPLE = 'https://apps.apple.com/app/ntfy/id1625396347';
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const okKey = () => 'tp-loud-ok-' + (S().person ? S().person.id : '');
  const laterKey = () => 'tp-loud-later-' + (S().person ? S().person.id : '');
  let topicCache = null;

  async function topic() {
    const pid = S().person && S().person.id;
    if (!pid) throw new Error('no-person');
    if (topicCache && topicCache.pid === pid) return topicCache.t;
    let d = await TP.fb.get('ntfy/' + pid).catch(() => null);
    if (!d || !d.topic) {
      const t = 'tp-' + TP.token(24);
      await TP.fb.set('ntfy/' + pid, { topic: t, at: TP.fb.ts() });
      d = { topic: t };
    }
    topicCache = { pid, t: d.topic };
    return d.topic;
  }

  TP.loud = {
    done: () => !!TP.store.get(okKey(), false),
    later: () => { TP.store.set(laterKey(), Date.now() + 864e5); document.dispatchEvent(new CustomEvent('tp:install')); },
    snoozed: () => (TP.store.get(laterKey(), 0) || 0) > Date.now(),
    /** the short bar that leads to the steps (hidden once done) */
    bar(opts) {
      const o = opts || {};
      if (!S().ready || TP.loud.done() || (o.dismiss !== false && TP.loud.snoozed())) return '';
      return `<div class="banner warn tp-loud"><span class="grow" style="flex:1">🔔 ${esc(o.text || 'خلّي التنبيهات المهمة ترن بصوت عالي زي المنبه — مرة واحدة')}</span><button type="button" class="btn btn-primary btn-sm" data-loud="go">إزاي؟</button>${o.dismiss !== false ? '<button type="button" class="btn btn-ghost btn-sm" data-loud="later">بعدين</button>' : ''}</div>`;
    },
    bind(root) { (root || document).querySelectorAll('[data-loud]').forEach(b => b.onclick = () => b.dataset.loud === 'later' ? TP.loud.later() : TP.loud.guide()); },
    async guide() {
      let t;
      try { t = await topic(); } catch (e) { return TP.toast('مقدرناش نجهز التنبيه — تأكد من النت وحاول تاني', 'warn'); }
      const sub = 'ntfy://ntfy.sh/' + t;
      TP.openModal('الرنة العالية للتنبيهات المهمة', `
        <ol class="modal-text" style="padding-inline-start:20px;line-height:2">
          <li>نزّل تطبيق <b>ntfy</b> المجاني: <a href="${isIos ? APPLE : PLAY}" target="_blank" rel="noopener"><b>${isIos ? 'App Store' : 'Google Play'}</b></a></li>
          <li>ارجع هنا ودوس <a class="btn btn-primary btn-sm" href="${esc(sub)}">اشترك في تنبيهاتي</a> ← في ntfy دوس <b>Subscribe</b>.<br>
            <span class="small muted">لو مفتحش: افتح ntfy ← دوس <b>+</b> ← اكتب الكود ده:</span> <bdi class="mono" dir="ltr"><b>${esc(t)}</b></bdi> <button type="button" class="link" id="lCopy">انسخ</button></li>
          ${isIos ? '' : '<li>في ntfy: ⋮ ← <b>Settings</b> ← شغّل <b>Keep alerting for highest priority</b> (يفضل يرن لحد ما تفتحه).</li>'}
          <li>دوس <button type="button" class="btn btn-ghost btn-sm" id="lTest">جرّب الرنة</button> — لازم الموبايل يرن بصوت عالي.</li>
        </ol>
        <p class="muted small">الكود ده سري وخاص بيك — متبعتهوش لحد. التنبيهات العادية بتفضل شغالة زي ما هي.</p>`, () => { TP.store.set(okKey(), true); TP.toast('تمام ✓ — التنبيهات المهمة هترن بصوت عالي'); document.dispatchEvent(new CustomEvent('tp:install')); },
      { saveLabel: 'عملتها ✓', cancelLabel: 'بعدين' });
      const c = TP.$('#lCopy'); if (c) c.onclick = () => TP.actions && TP.actions.copy ? TP.actions.copy(t) : navigator.clipboard && navigator.clipboard.writeText(t);
      const b = TP.$('#lTest');
      if (b) b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: t, title: 'Three Pyramids — تجربة', message: 'لو سامع الرنة دي يبقى كله تمام ✓', priority: 5, tags: ['bell'] }) });
          TP.toast(r.ok ? 'اتبعت — الموبايل المفروض يرن دلوقتي' : 'التجربة متبعتتش — حاول تاني', r.ok ? '' : 'warn');
        } catch (e) { TP.toast('مفيش نت — حاول تاني', 'warn'); }
        setTimeout(() => { b.disabled = false; }, 4000);
      };
    }
  };
})(window.TP = window.TP || {});
