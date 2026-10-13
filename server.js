/* ============================================================
   BRASS+ ✚ 拡張機能サーバー
   出席率の可視化 / 月一目標(案募集・投票・決定・AI提案) /
   体調管理(記録・アラート) / お悩み相談室(匿名・通報・管理)
   ------------------------------------------------------------
   構成: Express + JSONファイル保存(db.json)。追加依存は express のみ。
   AI提案: 環境変数 AI_API_KEY が無い場合はローカル提案に自動フォールバック。
   ============================================================ */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'db.json');
const MOD_PASSCODE = process.env.MOD_PASSCODE || '';
const NG_WORDS = (process.env.NG_WORDS || '死ね,しね,消えろ,キモい').split(',').map(s => s.trim()).filter(Boolean);
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_API_BASE = (process.env.AI_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------- 永続化(JSONファイル / アトミック書き込み) ---------- */
let db = null;
function defaultDB() {
  return { members: [], attendance: [], goalIdeas: [], finalizedGoals: [], healthLogs: [], consults: [] };
}
function loadDB() {
  try { db = Object.assign(defaultDB(), JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))); }
  catch (e) { db = defaultDB(); }
}
function saveDB() {
  try {
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_PATH);
  } catch (e) { console.error('saveDB failed:', e.message); }
}
loadDB();

const genId = () => crypto.randomUUID();
const todayJST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
const hasNG = (t) => !!t && NG_WORDS.some(w => String(t).includes(w));
const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));

/* ---------- API ---------- */
const api = express.Router();

api.get('/health', (req, res) => res.json({ ok: true, name: 'brass-plus-ext', today: todayJST() }));

