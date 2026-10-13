/* ==========================================================================
   Line sign-up page — r/#TOKEN (one link per line, sent once to the line's people)
   The passenger writes his name and number, chooses أستاذ / أستاذة and puts his
   home on the map (GPS or by moving the pin). It takes one of the line's free
   seats (the rules never give more than the car has); the Control Tower adds him
   to the line and his own follow-up link opens here by itself.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;
  const token = decodeURIComponent((location.hash || '').slice(1)).trim();
  const main = () => TP.$('#main');
  const st = { rh: '', reg: null, loc: null, sex: '', busy: false, map: null, pin: null };
  const KEY = () => 'tp-reg-' + st.rh;

  const card = html => { main().innerHTML = `<section class="glass card c-card">${html}</section>`; };
  const fail = (title, sub) => card(`<h1>${esc(title)}</h1>${sub ? `<p class="c-sub">${esc(sub)}</p>` : ''}`);

  /* ---------- the map (free OpenStreetMap) ---------- */
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    return new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
      const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      s.onload = () => res(window.L); s.onerror = () => rej(new Error('leaflet')); document.head.appendChild(s);
    });
  }
  const PIN = '<svg viewBox="0 0 34 44" width="34" height="44" aria-hidden="true"><path d="M17 43s14-14.6 14-25.5A14 14 0 0 0 3 17.5C3 28.4 17 43 17 43z" fill="#c3853c" stroke="#fff" stroke-width="2"/><circle cx="17" cy="17.5" r="5.5" fill="#5e1e15"/></svg>';
  async function showMap(loc) {
    const el = TP.$('#rMap'); if (!el) return;
    el.hidden = false;
    try {
      const L = await loadLeaflet();
      if (!st.map) {
        st.map = L.map(el, { zoomControl: true, attributionControl: true }).setView([loc.lat, loc.lng], 17);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(st.map);
        st.pin = L.marker([loc.lat, loc.lng], { draggable: true, icon: L.divIcon({ className: 'c-mk', html: PIN, iconSize: [34, 44], iconAnchor: [17, 42] }) }).addTo(st.map);
        st.pin.on('dragend', () => { const p = st.pin.getLatLng(); st.loc = { lat: p.lat, lng: p.lng, acc: 0 }; mark(); });
        st.map.on('click', e => { st.pin.setLatLng(e.latlng); st.loc = { lat: e.latlng.lat, lng: e.latlng.lng, acc: 0 }; mark(); });
      } else { st.map.setView([loc.lat, loc.lng], 17); st.pin.setLatLng([loc.lat, loc.lng]); }
    } catch (e) { el.hidden = true; }
  }
  function mark() {
    const b = TP.$('#rLocState');
    if (b) b.innerHTML = st.loc ? '✅ مكانك اتحدد — لو مش مظبوط حرّك الدبوس لمكان بيتك بالظبط' : '';
    const go = TP.$('#rGps'); if (go && st.loc) go.textContent = '📍 حدد مكاني تاني';
  }
  function locate() {
    const b = TP.$('#rGps');
    if (!navigator.geolocation) { TP.toast('الموبايل مش بيدعم تحديد المكان — حرّك الدبوس على الخريطة'); return; }
    b.disabled = true; b.textContent = 'بيحدد مكانك…';
    navigator.geolocation.getCurrentPosition(p => {
      st.loc = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) };
      b.disabled = false; mark(); showMap(st.loc);
    }, e => {
      b.disabled = false; b.textContent = '📍 حدد مكاني';
      TP.toast(e && e.code === 1 ? 'اسمح للموقع من إعدادات المتصفح، أو حرّك الدبوس على الخريطة' : 'مقدرناش نحدد مكانك — جرّب تاني وإنت جنب الشباك');
      if (!st.map) showMap({ lat: 30.2967, lng: 31.7433 });   // 10th of Ramadan — move the pin by hand
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  /* ---------- the form ---------- */
  function form() {
    const r = st.reg, left = Math.max(0, (r.lim || 0) - (r.n || 0));
    card(`<div class="c-hello">أهلاً بحضرتك 🌹</div>
      <p class="c-sub">ده تسجيل ركاب <b>${esc(r.lineName || 'الخط')}</b>${r.factoryName ? ` — ${esc(r.factoryName)}` : ''}.<br>اكتب بياناتك وحدد مكان بيتك، وهيوصلك لينك متابعة عربيتك.</p>
      <div class="r-seats">الأماكن الفاضية: <b>${left}</b></div>
      <label class="fld">الاسم<input class="input" id="rName" maxlength="60" autocomplete="name" placeholder="الاسم بالكامل"></label>
      <div class="r-sex"><button type="button" class="btn btn-ghost" data-sex="m">أستاذ</button><button type="button" class="btn btn-ghost" data-sex="f">أستاذة</button></div>
      <label class="fld">رقم الموبايل (واتساب)<input class="input" id="rPhone" inputmode="tel" dir="ltr" maxlength="20" autocomplete="tel" placeholder="01xxxxxxxxx"></label>
      <button type="button" class="btn btn-ghost btn-block" id="rGps">📍 حدد مكاني</button>
      <div class="c-map" id="rMap" hidden></div>
      <div class="r-loc" id="rLocState"></div>
      <button type="button" class="btn btn-primary btn-block" id="rSend">تسجيل</button>`);
    TP.$$('[data-sex]').forEach(b => b.onclick = () => { st.sex = b.dataset.sex; TP.$$('[data-sex]').forEach(x => x.classList.toggle('on', x === b)); });
    TP.$('#rGps').onclick = locate;
    TP.$('#rSend').onclick = send;
  }

  async function send() {
    if (st.busy) return;
    const name = TP.$('#rName').value.trim().replace(/\s+/g, ' '), phone = TP.latinDigits(TP.$('#rPhone').value.trim()).replace(/[^\d+]/g, '');
    if (name.length < 2) { TP.toast('اكتب اسمك'); return; }
    if (!st.sex) { TP.toast('اختار أستاذ أو أستاذة'); return; }
    if (!TP.phoneIntl(phone)) { TP.toast('رقم الموبايل مش مظبوط'); return; }
    if (!st.loc) { TP.toast('دوس "حدد مكاني" الأول'); return; }
    st.busy = true; const b = TP.$('#rSend'); b.disabled = true; b.textContent = 'بيتسجل…';
    try {
      const reg = await TP.fb.get('regs/' + st.rh);
      if (!reg || reg.open === false) throw new Error('closed');
      const n = (reg.n || 0) + 1;
      if (n > (reg.lim || 0)) throw new Error('full');
      const tok = TP.token(), ch = await TP.sha256(tok);
      const loc = { lat: Math.round(st.loc.lat * 1e6) / 1e6, lng: Math.round(st.loc.lng * 1e6) / 1e6, acc: Math.round(st.loc.acc || 0) };
      await TP.fb.batch([
        { op: 'set', path: 'signups/' + st.rh + '_' + n, data: { rh: st.rh, n, lineId: reg.lineId, tok, ch, name: name.slice(0, 60), phone, sex: st.sex, loc, status: 'new', at: TP.fb.ts() } },
        { op: 'update', path: 'regs/' + st.rh, data: { n } }
      ]);
      TP.store.set(KEY(), { tok, ch, name, sex: st.sex });
      waitForLink();
    } catch (e) {
      console.warn(e);
      st.busy = false; b.disabled = false; b.textContent = 'تسجيل';
      if (e && e.message === 'full') fail('العربية اكتملت', 'كل أماكن الخط ده اتحجزت. كلّم الشركة.');
      else if (e && e.message === 'closed') fail('التسجيل مقفول', 'كلّم الشركة.');
      else TP.toast('حصلت مشكلة — جرّب تاني بعد شوية');   // two people at the same second: the next try takes the next seat
    }
  }

  /** After signing up: his follow-up page opens by itself once the office's screen has added him. */
  function waitForLink() {
    const me = TP.store.get(KEY(), null); if (!me) return form();
    card(`<div class="c-hello">تم تسجيلك ✅</div>
      <p class="c-sub">${esc(TP.i18n.honor('ar', me.name, me.sex))}، اتسجلت على ${esc((st.reg && st.reg.lineName) || 'الخط')}.<br>بنجهّز لينك متابعة عربيتك — هيفتح هنا لوحده.</p>
      <div class="spinner"></div>`);
    const go = () => { location.href = TP.custUrl(me.tok); };
    const check = () => TP.fb.get('track/' + me.ch).then(d => { if (d) go(); else setTimeout(check, 8000); }).catch(() => setTimeout(check, 15000));
    check();
  }

  /* ---------- start ---------- */
  if (!token) { fail('اللينك ناقص', 'افتح اللينك اللي وصلك على الواتساب زي ما هو.'); return; }
  if (!TP.fb.configured()) { fail('الخدمة مش متظبطة'); return; }
  Promise.all([TP.fb.load(), TP.sha256(token)]).then(async ([, rh]) => {
    st.rh = rh;
    st.reg = await TP.fb.get('regs/' + rh).catch(() => null);
    if (TP.store.get(KEY(), null)) return waitForLink();
    if (!st.reg) return fail('اللينك ده مش شغال', 'يمكن الشركة غيّرت اللينك. اطلب اللينك الجديد.');
    if (st.reg.open === false) return fail('التسجيل مقفول', 'كلّم الشركة.');
    if ((st.reg.n || 0) >= (st.reg.lim || 0)) return fail('العربية اكتملت', 'كل أماكن الخط ده اتحجزت. كلّم الشركة.');
    form();
  }).catch(e => { console.error(e); fail('مفيش اتصال', 'اتأكد من الإنترنت وافتح اللينك تاني.'); });
  window.addEventListener('hashchange', () => location.reload());
})(window.TP = window.TP || {});
