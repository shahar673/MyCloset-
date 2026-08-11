(function () {
  const API = '/api';
  let token = localStorage.getItem('mc_token') || null;
  let state = { profile: { photo: null, height: '', weight: '', notes: '' }, closet: [], history: [] };
  let lastHistoryId = null;

  const CLOSET_CATEGORIES = ['חולצה', 'מכנסיים', 'שמלה', 'נעליים', "מעיל/ז'קט", 'גרביים', 'כובע', 'תכשיט', 'משקפי שמש', 'אקססוריז'];
  const ROLE_LABELS = { top: 'חולצה / חלק עליון', bottom: 'מכנסיים / תחתון', outerwear: 'מעיל / ז׳קט', shoes: 'נעליים', socks: 'גרביים', hat: 'כובע', sunglasses: 'משקפי שמש', jewelry: 'תכשיטים', accessory: 'אקססוריז' };
  const ROLE_ORDER = ['top', 'bottom', 'outerwear', 'shoes', 'socks', 'hat', 'sunglasses', 'jewelry', 'accessory'];

  /* ------------------------------- api helper ------------------------------- */
  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new Error(data.error || ('שגיאה (' + res.status + ')'));
    return data;
  }

  /* --------------------------------- helpers -------------------------------- */
  function resizeImage(file, maxDim) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > h && w > maxDim) { h = h * maxDim / w; w = maxDim; }
          else if (h >= w && h > maxDim) { w = w * maxDim / h; h = maxDim; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function setBtnLoading(btn, loading, labelDefault, labelLoading) {
    btn.disabled = loading;
    btn.innerHTML = loading ? (labelLoading + '<span class="spinner"></span>') : labelDefault;
  }

  function weatherIcon(isDay) { return isDay ? '☀️' : '🌙'; }

  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' +
      d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------------------------------- auth ----------------------------------- */
  const authScreen = document.getElementById('authScreen');
  const appScreen = document.getElementById('appScreen');
  const authTabLogin = document.getElementById('authTabLogin');
  const authTabSignup = document.getElementById('authTabSignup');
  const authForm = document.getElementById('authForm');
  const authEmail = document.getElementById('authEmail');
  const authPassword = document.getElementById('authPassword');
  const authError = document.getElementById('authError');
  const authSubmit = document.getElementById('authSubmit');
  let authMode = 'login';

  authTabLogin.addEventListener('click', () => setAuthMode('login'));
  authTabSignup.addEventListener('click', () => setAuthMode('signup'));

  function setAuthMode(mode) {
    authMode = mode;
    authTabLogin.classList.toggle('active', mode === 'login');
    authTabSignup.classList.toggle('active', mode === 'signup');
    authSubmit.textContent = mode === 'login' ? 'התחברות' : 'הרשמה';
    authError.textContent = '';
  }

  authForm.addEventListener('submit', async e => {
    e.preventDefault();
    authError.textContent = '';
    const email = authEmail.value.trim();
    const password = authPassword.value;
    setBtnLoading(authSubmit, true, authMode === 'login' ? 'התחברות' : 'הרשמה', 'רגע');
    try {
      const path = authMode === 'login' ? '/auth/login' : '/auth/signup';
      const data = await api(path, { method: 'POST', body: { email, password } });
      token = data.token;
      localStorage.setItem('mc_token', token);
      await enterApp();
    } catch (err) {
      authError.textContent = err.message;
    }
    setBtnLoading(authSubmit, false, authMode === 'login' ? 'התחברות' : 'הרשמה', 'רגע');
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('mc_token');
    token = null;
    appScreen.style.display = 'none';
    authScreen.style.display = 'flex';
    authForm.reset();
  });

  async function enterApp() {
    const data = await api('/me');
    state.profile = data.profile || state.profile;
    state.closet = data.closet || [];
    state.history = data.history || [];
    authScreen.style.display = 'none';
    appScreen.style.display = 'block';
    renderProfile();
    renderCloset();
    renderHistory();
  }

  async function tryAutoLogin() {
    if (!token) return;
    try { await enterApp(); }
    catch (e) { localStorage.removeItem('mc_token'); token = null; }
  }

  /* ---------------------------------- tabs ------------------------------------ */
  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('sec-' + tab.dataset.tab).classList.add('active');
    });
  });

  /* --------------------------------- closet ------------------------------------ */
  const closetFileInputCamera = document.getElementById('closetFileInputCamera');
  const closetFileInputGallery = document.getElementById('closetFileInputGallery');
  document.getElementById('closetCameraBtn').addEventListener('click', () => closetFileInputCamera.click());
  document.getElementById('closetGalleryBtn').addEventListener('click', () => closetFileInputGallery.click());
  const closetPreview = document.getElementById('closetPreview');
  const closetAnalyzeWrap = document.getElementById('closetAnalyzeWrap');
  const closetAnalyzeWrap = document.getElementById('closetAnalyzeWrap');
  const closetAiSeen = document.getElementById('closetAiSeen');
  const closetDesc = document.getElementById('closetDesc');
  const closetCategory = document.getElementById('closetCategory');
  const closetError = document.getElementById('closetError');
  let pendingClosetImage = null;

  async function analyzeClosetImage() {
    if (!pendingClosetImage) return;
    closetError.textContent = '';
    closetAiSeen.classList.add('loading');
    closetAiSeen.innerHTML = '🔍 מנתח את התמונה...';
    try {
      const result = await api('/analyze/closet', { method: 'POST', body: { image: pendingClosetImage } });
      closetAiSeen.classList.remove('loading');
      closetAiSeen.innerHTML = '<b>AI רואה:</b> ' + result.description;
      closetDesc.value = result.description;
      if (CLOSET_CATEGORIES.includes(result.category)) closetCategory.value = result.category;
    } catch (e) {
      closetAiSeen.classList.remove('loading');
      closetAiSeen.innerHTML = '';
      closetError.textContent = 'שגיאה בניתוח: ' + e.message + ' — אפשר למלא ידנית או ללחוץ "נתח שוב"';
    }
  }

  async function handleClosetFile(input) {
    const file = input.files[0];
    if (!file) return;
    closetError.textContent = '';
    const dataUrl = await resizeImage(file, 800);
    pendingClosetImage = dataUrl;
    closetPreview.src = dataUrl;
    closetPreview.style.display = 'block';
    closetAnalyzeWrap.style.display = 'block';
    closetDesc.value = '';
    closetAiSeen.innerHTML = '';
    analyzeClosetImage();
  }
  closetFileInputCamera.addEventListener('change', () => handleClosetFile(closetFileInputCamera));
  closetFileInputGallery.addEventListener('change', () => handleClosetFile(closetFileInputGallery));

  document.getElementById('closetAnalyzeBtn').addEventListener('click', async () => {
    if (!pendingClosetImage) { closetError.textContent = 'יש להעלות תמונה קודם'; return; }
    const btn = document.getElementById('closetAnalyzeBtn');
    setBtnLoading(btn, true, '🔍 נתח שוב', 'מנתח');
    await analyzeClosetImage();
    setBtnLoading(btn, false, '🔍 נתח שוב', 'מנתח');
  });

  document.getElementById('closetSaveBtn').addEventListener('click', async () => {
    if (!pendingClosetImage) { closetError.textContent = 'יש להעלות תמונה קודם'; return; }
    const btn = document.getElementById('closetSaveBtn');
    setBtnLoading(btn, true, 'שמור בארון', 'שומר');
    try {
      const { item } = await api('/closet', { method: 'POST', body: { image: pendingClosetImage, category: closetCategory.value, description: closetDesc.value || '(ללא תיאור)' } });
      state.closet.push(item);
      renderCloset();
      pendingClosetImage = null;
      closetFileInputCamera.value = '';
      closetFileInputGallery.value = '';
      closetPreview.style.display = 'none';
      closetAnalyzeWrap.style.display = 'none';
      closetDesc.value = '';
      closetAiSeen.innerHTML = '';
      closetError.textContent = '';
    } catch (e) {
      closetError.textContent = 'שגיאה בשמירה: ' + e.message;
    }
    setBtnLoading(btn, false, 'שמור בארון', 'שומר');
  });

  function renderCloset() {
    const container = document.getElementById('closetGrid');
    const empty = document.getElementById('closetEmpty');
    container.innerHTML = '';
    if (!state.closet.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    const groups = {};
    state.closet.forEach(item => {
      const cat = item.category || 'אקססוריז';
      (groups[cat] = groups[cat] || []).push(item);
    });
    const orderedCats = CLOSET_CATEGORIES.filter(c => groups[c]).concat(Object.keys(groups).filter(c => !CLOSET_CATEGORIES.includes(c)));

    orderedCats.forEach(cat => {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'cat-group';
      const title = document.createElement('div');
      title.className = 'cat-title';
      title.textContent = cat + ' (' + groups[cat].length + ')';
      groupDiv.appendChild(title);
      const grid = document.createElement('div');
      grid.className = 'grid';
      groups[cat].forEach(item => {
        const div = document.createElement('div');
        div.className = 'item-card';
        div.innerHTML = `<img src="${item.image}"><div class="item-body"><div class="item-desc">${item.description}</div><button class="btn danger" type="button">מחק</button></div>`;
        div.querySelector('button').addEventListener('click', async () => {
          try {
            await api('/closet/' + item.id, { method: 'DELETE' });
            state.closet = state.closet.filter(i => i.id !== item.id);
            renderCloset();
          } catch (e) { alert('שגיאה במחיקה: ' + e.message); }
        });
        grid.appendChild(div);
      });
      groupDiv.appendChild(grid);
      container.appendChild(groupDiv);
    });
  }

  /* --------------------------------- profile ------------------------------------ */
  const profileFileInputCamera = document.getElementById('profileFileInputCamera');
  const profileFileInputGallery = document.getElementById('profileFileInputGallery');
  document.getElementById('profileCameraBtn').addEventListener('click', () => profileFileInputCamera.click());
  document.getElementById('profileGalleryBtn').addEventListener('click', () => profileFileInputGallery.click());
  const profilePreview = document.getElementById('profilePreview');
  let pendingProfileImage = null;

  async function handleProfileFile(input) {
    const file = input.files[0];
    if (!file) return;
    const dataUrl = await resizeImage(file, 700);
    pendingProfileImage = dataUrl;
    profilePreview.src = dataUrl;
    profilePreview.style.display = 'block';
  }
  profileFileInputCamera.addEventListener('change', () => handleProfileFile(profileFileInputCamera));
  profileFileInputGallery.addEventListener('change', () => handleProfileFile(profileFileInputGallery));

  function renderProfile() {
    if (state.profile.photo) {
      profilePreview.src = state.profile.photo;
      profilePreview.style.display = 'block';
      pendingProfileImage = state.profile.photo;
    }
    document.getElementById('profileHeight').value = state.profile.height || '';
    document.getElementById('profileWeight').value = state.profile.weight || '';
    document.getElementById('profileNotes').value = state.profile.notes || '';
  }

  document.getElementById('profileSaveBtn').addEventListener('click', async () => {
    const btn = document.getElementById('profileSaveBtn');
    setBtnLoading(btn, true, 'שמור פרופיל', 'שומר');
    try {
      const body = {
        photo: pendingProfileImage || state.profile.photo,
        height: document.getElementById('profileHeight').value,
        weight: document.getElementById('profileWeight').value,
        notes: document.getElementById('profileNotes').value
      };
      const { profile } = await api('/profile', { method: 'PUT', body });
      state.profile = profile;
      const saved = document.getElementById('profileSaved');
      saved.style.display = 'inline';
      setTimeout(() => saved.style.display = 'none', 2500);
    } catch (e) {
      alert('שגיאה בשמירה: ' + e.message);
    }
    setBtnLoading(btn, false, 'שמור פרופיל', 'שומר');
  });

  /* --------------------------------- outfit ------------------------------------ */
  document.getElementById('outfitGoBtn').addEventListener('click', async () => {
    const occasion = document.getElementById('outfitOccasion').value.trim();
    const city = document.getElementById('outfitCity').value.trim();
    const when = document.getElementById('outfitWhen').value;
    const errBox = document.getElementById('outfitError');
    const resultWrap = document.getElementById('outfitResultWrap');
    errBox.textContent = ''; resultWrap.innerHTML = '';
    if (!occasion) { errBox.textContent = 'ספרו קודם לאן אתם יוצאים'; return; }
    if (!state.closet.length) { errBox.textContent = 'הוסיפו קודם כמה פריטים לארון'; return; }

    const btn = document.getElementById('outfitGoBtn');
    setBtnLoading(btn, true, '✨ תמליץ לי מה ללבוש', 'חושב');
    try {
      const result = await api('/outfit/recommend', { method: 'POST', body: { occasion, city, when } });
      lastHistoryId = result.historyId;
      const byId = {}; state.closet.forEach(i => byId[i.id] = i);
      const entries = (result.outfit || []).filter(e => byId[e.id]).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));

      let weatherStrip = result.weather ? `<div class="weather-strip">
        <span>📍 <b>${result.cityName}</b></span>
        <span>🌡️ <b>${result.weather.temperature_2m}°C</b></span>
        <span>${weatherIcon(result.weather.is_day)} ${result.weather.is_day ? 'יום' : 'לילה'}</span>
      </div>` : '';

      const missingBlock = (result.missing_categories && result.missing_categories.length) ? `
        <div class="note-text" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px;">
          ⚠️ ${result.missing_categories.map(m => `<span class="tagpill">${m}</span>`).join('')}
        </div>` : '';

      resultWrap.innerHTML = `<div class="outfit-result">
        <h3>הלוק המומלץ — ראש עד רגל</h3>
        ${weatherStrip}
        <div class="grid">${entries.map(e => {
        const i = byId[e.id];
        return `<div class="item-card"><img src="${i.image}"><div class="item-body"><div class="cat-title" style="border:none;padding:0;margin:0;font-size:12px;">${ROLE_LABELS[e.role] || i.category}</div><div class="item-desc">${i.description}</div></div></div>`;
      }).join('')}</div>
        <p style="margin-top:16px;line-height:1.7;">${result.explanation}</p>
        ${result.weather_note ? `<p style="color:var(--teal);font-size:13.5px;">🌤️ ${result.weather_note}</p>` : ''}
        ${missingBlock}
      </div>`;

      // refresh history in background since a new entry was created
      refreshHistory();
    } catch (e) {
      errBox.textContent = 'שגיאה: ' + e.message;
    }
    setBtnLoading(btn, false, '✨ תמליץ לי מה ללבוש', 'חושב');
  });

  /* --------------------------------- try-on ------------------------------------ */
  const tryonFileInputCamera = document.getElementById('tryonFileInputCamera');
  const tryonFileInputGallery = document.getElementById('tryonFileInputGallery');
  document.getElementById('tryonCameraBtn').addEventListener('click', () => tryonFileInputCamera.click());
  document.getElementById('tryonGalleryBtn').addEventListener('click', () => tryonFileInputGallery.click());
  const tryonPreview = document.getElementById('tryonPreview');
  let pendingTryonImage = null;

  async function handleTryonFile(input) {
    const file = input.files[0];
    if (!file) return;
    const dataUrl = await resizeImage(file, 800);
    pendingTryonImage = dataUrl;
    tryonPreview.src = dataUrl;
    tryonPreview.style.display = 'block';
  }
  tryonFileInputCamera.addEventListener('change', () => handleTryonFile(tryonFileInputCamera));
  tryonFileInputGallery.addEventListener('change', () => handleTryonFile(tryonFileInputGallery));

  document.getElementById('tryonGoBtn').addEventListener('click', async () => {
    const errBox = document.getElementById('tryonError');
    const resultWrap = document.getElementById('tryonResultWrap');
    errBox.textContent = ''; resultWrap.innerHTML = '';
    if (!pendingTryonImage) { errBox.textContent = 'יש להעלות תמונה קודם'; return; }
    const btn = document.getElementById('tryonGoBtn');
    setBtnLoading(btn, true, '🎯 תן לי ציון', 'בודק');
    try {
      const result = await api('/tryon/score', { method: 'POST', body: { image: pendingTryonImage, historyId: lastHistoryId } });
      resultWrap.innerHTML = `<div class="outfit-result">
        <div class="tryon-result">
          <div class="score-badge">${result.score}/10</div>
          <div class="tryon-text">
            <p><b style="color:var(--teal);">✓ מה עובד:</b> ${result.good}</p>
            <p><b style="color:var(--gold);">↻ מה לשפר:</b> ${result.improve}</p>
          </div>
        </div>
      </div>`;
      refreshHistory();
    } catch (e) {
      errBox.textContent = 'שגיאה: ' + e.message;
    }
    setBtnLoading(btn, false, '🎯 תן לי ציון', 'בודק');
  });

  /* --------------------------------- shopping ------------------------------------ */
  document.getElementById('shoppingGoBtn').addEventListener('click', async () => {
    const errBox = document.getElementById('shoppingError');
    const list = document.getElementById('shoppingList');
    errBox.textContent = ''; list.innerHTML = '';
    if (!state.closet.length) { errBox.textContent = 'הארון ריק - הוסיפו קודם כמה פריטים'; return; }
    const btn = document.getElementById('shoppingGoBtn');
    setBtnLoading(btn, true, '🛍️ נתח את הארון שלי', 'בודק');
    try {
      const result = await api('/shopping/suggest', { method: 'POST' });
      list.innerHTML = result.suggestions.map(s => `<li><b>${s.item}</b> — ${s.reason}</li>`).join('');
    } catch (e) {
      errBox.textContent = 'שגיאה: ' + e.message;
    }
    setBtnLoading(btn, false, '🛍️ נתח את הארון שלי', 'בודק');
  });

  /* --------------------------------- history ------------------------------------ */
  async function refreshHistory() {
    try {
      const data = await api('/history');
      state.history = data.history || [];
      renderHistory();
    } catch (e) { /* silent - not critical */ }
  }

  function renderHistory() {
    const wrap = document.getElementById('historyList');
    const empty = document.getElementById('historyEmpty');
    wrap.innerHTML = '';
    if (!state.history.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    const byId = {}; state.closet.forEach(i => byId[i.id] = i);

    state.history.forEach(h => {
      const div = document.createElement('div');
      div.className = 'hist-entry';
      const thumbs = (h.outfit || []).map(e => byId[e.id]).filter(Boolean)
        .map(i => `<img src="${i.image}" title="${i.description}">`).join('');
      const weatherBit = h.weather ? `${weatherIcon(h.weather.isDay)} ${h.weather.temp}°C · ${h.weather.desc}` : '';
      const tryonBit = h.tryon ? `
        <div class="hist-tryon">
          <img src="${h.tryon.image}">
          <div class="hist-score">${h.tryon.score}</div>
          <div style="flex:1;min-width:160px;font-size:13px;color:var(--ivory-dim);line-height:1.6;">
            <div><b style="color:var(--teal);">✓</b> ${h.tryon.good}</div>
            <div><b style="color:var(--gold);">↻</b> ${h.tryon.improve}</div>
          </div>
        </div>` : '';

      div.innerHTML = `
        <div class="hist-top">
          <div>
            <div class="hist-date">${fmtDate(h.date)}</div>
            <div class="hist-occasion">${h.occasion || 'בדיקת לוק'}</div>
            ${h.city ? `<div class="note-text">📍 ${h.city}${weatherBit ? ' · ' + weatherBit : ''}</div>` : ''}
          </div>
          <button class="btn danger" type="button">מחק</button>
        </div>
        ${thumbs ? `<div class="hist-thumbs">${thumbs}</div>` : ''}
        ${h.explanation ? `<div class="note-text">${h.explanation}</div>` : ''}
        ${tryonBit}
      `;
      div.querySelector('.hist-top button').addEventListener('click', async () => {
        try {
          await api('/history/' + h.id, { method: 'DELETE' });
          state.history = state.history.filter(x => x.id !== h.id);
          renderHistory();
        } catch (e) { alert('שגיאה במחיקה: ' + e.message); }
      });
      wrap.appendChild(div);
    });
  }

  /* ----------------------------------- init -------------------------------------- */
  setAuthMode('login');
  authScreen.style.display = 'flex';
  tryAutoLogin();

  // register service worker for installability (best-effort, ignored if unsupported)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