/* --- メンバー(名前とパート) --- */
api.get('/members', (req, res) => res.json(db.members));
api.post('/members', (req, res) => {
  const { name, part } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  if (hasNG(name)) return res.status(400).json({ error: '不適切な表現が含まれています' });
  const m = { id: genId(), name: String(name).trim().slice(0, 30), part: String(part || 'その他').slice(0, 20), createdAt: Date.now() };
  db.members.push(m); saveDB(); res.json(m);
});
api.delete('/members/:id', (req, res) => {
  const i = db.members.findIndex(m => m.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  db.members.splice(i, 1);
  db.attendance = db.attendance.filter(a => a.memberId !== req.params.id);
  saveDB(); res.json({ ok: true });
});

/* --- 出席(日付×メンバーで上書き保存) ---
   status: present=出席 / late=遅刻 / absent=欠席 / excused=公欠(休) */
api.get('/attendance', (req, res) => {
  let list = db.attendance;
  if (req.query.month) list = list.filter(a => String(a.date || '').startsWith(String(req.query.month)));
  res.json(list);
});
api.post('/attendance', (req, res) => {
  const { date, memberId, status } = req.body || {};
  if (!date || !memberId || !['present', 'late', 'absent', 'excused'].includes(status))
    return res.status(400).json({ error: 'date, memberId, status(present|late|absent|excused) required' });
  let rec = db.attendance.find(a => a.date === date && a.memberId === memberId);
  if (rec) { rec.status = status; rec.updatedAt = Date.now(); }
  else { rec = { id: genId(), date, memberId, status, createdAt: Date.now() }; db.attendance.push(rec); }
  saveDB(); res.json(rec);
});

/* --- 月一目標(案の募集 → 投票 → 決定) --- */
api.get('/goal-ideas', (req, res) => res.json({ ideas: db.goalIdeas, finalized: db.finalizedGoals }));
api.post('/goal-ideas', (req, res) => {
  const { title, detail, category, author, anonymous, clientId } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title required' });
  if (hasNG(title) || hasNG(detail)) return res.status(400).json({ error: '不適切な表現が含まれています' });
  const idea = {
    id: genId(), title: String(title).trim().slice(0, 80), detail: String(detail || '').slice(0, 500),
    category: String(category || 'その他'),
    author: anonymous ? '匿名' : String(author || '匿名').slice(0, 30),
    anonymous: !!anonymous, clientId: String(clientId || ''), votes: [],
    month: todayJST().slice(0, 7), status: 'open', createdAt: Date.now()
  };
  db.goalIdeas.push(idea); saveDB(); res.json(idea);
});
api.post('/goal-ideas/:id/vote', (req, res) => {
  const idea = db.goalIdeas.find(i => i.id === req.params.id);
  if (!idea) return res.status(404).json({ error: 'not found' });
  const cid = String((req.body || {}).clientId || '');
  if (!cid) return res.status(400).json({ error: 'clientId required' });
  const idx = idea.votes.indexOf(cid);
  if (idx >= 0) idea.votes.splice(idx, 1); else idea.votes.push(cid);
  saveDB(); res.json(idea);
});
api.post('/goal-ideas/finalize', (req, res) => {
  const { ideaId } = req.body || {};
  const idea = db.goalIdeas.find(i => i.id === ideaId);
  if (!idea) return res.status(404).json({ error: 'idea not found' });
  const month = idea.month || todayJST().slice(0, 7);
  db.finalizedGoals = db.finalizedGoals.filter(g => g.month !== month); // 1ヶ月1目標
  const g = { id: genId(), month, ideaId: idea.id, title: idea.title, detail: idea.detail, decidedAt: Date.now() };
  db.finalizedGoals.push(g); idea.status = 'finalized';
  saveDB(); res.json(g);
});
api.delete('/goal-ideas/:id', (req, res) => {
  const idea = db.goalIdeas.find(x => x.id === req.params.id);
  if (!idea) return res.status(404).json({ error: 'not found' });
  if (idea.clientId && idea.clientId !== req.query.clientId) return res.status(403).json({ error: '本人の投稿のみ削除できます' });
  db.goalIdeas = db.goalIdeas.filter(x => x.id !== req.params.id);
  saveDB(); res.json({ ok: true });
});

/* --- AI提案(環境変数 AI_API_KEY があればAI、無ければローカル提案) --- */
function localSuggestions(ctx) {
  const parts = (ctx && ctx.partRates) || [];
  const weakest = parts.slice().sort((a, b) => a.rate - b.rate)[0];
  const avg = parts.length ? Math.round(parts.reduce((s, p) => s + p.rate, 0) / parts.length) : 0;
  const last = ctx && ctx.lastGoal;
  const bank = [];
  if (weakest) bank.push({ title: weakest.part + 'の出席率アップ', detail: weakest.part + 'の出席率を今月より+10%上げる(現在' + weakest.rate + '%)。欠けたときの代わりの練習メニューも用意しておく' });
  bank.push({ title: '全パート平均出席率を+5%', detail: '現在の平均' + avg + '%から' + Math.min(100, avg + 5) + '%を目指す。欠席しそうな日は事前に「代わりにできる自主練」を決めておく' });
  bank.push({ title: 'チューニングタイム固定化', detail: '合奏の前に必ず5分のチューニング時間を入れ、音程のずれを減らす' });
  bank.push({ title: '録音を聞き返す会', detail: '月2回、合奏を録音して「良かった点/直す点」をパートごとに1つずつ共有する' });
  bank.push({ title: '一足先輩レッスン会', detail: '上手だと思う人の演奏を月1回みんなで聴き、ポイントを1つ真似してみる' });
  bank.push({ title: '出席ペアをつくる', detail: '休みがちな人と「一緒に行こう」ペアを組み、無理なく練習に来られる雰囲気をつくる' });
  if (last) bank.push({ title: '先月の目標を仕上げる', detail: '先月の「' + last + '」を受け、今月はその仕上げとして成果をみんなで確認する' });
  const used = new Set(); const pick = [];
  while (pick.length < 3 && used.size < bank.length) {
    const i = Math.floor(Math.random() * bank.length);
    if (!used.has(i)) { used.add(i); pick.push(bank[i]); }
  }
  return pick;
}
api.post('/goal-ideas/ai-suggest', async (req, res) => {
  const ctx = req.body || {};
  if (AI_API_KEY) {
    try {
      const r = await fetch(AI_API_BASE + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI_API_KEY },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { role: 'system', content: 'あなたは吹奏楽部の運営アドバイザーです。月の目標の案を3つ、必ずJSON配列 [{"title":"短いタイトル","detail":"具体策"}] のみで返します。日本語・部員が実行可能・出席率や団結・技術が上がる具体案。' },
            { role: 'user', content: JSON.stringify(ctx).slice(0, 2000) }
          ],
          temperature: 0.8
        })
      });
      const data = await r.json();
      const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      const m = text.match(/\[[\s\S]*\]/);
      if (m) {
        const arr = JSON.parse(m[0]);
        if (Array.isArray(arr) && arr.length) return res.json({ source: 'ai', suggestions: arr.slice(0, 3) });
      }
    } catch (e) { console.error('AI suggest failed:', e.message); }
  }
  res.json({ source: 'local', suggestions: localSuggestions(ctx) });
});

/* --- 体調管理(記録 + ルールベースのアラート) ---
   condition / lips: 1(悪い)〜5(良い)、sleep: 時間
   ※ 医療アドバイスではありません。体調が悪いときは保護者・指導者・医療機関へ。 */
