/* ==========================================================================
   التدريب — tourism captains only (agreed 19 Nov).
   Karim (the AI general manager) introduces himself, short lesson screens with
   a check question after each part, a 10-question final test (8+ = معتمد),
   and "جملة اليومين": one English phrase every two days, read aloud by the
   phone's own English voice (free; silent if the phone has none).
   Progress is one doc per captain: training/{personId}.
   ========================================================================== */
(function (TP) {
  'use strict';
  const esc = TP.esc;
  const S = TP.session;
  const PASS = 8;

  const LESSONS = [
    { part: 'قبل المهمة', icon: '⏰', t: 'اتحرك بدري', b: 'تتحرك قبل وصول الطيارة بساعة وربع. الضيف عمره ما يستناك — إحنا اللي نستنى الضيف.' },
    { part: 'قبل المهمة', icon: '🔧', t: 'افحص عربيتك قبل ما تطلع', b: 'زيت · مية · هوا الكاوتش · الفرامل · النور. ولو في أي صوت أو لمبة غريبة بلّغ مديرك قبل الطلوع، مش بعد.' },
    { part: 'قبل المهمة', icon: '✨', t: 'العربية نضيفة من جوه وبره', b: 'ريحة حلوة، مفيش حاجة على الكراسي، مية متلجة للضيف، والتكييف شغال قبل ما يركب.' },
    { part: 'قبل المهمة', icon: '⛽', t: 'البنزين والعهدة', b: 'اتأكد إن رصيد كارت البنزين وعهدة المصاريف كفاية للمشوار. لو قلّوا اطلب من مديرك من التطبيق قبلها بوقت.' },
    { part: 'في المطار', icon: '👔', t: 'مظهرك هو أول حاجة الضيف بيشوفها', b: 'لبس نضيف ومكوي، ريحة حلوة، وابتسامة. انت وش ثري بيراميدز قدام الشركات العالمية.' },
    { part: 'في المطار', icon: '🪧', t: 'اليافطة باسم الضيف', b: 'تقف قدام الصالة باليافطة واضحة، وتصوّرها وتبعتها زي ما متعودين. التليفون في جيبك، مش في إيدك وانت مستني.' },
    { part: 'في المطار', icon: '🧳', t: 'الشنط والاستقبال', b: 'تسلّم بابتسامة وتقول Welcome to Egypt، وتشيل الشنط بنفسك، وتمشي قدام الضيف للعربية.' },
    { part: 'مع الضيف', icon: '🛡️', t: 'الأمان أولاً', b: 'حزام الأمان ليك وللضيف، سرعة هادية، ممنوع التليفون وانت سايق. وبحد أقصى 3 ركاب في العربية.' },
    { part: 'مع الضيف', icon: '🤫', t: 'خصوصية الضيف', b: 'متسألش أسئلة شخصية، ومتتكلمش في التليفون بصوت عالي، وأي حاجة بتتقال في العربية تفضل في العربية.' },
    { part: 'مع الضيف', icon: '✈️', t: 'لو الطيارة اتأخرت أو جت بدري', b: 'التطبيق بيتابع الطيارة وبينبّهك. لو جالك تنبيه إنها جاية بدري اتحرك فوراً، ولو حصل أي تأخير منك بلّغ الإدارة على طول.' },
    { part: 'عربيتك', icon: '🚗', t: 'العربية أمانة معاك', b: 'كل كابتن ثابت على عربيته. سواقة هادية من غير فرامل مفاجئة ولا دوس عنيف = عربية تعيش أكتر وضيف مرتاح.' },
    { part: 'عربيتك', icon: '🔔', t: 'بلّغ عن أي عطل فوراً', b: 'من زرار SOS أو لمديرك. عطل صغير بيتصلح بسرعة، لكن لو اتساب بيكبر ويوقّف العربية في نص مشوار.' }
  ];
  // a check question after each part
  const CHECKS = {
    'قبل المهمة': { q: 'تتحرك للمطار قبل وصول الطيارة بقد إيه؟', o: ['ربع ساعة', 'ساعة وربع', 'لما الضيف يكلمني'], a: 1 },
    'في المطار': { q: 'وانت مستني الضيف قدام الصالة، التليفون يبقى فين؟', o: ['في إيدي أتفرج عليه', 'في جيبي واليافطة في إيدي', 'في العربية'], a: 1 },
    'مع الضيف': { q: 'أقصى عدد ركاب في العربية الملاكي؟', o: ['3', '4', 'على حسب الشنط'], a: 0 },
    'عربيتك': { q: 'سمعت صوت غريب في العربية الصبح، تعمل إيه؟', o: ['أكمّل وأشوفه بعدين', 'أبلّغ مديرك قبل ما أطلع', 'أعلّي الراديو'], a: 1 }
  };
  const FINAL = [
    { q: 'الضيف وصل وانت لسه في الطريق — مين الغلطان؟', o: ['الضيف', 'الطيارة', 'أنا — لازم أكون هناك قبله'], a: 2 },
    { q: 'أول جملة تقولها للضيف؟', o: ['Welcome to Egypt', 'Hurry up', 'Where is your money?'], a: 0 },
    { q: 'مين يشيل شنط الضيف؟', o: ['الضيف', 'أنا', 'الشيال'], a: 1 },
    { q: 'الفحص اليومي للعربية بيكون إمتى؟', o: ['آخر الشهر', 'قبل ما أطلع كل يوم', 'لما تعطل'], a: 1 },
    { q: 'رصيد كارت البنزين قليل وعندك مشوار بكرة الصبح؟', o: ['أطلب من مديرك من النهارده', 'أستنى لبكرة', 'أدفع من جيبي وخلاص'], a: 0 },
    { q: 'الضيف بيتكلم في التليفون في العربية؟', o: ['أشاركه الكلام', 'أوطّي الراديو وما أتدخلش', 'أعلّي الراديو'], a: 1 },
    { q: 'جالك تنبيه إن الطيارة جاية بدري؟', o: ['أتحرك فوراً', 'أكمّل فطاري', 'أكلم الضيف أقوله يستنى'], a: 0 },
    { q: 'حزام الأمان؟', o: ['للضيف بس', 'ليا وللضيف', 'مش مهم في المدينة'], a: 1 },
    { q: 'مظهرك وانت مستني الضيف؟', o: ['أي لبس مريح', 'نضيف ومكوي وريحة حلوة', 'مش فارقة'], a: 1 },
    { q: '"Please fasten your seatbelt" معناها؟', o: ['من فضلك اربط الحزام', 'من فضلك انزل', 'العربية وصلت'], a: 0 }
  ];
  const PHRASES = [
    ['Welcome to Egypt', 'ويلكم تو إيجيبت', 'أهلاً بيك في مصر'],
    ['I am your driver from Three Pyramids', 'آي آم يور درايفر فروم ثري بيراميدز', 'أنا السواق بتاعك من ثري بيراميدز'],
    ['May I take your bag?', 'ماي آي تيك يور باج؟', 'ممكن أشيل شنطتك؟'],
    ['Please follow me', 'بليز فولو مي', 'اتفضل ورايا'],
    ['The car is this way', 'ذا كار إز ذيس واي', 'العربية من هنا'],
    ['Please fasten your seatbelt', 'بليز فاسن يور سيت بِلت', 'من فضلك اربط الحزام'],
    ['Is the temperature okay?', 'إز ذا تمبريتشر أوكي؟', 'التكييف مظبوط كده؟'],
    ['Would you like some water?', 'وود يو لايك سام ووتر؟', 'تحب شوية مية؟'],
    ['We will arrive in 30 minutes', 'وي ويل أرايف إن ثيرتي مينتس', 'هنوصل كمان نص ساعة'],
    ['The traffic is heavy today', 'ذا ترافيك إز هيڤي توداي', 'الزحمة جامدة النهارده'],
    ['Do you need to stop?', 'دو يو نيد تو ستوب؟', 'محتاج نقف في حتة؟'],
    ['We have arrived at your hotel', 'وي هاف أرايفد آت يور هوتيل', 'وصلنا الفندق'],
    ['Please check you have everything', 'بليز تشيك يو هاف إيڤري ثينج', 'اتأكد إن معاك كل حاجتك'],
    ['Have a nice day', 'هاف آ نايس داي', 'يومك سعيد'],
    ['See you tomorrow, same time', 'سي يو تومورو، سيم تايم', 'أشوفك بكرة نفس المعاد'],
    ['Sorry for the delay', 'سوري فور ذا ديلاي', 'آسف على التأخير'],
    ['Your flight is early, I am coming now', 'يور فلايت إز إيرلي، آي آم كامينج ناو', 'طيارتك جت بدري، أنا جاي حالاً']
  ];
  const DAY = 86400000;
  const KARIM = () => `أهلاً يا كابتن ${(S.person.name || '').split(' ')[0]}. أنا كريم، المدير العام للذكاء الاصطناعي في ثري بيراميدز ترافيل. أنا برنامج ذكاء اصطناعي، وشغلتي إني أساعدك تبقى أحسن كابتن في الشركة. هنتعلم مع بعض شغل المطار، والحفاظ على عربيتك، وكل يومين جملة إنجليزي جديدة. خد وقتك، ويلا نبدأ.`;

  let doc = null, unsub = null, ui = { view: 'home', i: 0, ans: null, final: [], pick: null }, root = null;

  const pid = () => S.person && S.person.id;
  const path = () => 'training/' + pid();
  async function save(patch) {
    doc = Object.assign({}, doc || {}, patch);
    try { await TP.fb.set(path(), Object.assign({ name: S.person.name || '', code: S.person.code || '', at: TP.now() }, patch), true); }
    catch (e) { console.warn('training save', e && e.code); TP.toast('مقدرتش أحفظ — اتأكد من النت', 'warn'); }
  }
  function sub() {
    if (unsub || !pid()) return;
    unsub = TP.fb.onDoc(path(), d => { doc = d || {}; if (root) draw(); }, () => { doc = doc || {}; if (root) draw(); });
  }
  const parts = () => Array.from(new Set(LESSONS.map(l => l.part)));
  const phraseCount = () => {
    if (!doc || !doc.start) return 1;
    return Math.min(PHRASES.length, Math.floor((TP.now() - doc.start) / (2 * DAY)) + 1);
  };
  const learned = () => (doc && doc.learned) || [];

  function speak(text) {
    const ss = window.speechSynthesis; if (!ss) { TP.toast('الموبايل ده مفيهوش صوت إنجليزي'); return; }
    try {
      ss.cancel();
      const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 0.8;
      const v = ss.getVoices().find(x => /^en/i.test(x.lang || '')); if (v) u.voice = v;
      ss.speak(u);
    } catch (e) { /* silent */ }
  }

  const css = `<style>
    .tr-hero{text-align:center;padding:18px 14px}
    .tr-hero .k{font-size:42px}
    .tr-big{font-size:20px;font-weight:800;margin:6px 0}
    .tr-ph{direction:ltr;text-align:center;font-size:22px;font-weight:800;margin:8px 0}
    .tr-pr{text-align:center;font-size:18px;color:var(--gold,#c9a24a);font-weight:700}
    .tr-mn{text-align:center;opacity:.8;margin-top:4px}
    .tr-opt{display:block;width:100%;text-align:right;margin:8px 0;padding:12px;border-radius:12px;border:1px solid rgba(201,162,74,.4);background:rgba(255,255,255,.04);color:inherit;font:inherit;font-size:16px}
    .tr-opt.ok{background:rgba(46,160,90,.25);border-color:#2ea05a}.tr-opt.no{background:rgba(200,60,60,.25);border-color:#c83c3c}
    .tr-row{display:flex;gap:8px;margin-top:12px}.tr-row .btn{flex:1}
    .tr-bar{height:6px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden;margin:10px 0}.tr-bar i{display:block;height:100%;background:var(--gold,#c9a24a)}
    .tr-badge{display:inline-block;padding:4px 12px;border-radius:20px;background:#2ea05a;color:#fff;font-weight:800}
  </style>`;

  // behind = 2+ phrases not marked, or lessons not done 3 days after starting
  const behind = () => !!(doc && doc.intro && ((phraseCount() - learned().length) >= 2 || (!doc.lessonsDone && TP.now() - (doc.start || TP.now()) > 3 * DAY)));
  const WARN = 'يا كابتن، أنا لاحظت إنك مش ملتزم بالتدريب. لو فضل الوضع كده، هضطر أبلّغ مستر أحمد سمير ومدير التشغيل محمد أيمن إنك مش مهتم بالتدريب.';
  function home() {
    if (!doc.intro) return intro();
    const warn = behind() ? `<section class="glass card" style="border:1px solid #c83c3c"><b>⚠️ كريم:</b> ${esc(WARN)}
        <div class="tr-row"><button type="button" class="btn btn-ghost" data-warnsay>🔊 اسمع</button></div></section>` : '';
    const n = phraseCount(), ph = PHRASES[n - 1], got = learned().includes(n - 1);
    const lessonsDone = !!doc.lessonsDone, q = doc.quiz || {};
    return warn + `<section class="glass card">
        <div class="small muted">🗣️ كريم: ${got ? 'برافو عليك، استنى الجملة الجاية' : 'صباح الخير يا كابتن، جملة النهارده هتنفعك مع الضيوف 👇'}</div>
        <div class="small muted">جملة اليومين — رقم ${n} من ${PHRASES.length}</div>
        <div class="tr-ph">${esc(ph[0])}</div><div class="tr-pr">${esc(ph[1])}</div><div class="tr-mn">${esc(ph[2])}</div>
        <div class="tr-row"><button type="button" class="btn btn-ghost" data-say="${n - 1}">🔊 اسمع</button>
          ${got ? '<button type="button" class="btn btn-ghost" disabled>حفظتها ✓</button>' : `<button type="button" class="btn btn-primary" data-got="${n - 1}">حفظتها ✓</button>`}</div>
        <div class="small muted" style="margin-top:8px">حفظت ${learned().length} جملة · الجملة الجاية بعد ${2 - Math.floor(((TP.now() - (doc.start || TP.now())) % (2 * DAY)) / DAY)} يوم</div>
        ${learned().length >= 3 ? '<div class="tr-row"><button type="button" class="btn btn-ghost" data-go="review">📝 راجع الجمل اللي حفظتها</button></div>' : ''}
        ${n > 1 ? '<div class="tr-row"><button type="button" class="btn btn-ghost" data-go="list">📚 كل الجمل</button></div>' : ''}
      </section>
      <section class="glass card">
        <div class="tr-big">📚 تدريب الكابتن</div>
        ${q.passed ? `<p><span class="tr-badge">كابتن معتمد ✓</span> <span class="small muted">درجتك ${q.score}/10</span></p>` : ''}
        <p class="small muted">${lessonsDone ? 'خلصت الدروس ✓' : LESSONS.length + ' شاشة قصيرة + سؤال بعد كل جزء'}</p>
        <div class="tr-row"><button type="button" class="btn ${lessonsDone ? 'btn-ghost' : 'btn-primary'}" data-go="lesson">${lessonsDone ? 'راجع الدروس' : 'ابدأ التدريب'}</button>
          ${lessonsDone ? `<button type="button" class="btn ${q.passed ? 'btn-ghost' : 'btn-primary'}" data-go="final">${q.passed ? 'اختبار تاني' : 'الاختبار النهائي'}</button>` : ''}</div>
      </section>`;
  }
  function intro() {
    return `<section class="glass card tr-hero"><div class="k">👋</div>
      <div class="tr-big">أهلاً يا كابتن ${esc((S.person.name || '').split(' ')[0])}</div>
      <p>أنا <b>كريم</b>، المدير العام للذكاء الاصطناعي في ثري بيراميدز ترافيل.</p>
      <p class="small muted">أنا مش شخص حقيقي — أنا برنامج ذكاء اصطناعي، وشغلتي إني أساعدك تبقى أحسن كابتن في الشركة.</p>
      <div style="text-align:right;margin:12px 0">
        <p>📚 تدريب قصير على شغل المطار والحفاظ على عربيتك</p>
        <p>🗣️ كل يومين جملة إنجليزي جديدة تحتاجها مع الضيوف — تسمعها وتحفظها براحتك</p>
        <p>✅ أسئلة بسيطة نتأكد بيها إننا فاهمين</p></div>
      <p class="small muted">خد وقتك، ومفيش حاجة صعبة. ولو في حاجة مش واضحة كلّم مديرك على طول.</p>
      <button type="button" class="btn btn-ghost" data-karim style="width:100%;margin-top:10px">🔊 اسمع كريم</button>
      <button type="button" class="btn btn-primary" data-intro style="width:100%;margin-top:10px">يلا نبدأ</button></section>`;
  }
  function lesson() {
    const L = LESSONS[ui.i], pct = Math.round((ui.i + 1) / LESSONS.length * 100);
    return `<section class="glass card"><div class="small muted">${esc(L.part)} · ${ui.i + 1} من ${LESSONS.length}</div>
      <div class="tr-bar"><i style="width:${pct}%"></i></div>
      <div class="tr-hero"><div class="k">${L.icon}</div><div class="tr-big">${esc(L.t)}</div><p>${esc(L.b)}</p></div>
      <div class="tr-row">${ui.i ? '<button type="button" class="btn btn-ghost" data-prev>السابق</button>' : '<button type="button" class="btn btn-ghost" data-go="home">رجوع</button>'}
        <button type="button" class="btn btn-primary" data-next>التالي</button></div></section>`;
  }
  function question(Q, done) {
    return `${Q.o.map((o, k) => {
      const cls = ui.ans === null ? '' : k === Q.a ? 'ok' : k === ui.ans ? 'no' : '';
      return `<button type="button" class="tr-opt ${cls}" data-ans="${k}" ${ui.ans !== null ? 'disabled' : ''}>${esc(o)}</button>`;
    }).join('')}
    ${ui.ans === null ? '' : `<p class="small" style="margin-top:6px">${ui.ans === Q.a ? '✓ برافو عليك' : '✗ الإجابة الصح متعلّمة بالأخضر'}</p><button type="button" class="btn btn-primary" data-cont style="width:100%;margin-top:8px">${done}</button>`}`;
  }
  function check() {
    const Q = CHECKS[LESSONS[ui.i].part];
    return `<section class="glass card"><div class="small muted">سؤال سريع ✋</div><div class="tr-big">${esc(Q.q)}</div>${question(Q, 'كمّل')}</section>`;
  }
  function final() {
    const Q = FINAL[ui.i];
    return `<section class="glass card"><div class="small muted">الاختبار النهائي · سؤال ${ui.i + 1} من ${FINAL.length}</div>
      <div class="tr-bar"><i style="width:${Math.round(ui.i / FINAL.length * 100)}%"></i></div>
      <div class="tr-big">${esc(Q.q)}</div>${question(Q, ui.i + 1 < FINAL.length ? 'السؤال اللي بعده' : 'النتيجة')}</section>`;
  }
  function result() {
    const score = ui.final.filter(Boolean).length, ok = score >= PASS;
    return `<section class="glass card tr-hero"><div class="k">${ok ? '🏆' : '💪'}</div>
      <div class="tr-big">${score} من ${FINAL.length}</div>
      ${ok ? '<p><span class="tr-badge">كابتن معتمد من ثري بيراميدز ✓</span></p><p>مبروك يا كابتن — الإدارة وصلها اعتمادك.</p>' : `<p>محتاج ${PASS} على الأقل. راجع الدروس وجرّب تاني — مفيش أي مشكلة.</p>`}
      <button type="button" class="btn btn-primary" data-go="home" style="width:100%;margin-top:10px">تمام</button></section>`;
  }
  function review() {
    const Q = ui.pick;
    return `<section class="glass card"><div class="small muted">📝 مراجعة — اختار المعنى الصح</div>
      <div class="tr-ph">${esc(PHRASES[Q.idx][0])}</div>
      <div class="tr-row" style="margin:0 0 6px"><button type="button" class="btn btn-ghost" data-say="${Q.idx}">🔊 اسمع</button></div>
      ${question(Q, 'سؤال تاني')}<button type="button" class="btn btn-ghost" data-go="home" style="width:100%;margin-top:8px">خلاص كده</button></section>`;
  }
  function list() {
    const n = phraseCount();
    return `<section class="glass card"><div class="tr-big">📚 الجمل لحد دلوقتي</div>
      ${PHRASES.slice(0, n).map((p, k) => `<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)">
        <div style="direction:ltr;font-weight:800">${esc(p[0])}</div><div class="small">${esc(p[1])} — <span class="muted">${esc(p[2])}</span></div>
        <button type="button" class="btn btn-ghost btn-sm" data-say="${k}" style="margin-top:4px">🔊 اسمع</button></div>`).join('')}
      <button type="button" class="btn btn-primary" data-go="home" style="width:100%;margin-top:10px">رجوع</button></section>`;
  }
  function newReview() {
    const pool = learned(); const idx = pool[Math.floor(Math.random() * pool.length)];
    const others = PHRASES.map((p, k) => k).filter(k => k !== idx).sort(() => Math.random() - .5).slice(0, 2);
    const opts = [idx].concat(others).sort(() => Math.random() - .5);
    ui.pick = { idx, o: opts.map(k => PHRASES[k][2]), a: opts.indexOf(idx) }; ui.ans = null;
  }

  function draw() {
    if (!root) return;
    if (!doc) { root.innerHTML = '<section class="glass card"><p class="muted">بيحمّل…</p></section>'; return; }
    const V = { home, lesson, check, final, result, review, list }[ui.view] || home;
    root.innerHTML = css + V();
    bind();
  }
  function bind() {
    const on = (sel, fn) => TP.$$(sel, root).forEach(b => b.onclick = () => fn(b));
    on('[data-intro]', () => { save({ intro: true, start: (doc && doc.start) || TP.now() }); ui.view = 'home'; draw(); });
    on('[data-warnsay]', () => { if (TP.voice) TP.voice.speak(WARN); });
    on('[data-karim]', () => { if (TP.voice) TP.voice.speak(KARIM()); });
    on('[data-say]', b => speak(PHRASES[+b.dataset.say][0]));
    on('[data-got]', b => { const k = +b.dataset.got; if (!learned().includes(k)) save({ learned: learned().concat(k) }); TP.toast('برافو ✓'); draw(); });
    on('[data-go]', b => {
      const g = b.dataset.go; ui.ans = null; ui.i = 0;
      if (g === 'final') ui.final = [];
      if (g === 'review') newReview();
      ui.view = g; draw(); window.scrollTo(0, 0);
    });
    on('[data-prev]', () => { ui.i = Math.max(0, ui.i - 1); draw(); });
    on('[data-next]', () => {
      const L = LESSONS[ui.i], nx = LESSONS[ui.i + 1];
      if (!nx || nx.part !== L.part) { ui.view = 'check'; ui.ans = null; } else ui.i++;
      draw(); window.scrollTo(0, 0);
    });
    on('[data-ans]', b => {
      ui.ans = +b.dataset.ans;
      if (ui.view === 'final') ui.final[ui.i] = ui.ans === FINAL[ui.i].a;
      draw();
    });
    on('[data-cont]', () => {
      if (ui.view === 'check') {
        ui.ans = null;
        if (ui.i + 1 >= LESSONS.length) { save({ lessonsDone: true }); ui.view = 'home'; ui.i = 0; }
        else { ui.i++; ui.view = 'lesson'; }
      } else if (ui.view === 'final') {
        ui.ans = null;
        if (ui.i + 1 < FINAL.length) ui.i++;
        else {
          const score = ui.final.filter(Boolean).length, passed = score >= PASS, prev = (doc && doc.quiz) || {};
          save({ quiz: { score, passed: passed || !!prev.passed, at: TP.now(), tries: (prev.tries || 0) + 1, best: Math.max(score, prev.best || 0) } });
          ui.view = 'result';
        }
      } else if (ui.view === 'review') newReview();
      draw(); window.scrollTo(0, 0);
    });
  }

  TP.dvTrain = {
    available: () => !!(S.person && S.person.driverKind === 'tourism'),
    render(el) { root = el; sub(); draw(); },
    behind,
    newPhrase: () => !!(doc && doc.intro && !learned().includes(phraseCount() - 1))
  };
})(window.TP = window.TP || {});
