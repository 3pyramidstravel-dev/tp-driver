/* ==========================================================================
   Installing the app on the device (home-screen icon) + asking the browser to keep our data.
   An installed app keeps its sign-in far better than a tab: a phone that wipes Chrome's
   site data signs the user out (a new device number) and stops the wake-up alarms.
   ========================================================================== */
(function (TP) {
  'use strict';
  let deferred = null;
  const ua = navigator.userAgent || '';
  const isIos = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = () => {
    try { return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true; } catch (e) { return false; }
  };
  const changed = () => document.dispatchEvent(new CustomEvent('tp:install'));

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; changed(); });
  window.addEventListener('appinstalled', () => { deferred = null; try { TP.store.set('tp-installed', true); } catch (e) { /* */ } changed(); });

  /** ask once per load that the browser does not clear our storage (granted silently for installed apps) */
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {}); } catch (e) { /* */ }

  const KEY = 'tp-install-later';
  TP.install = {
    installed,
    /** 'installed' | 'ready' (the browser's own button can open) | 'ios' | 'manual' */
    state: () => installed() ? 'installed' : deferred ? 'ready' : isIos ? 'ios' : 'manual',
    later: () => { try { TP.store.set(KEY, Date.now() + 3 * 864e5); } catch (e) { /* */ } changed(); },
    snoozed: () => { try { return (TP.store.get(KEY, 0) || 0) > Date.now(); } catch (e) { return false; } },
    async prompt() {
      if (deferred) {
        const d = deferred; deferred = null;
        d.prompt();
        const r = await d.userChoice.catch(() => ({}));
        changed();
        return r && r.outcome === 'accepted';
      }
      TP.openModal('تثبيت البرنامج', isIos
        ? `<ol class="modal-text" style="padding-inline-start:20px;line-height:2"><li>افتح الصفحة دي من <b>Safari</b></li><li>دوس زرار <b>المشاركة</b> ⬆ تحت</li><li>اختار <b>إضافة إلى الشاشة الرئيسية</b></li><li>دوس <b>إضافة</b> — وافتح البرنامج بعد كده من الأيقونة</li></ol>`
        : `<ol class="modal-text" style="padding-inline-start:20px;line-height:2"><li>افتح الصفحة دي من <b>Chrome</b></li><li>دوس <b>⋮</b> فوق</li><li>اختار <b>تثبيت التطبيق</b> (أو <b>إضافة إلى الشاشة الرئيسية</b> ← <b>تثبيت</b>)</li><li>افتح البرنامج بعد كده من الأيقونة — من غير علامة Chrome عليها</li></ol>
           <p class="muted small">لو عندك اختصار قديم عليه علامة Chrome صغيرة، امسحه.</p>`, null, { noSave: true });
      return false;
    },
    /** the bar at the top: "ثبّت البرنامج…" — dismissable bars come back after 3 days */
    bar(opts) {
      const o = opts || {};
      if (installed() || (o.dismiss !== false && TP.install.snoozed())) return '';
      const msg = o.text || 'ثبّت البرنامج على الجهاز ده علشان ميخرجش منك';
      return `<div class="banner warn tp-inst"><span class="grow" style="flex:1">📲 ${msg}</span><button type="button" class="btn btn-primary btn-sm" data-inst="go">تثبيت</button>${o.dismiss !== false ? '<button type="button" class="btn btn-ghost btn-sm" data-inst="later">مش دلوقتي</button>' : ''}</div>`;
    },
    bind(root) {
      (root || document).querySelectorAll('[data-inst]').forEach(b => b.onclick = () => b.dataset.inst === 'later' ? TP.install.later() : TP.install.prompt());
    }
  };
})(window.TP = window.TP || {});
