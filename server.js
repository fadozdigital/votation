const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Ventisetteventi6';

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { config: { n: 3, x: 2, y: 2 }, people: [], votes: [] };
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

app.post('/api/admin/check', checkAdmin, (req, res) => {
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

app.get('/api/votes', (req, res) => {
  res.json(db.votes);
});

app.post('/api/votes', (req, res) => {
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