api.get('/health-logs', (req, res) => {
  let list = db.healthLogs;
  if (req.query.name) list = list.filter(l => l.name === req.query.name);
  res.json(list.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60));
});
api.post('/health-logs', (req, res) => {
  const { name, date, condition, sleep, lips, note } = req.body || {};
  const n = String(name || '').trim();
  if (!n) return res.status(400).json({ error: 'name required' });
  const d = date || todayJST();
  let rec = db.healthLogs.find(l => l.name === n && l.date === d);
  const payload = { condition: clamp(condition, 1, 5), sleep: clamp(sleep, 0, 24), lips: clamp(lips, 1, 5), note: String(note || '').slice(0, 300), updatedAt: Date.now() };
  if (rec) Object.assign(rec, payload);
  else db.healthLogs.push(Object.assign({ id: genId(), name: n.slice(0, 30), date: d, createdAt: Date.now() }, payload));
  saveDB(); res.json({ ok: true });
});
api.get('/health-alerts', (req, res) => {
  const name = req.query.name || '';
  const logs = db.healthLogs.filter(l => !name || l.name === name).sort((a, b) => a.date.localeCompare(b.date));
  const alerts = [];
  const last7 = logs.slice(-7);
  if (last7.length >= 2) {
    const tail = last7.slice(-2);
    if (tail.every(l => l.condition <= 2)) alerts.push({ level: 'high', text: '体調が2日続けて不良です。今日は無理せず休養を優先しましょう。長引くときは保護者や医師に相談を。(医療アドバイスではありません)' });
  }
  const bad = last7.filter(l => l.condition <= 2);
  if (bad.length >= 3) alerts.push({ level: 'mid', text: 'この1週間で体調不良が' + bad.length + '日あります。練習量を調整して回復を優先しましょう。' });
  const shortSleep = last7.filter(l => l.sleep > 0 && l.sleep < 5.5);
  if (shortSleep.length >= 2) alerts.push({ level: 'mid', text: '睡眠が短い日が続いています(5.5時間未満が' + shortSleep.length + '日)。まずは睡眠時間の確保から。' });
  const lip = last7.filter(l => l.lips <= 2);
  if (lip.length >= 2) alerts.push({ level: 'mid', text: '唇・息の調子が続いて不良です。楽器の練習は控えめにし、水分・休憩・リップケアで回復を。' });
  if (last7.length && !alerts.length) alerts.push({ level: 'ok', text: 'この1週間、大きな問題は見られません。この調子で!' });
  res.json(alerts);
});

/* --- お悩み相談室(匿名可 / 通報2回で非表示 / 削除は本人または管理パスコード) --- */
function publicConsult(c) {
  return Object.assign({}, c, { body: c.hidden ? '(この投稿は通報により非表示になりました)' : c.body });
}
api.get('/consults', (req, res) => res.json(db.consults.filter(c => !c.hidden).map(publicConsult).sort((a, b) => b.createdAt - a.createdAt)));
api.post('/consults', (req, res) => {
  const { title, body, tag, author, anonymous, clientId } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });
  if (hasNG(title) || hasNG(body)) return res.status(400).json({ error: '不適切な表現が含まれています' });
  const c = {
    id: genId(), title: String(title).slice(0, 80), body: String(body).slice(0, 2000),
    tag: String(tag || 'その他'),
    author: anonymous ? '匿名' : String(author || '匿名').slice(0, 30),
    anonymous: !!anonymous, clientId: String(clientId || ''), replies: [], flags: 0, hidden: false, createdAt: Date.now()
  };
  db.consults.push(c); saveDB(); res.json(publicConsult(c));
});
api.post('/consults/:id/reply', (req, res) => {
  const c = db.consults.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  const { body, author, anonymous } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body required' });
  if (hasNG(body)) return res.status(400).json({ error: '不適切な表現が含まれています' });
  c.replies.push({ id: genId(), name: anonymous ? '匿名' : String(author || '匿名').slice(0, 30), body: String(body).slice(0, 1000), createdAt: Date.now() });
  saveDB(); res.json(publicConsult(c));
});
api.post('/consults/:id/flag', (req, res) => {
  const c = db.consults.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  c.flags = (c.flags || 0) + 1;
  if (c.flags >= 2) c.hidden = true;
  saveDB(); res.json({ flags: c.flags, hidden: !!c.hidden });
});
api.delete('/consults/:id', (req, res) => {
  const i = db.consults.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  const own = db.consults[i].clientId && db.consults[i].clientId === req.query.clientId;
  const mod = MOD_PASSCODE && req.query.passcode === MOD_PASSCODE;
  if (!own && !mod) return res.status(403).json({ error: '削除には投稿者本人か管理パスコードが必要です' });
  db.consults.splice(i, 1); saveDB(); res.json({ ok: true });
});

app.use('/api', api);
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log('BRASS+ ext server listening on :' + PORT));
