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
  const speak = t => { if (TP.voice) TP.voice.speak(String(t || ''), { force: true }); };

  async function loadCfg() {
    if (cfg && cfg.key) return cfg;
    try { cfg = (await TP.fb.get('karimCfg/main')) || {}; } catch (e) { console.warn('karim cfg', e && e.code); cfg = {}; }
    if (!cfg.key) TP.toast('كريم مش لاقي مفتاح Gemini — اتأكد إنه محفوظ في إعدادات كريم', 'warn');
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


  // Gemini text models change names over time: try a short list, first that answers wins (20 s each).
  const MODELS = ['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-flash-lite-latest', 'gemini-3.5-flash'];
  async function gem(body, c) {
    let good = null; try { good = localStorage.getItem('kGood2'); } catch (e) {}
    let list = MODELS.slice();
    if (good && list.includes(good)) list = [good].concat(list.filter(m => m !== good));
    const fast = JSON.parse(JSON.stringify(body));
    fast.generationConfig = Object.assign({}, fast.generationConfig, { thinkingConfig: { thinkingLevel: 'low' } });
    let last = '';
    for (const m of list) {
      for (const b of [fast, body]) {
        const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 15000);
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(c.key)}`, { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
          clearTimeout(tm);
          if (!r.ok) { last = 'HTTP ' + r.status; console.warn('karim ai', m, r.status); if (r.status === 400 && b === fast) continue; break; }
          const j = await r.json();
          const t = ((((j.candidates || [])[0] || {}).content || {}).parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
          if (t) { try { localStorage.setItem('kGood2', m); } catch (e) {} return t; }
          last = 'empty'; break;
        } catch (e) { clearTimeout(tm); last = (e && e.name) || 'net'; console.warn('karim ai', m, last); break; }
      }
    }
    TP.toast('كريم مش قادر يوصل لجوجل (' + last + ') — اتأكد من النت وجرّب تاني', 'warn');
    return null;
  }
  TP.karimGem = gem;

  async function ask(history) {
    const c = await loadCfg();
    if (!c.key || c.on === false) return null;
    const contents = history.slice(-20).filter(m => m.f !== 'a').map(m => ({ role: m.f === 'c' ? 'user' : 'model', parts: [{ text: m.t }] }));
    return gem({ systemInstruction: { parts: [{ text: system() }] }, contents, generationConfig: { temperature: 0.8, maxOutputTokens: 2048 } }, c);
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
    const d0 = doc || {};
    const n = d0.day === today() ? (d0.n || 0) : 0;
    if (n >= MAX_DAY && !isOwner()) { TP.toast('كفاية النهارده 🙏 كمّل كلامك بكرة، وأستاذ أحمد شايف رسايلك'); return; }
    const msgs = (d0.msgs || []).concat({ f: 'c', t: text, at: TP.now() }).slice(-KEEP);
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
    if (autoSpeak || voiceTurn) speak(reply);
    voiceTurn = false;
  }


  // 🎤 voice message: record, Gemini writes down what was said, then Karim answers (and speaks back)
  let recorder = null, chunks = [];
  async function startRec(btn) {
    if (recorder) { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = []; recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const type = recorder.mimeType || 'audio/webm'; recorder = null; btn.textContent = '🎤'; btn.classList.remove('rec');
        const blob = new Blob(chunks, { type }); if (blob.size < 2000) { TP.toast('التسجيل قصير أوي، جرّب تاني'); return; }
        busy = true; draw(true);
        const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
        const c = await loadCfg(); let text = null;
        if (c.key) text = await gem({ contents: [{ parts: [{ inlineData: { mimeType: type.split(';')[0], data: b64 } }, { text: 'اكتب بالظبط الكلام اللي اتقال في التسجيل ده باللغة اللي اتقال بيها (غالباً عربي مصري)، من غير أي إضافة أو تعليق. لو مفيش كلام واضح اكتب: ...' }] }], generationConfig: { temperature: 0, maxOutputTokens: 2048 } }, c);
        busy = false;
        if (!text || text === '...') { draw(); TP.toast('مقدرتش أسمع الرسالة كويس، جرّب تاني'); return; }
        voiceTurn = true; send('🎤 ' + text);
      };
      recorder.start(); btn.textContent = '⏹️'; btn.classList.add('rec'); TP.toast('بيسجّل… اضغط تاني لما تخلص');
    } catch (e) { TP.toast('اسمح للتطبيق يستخدم المايك علشان تبعت رسالة صوتية', 'warn'); }
  }
  let voiceTurn = false;


  // 📞 مكالمة صوتية مع كريم: يسمعك → يفهم ويرد → يتكلم بصوته → يسمعك تاني… لحد ما تقفل.
  const call = { on: false, stream: null, rec: null, el: null };
  function callUi(state) {
    if (!call.el) return;
    const t = { listen: '🎙️ كريم بيسمعك… اتكلم', think: '🤔 كريم بيفكر…', speak: '🔊 كريم بيتكلم…' }[state] || '';
    call.el.querySelector('.kc-cs').textContent = t;
    call.el.querySelector('.kc-pulse').className = 'kc-pulse ' + state;
  }
  async function startCall() {
    if (call.on) return;
    try { call.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { TP.toast('اسمح للتطبيق يستخدم المايك علشان تكلّم كريم', 'warn'); return; }
    const c = await loadCfg(); if (!c.key) { endCall(); return; }
    call.on = true;
    call.el = document.createElement('div');
    call.el.className = 'kc-call';
    call.el.innerHTML = `<div class="kc-av big">🤖</div><b style="font-size:20px">كريم</b><div class="kc-pulse"></div><div class="kc-cs"></div><button class="btn btn-primary kc-end" type="button">📴 إنهاء المكالمة</button>`;
    document.body.appendChild(call.el);
    call.el.querySelector('.kc-end').onclick = endCall;
    try { if (TP.gvoice) await TP.gvoice.sayWait(isOwner() ? 'أهلاً يا أستاذ أحمد، أنا معاك، اتفضل.' : 'أهلاً يا ' + (first() || 'صاحبي') + '، أنا معاك، قول اللي في نفسك.'); } catch (e) { /* ignore */ }
    loop();
  }
  function endCall() {
    call.on = false;
    try { if (call.rec && call.rec.state !== 'inactive') call.rec.stop(); } catch (e) { /* ignore */ }
    try { call.stream && call.stream.getTracks().forEach(t => t.stop()); } catch (e) { /* ignore */ }
    try { TP.gvoice && TP.gvoice.stop(); } catch (e) { /* ignore */ }
    if (call.el) call.el.remove(); call.el = null; call.stream = null;
  }
  // records one sentence: starts when you speak, stops after ~1.3 s of silence (max 30 s)
  function hearOnce() {
    return new Promise(resolve => {
      const AC = window.AudioContext || window.webkitAudioContext, ac = new AC(), an = ac.createAnalyser();
      ac.createMediaStreamSource(call.stream).connect(an); an.fftSize = 1024;
      const data = new Uint8Array(an.fftSize), chunks = [];
      const rec = call.rec = new MediaRecorder(call.stream);
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => { ac.close(); resolve(spoke ? new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) : null); };
      let spoke = false, quietSince = 0; const t0 = Date.now();
      rec.start(250);
      const tick = () => {
        if (!call.on) { if (rec.state !== 'inactive') rec.stop(); return; }
        an.getByteTimeDomainData(data); let peak = 0; for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
        const now = Date.now();
        if (peak > 14) { spoke = true; quietSince = 0; } else if (spoke && !quietSince) quietSince = now;
        if ((spoke && quietSince && now - quietSince > 1300) || now - t0 > 30000 || (!spoke && now - t0 > 12000)) { if (rec.state !== 'inactive') rec.stop(); return; }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }
  async function loop() {
    while (call.on) {
      callUi('listen');
      const blob = await hearOnce();
      if (!call.on) break;
      if (!blob || blob.size < 3000) continue;
      callUi('think');
      const c = await loadCfg();
      const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
      const history = ((doc && doc.msgs) || []).slice(-16).filter(m => m.f !== 'a').map(m => ({ role: m.f === 'c' ? 'user' : 'model', parts: [{ text: m.t }] }));
      const raw = await gem({ systemInstruction: { parts: [{ text: system() + '\nدي مكالمة صوتية: ردك هيتقال بصوت، فخليه قصير (جملة أو اتنين أو تلاتة)، طبيعي زي الكلام، من غير رموز أو نقط مرقمة.' }] },
        contents: history.concat({ role: 'user', parts: [{ inlineData: { mimeType: (blob.type || 'audio/webm').split(';')[0], data: b64 } }, { text: 'ده تسجيل صوتي من الشخص. رجّع JSON بس: {"heard":"الكلام اللي اتقال بالظبط","reply":"ردك عليه"}' }] }),
        generationConfig: { temperature: 0.8, maxOutputTokens: 2048, responseMimeType: 'application/json' } }, c);
      if (!call.on) break;
      let heard = '', reply = '';
      try { const j = JSON.parse(raw); heard = (j.heard || '').trim(); reply = (j.reply || '').trim(); } catch (e) { reply = ''; }
      if (!reply) { callUi('speak'); await TP.gvoice.sayWait('معلش مسمعتكش كويس، قول تاني.'); continue; }
      let flag = !!(doc && doc.flag);
      if (/\[FLAG\]/i.test(reply)) { flag = true; reply = reply.replace(/\[FLAG\]/gi, '').trim(); }
      const d0 = doc || {}, n = d0.day === today() ? (d0.n || 0) : 0;
      const msgs = (d0.msgs || []).concat({ f: 'c', t: '🎤 ' + (heard || '…'), at: TP.now() }, { f: 'k', t: reply, at: TP.now() }).slice(-KEEP);
      save({ name: P().name || '', code: P().code || ROLE_NAMES[P().role] || '', day: today(), n: n + 1, flag, msgs, at: TP.now(), unread: !isOwner() }).catch(() => {});
      draw();
      callUi('speak');
      await TP.gvoice.sayWait(reply);
    }
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
    .kc-in .rec{background:#c83c3c;color:#fff}
    .kc-call{position:fixed;inset:0;z-index:9999;background:radial-gradient(circle at 50% 35%,#7a1428,#2a050d);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center;padding:20px}
    .kc-av.big{width:110px;height:110px;font-size:56px}
    .kc-cs{font-size:18px;min-height:28px}
    .kc-pulse{width:90px;height:90px;border-radius:50%;border:3px solid #c9a24a;opacity:.8}
    .kc-pulse.listen{animation:kcp 1.2s infinite}.kc-pulse.speak{animation:kcp .6s infinite;background:rgba(201,162,74,.25)}.kc-pulse.think{animation:kcp 2s infinite;opacity:.4}
    @keyframes kcp{0%{transform:scale(.85)}50%{transform:scale(1.1)}100%{transform:scale(.85)}}
    .kc-end{background:#c83c3c!important;font-size:18px;padding:14px 28px}
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
      <div class="kc-head"><div class="kc-av">🤖</div><div style="flex:1"><b>كريم</b><div class="small muted">مدير الذكاء الاصطناعي الافتراضي للشركة</div></div><button class="btn btn-primary" type="button" id="kcCall">📞 كلّمه بالصوت</button></div>
      ${notice}
      <label class="kc-opt"><input type="checkbox" id="kcAuto" ${autoSpeak ? 'checked' : ''}> 🔊 خلّي كريم يتكلم بصوت على طول</label>
      <div class="kc-list">
        <div class="kc-m kc-k"><div class="kc-who"><span>كريم</span><button class="kc-say" data-say="-1" title="اسمع">🔊</button></div>${hello}</div>
        ${msgs.map((m, i) => `<div class="kc-m kc-${m.f}">${m.f === 'c' ? '' : `<div class="kc-who"><span>${m.f === 'a' ? 'أستاذ أحمد سمير' : 'كريم'}</span><button class="kc-say" data-say="${i}" title="اسمع">🔊</button></div>`}${esc(m.t)}</div>`).join('')}
        ${typing || busy ? '<div class="kc-typing">كريم بيكتب…</div>' : ''}
      </div>
      <div class="kc-in"><button class="btn" type="button" id="kcMic" title="رسالة صوتية" style="font-size:20px">🎤</button><textarea class="kc-t" placeholder="اكتب لكريم… أو اضغط 🎤 واتكلم" maxlength="1500"></textarea><button class="btn btn-primary" type="button" id="kcSend">إرسال</button></div>
      ${isOps() ? `<div class="kc-note" style="margin-top:4px"><b>📣 رسالة للكباتن عن طريق كريم</b> (هيوصّلها في محادثاته معاهم لمدة أسبوع، باسمك)
        <textarea id="kcNote" rows="2" style="width:100%;margin-top:6px" placeholder="مثلاً: ذكّر الكباتن بفحص العربية قبل الطلوع"></textarea>
        <button class="btn" type="button" id="kcNoteSave" style="margin-top:6px">ابعت لكريم</button></div>` : ''}
    </div>`;
    const ta = root.querySelector('textarea.kc-t'); ta.value = draft;
    root.querySelector('#kcSend').onclick = () => { const v = ta.value; ta.value = ''; send(v); };
    root.querySelector('#kcMic').onclick = e => startRec(e.currentTarget);
    root.querySelector('#kcCall').onclick = startCall;
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
