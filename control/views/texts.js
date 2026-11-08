/* ==========================================================================
   تعديل التطبيق — the chairman edits the wording of every message and text
   the app sends or shows (guests, line riders, groups, the guest's page).
   Saved in apptexts/main ({ over: { key: { ar, en, … } }, log: [...] }).
   The code never changes: each page reads the edit first and falls back to
   the original wording if it is empty, missing or malformed.
   Only the chairman (role "chairman") sees the page; the rules enforce it.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const U = TP.ui;
  const I = () => TP.i18n;
  const PATH = 'apptexts/main', LOG_MAX = 60;

  /* ---------- what each text is, in plain words — grouped the way the work runs ---------- */
  const GROUPS = [
    { id: 'drv', name: 'رسايل السواق للضيف', hint: 'اللي السواق بيبعتها للضيف ولجروب المشوار في كل خطوة', keys: {
      msgOnWay: 'السواق اتحرك وفي الطريق', msgArrived: 'السواق وصل ومستني', msgWaiting: 'السواق مستني في صالة الوصول (المطار)',
      msgDepart: 'اتحركنا — رحلة سعيدة', msgDropped: 'الضيف وصل وجهته', msgDroppedMany: 'الضيوف وصلوا وجهتهم (أكتر من واحد)',
      msgDone: 'المهمة خلصت — شكراً', msgDelay: 'الطيارة متأخرة والسواق عارف', carTag: 'سطر العربية جوه الرسالة', termTag: 'رقم الصالة جوه الرسالة' } },
    { id: 'vip', name: 'رسالة الـ VIP (إنجليزي)', hint: 'رسالة السواق الفخمة لضيوف المشاوير والمطار', keys: {
      vipHead: 'رأس الرسالة (اسم الشركة)', vipOnWay: 'السواق في الطريق', vipArrived: 'السواق وصل ومستني', vipClose: 'سطر الختام' } },
    { id: 'voice', name: '🔊 الرسايل الصوتية للسواق', hint: 'الموبايل بينادي السواق باسمه بصوت عالي — اختار الصوت والطابع، ودوس "اسمع" تجرب', keys: {
      vNew: 'مشوار جديد (بتتكرر لحد ما يستلم)', vSoon: 'فاضل ربع ساعة على المشوار', vAccepted: 'بعد ما يستلم المشوار', vDone: 'بعد ما يخلّص المشوار', vMorning: 'صباح الخير (بعد ما يصحى)' } },
    { id: 'line', name: 'الخطوط الثابتة', hint: 'رسايل ركاب المصانع وجروبات الخطوط', keys: {
      lineInvite: 'لينك تسجيل ركاب الخط (للجروب)', lineOnWay: 'السواق في الطريق لراكب الخط', lineArrived: 'السواق وصل لراكب الخط' } },
    { id: 'mgmt', name: 'رسايل الإدارة للضيف', hint: 'الترحيب وبيانات المشوار من موبايل الإدارة', keys: {
      msgWelcome: 'رسالة الترحيب', msgPickup: 'رسالة ميعاد الاستلام', hello: 'التحية في صفحة الضيف', emergencyMsg: 'رسالة الطوارئ اللي الضيف بيبعتها', flightTag: 'رقم الطيارة جوه رسالة الطوارئ' } },
    { id: 'page', name: 'صفحة الضيف وإشعاراته', hint: 'كل الكلام اللي بيظهر للضيف على صفحة متابعة العربية', keys: null }
  ];
  const VARS = { n: 'اسم الضيف', d: 'اسم السواق', c: 'العربية', t: 'الصالة', f: 'رقم الطيارة', p: 'المكان', w: 'الوجهة', link: 'لينك المتابعة',
    line: 'اسم الخط', url: 'لينك التسجيل', where: 'مكان الضيف', id: 'كود السواق', at: 'مكان الوصول' };
  const SAMPLE = { n: 'John', d: 'Mahmoud', c: '', t: ' (Terminal 3)', f: 'MS 986', p: 'Cairo Marriott', w: 'Cairo Marriott', link: 'https://…', line: 'خط CTOR الصبح',
    url: 'https://…', where: 'البوابة 2', id: ' (ID 12)', at: ' at Terminal 3' };
  const VOICE_NAME = 'محمود';   // the name heard when the chairman presses "اسمع"

  const st = { loaded: false, doc: null, q: '', grp: 'drv', busy: false };
  const isChair = () => ((TP.session && TP.session.person) || {}).role === 'chairman';
  const defs = () => I().defaults();
  const groupOf = k => (GROUPS.find(g => g.keys && g.keys[k]) || GROUPS[GROUPS.length - 1]);
  const labelOf = k => { const g = groupOf(k); return (g.keys && g.keys[k]) || k; };
  const langsOf = row => row.length === 1 ? [I().LANGS[0]] : I().LANGS;   // a one-language text has one box
  const varsIn = s => Array.from(new Set((String(s).match(/\{(\w+)\}/g) || []).map(x => x.slice(1, -1))));
  const own = (k, l) => { const o = ((st.doc || {}).over || {})[k]; return o && typeof o[l] === 'string' && o[l].trim() ? o[l] : ''; };
  const edited = k => { const o = ((st.doc || {}).over || {})[k]; return !!o && Object.keys(o).some(l => own(k, l)); };
  // {d} → a small tag "اسم السواق" in the list, so every message reads plainly
  const vl = (k, v) => /^v[A-Z]/.test(k) && v === 'n' ? 'اسم السواق' : VARS[v];   // in the spoken texts {n} is the driver
  const pv = (s, k) => TP.waPreview(s).replace(/\{(\w+)\}/g, (m, v) => vl(k, v) ? `<span class="tag">${vl(k, v)}</span>` : m);
  const fill = (s, v) => Object.keys(v).reduce((a, x) => a.split('{' + x + '}').join(v[x]), s);

  async function load() {
    try { st.doc = (await TP.fb.get(PATH)) || { over: {}, log: [] }; }
    catch (e) { console.warn(e); st.doc = { over: {}, log: [] }; TP.toast('مقدرتش أجيب التعديلات — جرّب تاني', 'warn'); }
    st.loaded = true;
  }

  /** Saves one change on the latest copy (someone else may have saved meanwhile). */
  async function saveOne(k, l, text, note) {
    if (st.busy) return false; st.busy = true;
    try {
      const cur = (await TP.fb.get(PATH)) || { over: {}, log: [] };
      const over = Object.assign({}, cur.over || {}), was = (over[k] && over[k][l]) || '';
      const row = Object.assign({}, over[k] || {});
      if (text) row[l] = text; else delete row[l];
      if (Object.keys(row).length) over[k] = row; else delete over[k];
      const p = TP.session.person || {};
      const log = [{ k, l, was, now: text, at: Date.now(), by: p.name || '', note: note || '' }].concat(Array.isArray(cur.log) ? cur.log : []).slice(0, LOG_MAX);
      const data = { over, log, by: TP.fb.user().uid, byName: p.name || '', at: TP.fb.ts() };
      if (cur.voice) data.voice = cur.voice;
      await TP.fb.set(PATH, data);
      st.doc = Object.assign({}, cur, { over, log });
      I().setOver(over); window.dispatchEvent(new Event('tp-texts'));
      TP.audit('texts.update', labelOf(k), (text ? 'تعديل' : 'رجوع للأصل') + ' — ' + l);
      return true;
    } catch (e) {
      console.error(e);
      TP.toast(/permission/i.test(e.code || e.message || '') ? 'الحفظ مرفوض — الصلاحية دي لرئيس مجلس الإدارة بس' : 'مقدرتش أحفظ — اتأكد من النت وجرّب تاني', 'warn');
      return false;
    } finally { st.busy = false; }
  }

  const VDEF = { on: true, gender: 'f', style: 'hype' };
  const vcfg = () => Object.assign({}, VDEF, (st.doc || {}).voice || {});
  async function saveVoice(v) {
    if (st.busy) return; st.busy = true;
    try {
      const cur = (await TP.fb.get(PATH)) || { over: {}, log: [] };
      const p = TP.session.person || {};
      await TP.fb.set(PATH, Object.assign({}, cur, { over: cur.over || {}, log: cur.log || [], voice: v, by: TP.fb.user().uid, byName: p.name || '', at: TP.fb.ts() }));
      st.doc = Object.assign({}, cur, { voice: v }); TP.appTexts = Object.assign({}, TP.appTexts || {}, { voice: v });
      TP.audit('texts.update', 'الصوت', (v.on ? 'شغال' : 'مقفول') + ' — ' + (v.gender === 'm' ? 'رجالي' : 'حريمي') + ' — ' + v.style);
      TP.toast('اتحفظ ✓ — كل السواقين هيسمعوا الصوت ده');
    } catch (e) { console.error(e); TP.toast('مقدرتش أحفظ — جرّب تاني', 'warn'); }
    finally { st.busy = false; render(); }
  }
  const hear = (text, v) => { if (!TP.voice || !TP.voice.available()) return TP.toast('المتصفح ده مش بيدعم الصوت — جرّب من Chrome', 'warn'); TP.voice.speak(fill(text, { n: VOICE_NAME }), { force: true, cfg: v || vcfg() }); };
  function voicePanel() {
    const v = vcfg(), arN = TP.voice ? TP.voice.voices().length : 0;
    const opt = (name, val, label) => `<button type="button" class="chip ${v[name] === val ? 'active' : ''}" data-vset="${name}" data-vval="${val}">${label}</button>`;
    return `<div class="gm"><div class="gm-h"><b>إعدادات الصوت</b><label class="check"><input type="checkbox" id="vOn" ${v.on ? 'checked' : ''}><span>الصوت شغال</span></label></div>
      <p class="muted small" style="margin:6px 0">الصوت</p><div class="chips">${opt('gender', 'f', '👩 حريمي')}${opt('gender', 'm', '👨 رجالي')}</div>
      <p class="muted small" style="margin:10px 0 6px">الطابع</p><div class="chips">${opt('style', 'hype', '🔥 حماسي')}${opt('style', 'calm', '😌 هادي وواثق')}${opt('style', 'formal', '🎩 رسمي')}</div>
      <div class="btn-row" style="margin-top:12px;gap:8px"><button type="button" class="btn btn-gold btn-sm" id="vHear">🔊 اسمع</button></div>
      <p class="muted small" style="margin-top:8px">الصوت بييجي من موبايل كل سواق، فممكن يختلف شوية من موبايل للتاني بس بنفس الطابع. السواق لازم يكون صوت الوسائط في موبايله عالي.${arN ? '' : ' (الجهاز ده مفيهوش صوت عربي — جرّب "اسمع" من موبايلك)'}</p></div>`;
  }

  /* ---------- the edit window: one text, all its languages, live preview ---------- */
  function openEdit(k) {
    const row = defs()[k]; if (!row) return;
    const langs = langsOf(row), vars = varsIn(row.join(' '));
    let L = langs[0].id;
    const orig = l => row[Math.max(0, I().LANGS.findIndex(x => x.id === l))] || row[0];
    const draw = () => {
      const cur = own(k, L) || orig(L), info = I().info(L), dir = row.length === 1 ? (/[؀-ۿ]/.test(orig(L)) ? 'rtl' : 'ltr') : info.dir;
      TP.openModal('تعديل الرسالة — ' + labelOf(k), `
        ${langs.length > 1 ? `<div class="chips" style="margin-bottom:10px">${langs.map(x => `<button type="button" class="chip ${x.id === L ? 'active' : ''}" data-tl="${x.id}">${esc(x.name)}${own(k, x.id) ? ' ✎' : ''}</button>`).join('')}</div>` : ''}
        ${vars.length ? `<p class="muted small" style="margin-bottom:6px">دوس على أي خانة تضيفها مكان المؤشر — بتتملي لوحدها وقت الإرسال:</p>
          <div class="chips" style="margin-bottom:10px">${vars.map(v => `<button type="button" class="chip" data-tv="${esc(v)}">{${esc(v)}} ${esc(vl(k, v) || '')}</button>`).join('')}</div>` : ''}
        <textarea class="input" id="txIn" rows="6" maxlength="2000" dir="${dir}">${esc(cur)}</textarea>
        <div class="banner warn" id="txWarn" style="margin-top:8px" hidden></div>
        <p class="muted small" style="margin:10px 0 4px">معاينة — كده هتوصل:</p>
        <div class="gm"><p class="gm-t" id="txPrev" dir="${dir}"></p></div>
        <details style="margin-top:10px"><summary class="small">النص الأصلي</summary><p class="gm-t small" dir="${dir}">${TP.waPreview(orig(L))}</p></details>
        <div class="btn-row" style="margin-top:12px;gap:8px">${/^v[A-Z]/.test(k) ? '<button type="button" class="btn btn-gold btn-sm" id="txHear">🔊 اسمع</button>' : ''}${own(k, L) ? '<button type="button" class="btn btn-ghost btn-sm" id="txReset">↺ رجوع للأصل</button>' : ''}</div>`,
      async () => {
        const v = TP.$('#txIn').value.replace(/\r/g, '');
        if (!v.trim()) return TP.toast('الرسالة فاضية — لو عايز الأصل دوس "رجوع للأصل"'), false;
        if (v === orig(L)) { if (own(k, L)) { if (!(await saveOne(k, L, '', 'رجعت زي الأصل'))) return false; } TP.toast('محفوظة ✓'); render(); return; }
        if (!(await saveOne(k, L, v))) return false;
        TP.toast('اتحفظت ✓ — بتشتغل على كل الأجهزة دلوقتي'); render();
      }, { wide: true, noFocus: true, saveLabel: 'حفظ التعديل' });
      const ta = TP.$('#txIn'), prev = TP.$('#txPrev'), warn = TP.$('#txWarn');
      const upd = () => {
        prev.innerHTML = TP.waPreview(fill(ta.value, /^v[A-Z]/.test(k) ? Object.assign({}, SAMPLE, { n: VOICE_NAME }) : SAMPLE));
        const lost = vars.filter(x => orig(L).includes('{' + x + '}') && !ta.value.includes('{' + x + '}'));
        warn.hidden = !lost.length;
        warn.textContent = lost.length ? 'خد بالك: شيلت ' + lost.map(x => '{' + x + '} (' + (vl(k, x) || x) + ')').join('، ') + ' — مش هيظهر في الرسالة. لو مقصود سيبه.' : '';
      };
      ta.oninput = upd; upd();
      TP.$$('#tp-modal [data-tl]').forEach(b => b.onclick = () => { L = b.dataset.tl; draw(); });
      TP.$$('#tp-modal [data-tv]').forEach(b => b.onclick = () => {
        const s = ta.selectionStart || ta.value.length, e = ta.selectionEnd || s, ins = '{' + b.dataset.tv + '}';
        ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e); ta.focus(); ta.selectionStart = ta.selectionEnd = s + ins.length; upd();
      });
      const th = TP.$('#txHear'); if (th) th.onclick = () => hear(ta.value);
      const rs = TP.$('#txReset');
      if (rs) rs.onclick = async () => { if (!confirm('ترجّع الرسالة دي (' + I().info(L).name + ') زي الأصل؟')) return; if (await saveOne(k, L, '', 'رجوع للأصل')) { TP.toast('رجعت زي الأصل ✓'); draw(); render(); } };
    };
    draw();
  }

  /* ---------- the page ---------- */
  let rootEl = null;
  function render() {
    const root = rootEl; if (!root || !root.isConnected) return;
    if (!isChair()) { root.innerHTML = '<section class="card"><p class="muted">الصفحة دي لرئيس مجلس الإدارة بس.</p></section>'; return; }
    if (!st.loaded) { root.innerHTML = '<section class="card"><p class="muted">بيحمّل…</p></section>'; load().then(render); return; }
    const all = defs(), q = U.norm(st.q || '');
    const keys = Object.keys(all).filter(k => k !== 'min1' && k !== 'mins');
    const inGrp = g => keys.filter(k => groupOf(k).id === g.id);
    const n = keys.filter(edited).length;
    const shown = q ? keys.filter(k => U.norm(labelOf(k) + ' ' + all[k].join(' ') + ' ' + I().LANGS.map(L => own(k, L.id)).join(' ')).includes(q))
      : st.grp === 'log' ? [] : inGrp(GROUPS.find(g => g.id === st.grp) || GROUPS[0]);
    const g = GROUPS.find(x => x.id === st.grp);
    const card = k => {
      const row = all[k], ar = own(k, 'ar') || row[0], en = row.length > 1 ? (own(k, 'en') || row[1]) : '';
      return `<div class="gm"><div class="gm-h"><b>${esc(labelOf(k))}</b>${edited(k) ? '<span class="st st-info">معدّلة ✎</span>' : ''}${/^v[A-Z]/.test(k) ? `<button type="button" class="btn btn-ghost btn-sm" data-thear="${esc(k)}">🔊 اسمع</button>` : ''}<button type="button" class="btn btn-primary btn-sm" data-tedit="${esc(k)}">${TP.icon('edit', 16)} تعديل الرسالة</button></div>
        <p class="gm-t" dir="${/[؀-ۿ]/.test(ar) ? 'rtl' : 'ltr'}">${pv(ar, k)}</p>${en ? `<p class="gm-t muted small" dir="ltr">${pv(en, k)}</p>` : ''}</div>`;
    };
    const log = ((st.doc || {}).log || []);
    root.innerHTML = `<section class="card">
      <div class="banner info" style="margin-bottom:12px">${TP.icon('shield')}<span class="grow">القسم ده ليك انت بس. أي تعديل بيشتغل على كل الأجهزة على طول، ولو مسحت رسالة أو حصل أي خطأ التطبيق بيرجع للنص الأصلي لوحده. ${n ? `<b>${n}</b> رسالة معدّلة.` : ''}</span></div>
      <div class="toolbar">${U.filterBox('txQ', 'دوّر على رسالة أو كلمة', st.q)}</div>
      <div class="chips" style="margin:10px 0">${GROUPS.map(x => `<button type="button" class="chip ${!q && st.grp === x.id ? 'active' : ''}" data-tg="${x.id}">${esc(x.name)} <small>${inGrp(x).length}</small></button>`).join('')}<button type="button" class="chip ${!q && st.grp === 'log' ? 'active' : ''}" data-tg="log">${TP.icon('history', 14)} سجل التعديلات <small>${log.length}</small></button></div>
      ${!q && g ? `<p class="muted small" style="margin-bottom:10px">${esc(g.hint)}</p>` : ''}
      ${!q && st.grp === 'voice' ? voicePanel() : ''}
      ${!q && st.grp === 'log' ? (log.length ? log.map((x, i) => `<div class="gm"><div class="gm-h"><b>${esc(labelOf(x.k))}</b><span class="muted small">${esc((I().info(x.l) || {}).name || x.l)} · ${esc(x.by)} · ${esc(TP.fmtDateTime(x.at))}</span>${x.was !== undefined && defs()[x.k] ? `<button type="button" class="btn btn-ghost btn-sm" data-tback="${i}">↺ رجّع اللي قبله</button>` : ''}</div>
          <p class="gm-t small" dir="auto"><b>بقت:</b> ${x.now ? TP.waPreview(x.now) : '<i>النص الأصلي</i>'}</p><p class="gm-t small muted" dir="auto"><b>كانت:</b> ${x.was ? TP.waPreview(x.was) : '<i>النص الأصلي</i>'}</p></div>`).join('') : '<p class="muted">لسه مفيش تعديلات.</p>')
        : shown.length ? shown.map(card).join('') : '<p class="muted">مفيش نتيجة.</p>'}
    </section>`;
    const qi = root.querySelector('#txQ');
    if (qi) { if (st.focusQ) { qi.focus(); qi.selectionStart = qi.selectionEnd = qi.value.length; st.focusQ = false; } qi.oninput = () => { st.q = qi.value; st.focusQ = true; render(); }; }
    TP.$$('[data-tg]', root).forEach(b => b.onclick = () => { st.grp = b.dataset.tg; st.q = ''; render(); });
    TP.$$('[data-tedit]', root).forEach(b => b.onclick = () => openEdit(b.dataset.tedit));
    TP.$$('[data-vset]', root).forEach(b => b.onclick = () => { const v = vcfg(); v[b.dataset.vset] = b.dataset.vval; hear(TP.i18n.t('ar', 'vDone'), v); saveVoice(v); });
    const von = root.querySelector('#vOn'); if (von) von.onchange = () => saveVoice(Object.assign(vcfg(), { on: von.checked }));
    const vh = root.querySelector('#vHear'); if (vh) vh.onclick = () => hear(TP.i18n.t('ar', 'vNew'));
    TP.$$('[data-thear]', root).forEach(b => b.onclick = () => hear(TP.i18n.t('ar', b.dataset.thear)));
    TP.$$('[data-tback]', root).forEach(b => b.onclick = async () => {
      const x = log[Number(b.dataset.tback)]; if (!x) return;
      if (!confirm('ترجّع "' + labelOf(x.k) + '" للي كانت عليه قبل التعديل ده؟')) return;
      if (await saveOne(x.k, x.l, x.was || '', 'استرجاع من السجل')) { TP.toast('رجعت ✓'); render(); }
    });
    TP.hydrateIcons && TP.hydrateIcons(root);
  }

  TP.views = TP.views || {};
  // the page loads its copy once (no extra reads when the rest of the Control Tower refreshes)
  TP.views.texts = { render(root) { rootEl = root; render(); } };
})(window.TP = window.TP || {});
