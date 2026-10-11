/* ==========================================================================
   Guests' languages — the customer page and the ready messages to guests.
   ar (default) · en · de · fr · ru · zh · ko
   Pure data + small helpers: used by the customer page, the Control Tower,
   the driver app and the cloud alarm (inlined there). No DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const LANGS = [
    { id: 'ar', name: 'العربية', dir: 'rtl', loc: 'ar-EG-u-nu-latn' },
    { id: 'en', name: 'English', dir: 'ltr', loc: 'en-GB' },
    { id: 'de', name: 'Deutsch', dir: 'ltr', loc: 'de-DE' },
    { id: 'fr', name: 'Français', dir: 'ltr', loc: 'fr-FR' },
    { id: 'ru', name: 'Русский', dir: 'ltr', loc: 'ru-RU' },
    { id: 'zh', name: '中文', dir: 'ltr', loc: 'zh-CN' },
    { id: 'ko', name: '한국어', dir: 'ltr', loc: 'ko-KR' }
  ];
  // [ar, en, de, fr, ru, zh, ko]
  const T = {
    hello: ['أهلاً {n} 👋', 'Hello {n} 👋', 'Hallo {n} 👋', 'Bonjour {n} 👋', 'Здравствуйте, {n} 👋', '{n}，您好 👋', '{n}님, 안녕하세요 👋'],
    yourRide: ['مشوارك', 'Your ride', 'Ihre Fahrt', 'Votre trajet', 'Ваша поездка', '您的行程', '고객님의 이동'],
    st_near: ['العربية في الطريق ليك', 'Your car is on the way', 'Ihr Fahrzeug ist unterwegs', 'Votre voiture est en route', 'Машина уже едет к вам', '车辆正在前往接您', '차량이 고객님께 가고 있습니다'],
    st_arrived: ['العربية وصلت وجاهزة', 'Your car has arrived', 'Ihr Fahrzeug ist angekommen', 'Votre voiture est arrivée', 'Машина прибыла', '车辆已到达', '차량이 도착했습니다'],
    st_arrivedAir: ['السواق وصل المطار ومستنيك', 'Your driver is at the airport waiting for you', 'Ihr Fahrer wartet am Flughafen auf Sie', "Votre chauffeur vous attend à l'aéroport", 'Водитель ждёт вас в аэропорту', '司机已在机场等候您', '기사님이 공항에서 기다리고 있습니다'],
    st_picked: ['رحلة سعيدة', 'Have a pleasant ride', 'Gute Fahrt', 'Bon trajet', 'Приятной поездки', '祝您旅途愉快', '즐거운 이동 되세요'],
    st_dropped: ['وصلت بالسلامة', 'You have arrived safely', 'Sie sind sicher angekommen', 'Vous êtes bien arrivé(e)', 'Вы благополучно прибыли', '您已安全抵达', '안전하게 도착하셨습니다'],
    st_evening: ['العربية مستنياك للرجوع', 'Your car is waiting to take you back', 'Ihr Fahrzeug wartet für die Rückfahrt', 'Votre voiture vous attend pour le retour', 'Машина ждёт вас для обратной поездки', '车辆正在等候接您返回', '복귀 차량이 기다리고 있습니다'],
    st_done: ['الرحلة خلصت', 'Your ride is complete', 'Ihre Fahrt ist beendet', 'Votre trajet est terminé', 'Поездка завершена', '行程已结束', '이동이 완료되었습니다'],
    st_skip: ['مسجلين إنك مش راكب النهارده', "We know you're not riding today", 'Sie fahren heute nicht mit — notiert', "C'est noté : vous ne venez pas aujourd'hui", 'Отмечено: сегодня вы не едете', '已记录：您今天不乘车', '오늘은 탑승하지 않으시는 것으로 기록했습니다'],
    st_noshow: ['العربية استنتك ومشيت', 'The car waited for you and has left', 'Das Fahrzeug hat gewartet und ist abgefahren', 'La voiture vous a attendu puis est repartie', 'Машина ждала вас и уехала', '车辆已等候并已离开', '차량이 기다리다가 출발했습니다'],
    st_cancelled: ['المشوار ده اتلغى', 'This ride has been cancelled', 'Diese Fahrt wurde storniert', 'Ce trajet a été annulé', 'Эта поездка отменена', '此行程已取消', '이 이동은 취소되었습니다'],
    st_idleLine: ['لما العربية تتحرك ليك هيوصلك إشعار هنا', "You'll be notified here when the car sets off to you", 'Sie werden hier benachrichtigt, sobald das Fahrzeug losfährt', 'Vous serez prévenu(e) ici dès que la voiture partira vers vous', 'Здесь появится уведомление, когда машина выедет к вам', '车辆出发时您会在这里收到通知', '차량이 출발하면 여기에서 알려 드립니다'],
    eta: ['هتوصلك في حوالي', 'Arriving in about', 'Ankunft in etwa', 'Arrivée dans environ', 'Прибудет примерно через', '预计到达还需约', '도착까지 약'],
    min1: ['دقيقة', '1 minute', '1 Minute', '1 minute', '1 минуту', '1 分钟', '1분'],
    mins: ['{n} دقيقة', '{n} minutes', '{n} Minuten', '{n} minutes', '{n} мин', '{n} 分钟', '{n}분'],
    updated: ['آخر تحديث من {n} دقيقة', 'Updated {n} min ago', 'Aktualisiert vor {n} Min.', 'Mis à jour il y a {n} min', 'Обновлено {n} мин назад', '{n} 分钟前更新', '{n}분 전 업데이트'],
    card: ['كارنيه الشركة', 'Company ID', 'Firmenausweis', 'Carte de la société', 'Удостоверение компании', '公司证件', '회사 신분증'],
    code: ['كود {n}', 'ID {n}', 'Nr. {n}', 'N° {n}', '№ {n}', '编号 {n}', '번호 {n}'],
    sound: ['🔔 دوس هنا علشان صوت "العربية وصلت" يشتغل', '🔔 Tap here to turn on the "car has arrived" sound', '🔔 Hier tippen, um den Ton „Fahrzeug angekommen" einzuschalten', '🔔 Touchez ici pour activer le son « voiture arrivée »', '🔔 Нажмите, чтобы включить звук «машина прибыла»', '🔔 点击此处开启"车辆已到达"提示音', '🔔 "차량 도착" 알림음을 켜려면 여기를 누르세요'],
    landed: ['✈ نزلت من الطيارة', "✈ I've landed", '✈ Ich bin gelandet', "✈ J'ai atterri", '✈ Я приземлился(-ась)', '✈ 我已落地', '✈ 착륙했습니다'],
    out: ['🧳 خلصت الجوازات والشنط وطالع', "🧳 Passport & bags done — I'm coming out", '🧳 Pass & Gepäck erledigt — ich komme raus', '🧳 Passeport et bagages OK — je sors', '🧳 Паспорт и багаж готовы — выхожу', '🧳 入境和行李已办完，正在出来', '🧳 입국 심사와 짐 찾기 완료 — 나가는 중입니다'],
    landedOk: ['السواق هيعرف إنك نزلت ✓', 'Your driver knows you have landed ✓', 'Ihr Fahrer weiß, dass Sie gelandet sind ✓', 'Votre chauffeur sait que vous avez atterri ✓', 'Водитель знает, что вы приземлились ✓', '司机已知道您落地 ✓', '기사님께 착륙 사실을 알렸습니다 ✓'],
    outOk: ['السواق هيعرف إنك طالع ✓', 'Your driver knows you are coming out ✓', 'Ihr Fahrer weiß, dass Sie herauskommen ✓', 'Votre chauffeur sait que vous sortez ✓', 'Водитель знает, что вы выходите ✓', '司机已知道您正在出来 ✓', '기사님께 나가는 중이라고 알렸습니다 ✓'],
    told: ['السواق هيعرف ✓', 'Your driver has been told ✓', 'Ihr Fahrer wurde informiert ✓', 'Votre chauffeur est prévenu ✓', 'Водитель предупреждён ✓', '已通知司机 ✓', '기사님께 알렸습니다 ✓'],
    rateQ: ['إيه رأيك في المشوار؟', 'How was your ride?', 'Wie war Ihre Fahrt?', 'Comment était votre trajet ?', 'Как прошла поездка?', '您对本次行程满意吗？', '이동은 어떠셨나요?'],
    rateNote: ['ملاحظة (اختياري)', 'Comment (optional)', 'Kommentar (optional)', 'Commentaire (facultatif)', 'Комментарий (необязательно)', '备注（可选）', '의견 (선택)'],
    rateSend: ['ابعت التقييم', 'Send rating', 'Bewertung senden', 'Envoyer la note', 'Отправить оценку', '提交评价', '평가 보내기'],
    rateThanks: ['شكراً على تقييمك 🌟', 'Thank you for your rating 🌟', 'Danke für Ihre Bewertung 🌟', 'Merci pour votre note 🌟', 'Спасибо за оценку 🌟', '感谢您的评价 🌟', '평가해 주셔서 감사합니다 🌟'],
    pickStars: ['اختار عدد النجوم', 'Please choose the stars', 'Bitte Sterne wählen', 'Choisissez les étoiles', 'Выберите количество звёзд', '请选择星级', '별점을 선택해 주세요'],
    pushBanner: ['فعّل الإشعارات علشان يوصلك لما العربية تقرب وتوصل حتى والصفحة مقفولة', 'Turn on notifications to know when your car is near and arrives — even with this page closed', 'Aktivieren Sie Benachrichtigungen, um zu erfahren, wann Ihr Fahrzeug naht und ankommt — auch bei geschlossener Seite', "Activez les notifications pour savoir quand votre voiture approche et arrive — même page fermée", 'Включите уведомления, чтобы узнать, когда машина подъезжает и прибывает — даже при закрытой странице', '开启通知，即使关闭页面也能知道车辆何时接近和到达', '페이지를 닫아도 차량이 가까워지거나 도착하면 알림을 받으려면 알림을 켜세요'],
    pushOn: ['فعّل', 'Turn on', 'Aktivieren', 'Activer', 'Включить', '开启', '켜기'],
    pushOk: ['الإشعارات اتفعلت ✓', 'Notifications are on ✓', 'Benachrichtigungen sind aktiv ✓', 'Notifications activées ✓', 'Уведомления включены ✓', '通知已开启 ✓', '알림이 켜졌습니다 ✓'],
    pushFail: ['مقدرناش نفعّل الإشعارات — اسمح بيها من إعدادات المتصفح', 'Could not turn on notifications — please allow them in your browser settings', 'Benachrichtigungen konnten nicht aktiviert werden — bitte in den Browsereinstellungen erlauben', "Impossible d'activer les notifications — autorisez-les dans les réglages du navigateur", 'Не удалось включить уведомления — разрешите их в настройках браузера', '无法开启通知 — 请在浏览器设置中允许', '알림을 켤 수 없습니다 — 브라우저 설정에서 허용해 주세요'],
    pushNo: ['الموبايل ده مش بيدعم الإشعارات — خلي الصفحة مفتوحة', "This phone doesn't support notifications — please keep this page open", 'Dieses Telefon unterstützt keine Benachrichtigungen — bitte Seite geöffnet lassen', 'Ce téléphone ne prend pas en charge les notifications — gardez cette page ouverte', 'Этот телефон не поддерживает уведомления — держите страницу открытой', '此手机不支持通知 — 请保持此页面打开', '이 휴대폰은 알림을 지원하지 않습니다 — 이 페이지를 열어 두세요'],
    pushIos: ['، أو ضيفها للشاشة الرئيسية (مشاركة ← Add to Home Screen) وافتحها من هناك', ', or add it to your Home Screen (Share → Add to Home Screen) and open it from there', ' oder zum Home-Bildschirm hinzufügen (Teilen → Zum Home-Bildschirm) und dort öffnen', " ou ajoutez-la à l'écran d'accueil (Partager → Sur l'écran d'accueil) et ouvrez-la depuis là", ' или добавьте её на экран «Домой» (Поделиться → На экран «Домой») и откройте оттуда', '，或添加到主屏幕（分享 → 添加到主屏幕）后从那里打开', ' 또는 홈 화면에 추가(공유 → 홈 화면에 추가)한 뒤 그곳에서 여세요'],
    call: ['كلّم الشركة', 'Call the company', 'Firma anrufen', "Appeler l'agence", 'Позвонить в компанию', '致电公司', '회사에 전화'],
    emergency: ['🆘 طوارئ — كلّم الشركة على واتساب', '🆘 Emergency — WhatsApp the company', '🆘 Notfall — Firma per WhatsApp', "🆘 Urgence — WhatsApp à l'agence", '🆘 Экстренно — WhatsApp компании', '🆘 紧急情况 — 通过 WhatsApp 联系公司', '🆘 긴급 — 회사에 WhatsApp 보내기'],
    emergencyMsg: ['طوارئ — أنا {n}{f}. محتاج مساعدة من فضلك.', 'Emergency — this is {n}{f}. I need help, please.', 'Notfall — hier ist {n}{f}. Ich brauche bitte Hilfe.', "Urgence — ici {n}{f}. J'ai besoin d'aide, s'il vous plaît.", 'Экстренно — это {n}{f}. Мне нужна помощь.', '紧急情况 — 我是 {n}{f}，需要帮助。', '긴급 — {n}{f}입니다. 도움이 필요합니다.'],
    flightTag: [' — رحلة {f}', ', flight {f}', ', Flug {f}', ', vol {f}', ', рейс {f}', '，航班 {f}', ', 항공편 {f}'],
    okComing: ['تمام، جاي', "OK, I'm coming", 'OK, ich komme', "D'accord, j'arrive", 'Хорошо, иду', '好的，我马上来', '네, 지금 갑니다'],
    withSign: ['صالة {t} — معاه لافتة باسمك', 'Terminal {t} — holding a sign with your name', 'Terminal {t} — mit einem Schild mit Ihrem Namen', 'Terminal {t} — avec une pancarte à votre nom', 'Терминал {t} — с табличкой с вашим именем', '{t} 号航站楼 — 手持写有您名字的接机牌', '{t} 터미널 — 고객님 성함이 적힌 피켓을 들고 있습니다'],
    signWait: ['السواق مستنيك قدام صالة الوصول', 'Your driver is waiting for you in front of the arrivals hall', 'Ihr Fahrer wartet vor der Ankunftshalle auf Sie', 'Votre chauffeur vous attend devant le hall des arrivées', 'Водитель ждёт вас у зала прилёта', '您的司机正在到达大厅前等候您', '기사님이 도착 홀 앞에서 기다리고 있습니다'],
    meet: ['مكان المقابلة', 'Where to meet your driver', 'Treffpunkt mit Ihrem Fahrer', 'Où retrouver votre chauffeur', 'Где встретить водителя', '与司机会面的地点', '기사님을 만나는 장소'],
    delayed: ['الطيارة متأخرة {n} دقيقة — السواق عارف وهيستناك', 'Your flight is delayed by {n} min — your driver knows and will wait for you', 'Ihr Flug hat {n} Min. Verspätung — Ihr Fahrer weiß Bescheid und wartet auf Sie', 'Votre vol a {n} min de retard — votre chauffeur est informé et vous attendra', 'Ваш рейс задерживается на {n} мин — водитель знает и подождёт вас', '您的航班延误 {n} 分钟 — 司机已知悉并会等候您', '항공편이 {n}분 지연됩니다 — 기사님이 알고 있으며 기다릴 예정입니다'],
    delayedDep: ['الطيارة اتأخرت — ميعاد العربية بقى {t}', 'Your flight is delayed — your pickup is now at {t}', 'Ihr Flug ist verspätet — Abholung jetzt um {t}', 'Votre vol est retardé — prise en charge désormais à {t}', 'Рейс задерживается — машина подъедет в {t}', '航班延误 — 接您的时间改为 {t}', '항공편이 지연되어 픽업 시간이 {t}(으)로 변경되었습니다'],
    landing: ['الهبوط', 'Landing', 'Landung', 'Atterrissage', 'Посадка', '降落', '착륙'],
    takeoff: ['الإقلاع', 'Departure', 'Abflug', 'Décollage', 'Вылет', '起飞', '출발'],
    from: ['جاية من', 'from', 'aus', 'en provenance de', 'из', '来自', '출발지:'],
    to: ['رايحة', 'to', 'nach', 'à destination de', 'в', '前往', '도착지:'],
    terminal: ['صالة', 'Terminal', 'Terminal', 'Terminal', 'Терминал', '航站楼', '터미널'],
    flightData: ['بيانات الرحلات: AeroDataBox', 'Flight data: AeroDataBox', 'Flugdaten: AeroDataBox', 'Données de vol : AeroDataBox', 'Данные о рейсах: AeroDataBox', '航班数据：AeroDataBox', '항공편 정보: AeroDataBox'],
    pickupAt: ['ميعاد العربية', 'Pickup time', 'Abholzeit', 'Heure de prise en charge', 'Время подачи', '接送时间', '픽업 시간'],
    linkMissing: ['اللينك ناقص', 'This link is incomplete', 'Dieser Link ist unvollständig', 'Ce lien est incomplet', 'Ссылка неполная', '链接不完整', '링크가 완전하지 않습니다'],
    linkMissing2: ['افتح اللينك اللي وصلك على الواتساب زي ما هو.', 'Please open the link you received on WhatsApp exactly as it is.', 'Bitte öffnen Sie den per WhatsApp erhaltenen Link unverändert.', 'Ouvrez le lien reçu sur WhatsApp tel quel.', 'Откройте ссылку из WhatsApp без изменений.', '请按原样打开您在 WhatsApp 收到的链接。', 'WhatsApp으로 받은 링크를 그대로 열어 주세요.'],
    linkDead: ['اللينك ده مش شغال', 'This link is not active', 'Dieser Link ist nicht aktiv', "Ce lien n'est pas actif", 'Ссылка неактивна', '此链接已失效', '이 링크는 사용할 수 없습니다'],
    linkDead2: ['يمكن المشوار اتلغى أو اللينك اتغيّر. كلّم الشركة.', 'The ride may have been cancelled or the link changed. Please contact the company.', 'Die Fahrt wurde evtl. storniert oder der Link geändert. Bitte kontaktieren Sie die Firma.', "Le trajet a peut-être été annulé ou le lien modifié. Contactez l'agence.", 'Возможно, поездку отменили или ссылка изменилась. Свяжитесь с компанией.', '行程可能已取消或链接已更改，请联系公司。', '이동이 취소되었거나 링크가 변경되었을 수 있습니다. 회사에 문의해 주세요.'],
    noNet: ['مفيش اتصال', 'No connection', 'Keine Verbindung', 'Pas de connexion', 'Нет соединения', '无网络连接', '연결 없음'],
    noNet2: ['اتأكد من الإنترنت وافتح اللينك تاني.', 'Please check your internet and open the link again.', 'Bitte Internet prüfen und Link erneut öffnen.', 'Vérifiez votre connexion et rouvrez le lien.', 'Проверьте интернет и откройте ссылку снова.', '请检查网络后重新打开链接。', '인터넷 연결을 확인한 뒤 링크를 다시 열어 주세요.'],
    onlyYou: ['اللينك ده ليك انت بس — متبعتهوش لحد', 'This link is for you only — please do not share it', 'Dieser Link ist nur für Sie — bitte nicht weitergeben', 'Ce lien est personnel — merci de ne pas le partager', 'Эта ссылка только для вас — не передавайте её', '此链接仅供您本人使用，请勿转发', '이 링크는 고객님 전용입니다 — 공유하지 마세요'],
    lang: ['اللغة', 'Language', 'Sprache', 'Langue', 'Язык', '语言', '언어'],
    // ready messages (WhatsApp, sent by the staff or the driver with one tap)
    msgWelcome: ['أهلاً {n} 👋\nأهلاً بيك في مصر! معاك Three Pyramids Travel، وإحنا مسئولين عنك من أول ما توصل.\nرحلتك: {f}\nالسواق: {d}\nتابع عربيتك من هنا: {link}',
      'Hello {n} 👋\nWelcome to Egypt! This is Three Pyramids Travel — we will take care of you from the moment you arrive.\nYour flight: {f}\nYour driver: {d}\nFollow your car here: {link}',
      'Hallo {n} 👋\nWillkommen in Ägypten! Hier ist Three Pyramids Travel — ab Ihrer Ankunft kümmern wir uns um Sie.\nIhr Flug: {f}\nIhr Fahrer: {d}\nVerfolgen Sie Ihr Fahrzeug hier: {link}',
      'Bonjour {n} 👋\nBienvenue en Égypte ! Ici Three Pyramids Travel — nous prenons soin de vous dès votre arrivée.\nVotre vol : {f}\nVotre chauffeur : {d}\nSuivez votre voiture ici : {link}',
      'Здравствуйте, {n} 👋\nДобро пожаловать в Египет! Это Three Pyramids Travel — мы позаботимся о вас с момента прилёта.\nВаш рейс: {f}\nВаш водитель: {d}\nСледите за машиной здесь: {link}',
      '{n}，您好 👋\n欢迎来到埃及！我们是 Three Pyramids Travel，从您抵达的那一刻起由我们负责照顾您。\n您的航班：{f}\n您的司机：{d}\n在此查看车辆位置：{link}',
      '{n}님, 안녕하세요 👋\n이집트에 오신 것을 환영합니다! Three Pyramids Travel입니다. 도착하시는 순간부터 저희가 모시겠습니다.\n항공편: {f}\n기사: {d}\n차량 위치 확인: {link}'],
    msgPickup: ['أهلاً {n} 👋\nمعاك Three Pyramids Travel. السواق {d} هيكون عندك {w}.\nتابع عربيتك من هنا: {link}',
      'Hello {n} 👋\nThis is Three Pyramids Travel. Your driver {d} will pick you up {w}.\nFollow your car here: {link}',
      'Hallo {n} 👋\nHier ist Three Pyramids Travel. Ihr Fahrer {d} holt Sie {w} ab.\nVerfolgen Sie Ihr Fahrzeug hier: {link}',
      'Bonjour {n} 👋\nIci Three Pyramids Travel. Votre chauffeur {d} viendra vous chercher {w}.\nSuivez votre voiture ici : {link}',
      'Здравствуйте, {n} 👋\nЭто Three Pyramids Travel. Ваш водитель {d} заберёт вас {w}.\nСледите за машиной здесь: {link}',
      '{n}，您好 👋\n我们是 Three Pyramids Travel。您的司机 {d} 将于 {w} 接您。\n在此查看车辆位置：{link}',
      '{n}님, 안녕하세요 👋\nThree Pyramids Travel입니다. 기사 {d}님이 {w} 모시러 갑니다.\n차량 위치 확인: {link}'],
    msgWaiting: ['السواق {d} مستنيك قدام صالة الوصول{t}، ومعاه لافتة باسمك.', 'Your driver {d} is waiting for you in front of the arrivals hall{t}, holding a sign with your name.', 'Ihr Fahrer {d} wartet vor der Ankunftshalle{t} mit einem Schild mit Ihrem Namen.', "Votre chauffeur {d} vous attend devant le hall des arrivées{t} avec une pancarte à votre nom.", 'Водитель {d} ждёт вас у зала прилёта{t} с табличкой с вашим именем.', '您的司机 {d} 正在到达大厅前{t}等候，手持写有您名字的接机牌。', '기사 {d}님이 도착 홀 앞{t}에서 고객님 성함이 적힌 피켓을 들고 기다리고 있습니다.'],
    msgDelay: ['رحلتك {f} متأخرة — السواق {d} عارف وهيستناك. مش محتاج تعمل حاجة.', 'Your flight {f} is delayed — your driver {d} knows and will wait for you. No need to do anything.', 'Ihr Flug {f} ist verspätet — Ihr Fahrer {d} weiß Bescheid und wartet. Sie müssen nichts tun.', "Votre vol {f} est retardé — votre chauffeur {d} est informé et vous attendra. Rien à faire de votre côté.", 'Ваш рейс {f} задерживается — водитель {d} знает и подождёт. Ничего делать не нужно.', '您的航班 {f} 延误 — 司机 {d} 已知悉并会等候您，您无需做任何事。', '항공편 {f}이(가) 지연되었습니다 — 기사 {d}님이 알고 기다릴 예정이니 따로 하실 일은 없습니다.'],
    termTag: [' (صالة {t})', ' (Terminal {t})', ' (Terminal {t})', ' (Terminal {t})', ' (терминал {t})', '（{t} 号航站楼）', ' ({t} 터미널)']
  };
  const STATUS = {
    Expected: 'ontime', Scheduled: 'ontime', CheckIn: 'checkin', Boarding: 'boarding', GateClosed: 'gate', Departed: 'departed', EnRoute: 'air', Approaching: 'approaching',
    Arrived: 'landed', Landed: 'landed', Delayed: 'delayed', Canceled: 'cancelled', CanceledUncertain: 'maybe', Diverted: 'diverted', Unknown: 'unknown'
  };
  const ST = {
    ontime: ['في ميعادها', 'On time', 'Pünktlich', "À l'heure", 'По расписанию', '准点', '정시'],
    checkin: ['بدأ تسجيل الركاب', 'Check-in open', 'Check-in geöffnet', 'Enregistrement ouvert', 'Идёт регистрация', '正在值机', '체크인 중'],
    boarding: ['الركاب بيطلعوا', 'Boarding', 'Boarding', 'Embarquement', 'Посадка', '正在登机', '탑승 중'],
    gate: ['البوابة اتقفلت', 'Gate closed', 'Gate geschlossen', 'Porte fermée', 'Выход закрыт', '登机口已关闭', '탑승구 마감'],
    departed: ['طارت', 'Departed', 'Abgeflogen', 'Parti', 'Вылетел', '已起飞', '출발함'],
    air: ['في الجو', 'In the air', 'In der Luft', 'En vol', 'В полёте', '飞行中', '비행 중'],
    approaching: ['بتقرّب', 'Approaching', 'Im Anflug', 'En approche', 'Заходит на посадку', '即将到达', '접근 중'],
    landed: ['هبطت', 'Landed', 'Gelandet', 'Atterri', 'Приземлился', '已降落', '착륙함'],
    delayed: ['متأخرة', 'Delayed', 'Verspätet', 'Retardé', 'Задерживается', '延误', '지연'],
    cancelled: ['اتلغت', 'Cancelled', 'Annulliert', 'Annulé', 'Отменён', '已取消', '취소됨'],
    maybe: ['ممكن تكون اتلغت', 'May be cancelled', 'Evtl. annulliert', 'Peut-être annulé', 'Возможно, отменён', '可能取消', '취소 가능성'],
    diverted: ['اتحولت لمطار تاني', 'Diverted', 'Umgeleitet', 'Dérouté', 'Перенаправлен', '已备降', '회항'],
    unknown: ['مش معروف', 'Unknown', 'Unbekannt', 'Inconnu', 'Неизвестно', '未知', '알 수 없음']
  };
  const idx = l => Math.max(0, LANGS.findIndex(x => x.id === l));
  const I = {
    LANGS,
    ok: l => LANGS.some(x => x.id === l),
    info: l => LANGS[idx(l)],
    /** text in a language, with {n}-style values */
    t(l, key, vars) {
      const row = T[key]; if (!row) return key;
      let s = row[idx(l)] || row[0];
      Object.keys(vars || {}).forEach(k => { s = s.split('{' + k + '}').join(String(vars[k] ?? '')); });
      return s;
    },
    flightStatus: (l, s) => { const k = STATUS[s]; return k ? ST[k][idx(l)] : (s || ''); },
    /** time / day in the guest's language, in Cairo time */
    fmtTime(l, v) { const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? '' : new Intl.DateTimeFormat(I.info(l).loc, { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: l !== 'de' && l !== 'fr' && l !== 'ru' }).format(d); },
    fmtDay(l, v) { const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? '' : new Intl.DateTimeFormat(I.info(l).loc, { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long' }).format(d); },
    /** the browser's own language, if it is one of ours */
    guess() { try { const n = String((navigator.languages && navigator.languages[0]) || navigator.language || '').slice(0, 2).toLowerCase(); return I.ok(n) ? n : 'ar'; } catch (e) { return 'ar'; } }
  };
  root.TPI18N = I;
  if (root.TP) root.TP.i18n = I;
})(typeof self !== 'undefined' ? self : globalThis);
