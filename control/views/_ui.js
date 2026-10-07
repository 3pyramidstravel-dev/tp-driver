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
