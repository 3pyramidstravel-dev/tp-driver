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
      measureClock(dev);
      if (!dev) {
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
    document.dispatchEvent(new CustomEvent('tp:session'));
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
      try {
        if (navigator.getBattery) { const b = await navigator.getBattery(); data.battery = Math.round(b.level * 100); }
      } catch (e) { /* not available */ }
      beatAt = Date.now();
      TP.fb.update('devices/' + S.uid, data).catch(() => {});
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
      <p class="device-id">رقم الجهاز: <b>${shortId(S.uid)}</b></p>`);
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
    wakeEscalateMin: 8,            // still unhandled 8 min after the alarm → management
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
    retentionOn: false,            // delete records older than 3 months (only months already exported to the accounts)
    retentionMonths: 3
  };
})(window.TP = window.TP || {});
