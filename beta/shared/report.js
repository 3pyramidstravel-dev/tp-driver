/* ==========================================================================
   Reports — one definition, two outputs:
     PDF   : a print page in the company's style (logo band, key figures,
             coloured tables, totals, page numbers) → "حفظ كـ PDF"
     Excel : the same sections as styled sheets (TP.xlsx)
   def = { title, subtitle, period, by, kpis: [[label, value, tone]], meta: [[label, value]],
           sections: [{ title, columns: [{ h, t, w, sum }], rows, totals, note }], note, fileName }
   t: 'text' | 'center' | 'int' | 'dec' | 'money' | 'pct'
   TP.report.choose(def) asks "PDF ولا Excel؟" — TP.report.pdf(def) / TP.report.excel(def) directly.
   ========================================================================== */
(function (TP) {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNum = v => typeof v === 'number' && isFinite(v);
  const fmt = (v, t) => {
    if (v === null || v === undefined || v === '') return '';
    if (!isNum(v)) return String(v);
    if (t === 'money') return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (t === 'dec') return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (t === 'pct') return (v * 100).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };
  const now = () => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date());
  const totalsOf = s => {
    if (Array.isArray(s.totals)) return s.totals;
    if (s.totals !== true || !(s.rows || []).length) return null;
    return s.columns.map((c, i) => i === 0 ? 'الإجمالي' : c.sum ? Math.round(s.rows.reduce((a, r) => a + (isNum(r[i]) ? r[i] : 0), 0) * 100) / 100 : '');
  };
  const byName = () => (TP.session && TP.session.person && TP.session.person.name) || '';

  /** The definition as Excel sheets (one per section; the key figures on the first). */
  function sheets(def) {
    const sub = [def.subtitle, def.period, 'اتعمل ' + now() + (def.by || byName() ? ' — ' + (def.by || byName()) : '')].filter(Boolean).join(' · ');
    const secs = (def.sections || []).filter(s => s && s.columns);
    return secs.map((s, i) => ({
      name: s.sheet || s.title || def.title, title: secs.length > 1 ? `${def.title} — ${s.title}` : def.title, subtitle: sub,
      kpis: i === 0 ? (def.kpis || []).map(k => [k[0], k[1]]) : null, columns: s.columns, rows: s.rows || [], totals: totalsOf(s),
      note: [s.note, i === secs.length - 1 ? def.note : ''].filter(Boolean).join('\n'), plain: !!def.plain
    }));
  }
  function excel(def) {
    TP.xlsx.download(def.fileName || def.title || 'report', sheets(def));
    if (TP.audit && def.audit !== false) TP.audit('report.excel', def.title || '', def.period || '');
  }

  /* ---------- PDF (print) ---------- */
  const CSS = `
  #tp-print{display:none}
  @media print{
    body.tp-printing>*:not(#tp-print){display:none!important}
    body.tp-printing{background:#fff!important;margin:0!important;padding:0!important}
    body.tp-printing #tp-print{display:block!important}
  }
  #tp-print{font-family:Cairo,'Segoe UI',Tahoma,Arial,sans-serif;color:#2c1712;direction:rtl;font-size:10.5pt;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  #tp-print *{box-sizing:border-box}
  #tp-print .rp-head{display:flex;align-items:center;gap:16px;background:linear-gradient(135deg,#7a1f22,#3b0d0f);color:#fff;border-radius:10px;padding:14px 18px;margin-bottom:12px}
  #tp-print .rp-logo{background:#fbf6ec;border-radius:8px;padding:6px 10px;flex:none}
  #tp-print .rp-logo img{height:44px;display:block}
  #tp-print .rp-brand{font-size:8pt;letter-spacing:3px;color:#f2d48e;font-weight:700;direction:ltr;text-align:right}
  #tp-print h1{margin:2px 0 0;font-size:17pt;font-weight:900;line-height:1.3}
  #tp-print .rp-sub{color:#f3dfc0;font-size:10pt}
  #tp-print .rp-meta{margin-right:auto;text-align:left;font-size:8.5pt;color:#f3dfc0;line-height:1.6}
  #tp-print .rp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:0 0 12px}
  #tp-print .rp-kpi{border:1px solid #e2d2b6;border-radius:9px;padding:8px 10px;background:#fbf6ec;border-top:3px solid #7a1f22;break-inside:avoid}
  #tp-print .rp-kpi.good{border-top-color:#2f6b3a}#tp-print .rp-kpi.bad{border-top-color:#a3262b}#tp-print .rp-kpi.gold{border-top-color:#c9973f}
  #tp-print .rp-kpi span{display:block;font-size:8.5pt;color:#6f5a4c}
  #tp-print .rp-kpi b{display:block;font-size:14pt;font-weight:900;color:#5c1619;font-variant-numeric:tabular-nums}
  #tp-print .rp-meta-row{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0 0 10px;font-size:9.5pt}
  #tp-print .rp-meta-row b{color:#5c1619}
  #tp-print .rp-sec{margin:0 0 14px}
  #tp-print h2{font-size:12.5pt;font-weight:900;color:#5c1619;margin:0 0 6px;padding-bottom:3px;border-bottom:2px solid #f2d48e;break-after:avoid}
  #tp-print table{width:100%;border-collapse:collapse;font-size:9.5pt}
  #tp-print thead{display:table-header-group}
  #tp-print tr{break-inside:avoid}
  #tp-print th{background:#3b0d0f;color:#f6e6c8;font-weight:800;padding:6px 7px;text-align:center;border:1px solid #3b0d0f;line-height:1.35}
  #tp-print td{padding:5px 7px;border:1px solid #e9dcc4;vertical-align:top;text-align:right}
  #tp-print td.n{text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap}
  #tp-print tbody tr:nth-child(even) td{background:#fcf8f1}
  #tp-print tfoot{display:table-row-group}
  #tp-print tfoot td{background:#f2e3c2;font-weight:900;border-top:2px solid #c9973f}
  #tp-print .rp-empty{padding:10px;color:#6f5a4c;border:1px dashed #e2d2b6;border-radius:8px;text-align:center}
  #tp-print .rp-note{font-size:8.5pt;color:#6f5a4c;margin:5px 0 0;white-space:pre-line}
  #tp-print .rp-foot{margin-top:14px;padding-top:6px;border-top:1px solid #e2d2b6;display:flex;justify-content:space-between;font-size:8pt;color:#8a7262}
  `;
  function ensureCss() { if (!document.getElementById('tp-print-css')) { const s = document.createElement('style'); s.id = 'tp-print-css'; s.textContent = CSS; document.head.appendChild(s); } }
  function tableHtml(s) {
    const cols = s.columns || [], rows = s.rows || [];
    if (!rows.length) return '<div class="rp-empty">مفيش بيانات في الفترة دي</div>';
    const tot = totalsOf(s), cls = c => (c.t && c.t !== 'text') ? ' class="n"' : '';
    return `<table><thead><tr>${cols.map(c => `<th>${esc(c.h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${cols.map((c, i) => `<td${cls(c)}>${esc(fmt(r[i], c.t))}</td>`).join('')}</tr>`).join('')}</tbody>
      ${tot ? `<tfoot><tr>${cols.map((c, i) => `<td${i ? cls(c) : ''}>${esc(fmt(tot[i], c.t))}</td>`).join('')}</tr></tfoot>` : ''}</table>`;
  }
  function html(def) {
    const logo = TP.siteUrl ? TP.siteUrl('shared/logo.png') : '../shared/logo.png';
    return `<header class="rp-head"><div class="rp-logo"><img src="${esc(logo)}" alt="Three Pyramids Travel"></div>
        <div><div class="rp-brand">THREE PYRAMIDS TRAVEL</div><h1>${esc(def.title)}</h1><div class="rp-sub">${esc([def.subtitle, def.period].filter(Boolean).join(' · '))}</div></div>
        <div class="rp-meta">${esc(now())}${def.by || byName() ? '<br>' + esc(def.by || byName()) : ''}</div></header>
      ${(def.meta || []).length ? `<div class="rp-meta-row">${def.meta.map(m => `<span>${esc(m[0])}: <b>${esc(m[1])}</b></span>`).join('')}</div>` : ''}
      ${(def.kpis || []).length ? `<div class="rp-kpis">${def.kpis.map(k => `<div class="rp-kpi ${esc(k[2] || '')}"><span>${esc(k[0])}</span><b>${esc(isNum(k[1]) ? fmt(k[1], 'int') : k[1])}</b></div>`).join('')}</div>` : ''}
      ${(def.sections || []).filter(s => s && s.columns).map(s => `<section class="rp-sec">${(def.sections.length > 1 || s.title !== def.title) && s.title ? `<h2>${esc(s.title)}</h2>` : ''}${tableHtml(s)}${s.note ? `<p class="rp-note">${esc(s.note)}</p>` : ''}</section>`).join('')}
      ${def.note ? `<p class="rp-note">${esc(def.note)}</p>` : ''}
      <footer class="rp-foot"><span>Three Pyramids Travel — للاستخدام الداخلي</span><span>${esc(def.title)}</span></footer>`;
  }
  function pdf(def) {
    ensureCss();
    let root = document.getElementById('tp-print');
    if (!root) { root = document.createElement('div'); root.id = 'tp-print'; document.body.appendChild(root); }
    root.innerHTML = html(def);
    const wide = (def.sections || []).some(s => (s.columns || []).length > 7) || def.orientation === 'landscape';
    let page = document.getElementById('tp-print-page');
    if (!page) { page = document.createElement('style'); page.id = 'tp-print-page'; document.head.appendChild(page); }
    page.textContent = `@media print{@page{size:A4 ${wide ? 'landscape' : 'portrait'};margin:11mm 10mm 14mm;@bottom-center{content:"صفحة " counter(page) " من " counter(pages);font-family:Cairo,Arial,sans-serif;font-size:8pt;color:#8a7262}}}`;
    const title = document.title;
    document.title = (def.fileName || def.title || 'report').replace(/[\\/:*?"<>|]+/g, '-');
    const done = () => { document.body.classList.remove('tp-printing'); document.title = title; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    document.body.classList.add('tp-printing');
    const img = root.querySelector('img');
    const go = () => { setTimeout(() => { try { window.print(); } catch (e) { done(); } setTimeout(() => { if (!window.matchMedia || !window.matchMedia('print').matches) done(); }, 2000); }, 60); };
    if (img && !img.complete) { img.onload = img.onerror = go; setTimeout(() => { if (img.onload) { img.onload = null; go(); } }, 2500); } else go();
    if (TP.audit && def.audit !== false) TP.audit('report.pdf', def.title || '', def.period || '');
  }

  /** "PDF ولا Excel؟" */
  function choose(def) {
    if (!TP.openModal) return pdf(def);
    TP.openModal('تنزيل التقرير', `<p class="modal-text" style="margin-bottom:12px"><b>${esc(def.title)}</b>${def.period || def.subtitle ? `<br><span class="muted small">${esc([def.subtitle, def.period].filter(Boolean).join(' · '))}</span>` : ''}</p>
      <div class="rep-choice">
        <button type="button" class="rep-opt" data-rep="pdf"><span class="rep-ic pdf">PDF</span><b>PDF</b><small>للطباعة أو الإرسال — من شاشة الطباعة اختار "حفظ كـ PDF"</small></button>
        <button type="button" class="rep-opt" data-rep="xlsx"><span class="rep-ic xls">XLS</span><b>Excel</b><small>جدول تقدر تعدّل فيه وتحسب</small></button>
      </div>`, null, { noSave: true, noFocus: true });
    document.querySelectorAll('#tp-modal [data-rep]').forEach(b => b.onclick = () => { const k = b.dataset.rep; TP.closeModal(); setTimeout(() => (k === 'pdf' ? pdf : excel)(def), 50); });
  }

  TP.report = { sheets, excel, pdf, choose, fmt };
})(window.TP = window.TP || {});
