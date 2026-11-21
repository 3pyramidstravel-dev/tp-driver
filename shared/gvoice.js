/* ==========================================================================
   صوت طبيعي (agreed 21 Nov): every spoken text in the apps (Karim, training,
   encouragement, trip alerts) speaks with Gemini's natural male voice instead of
   the phone's robotic one, with no setup on any phone.
   Each sentence is made once by Gemini (free key in karimCfg/main) and kept in
   ttsCache/{hash}, so every other phone plays it instantly from there.
   Urgent alerts never wait: if the natural voice is not ready in time they speak
   with the phone's voice at once, and the natural one is cached for next time.
   ========================================================================== */
(function (TP) {
  'use strict';
  if (!TP.voice) return;
  const phone = { speak: TP.voice.speak, say: TP.voice.say };
  const mem = {}, pending = {};
  let actx = null, playing = null, cfgP = null;

  const cfg = () => cfgP || (cfgP = TP.fb.get('karimCfg/main').then(c => { if (!c || !c.key) cfgP = null; return c || {}; }).catch(() => { cfgP = null; return {}; }));
  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return 'v1_' + (h >>> 0).toString(36) + '_' + s.length; }
  function ctx() {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { /* ignore */ }
    return actx;
  }
  // called on any tap so a later spoken reply (not inside a tap) may still play
  document.addEventListener('pointerdown', ctx, { passive: true });

  function stop() { try { if (playing) playing.stop(); } catch (e) { /* ignore */ } playing = null; try { phone.speak && TP.voice.stopPhone && TP.voice.stopPhone(); } catch (e) { /* ignore */ } }
  function play(b64, onEnd) {
    const a = ctx(); if (!a) { if (onEnd) onEnd(); return false; }
    const bin = atob(b64), n = bin.length >> 1, buf = a.createBuffer(1, n, 24000), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; ch[i] = v / 32768; }
    stop();
    const src = a.createBufferSource(); src.buffer = buf; src.connect(a.destination); src.onended = () => { if (onEnd) onEnd(); }; src.start(); playing = src;
    return true;
  }

  const day = () => new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10); // Google's free quota resets at midnight Pacific
  const outToday = () => { try { return localStorage.getItem('ttsOut') === day(); } catch (e) { return false; } };
  // short fixed messages are cut at commas/full stops so each piece (e.g. "يا كابتن سامي") is made once and reused forever
  const pieces = t => t.length > 160 ? [t] : t.split(/(?<=[،,.!؟?])\s+/).map(x => x.trim()).filter(Boolean);
  async function makeAll(text, lang) {
    const parts = pieces(text), out = [];
    for (const x of parts) { const b = await make(x, lang); if (!b) return null; out.push(b); }
    return out;
  }
  function playAll(list, onEnd) { let i = 0; const next = () => { if (i >= list.length) { if (onEnd) onEnd(); return; } play(list[i++], next); }; next(); return true; }

  async function make(text, lang) {
    let quota = 0;
    const id = hash((lang || 'ar') + '|' + text);
    if (mem[id]) return mem[id];
    if (pending[id]) return pending[id];
    pending[id] = (async () => {
      try { const d = await TP.fb.get('ttsCache/' + id); if (d && d.d) { mem[id] = d.d; return d.d; } } catch (e) { /* not cached / offline */ }
      if (outToday()) return null;
      const c = await cfg(); if (!c.key || c.voice === false) return null;
      const say = lang === 'en' ? 'Say slowly and clearly in a warm, friendly male voice: ' : 'Say in a warm, calm, confident Egyptian Arabic male voice, natural like a real person talking: ';
      const models = c.ttsModel ? [c.ttsModel] : ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
      for (const m of models) {
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(c.key)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: say + text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: c.ttsVoice || 'Charon' } } } } })
          });
          if (!r.ok) { console.warn('tts', m, r.status); if (r.status === 429) quota++; continue; }
          const j = await r.json(), part = ((((j.candidates || [])[0] || {}).content || {}).parts || []).find(p => p.inlineData && p.inlineData.data);
          if (!part) continue;
          mem[id] = part.inlineData.data;
          if (mem[id].length < 950000) TP.fb.set('ttsCache/' + id, { d: mem[id], at: TP.now(), n: text.length }).catch(() => {});
          return mem[id];
        } catch (e) { console.warn('tts', m, e); }
      }
      if (quota >= models.length) { try { localStorage.setItem('ttsOut', day()); } catch (e) { /* ignore */ } }
      return null;
    })();
    const out = await pending[id]; delete pending[id]; return out;
  }

  /** speak(text, {force, urgent, lang}) — natural voice; urgent ones fall back to the phone's voice at once. */
  function speak(text, opt) {
    opt = opt || {};
    text = String(text || '').replace(/[*_#>]/g, '').trim().slice(0, 600);
    if (!text) return false;
    let on = true; try { on = TP.voice.cfg().on; } catch (e) { /* default on */ }
    if (!on && !opt.force) return false;
    ctx();
    const ids = pieces(text).map(x => hash((opt.lang || 'ar') + '|' + x));
    if (ids.every(i => mem[i])) return playAll(ids.map(i => mem[i]));
    let done = false;
    const p = makeAll(text, opt.lang).then(b => { if (b && !done) { done = true; playAll(b); } else if (!b && !done) { done = true; if (opt.lang !== 'en') phone.speak(text, Object.assign({}, opt, { force: true })); } });
    if (opt.urgent) setTimeout(() => { if (!done) { done = true; phone.speak(text, Object.assign({}, opt, { force: true })); } }, 1200);
    return !!p;
  }

  TP.voice.speak = (text, opt) => speak(text, opt);
  TP.voice.say = (key, vars, opt) => speak(TP.i18n ? TP.i18n.t('ar', key, vars) : '', Object.assign({ urgent: true }, opt || {}));
  TP.voice.natural = speak;
  TP.voice.stopAll = stop;
  /** sayWait(text): speaks with the natural voice and resolves when it has finished (for the voice call). */
  async function sayWait(text) {
    text = String(text || '').replace(/[*_#>]/g, '').trim().slice(0, 900); if (!text) return;
    const b = await make(text, 'ar');
    if (!b) { await new Promise(r => { try { phone.speak(text, { force: true, onend: r }); } catch (e) { r(); } setTimeout(r, Math.min(20000, 1500 + text.length * 70)); }); return; }
    await new Promise(r => { if (!play(b, r)) r(); });
  }
  TP.gvoice = { speak, make, sayWait, stop };
})(window.TP = window.TP || {});
