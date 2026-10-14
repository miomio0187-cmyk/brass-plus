/* ==========================================================
   BRASS+ ＋ 拡張機能サーバー
   ========================================================== */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'db.json');
const MOD_PASSCODE = process.env.MOD_PASSCODE || '';
const NG_WORDS = (process.env.NG_WORDS || '死ね,しね,消えろ,キモい').split(',');
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_API_BASE = (process.env.AI_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Passcode');
  res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------- 永続化(JSONファイル / アトミック書き込み) ---------- */
function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('DB read error:', e);
  }
  return { members: [], attendance: [], goalIdeas: [], healthLogs: [], consults: [] };
}

function saveDb(data) {
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

let db = loadDb();

/* ---------- API エンドポイント ---------- */

// 動作確認
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// メンバー管理
app.get('/api/members', (req, res) => {
  res.json(db.members);
});
app.post('/api/members', (req, res) => {
  const { name, part } = req.body;
  if (!name || !part) return res.status(400).json({ error: 'Name and part required' });
  let m = db.members.find(x => x.name === name);
  if (m) {
    m.part = part;
  } else {
    m = { id: crypto.randomUUID(), name, part };
    db.members.push(m);
  }
  saveDb(db);
  res.json(m);
});

// 出席記録
app.get('/api/attendance', (req, res) => {
  const month = req.query.month; // YYYY-MM
  let list = db.attendance;
  if (month) {
    list = list.filter(a => a.date && a.date.startsWith(month));
  }
  res.json(list);
});
app.post('/api/attendance', (req, res) => {
  const { name, date, status } = req.body; // status: present, late, absent, official, ''
  if (!name || !date) return res.status(400).json({ error: 'Name and date required' });
  const idx = db.attendance.findIndex(a => a.name === name && a.date === date);
  if (idx >= 0) {
    if (!status) {
      db.attendance.splice(idx, 1);
    } else {
      db.attendance[idx].status = status;
    }
  } else if (status) {
    db.attendance.push({ id: crypto.randomUUID(), name, date, status });
  }
  saveDb(db);
  res.json({ success: true });
});

// 月一目標
app.get('/api/goal-ideas', (req, res) => {
  res.json({
    ideas: db.goalIdeas,
    finalized: db.finalizedGoal || null
  });
});
app.post('/api/goal-ideas', (req, res) => {
  const { author, text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  const item = {
    id: crypto.randomUUID(),
    author: author || '匿名',
    text: text.trim(),
    votes: [], // 投票した人の名前orIDの配列
    createdAt: new Date().toISOString()
  };
  db.goalIdeas.push(item);
  saveDb(db);
  res.json(item);
});
app.delete('/api/goal-ideas/:id', (req, res) => {
  const id = req.params.id;
  db.goalIdeas = db.goalIdeas.filter(i => i.id !== id);
  saveDb(db);
  res.json({ success: true });
});
app.post('/api/goal-ideas/:id/vote', (req, res) => {
  const id = req.params.id;
  const { userName } = req.body;
  if (!userName) return res.status(400).json({ error: 'userName required' });
  const item = db.goalIdeas.find(i => i.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  
  const vIdx = item.votes.indexOf(userName);
  if (vIdx >= 0) {
    item.votes.splice(vIdx, 1); // 取消
  } else {
    item.votes.push(userName); // 投票
  }
  saveDb(db);
  res.json(item);
});
app.post('/api/goal-ideas/finalize', (req, res) => {
  const { id, month } = req.body; // month: YYYY-MM
  const item = db.goalIdeas.find(i => i.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  db.finalizedGoal = {
    month: month || new Date().toISOString().slice(0, 7),
    text: item.text,
    decidedAt: new Date().toISOString()
  };
  saveDb(db);
  res.json(db.finalizedGoal);
});

// AI/ローカル目標提案
app.post('/api/goal-ideas/ai-suggest', async (req, res) => {
  const { currentMonth } = req.body;
  // ローカル提案の候補リスト
  const samples = [
    "基礎合奏でハーモニーの濁りをゼロにする月間",
    "全音符のブレス位置をパート全員で完全統一する",
    "メトロノームなしでもテンポが揺れないリズム感をつける",
    "コラールで各自の音色がしっかりブレンドするよう聴き合う",
    "ロングトーンの最初から最後まで芯のある音をキープする",
    "フォルテでも音色が割れない豊かな響きを追求する"
  ];
  const suggested = samples[Math.floor(Math.random() * samples.length)];
  res.json({ suggestion: suggested });
});

// 体調管理
app.get('/api/health-logs', (req, res) => {
  const name = req.query.name;
  let list = db.healthLogs;
  if (name) list = list.filter(h => h.name === name);
  res.json(list);
});
app.post('/api/health-logs', (req, res) => {
  const { name, date, condition, sleepHours, lipCondition, breathCondition, comment } = req.body;
  if (!name || !date) return res.status(400).json({ error: 'Name and date required' });
  
  let item = db.healthLogs.find(h => h.name === name && h.date === date);
  if (item) {
    item.condition = condition || item.condition;
    item.sleepHours = sleepHours !== undefined ? sleepHours : item.sleepHours;
    item.lipCondition = lipCondition || item.lipCondition;
    item.breathCondition = breathCondition || item.breathCondition;
    item.comment = comment !== undefined ? comment : item.comment;
  } else {
    item = {
      id: crypto.randomUUID(),
      name, date,
      condition: condition || '😊',
      sleepHours: sleepHours || 7,
      lipCondition: lipCondition || '✨',
      breathCondition: breathCondition || '👍',
      comment: comment || ''
    };
    db.healthLogs.push(item);
  }
  saveDb(db);
  res.json(item);
});
app.get('/api/health-alerts', (req, res) => {
  // 簡単なアラート判定: 直近数日で連続不調などを抽出
  const alerts = [];
  const members = [...new Set(db.healthLogs.map(h => h.name))];
  members.forEach(name => {
    const logs = db.healthLogs.filter(h => h.name === name).sort((a,b) => b.date.localeCompare(a.date));
    if (logs.length >= 2) {
      if (logs[0].condition === '😢' && logs[1].condition === '😢') {
        alerts.push({ name, type: 'condition', message: '2日連続で体調不良が記録されています。無理せず休養を取りましょう。' });
      }
    }
    if (logs.length > 0 && logs[0].sleepHours < 5) {
      alerts.push({ name, type: 'sleep', message: '睡眠時間が5時間未満です。コンディションに注意してください。' });
    }
  });
  res.json(alerts);
});

// お悩み相談室
app.get('/api/consults', (req, res) => {
  res.json(db.consults || []);
});
app.post('/api/consults', (req, res) => {
  const { title, body, category, author, passcode } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body required' });
  
  // NGワードチェック
  const fullText = title + ' ' + body;
  const hasNg = NG_WORDS.some(ng => ng && fullText.includes(ng.trim()));
  if (hasNg) {
    return res.status(400).json({ error: '不適切な表現が含まれているため投稿できません。' });
  }

  const item = {
    id: crypto.randomUUID(),
    title: title.trim(),
    body: body.trim(),
    category: category || '練習・演奏',
    author: author ? author.trim() : '匿名',
    passcodeHash: passcode ? crypto.createHash('sha256').update(passcode).digest('hex') : null,
    replies: [],
    flags: 0,
    hidden: false,
    createdAt: new Date().toISOString()
  };
  if (!db.consults) db.consults = [];
  db.consults.push(item);
  saveDb(db);
  res.json(item);
});
app.delete('/api/consults/:id', (req, res) => {
  const id = req.params.id;
  const passcode = req.headers['x-passcode'] || req.body.passcode;
  const item = db.consults.find(c => c.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  if (MOD_PASSCODE && passcode === MOD_PASSCODE) {
    // 管理者パスコード一致
    db.consults = db.consults.filter(c => c.id !== id);
    saveDb(db);
    return res.json({ success: true });
  }
  if (item.passcodeHash && passcode) {
    const hash = crypto.createHash('sha256').update(passcode).digest('hex');
    if (hash === item.passcodeHash) {
      db.consults = db.consults.filter(c => c.id !== id);
      saveDb(db);
      return res.json({ success: true });
    }
  }
  return res.status(403).json({ error: 'パスコードが違うか、削除権限がありません。' });
});
app.post('/api/consults/:id/reply', (req, res) => {
  const id = req.params.id;
  const { body, author } = req.body;
  if (!body) return res.status(400).json({ error: 'Body required' });
  
  const item = db.consults.find(c => c.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const reply = {
    id: crypto.randomUUID(),
    author: author ? author.trim() : '匿名',
    body: body.trim(),
    createdAt: new Date().toISOString()
  };
  item.replies.push(reply);
  saveDb(db);
  res.json(item);
});
app.post('/api/consults/:id/flag', (req, res) => {
  const id = req.params.id;
  const item = db.consults.find(c => c.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  item.flags = (item.flags || 0) + 1;
  if (item.flags >= 2) {
    item.hidden = true; // 2回通報で自動非表示
  }
  saveDb(db);
  res.json({ success: true, flags: item.flags, hidden: item.hidden });
});

/* ==========================================================
   ★ここが重要：静的ファイル配信 ＆ すべてのアクセスを index.html に向ける設定
   ========================================================== */
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
