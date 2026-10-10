// Publishes backend/firestore.rules to Firebase (same as Firestore → Rules → Publish).
// Runs on GitHub Actions. The service-account key comes from the FIREBASE_SA secret and is never printed.
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const PROJECT = 'three-pyramids-d8ce7';
const RULES_FILE = new URL('./firestore.rules', import.meta.url);
const API = 'https://firebaserules.googleapis.com/v1/projects/' + PROJECT;

const sa = JSON.parse(process.env.FIREBASE_SA || '{}');
if (!sa.client_email || !sa.private_key) { console.log('FIREBASE_SA is not set — skipping'); process.exit(0); }
if (sa.project_id && sa.project_id !== PROJECT) { console.error('The key belongs to ' + sa.project_id + ', not ' + PROJECT); process.exit(1); }

const b64 = s => Buffer.from(s).toString('base64url');
async function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 600 }));
  const sig = createSign('RSA-SHA256').update(head + '.' + body).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + body + '.' + sig });
  if (!r.ok) throw new Error('Google refused the key: ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return (await r.json()).access_token;
}

const t = await token();
const call = async (method, path, data) => {
  const r = await fetch(API + path, { method, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(method + ' ' + path + ' → ' + r.status + ' ' + text.slice(0, 1500));
  return text ? JSON.parse(text) : {};
};

const source = readFileSync(RULES_FILE, 'utf8');

// Already live? then nothing to do.
try {
  const rel = await call('GET', '/releases/cloud.firestore');
  const cur = await call('GET', '/' + rel.rulesetName.split('/').slice(2).join('/'));
  const live = ((cur.source && cur.source.files) || []).map(f => f.content).join('');
  if (live.trim() === source.trim()) { console.log('Rules already live — nothing to publish'); process.exit(0); }
} catch (e) { console.log('Could not read the live rules (' + e.message.slice(0, 120) + ') — publishing anyway'); }

// Firebase checks the rules here; a mistake stops the deploy and the live rules stay as they are.
const rs = await call('POST', '/rulesets', { source: { files: [{ name: 'firestore.rules', content: source }] } });
console.log('Rules compiled: ' + rs.name);
await call('PATCH', '/releases/cloud.firestore', { release: { name: 'projects/' + PROJECT + '/releases/cloud.firestore', rulesetName: rs.name } });
console.log('Rules published ✓');
