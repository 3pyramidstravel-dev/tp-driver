// The alarm that watches the alarm (agreed 26 Oct). Runs on GitHub Actions every 20 minutes — free, nothing to subscribe to.
// The cloud alarm (tp-alarm) writes system/beat every 10 minutes when it runs to the end. If the beat is older than
// 25 minutes, this rings the top managers (everyone with all the permissions) on their loud ntfy ring, again every
// 3 hours while it stays down, and once more when it is back. The key comes from the FIREBASE_SA secret and is never printed.
import { createSign } from 'node:crypto';

const PROJECT = 'three-pyramids-d8ce7';
const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/`;
const ALARM = 'https://tp-alarm.3pyramidstravel.workers.dev/';
const STALE_MIN = 25, AGAIN_MIN = 180;

const sa = JSON.parse(process.env.FIREBASE_SA || '{}');
if (!sa.client_email || !sa.private_key) { console.log('FIREBASE_SA is not set — skipping'); process.exit(0); }

const b64 = s => Buffer.from(s).toString('base64url');
async function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 600 }));
  const sig = createSign('RSA-SHA256').update(head + '.' + body).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + body + '.' + sig });
  if (!r.ok) throw new Error('Google refused the key: ' + r.status);
  return (await r.json()).access_token;
}
const t = await token();
const H = { authorization: 'Bearer ' + t, 'content-type': 'application/json' };
const val = v => !v ? undefined : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue : 'arrayValue' in v ? (v.arrayValue.values || []).map(val) : 'nullValue' in v ? null : undefined;
const doc = d => { const o = {}; Object.entries((d && d.fields) || {}).forEach(([k, v]) => { o[k] = val(v); }); return o; };
async function get(path) { const r = await fetch(DB + path, { headers: H }); if (r.status === 404) return null; if (!r.ok) throw new Error('get ' + path + ' ' + r.status); return doc(await r.json()); }
async function patch(path, fields) {
  const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&');
  const enc = {}; Object.entries(fields).forEach(([k, v]) => { enc[k] = v === null ? { nullValue: null } : { integerValue: String(v) }; });
  const r = await fetch(DB + path + '?' + mask, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: enc }) });
  if (!r.ok) throw new Error('patch ' + path + ' ' + r.status);
}
/** the loud-ring topics of everyone with all the permissions (an active management device) */
async function topics() {
  const pids = new Set();
  let page = '';
  for (let i = 0; i < 10; i++) {
    const r = await fetch(DB + 'devices?pageSize=300' + (page ? '&pageToken=' + page : ''), { headers: H });
    if (!r.ok) throw new Error('devices ' + r.status);
    const j = await r.json();
    (j.documents || []).map(doc).forEach(d => { if (d.active === true && d.kind === 'staff' && (d.perms || []).includes('all') && d.personId) pids.add(d.personId); });
    if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  const out = [];
  for (const pid of pids) { const n = await get('ntfy/' + pid).catch(() => null); if (n && n.topic) out.push(n.topic); }
  return out;
}
async function ring(title, message, priority) {
  const list = await topics();
  for (const topic of list) await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic, title, message, priority, tags: [priority === 5 ? 'rotating_light' : 'white_check_mark'] }) }).catch(() => {});
  return list.length;
}

const now = Date.now();
const beat = (await get('system/beat')) || {};
const age = beat.at ? Math.round((now - beat.at) / 60000) : null;
const answers = await fetch(ALARM).then(r => r.ok, () => false);
console.log(JSON.stringify({ ageMin: age, answers, alertedAt: beat.alertedAt || null }));

if (age === null) console.log('no beat yet — the cloud alarm writes it every 10 minutes after its update');
else if (age > STALE_MIN) {
  if (!beat.alertedAt || now - beat.alertedAt > AGAIN_MIN * 60000) {
    const n = await ring('🚨 المنبه السحابي واقف', `آخر مرة اشتغل من ${age} دقيقة${answers ? '' : ' — ومش بيرد خالص'}. الصحيان والتنبيهات والرنة العالية مش شغالين لحد ما يرجع. افتح Cloudflare (Workers → tp-alarm → Logs) أو بلّغ المسؤول الفني.`, 5);
    await patch('system/beat', { alertedAt: now });
    console.log('rang ' + n);
  }
} else if (beat.alertedAt) {
  const n = await ring('✅ المنبه السحابي رجع يشتغل', 'الصحيان والتنبيهات شغالين تاني.', 4);
  await patch('system/beat', { alertedAt: null });
  console.log('back — told ' + n);
}
