/* ==========================================================================
   The driver's spoken encouragement (agreed 8 Nov) — the phone's own
   text-to-speech, free, no download. The chairman picks it in "تعديل التطبيق":
   on/off, a woman's or a man's voice, and a style (حماسي / هادي وواثق / رسمي).
   The words come from the editable texts (vNew, vSoon, vAccepted, vDone, vMorning).
   Anything missing (no speech on the phone, no Arabic voice) → silent, never an error.
   ========================================================================== */
(function (TP) {
  'use strict';
  const SS = typeof window !== 'undefined' && window.speechSynthesis;
  // rate / pitch per style; a woman's voice sits a little higher, a man's a little lower
  const STYLES = { hype: { rate: 1.08, pitch: 1.15 }, calm: { rate: 0.92, pitch: 1.0 }, formal: { rate: 0.98, pitch: 0.95 } };
  const FEMALE = /female|woman|laila|layla|mariam|maryam|salma|hoda|huda|zeina|zina|amira|amina|fatima|noura|nora|sara|yasmin|dalia|rana|hala|lana|-f\b|#female/i;
  const MALE = /\bmale\b|man\b|maged|majed|tarik|tariq|naayf|hamed|shakir|omar|ahmed|khalid|hamdan|fahd|youssef|-m\b|#male/i;
  let voices = [];
  const loadVoices = () => { try { voices = SS ? SS.getVoices() : []; } catch (e) { voices = []; } };
  if (SS) { loadVoices(); try { SS.addEventListener ? SS.addEventListener('voiceschanged', loadVoices) : (SS.onvoiceschanged = loadVoices); } catch (e) { /* old browser */ } }

  const hasAr = () => { if (!voices.length) loadVoices(); return voices.some(v => /^ar/i.test(v.lang || '')); };
  const cfg = () => Object.assign({ on: true, gender: 'f', style: 'hype' }, (TP.appTexts && TP.appTexts.voice) || {});

  /** The best Arabic voice for the chosen gender (Egyptian first); null → the phone's default Arabic. */
  function pick(gender) {
    const ar = voices.filter(v => /^ar/i.test(v.lang || ''));
    if (!ar.length) return null;
    const want = gender === 'm' ? MALE : FEMALE, avoid = gender === 'm' ? FEMALE : MALE;
    const eg = v => /EG|arz/i.test((v.lang || '') + ' ' + (v.name || '') + ' ' + (v.voiceURI || ''));
    const named = v => want.test((v.name || '') + ' ' + (v.voiceURI || ''));
    const bad = v => avoid.test((v.name || '') + ' ' + (v.voiceURI || ''));
    return ar.find(v => named(v) && eg(v)) || ar.find(named) || ar.find(v => eg(v) && !bad(v)) || ar.find(v => !bad(v)) || ar[0];
  }

  /** Speaks a text now (any earlier one stops). force: speak even if switched off (the chairman's "اسمع").
   *  Phones are fussy (Chrome on Android goes silent with some voices, or right after cancel()): speak
   *  after a short pause, and if the chosen voice does not start within 1.5 s, say it again with the
   *  phone's own Arabic voice. */
  function speak(text, opt) {
    opt = opt || {};
    const c = Object.assign(cfg(), opt.cfg || {});
    if (!SS || !text || (!c.on && !opt.force)) return false;
    try {
      if (!voices.length) loadVoices();
      const st = STYLES[c.style] || STYLES.hype, v = pick(c.gender), msg = String(text).slice(0, 400);
      const make = withVoice => {
        const u = new SpeechSynthesisUtterance(msg);
        u.lang = (withVoice && v && v.lang) || 'ar-EG';
        if (withVoice && v) u.voice = v;
        u.volume = 1;                                                               // the loudest the app may ask for
        u.rate = st.rate;
        const known = withVoice && v && (FEMALE.test(v.name + ' ' + v.voiceURI) || MALE.test(v.name + ' ' + v.voiceURI));
        u.pitch = Math.max(0.5, Math.min(2, st.pitch * (known ? 1 : (c.gender === 'm' ? 0.8 : 1.2))));
        return u;
      };
      const go = withVoice => {
        const u = make(withVoice); let started = false;
        u.onstart = () => { started = true; if (opt.report) opt.report({ ok: true, voice: (withVoice && v && v.name) || '', ar: hasAr() }); };
        u.onerror = e => { if (!started && withVoice) return go(false); if (!started && opt.report) opt.report({ ok: false, err: (e && e.error) || 'error', ar: hasAr() }); };
        try { SS.resume(); } catch (e) { /* ignore */ }
        SS.speak(u);
        setTimeout(() => { if (started || SS.speaking) return; if (withVoice) { try { SS.cancel(); } catch (e) { /* ignore */ } go(false); } else if (opt.report) opt.report({ ok: false, err: 'silent', ar: hasAr() }); }, withVoice ? 1500 : 3000);
      };
      const busy = SS.speaking || SS.pending;
      if (busy) SS.cancel();
      if (busy) setTimeout(() => go(!!v), 120); else go(!!v);    // straight away inside a tap (iPhone needs that)
      return true;
    } catch (e) { return false; }
  }
  /** Speaks one of the editable voice texts. */
  const say = (key, vars, opt) => speak(TP.i18n ? TP.i18n.t('ar', key, vars) : '', opt);

  TP.voice = { speak, say, pick, cfg, stop: () => { try { SS && SS.cancel(); } catch (e) { /* ignore */ } },
    available: () => !!SS, voices: () => voices.filter(v => /^ar/i.test(v.lang || '')), hasArabic: () => { if (!voices.length) loadVoices(); return voices.some(v => /^ar/i.test(v.lang || '')); }, STYLES };
})(window.TP = window.TP || {});
