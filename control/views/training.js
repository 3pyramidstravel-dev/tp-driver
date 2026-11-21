/* ==========================================================================
   تدريب الكباتن — each tourism captain's progress in the driver app's
   "التدريب" tab (agreed 19 Nov): lessons, final test, phrases learned.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const st = { list: null, unsub: null };
  const PHRASES = 17;

  function sub() {
    if (st.unsub) return;
    st.unsub = TP.fb.onCol('training', {}, l => { st.list = l.sort((a, b) => (b.at || 0) - (a.at || 0)); TP.rerender && TP.rerender(); },
      e => { console.warn('training', e && e.code); st.list = []; TP.rerender && TP.rerender(); });
  }

  // "رسالة كريم لمحمد أيمن" — one idea + one encouragement a day (agreed 21 Nov)
  const AYMAN = [
    ['اعمل "كابتن الأسبوع": أحسن كابتن في الالتزام والتقييم ياخد شهادة تقدير ونور تعمل عنه بوست.', 'كل رحلة بتعدي من غير مشكلة هي شغلك انت يا أستاذ محمد. شكراً على تعبك.'],
    ['اتصل بكابتنين النهارده مش عشان شغل، بس تسأل عليهم. الكلمة الطيبة بتفرق.', 'الكباتن بيتعلموا منك قبل ما يتعلموا من أي تدريب.'],
    ['راجع مع كل كابتن سياحة فحص العربية الصبح لمدة أسبوع لحد ما يبقى عادة.', 'العربية السليمة = ضيف مبسوط = عميل بيكمل معانا. انت حامي ده كله.'],
    ['اعمل جدول بأكتر 3 مطارات/فنادق بنروحها، ووقت الطريق الحقيقي لكل واحد في الزحمة.', 'التنظيم اللي بتعمله هو اللي بيخلي اسم ثري بيراميدز يعلى.'],
    ['شجّع الكباتن يخلّصوا امتحان التدريب: اللي يعدّي 8 من 10 تهنّيه قدام الكل.', 'نجاح 2027 بيبدأ من الفريق اللي انت بتبنيه النهارده.'],
    ['اسأل كل كابتن: إيه أكتر حاجة بتضايقك في الشغل؟ واكتب الرد لأستاذ أحمد.', 'الكابتن اللي حاسس إن مديره سامعه بيشتغل بقلبه.'],
    ['جرّب "تأكيد قبل الميعاد بساعتين" يبقى مكالمة قصيرة منك لكل مشوار مطار مهم.', 'الالتزام اللي بتزرعه بيظهر في تقييم كل عميل.'],
    ['خلي كل كابتن يقول جملة الإنجليزي بتاعة اليومين قدامك، وشجّعه حتى لو نطقه مش مظبوط.', 'انت مش بس مدير تشغيل، انت قدوة للكباتن.'],
    ['حضّر "شنطة طوارئ" في كل عربية سياحة: مية، مناديل، شاحن، شمسية.', 'تفاصيلك الصغيرة هي اللي بتخلي الضيف يفتكرنا.'],
    ['بعد أي شكوى، اقعد مع الكابتن 5 دقايق: إيه اللي حصل، ونتعلم إيه، من غير لوم.', 'الهدوء بتاعك في المشاكل بيطمّن الفريق كله.'],
    ['اعمل مسابقة صغيرة: أنضف عربية في الأسبوع، والكابتن ياخد مكافأة رمزية.', 'شكراً إنك شايل الشغل على كتافك كل يوم.'],
    ['راجع مع الكباتن رسالة "صورة المندوب بالساين" للضيف: لازم تتبعت أول ما يوصل المطار.', 'العملاء بيشكروا في المتابعة، والمتابعة دي انت.'],
    ['حدد كابتن "خبير" يساعد الكباتن الجداد في أول أسبوع.', 'كل كابتن بيتطور هو نجاح ليك قبل أي حد.'],
    ['اسأل الكباتن عن أفكارهم لتحسين الخدمة، وأحسن فكرة تتنفذ باسم صاحبها.', 'الفريق اللي بيشارك في القرار بيحافظ عليه.']
  ];
  function aymanCard() {
    const i = Math.floor(TP.now() / 86400000) % AYMAN.length, a = AYMAN[i];
    return `<section class="card"><div class="card-head"><h3>💡 رسالة كريم لمحمد أيمن النهارده</h3></div>
      <p style="margin:6px 0"><b>فكرة:</b> ${esc(a[0])}</p><p class="small" style="margin:6px 0">💪 ${esc(a[1])}</p></section>`;
  }

  function render(root) {
    sub();
    if (!st.list) { root.innerHTML = '<section class="card"><p class="muted">بيحمّل…</p></section>'; return; }
    const passed = st.list.filter(t => t.quiz && t.quiz.passed).length;
    root.innerHTML = aymanCard() + `<section class="card">
      <div class="card-head"><h3>تدريب كباتن السياحة</h3><span class="st ${passed === st.list.length && passed ? 'st-ok' : 'st-warn'}">${passed} معتمد من ${st.list.length}</span></div>
      <p class="small muted" style="margin-bottom:10px">كريم بيدرّب الكباتن من تبويب "التدريب" في تطبيق السواق، وبيديهم جملة إنجليزي جديدة كل يومين.</p>
      ${st.list.length ? st.list.map(t => {
        const q = t.quiz || {}, n = (t.learned || []).length;
        const late = t.intro && ((Math.min(PHRASES, Math.floor((TP.now() - (t.start || TP.now())) / 172800000) + 1) - n) >= 2 || (!t.lessonsDone && TP.now() - (t.start || TP.now()) > 259200000));
        const stt = late ? ['⚠️ مش ملتزم — كريم نبّهه', 'st-danger'] : q.passed ? ['معتمد ✓', 'st-ok'] : t.lessonsDone ? ['خلص الدروس — مستني الاختبار', 'st-info'] : t.intro ? ['بيتدرب', 'st-warn'] : ['لسه مبدأش', 'st-danger'];
        return `<div class="gm"><div class="gm-h"><b>${esc((t.code ? t.code + ' · ' : '') + (t.name || '—'))}</b><span class="st ${stt[1]}">${stt[0]}</span></div>
          <p class="small" style="margin:6px 0">📝 الاختبار: ${q.tries ? `آخر درجة ${q.score}/10 · أحسن درجة ${q.best}/10 · ${q.tries} محاولة` : 'لسه'}
            · 🗣️ حفظ ${n} من ${PHRASES} جملة · آخر نشاط ${esc(t.at ? TP.ago(t.at) : '—')}</p></div>`;
      }).join('') : '<p class="muted">لسه مفيش كابتن فتح التدريب.</p>'}
    </section>`;
    TP.hydrateIcons && TP.hydrateIcons(root);
  }

  TP.views = TP.views || {};
  TP.views.training = { render };
})(window.TP = window.TP || {});
