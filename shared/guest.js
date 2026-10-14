/* ==========================================================================
   Guests (foreign passengers) — ready WhatsApp messages in their language,
   and "ترجم وابعت" for anything else (the cloud alarm translates for free).
   Used by the Control Tower (trip links) and the driver app (his guests).
   ========================================================================== */
(function (TP) {
  'use strict';
  const { esc } = TP, I = () => TP.i18n;
  TP.WORKER_URL = TP.WORKER_URL || 'https://tp-alarm.3pyramidstravel.workers.dev';
  const first = n => String(n || '').trim().split(/\s+/)[0] || '';
  const RLM = '\u200F', LRM = '\u200E';

  /* ---------- an Arabic name (or car model) in English letters: the usual Egyptian spelling first, letter by letter otherwise ---------- */
  const WORDS = {
    'محمد': 'Mohamed', 'احمد': 'Ahmed', 'محمود': 'Mahmoud', 'مصطفي': 'Mostafa', 'مصطفى': 'Mostafa', 'علي': 'Ali', 'عمر': 'Omar', 'عمرو': 'Amr', 'خالد': 'Khaled', 'حسن': 'Hassan', 'حسين': 'Hussein',
    'ابراهيم': 'Ibrahim', 'اسماعيل': 'Ismail', 'يوسف': 'Youssef', 'كريم': 'Karim', 'طارق': 'Tarek', 'هشام': 'Hesham', 'وليد': 'Walid', 'ايمن': 'Ayman', 'سمير': 'Samir', 'سامي': 'Samy',
    'سامح': 'Sameh', 'فتحي': 'Fathy', 'ميلاد': 'Milad', 'جميل': 'Gamil', 'توفيق': 'Tawfik', 'السيد': 'El-Sayed', 'سيد': 'Sayed', 'عبد': 'Abdel', 'عبدالله': 'Abdallah', 'عبدالرحمن': 'Abdelrahman',
    'عبدالعزيز': 'Abdelaziz', 'عبدالحميد': 'Abdelhamid', 'عادل': 'Adel', 'عاطف': 'Atef', 'عصام': 'Essam', 'عماد': 'Emad', 'اشرف': 'Ashraf', 'اسامه': 'Osama', 'ايهاب': 'Ehab', 'جمال': 'Gamal',
    'جورج': 'George', 'مينا': 'Mina', 'مايكل': 'Michael', 'بيتر': 'Peter', 'شريف': 'Sherif', 'شادي': 'Shady', 'رامي': 'Ramy', 'رامز': 'Ramez', 'ماجد': 'Maged', 'مجدي': 'Magdy', 'منير': 'Mounir',
    'نبيل': 'Nabil', 'نادر': 'Nader', 'ناصر': 'Nasser', 'هاني': 'Hany', 'هيثم': 'Haitham', 'حازم': 'Hazem', 'حمدي': 'Hamdy', 'حسام': 'Hossam', 'رضا': 'Reda', 'رجب': 'Ragab', 'رمضان': 'Ramadan',
    'صلاح': 'Salah', 'صابر': 'Saber', 'سعيد': 'Saeed', 'سعد': 'Saad', 'شعبان': 'Shaaban', 'فاروق': 'Farouk', 'فوزي': 'Fawzy', 'كمال': 'Kamal', 'ممدوح': 'Mamdouh', 'مدحت': 'Medhat', 'مراد': 'Morad',
    'ياسر': 'Yasser', 'ياسين': 'Yassin', 'زياد': 'Ziad', 'زكريا': 'Zakaria', 'نصر': 'Nasr', 'منصور': 'Mansour', 'عزت': 'Ezzat', 'عرفه': 'Arafa', 'عيد': 'Eid', 'فريد': 'Farid', 'انور': 'Anwar',
    'بهاء': 'Bahaa', 'تامر': 'Tamer', 'ثروت': 'Tharwat', 'جلال': 'Galal', 'حمزه': 'Hamza', 'حامد': 'Hamed', 'رافت': 'Raafat', 'رشاد': 'Rashad', 'شوقي': 'Shawky', 'صبري': 'Sabry', 'عوض': 'Awad',
    'فهمي': 'Fahmy', 'لطفي': 'Lotfy', 'مسعد': 'Mosaad', 'نجيب': 'Naguib', 'هاشم': 'Hashem', 'وائل': 'Wael', 'يحيي': 'Yehia', 'يحيى': 'Yehia', 'اسلام': 'Eslam', 'سلامه': 'Salama', 'بكر': 'Bakr',
    'سارة': 'Sara', 'ساره': 'Sara', 'منى': 'Mona', 'مني': 'Mona', 'هبه': 'Heba', 'نهى': 'Noha', 'نهي': 'Noha', 'مريم': 'Mariam', 'فاطمه': 'Fatma', 'دينا': 'Dina', 'ريهام': 'Reham', 'شيماء': 'Shaimaa',
    'رانيا': 'Rania', 'ياسمين': 'Yasmin', 'نورا': 'Nora', 'اميره': 'Amira', 'ايمان': 'Eman', 'هند': 'Hend', 'سلمى': 'Salma', 'سلمي': 'Salma', 'نيره': 'Nayera', 'مروه': 'Marwa',
    'تويوتا': 'Toyota', 'كورولا': 'Corolla', 'كامري': 'Camry', 'فورتشنر': 'Fortuner', 'هيونداي': 'Hyundai', 'هيونداى': 'Hyundai', 'النترا': 'Elantra', 'اكسنت': 'Accent', 'توسان': 'Tucson',
    'كيا': 'Kia', 'سيراتو': 'Cerato', 'سبورتاج': 'Sportage', 'نيسان': 'Nissan', 'صني': 'Sunny', 'سنترا': 'Sentra', 'ميتسوبيشي': 'Mitsubishi', 'لانسر': 'Lancer', 'شيفروليه': 'Chevrolet',
    'اوبترا': 'Optra', 'بيجو': 'Peugeot', 'سكودا': 'Skoda', 'اوكتافيا': 'Octavia', 'رينو': 'Renault', 'لوجان': 'Logan', 'شيري': 'Chery', 'تيجو': 'Tiggo', 'جيلي': 'Geely', 'مرسيدس': 'Mercedes',
    'ستاريا': 'Staria', 'هوندا': 'Honda', 'سيفيك': 'Civic', 'فولكس': 'Volkswagen', 'باسات': 'Passat', 'كابتن': 'Captain'
  };
  const LET = { 'ا': 'a', 'أ': 'a', 'إ': 'e', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'g', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd',
    'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'k', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'ة': 'a', 'و': 'o', 'ي': 'y', 'ى': 'a', 'ئ': 'e', 'ؤ': 'o', 'ء': '' };
  const norm = w => w.replace(/[أإآ]/g, 'ا').replace(/ة$/, 'ه').replace(/[\u064B-\u0652]/g, '');
  TP.enName = function (text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).map(w => {
      if (!/[\u0600-\u06FF]/.test(w)) return w;
      const n = norm(w);
      if (WORDS[n]) return WORDS[n];
      if (n.startsWith('ال') && WORDS[n.slice(2)]) return 'El-' + WORDS[n.slice(2)];
      if (n.startsWith('عبد') && n.length > 3 && WORDS[n.slice(3)]) return 'Abdel' + WORDS[n.slice(3)].toLowerCase();
      const t = [...w].map(ch => LET[ch] !== undefined ? LET[ch] : ch).join('');
      return t.charAt(0).toUpperCase() + t.slice(1);
    }).join(' ');
  };
  /** The job title in English, from the role in "الموظفين". */
  const TITLES = { gm: 'General Manager', finance: 'Finance Manager', airports: 'Airports Manager', operations: 'Operations Manager', supervisor: 'Operation Supervisor' };
  /** The English signature of the staff member who sends (rtl: an Arabic message — every line kept on the right). */
  TP.signature = function (person, rtl) {
    const staff = person && person.type === 'staff';
    // the name only — a note after a dash or a bracket ("أحمد سمير - الموبايل") is not part of it
    const own = String((person && person.name) || '').split(/\s*[-–—(|]\s*/)[0].trim();
    const lines = ['Best Regards,'].concat(staff ? [`*${(person.nameEn || '').trim() || TP.enName(own)}*`, TITLES[person.role] || 'Operations Team'] : [], ['VIP & Airport Transport', '*Three Pyramids Travel*']);
    // in an Arabic message: kept on the right (RLM before) with its own punctuation in place (LRM after — "Best Regards," not ",Best Regards")
    return lines.map(l => rtl ? RLM + l + LRM : l).join('\n');
  };
  const sender = () => (TP.session && TP.session.person) || null;
  /** A WhatsApp text shown in the app as WhatsApp shows it: *bold*, _italic_ (escaped first). */
  TP.waPreview = text => esc(text || '').replace(/(^|[\s\u200E\u200F>(])\*([^*\n]+)\*(?=$|[\s\u200E\u200F.,:;!?)←→])/gm, '$1<b>$2</b>').replace(/(^|[\s\u200E\u200F])_([^_\n]+)_(?=$|[\s\u200E\u200F.,:;!?])/gm, '$1<i>$2</i>');
  // +20 112 709 0242 (Egypt) — other countries: + and the digits
  const intl = ph => { const n = TP.phoneIntl(ph || ''); if (!n) return ph || ''; const e = n.match(/^20(1\d)(\d)(\d{3})(\d{4})$/); return e ? `+20 ${e[1]}${e[2]} ${e[3]} ${e[4]}` : '+' + n; };
  TP.phoneNice = intl;

  /* ---------- the ride card for a customer (like a formal e-mail): the captain, his number, the car, the date and time, from / to, the live link ---------- */
  const CARD = {
    ar: { greet: 'أهلاً يا فندم 🌹\nتحية طيبة وبعد،\nيسعدنا إفادة حضرتك ببيانات رحلتك كالتالي:', cap: 'الكابتن', ph: 'رقم الكابتن', car: 'العربية', date: 'التاريخ', time: 'ميعاد الوصول', from: 'من', to: 'إلى', fl: 'رقم الرحلة', term: 'صالة', link: 'لمتابعة عربيتك لحظة بلحظة', close: 'نتمنى لحضرتك رحلة سعيدة، ولأي استفسار يسعدنا تواصلك معنا.', arrow: '←' },
    en: { greet: 'Dear {n},\nGreetings from Three Pyramids Travel.\nWe are pleased to share your ride details as follows:', cap: 'Captain', ph: 'Contact Number', car: 'Car', date: 'Date', time: 'Arrival Time', from: 'From', to: 'To', fl: 'Flight', term: 'Terminal', link: 'Follow your car live', close: 'We wish you a pleasant journey. Should you need any assistance, please do not hesitate to contact us.', arrow: '→' },
    de: { greet: 'Sehr geehrte/r {n},\nherzliche Grüße von Three Pyramids Travel.\nGerne teilen wir Ihnen Ihre Fahrtdetails mit:', cap: 'Fahrer', ph: 'Telefon', car: 'Fahrzeug', date: 'Datum', time: 'Ankunftszeit', from: 'Von', to: 'Nach', fl: 'Flug', term: 'Terminal', link: 'Ihr Fahrzeug live verfolgen', close: 'Wir wünschen Ihnen eine angenehme Reise. Für Fragen stehen wir Ihnen jederzeit gerne zur Verfügung.', arrow: '→' },
    fr: { greet: 'Cher/Chère {n},\nSalutations de Three Pyramids Travel.\nNous avons le plaisir de vous communiquer les détails de votre trajet :', cap: 'Chauffeur', ph: 'Téléphone', car: 'Voiture', date: 'Date', time: "Heure d'arrivée", from: 'De', to: 'À', fl: 'Vol', term: 'Terminal', link: 'Suivez votre voiture en direct', close: 'Nous vous souhaitons un agréable voyage. Pour toute question, n’hésitez pas à nous contacter.', arrow: '→' },
    ru: { greet: 'Уважаемый(ая) {n},\nприветствуем вас от Three Pyramids Travel.\nСообщаем детали вашей поездки:', cap: 'Водитель', ph: 'Телефон', car: 'Автомобиль', date: 'Дата', time: 'Время подачи', from: 'Откуда', to: 'Куда', fl: 'Рейс', term: 'Терминал', link: 'Следите за машиной онлайн', close: 'Желаем приятной поездки. Если понадобится помощь, обращайтесь к нам.', arrow: '→' },
    zh: { greet: '尊敬的 {n}：\nThree Pyramids Travel 向您问好。\n您的行程信息如下：', cap: '司机', ph: '联系电话', car: '车辆', date: '日期', time: '到达时间', from: '出发地', to: '目的地', fl: '航班', term: '航站楼', link: '实时查看您的车辆', close: '祝您旅途愉快。如需任何帮助，请随时与我们联系。', arrow: '→' },
    ko: { greet: '{n}님께,\nThree Pyramids Travel에서 인사드립니다.\n고객님의 이동 정보를 안내해 드립니다:', cap: '기사', ph: '연락처', car: '차량', date: '날짜', time: '도착 시간', from: '출발', to: '도착', fl: '항공편', term: '터미널', link: '실시간으로 차량 확인', close: '즐거운 여행 되시기 바랍니다. 도움이 필요하시면 언제든지 연락 주세요.', arrow: '→' }
  };
  function rideCard(m, c, link, drv) {
    const L = I().ok(c.lang) ? c.lang : 'ar', T = CARD[L] || CARD.en, ar = L === 'ar', fl = m.flight || {};
    const d = drv && typeof drv === 'object' ? drv : null;
    const v = d && d.vehicleId && TP.q && TP.q.vehicle ? TP.q.vehicle(d.vehicleId) : null;
    const capName = d ? (ar ? d.name : ((d.nameEn || '').trim() || TP.enName(d.name))) : (drv || '');
    const carTxt = v && v.model ? (ar ? v.model : TP.enName(v.model)) : '';
    const ms = TP.ops.cairoMs(m.day, m.time || '12:00'), hasT = /^\d{2}:\d{2}$/.test(m.time || '');
    const row = (k, val) => val ? `*${k}* ${T.arrow} ${val}` : null;                       // an empty row is left out (no blank line)
    const lines = [(ar ? RLM : '') + '*THREE PYRAMIDS TRAVEL*', (ar ? RLM : '') + '_VIP & Airport Transport_', '', T.greet.replace('{n}', first(c.name)), '',
      row(T.cap, capName), row(T.ph, d && d.phone ? (ar ? LRM : '') + intl(d.phone) : ''), row(T.car, carTxt),
      row(T.date, ar ? TP.fmtDay(m.day + 'T12:00:00') : I().fmtDay(L, ms)), row(T.time, hasT ? (ar ? TP.ops.hm12(m.time) : I().fmtTime(L, ms)) : ''),
      row(T.fl, m.type === 'airport' && fl.no ? fl.no + (fl.terminal ? ` — ${T.term} ${fl.terminal}` : '') : ''),
      row(T.from, (m.from && m.from.name) || ''), row(T.to, (m.to && m.to.name) || ''), '',
      link ? row(T.link, link) : null, '', T.close, '', TP.signature(sender(), ar)];
    return lines.filter(x => x !== null).join('\n').replace(/\n{3,}/g, '\n\n');
  }

  /** Arabic text → the guest's language (signed-in staff or drivers only). */
  TP.translate = async function (text, to) {
    const tok = await TP.fb.idToken().catch(() => null);
    if (!tok) throw new Error('not-signed-in');
    const r = await fetch(TP.WORKER_URL + '/translate', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ text: String(text).slice(0, 1200), from: 'ar', to }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.text) throw new Error(j.error || ('http ' + r.status));
    return j.text;
  };

  /**
   * The ready messages for one guest of a trip. m = the trip, c = the guest ({name, phone, lang}),
   * link = his page (staff only — the driver does not hold the link), drv = the driver (his English name goes to foreign guests) or a name.
   */
  function messages(m, c, link, drv) {
    const L = I().ok(c.lang) ? c.lang : 'ar',
      driver = drv && typeof drv === 'object' ? (L !== 'ar' && drv.nameEn ? drv.nameEn : drv.name || '') : drv || '', t = (k, v) => I().t(L, k, v), fl = m.flight || {};
    const arr = m.type === 'airport' && fl.dir === 'arr', term = fl.terminal ? t('termTag', { t: fl.terminal }) : '';
    const out = [];
    if (link) out.push({ k: 'card', label: arr ? 'رسالة الترحيب وبيانات الرحلة' : 'بيانات الرحلة', text: rideCard(m, c, link, drv) });
    if (arr) out.push({ k: 'waiting', label: 'السواق مستنيك', text: t('msgWaiting', { d: driver || '', t: term }) });
    if (m.type === 'airport' && Number(fl.delayMin) >= 15) out.push({ k: 'delay', label: 'الطيارة متأخرة', text: t('msgDelay', { f: fl.no || '', d: driver || '' }) });
    return out;
  }

  /** WhatsApp without a number: WhatsApp opens its own list of chats and groups to choose from. */
  const waShare = text => 'https://wa.me/?text=' + encodeURIComponent(text || '');
  /** One window: the ready messages + "ترجم وابعت" — to the guest's own number, to a group / anyone (WhatsApp's list), or copied. */
  function compose(m, c, link, driver, car) {
    const L0 = I().ok(c.lang) ? c.lang : 'ar';
    let L = L0;
    const draw = () => {
      const cc = Object.assign({}, c, { lang: L });
      // the driver (no link): "on my way" / "I am here" first, in the guest's language
      const steps = link ? [] : [['start', 'إني اتحركت'], ['pickup', 'إني وصلت']].map(([k, label]) => ({ k: 's' + k, label, text: stepMessage(m, cc, k, driver, car) })).filter(x => x.text);
      const list = steps.concat(messages(m, cc, link, driver));
      const wa = text => TP.waLink(c.phone, text);
      const btns = (text, key) => `${c.phone && wa(text) ? `<a class="btn btn-primary btn-sm" href="${esc(wa(text))}" target="_blank" rel="noopener">📱 للعميل</a>` : ''}<a class="btn btn-ghost btn-sm" href="${esc(waShare(text))}" target="_blank" rel="noopener" title="الواتساب هيفتح قايمة الشاتات والجروبات — اختار">👥 لجروب / حد تاني</a><button type="button" class="btn btn-ghost btn-sm" data-gcopy="${esc(key)}">انسخ</button>`;
      TP.openModal('رسالة لـ ' + c.name, `
        <div class="chips" style="margin-bottom:10px">${I().LANGS.map(l => `<button type="button" class="chip ${l.id === L ? 'active' : ''}" data-gl="${l.id}">${esc(l.name)}</button>`).join('')}</div>
        ${list.map(x => `<div class="gm"><div class="gm-h"><b>${esc(x.label)}</b>${btns(x.text, x.k)}</div><p class="gm-t" dir="${I().info(L).dir}">${TP.waPreview(x.text)}</p></div>`).join('')}
        <div class="gm"><div class="gm-h"><b>ترجم وابعت</b><small class="muted">اكتب بالعربي، والرسالة تطلع بـ ${esc(I().info(L).name)}</small></div>
          <textarea class="input" id="gIn" rows="3" maxlength="1000" placeholder="مثال: السواق قدام البوابة رقم 2، العربية بيضا"></textarea>
          <div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" id="gGo" ${L === 'ar' ? 'disabled' : ''}>ترجم</button><span class="muted small" id="gSt"></span></div>
          <textarea class="input" id="gOut" rows="3" dir="${I().info(L).dir}" style="margin-top:8px" placeholder="الترجمة هتظهر هنا — تقدر تعدّل فيها"></textarea>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">${c.phone ? '<button type="button" class="btn btn-primary btn-sm" id="gSend">📱 للعميل</button>' : ''}<button type="button" class="btn btn-ghost btn-sm" id="gShare">👥 لجروب / حد تاني</button><button type="button" class="btn btn-ghost btn-sm" id="gCopy">انسخ</button></div></div>
        ${c.phone ? '' : '<p class="muted small">العميل ده مالوش موبايل متسجل — ابعتها لجروب أو انسخها.</p>'}`, null, { noSave: true, wide: true, noFocus: true });
      TP.$$('#tp-modal [data-gl]').forEach(b => b.onclick = () => { L = b.dataset.gl; draw(); });
      TP.$$('#tp-modal [data-gcopy]').forEach(b => b.onclick = () => { const x = list.find(y => y.k === b.dataset.gcopy); copy(x.text); });
      const go = TP.$('#gGo'), out = TP.$('#gOut'), stEl = TP.$('#gSt');
      go.onclick = async () => {
        const txt = TP.$('#gIn').value.trim(); if (!txt) return TP.toast('اكتب الرسالة بالعربي');
        go.disabled = true; stEl.textContent = 'بيترجم…';
        try { out.value = await TP.translate(txt, L); stEl.textContent = 'اتترجمت ✓ — راجعها قبل ما تبعت'; }
        catch (e) { console.warn(e); stEl.textContent = 'الترجمة مش متاحة دلوقتي — اكتبها بإيدك أو استخدم ترجمة الكيبورد'; }
        finally { go.disabled = false; }
      };
      const typed = () => out.value.trim() || TP.$('#gIn').value.trim();
      const send = TP.$('#gSend'); if (send) send.onclick = () => { const v = typed(); if (!v) return TP.toast('اكتب الرسالة'); window.open(wa(v), '_blank'); };
      TP.$('#gShare').onclick = () => { const v = typed(); if (!v) return TP.toast('اكتب الرسالة'); window.open(waShare(v), '_blank'); };
      TP.$('#gCopy').onclick = () => copy(out.value.trim() || TP.$('#gIn').value.trim());
    };
    draw();
  }
  function copy(text) {
    if (!text) return;
    (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => TP.toast('اتنسخ ✓')).catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); TP.toast('اتنسخ ✓'); } catch (e) { /* ignore */ } ta.remove(); });
  }
  /** The one message for a trip step, in the guest's language (no link — the driver does not hold it). */
  function stepMessage(m, c, key, drv, car) {
    const L = I().ok(c.lang) ? c.lang : 'ar', t = (k, v) => I().t(L, k, v), fl = m.flight || {};
    const driver = drv && typeof drv === 'object' ? (L !== 'ar' && drv.nameEn ? drv.nameEn : drv.name || '') : drv || '';
    car = car ? t('carTag', { c: car }) : '';
    if (key === 'start') return t('msgOnWay', { n: I().honor(L, c.name, c.sex), d: driver, c: car || '' });
    if (key === 'pickup') return m.type === 'airport' && fl.dir === 'arr' ? t('msgWaiting', { d: driver, t: fl.terminal ? t('termTag', { t: fl.terminal }) : '' }) : t('msgArrived', { d: driver, c: car || '' });
    return '';
  }
  TP.guest = { messages, compose, stepMessage, rideCard };
})(window.TP = window.TP || {});
