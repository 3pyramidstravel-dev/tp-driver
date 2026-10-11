/* ==========================================================================
   Excel (.xlsx) writer — no library, no internet needed.

   A styled sheet (company colours, right-to-left, frozen header, filters,
   number formats, totals row, print setup with page numbers):
     { name, title, subtitle, kpis: [[label, value], …],
       columns: [{ h: 'المبلغ', t: 'money'|'int'|'dec'|'pct'|'center'|'text', w: 14, sum: true }],
       rows: [[…], …], totals: true | [...], note: '…', plain: false }
   plain: true → the header is on row 1 (files another system imports).

   The old simple form still works: { name, rows: [[header…], [row…]] }.
   TP.xlsx.build(sheets) → Blob · TP.xlsx.download(fileName, sheets)
   ========================================================================== */
(function (TP) {
  'use strict';
  const enc = new TextEncoder();

  /* ---------- zip (stored, no compression) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    const parts = [], central = []; let offset = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    files.forEach(f => {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const head = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
      parts.push(head, name, data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += head.length + name.length + data.length;
    });
    const csize = central.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(offset), ...u16(0)]);
    return new Blob(parts.concat(central, [end]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------- styles: one list of cell formats, looked up by name ---------- */
  const C = { maroon: 'FF7A1F22', gold: 'FFC9973F', ink: 'FF2C1712', muted: 'FF6F5A4C', zebra: 'FFFBF6EC', total: 'FFF2E3C2', kpi: 'FFF8EFDD', line: 'FFE2D2B6', white: 'FFFFFFFF', good: 'FF2F6B3A', bad: 'FFA3262B' };
  const FONTS = [
    `<font><sz val="10"/><color rgb="${C.ink}"/><name val="Arial"/><family val="2"/></font>`,               // 0 body
    `<font><b/><sz val="10"/><color rgb="${C.white}"/><name val="Arial"/><family val="2"/></font>`,          // 1 header
    `<font><b/><sz val="16"/><color rgb="${C.maroon}"/><name val="Arial"/><family val="2"/></font>`,         // 2 title
    `<font><sz val="9"/><color rgb="${C.muted}"/><name val="Arial"/><family val="2"/></font>`,              // 3 subtitle / note
    `<font><b/><sz val="10"/><color rgb="${C.ink}"/><name val="Arial"/><family val="2"/></font>`,            // 4 totals
    `<font><b/><sz val="13"/><color rgb="${C.maroon}"/><name val="Arial"/><family val="2"/></font>`          // 5 kpi value
  ];
  const FILLS = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
    .concat([C.maroon, C.zebra, C.total, C.kpi].map(c => `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`));
  const FILL = { none: 0, maroon: 2, zebra: 3, total: 4, kpi: 5 };
  const side = (n, s, c) => s ? `<${n} style="${s}"><color rgb="${c}"/></${n}>` : `<${n}/>`;
  const box = (s, c, top) => `<border>${side('left', s, c)}${side('right', s, c)}${side('top', top ? top[0] : s, top ? top[1] : c)}${side('bottom', s, c)}<diagonal/></border>`;
  const BORDERS = ['<border><left/><right/><top/><bottom/><diagonal/></border>', box('thin', C.line), box('thin', C.line, ['medium', C.gold]), box('thin', 'FFD9C48F'),
    `<border><left/><right/><top/>${side('bottom', 'medium', C.gold)}<diagonal/></border>`];
  const BORDER = { none: 0, thin: 1, total: 2, kpi: 3, under: 4 };
  const NUMFMT = { text: 0, center: 0, int: 3, money: 4, dec: 164, pct: 10 };
  const XF = [], XF_IDX = {};
  function xf(key, font, fill, border, numFmt, h, wrap) {
    XF_IDX[key] = XF.length;
    XF.push(`<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"${numFmt ? ' applyNumberFormat="1"' : ''}><alignment horizontal="${h}" vertical="center"${wrap ? ' wrapText="1"' : ''} readingOrder="2"/></xf>`);
  }
  xf('default', 0, 0, 0, 0, 'general');
  xf('head', 1, FILL.maroon, BORDER.thin, 0, 'center', true);
  xf('title', 2, 0, BORDER.under, 0, 'right');
  xf('sub', 3, 0, 0, 0, 'right');
  xf('note', 3, 0, 0, 0, 'right', true);
  xf('kpiL', 3, FILL.kpi, BORDER.kpi, 0, 'center', true);
  xf('kpiV', 5, FILL.kpi, BORDER.kpi, 0, 'center');
  Object.keys(NUMFMT).forEach(t => {
    const h = t === 'text' ? 'right' : 'center';
    xf(t, 0, 0, BORDER.thin, NUMFMT[t], h, t === 'text');
    xf(t + 'Z', 0, FILL.zebra, BORDER.thin, NUMFMT[t], h, t === 'text');
    xf(t + 'T', 4, FILL.total, BORDER.total, NUMFMT[t], h, t === 'text');
  });
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>` +
    `<fonts count="${FONTS.length}">${FONTS.join('')}</fonts><fills count="${FILLS.length}">${FILLS.join('')}</fills><borders count="${BORDERS.length}">${BORDERS.join('')}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${XF.length}">${XF.join('')}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  /* ---------- sheets ---------- */
  const x = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const col = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const isNum = v => typeof v === 'number' && isFinite(v);
  const textLen = v => String(v ?? '').split('\n').reduce((a, l) => Math.max(a, l.length), 0);

  /** Old form ({ rows: [header, …] }) → styled form with types guessed from the values. */
  function normalize(sh) {
    if (sh.columns) return sh;
    const rows = sh.rows || [], head = rows[0] || [], body = rows.slice(1);
    const columns = head.map((h, i) => {
      const vals = body.map(r => r[i]).filter(v => v !== '' && v !== null && v !== undefined);
      const nums = vals.length && vals.every(isNum);
      const money = nums && /مبلغ|المبلغ|فاتورة|الضريبة|أجر|أجور|المصاريف|الربح|الكاش|جنيه|سعر|رصيد|إجمالي/.test(String(h));
      return { h, t: nums ? (money ? 'money' : (vals.every(v => Number.isInteger(v)) ? 'int' : 'dec')) : 'text', w: sh.widths ? sh.widths[i] : undefined };
    });
    return { name: sh.name, columns, rows: body, plain: sh.plain !== false };
  }

  function sheetXml(sh, idx) {
    const cols = sh.columns, n = Math.max(1, cols.length), rowsXml = [], merges = [];
    let r = 0;
    const rowOf = (cellsOf, ht) => { r++; rowsXml.push(`<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cellsOf()}</row>`); return r; };
    const cell = (ci, v, style, forceText) => {
      const ref = col(ci) + r, s = ` s="${XF_IDX[style] ?? 0}"`;
      if (v === null || v === undefined || v === '') return `<c r="${ref}"${s}/>`;
      if (isNum(v) && !forceText) return `<c r="${ref}"${s}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
    };
    const merged = (text, style, ht) => { r++; rowsXml.push(`<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cell(0, text, style, true)}${Array.from({ length: n - 1 }, (_, i) => cell(i + 1, '', style)).join('')}</row>`); if (n > 1) merges.push(`A${r}:${col(n - 1)}${r}`); return r; };

    if (!sh.plain) {
      merged(sh.title || sh.name || '', 'title', 30);
      if (sh.subtitle) merged(sh.subtitle, 'sub', 18);
      const k = (sh.kpis || []).filter(p => p && p[0]);
      if (k.length) {
        r++; rowsXml.push(`<row r="${r}" ht="6" customHeight="1"/>`);
        // each figure takes two columns when there is room for it
        const span = n >= k.length * 2 ? 2 : 1, per = Math.max(1, Math.floor(n / span));
        for (let i = 0; i < k.length; i += per) {
          const chunk = k.slice(i, i + per);
          [['kpiL', p => p[0], 30], ['kpiV', p => p[1], 24]].forEach(([st, get, ht]) => {
            r++;
            const cells = [];
            chunk.forEach((p, j) => { const c0 = j * span; cells.push(cell(c0, get(p), st, st === 'kpiL')); if (span === 2) { cells.push(cell(c0 + 1, '', st)); merges.push(`${col(c0)}${r}:${col(c0 + 1)}${r}`); } });
            rowsXml.push(`<row r="${r}" ht="${ht}" customHeight="1">${cells.join('')}</row>`);
          });
        }
      }
      r++; rowsXml.push(`<row r="${r}" ht="8" customHeight="1"/>`);
    }
    const headRow = rowOf(() => cols.map((c, i) => cell(i, c.h, 'head', true)).join(''), 32);
    const first = r + 1;
    (sh.rows || []).forEach((row, ri) => {
      const z = ri % 2 ? 'Z' : '';
      rowOf(() => cols.map((c, i) => cell(i, row[i], (c.t || 'text') + z)).join(''));
    });
    const last = r;
    let totals = sh.totals;
    if (totals === true) totals = cols.map((c, i) => i === 0 ? 'الإجمالي' : c.sum ? Math.round((sh.rows || []).reduce((a, row) => a + (isNum(row[i]) ? row[i] : 0), 0) * 100) / 100 : '');
    if (Array.isArray(totals) && (sh.rows || []).length) rowOf(() => cols.map((c, i) => cell(i, totals[i], (i === 0 ? 'text' : (c.t || 'text')) + 'T')).join(''), 22);
    if (sh.note) { r++; rowsXml.push(`<row r="${r}" ht="6" customHeight="1"/>`); merged(sh.note, 'note', 30); }

    // widths from the content (Arabic needs a little more room)
    const widths = cols.map((c, i) => c.w || Math.min(46, Math.max(9, Math.ceil(Math.max(textLen(c.h) * 0.9, ...(sh.rows || []).slice(0, 300).map(rw => textLen(isNum(rw[i]) ? rw[i].toLocaleString('en-US', { maximumFractionDigits: 2 }) : rw[i])))) * 1.15 + 3)));
    const filter = (sh.rows || []).length ? `<autoFilter ref="A${headRow}:${col(n - 1)}${Math.max(headRow, last)}"/>` : '';
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
      `<sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0"${idx === 0 ? ' tabSelected="1"' : ''}><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${first}" sqref="A${first}"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="18" customHeight="1"/>` +
      `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
      `<sheetData>${rowsXml.join('')}</sheetData>${filter}` +
      (merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') +
      `<printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.6" header="0.25" footer="0.3"/>` +
      `<pageSetup paperSize="9" orientation="${n > 7 ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>` +
      `<headerFooter><oddFooter>&amp;R${x('Three Pyramids Travel')}&amp;C&amp;P / &amp;N&amp;L&amp;D</oddFooter></headerFooter></worksheet>`;
    return { xml, headRow };
  }
  const safeName = (n, i, used) => { let s = String(n || 'Sheet' + (i + 1)).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet' + (i + 1); while (used.has(s)) s = s.slice(0, 28) + ' ' + i; used.add(s); return s; };

  TP.xlsx = {
    build(sheets) {
      const list = (sheets || []).map(normalize), used = new Set(), names = list.map((s, i) => safeName(s.name, i, used));
      const built = list.map((s, i) => sheetXml(s, i));
      const titles = built.map((b, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${x(names[i]).replace(/'/g, "''")}'!$${b.headRow}:$${b.headRow}</definedName>`).join('');
      const files = [
        { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
        { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
        { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${names.map((nm, i) => `<sheet name="${x(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${titles}</definedNames></workbook>` },
        { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
        { name: 'xl/styles.xml', data: STYLES }
      ].concat(built.map((b, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: b.xml })));
      return zip(files);
    },
    /** A factory's approved monthly sheet (Control Tower and factory portal) as a report definition. */
    sheetReport(sd, factoryName, monthName) {
      const fin = !!(sd && sd.finance), lines = sd.lines || [], ms = sd.missions || [], ab = sd.absences || [];
      const sum = (l, k) => l.reduce((a, r) => a + (Number(r[k]) || 0), 0);
      const kpis = [['أيام كاملة', sum(lines, 'full')], ['أنصاص أيام', sum(lines, 'half')], ['سهرات', sum(lines, 'ot')], ['مشاوير', ms.length], ['غياب', sum(ab, 'skip') + sum(ab, 'noshow')]];
      if (fin && sd.totals) kpis.push(['الإجمالي', TP.money(sd.totals.total)]);
      const sections = [
        { title: 'الخطوط', columns: [{ h: 'الخط', t: 'text' }, { h: 'أيام كاملة', t: 'int', sum: true }, { h: 'أنصاص أيام', t: 'int', sum: true }, { h: 'سهرات', t: 'int', sum: true }, { h: 'انتظار (دقيقة)', t: 'int', sum: true }].concat(fin ? [{ h: 'المبلغ (ج.م)', t: 'money', sum: true }] : []),
          rows: lines.map(l => [l.name, l.full, l.half, l.ot, l.wait].concat(fin ? [l.amount ?? ''] : [])), totals: true },
        { title: 'المشاوير', columns: [{ h: 'التاريخ', t: 'center' }, { h: 'المشوار', t: 'text' }, { h: 'النوع', t: 'center' }, { h: 'رقم الرحلة', t: 'center' }].concat(fin ? [{ h: 'المبلغ (ج.م)', t: 'money', sum: true }] : []),
          rows: ms.map(m => [m.day, m.title, m.type === 'airport' ? 'مطار' : 'مشوار', m.flight || ''].concat(fin ? [m.amount ?? ''] : [])), totals: fin },
        { title: 'غياب الموظفين', columns: [{ h: 'الموظف', t: 'text' }, { h: 'الخط', t: 'text' }, { h: 'اعتذر', t: 'int', sum: true }, { h: 'مجاش', t: 'int', sum: true }, { h: 'الأيام', t: 'text', w: 40 }],
          rows: ab.map(a => [a.name, a.line, a.skip, a.noshow, a.days]), totals: true }
      ];
      if (fin && sd.totals) sections.push({ title: 'الإجمالي', columns: [{ h: 'البند', t: 'text' }, { h: 'القيمة (ج.م)', t: 'money' }],
        rows: [['الخطوط', sd.totals.lines], ['المشاوير', sd.totals.missions], ['الإجمالي قبل الضريبة', sd.totals.total], [`الضريبة ${sd.totals.pct}%`, sd.totals.tax]] });
      return { title: 'كشف شهر ' + (monthName || ''), subtitle: factoryName || '', kpis, sections, fileName: `TP-${factoryName || 'factory'}-${monthName || ''}` };
    },
    /** Builds and downloads the file. */
    download(fileName, sheets) {
      const blob = TP.xlsx.build(sheets), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = String(fileName).replace(/[\\/:*?"<>|]+/g, '-') + (String(fileName).endsWith('.xlsx') ? '' : '.xlsx');
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return blob;
    }
  };
  /** Kept for old callers: the monthly sheet as plain sheets. */
  TP.xlsx.sheetRows = (sd, factoryName, month) => TP.report ? TP.report.sheets(TP.xlsx.sheetReport(sd, factoryName, month)) : [];
})(window.TP = window.TP || {});
