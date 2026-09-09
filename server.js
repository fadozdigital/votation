const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Ventisetteventi6';
const RESULTS_PASSWORD = process.env.RESULTS_PASSWORD || 'Risultati2026';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_NAME = process.env.SUPABASE_TABLE_NAME || 'app_state';
const ROW_ID = 'main';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERRORE: le variabili d\'ambiente SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono obbligatorie.');
  console.error('Senza un database esterno i dati non verrebbero salvati in modo permanente.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Stato in memoria: è la copia di lavoro che i request handler leggono e
// modificano in modo sincrono. Viene ricaricata da Supabase all'avvio e
// salvata su Supabase dopo ogni modifica.
let db = { config: { n: 3, x: 2, y: 2 }, people: [], votes: [], tokens: [] };

// Coda di salvataggio: garantisce che le scritture su Supabase avvengano
// sempre nello stesso ordine in cui sono state generate le modifiche in
// memoria, anche se più richieste arrivano in contemporanea. Senza questa
// coda, una scrittura più lenta potrebbe sovrascrivere per errore una
// scrittura più recente arrivata dopo ma completata prima.
let saveQueue = Promise.resolve();

function saveData() {
  const snapshot = JSON.parse(JSON.stringify(db));
  saveQueue = saveQueue.then(async () => {
    const { error } = await supabase
      .from(TABLE_NAME)
      .upsert({ id: ROW_ID, data: snapshot }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  });
  return saveQueue;
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

app.post('/api/config', checkAdmin, async (req, res) => {
  const n = Number(req.body.n);
  const x = Number(req.body.x);
  const y = Number(req.body.y);
  if (!Number.isFinite(n) || !Number.isFinite(x) || !Number.isFinite(y) || n < 0 || x < 0 || y < 0) {
    return res.status(400).json({ error: 'Valori non validi.' });
  }
  const before = db.config;
  db.config = { n, x, y };
  try {
    await saveData();
    res.json(db.config);
  } catch (e) {
    db.config = before;
    res.status(500).json({ error: 'Errore nel salvataggio sul database: ' + e.message });
  }
});

app.get('/api/people', (req, res) => {
  res.json(db.people);
});

app.post('/api/people', checkAdmin, async (req, res) => {
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
  try {
    await saveData();
    res.json(person);
  } catch (e) {
    db.people = db.people.filter(p => p.id !== person.id);
    res.status(500).json({ error: 'Errore nel salvataggio sul database: ' + e.message });
  }
});

app.delete('/api/people/:id', checkAdmin, async (req, res) => {
  const before = db.people.length;
  const removed = db.people.find(p => p.id === req.params.id);
  db.people = db.people.filter(p => p.id !== req.params.id);
  if (db.people.length === before) {
    return res.status(404).json({ error: 'Persona non trovata.' });
  }
  try {
    await saveData();
    res.json({ ok: true });
  } catch (e) {
    if (removed) db.people.push(removed);
    res.status(500).json({ error: 'Errore nel salvataggio sul database: ' + e.message });
  }
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

app.post('/api/tokens/generate', checkAdmin, async (req, res) => {
  const count = parseInt(req.body.count, 10);
  if (!Number.isFinite(count) || count <= 0) {
    return res.status(400).json({ error: 'Quantità non valida.' });
  }
  const availableBefore = 10000 - db.tokens.length;
  const generated = generateTokens(count);
  try {
    await saveData();
    res.json({
      generated,
      total: db.tokens.length,
      truncated: count > availableBefore
    });
  } catch (e) {
    db.tokens = db.tokens.filter(t => !generated.includes(t));
    res.status(500).json({ error: 'Errore nel salvataggio sul database: ' + e.message });
  }
});

app.delete('/api/tokens/:token', checkAdmin, async (req, res) => {
  const before = db.tokens.length;
  const removed = db.tokens.find(t => t.token === req.params.token);
  db.tokens = db.tokens.filter(t => t.token !== req.params.token);
  if (db.tokens.length === before) {
    return res.status(404).json({ error: 'Token non trovato.' });
  }
  try {
    await saveData();
    res.json({ ok: true });
  } catch (e) {
    if (removed) db.tokens.push(removed);
    res.status(500).json({ error: 'Errore nel salvataggio sul database: ' + e.message });
  }
});

app.post('/api/tokens/reset', checkAdmin, async (req, res) => {
  const backup = db.tokens;
  db.tokens = [];
  try {
    await saveData();
    res.json({ ok: true });
  } catch (e) {
    db.tokens = backup;
    res.status(500).json({ error: 'Errore nel salvataggio sul database: ' + e.message });
  }
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

app.post('/api/votes', async (req, res) => {
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
  try {
    await saveData();
    res.json(vote);
  } catch (e) {
    tokenEntry.used = false;
    tokenEntry.usedAt = null;
    db.votes = db.votes.filter(v => v.id !== vote.id);
    res.status(500).json({ error: 'Errore nel salvataggio sul database: ' + e.message });
  }
});

app.post('/api/votes/reset', checkAdmin, async (req, res) => {
  const backup = db.votes;
  db.votes = [];
  try {
    await saveData();
    res.json({ ok: true });
  } catch (e) {
    db.votes = backup;
    res.status(500).json({ error: 'Errore nel salvataggio sul database: ' + e.message });
  }
});

async function start() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('data')
    .eq('id', ROW_ID)
    .maybeSingle();

  if (error) {
    console.error('Impossibile leggere i dati da Supabase:', error.message);
    console.error('Verifica di aver creato la tabella "' + TABLE_NAME + '" (vedi README) e che la chiave sia corretta.');
    process.exit(1);
  }

  if (data && data.data) {
    db = {
      config: data.data.config || { n: 3, x: 2, y: 2 },
      people: data.data.people || [],
      votes: data.data.votes || [],
      tokens: data.data.tokens || []
    };
    console.log('Dati caricati da Supabase: ' + db.people.length + ' persone, ' + db.votes.length + ' voti, ' + db.tokens.length + ' token.');
  } else {
    const { error: insertError } = await supabase
      .from(TABLE_NAME)
      .insert({ id: ROW_ID, data: db });
    if (insertError) {
      console.error('Impossibile creare la riga iniziale su Supabase:', insertError.message);
      process.exit(1);
    }
    console.log('Nessun dato precedente trovato: creata una nuova riga su Supabase.');
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('Server avviato sulla porta ' + PORT);
  });
}

start().catch(err => {
  console.error('Impossibile avviare il server (connessione a Supabase fallita):', err.message);
  process.exit(1);
});
