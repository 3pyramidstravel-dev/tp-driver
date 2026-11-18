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

  function render(root) {
    sub();
    if (!st.list) { root.innerHTML = '<section class="card"><p class="muted">بيحمّل…</p></section>'; return; }
    const passed = st.list.filter(t => t.quiz && t.quiz.passed).length;
    root.innerHTML = `<section class="card">
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
