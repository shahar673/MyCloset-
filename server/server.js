try { require('dotenv').config(); } catch (e) { /* dotenv is optional in production */ }

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

const { readDb, writeDb, findUserByEmail, findUserById } = require('./db');
const { signToken, authMiddleware } = require('./auth');

const app = express();
app.use(express.json({ limit: '15mb' })); // base64 images need a generous body limit
app.use(express.static(path.join(__dirname, '..', 'public')));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLOSET_CATEGORIES = ['חולצה', 'מכנסיים', 'שמלה', 'נעליים', "מעיל/ז'קט", 'גרביים', 'כובע', 'תכשיט', 'משקפי שמש', 'אקססוריז'];

/* ---------------------------- small utilities ---------------------------- */

function b64Body(dataUrl) {
  const idx = (dataUrl || '').indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

function mediaTypeOf(dataUrl) {
  const m = /^data:(image\/[a-zA-Z]+);base64,/.exec(dataUrl || '');
  return m ? m[1] : 'image/jpeg';
}

async function callClaude(contentBlocks) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('לא הוגדר מפתח ANTHROPIC_API_KEY בהגדרות השרת');
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: contentBlocks }]
    })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error('שגיאת שרת AI (' + r.status + ')' + (t ? ': ' + t.slice(0, 200) : ''));
  }
  const data = await r.json();
  return (data.content || []).map(b => b.text || '').join('\n').trim();
}

function extractJson(text) {
  const cleaned = (text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('תשובה לא תקינה מה-AI');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function geocodeCity(city) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1&language=he&format=json';
  const r = await fetch(url);
  const data = await r.json();
  if (!data.results || !data.results.length) throw new Error('לא נמצאה עיר כזו');
  return data.results[0];
}

async function getWeather(lat, lon) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,precipitation,weather_code,is_day,wind_speed_10m&timezone=auto';
  const r = await fetch(url);
  const data = await r.json();
  return data.current;
}

function weatherCodeDesc(code) {
  const map = {
    0: 'שמיים בהירים', 1: 'בהיר בעיקר', 2: 'מעונן חלקית', 3: 'מעונן', 45: 'ערפל', 48: 'ערפל קפוא',
    51: 'טפטוף קל', 53: 'טפטוף', 55: 'טפטוף חזק', 61: 'גשם קל', 63: 'גשם', 65: 'גשם חזק', 71: 'שלג קל', 73: 'שלג',
    75: 'שלג כבד', 80: 'ממטרים קלים', 81: 'ממטרים', 82: 'ממטרים חזקים', 95: 'סופת רעמים'
  };
  return map[code] || 'לא ידוע';
}

/* -------------------------------- auth ----------------------------------- */

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'נא להזין כתובת אימייל תקינה' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' });
    }
    const db = readDb();
    if (findUserByEmail(db, email)) {
      return res.status(400).json({ error: 'כבר קיים משתמש עם האימייל הזה - נסו להתחבר' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: crypto.randomUUID(),
      email: email.trim(),
      passwordHash,
      profile: { photo: null, height: '', weight: '', notes: '' },
      closet: [],
      history: [],
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    writeDb(db);
    res.json({ token: signToken(user.id), email: user.email });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בהרשמה: ' + e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const db = readDb();
    const user = findUserByEmail(db, email || '');
    if (!user) return res.status(400).json({ error: 'אימייל או סיסמה שגויים' });
    const ok = await bcrypt.compare(password || '', user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'אימייל או סיסמה שגויים' });
    res.json({ token: signToken(user.id), email: user.email });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בהתחברות: ' + e.message });
  }
});

app.get('/api/me', authMiddleware, (req, res) => {
  const db = readDb();
  const user = findUserById(db, req.userId);
  if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
  res.json({ email: user.email, profile: user.profile, closet: user.closet, history: user.history });
});

/* ------------------------------- profile ---------------------------------- */

app.put('/api/profile', authMiddleware, (req, res) => {
  const db = readDb();
  const user = findUserById(db, req.userId);
  if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
  const { photo, height, weight, notes } = req.body || {};
  user.profile = {
    photo: photo !== undefined ? photo : user.profile.photo,
    height: height !== undefined ? height : user.profile.height,
    weight: weight !== undefined ? weight : user.profile.weight,
    notes: notes !== undefined ? notes : user.profile.notes
  };
  writeDb(db);
  res.json({ profile: user.profile });
});

/* -------------------------------- closet ----------------------------------- */

app.get('/api/closet', authMiddleware, (req, res) => {
  const db = readDb();
  const user = findUserById(db, req.userId);
  res.json({ closet: user.closet });
});

