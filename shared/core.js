/* ==========================================================================
   Three Pyramids Driver Platform — shared core
   DOM helpers · escaping · toast · modal · Cairo time · hashing · icons
   Loaded by every app (Control Tower, Factory Portal, Driver app).
   ========================================================================== */
(function (TP) {
  'use strict';

  TP.VERSION = '1.0.0-phase1';
  TP.TZ = 'Africa/Cairo';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  TP.$ = $; TP.$$ = $$; TP.esc = esc;

  /* ---------- safe local storage ---------- */
  TP.store = {
    get(k, f, s) { try { const v = (s ? sessionStorage : localStorage).getItem(k); return v === null ? f : JSON.parse(v); } catch (e) { return f; } },
    set(k, v, s) { try { (s ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); } catch (e) { /* blocked */ } },
    del(k, s) { try { (s ? sessionStorage : localStorage).removeItem(k); } catch (e) { /* blocked */ } }
  };

  /* ---------- ids ---------- */
  TP.newId = function (prefix) {
    const a = new Uint8Array(8);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.random() * 256; });
    return (prefix ? prefix + '-' : '') + Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  };
  /** Random 3-digit activation code (100–999). */
  TP.newCode = function () {
    const a = new Uint16Array(1);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else a[0] = Math.random() * 65535;
    return String(100 + (a[0] % 900));
  };

  /* ---------- Cairo time (Egypt switches summer/winter time; never hard-code offsets) ---------- */
  const fmtCache = {};
  function fmt(opts) {
    const key = JSON.stringify(opts);
    if (!fmtCache[key]) fmtCache[key] = new Intl.DateTimeFormat('ar-EG-u-nu-latn', Object.assign({ timeZone: TP.TZ }, opts));
    return fmtCache[key];
  }
  const toDate = v => (v && typeof v.toDate === 'function') ? v.toDate() : (v instanceof Date ? v : (v ? new Date(v) : null));
  TP.toDate = toDate;
  TP.fmtTime = v => { const d = toDate(v); return d ? fmt({ hour: '2-digit', minute: '2-digit', hour12: true }).format(d) : '—'; };
  TP.fmtDate = v => { const d = toDate(v); return d ? fmt({ day: 'numeric', month: 'long', year: 'numeric' }).format(d) : '—'; };
  TP.fmtDateTime = v => { const d = toDate(v); return d ? fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).format(d) : '—'; };
  TP.fmtDay = v => { const d = toDate(v); return d ? fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(d) : '—'; };
  /** 'YYYY-MM-DD' of a moment, in Cairo time. */
  TP.dayKey = v => {
    const d = toDate(v) || new Date();
    return new Intl.DateTimeFormat('en-CA', { timeZone: TP.TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  };
  TP.ago = v => {
    const d = toDate(v); if (!d) return 'لم يظهر بعد';
    const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (s < 60) return 'الآن';
    if (s < 3600) return `منذ ${Math.round(s / 60)} د`;
    if (s < 86400) return `منذ ${Math.round(s / 3600)} س`;
    return TP.fmtDate(d);
  };
  TP.daysUntil = dayStr => {
    if (!dayStr) return null;
    const a = new Date(TP.dayKey() + 'T00:00:00Z'), b = new Date(dayStr + 'T00:00:00Z');
    return Math.round((b - a) / 86400000);
  };

  /* ---------- money ---------- */
  TP.money = n => (n === null || n === undefined || n === '' || isNaN(n)) ? '—'
    : Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' ج.م';
  TP.num = v => { const n = Number(String(v ?? '').replace(/[٠-٩]/g, d => d.charCodeAt(0) - 1632).replace(/[,\s]/g, '')); return isFinite(n) ? n : NaN; };

  /* Arabic-Indic digits typed on Arabic keyboards → Latin */
  TP.latinDigits = s => String(s ?? '').replace(/[٠-٩]/g, d => d.charCodeAt(0) - 1632).replace(/[۰-۹]/g, d => d.charCodeAt(0) - 1776);

  /* ---------- SHA-256 (WebCrypto with pure-JS fallback for old WebViews / file://) ---------- */
  function sha256Fallback(ascii) {
    const rr = (v, a) => (v >>> a) | (v << (32 - a)); const max = 2 ** 32;
    let result = ''; const words = []; const bitLen = ascii.length * 8; const hash = [], k = []; let pc = 0; const comp = {};
    for (let c = 2; pc < 64; c++) { if (!comp[c]) { for (let i = 0; i < 313; i += c) comp[i] = c; hash[pc] = (c ** 0.5 * max) | 0; k[pc++] = (c ** (1 / 3) * max) | 0; } }
    ascii += '\x80'; while (ascii.length % 64 - 56) ascii += '\x00';
    for (let i = 0; i < ascii.length; i++) words[i >> 2] |= ascii.charCodeAt(i) << ((3 - i) % 4) * 8;
    words[words.length] = (bitLen / max) | 0; words[words.length] = bitLen;
    let H = hash.slice(0, 8);
    for (let j = 0; j < words.length;) {
      const w = words.slice(j, j += 16); const old = H; H = H.slice(0, 8);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2], a = H[0], e = H[4];
        const t1 = H[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & H[5]) ^ (~e & H[6])) + k[i] +
          (w[i] = i < 16 ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        const t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & H[1]) ^ (a & H[2]) ^ (H[1] & H[2]));
        H = [(t1 + t2) | 0].concat(H); H[4] = (H[4] + t1) | 0; H.length = 8;
      }
      for (let i = 0; i < 8; i++) H[i] = (H[i] + old[i]) | 0;
    }
    for (let i = 0; i < 8; i++) for (let j = 3; j + 1; j--) { const b = (H[i] >> (j * 8)) & 255; result += (b < 16 ? '0' : '') + b.toString(16); }
    return result;
  }
  TP.sha256 = async function (text) {
    try {
      if (window.crypto && crypto.subtle && window.isSecureContext) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
        return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { /* fall back */ }
    return sha256Fallback(unescape(encodeURIComponent(String(text))));
  };
  /** PIN hash is salted with the person id, so equal PINs never share a hash. */
  TP.pinHash = (personId, pin) => TP.sha256('tp-pin:' + personId + ':' + TP.latinDigits(pin).trim());

  /* ---------- toast ---------- */
  let toastTimer;
  TP.toast = function (msg, kind) {
    let t = $('#tp-toast');
    if (!t) { t = document.createElement('div'); t.id = 'tp-toast'; t.className = 'tp-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.className = 'tp-toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  };

  /* ---------- modal: onSave returns false to stay open ---------- */
  let modalSave = null, modalCancel = null;
  function ensureModal() {
    let m = $('#tp-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'tp-modal'; m.className = 'tp-overlay'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="tp-modal-card"><h3 id="tp-modal-title"></h3><div id="tp-modal-body"></div>
      <div class="tp-modal-actions"><button type="button" class="btn btn-primary" id="tp-modal-save"></button>
      <button type="button" class="btn btn-ghost" id="tp-modal-cancel">إلغاء</button></div></div>`;
    document.body.appendChild(m);
    $('#tp-modal-save').addEventListener('click', runSave);
    $('#tp-modal-cancel').addEventListener('click', () => TP.closeModal(true));
    m.addEventListener('click', e => { if (e.target === m) TP.closeModal(true); });
    document.addEventListener('keydown', e => {
      if (!m.classList.contains('show')) return;
      if (e.key === 'Escape') TP.closeModal(true);
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); runSave(); }
    });
    return m;
  }
  async function runSave() {
    const btn = $('#tp-modal-save');
    if (!modalSave) return TP.closeModal();
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const keep = (await modalSave()) === false;
      if (!keep) TP.closeModal();
    } catch (e) { console.error(e); TP.toast(TP.errorText(e), 'warn'); }
    finally { btn.disabled = false; }
  }
  TP.openModal = function (title, bodyHtml, onSave, opts) {
    opts = opts || {};
    const m = ensureModal();
    $('#tp-modal-title').textContent = title;
    $('#tp-modal-body').innerHTML = bodyHtml;
    const save = $('#tp-modal-save');
    save.textContent = opts.saveLabel || 'حفظ';
    save.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    save.hidden = !!opts.noSave;
    $('#tp-modal-cancel').textContent = opts.cancelLabel || (opts.noSave ? 'إغلاق' : 'إلغاء');
    m.querySelector('.tp-modal-card').classList.toggle('wide', !!opts.wide);
    modalSave = onSave; modalCancel = opts.onCancel || null;
    m.dataset.seq = String((Number(m.dataset.seq) || 0) + 1);   // lets timers know the modal was replaced
    m.classList.add('show');
    TP.hydrateIcons(m);
    const first = $('#tp-modal-body input:not([type=hidden]):not([readonly]), #tp-modal-body select, #tp-modal-body textarea');
    if (first && !opts.noFocus) setTimeout(() => first.focus(), 50);
  };
  TP.closeModal = function (cancelled) {
    const m = $('#tp-modal'); if (!m) return;
    m.classList.remove('show');
    const c = modalCancel; modalSave = null; modalCancel = null;
    if (cancelled && c) c();
  };
  TP.confirm = (title, message, okLabel, danger) => new Promise(res => {
    TP.openModal(title, `<p class="modal-text">${esc(message)}</p>`, () => { res(true); }, { saveLabel: okLabel || 'تأكيد', danger, onCancel: () => res(false), noFocus: true });
  });

  /* ---------- friendly errors ---------- */
  TP.errorText = function (e) {
    const c = (e && (e.code || e.message)) || '';
    if (/permission-denied|PERMISSION_DENIED|insufficient permissions/i.test(c)) return 'مالكش صلاحية للعملية دي';
    if (/unavailable|network|offline|Failed to fetch/i.test(c)) return 'مفيش اتصال بالإنترنت — حاول تاني';
    if (/resource-exhausted|quota/i.test(c)) return 'تم الوصول للحد اليومي المجاني — راجع الإدارة';
    if (/timeout/i.test(c)) return 'الشبكة بطيئة — حاول تاني';
    return 'حصلت مشكلة — حاول تاني';
  };

  /* ---------- icons (stroke SVG, currentColor) ---------- */
  const P = {
    home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.2a5 5 0 0 1 6 4.8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    factory: '<path d="M3 21V10l6 4V10l6 4V6l6 3v12H3Z"/><path d="M7 17h2M12 17h2M17 17h1"/>',
    route: '<circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="5" r="2.2"/><path d="M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7"/>',
    car: '<path d="M5 17h14M6 17l1.5-6h9L18 17M8 11l1.5-4h5L16 11"/><circle cx="8" cy="19" r="1.6"/><circle cx="16" cy="19" r="1.6"/>',
    steering: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M3.5 10.5 9.6 11.5M20.5 10.5l-6.1 1M12 14.5V21"/>',
    money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9.5v5M18 9.5v5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    device: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18h2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M18 5l2 2"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 9v4l2.5 2M5 4 2.5 6.5M19 4l2.5 2.5"/>',
    plane: '<path d="M10.5 21 12 17l1.5 4M12 17V9M3 13l9-4 9 4M12 9V4.5a1.5 1.5 0 0 0-3 0"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
    logout: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    warn: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h0"/>',
    star: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7L12 3Z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    arrow: '<path d="M19 12H5M11 6l-6 6 6 6"/>', back: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>'
  };
  TP.icon = function (name, size) {
    const s = size || 20, dir = (name === 'arrow' || name === 'back') ? ' ic-dir' : '';
    return `<svg class="ic${dir}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.star}</svg>`;
  };
  TP.hydrateIcons = function (root) {
    (root || document).querySelectorAll('i[data-icon]').forEach(el => { el.outerHTML = TP.icon(el.dataset.icon, Number(el.dataset.size) || 20); });
  };

  /** Google Maps link from {lat,lng} or a pasted URL. */
  TP.mapsUrl = loc => {
    if (!loc) return '';
    if (loc.url && /^https?:\/\//i.test(loc.url)) return loc.url;
    if (isFinite(loc.lat) && isFinite(loc.lng)) return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
    return '';
  };
  /** Accepts a Google Maps link or "lat,lng" text and returns {lat,lng,url}. */
  TP.parseLocation = function (text) {
    const t = TP.latinDigits(text || '').trim();
    if (!t) return null;
    const m = t.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/) || t.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) || t.match(/[?&](?:q|query|ll)=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
    const out = {};
    if (/^https?:\/\//i.test(t)) out.url = t.slice(0, 600);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { out.lat = lat; out.lng = lng; }
    }
    return (out.url || isFinite(out.lat)) ? out : null;
  };
})(window.TP = window.TP || {});
