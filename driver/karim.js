/* ==========================================================================
   كلّم كريم — chat with Karim, the company's virtual AI manager (agreed 21 Nov).
   Tourism captains write anything (a problem, an idea, a question); Karim
   answers right away through Gemini (free tier, key set by the chairman in
   Control Tower → karimCfg/main). If the key is missing or Gemini fails, a
   warm ready reply answers instead, so the captain is never left alone.
   Everything is visible to the chairman (said clearly at the top of the chat).
   One doc per captain: karimChat/{personId}.
   ========================================================================== */
(function (TP) {
  'use strict';
  const esc = TP.esc;
  const S = TP.session;
  const MAX_DAY = 30, KEEP = 80;

  let doc = null, unsub = null, root = null, cfg = null, busy = false;
  const pid = () => S.person && S.person.id;
  const path = () => 'karimChat/' + pid();
  const first = () => (S.person.name || '').split(' ')[0] || '';
  const today = () => new Date(TP.now()).toISOString().slice(0, 10);

  const SYSTEM = () => `انت "كريم"، مدير الذكاء الاصطناعي الافتراضي لشركة ثري بيراميدز ترافيل (شركة نقل لضيوف وموظفي الشركات والمصانع العالمية في مصر من 2011). انت برنامج ذكاء اصطناعي، ولو حد سألك قول كده بصراحة.
بتكلّم الكابتن ${S.person.name || ''} (كابتن سياحة في الشركة). اتكلم بالمصري، بدفء واحترام، كأخ كبير مهتم بيه كإنسان مش بس كسواق.
هدفك: تسمعه، وتطمّنه، وترفع معنوياته، وتساعده يتطور في شغله (المطار، الضيوف، العربية، الإنجليزي، الالتزام).
قواعد:
- ردودك قصيرة (من 2 لـ 5 سطور)، وبسيطة، ومن غير كلام كبير.
- ما توعدش بفلوس ولا زيادة ولا إجازة ولا أي قرار إداري. لو طلب حاجة زي كده قوله إنك هتوصّل طلبه لأستاذ أحمد سمير.
- لو عنده مشكلة كبيرة (فلوس، صحة، مشكلة في البيت، خلاف مع حد، عطل خطير، أو أي حاجة محتاجة الإدارة)، طمّنه إنك وصّلت كلامه لأستاذ أحمد، وفي آخر ردك اكتب [FLAG].
- لو قال حاجة فيها خطر على حياته أو حياة حد، قوله يكلم الإسعاف 123 أو أستاذ أحمد 01000899003 فوراً، واكتب [FLAG].
- ما تطلبش منه أرقام سرية أو بيانات بنكية.
- شجّعه دايماً: الشركة شركته، والأمانة والالتزام هما طريقنا لنجاح 2027.`;

  const FALLBACK = [
    'وصلتني رسالتك يا كابتن، وكلامك يهمني جداً. أستاذ أحمد هيشوفها بنفسه، وإحنا جنبك. 💪',
    'شكراً إنك كلمتني يا كابتن. أنا سامعك، ورسالتك وصلت للإدارة عشان نقف معاك.',
    'تسلم يا كابتن على ثقتك. اللي كتبته وصل لأستاذ أحمد، وكمل شغلك وانت مطمن، احنا معاك.'
  ];

  async function loadCfg() {
    if (cfg) return cfg;
    try { cfg = (await TP.fb.get('karimCfg/main')) || {}; } catch (e) { cfg = {}; }
    return cfg;
  }

  async function ask(history) {
    const c = await loadCfg();
    if (!c.key || c.on === false) return null;
    const model = c.model || 'gemini-2.5-flash';
    const contents = history.slice(-20).filter(m => m.f !== 'a').map(m => ({ role: m.f === 'c' ? 'user' : 'model', parts: [{ text: m.t }] }));
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(c.key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM() }] }, contents, generationConfig: { temperature: 0.8, maxOutputTokens: 500 } })
      });
      if (!r.ok) { console.warn('karim ai', r.status); return null; }
      const j = await r.json();
      const t = j && j.candidates && j.candidates[0] && j.candidates[0].content && (j.candidates[0].content.parts || []).map(p => p.text || '').join('').trim();
      return t || null;
    } catch (e) { console.warn('karim ai', e); return null; }
  }

  async function save(d) {
    doc = d;
    try { await TP.fb.set(path(), d); }
    catch (e) { console.warn('karim save', e && e.code); TP.toast('مقدرتش أبعت — اتأكد من النت', 'warn'); throw e; }
  }

  function sub() {
    if (unsub || !pid()) return;
    unsub = TP.fb.onDoc(path(), d => { if (!busy) doc = d; if (root) draw(); }, () => { if (root) draw(); });
  }

  async function send(text) {
    text = (text || '').trim().slice(0, 1500);
    if (!text || busy) return;
    const d0 = doc || {};
    const n = d0.day === today() ? (d0.n || 0) : 0;
    if (n >= MAX_DAY) { TP.toast('كفاية النهارده يا كابتن 🙏 كمّل كلامك بكرة، وأستاذ أحمد شايف رسايلك'); return; }
    const msgs = (d0.msgs || []).concat({ f: 'c', t: text, at: TP.now() });
    const base = { name: S.person.name || '', code: S.person.code || '', day: today(), n: n + 1, flag: !!d0.flag };
    busy = true; doc = Object.assign({}, d0, base, { msgs, at: TP.now(), unread: true }); draw(true);
    try { await save(doc); } catch (e) { busy = false; draw(); return; }
    let reply = await ask(msgs), flag = base.flag;
    if (reply && /\[FLAG\]/i.test(reply)) { flag = true; reply = reply.replace(/\[FLAG\]/gi, '').trim(); }
    if (!reply) reply = FALLBACK[msgs.length % FALLBACK.length];
    const all = msgs.concat({ f: 'k', t: reply, at: TP.now() }).slice(-KEEP);
    try { await save(Object.assign({}, base, { msgs: all, at: TP.now(), unread: true, flag })); } catch (e) { /* toast shown */ }
    busy = false; draw();
  }

  const css = `<style>
    .kc-wrap{display:flex;flex-direction:column;min-height:60vh}
    .kc-head{display:flex;gap:10px;align-items:center;padding:12px;border-bottom:1px solid rgba(201,162,74,.3)}
    .kc-av{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#7a1428,#c9a24a);display:flex;align-items:center;justify-content:center;font-size:22px}
    .kc-note{font-size:12.5px;opacity:.8;padding:8px 12px;background:rgba(201,162,74,.1);border-radius:10px;margin:10px 0}
    .kc-list{flex:1;padding:6px 2px}
    .kc-m{max-width:85%;padding:9px 12px;border-radius:14px;margin:6px 0;white-space:pre-wrap;line-height:1.55;font-size:15px}
    .kc-c{margin-inline-start:auto;background:#7a1428;color:#fff;border-bottom-left-radius:4px}
    .kc-k{background:rgba(255,255,255,.07);border:1px solid rgba(201,162,74,.35);border-bottom-right-radius:4px}
    .kc-a{background:rgba(201,162,74,.18);border:1px solid #c9a24a;border-bottom-right-radius:4px}
    .kc-who{font-size:11px;opacity:.7;margin-bottom:2px;font-weight:700}
    .kc-in{display:flex;gap:8px;position:sticky;bottom:0;padding:10px 0;background:inherit}
    .kc-in textarea{flex:1;min-height:44px;max-height:120px;border-radius:12px;padding:10px;font:inherit;font-size:15px;resize:none}
    .kc-typing{opacity:.7;font-size:13px;margin:4px 0}
  </style>`;

  function draw(typing) {
    if (!root) return;
    const msgs = (doc && doc.msgs) || [];
    const hello = `أهلاً يا كابتن ${esc(first())} 👋 أنا كريم، مدير الذكاء الاصطناعي الافتراضي لثري بيراميدز. أنا برنامج ذكاء اصطناعي، وموجود عشانك في أي وقت: مشكلة، فكرة، سؤال، أو حتى لو محتاج تتكلم. اكتبلي.`;
    const keep = root.querySelector('textarea'); const draft = keep ? keep.value : '';
    root.innerHTML = css + `<div class="kc-wrap card">
      <div class="kc-head"><div class="kc-av">🤖</div><div><b>كريم</b><div class="small muted">مدير الذكاء الاصطناعي الافتراضي للشركة</div></div></div>
      <div class="kc-note">🔒 كلامك هنا بيوصل لأستاذ أحمد سمير عشان يقف جنبك ويساعدك. ما تكتبش أرقام سرية أو بيانات بنكية.</div>
      <div class="kc-list">
        <div class="kc-m kc-k"><div class="kc-who">كريم</div>${hello}</div>
        ${msgs.map(m => `<div class="kc-m kc-${m.f}">${m.f === 'c' ? '' : `<div class="kc-who">${m.f === 'a' ? 'أستاذ أحمد سمير' : 'كريم'}</div>`}${esc(m.t)}</div>`).join('')}
        ${typing || busy ? '<div class="kc-typing">كريم بيكتب…</div>' : ''}
      </div>
      <div class="kc-in"><textarea placeholder="اكتب لكريم…" maxlength="1500"></textarea><button class="btn btn-primary" type="button" id="kcSend">إرسال</button></div>
    </div>`;
    const ta = root.querySelector('textarea'); ta.value = draft;
    root.querySelector('#kcSend').onclick = () => { const v = ta.value; ta.value = ''; send(v); };
    const list = root.querySelector('.kc-list'); if (list) list.lastElementChild && list.lastElementChild.scrollIntoView({ block: 'end' });
  }

  function render(el) { root = el; sub(); draw(); }
  const available = () => !!(S.person && S.person.driverKind === 'tourism');
  const hasReply = () => { const m = doc && doc.msgs; return !!(m && m.length && m[m.length - 1].f === 'a'); };

  TP.dvKarim = { render, available, hasReply, start: sub };
})(window.TP = window.TP || {});
