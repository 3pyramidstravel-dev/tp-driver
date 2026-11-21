/* ==========================================================================
   تقرير كريم — the chairman's page for "كلّم كريم" (agreed 21 Nov):
   every captain's chat with Karim (flagged ones first), a reply box that
   answers as "أستاذ أحمد سمير", today's AI summary with Karim's ideas, and
   Karim's settings (free Gemini key + model). Chairman only.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const st = { list: null, unsub: null, open: null, cfg: null, summary: '', busy: false, notes: null, nunsub: null };
  const today = () => new Date(TP.now()).toISOString().slice(0, 10);

  function sub() {
    if (st.unsub) return;
    st.unsub = TP.fb.onCol('karimChat', {}, l => {
      st.list = l.sort((a, b) => (b.flag ? 1 : 0) - (a.flag ? 1 : 0) || (b.at || 0) - (a.at || 0));
      TP.rerender && TP.rerender();
    }, e => { console.warn('karimChat', e && e.code); st.list = []; TP.rerender && TP.rerender(); });
    st.nunsub = TP.fb.onCol('karimNotes', {}, l => { st.notes = l.sort((a, b) => (b.at || 0) - (a.at || 0)); TP.rerender && TP.rerender(); }, () => { st.notes = []; });
    TP.fb.get('karimCfg/main').then(c => { st.cfg = c || {}; TP.rerender && TP.rerender(); }).catch(() => { st.cfg = {}; });
  }

  async function gemini(prompt) {
    const c = st.cfg || {};
    if (!c.key) { TP.toast('حط مفتاح Gemini في إعدادات كريم الأول', 'warn'); return null; }
    const t = TP.karimGem ? await TP.karimGem({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.6, maxOutputTokens: 4096 } }, c) : null;
    if (!t) TP.toast('Gemini مشغول دلوقتي، جرّب كمان دقيقة', 'warn');
    return t;
  }

  async function summarize() {
    const day = today(), act = (st.list || []).filter(c => c.day === day || (c.at && TP.now() - c.at < 86400000));
    if (!act.length) { st.summary = 'مفيش كابتن كلّم كريم النهارده.'; TP.rerender(); return; }
    st.busy = true; TP.rerender();
    const txt = act.map(c => `الكابتن ${c.name} (${c.code || ''}):\n` + (c.msgs || []).slice(-20).map(m => (m.f === 'c' ? 'الكابتن: ' : m.f === 'a' ? 'أحمد: ' : 'كريم: ') + m.t).join('\n')).join('\n\n');
    const out = await gemini(`انت كريم، مدير الذكاء الاصطناعي في ثري بيراميدز ترافيل. دي محادثات كباتن السياحة معاك النهارده. اكتب لأستاذ أحمد سمير (صاحب الشركة) تقرير يومي بالمصري، مختصر ومنظم:
1) مين اتكلم وعن إيه (سطر لكل كابتن).
2) 🔴 مين محتاج متابعة من أستاذ أحمد شخصياً وليه (المشاكل الشخصية الحساسة اكتبها كملخص محترم من غير تفاصيل محرجة).
3) روح الفريق النهارده في سطر.
4) فكرتين عمليتين لأستاذ أحمد يرفع بيهم معنويات الكباتن أو يطوّرهم.
5) رسالة تشجيع وفكرة تطوير للتشغيل لمحمد أيمن (مدير التشغيل).

${txt}`);
    st.summary = out || 'مقدرتش أعمل الملخص دلوقتي.'; st.busy = false; TP.rerender();
  }

  async function reply(c, text) {
    text = (text || '').trim(); if (!text) return;
    const msgs = (c.msgs || []).concat({ f: 'a', t: text.slice(0, 1500), at: TP.now() }).slice(-80);
    try { await TP.fb.set('karimChat/' + c.id, { msgs, at: TP.now(), unread: false, flag: false }, true); TP.toast('اتبعت للكابتن ✓', 'ok'); }
    catch (e) { TP.toast('مقدرتش أبعت', 'warn'); }
  }

  async function saveCfg(key, model) {
    try { await TP.fb.set('karimCfg/main', { key: key.trim(), model: (model || 'gemini-3-flash-preview').trim(), on: true }, true); st.cfg = Object.assign({}, st.cfg, { key: key.trim(), model }); TP.toast('اتحفظ ✓', 'ok'); TP.rerender(); }
    catch (e) { TP.toast('مقدرتش أحفظ', 'warn'); }
  }


  const TO = { captains: 'الكباتن', staff: 'الإدارة', all: 'الكل' };
  async function addNote(text, to, days) {
    text = (text || '').trim().slice(0, 500); if (!text) { TP.toast('اكتب الرسالة الأول', 'warn'); return; }
    try { await TP.fb.add('karimNotes', { text, to, by: 'أستاذ أحمد سمير', byId: (TP.session.person || {}).id || '', at: TP.now(), until: TP.now() + (Number(days) || 7) * 86400000 }); TP.toast('كريم هيوصّلها ✓', 'ok'); }
    catch (e) { TP.toast('مقدرتش أحفظ', 'warn'); }
  }
  function notesCard() {
    const act = (st.notes || []).filter(n => !n.until || n.until > TP.now());
    return `<section class="card"><div class="card-head"><h3>📣 قول لكريم</h3></div>
      <p class="small muted">اكتب أي رسالة أو تعليمات، وكريم هيوصّلها باسمك في محادثاته مع الناس.</p>
      <textarea id="kN" rows="2" style="width:100%;margin:6px 0" placeholder="مثلاً: قول لكل الكباتن إن فيه مكافأة لأحسن كابتن الشهر ده"></textarea>
      <div class="row" style="gap:8px;flex-wrap:wrap"><select id="kTo"><option value="captains">للكباتن</option><option value="staff">للإدارة</option><option value="all">للكل</option></select>
        <select id="kDays"><option value="1">يوم</option><option value="3">3 أيام</option><option value="7" selected>أسبوع</option><option value="30">شهر</option></select>
        <button class="btn btn-primary" id="kNs">ابعت لكريم</button></div>
      ${act.length ? act.map(n => `<div class="gm" style="margin-top:8px"><div class="gm-h"><b>${esc(TO[n.to] || n.to)} · من ${esc(n.by || '')}</b><button class="btn btn-ghost" data-nd="${esc(n.id)}">إلغاء</button></div><p class="small" style="margin:4px 0">${esc(n.text)}</p></div>`).join('') : ''}
    </section>`;
  }

  function render(root) {
    sub();
    if (!st.list) { root.innerHTML = '<section class="card"><p class="muted">بيحمّل…</p></section>'; return; }
    const day = today(), act = st.list.filter(c => c.day === day).length, fl = st.list.filter(c => c.flag).length;
    const hasKey = !!(st.cfg && st.cfg.key);
    root.innerHTML = `<section class="card">
      <div class="card-head"><h3>تقرير كريم</h3><span class="st ${fl ? 'st-danger' : 'st-ok'}">${fl ? fl + ' محتاج متابعة 🔴' : 'كله تمام'}</span></div>
      <p class="small muted">${act} كابتن كلّم كريم النهارده · ${st.list.length} محادثة · الذكاء الاصطناعي: ${hasKey ? 'شغال ✓' : '<b style="color:#c83c3c">مش متوصل (حط المفتاح تحت)</b>'}</p>
      <div class="row" style="margin:10px 0"><button class="btn btn-primary" id="kSum" ${st.busy ? 'disabled' : ''}>${st.busy ? 'كريم بيكتب التقرير…' : '📋 تقرير النهارده وأفكار كريم'}</button></div>
      ${st.summary ? `<div class="gm" style="white-space:pre-wrap;line-height:1.7">${esc(st.summary)}</div>` : ''}
    </section>
    ${notesCard()}
    <section class="card"><div class="card-head"><h3>المحادثات</h3></div>
      ${st.list.length ? st.list.map(c => {
        const last = (c.msgs || [])[(c.msgs || []).length - 1] || {};
        const open = st.open === c.id;
        return `<div class="gm"><div class="gm-h" data-k="${esc(c.id)}" style="cursor:pointer"><b>${c.flag ? '🔴 ' : ''}${esc((c.code ? c.code + ' · ' : '') + (c.name || '—'))}</b><span class="small muted">${esc(c.at ? TP.ago(c.at) : '')}</span></div>
          ${open ? `<div style="margin:8px 0">${(c.msgs || []).map(m => `<p class="small" style="margin:4px 0;${m.f === 'c' ? '' : 'opacity:.8'}"><b>${m.f === 'c' ? 'الكابتن' : m.f === 'a' ? 'انت' : 'كريم'}:</b> ${esc(m.t)}</p>`).join('')}
            <textarea id="kR" rows="2" style="width:100%;margin-top:6px" placeholder="ردك للكابتن (هيوصله باسم أستاذ أحمد سمير)"></textarea>
            <button class="btn btn-primary" id="kRs" data-k="${esc(c.id)}" style="margin-top:6px">إرسال للكابتن</button></div>`
            : `<p class="small" style="margin:4px 0">${esc((last.f === 'c' ? 'الكابتن: ' : last.f === 'a' ? 'انت: ' : 'كريم: ') + (last.t || '').slice(0, 120))}</p>`}</div>`;
      }).join('') : '<p class="muted">لسه مفيش كابتن كلّم كريم.</p>'}
    </section>
    <section class="card"><div class="card-head"><h3>⚙️ إعدادات كريم</h3></div>
      <p class="small muted">مفتاح Gemini المجاني من aistudio.google.com/apikey بحساب الشركة. المفتاح بيتحفظ هنا بس، ما تبعتهوش في أي شات.</p>
      <input id="kKey" type="password" placeholder="${hasKey ? 'المفتاح محفوظ ✓ (اكتب جديد لو عايز تغيّره)' : 'الصق مفتاح Gemini هنا'}" style="width:100%;margin:6px 0">
      <input id="kModel" type="text" value="${esc((st.cfg && st.cfg.model && !/2\.5/.test(st.cfg.model)) ? st.cfg.model : 'gemini-3-flash-preview')}" style="width:100%;margin:6px 0">
      <button class="btn" id="kSave">حفظ</button>
    </section>`;
    const q = s => root.querySelector(s);
    q('#kSum').onclick = summarize;
    q('#kNs').onclick = () => { addNote(q('#kN').value, q('#kTo').value, q('#kDays').value); q('#kN').value = ''; };
    root.querySelectorAll('[data-nd]').forEach(b => b.onclick = () => TP.fb.remove('karimNotes/' + b.dataset.nd).catch(() => TP.toast('مقدرتش', 'warn')));
    root.querySelectorAll('.gm-h[data-k]').forEach(h => h.onclick = () => { st.open = st.open === h.dataset.k ? null : h.dataset.k; TP.rerender(); });
    if (q('#kRs')) q('#kRs').onclick = () => { const c = st.list.find(x => x.id === q('#kRs').dataset.k); if (c) reply(c, q('#kR').value); };
    q('#kSave').onclick = () => { const k = q('#kKey').value; if (!k && !hasKey) { TP.toast('الصق المفتاح الأول', 'warn'); return; } saveCfg(k || st.cfg.key, q('#kModel').value); };
  }

  TP.views = TP.views || {};
  TP.views.karim = { render };
  TP.views.karimchat = { render: root => TP.karim.render(root) };
})(window.TP = window.TP || {});
