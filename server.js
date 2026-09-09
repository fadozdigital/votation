const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Ventisetteventi6';
const RESULTS_PASSWORD = process.env.RESULTS_PASSWORD || 'Risultati2026';

function loadData() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(data.tokens)) data.tokens = [];
    return data;
  } catch (e) {
    return { config: { n: 3, x: 2, y: 2 }, people: [], votes: [], tokens: [] };
  }
}

let db = loadData();

function saveData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
}

function newId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function checkAdmin(req, res, next) {
  const pass = req.header('x-admin-password');
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Password amministratore non valida.' });
  }
  next();
}

function checkResults(req, res, next) {
  const passR = req.header('x-results-password');
  const passA = req.header('x-admin-password');
  if (passR === RESULTS_PASSWORD || passA === ADMIN_PASSWORD) {
    return next();
  }
  return res.status(401).json({ error: 'Password risultati non valida.' });
}

app.post('/api/admin/check', checkAdmin, (req, res) => {
  res.json({ ok: true });
});

app.post('/api/results/check', checkResults, (req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  res.json(db.config);
});

app.post('/api/config', checkAdmin, (req, res) => {
  const n = Number(req.body.n);
  const x = Number(req.body.x);
  const y = Number(req.body.y);
  if (!Number.isFinite(n) || !Number.isFinite(x) || !Number.isFinite(y) || n < 0 || x < 0 || y < 0) {
    return res.status(400).json({ error: 'Valori non validi.' });
  }
  db.config = { n, x, y };
  saveData();
  res.json(db.config);
});

app.get('/api/people', (req, res) => {
  res.json(db.people);
});

app.post('/api/people', checkAdmin, (req, res) => {
  const { nome, cognome, sesso, descrizione, foto } = req.body;
  if (!nome || !nome.trim() || !cognome || !cognome.trim()) {
    return res.status(400).json({ error: 'Nome e cognome sono obbligatori.' });
  }
  const person = {
    id: newId(),
    nome: String(nome).trim(),
    cognome: String(cognome).trim(),
    sesso: sesso === 'F' ? 'F' : 'M',
    descrizione: descrizione ? String(descrizione).trim() : '',
    foto: foto ? String(foto) : ''
  };
  db.people.push(person);
  saveData();
  res.json(person);
});

app.delete('/api/people/:id', checkAdmin, (req, res) => {
  const before = db.people.length;
  db.people = db.people.filter(p => p.id !== req.params.id);
  if (db.people.length === before) {
    return res.status(404).json({ error: 'Persona non trovata.' });
  }
  saveData();
  res.json({ ok: true });
});

// ---------- TOKEN ----------

function generateTokens(count) {
  const existing = new Set(db.tokens.map(t => t.token));
  const maxPossible = 10000; // combinazioni a 4 cifre: 0000-9999
  const toGenerate = Math.max(0, Math.min(count, maxPossible - existing.size));
  const generated = [];
  while (generated.length < toGenerate) {
    const t = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!existing.has(t)) {
      existing.add(t);
      const tokenObj = { token: t, used: false, usedAt: null };
      db.tokens.push(tokenObj);
      generated.push(tokenObj);
    }
  }
  return generated;
}

app.get('/api/tokens', checkAdmin, (req, res) => {
  res.json(db.tokens);
});

app.post('/api/tokens/generate', checkAdmin, (req, res) => {
  const count = parseInt(req.body.count, 10);
  if (!Number.isFinite(count) || count <= 0) {
    return res.status(400).json({ error: 'Quantità non valida.' });
  }
  const availableBefore = 10000 - db.tokens.length;
  const generated = generateTokens(count);
  saveData();
  res.json({
    generated,
    total: db.tokens.length,
    truncated: count > availableBefore
  });
});

app.delete('/api/tokens/:token', checkAdmin, (req, res) => {
  const before = db.tokens.length;
  db.tokens = db.tokens.filter(t => t.token !== req.params.token);
  if (db.tokens.length === before) {
    return res.status(404).json({ error: 'Token non trovato.' });
  }
  saveData();
  res.json({ ok: true });
});

app.post('/api/tokens/reset', checkAdmin, (req, res) => {
  db.tokens = [];
  saveData();
  res.json({ ok: true });
});

app.post('/api/tokens/validate', (req, res) => {
  const token = String(req.body.token || '').trim();
  const entry = db.tokens.find(t => t.token === token);
  if (!entry) {
    return res.status(400).json({ valid: false, error: 'Codice non valido.' });
  }
  if (entry.used) {
    return res.status(400).json({ valid: false, error: 'Codice già utilizzato.' });
  }
  res.json({ valid: true });
});

// ---------- VOTI ----------

app.get('/api/votes', checkResults, (req, res) => {
  res.json(db.votes);
});

app.post('/api/votes', (req, res) => {
  const token = String(req.body.token || '').trim();
  const tokenEntry = db.tokens.find(t => t.token === token);
  if (!tokenEntry) {
    return res.status(400).json({ error: 'Codice non valido.' });
  }
  if (tokenEntry.used) {
    return res.status(400).json({ error: 'Questo codice è già stato utilizzato per votare.' });
  }

  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) {
    return res.status(400).json({ error: 'Nessuna selezione inviata.' });
  }
  const cfg = db.config;
  const validIds = new Set(db.people.map(p => p.id));
  const uniqueIds = [...new Set(ids)].filter(id => validIds.has(id));
  if (!uniqueIds.length) {
    return res.status(400).json({ error: 'Selezione non valida.' });
  }
  const chosen = db.people.filter(p => uniqueIds.includes(p.id));
  const countM = chosen.filter(p => p.sesso === 'M').length;
  const countF = chosen.filter(p => p.sesso === 'F').length;
  if (chosen.length > cfg.n || countM > cfg.x || countF > cfg.y) {
    return res.status(400).json({ error: 'La selezione supera i limiti consentiti.' });
  }

  tokenEntry.used = true;
  tokenEntry.usedAt = Date.now();
  const vote = { id: newId(), ts: Date.now(), ids: uniqueIds };
  db.votes.push(vote);
  saveData();
  res.json(vote);
});

app.post('/api/votes/reset', checkAdmin, (req, res) => {
  db.votes = [];
  saveData();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server avviato sulla porta ' + PORT);
});