app.post('/api/closet', authMiddleware, (req, res) => {
  const db = readDb();
  const user = findUserById(db, req.userId);
  const { image, category, description } = req.body || {};
  if (!image) return res.status(400).json({ error: 'חסרה תמונה' });
  const item = {
    id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    image, category: category || 'אקססוריז', description: description || '',
    createdAt: new Date().toISOString()
  };
  user.closet.push(item);
  writeDb(db);
  res.json({ item });
});

app.delete('/api/closet/:id', authMiddleware, (req, res) => {
  const db = readDb();
  const user = findUserById(db, req.userId);
  user.closet = user.closet.filter(i => i.id !== req.params.id);
  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/analyze/closet', authMiddleware, async (req, res) => {
  try {
    const { image } = req.body || {};
    if (!image) return res.status(400).json({ error: 'חסרה תמונה' });
    const text = await callClaude([
      { type: 'image', source: { type: 'base64', media_type: mediaTypeOf(image), data: b64Body(image) } },
      {
        type: 'text', text:
          `זהו פריט לבוש בארון בגדים. תאר בעברית, במשפט או שניים, את סוג הפריט, הצבע, החומר (אם ניכר) והסגנון. גם סווג את הפריט לאחת מהקטגוריות הבאות בדיוק: ${CLOSET_CATEGORIES.join(', ')}.
החזר אך ורק JSON תקני: {"category": "אחת מהקטגוריות למעלה בדיוק", "description": "התיאור בעברית, קצר וענייני"}`
      }
    ]);
    res.json(extractJson(text));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ----------------------------- outfit recommend ------------------------------ */

app.post('/api/outfit/recommend', authMiddleware, async (req, res) => {
  try {
    const db = readDb();
    const user = findUserById(db, req.userId);
    const { occasion, city, when } = req.body || {};
    if (!occasion) return res.status(400).json({ error: 'נא לתאר את האירוע' });
    if (!user.closet.length) return res.status(400).json({ error: 'הארון ריק - הוסיפו קודם פריטים' });

    let weather = null, cityName = city || null;
    if (city) {
      const geo = await geocodeCity(city);
      cityName = geo.name;
      weather = await getWeather(geo.latitude, geo.longitude);
    }

    const itemsList = user.closet.map(i => `- [${i.id}] (${i.category}) ${i.description}`).join('\n');
    const profileText = `גובה: ${user.profile.height || 'לא צוין'} ס"מ, משקל: ${user.profile.weight || 'לא צוין'} ק"ג. הערות: ${user.profile.notes || 'אין'}`;
    const weatherText = weather
      ? `טמפרטורה: ${weather.temperature_2m}°C, מזג אוויר: ${weatherCodeDesc(weather.weather_code)}, משקעים: ${weather.precipitation} מ"מ, ${weather.is_day ? 'יום' : 'לילה'}, רוח: ${weather.wind_speed_10m} קמ"ש`
      : 'אין נתוני מזג אוויר (לא צוינה עיר)';

    const contentBlocks = [];
    if (user.profile.photo) {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaTypeOf(user.profile.photo), data: b64Body(user.profile.photo) } });
    }
    contentBlocks.push({
      type: 'text', text:
        `אתה סטייליסט אישי. פרטי הפרופיל: ${profileText}
${user.profile.photo ? 'התמונה המצורפת היא תמונת הפרופיל של המשתמש - התחשב במידות וסגנון גוף.' : ''}

הארון הזמין (עם מזהים):
${itemsList}

האירוע: ${occasion}
מתי: ${when || 'עכשיו'}
מזג אוויר: ${weatherText}

המשימה שלך: להרכיב לוק שלם וגמור מראש עד רגל, לא רק חולצה בודדת. עבור על כל התפקידים הבאים ונסה למלא כל אחד מהם מתוך הארון הזמין, אם קיים פריט מתאים:
top (חולצה/חלק עליון), bottom (מכנסיים/חצאית/שמלה), outerwear (מעיל/ז'קט - רק אם קר/גשום/רוח), shoes (חובה), socks (גרביים אם רלוונטי), hat (רק אם שמש חזקה/קור קיצוני/רוח), sunglasses (רק אם יום ושמשי), jewelry, accessory.
אל תכריח קטגוריה שלא רלוונטית למזג האוויר/לאירוע. אם קטגוריה רלוונטית אך חסרה בארון, ציין ב-missing_categories. השתמש רק במזהים שקיימים ברשימה למעלה, אל תמציא.

החזר אך ורק JSON תקני: {"outfit": [{"id":"item_id","role":"top|bottom|outerwear|shoes|socks|hat|sunglasses|jewelry|accessory"}], "explanation": "הסבר קצר וממוקד בעברית", "weather_note": "משפט קצר על ההתאמה למזג האוויר", "missing_categories": ["אם יש"]}`
    });

    const text = await callClaude(contentBlocks);
    const result = extractJson(text);

    const historyEntry = {
      id: 'hist_' + Date.now(),
      type: 'recommendation',
      date: new Date().toISOString(),
      occasion, city: cityName, when: when || 'עכשיו',
      weather: weather ? { temp: weather.temperature_2m, desc: weatherCodeDesc(weather.weather_code), isDay: weather.is_day } : null,
      outfit: result.outfit || [],
      explanation: result.explanation || '',
      weatherNote: result.weather_note || '',
      missingCategories: result.missing_categories || [],
      tryon: null
    };
    user.history.unshift(historyEntry);
    writeDb(db);

    res.json({ ...result, cityName, weather, historyId: historyEntry.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* --------------------------------- try-on ------------------------------------ */

app.post('/api/tryon/score', authMiddleware, async (req, res) => {
  try {
    const db = readDb();
    const user = findUserById(db, req.userId);
    const { image, historyId } = req.body || {};
    if (!image) return res.status(400).json({ error: 'חסרה תמונה' });

    let recText = 'לא נבחרה המלצת לבוש קודמת - דרג את הלוק באופן כללי.';
    let targetEntry = historyId ? user.history.find(h => h.id === historyId) : null;
    if (!targetEntry) targetEntry = user.history.find(h => h.type === 'recommendation' && !h.tryon);
    if (targetEntry) recText = `ההמלצה שניתנה קודם: ${targetEntry.explanation}`;

    const text = await callClaude([
      { type: 'image', source: { type: 'base64', media_type: mediaTypeOf(image), data: b64Body(image) } },
      {
        type: 'text', text:
          `זוהי תמונה של המשתמש לובש/ת לוק. ${recText}
דרג את הלוק בסולם 1-10 (מספר שלם), ותן משוב קצר: מה עובד טוב ומה כדאי לשנות.
החזר אך ורק JSON תקני: {"score": מספר, "good": "מה עובד טוב", "improve": "מה כדאי לשנות"}`
      }
    ]);
    const result = extractJson(text);
    const tryonData = { image, score: result.score, good: result.good, improve: result.improve, date: new Date().toISOString() };

    if (targetEntry) {
      targetEntry.tryon = tryonData;
    } else {
      user.history.unshift({
        id: 'hist_' + Date.now(), type: 'tryon-only', date: new Date().toISOString(),
        occasion: null, city: null, weather: null, outfit: [], explanation: '', tryon: tryonData
      });
    }
    writeDb(db);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* -------------------------------- shopping ------------------------------------ */

app.post('/api/shopping/suggest', authMiddleware, async (req, res) => {
  try {
    const db = readDb();
    const user = findUserById(db, req.userId);
    if (!user.closet.length) return res.status(400).json({ error: 'הארון ריק - הוסיפו קודם כמה פריטים' });
    const itemsList = user.closet.map(i => `- (${i.category}) ${i.description}`).join('\n');
    const text = await callClaude([
      {
        type: 'text', text:
          `הנה תכולת ארון הבגדים הנוכחית:
${itemsList}
הערות סגנון: ${user.profile.notes || 'אין'}

זהה 3-6 פריטים שחסרים בארון וישלימו אותו היטב (בגדים או אקססוריז), עם נימוק קצר לכל אחד.
החזר אך ורק JSON תקני: {"suggestions": [{"item":"שם הפריט המוצע", "reason":"נימוק קצר"}]}`
      }
    ]);
    res.json(extractJson(text));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* -------------------------------- history -------------------------------------- */

app.get('/api/history', authMiddleware, (req, res) => {
  const db = readDb();
  const user = findUserById(db, req.userId);
  res.json({ history: user.history });
});

app.delete('/api/history/:id', authMiddleware, (req, res) => {
  const db = readDb();
  const user = findUserById(db, req.userId);
  user.history = user.history.filter(h => h.id !== req.params.id);
  writeDb(db);
  res.json({ ok: true });
});

/* ---------------------------------- boot --------------------------------------- */

// Any non-API route falls back to the single-page app
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('MyCloset server running on port ' + PORT);
  if (!ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY is not set - AI features will fail until you set it.');
  }
});
