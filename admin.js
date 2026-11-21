/* QR Links — Admin */
(function () {
  'use strict';

  const CFG = window.QR_CONFIG || {};
  const API = CFG.API_URL || '';
  const SCAN_BASE = CFG.SCAN_BASE_URL || new URL('./', location.href).href;
  const TOKEN_KEY = 'qr_admin_token';
  const COLORS = { scan: '#3b6fd8', download: '#0f6e66', ad_click: '#d08a12' };

  const ERRORS = {
    wrong_password: 'รหัสผ่านไม่ถูกต้อง',
    no_password: 'ยังไม่ได้ตั้งรหัสผ่าน — เปิด Google Sheet แล้วใช้เมนู QR System > ติดตั้งระบบ / ตั้งรหัสผ่าน Admin',
    too_many_attempts: 'ใส่รหัสผิดหลายครั้งเกินไป รอ 15 นาที หรือใช้เมนู QR System > ล้างแคช ใน Google Sheet',
    unauthorized: 'หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่',
    not_found: 'ไม่พบข้อมูล (อาจถูกลบไปแล้ว)',
    unknown_action: 'API ไม่รู้จักคำสั่งนี้ — อาจต้อง Deploy Apps Script เวอร์ชันใหม่'
  };

  // localStorage อาจใช้ไม่ได้ (โหมดส่วนตัว) — ห่อด้วย try/catch
  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  const state = {
    token: store.get(TOKEN_KEY),
    qrs: [], ads: [], sheetUrl: '',
    days: 30, qrFilter: '', view: 'dashboard',
    chart: null, editingQr: null, editingAd: null, showing: null
  };

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toLocaleString('th-TH');
  const pct = (a, b) => (b ? (a / b * 100).toFixed(a / b >= 0.1 ? 0 : 1) + '%' : '–');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const scanUrl = (id) => SCAN_BASE + '?id=' + encodeURIComponent(id);
  const shortUrl = (u) => u.replace(/^https?:\/\//, '');

  /* ───────── API ───────── */
  let pending = 0;
  function busy(on) {
    pending += on ? 1 : -1;
    const bar = $('loadingBar');
    bar.style.width = pending > 0 ? '70%' : '100%';
    if (pending <= 0) setTimeout(() => { if (pending <= 0) bar.style.width = '0'; }, 300);
  }

  async function api(action, data) {
    busy(true);
    try {
      let res;
      try {
        res = await fetch(API, { method: 'POST', body: JSON.stringify(Object.assign({ action, token: state.token }, data || {})) });
      } catch (e) {
        throw new Error('เชื่อมต่อ API ไม่ได้ — ตรวจสอบ API_URL ใน config.js และอินเทอร์เน็ต');
      }
      let j;
      try { j = await res.json(); } catch (e) {
        throw new Error('API ตอบกลับไม่ถูกต้อง — ตรวจสอบว่า Deploy เป็น Web app และตั้ง Who has access เป็น Anyone');
      }
      if (!j.ok) {
        if (j.error === 'unauthorized' && action !== 'login') logout(ERRORS.unauthorized);
        throw new Error(ERRORS[j.error] || j.error || 'เกิดข้อผิดพลาด');
      }
      return j;
    } finally {
      busy(false);
    }
  }

  /* ───────── UI helpers ───────── */
  let toastTimer;
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast' + (isError ? ' error' : ''); }, isError ? 5000 : 2600);
  }

  function copy(text) {
    const done = () => toast('คัดลอกลิงก์แล้ว');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('คัดลอกไม่สำเร็จ', true); }
    ta.remove();
  }

  function download(filename, href) {
    const a = document.createElement('a');
    a.href = href; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function setSeg(container, attr, value) {
    container.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(value))));
  }

  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) c.closest('dialog').close();
  });

  /* ───────── QR rendering ───────── */
  function makeQr(text) {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q;
  }
  function qrSvg(text) {
    if (typeof qrcode === 'undefined') return '<svg viewBox="0 0 1 1"></svg>';
    const q = makeQr(text), n = q.getModuleCount(), m = 4, size = n + m * 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' +
      '<rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  function qrPng(text, label) {
    const q = makeQr(text), n = q.getModuleCount(), m = 4;
    const px = Math.max(8, Math.floor(1200 / (n + m * 2)));
    const size = (n + m * 2) * px;
    const labelH = label ? Math.round(px * 7) : 0;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size + labelH;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect((c + m) * px, (r + m) * px, px, px);
    if (label) {
      let fs = Math.round(px * 2.6);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      do { ctx.font = '600 ' + fs + 'px "IBM Plex Sans Thai", sans-serif'; fs -= 2; } while (ctx.measureText(label).width > size - px * 6 && fs > 12);
      ctx.fillText(label, size / 2, size + labelH / 2 - px * 1.5);
    }
    return cv.toDataURL('image/png');
  }
  function fileSafe(s) { return (String(s).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'qr').slice(0, 60); }

  /* ───────── Auth ───────── */
  function showLogin(msg) {
    $('app').hidden = true;
    $('loginView').hidden = false;
    $('loginErr').textContent = msg || '';
    setTimeout(() => $('loginPw').focus(), 50);
  }

  function logout(msg) {
    state.token = '';
    store.del(TOKEN_KEY);
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    showLogin(msg);
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('loginBtn');
    btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ…';
    $('loginErr').textContent = '';
    try {
      const r = await api('login', { password: $('loginPw').value });
      state.token = r.token;
      store.set(TOKEN_KEY, r.token);
      $('loginPw').value = '';
      await enterApp();
    } catch (err) {
      $('loginErr').textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
    }
  });

  $('logoutBtn').addEventListener('click', () => logout());

  /* ───────── App shell ───────── */
  async function enterApp() {
    $('loginView').hidden = true;
    $('app').hidden = false;
    setView(location.hash.replace('#', '') || 'dashboard', true);
    try {
      await loadAll();
      await loadStats();
    } catch (err) {
      if (state.token) toast(err.message, true);
    }
  }

  async function loadAll() {
    const r = await api('bootstrap');
    state.qrs = r.qrs || [];
    state.ads = r.ads || [];
    state.sheetUrl = r.sheetUrl || '';
    $('sheetLink').href = state.sheetUrl || '#';
    renderQrFilter();
    renderQrs();
    renderAds();
  }

  function setView(view, silent) {
    if (!['dashboard', 'qrs', 'ads'].includes(view)) view = 'dashboard';
    state.view = view;
    ['dashboard', 'qrs', 'ads'].forEach((v) => { $('view-' + v).hidden = v !== view; });
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    if (!silent && view === 'dashboard') loadStats().catch((e) => toast(e.message, true));
  }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  window.addEventListener('hashchange', () => {
    const v = location.hash.replace('#', '');
    if (state.token && v !== state.view) setView(v);
  });

  /* ───────── Dashboard ───────── */
  function renderQrFilter() {
    const sel = $('fQr');
    const opts = ['<option value="">ทุก QR</option>'].concat(
      state.qrs.slice().sort((a, b) => a.name.localeCompare(b.name, 'th'))
        .map((q) => '<option value="' + esc(q.id) + '">' + esc(q.name) + '</option>')
    );
    sel.innerHTML = opts.join('');
    sel.value = state.qrs.some((q) => q.id === state.qrFilter) ? state.qrFilter : '';
  }
  $('fQr').addEventListener('change', (e) => { state.qrFilter = e.target.value; loadStats().catch((er) => toast(er.message, true)); });
  setSeg($('fDays'), 'days', state.days);
  $('fDays').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.days = Number(b.dataset.days);
    setSeg($('fDays'), 'days', state.days);
    loadStats().catch((er) => toast(er.message, true));
  });

  async function loadStats() {
    const s = await api('stats', { days: state.days, qrId: state.qrFilter });
    renderStats(s);
  }

  function renderStats(s) {
    const t = s.totals;
    const adViews = Object.values(s.perAd || {}).reduce((sum, a) => sum + a.scan, 0);
    $('kScan').textContent = fmt(t.scan);
    $('kDl').textContent = fmt(t.download);
    $('kDlRate').textContent = t.scan ? pct(t.download, t.scan) + ' ของการสแกน' : ' ';
    $('kAd').textContent = fmt(t.ad_click);
    $('kAdViews').textContent = 'แสดงโฆษณา ' + fmt(adViews) + ' ครั้ง';
    $('kCtr').textContent = pct(t.ad_click, adViews);

    renderChart(s.series);
    renderBars($('tCountries'), s.countries);
    renderBars($('tRegions'), s.regions);

    const byId = Object.fromEntries(state.qrs.map((q) => [q.id, q]));
    const rows = Object.entries(s.perQr).sort((a, b) => b[1].scan - a[1].scan);
    $('tPerQr').innerHTML = rows.length ? rows.map(([id, v]) =>
      '<tr><td>' + (byId[id] ? esc(byId[id].name) : '<span class="muted">' + esc(id) + ' (ลบแล้ว)</span>') + '</td>' +
      '<td class="r num">' + fmt(v.scan) + '</td><td class="r num">' + fmt(v.download) + '</td>' +
      '<td class="r num">' + fmt(v.ad_click) + '</td><td class="r num hide-sm">' + pct(v.download, v.scan) + '</td></tr>'
    ).join('') : '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px 0">ยังไม่มีข้อมูลในช่วงนี้</td></tr>';
  }

  function renderBars(el, list) {
    if (!list || !list.length) { el.innerHTML = '<p class="muted" style="margin:8px 0 0">ยังไม่มีข้อมูล</p>'; return; }
    const total = list.reduce((s, r) => s + r[1], 0);
    const max = list[0][1];
    el.innerHTML = list.slice(0, 10).map(([name, n]) =>
      '<div class="bar-row"><span class="lbl" title="' + esc(name) + '">' + esc(name) + '</span>' +
      '<span class="num muted">' + fmt(n) + ' · ' + pct(n, total) + '</span>' +
      '<span class="track"><b style="width:' + (n / max * 100).toFixed(1) + '%"></b></span></div>'
    ).join('');
  }

  function renderChart(series) {
    const box = $('chart').parentNode;
    if (typeof Chart === 'undefined') {
      box.innerHTML = '<p class="muted">โหลดกราฟไม่สำเร็จ (ตรวจสอบอินเทอร์เน็ต)</p>';
      return;
    }
    const labels = series.map((p) => new Date(p.date + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }));
    const ds = (key, label) => ({
      label, data: series.map((p) => p[key]),
      borderColor: COLORS[key], backgroundColor: COLORS[key],
      borderWidth: 2, tension: 0.3, pointRadius: series.length > 45 ? 0 : 2.5, pointHoverRadius: 5, fill: false
    });
    const data = { labels, datasets: [ds('scan', 'สแกน'), ds('download', 'ดาวน์โหลด'), ds('ad_click', 'คลิกโฆษณา')] };
    if (state.chart) { state.chart.data = data; state.chart.update(); return; }
    Chart.defaults.font.family = '"IBM Plex Sans Thai", system-ui, sans-serif';
    Chart.defaults.color = '#5e6570';
    state.chart = new Chart($('chart'), {
      type: 'line', data,
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { padding: 10, boxPadding: 4, usePointStyle: true } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eef0f3' }, border: { display: false } }
        }
      }
    });
  }

  /* ───────── QR list ───────── */
  function adName(id) { const a = state.ads.find((x) => x.id === id); return a ? a.name : null; }
  function adBadge(q) {
    if (q.adMode === 'random') return '<span class="badge ad">สุ่มโฆษณา</span>';
    if (q.adMode === 'specific') {
      const n = adName(q.adId);
      return n ? '<span class="badge ad" title="' + esc(n) + '">' + esc(n) + '</span>' : '<span class="badge off">โฆษณาถูกลบ</span>';
    }
    return '<span class="badge">ไม่มี</span>';
  }

  function renderQrs() {
    const term = $('qrSearch').value.trim().toLowerCase();
    const rows = state.qrs
      .filter((q) => !term || (q.name + ' ' + q.destination + ' ' + q.id).toLowerCase().includes(term))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    $('qrEmpty').hidden = rows.length > 0;
    if (!rows.length && term) { $('qrEmpty').innerHTML = '<strong>ไม่พบ QR ที่ค้นหา</strong>ลองคำอื่น'; }
    else $('qrEmpty').innerHTML = '<strong>ยังไม่มี QR code</strong>กด "+ สร้าง QR" เพื่อเริ่มต้น';
    $('qrBody').innerHTML = rows.map((q) => {
      const link = scanUrl(q.id), st = q.stats || {};
      return '<tr data-id="' + esc(q.id) + '">' +
        '<td class="c-thumb"><button class="qr-thumb" data-act="show" aria-label="ดู QR">' + qrSvg(link) + '</button></td>' +
        '<td class="c-main"><div class="q-name">' + esc(q.name) + '</div>' +
          '<div class="q-sub"><a href="' + esc(link) + '" target="_blank" rel="noopener">' + esc(shortUrl(link)) + '</a>' +
          '<button class="linkbtn" data-act="copy">คัดลอก</button></div>' +
          '<div class="q-sub"><span class="q-dest" title="' + esc(q.destination) + '">→ ' + esc(q.destination) + '</span></div></td>' +
        '<td>' + adBadge(q) + '</td>' +
        '<td><div class="mini-stats">' +
          '<span><b>' + fmt(st.scan) + '</b><small>สแกน</small></span>' +
          '<span><b>' + fmt(st.download) + '</b><small>ดาวน์โหลด</small></span>' +
          '<span><b>' + fmt(st.ad_click) + '</b><small>คลิกโฆษณา</small></span></div></td>' +
        '<td>' + (q.active ? '<span class="badge on">เปิดใช้งาน</span>' : '<span class="badge off">ปิดอยู่</span>') + '</td>' +
        '<td class="actions"><button class="btn sm" data-act="show">QR</button> ' +
          '<button class="btn sm" data-act="edit">แก้ไข</button> ' +
          '<button class="btn sm danger" data-act="del">ลบ</button></td>' +
        '</tr>';
    }).join('');
  }
  $('qrSearch').addEventListener('input', renderQrs);

  $('qrBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('tr').dataset.id;
    const q = state.qrs.find((x) => x.id === id); if (!q) return;
    const act = b.dataset.act;
    if (act === 'show') openQrShow(q);
    else if (act === 'copy') copy(scanUrl(q.id));
    else if (act === 'edit') openQrForm(q);
    else if (act === 'del') {
      if (!confirm('ลบ "' + q.name + '"?\n\nQR ที่พิมพ์ไปแล้วจะใช้ไม่ได้ (สถิติเดิมยังเก็บไว้ใน Google Sheet)')) return;
      try {
        await api('deleteQR', { id });
        state.qrs = state.qrs.filter((x) => x.id !== id);
        renderQrs(); renderQrFilter();
        toast('ลบแล้ว');
      } catch (err) { toast(err.message, true); }
    }
  });

  /* QR form */
  let adMode = 'none';
  function setAdMode(mode) {
    adMode = mode;
    setSeg($('qfAdMode'), 'mode', mode);
    $('qfAdPanel').hidden = mode === 'none';
    $('qfAdRow').hidden = mode !== 'specific';
    $('qfRandomHint').hidden = mode !== 'random';
  }
  $('qfAdMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setAdMode(b.dataset.mode); });

  function updateDestNote() {
    const v = $('qfDest').value.trim();
    const note = $('qfDestNote');
    const isDrive = /^https:\/\/(drive|docs)\.google\.com\//.test(v);
    const isFolder = isDrive && /\/folders\//.test(v);
    const isFile = isDrive && !isFolder && (/\/file\/d\/[\w-]{10,}/.test(v) || /[?&]id=[\w-]{10,}/.test(v));
    $('qfDirectRow').hidden = !isFile;
    if (isFile) { note.hidden = false; note.className = 'inline-note ok'; note.textContent = 'ลิงก์ไฟล์ Google Drive ✓'; }
    else if (isFolder) { note.hidden = false; note.className = 'inline-note warn'; note.textContent = 'ลิงก์โฟลเดอร์: คนสแกนจะเห็นรายการไฟล์ในโฟลเดอร์ (ดาวน์โหลดตรงไม่ได้)'; }
    else note.hidden = true;
  }
  $('qfDest').addEventListener('input', updateDestNote);

  function openQrForm(q) {
    state.editingQr = q || null;
    $('qrDlgTitle').textContent = q ? 'แก้ไข QR' : 'สร้าง QR ใหม่';
    $('qfName').value = q ? q.name : '';
    $('qfDest').value = q ? q.destination : '';
    $('qfDirect').checked = q ? q.directDownload : true;
    $('qfCountdown').value = q ? q.countdown : 5;
    $('qfActive').checked = q ? q.active : true;
    const ads = state.ads;
    $('qfAd').innerHTML = ads.length
      ? ads.map((a) => '<option value="' + esc(a.id) + '">' + esc(a.name) + (a.active ? '' : ' (ปิดอยู่)') + '</option>').join('')
      : '<option value="">ยังไม่มีโฆษณา — เพิ่มที่แท็บ "โฆษณา" ก่อน</option>';
    if (q && q.adId) $('qfAd').value = q.adId;
    setAdMode(q ? q.adMode : 'none');
    updateDestNote();
    $('qrDlg').showModal();
    $('qfName').focus();
  }
  $('newQrBtn').addEventListener('click', () => openQrForm(null));

  $('qrForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('qfSave');
    const editing = state.editingQr;
    const qr = {
      id: editing ? editing.id : '',
      name: $('qfName').value.trim(),
      destination: $('qfDest').value.trim(),
      directDownload: !$('qfDirectRow').hidden && $('qfDirect').checked,
      adMode, adId: adMode === 'specific' ? $('qfAd').value : '',
      countdown: Number($('qfCountdown').value || 0),
      active: $('qfActive').checked
    };
    if (adMode === 'specific' && !qr.adId) { toast('กรุณาเพิ่มโฆษณาก่อน แล้วค่อยเลือก', true); return; }
    btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
    try {
      const r = await api('saveQR', { qr });
      const saved = Object.assign(r.qr, { stats: editing ? editing.stats : { scan: 0, download: 0, ad_click: 0 } });
      if (editing) state.qrs = state.qrs.map((x) => (x.id === saved.id ? saved : x));
      else state.qrs.unshift(saved);
      renderQrs(); renderQrFilter();
      $('qrDlg').close();
      if (!editing) { setView('qrs'); openQrShow(saved); toast('สร้าง QR แล้ว'); }
      else toast('บันทึกแล้ว');
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = 'บันทึก';
    }
  });

  /* QR show */
  function openQrShow(q) {
    state.showing = q;
    const link = scanUrl(q.id);
    $('qsTitle').textContent = q.name;
    $('qsImg').innerHTML = qrSvg(link);
    $('qsLink').value = link;
    $('qsOpen').href = link;
    $('qrShowDlg').showModal();
  }
  $('qsCopy').addEventListener('click', () => copy($('qsLink').value));
  $('qsPng').addEventListener('click', () => {
    const q = state.showing; if (!q) return;
    download('QR-' + fileSafe(q.name) + '.png', qrPng(scanUrl(q.id), $('qsLabel').checked ? q.name : ''));
  });
  $('qsSvg').addEventListener('click', () => {
    const q = state.showing; if (!q) return;
    const blob = new Blob([qrSvg(scanUrl(q.id))], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    download('QR-' + fileSafe(q.name) + '.svg', url);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  /* ───────── Ads ───────── */
  function renderAds() {
    const grid = $('adGrid');
    $('adEmpty').hidden = state.ads.length > 0;
    const usage = {};
    state.qrs.forEach((q) => { if (q.adMode === 'specific') usage[q.adId] = (usage[q.adId] || 0) + 1; });
    grid.innerHTML = state.ads.map((a) => {
      const st = a.stats || {};
      return '<div class="ad-card" data-id="' + esc(a.id) + '">' +
        '<div class="img">' + (a.imageUrl ? '<img src="' + esc(a.imageUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') + '</div>' +
        '<div class="body"><div class="title-row"><strong>' + esc(a.name) + '</strong>' +
          (a.active ? '<span class="badge on">เปิด</span>' : '<span class="badge off">ปิด</span>') + '</div>' +
          (a.headline ? '<div class="headline">' + esc(a.headline) + '</div>' : '') +
          '<div class="mini-stats" style="margin-top:auto;padding-top:8px">' +
            '<span><b>' + fmt(st.scan) + '</b><small>แสดงผล</small></span>' +
            '<span><b>' + fmt(st.ad_click) + '</b><small>คลิก</small></span>' +
            '<span><b>' + pct(st.ad_click, st.scan) + '</b><small>อัตราคลิก</small></span></div></div>' +
        '<div class="foot"><span class="muted" style="font-size:13px">ใช้กับ ' + (usage[a.id] || 0) + ' QR</span>' +
          '<span><button class="btn sm" data-act="edit">แก้ไข</button> <button class="btn sm danger" data-act="del">ลบ</button></span></div>' +
        '</div>';
    }).join('');
  }

  $('adGrid').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('.ad-card').dataset.id;
    const a = state.ads.find((x) => x.id === id); if (!a) return;
    if (b.dataset.act === 'edit') openAdForm(a);
    else if (b.dataset.act === 'del') {
      const used = state.qrs.filter((q) => q.adMode === 'specific' && q.adId === id).length;
      const msg = 'ลบโฆษณา "' + a.name + '"?' + (used ? '\n\nมี ' + used + ' QR ที่ใช้โฆษณานี้อยู่ — QR เหล่านั้นจะไม่แสดงโฆษณา' : '');
      if (!confirm(msg)) return;
      try {
        await api('deleteAd', { id });
        state.ads = state.ads.filter((x) => x.id !== id);
        renderAds(); renderQrs();
        toast('ลบแล้ว');
      } catch (err) { toast(err.message, true); }
    }
  });

  function setPreview(url) {
    const p = $('afPreview');
    p.innerHTML = url ? '<img src="' + esc(url) + '" alt="" referrerpolicy="no-referrer">' : 'ไม่มีรูป';
  }

  function openAdForm(a) {
    state.editingAd = a || null;
    $('adDlgTitle').textContent = a ? 'แก้ไขโฆษณา' : 'เพิ่มโฆษณา';
    $('afName').value = a ? a.name : '';
    $('afImageUrl').value = a ? a.imageUrl : '';
    $('afHeadline').value = a ? a.headline : '';
    $('afDesc').value = a ? a.description : '';
    $('afClick').value = a ? a.clickUrl : '';
    $('afBtn').value = a ? a.buttonText : '';
    $('afActive').checked = a ? a.active : true;
    $('afUploadStatus').textContent = 'เก็บไว้ใน Google Drive ของคุณ · แนะนำแนวนอน 1200×675';
    setPreview(a ? a.imageUrl : '');
    $('adDlg').showModal();
    $('afName').focus();
  }
  $('newAdBtn').addEventListener('click', () => openAdForm(null));
  $('afImageUrl').addEventListener('change', (e) => setPreview(e.target.value.trim()));
  $('afPick').addEventListener('click', () => $('afFile').click());

  $('afFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const status = $('afUploadStatus'), pick = $('afPick');
    pick.disabled = true; status.textContent = 'กำลังอัปโหลด…';
    try {
      const dataUrl = await prepareImage(file);
      const r = await api('uploadImage', { dataUrl });
      $('afImageUrl').value = r.url;
      setPreview(dataUrl);
      status.textContent = 'อัปโหลดแล้ว ✓';
    } catch (err) {
      status.textContent = err.message;
      toast(err.message, true);
    } finally {
      pick.disabled = false;
    }
  });

  // ย่อรูปให้กว้างไม่เกิน 1600px ก่อนอัปโหลด (GIF อัปโหลดตรงเพื่อคงภาพเคลื่อนไหว)
  function prepareImage(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('รองรับเฉพาะ PNG, JPG, WEBP, GIF'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
      reader.onload = () => {
        const src = reader.result;
        if (file.type === 'image/gif') {
          if (file.size > 4 * 1024 * 1024) return reject(new Error('GIF ใหญ่เกิน 4MB'));
          return resolve(src);
        }
        const img = new Image();
        img.onerror = () => reject(new Error('เปิดรูปไม่สำเร็จ'));
        img.onload = () => {
          const scale = Math.min(1, 1600 / img.width);
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
          const ctx = cv.getContext('2d');
          const keepPng = file.type === 'image/png' && file.size < 1.5 * 1024 * 1024;
          if (!keepPng) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          resolve(keepPng ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.86));
        };
        img.src = src;
      };
      reader.readAsDataURL(file);
    });
  }

  $('adForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editing = state.editingAd;
    const ad = {
      id: editing ? editing.id : '',
      name: $('afName').value.trim(),
      imageUrl: $('afImageUrl').value.trim(),
      headline: $('afHeadline').value.trim(),
      description: $('afDesc').value.trim(),
      clickUrl: $('afClick').value.trim(),
      buttonText: $('afBtn').value.trim(),
      active: $('afActive').checked
    };
    if (!ad.imageUrl) { toast('กรุณาอัปโหลดรูปหรือวางลิงก์รูป', true); return; }
    const btn = $('afSave');
    btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
    try {
      const r = await api('saveAd', { ad });
      const saved = Object.assign(r.ad, { stats: editing ? editing.stats : { scan: 0, download: 0, ad_click: 0 } });
      if (editing) state.ads = state.ads.map((x) => (x.id === saved.id ? saved : x));
      else state.ads.unshift(saved);
      renderAds(); renderQrs();
      $('adDlg').close();
      toast(editing ? 'บันทึกแล้ว' : 'เพิ่มโฆษณาแล้ว');
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = 'บันทึก';
    }
  });

  /* ───────── Password ───────── */
  $('pwBtn').addEventListener('click', () => { $('pwForm').reset(); $('pwDlg').showModal(); });
  $('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('pwNew').value !== $('pwNew2').value) { toast('รหัสผ่านใหม่ไม่ตรงกัน', true); return; }
    try {
      await api('changePassword', { currentPassword: $('pwCur').value, newPassword: $('pwNew').value });
      $('pwDlg').close();
      logout('เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบด้วยรหัสใหม่');
    } catch (err) { toast(err.message, true); }
  });

  /* ───────── Start ───────── */
  if (!/^https?:\/\//.test(API)) {
    showLogin('ยังไม่ได้ตั้งค่า API_URL ในไฟล์ config.js');
    $('loginBtn').disabled = true;
  } else if (state.token) {
    enterApp();
  } else {
    showLogin();
  }
})();
