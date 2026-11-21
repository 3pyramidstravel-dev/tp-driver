/* ==========================================================================
   كلّم كريم — chat with Karim, the company's virtual AI manager.
   Used in the driver app (tourism captains, 21 Nov) and in Control Tower
   (every manager, and the chairman himself — Karim knows he is the owner).
   Karim answers through Gemini (free tier; key in karimCfg/main). He also
   carries the management's notes (karimNotes: from Ahmed Samir to anyone,
   from the operations manager to the captains), and can speak his replies
   aloud with the phone's own Arabic voice (TP.voice, free).
   With the operations manager he works as a partner: he sees the captains'
   training progress and helps him follow up.
   One doc per person: karimChat/{personId}. Everything is visible to the chairman.
   ========================================================================== */
(function (TP) {
  'use strict';
  const esc = TP.esc;
  const S = TP.session;
  const MAX_DAY = 30, KEEP = 80;
  const ROLE_NAMES = { chairman: 'رئيس مجلس الإدارة وصاحب الشركة', gm: 'المدير العام', finance: 'المدير المالي', airports: 'مدير المطارات', operations: 'مدير التشغيل', supervisor: 'مشرف الحركة' };

  let doc = null, unsub = null, root = null, cfg = null, notes = null, busy = false, trainCtx = null;
  const P = () => S.person || {};
  const pid = () => P().id;
  const path = () => 'karimChat/' + pid();
  const first = () => (P().name || '').split(' ')[0] || '';
  const today = () => new Date(TP.now()).toISOString().slice(0, 10);
  const isDriver = () => P().type === 'driver' || !!P().driverKind;
  const isOwner = () => P().role === 'chairman';
  const isOps = () => !isDriver() && !isOwner() && !!(S.can && S.can('tracking.view'));
  const audience = () => isDriver() ? 'captains' : 'staff';

  let autoSpeak = false;
  try { autoSpeak = localStorage.getItem('karimVoice') === '1'; } catch (e) { /* private mode */ }
  // Karim's voice: a real male voice from Gemini TTS (free key, voice "Charon"); if that fails,
  // the phone's own voice, asked for a man's voice (most phones have only a woman's Arabic voice).
  let actx = null, playing = null; const tts = {};
  function playPcm(b64) {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const bin = atob(b64), n = bin.length >> 1, buf = actx.createBuffer(1, n, 24000), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; ch[i] = v / 32768; }
    try { if (playing) playing.stop(); } catch (e) { /* ignore */ }
    const src = actx.createBufferSource(); src.buffer = buf; src.connect(actx.destination); src.start(); playing = src;
  }
  async function speak(t) {
    t = String(t || '').replace(/[*_#>]/g, '').slice(0, 600); if (!t) return;
    try { if (TP.voice) TP.voice.stop(); } catch (e) { /* ignore */ }
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { /* ignore */ }
    if (tts[t]) { try { playPcm(tts[t]); return; } catch (e) { /* fall through */ } }
    const c = await loadCfg();
    if (!c.key) { TP.toast('صوت كريم محتاج مفتاح Gemini في إعدادات كريم', 'warn'); return; }
    const models = c.ttsModel ? [c.ttsModel] : ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
    for (const m of models) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(c.key)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Say in a warm, calm, confident Egyptian Arabic male voice, natural like a real person talking: ' + t }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: c.ttsVoice || 'Charon' } } } } })
        });
        if (!r.ok) { console.warn('karim tts', m, r.status); continue; }
        const j = await r.json(), part = ((((j.candidates || [])[0] || {}).content || {}).parts || []).find(p => p.inlineData && p.inlineData.data);
        if (part) { tts[t] = part.inlineData.data; playPcm(tts[t]); return; }
      } catch (e) { console.warn('karim tts', m, e); }
    }
    TP.toast('صوت كريم مش متاح دلوقتي، جرّب كمان شوية', 'warn');
  }

  async function loadCfg() {
    if (cfg) return cfg;
    try { cfg = (await TP.fb.get('karimCfg/main')) || {}; } catch (e) { cfg = {}; }
    return cfg;
  }
  async function loadNotes() {
    try {
      const l = await TP.fb.list('karimNotes', {});
      notes = (l || []).filter(n => (!n.until || n.until > TP.now()) && (n.to === 'all' || n.to === audience()));
    } catch (e) { notes = []; }
    return notes;
  }
  async function loadTraining() {
    if (!isOps() && !isOwner()) return '';
    try {
      const l = await TP.fb.list('training', {});
      trainCtx = (l || []).map(t => {
        const q = t.quiz || {};
        return `- ${t.name || '—'}: ${t.lessonsDone ? 'خلص الدروس' : t.intro ? 'بيتدرب' : 'لسه مبدأش'}، حفظ ${(t.learned || []).length} جملة، ${q.passed ? 'نجح في الاختبار' : q.tries ? 'آخر درجة ' + q.score + '/10' : 'لسه ما امتحنش'}، آخر نشاط ${t.at ? TP.ago(t.at) : '—'}`;
      }).join('\n');
    } catch (e) { trainCtx = ''; }
    return trainCtx;
  }

  function system() {
    const p = P(), n = notes || [];
    const base = `انت "كريم"، مدير الذكاء الاصطناعي الافتراضي لشركة ثري بيراميدز ترافيل (شركة نقل لضيوف وموظفي الشركات والمصانع العالمية في مصر من 2011، صاحبها ورئيس مجلس إدارتها أحمد سمير). انت برنامج ذكاء اصطناعي، ولو حد سألك قول كده بصراحة. اتكلم بالمصري. ردودك قصيرة (من 2 لـ 6 سطور) وواضحة، لأنها ممكن تتقري بصوت.
ما توعدش بفلوس ولا زيادات ولا إجازات ولا أي قرار إداري. ما تطلبش أرقام سرية أو بيانات بنكية. لو حد قال حاجة فيها خطر على حياته أو حياة حد، قوله يكلم الإسعاف 123 أو أستاذ أحمد 01000899003 فوراً، واكتب [FLAG].`;
    const noteTxt = n.length ? `\nرسايل من الإدارة لازم توصّلها بشكل طبيعي ومحترم في أول رد مناسب (وقول هي من مين)، وما تكررهاش في كل رد:\n${n.map(x => `- من ${x.by || 'الإدارة'}: ${x.text}`).join('\n')}` : '';
    if (isOwner()) return base + `
بتكلم أحمد سمير، صاحب الشركة ورئيس مجلس الإدارة. اتكلم معاه كمدير بيرفع تقرير لصاحب الشركة: باحترام، وبصراحة، ومن غير تطمين أو مجاملة. ادّيله آراء وأفكار عملية لتطوير الشركة والكباتن والمبيعات.
لو طلب منك توصّل رسالة أو تعليمات لناس معينة، قوله يكتبها في خانة "قول لكريم" في صفحة تقرير كريم في Control Tower علشان توصلهم في محادثاتك معاهم.` + (trainCtx ? `\nحالة تدريب كباتن السياحة دلوقتي:\n${trainCtx}` : '');
    if (!isDriver()) return base + `
بتكلم ${p.name || ''}، ${ROLE_NAMES[p.role] || 'من إدارة الشركة'}. انت صاحبه وزميله اللي بيساعده: اتكلم معاه بود واحترام، وساعده بجد في شغله بأفكار وحلول عملية، مش مجرد ناقل رسايل.` + (isOps() ? `
انت شريكه في الشغل وبتكملوا بعض: انت بتتابع معنويات كباتن السياحة وتدريبهم وجملة الإنجليزي كل يومين، وهو بيتابع التشغيل في الأرض (المواعيد، العربيات، المطار، الالتزام). قوله مين محتاج متابعة في التدريب، واقترح عليه خطوات عملية النهارده، وشجّعه. ولو عايز يوصّل رسالة للكباتن، قوله يكتبها في خانة "رسالة للكباتن عن طريق كريم" تحت الشات.` + (trainCtx ? `\nحالة تدريب كباتن السياحة دلوقتي:\n${trainCtx}` : '') : `
ساعده في شغله بأفكار عملية، وشجّعه.`) + noteTxt;
    return base + `
بتكلم الكابتن ${p.name || ''} (كابتن سياحة في الشركة). انت صاحبه ومديره اللي بيساعده: اتكلم معاه زي صاحب قريب وأخ كبير، بدفء وهزار خفيف ومحترم، مش زي موظف شكاوى.
اسمعه بجد، واسأله عن نفسه وعن يومه، وساعده هو بنفسه: ادّيله نصيحة عملية، أو حل، أو خطوة يعملها، أو كلمة ترفع معنوياته. علّمه حاجة جديدة لو الفرصة جت (المطار، الضيوف، العربية، جملة إنجليزي). شجّعه: الشركة شركته، والأمانة والالتزام طريقنا لنجاح 2027.
ما تقولش "هوصّل كلامك لأستاذ أحمد" في كل رد. قولها بس لو طلب حاجة محتاجة قرار من الإدارة (فلوس، إجازة، تغيير جدول) أو عنده مشكلة كبيرة (صحة، مشكلة في البيت، خلاف، عطل خطير)، وساعتها برضه ساعده وطمّنه، واكتب في آخر ردك [FLAG].`+ noteTxt;
  }

  const FALLBACK = [
    'معاك يا صاحبي 💪 النت عندي تقيل شوية دلوقتي، ابعتلي تاني بعد دقيقة وهرد عليك.',
    'شكراً إنك كلمتني. أنا سامعك، ورسالتك وصلت للإدارة.',
    'تسلم على ثقتك. اللي كتبته وصل لأستاذ أحمد، وكمل وانت مطمن.'
  ];

  async function ask(history) {
    const c = await loadCfg();
    if (!c.key || c.on === false) return null;
    const contents = history.slice(-20).filter(m => m.f !== 'a').map(m => ({ role: m.f === 'c' ? 'user' : 'model', parts: [{ text: m.t }] }));
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model || 'gemini-2.5-flash')}:generateContent?key=${encodeURIComponent(c.key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system() }] }, contents, generationConfig: { temperature: 0.8, maxOutputTokens: 600 } })
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
    unsub = TP.fb.onDoc(path(), d => {
      const before = doc && doc.msgs ? doc.msgs.length : 0;
      if (!busy) doc = d;
      const m = d && d.msgs; if (m && m.length > before && before && m[m.length - 1].f === 'a' && autoSpeak && root) speak('رسالة من أستاذ أحمد: ' + m[m.length - 1].t);
      if (root) draw();
    }, () => { if (root) draw(); });
    loadNotes(); loadTraining();
  }

  async function send(text) {
    text = (text || '').trim().slice(0, 1500);
    if (!text || busy) return;
    if (autoSpeak) { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch (e) { /* ignore */ } }
    const d0 = doc || {};
    const n = d0.day === today() ? (d0.n || 0) : 0;
    if (n >= MAX_DAY && !isOwner()) { TP.toast('كفاية النهارده 🙏 كمّل كلامك بكرة، وأستاذ أحمد شايف رسايلك'); return; }
    const msgs = (d0.msgs || []).concat({ f: 'c', t: text, at: TP.now() });
    const base = { name: P().name || '', code: P().code || ROLE_NAMES[P().role] || '', day: today(), n: n + 1, flag: !!d0.flag };
    busy = true; doc = Object.assign({}, d0, base, { msgs, at: TP.now(), unread: !isOwner() }); draw(true);
    try { await save(doc); } catch (e) { busy = false; draw(); return; }
    await Promise.all([loadNotes(), loadTraining()]);
    let reply = await ask(msgs), flag = base.flag;
    if (reply && /\[FLAG\]/i.test(reply)) { flag = true; reply = reply.replace(/\[FLAG\]/gi, '').trim(); }
    if (!reply) reply = FALLBACK[msgs.length % FALLBACK.length];
    const all = msgs.concat({ f: 'k', t: reply, at: TP.now() }).slice(-KEEP);
    try { await save(Object.assign({}, base, { msgs: all, at: TP.now(), unread: !isOwner(), flag })); } catch (e) { /* toast shown */ }
    busy = false; draw();
    if (autoSpeak) speak(reply);
  }

  async function addNote(text) {
    text = (text || '').trim().slice(0, 500); if (!text) return;
    try {
      await TP.fb.add('karimNotes', { text, to: 'captains', by: P().name || 'مدير التشغيل', byId: pid(), at: TP.now(), until: TP.now() + 7 * 86400000 });
      TP.toast('كريم هيوصّلها للكباتن ✓', 'ok');
    } catch (e) { TP.toast('مقدرتش أحفظ', 'warn'); }
  }

  const css = `<style>
    .kc-wrap{display:flex;flex-direction:column;min-height:60vh}
    .kc-head{display:flex;gap:10px;align-items:center;padding:12px;border-bottom:1px solid rgba(201,162,74,.3)}
    .kc-av{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#7a1428,#c9a24a);display:flex;align-items:center;justify-content:center;font-size:22px}
    .kc-note{font-size:12.5px;opacity:.85;padding:8px 12px;background:rgba(201,162,74,.12);border-radius:10px;margin:10px 0}
    .kc-list{flex:1;padding:6px 2px}
    .kc-m{max-width:85%;padding:9px 12px;border-radius:14px;margin:6px 0;white-space:pre-wrap;line-height:1.55;font-size:15px}
    .kc-c{margin-inline-start:auto;background:#7a1428;color:#fff;border-bottom-left-radius:4px}
    .kc-k{background:rgba(127,127,127,.1);border:1px solid rgba(201,162,74,.35);border-bottom-right-radius:4px}
    .kc-a{background:rgba(201,162,74,.18);border:1px solid #c9a24a;border-bottom-right-radius:4px}
    .kc-who{font-size:11px;opacity:.7;margin-bottom:2px;font-weight:700;display:flex;justify-content:space-between;gap:8px}
    .kc-say{border:0;background:none;cursor:pointer;font-size:16px;padding:0}
    .kc-in{display:flex;gap:8px;position:sticky;bottom:0;padding:10px 0;background:inherit}
    .kc-in textarea{flex:1;min-height:44px;max-height:120px;border-radius:12px;padding:10px;font:inherit;font-size:15px;resize:none}
    .kc-typing{opacity:.7;font-size:13px;margin:4px 0}
    .kc-opt{display:flex;align-items:center;gap:8px;font-size:13px;margin:4px 0}
  </style>`;

  function draw(typing) {
    if (!root) return;
    const msgs = (doc && doc.msgs) || [];
    const hello = isOwner()
      ? `أهلاً يا أستاذ أحمد 👋 أنا كريم، مدير الذكاء الاصطناعي الافتراضي للشركة. تحت أمرك: تقرير، رأي، فكرة، أو أي حاجة عايزني أتابعها.`
      : isDriver()
        ? `أهلاً يا كابتن ${esc(first())} 👋 أنا كريم، مدير الذكاء الاصطناعي الافتراضي لثري بيراميدز. أنا برنامج ذكاء اصطناعي، وموجود عشانك في أي وقت: مشكلة، فكرة، سؤال، أو حتى لو محتاج تتكلم. اكتبلي.`
        : `أهلاً يا أستاذ ${esc(first())} 👋 أنا كريم، مدير الذكاء الاصطناعي الافتراضي للشركة.${isOps() ? ' إحنا فريق واحد: أنا بتابع معنويات الكباتن وتدريبهم، وانت التشغيل في الأرض. قولي نبدأ بإيه النهارده؟' : ' تحت أمرك في أي حاجة.'}`;
    const notice = isOwner() ? '' : `<div class="kc-note">🔒 الإدارة بتقدر تشوف المحادثة دي. ما تكتبش أرقام سرية أو بيانات بنكية.</div>`;
    const keep = root.querySelector('textarea.kc-t'); const draft = keep ? keep.value : '';
    root.innerHTML = css + `<div class="kc-wrap card">
      <div class="kc-head"><div class="kc-av">🤖</div><div><b>كريم</b><div class="small muted">مدير الذكاء الاصطناعي الافتراضي للشركة</div></div></div>
      ${notice}
      <label class="kc-opt"><input type="checkbox" id="kcAuto" ${autoSpeak ? 'checked' : ''}> 🔊 خلّي كريم يتكلم بصوت على طول</label>
      <div class="kc-list">
        <div class="kc-m kc-k"><div class="kc-who"><span>كريم</span><button class="kc-say" data-say="-1" title="اسمع">🔊</button></div>${hello}</div>
        ${msgs.map((m, i) => `<div class="kc-m kc-${m.f}">${m.f === 'c' ? '' : `<div class="kc-who"><span>${m.f === 'a' ? 'أستاذ أحمد سمير' : 'كريم'}</span><button class="kc-say" data-say="${i}" title="اسمع">🔊</button></div>`}${esc(m.t)}</div>`).join('')}
        ${typing || busy ? '<div class="kc-typing">كريم بيكتب…</div>' : ''}
      </div>
      <div class="kc-in"><textarea class="kc-t" placeholder="اكتب لكريم…" maxlength="1500"></textarea><button class="btn btn-primary" type="button" id="kcSend">إرسال</button></div>
      ${isOps() ? `<div class="kc-note" style="margin-top:4px"><b>📣 رسالة للكباتن عن طريق كريم</b> (هيوصّلها في محادثاته معاهم لمدة أسبوع، باسمك)
        <textarea id="kcNote" rows="2" style="width:100%;margin-top:6px" placeholder="مثلاً: ذكّر الكباتن بفحص العربية قبل الطلوع"></textarea>
        <button class="btn" type="button" id="kcNoteSave" style="margin-top:6px">ابعت لكريم</button></div>` : ''}
    </div>`;
    const ta = root.querySelector('textarea.kc-t'); ta.value = draft;
    root.querySelector('#kcSend').onclick = () => { const v = ta.value; ta.value = ''; send(v); };
    root.querySelector('#kcAuto').onchange = e => { autoSpeak = e.target.checked; try { localStorage.setItem('karimVoice', autoSpeak ? '1' : '0'); } catch (x) { /* ignore */ } if (autoSpeak) speak('تمام، هتكلم معاك بصوت'); };
    root.querySelectorAll('[data-say]').forEach(b => b.onclick = () => { const i = Number(b.dataset.say); speak(i < 0 ? hello.replace(/<[^>]+>/g, '') : (msgs[i] || {}).t); });
    const ns = root.querySelector('#kcNoteSave'); if (ns) ns.onclick = () => { const t = root.querySelector('#kcNote'); addNote(t.value); t.value = ''; };
    const list = root.querySelector('.kc-list'); if (list && list.lastElementChild) list.lastElementChild.scrollIntoView({ block: 'end' });
  }

  function render(el) { root = el; sub(); draw(); }
  const available = () => !!(S.person && (S.person.driverKind === 'tourism' || !isDriver()));
  const hasReply = () => { const m = doc && doc.msgs; return !!(m && m.length && m[m.length - 1].f === 'a'); };

  TP.karim = { render, available, hasReply, start: sub };
  TP.dvKarim = TP.karim;   // the driver app's name for it
})(window.TP = window.TP || {});
