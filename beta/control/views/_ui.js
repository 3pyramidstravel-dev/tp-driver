/* ==========================================================================
   Control Tower — small UI helpers shared by the views
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  TP.views = TP.views || {};
  TP.actions = TP.actions || {};

  TP.ui = {
    initial: n => esc((String(n || '?').trim()[0]) || '?'),
    who(name, sub, off) {
      return `<div class="who"><span class="av ${off ? 'off' : ''}">${TP.ui.initial(name)}</span><div><b>${esc(name || '—')}</b>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
    },
    empty: t => `<div class="empty">${esc(t)}</div>`,
    /**
     * A time the way people say it: hour 1–12, minutes, and صباحًا / مساءً as two big buttons (the chosen one coloured).
     * The value lives in a hidden input with the same id ("HH:MM", 24 h), so the forms read it as before.
     */
    timeField(id, value) {
      const ok = /^\d{2}:\d{2}$/.test(value || ''), h24 = ok ? Number(value.slice(0, 2)) : null, mi = ok ? Number(value.slice(3)) : null;
      const h12 = h24 === null ? '' : (h24 % 12 || 12), ap = h24 === null ? '' : h24 >= 12 ? 'pm' : 'am';
      return `<div class="tpick" data-tpick="${esc(id)}"><input type="hidden" id="${esc(id)}" value="${ok ? esc(value) : ''}">
        <div class="tp-hm"><select class="input" data-tp="h" aria-label="الساعة"><option value="">الساعة</option>${[...Array(12)].map((_, i) => `<option value="${i + 1}" ${h12 === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>
        <b>:</b><select class="input" data-tp="m" aria-label="الدقايق"><option value="">دقيقة</option>${[...Array(60)].map((_, i) => `<option value="${i}" ${mi === i ? 'selected' : ''}>${String(i).padStart(2, '0')}</option>`).join('')}</select></div>
        <div class="tp-ap"><button type="button" data-ap="am" class="${ap === 'am' ? 'on' : ''}">صباحًا</button><button type="button" data-ap="pm" class="${ap === 'pm' ? 'on' : ''}">مساءً</button></div></div>`;
    },
    bindTime(root) {
      (root || document).querySelectorAll('[data-tpick]').forEach(w => {
        const hid = w.querySelector('input[type=hidden]'), H = w.querySelector('[data-tp=h]'), M = w.querySelector('[data-tp=m]');
        const sync = () => {
          const ap = (w.querySelector('[data-ap].on') || {}).dataset;
          if (H.value && !M.value) M.value = '0';
          if (!H.value || !ap) { hid.value = ''; w.classList.toggle('need-ap', !!H.value && !ap); return; }
          w.classList.remove('need-ap');
          const h = Number(H.value) % 12 + (ap.ap === 'pm' ? 12 : 0);
          hid.value = String(h).padStart(2, '0') + ':' + String(Number(M.value)).padStart(2, '0');
        };
        H.onchange = sync; M.onchange = sync;
        w.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => { w.querySelectorAll('[data-ap]').forEach(x => x.classList.toggle('on', x === b)); sync(); });
      });
    },
    /** A time typed but without صباحًا / مساءً (the form says so instead of losing it). */
    timeIncomplete: id => { const w = document.querySelector(`[data-tpick="${id}"]`); return !!(w && w.querySelector('[data-tp=h]').value && !w.querySelector('[data-ap].on')); },
    /** Sets a time field ("HH:MM") — also used by the tests. */
    setTime(id, v) {
      const w = document.querySelector(`[data-tpick="${id}"]`); if (!w) return;
      const ok = /^\d{2}:\d{2}$/.test(v || ''), h = ok ? Number(v.slice(0, 2)) : null;
      w.querySelector('[data-tp=h]').value = ok ? String(h % 12 || 12) : '';
      w.querySelector('[data-tp=m]').value = ok ? String(Number(v.slice(3))) : '';
      w.querySelectorAll('[data-ap]').forEach(x => x.classList.toggle('on', ok && x.dataset.ap === (h >= 12 ? 'pm' : 'am')));
      w.querySelector('input[type=hidden]').value = ok ? v : '';
    },
    /** (the أستاذ / أستاذة picker was dropped — every message greets "أهلاً يا فندم") */
    sexSel: () => '',
    opts(list, selected, valueOf, labelOf, placeholder) {
      return (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '') +
        list.map(x => { const v = valueOf(x); return `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(labelOf(x))}</option>`; }).join('');
    },
    /** Status chip for a document expiry date ('YYYY-MM-DD'). */
    expiry(day) {
      if (!day) return '<span class="st st-off">غير مسجل</span>';
      const d = TP.daysUntil(day), warn = (TP.D.settings.expiryWarnDays || 30);
      if (d < 0) return `<span class="st st-danger">منتهي من ${-d} يوم</span>`;
      if (d <= warn) return `<span class="st st-warn">ينتهي بعد ${d} يوم</span>`;
      return `<span class="st st-ok"><bdi dir="ltr">${esc(day)}</bdi></span>`;
    },
    val: id => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; },
    checked: id => { const el = document.getElementById(id); return !!(el && el.checked); },
    /** Reads a money field: '' → null, otherwise a non-negative number or NaN. */
    money(id) {
      const raw = TP.ui.val(id);
      if (raw === '') return null;
      const n = TP.num(raw);
      return n >= 0 ? TP.round2(n) : NaN;
    },
    mapLink(loc, label) {
      const u = TP.mapsUrl(loc);
      return u ? `<a class="link" href="${esc(u)}" target="_blank" rel="noopener">${TP.icon('pin', 16)}${esc(label || 'افتح في الخرائط')}</a>` : '<span class="muted small">بدون لوكيشن</span>';
    },
    locText: loc => loc ? (loc.url || (isFinite(loc.lat) ? `${loc.lat}, ${loc.lng}` : '')) : '',
    filterBox(id, placeholder, value) {
      return `<label class="search">${TP.icon('search', 18)}<input id="${id}" type="search" placeholder="${esc(placeholder)}" value="${esc(value || '')}" autocomplete="off"></label>`;
    },
    norm: s => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim()
  };

  /** Simple search state per view (survives re-renders). */
  TP.ui.filters = {};
  TP.ui.bindFilter = function (root, id, key) {
    const el = root.querySelector('#' + id);
    if (el) el.addEventListener('input', () => { TP.ui.filters[key] = el.value; TP.rerender(); });
  };
})(window.TP = window.TP || {});
