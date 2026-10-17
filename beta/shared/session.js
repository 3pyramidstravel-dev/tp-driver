/* ==========================================================================
   Session gate — the only way into any app.
     1. Anonymous Firebase sign-in gives this phone/browser a permanent id.
     2. No approved device yet → enter the 3-digit code → the Control Tower
        sees "new device asking to sign in as <name>" → approve.
     3. Approved device → stays signed in until it is removed.
     4. Accounts that see money (GM, finance…) also enter their PIN.
   First run of the Control Tower (no system/state) → one-time setup.
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP;

  const KIND_NAMES = { staff: 'غرفة التحكم', driver: 'تطبيق السائق', hr: 'بوابة المصانع' };
  const S = TP.session = { ready: false, uid: null, device: null, person: null, perms: [] };
  let opts = null, unsubDevice = null, unsubPerson = null, unsubReq = null, beat = null, wasIn = false;

  S.can = p => TP.has(S.perms, p);
  S.name = () => (S.person && S.person.name) || (S.device && S.device.name) || '';

  /* ---------- gate rendering ---------- */
  function gate(html) {
    let g = TP.$('#tp-gate');
    if (!g) { g = document.createElement('div'); g.id = 'tp-gate'; g.className = 'gate'; document.body.appendChild(g); }
    g.hidden = false;
    g.innerHTML = `<div class="glass gate-card"><img class="gate-logo" src="${opts.base}logo.png" alt="Three Pyramids Travel">${html}</div>`;
    TP.hydrateIcons(g);
    return g;
  }
  function hideGate() { const g = TP.$('#tp-gate'); if (g) { g.hidden = true; g.innerHTML = ''; } }
  const shortId = uid => (uid || '').slice(-6).toUpperCase();

  function screenMessage(title, text, retry) {
    const g = gate(`<span class="caps">${esc(KIND_NAMES[opts.kind] || '')}</span><h1>${esc(title)}</h1><p>${esc(text)}</p>
      ${retry ? '<button type="button" class="btn btn-primary btn-lg btn-block" id="gRetry">إعادة المحاولة</button>' : ''}`);
    if (retry) TP.$('#gRetry', g).onclick = retry;
  }

  /* ---------- start ---------- */
  S.start = function (o) {
    opts = Object.assign({ base: '../shared/' }, o);
    if (!TP.fb.configured()) {
      return screenMessage('محتاج إعداد Firebase', 'لسه مكتبتش بيانات مشروع Firebase في ملف shared/firebase-config.js. اتبع دليل الإعداد.');
    }
    gate('<div class="spinner"></div><p>جاري الاتصال…</p>');
    TP.fb.load().then(() => {
      TP.fb.onAuth(async user => {
        if (!user) {
          noteLostSignIn();
          try { await TP.fb.signInAnon(); } catch (e) { console.error(e); screenMessage('تعذر الدخول', 'تأكد من الإنترنت، ومن تفعيل الدخول المجهول (Anonymous) في Firebase.', () => location.reload()); }
          return;
        }
        S.uid = user.uid;
        watchDevice();
      });
    }).catch(e => {
      console.error(e);
      screenMessage('مفيش اتصال', 'مقدرناش نوصل للخدمة. اتأكد من الإنترنت وحاول تاني.', () => location.reload());
    });
  };

  /* ---------- why a device lands on "تفعيل الجهاز" again — kept as proof, shown on the screen and written to the audit log once inside.
     'tp-dev-mark' is written while the device is signed in (with its number). On the next start:
       no Firebase sign-in + the mark is gone      → the browser's data was cleared (by the phone/browser), or a brand-new device
       no Firebase sign-in + the mark still here   → the sign-in alone was lost, our data was not cleared (our side / Firebase)
       signed in, same number, device record gone  → the device was removed from the devices page ---------- */
  const MARK = 'tp-dev-mark', WHY = 'tp-relogin';
  // one browser can hold more than one sign-in screen (the driver app and the Control Tower): the marks are kept per device number
  const marks = () => { const m = TP.store.get(MARK, null); return m && typeof m === 'object' && !m.uid ? m : {}; };
  const markSeen = () => { const m = marks(); m[S.uid] = { at: Date.now(), kind: opts.kind }; TP.store.set(MARK, m); };
  function noteLostSignIn() {
    if (TP.store.get(WHY, null)) return;
    const last = Object.entries(marks()).filter(([, v]) => v && v.kind === opts.kind).sort((a, b) => b[1].at - a[1].at)[0];
    TP.store.set(WHY, last ? { reason: 'signin-lost', prev: last[0], since: last[1].at, at: Date.now() } : { reason: 'wiped', at: Date.now() });
  }
  function noteRemoved() {
    const m = marks()[S.uid];
    if (m && !TP.store.get(WHY, null)) TP.store.set(WHY, { reason: 'removed', prev: S.uid, since: m.at, at: Date.now() });
  }
  const WHY_TEXT = {
    wiped: 'الجهاز ده مفيهوش دخول قديم (جهاز جديد، أو المتصفح مسح بياناته)',
    'signin-lost': 'بيانات البرنامج لسه موجودة لكن الدخول اتلغى (رقم الجهاز القديم {p}) — ده من عندنا مش من الموبايل',
    removed: 'الجهاز ده ({p}) اتشال من صفحة الأجهزة'
  };
  const whyText = w => w && WHY_TEXT[w.reason] ? WHY_TEXT[w.reason].replace('{p}', shortId(w.prev)) : '';

  /* ---------- phone clock check: compare the server time of our own heartbeat with the phone's clock ---------- */
  let lastSeenMs = null, beatAt = 0;
  function measureClock(dev) {
    const v = dev && dev.lastSeen, ms = v && typeof v.toMillis === 'function' ? v.toMillis() : null;
    if (ms === null || ms === lastSeenMs) return;
    lastSeenMs = ms;
    if (!beatAt || Date.now() - beatAt > 30000) return;   // only a value written by our own heartbeat just now
    const skew = ms - Date.now();
    TP.clockSkew = Math.abs(skew) < 5000 ? 0 : skew;
    TP.store.set('tp-clock-skew', TP.clockSkew);
    document.dispatchEvent(new CustomEvent('tp:clock'));
  }

  function watchDevice() {
    if (unsubDevice) unsubDevice();
    unsubDevice = TP.fb.onDoc('devices/' + S.uid, async dev => {
      S.device = dev;
      if (!dev) {
        noteRemoved();
        stopSession();
        if (wasIn) { wasIn = false; TP.toast('تم إزالة هذا الجهاز من النظام', 'warn'); }
        const state = await TP.fb.get('system/state').catch(() => null);
        if (!state && opts.kind === 'staff') return showSetup();
        return showActivation();
      }
      if (dev.active !== true) { stopSession(); return screenMessage('الوصول موقوف', 'تم إيقاف هذا الجهاز من الإدارة. كلّم الإدارة لو محتاج تدخل تاني.'); }
      if (dev.kind !== opts.kind) {
        stopSession();
        return screenMessage('الجهاز ده لشاشة تانية', `الجهاز متفعل على ${KIND_NAMES[dev.kind] || dev.kind}. افتح الشاشة الصحيحة، أو اطلب من الإدارة إزالة الجهاز وتفعيله من جديد.`);
      }
      const newPerms = dev.perms || [];
      const permsChanged = JSON.stringify(newPerms) !== JSON.stringify(S.perms);
      S.perms = newPerms;
      if (S.ready && permsChanged) {
        if (TP.needsPin(newPerms) && !TP.store.get('tp-unlocked-' + S.uid, false, true) && S.person) { stopSession(); S._pid = null; }
        else document.dispatchEvent(new CustomEvent('tp:session'));
      }
      watchPerson(dev.personId);
    }, err => {
      console.error(err);
      screenMessage('مفيش اتصال', 'حصلت مشكلة في الاتصال بالخدمة.', () => location.reload());
    });
  }

  function watchPerson(pid) {
    if (unsubPerson && S._pid === pid) return;
    if (unsubPerson) unsubPerson();
    S._pid = pid;
    unsubPerson = TP.fb.onDoc('people/' + pid, async p => {
      S.person = p;
      if (!p || p.active === false) { stopSession(); return screenMessage('الحساب موقوف', 'حسابك موقوف حالياً. كلّم الإدارة.'); }
      if (TP.needsPin(S.perms) && !TP.store.get('tp-unlocked-' + S.uid, false, true)) return showPin();
      enter();
    }, () => screenMessage('مفيش اتصال', 'تعذر تحميل بيانات الحساب.', () => location.reload()));
  }

  function enter() {
    hideGate();
    wasIn = true;
    const first = !S._started;
    S._started = true;
    S.ready = true;
    startHeartbeat();
    if (first) setTimeout(() => TP.push.refresh().catch(() => {}), 1500);
    if (first) opts.onReady && opts.onReady(S);
    if (TP.store.get('tp-pin-recovered', false)) { TP.store.del('tp-pin-recovered'); setTimeout(() => TP.audit('device.pinRecover', (S.person && S.person.name) || '', 'جهاز ' + shortId(S.uid) + ' — رجع بالموبايل والرقم السري'), 500); }
    markSeen();
    { const w = TP.store.get(WHY, null); if (w) { TP.store.del(WHY); setTimeout(() => TP.audit('device.relogin', (S.person && S.person.name) || '', `جهاز ${shortId(S.uid)} — ${whyText(w)}${w.since ? ' — آخر مرة كان داخل ' + TP.fmtDateTime(w.since) : ''}`), 800); } }
    if (first) setTimeout(askDeviceLabel, 2500);
    if (TP.store.get('tp-recovered', false)) { TP.store.del('tp-recovered'); setTimeout(() => TP.audit('device.recover', (S.person && S.person.name) || '', 'جهاز ' + shortId(S.uid) + ' — بمفتاح الاسترجاع'), 500); }
    document.dispatchEvent(new CustomEvent('tp:session'));
  }

  /* ---------- "عرّفنا الجهاز ده": type, brand and a name — asked once per device (agreed), shown on the devices page ---------- */
  const DEV_TYPES = [['mobile', '📱 موبايل'], ['laptop', '💻 لابتوب'], ['desktop', '🖥 كمبيوتر مكتب'], ['tablet', '📲 تابلت']];
  const BRANDS = {
    mobile: ['Samsung سامسونج', 'Xiaomi / Redmi شاومي', 'Realme ريلمي', 'OPPO أوبو', 'vivo فيفو', 'Huawei هواوي', 'Honor أونر', 'Infinix إنفينكس', 'Tecno تكنو', 'iPhone آيفون', 'Nokia نوكيا'],
    laptop: ['Dell', 'HP', 'Lenovo', 'Asus', 'Acer', 'Apple MacBook', 'Microsoft Surface', 'MSI', 'Toshiba'],
    desktop: ['Dell', 'HP', 'Lenovo', 'Asus', 'Acer', 'Apple iMac', 'تجميع'],
    tablet: ['Samsung سامسونج', 'iPad آيباد', 'Lenovo', 'Huawei هواوي', 'Xiaomi شاومي']
  };
  TP.DEV_TYPES = DEV_TYPES;
  TP.deviceLabelText = l => !l ? '' : [((DEV_TYPES.find(x => x[0] === l.type) || [])[1] || '').split(' ')[0], l.brand, l.name ? '— ' + l.name : ''].filter(Boolean).join(' ');
  S.askDeviceLabel = () => askDeviceLabel();
  function askDeviceLabel() {
    if (!S.ready || !S.device || S.device.label || window.TP_NO_LABEL_ASK || TP.store.get('tp-label-asked-' + S.uid, false, true) || !TP.openModal) return;
    TP.store.set('tp-label-asked-' + S.uid, true, true);                    // once per opening at most when skipped
    const pf = String((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '');
    let type = /android|iphone|ipad|ios/i.test(pf + ' ' + navigator.userAgent) ? (/ipad|tablet/i.test(navigator.userAgent) ? 'tablet' : 'mobile') : 'laptop';
    const brandOpts = t => (BRANDS[t] || []).map(b => `<option>${esc(b)}</option>`).join('') + '<option value="other">تانية…</option>';
    TP.openModal('عرّفنا الجهاز ده — مرة واحدة', `
      <p class="modal-text">ده بيساعد الإدارة تفرق بين أجهزتك (الموبايل واللابتوب مثلاً)، فمحدش يشيل جهاز شغال بالغلط.</p>
      <div class="form-grid">
        <label class="fld">نوع الجهاز<select class="input" id="dlType">${DEV_TYPES.map(([k, l]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="fld">الماركة<select class="input" id="dlBrand">${brandOpts(type)}</select></label>
        <label class="fld" id="dlOtherW" hidden>اكتب الماركة<input class="input" id="dlOther" maxlength="30" dir="auto"></label>
        <label class="fld full">اسم الجهاز <small>اسم يفرّقه عن أجهزتك التانية</small><input class="input" id="dlName" maxlength="40" placeholder="مثال: موبايل الشغل — لابتوب المكتب"></label>
      </div>`, async () => {
      const t = TP.$('#dlType').value, bSel = TP.$('#dlBrand').value, brand = (bSel === 'other' ? TP.$('#dlOther').value : bSel).trim().slice(0, 40), name = TP.$('#dlName').value.trim().slice(0, 40);
      if (!brand) { TP.toast('اختار الماركة'); return false; }
      await TP.fb.update('devices/' + S.uid, { label: { type: t, brand, name } });
      TP.toast('اتحفظ ✓');
    }, { saveLabel: 'حفظ', cancelLabel: 'بعدين' });
    const ty = TP.$('#dlType'), br = TP.$('#dlBrand'), ow = TP.$('#dlOtherW');
    ty.onchange = () => { br.innerHTML = brandOpts(ty.value); ow.hidden = true; };
    br.onchange = () => { ow.hidden = br.value !== 'other'; };
  }

  function stopSession() {
    if (S.ready) { S.ready = false; document.dispatchEvent(new CustomEvent('tp:session-end')); }
    if (unsubPerson) { unsubPerson(); unsubPerson = null; S._pid = null; }
    clearInterval(beat); beat = null;
  }

  /* ---------- presence (one small write every 5 minutes while open) ---------- */
  function startHeartbeat() {
    if (beat) return;
    const send = async () => {
      if (!S.ready || document.hidden) return;
      const data = { lastSeen: TP.fb.ts(), appVersion: TP.VERSION, screen: opts.kind, platform: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '' };
      data.installed = !!(TP.install && TP.install.installed());
      data.notif = typeof Notification === 'undefined' ? 'none' : String(Notification.permission || '').slice(0, 10);
      try {
        if (navigator.getBattery) { const b = await navigator.getBattery(); data.battery = Math.round(b.level * 100); }
      } catch (e) { /* not available */ }
      beatAt = Date.now();
      // its own small document: the Control Tower pages that show "online" read it, the others are not woken by it
      data.personId = (S.person && S.person.id) || '';
      TP.fb.set('presence/' + S.uid, data).then(() => TP.fb.get('presence/' + S.uid)).then(measureClock).catch(() => {});
    };
    send();
    // drivers: every 15 min (their GPS updates will carry presence in phase 2) — protects the free daily write quota
    beat = setInterval(send, (opts.kind === 'driver' ? 15 : 5) * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) send(); });
  }

  /* ---------- activation ---------- */
  function showActivation() {
    if (unsubReq) unsubReq();
    const g = gate(`<span class="caps">${esc(KIND_NAMES[opts.kind] || '')}</span>
      <h1>تفعيل الجهاز</h1>
      <p>اكتب كود التفعيل اللي إدتهولك الإدارة (3 أرقام).</p>
      <form id="gForm" autocomplete="off">
        <div class="code-boxes">
          <input inputmode="numeric" maxlength="1" aria-label="الرقم الأول" required>
          <input inputmode="numeric" maxlength="1" aria-label="الرقم الثاني" required>
          <input inputmode="numeric" maxlength="1" aria-label="الرقم الثالث" required>
        </div>
        <div class="gate-msg" id="gMsg"></div>
        <button type="submit" class="btn btn-primary btn-lg btn-block">تفعيل <i data-icon="arrow"></i></button>
      </form>
      <div id="gWait" hidden><div class="spinner"></div><p id="gWaitText">في انتظار موافقة الإدارة…</p></div>
      <p class="device-id">رقم الجهاز: <b>${shortId(S.uid)}</b></p>
      ${(w => w && whyText(w) ? `<p class="small ${w.reason === 'wiped' ? 'muted' : ''}" style="margin:4px 0 0;${w.reason === 'wiped' ? '' : 'color:var(--warn,#a06000)'}">${w.reason === 'wiped' ? '' : 'سبب الخروج: '}${esc(whyText(w))}</p>` : '')(TP.store.get(WHY, null))}
      ${opts.kind === 'staff' || opts.kind === 'driver' ? '<button type="button" class="btn btn-ghost btn-sm" id="gPinRec" style="margin-top:6px">جهازك خرج؟ استرجاع حسابي</button>' : ''}
      ${opts.kind === 'staff' ? '<button type="button" class="btn btn-ghost btn-sm" id="gRecover" style="margin-top:2px">استرجاع حساب المدير العام</button>' : ''}`);
    const rb = TP.$('#gRecover', g); if (rb) rb.onclick = showRecovery;
    const pb = TP.$('#gPinRec', g); if (pb) pb.onclick = showPinRecovery;
    const boxes = TP.$$('.code-boxes input', g);
    boxes.forEach((b, i) => {
      b.addEventListener('input', () => {
        b.value = TP.latinDigits(b.value).replace(/\D/g, '').slice(-1);
        if (b.value && boxes[i + 1]) boxes[i + 1].focus();
      });
      b.addEventListener('keydown', e => { if (e.key === 'Backspace' && !b.value && boxes[i - 1]) boxes[i - 1].focus(); });
      b.addEventListener('paste', e => {
        const t = TP.latinDigits((e.clipboardData || window.clipboardData).getData('text')).replace(/\D/g, '').slice(0, 3);
        if (t.length === 3) { e.preventDefault(); boxes.forEach((x, k) => { x.value = t[k]; }); boxes[2].focus(); }
      });
    });
    setTimeout(() => boxes[0].focus(), 80);
    let current = null;
    TP.$('#gForm', g).addEventListener('submit', async e => {
      e.preventDefault();
      const code = boxes.map(b => b.value).join('');
      const msg = TP.$('#gMsg', g);
      if (!/^\d{3}$/.test(code)) { msg.textContent = 'اكتب الـ 3 أرقام'; msg.className = 'gate-msg err'; return; }
      const device = { app: opts.kind, ua: navigator.userAgent.slice(0, 160) };
      try {
        if (!current) await TP.fb.set('activationRequests/' + S.uid, { code, attempts: 1, status: 'pending', device, createdAt: TP.fb.ts(), updatedAt: TP.fb.ts() });
        else await TP.fb.update('activationRequests/' + S.uid, { code, attempts: (current.attempts || 0) + 1, status: 'pending', device, updatedAt: TP.fb.ts() });
      } catch (err) {
        console.error(err);
        msg.textContent = (current && current.attempts >= 5) ? 'الجهاز اتقفل بعد 5 محاولات — كلّم الإدارة' : TP.errorText(err);
        msg.className = 'gate-msg err';
      }
    });
    unsubReq = TP.fb.onDoc('activationRequests/' + S.uid, req => {
      current = req;
      const form = TP.$('#gForm', g), wait = TP.$('#gWait', g), msg = TP.$('#gMsg', g);
      if (!form) return;
      const waiting = req && (req.status === 'pending' || req.status === 'matched');
      form.hidden = !!waiting; wait.hidden = !waiting;
      if (!req) return;
      if (req.status === 'matched') TP.$('#gWaitText', g).textContent = `الإدارة شايفة طلبك باسم «${req.personName || ''}» — في انتظار الموافقة…`;
      if (req.status === 'pending') TP.$('#gWaitText', g).textContent = 'تم إرسال الكود — في انتظار موافقة الإدارة…';
      if (req.status === 'invalid' || req.status === 'rejected') {
        const left = Math.max(0, 5 - (req.attempts || 0));
        boxes.forEach(b => { b.value = ''; });
        if (req.status === 'rejected') { msg.textContent = 'الإدارة رفضت الطلب. كلّمهم لو ده غلط.'; }
        else if (left <= 0) { msg.textContent = 'الجهاز اتقفل بعد 5 محاولات غلط — كلّم الإدارة'; TP.$('button[type=submit]', form).disabled = true; boxes.forEach(b => { b.disabled = true; }); }
        else { msg.textContent = `الكود غلط أو انتهى — فاضل ${left} محاولات`; }
        msg.className = 'gate-msg err';
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      }
    }, () => {});
  }

  /* ---------- own-account recovery (management + tourism drivers): phone + own PIN ----------
     The phone finds the account (recoverIndex/), the PIN hash is checked by the server rules
     (pinRecover/), then this device is created with exactly the person's permissions. */
  function showPinRecovery() {
    if (unsubReq) { unsubReq(); unsubReq = null; }
    const g = gate(`<span class="caps">${esc(KIND_NAMES[opts.kind] || '')}</span><h1>استرجاع حسابي</h1>
      <p>اكتب رقم موبايلك المتسجل عندنا والرقم السري بتاعك.</p>
      <form id="qForm" autocomplete="off" style="width:100%">
        <input class="input" id="qPhone" type="tel" inputmode="tel" autocomplete="off" placeholder="رقم الموبايل" style="text-align:center;margin-bottom:10px" aria-label="رقم الموبايل">
        <input class="input" id="qPin" type="password" inputmode="numeric" maxlength="12" autocomplete="off" placeholder="الرقم السري" style="text-align:center;letter-spacing:6px" aria-label="الرقم السري">
        <div class="gate-msg" id="qMsg"></div>
        <button type="submit" class="btn btn-primary btn-lg btn-block">دخول</button>
      </form>
      <p class="muted small" style="margin-top:8px">للإدارة وسواقين السياحة بس. باقي السواقين بياخدوا كود من الإدارة.</p>
      <button type="button" class="btn btn-ghost btn-sm" id="qBack" style="margin-top:6px">رجوع لكود التفعيل</button>`);
    TP.$('#qBack', g).onclick = showActivation;
    setTimeout(() => TP.$('#qPhone', g).focus(), 80);
    const fkey = 'tp-prec-fails';
    TP.$('#qForm', g).addEventListener('submit', async e => {
      e.preventDefault();
      const msg = TP.$('#qMsg', g), btn = TP.$('#qForm button', g);
      const err = t => { msg.textContent = t; msg.className = 'gate-msg err'; };
      const fail = t => {
        const f = TP.store.get(fkey, { n: 0, until: 0 }), n = (f.n || 0) + 1;
        TP.store.set(fkey, n >= 5 ? { n: 0, until: Date.now() + 10 * 60000 } : { n, until: 0 });
        err(n >= 5 ? 'محاولات كتير غلط — استنى 10 دقايق' : t);
      };
      const f = TP.store.get(fkey, { n: 0, until: 0 });
      if (f.until > Date.now()) return err(`استنى ${Math.ceil((f.until - Date.now()) / 60000)} دقيقة وحاول تاني`);
      const key = TP.phoneKey(TP.$('#qPhone', g).value);
      const pin = TP.latinDigits(TP.$('#qPin', g).value).trim();
      if (!key) return err('اكتب رقم الموبايل كامل');
      if (!/^\d{4,12}$/.test(pin)) return err('اكتب الرقم السري');
      btn.disabled = true; msg.textContent = ''; msg.className = 'gate-msg';
      const recPath = 'pinRecover/' + S.uid;
      try {
        const idx = await TP.fb.get('recoverIndex/' + key).catch(() => null);
        if (!idx || !idx.pid) return fail('الرقم ده مش متسجل للاسترجاع — كلّم الإدارة');
        await TP.fb.remove(recPath).catch(() => {});
        try { await TP.fb.set(recPath, { pid: idx.pid, hash: await TP.pinHash(idx.pid, pin), at: TP.fb.ts() }); }
        catch (x) { console.warn(x); return fail('الرقم السري غلط، أو الحساب ده مش مسموح له بالاسترجاع'); }
        const p = await TP.fb.get('people/' + idx.pid);
        if (!p || p.active === false) { TP.fb.remove(recPath).catch(() => {}); return err('الحساب موقوف — كلّم الإدارة'); }
        if (p.type !== opts.kind) { TP.fb.remove(recPath).catch(() => {}); return err(`الحساب ده لـ${KIND_NAMES[p.type] || p.type} — افتح التطبيق الصح`); }
        const dev = { personId: p.id, name: p.name, kind: p.type, perms: p.perms || [], active: true, approvedAt: TP.fb.ts(), approvedAtMs: Date.now(), approvedBy: 'pin-recovery' };
        if (p.factoryId) dev.factoryId = p.factoryId;
        if (p.driverKind) dev.driverKind = p.driverKind;
        TP.store.del(fkey);
        TP.store.set('tp-unlocked-' + S.uid, true, true);   // the PIN was just checked
        TP.store.set('tp-pin-recovered', true);              // written to the audit log once inside
        await TP.fb.set('devices/' + S.uid, dev);
        TP.fb.remove(recPath).catch(() => {});
      } catch (x) {
        console.warn(x);
        TP.store.del('tp-pin-recovered');
        err('حصلت مشكلة — تأكد من النت وحاول تاني');
      } finally { btn.disabled = false; }
    });
  }

  /* ---------- GM recovery: the recovery key the GM set in "حسابي" opens his account on this device ---------- */
  TP.recoveryKey = k => String(k || '').trim().replace(/\s+/g, ' ');
  function showRecovery() {
    if (unsubReq) { unsubReq(); unsubReq = null; }
    const g = gate(`<span class="caps">RECOVERY</span><h1>استرجاع حساب المدير العام</h1>
      <p>اكتب مفتاح الاسترجاع اللي حددته في صفحة "حسابي".</p>
      <form id="rForm" action="#" method="post" autocomplete="on" style="width:100%">
        <input type="text" name="username" autocomplete="username" value="Three Pyramids — المدير العام" readonly hidden aria-hidden="true">
        <input class="input" id="rKey" name="password" type="password" autocomplete="current-password" placeholder="مفتاح الاسترجاع" style="text-align:center" aria-label="مفتاح الاسترجاع">
        <p class="small muted" style="margin:6px 0 0">لما جوجل يسألك "حفظ كلمة المرور؟" دوس <b>حفظ</b> — المرة الجاية بيتكتب لوحده.</p>
        <div class="gate-msg" id="rMsg"></div>
        <button type="submit" class="btn btn-primary btn-lg btn-block">استرجاع</button>
      </form>
      <button type="button" class="btn btn-ghost btn-sm" id="rBack" style="margin-top:6px">رجوع لكود التفعيل</button>`);
    TP.$('#rBack', g).onclick = showActivation;
    setTimeout(() => TP.$('#rKey', g).focus(), 80);
    const fkey = 'tp-rec-fails';
    TP.$('#rForm', g).addEventListener('submit', async e => {
      e.preventDefault();
      const msg = TP.$('#rMsg', g), btn = TP.$('#rForm button', g);
      const f = TP.store.get(fkey, { n: 0, until: 0 });
      if (f.until > Date.now()) { msg.textContent = `استنى ${Math.ceil((f.until - Date.now()) / 60000)} دقيقة وحاول تاني`; msg.className = 'gate-msg err'; return; }
      const k = TP.recoveryKey(TP.$('#rKey', g).value);
      if (k.length < 8) { msg.textContent = 'المفتاح 8 حروف أو أكتر'; msg.className = 'gate-msg err'; return; }
      btn.disabled = true; msg.textContent = ''; msg.className = 'gate-msg';
      try {
        const rec = await TP.fb.get('system/recovery').catch(() => null);
        if (!rec || !rec.personId) { msg.textContent = 'مفيش مفتاح استرجاع متحدد لسه.'; msg.className = 'gate-msg err'; return; }
        await TP.fb.batch([
          { op: 'set', path: 'recover/' + S.uid, data: { k, at: TP.fb.ts() } },
          { op: 'set', path: 'devices/' + S.uid, data: { personId: rec.personId, name: rec.name || 'المدير العام', kind: 'staff', perms: ['all'], active: true, approvedAt: TP.fb.ts(), approvedAtMs: Date.now(), approvedBy: 'recovery' } }
        ]);
        TP.fb.remove('recover/' + S.uid).catch(() => {});   // the key is not kept
        TP.store.del(fkey);
        TP.store.set('tp-recovered', true);                  // written to the audit log once inside
      } catch (err) {
        console.warn(err);
        const n = (f.n || 0) + 1;
        TP.store.set(fkey, n >= 5 ? { n: 0, until: Date.now() + 10 * 60000 } : { n, until: 0 });
        msg.textContent = n >= 5 ? 'محاولات كتير غلط — استنى 10 دقايق' : 'المفتاح غلط';
        msg.className = 'gate-msg err';
      } finally { btn.disabled = false; }
    });
  }

  /* ---------- PIN ---------- */
  function showPin() {
    const g = gate(`<span class="caps">PIN</span><h1>أهلاً ${esc(S.person.name)}</h1>
      <p>حسابك فيه أسعار وصلاحيات مهمة، اكتب الرقم السري بتاعك.</p>
      <form id="pForm" autocomplete="off" style="width:100%">
        <input class="input" id="pPin" type="password" inputmode="numeric" maxlength="12" placeholder="الرقم السري" style="text-align:center;font-size:24px;letter-spacing:8px;min-height:60px" aria-label="الرقم السري">
        <div class="gate-msg" id="pMsg"></div>
        <button type="submit" class="btn btn-primary btn-lg btn-block">دخول</button>
      </form>`);
    const key = 'tp-pin-fails-' + S.uid;
    setTimeout(() => TP.$('#pPin', g).focus(), 80);
    TP.$('#pForm', g).addEventListener('submit', async e => {
      e.preventDefault();
      const msg = TP.$('#pMsg', g);
      const f = TP.store.get(key, { n: 0, until: 0 });
      if (f.until > Date.now()) { msg.textContent = `استنى ${Math.ceil((f.until - Date.now()) / 60000)} دقيقة وحاول تاني`; msg.className = 'gate-msg err'; return; }
      const pin = TP.$('#pPin', g).value;
      if (await S.checkPin(pin)) {
        TP.store.del(key);
        TP.store.set('tp-unlocked-' + S.uid, true, true);
        enter();
      } else {
        f.n += 1; if (f.n >= 5) { f.until = Date.now() + 5 * 60 * 1000; f.n = 0; }
        TP.store.set(key, f);
        msg.textContent = f.until > Date.now() ? 'محاولات كتير غلط — اتقفل 5 دقايق' : 'الرقم السري غلط';
        msg.className = 'gate-msg err';
        TP.$('#pPin', g).select();
      }
    });
  }
  /** Re-ask the PIN before a sensitive action (approve overtime, edit prices…). */
  S.confirmPin = function (title) {
    // Own overlay (above any open modal) so it can be used from inside a modal's save handler.
    return new Promise(resolve => {
      let o = TP.$('#tp-pin');
      if (!o) { o = document.createElement('div'); o.id = 'tp-pin'; o.className = 'tp-overlay'; o.style.zIndex = 350; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); document.body.appendChild(o); }
      o.innerHTML = `<form class="tp-modal-card" id="cpForm" style="width:min(400px,100%)"><h3>${esc(title || 'تأكيد بالرقم السري')}</h3>
        <label class="fld">الرقم السري<input class="input" id="cPin" type="password" inputmode="numeric" maxlength="12" autocomplete="off" style="text-align:center;letter-spacing:6px;font-size:20px"></label>
        <div class="gate-msg err" id="cMsg"></div>
        <div class="tp-modal-actions"><button type="submit" class="btn btn-primary">تأكيد</button><button type="button" class="btn btn-ghost" id="cpCancel">إلغاء</button></div></form>`;
      o.classList.add('show');
      const done = v => { o.classList.remove('show'); o.innerHTML = ''; resolve(v); };
      setTimeout(() => TP.$('#cPin', o).focus(), 50);
      TP.$('#cpCancel', o).onclick = () => done(false);
      TP.$('#cpForm', o).onsubmit = async e => {
        e.preventDefault();
        e.stopPropagation();
        if (await S.checkPin(TP.$('#cPin', o).value)) done(true);
        else { TP.$('#cMsg', o).textContent = 'الرقم السري غلط'; TP.$('#cPin', o).select(); }
      };
    });
  };
  /** PIN hashes live in pins/{personId}, readable only by their owner. */
  S.checkPin = async function (pin) {
    const doc = await TP.fb.get('pins/' + S.person.id).catch(() => null);
    return !!doc && (await TP.pinHash(S.person.id, pin)) === doc.hash;
  };
  S.changeOwnPin = async function (oldPin, newPin) {
    if (!(await S.checkPin(oldPin))) throw new Error('old-pin');
    const p = TP.latinDigits(newPin).trim();
    if (!/^\d{4,12}$/.test(p)) throw new Error('bad-pin');
    await TP.fb.batch([
      { op: 'set', path: 'pins/' + S.person.id, data: { hash: await TP.pinHash(S.person.id, p), changedAt: TP.fb.ts() } },
      { op: 'update', path: 'people/' + S.person.id, data: { pinChangedAt: TP.fb.ts(), pinIsDefault: false } }
    ]);
  };
  /** Hash a PIN for someone else (staff create / reset to 1234). */
  TP.pinDoc = async (pid, pin) => ({ hash: await TP.pinHash(pid, pin || '1234'), changedAt: TP.fb.ts(), resetBy: S.uid });

  /* ---------- one-time setup (first general manager) ---------- */
  function showSetup() {
    const g = gate(`<span class="caps">FIRST-TIME SETUP</span><h1>إعداد أول مرة</h1>
      <p>الشاشة دي بتظهر مرة واحدة بس. هتعمل حساب المدير العام على الجهاز ده.</p>
      <form id="sForm" class="form-grid" style="width:100%;text-align:start" autocomplete="off">
        <label class="fld full">الاسم<input class="input" id="sName" required value="المدير العام"></label>
        <label class="fld full">مفتاح الإعداد <small>موجود في دليل الإعداد</small><input class="input mono" id="sKey" required placeholder="XXXXX-XXXXX"></label>
        <label class="fld full">الرقم السري <small>تقدر تغيّره بعدين</small><input class="input" id="sPin" required inputmode="numeric" value="1234"></label>
        <div class="gate-msg err full" id="sMsg"></div>
        <button type="submit" class="btn btn-primary btn-lg btn-block full">إنشاء حساب المدير العام</button>
      </form>`);
    TP.$('#sForm', g).addEventListener('submit', async e => {
      e.preventDefault();
      const msg = TP.$('#sMsg', g);
      const name = TP.$('#sName', g).value.trim(), key = TP.$('#sKey', g).value.trim().toUpperCase(), pin = TP.latinDigits(TP.$('#sPin', g).value).trim();
      if (!name || !key || !/^\d{4,12}$/.test(pin)) { msg.textContent = 'كمّل البيانات — الرقم السري من 4 أرقام أو أكتر'; return; }
      const pid = TP.newId('P');
      TP.store.set('tp-unlocked-' + S.uid, true, true);   // the person who just set the PIN is already "unlocked"
      try {
        await TP.fb.batch([
          { op: 'set', path: 'people/' + pid, data: { type: 'staff', name, role: 'gm', perms: ['all'], active: true, pinIsDefault: pin === '1234', createdAt: TP.fb.ts() } },
          { op: 'set', path: 'pins/' + pid, data: { hash: await TP.pinHash(pid, pin), changedAt: TP.fb.ts() } },
          { op: 'set', path: 'devices/' + S.uid, data: { personId: pid, name, kind: 'staff', perms: ['all'], active: true, approvedAt: TP.fb.ts(), approvedBy: 'setup' } },
          { op: 'set', path: 'system/state', data: { setupKey: key, bootstrappedAt: TP.fb.ts(), by: S.uid } }
        ]);
        await TP.fb.set('system/settings', TP.DEFAULT_SETTINGS, true).catch(() => {});
      } catch (err) {
        console.error(err);
        TP.store.del('tp-unlocked-' + S.uid, true);
        msg.textContent = /permission/i.test(err.code || err.message || '') ? 'مفتاح الإعداد غلط' : TP.errorText(err);
      }
    });
  }

  /* ---------- push notifications for this device ---------- */
  TP.push = {
    /** 'granted' | 'default' | 'denied' | 'unsupported' */
    state() { return ('Notification' in window && 'serviceWorker' in navigator) ? Notification.permission : 'unsupported'; },
    /** Ask for permission (button tap) and store this device's token. */
    async enable() {
      const token = await TP.fb.pushToken(true).catch(e => { console.warn('push', e); return null; });
      if (!token) return false;
      if (!S.device || S.device.fcm !== token) {
        await TP.fb.update('devices/' + S.uid, { fcm: token, fcmAt: TP.fb.ts() }).catch(e => console.warn('fcm save', e));
        // a new phone / new token: let the cloud alarm pick it up for today and tomorrow
        const d0 = TP.dayKey(TP.now()), d1 = TP.ops ? TP.ops.addDays(d0, 1) : null;
        [d0, d1].filter(Boolean).forEach(day => {
          if (opts.kind === 'driver') TP.fb.set('wake/' + day, { rebuildDriver: true, day }, true).catch(() => {});
          else if (TP.wakeTouch && ['wake.supervise', 'times.correct', 'lines.manage', 'missions.manage', 'settings.edit'].some(p => S.can(p))) TP.wakeTouch(day);
        });
      }
      document.dispatchEvent(new CustomEvent('tp:push-state'));
      return true;
    },
    /** Silent refresh at start when already allowed (tokens can change). */
    async refresh() { if (TP.push.state() === 'granted') return TP.push.enable(); return false; }
  };

  /** Prices, statements and profit inside the platform (switch in the settings; off = operations only). */
  TP.financeOn = settings => !!(settings && settings.financeOn === true);

  /* ---------- audit trail ---------- */
  TP.audit = function (action, target, details) {
    if (!S.ready) return Promise.resolve();
    return TP.fb.add('audit', {
      uid: S.uid, personId: S.person.id, name: S.person.name,
      action, target: String(target || ''), details: details || '', at: TP.fb.ts()
    }).catch(e => console.warn('audit', e));
  };

  /* ---------- settings defaults (agreed with the GM) ---------- */
  TP.DEFAULT_SETTINGS = {
    wakeLeadHoursLine: 2,          // alarm = departure − 2h (line drivers may change their own)
    wakeLeadHoursTourism: 2,
    wakeResponseMin: 5,            // no "صباح الخير" after 5 min → supervisor bell
    wakeEscalateMin: 8,            // (old — replaced by the ladder below)
    wakeAirMin: 7, wakeGmMin: 10, wakeCeoMin: 15,   // nobody took the case: airports manager → general manager → chairman (loud)
    nightCheckTime: '22:00',
    readyReminderTime: '21:00',    // "جاهز لبكره" reminder push
    wakeSecondMin: 2,              // second ring
    watchLateCount: 3,             // late this many times in 30 days → "تحت المتابعة"
    watchSupMin: 2,                // …then the supervisor is called after 2 minutes
    wakeGiveUpMin: 180,            // stop chasing 3 hours after the job time
    lowBatteryPct: 20,
    gpsEveryMin: 3,
    geofenceM: 300,
    autoGps: true,                 // app records arrive/leave by itself while it is open
    morningAutoLeadMin: 90,        // auto-recording of morning steps starts 90 min before the line's time
    eveningAutoWindowMin: 30,      // evening factory arrival is auto-recorded only from 30 min before the return time
    dayRolloverHour: 5,            // an unfinished day stays "today" until 5 AM
    airportFreeWaitMin: 60,        // airport price includes the first hour of waiting (prices only)
    airportDepartLeadMin: 180,     // a traveller reaches the airport 3 hours before any flight
    airportArriveEarlyOn: true,     // arrivals: the captain is there before landing (off = at landing time)
    airportArriveEarlyMin: 30,     // the driver is at the airport 30 min before landing
    airportDriveMin: 75,           // default drive from the pickup to the airport (editable per trip)
    homeAirports: 'CAI,SPX',       // "our" airports: leaving from them = توصيل, landing in them = استقبال
    flightMonthlyLimit: 190,       // automatic flight look-ups per month (free plan ≈ 400 units, ~2 per look-up) — then by hand
    /* phase 4 — customers & tracking */
    maxCustomersPerCar: 3,         // private cars: 3 customers per line at most
    noShowWaitMin: 5,              // "مجاش" shows after waiting this long at the point
    nearLeadMin: 45,               // the first point's customers hear "في الطريق ليك" from this long before the line time
    liveEverySec: 60,              // car position sent to the customer while it comes to him
    opsPhone: '',                  // operations number shown on the customer page
    /* phase 6 — accounts */
    financeOn: false,              // prices & statements inside the platform (off = operations only + Excel export)
    overtimeTierEnds: ['21:00', '23:00', '24:00'],
    taxPct: 3,
    expiryWarnDays: 30,
    /* phase 7 — trip orders (أمر الشغل), guests, keeping 3 months */
    custodyLow: 100,               // cash custody at or below this → the driver and the operations manager are told
    fuelLow: 1000,                 // fuel card below this → the airports manager and the GM are told
    maintPlan: {},                 // the GM's changes to the maintenance kilometres (TP.fleet.PARTS)
    aiNamesOn: false,              // translate unknown places / guest names to English before the guest's message (reviewed first in settings)
    retentionOn: false,            // delete records older than 3 months (only months already exported to the accounts)
    retentionMonths: 3
  };
})(window.TP = window.TP || {});
