(function () {
  'use strict';

  /* -------- storage keys -------- */
  const STORE_KEY  = 'kuryente.v2.entries';
  const RATE_KEY   = 'kuryente.v2.lastRate';
  const FORM_KEY   = 'kuryente.v2.draft';

  /* -------- state -------- */
  /** @type {Array<Entry>} */
  let entries = [];
  let editingId = null;       // null = creating new; otherwise id being edited
  let activeFilter = 'all';
  let userTouched = {         // tracks whether user has typed in a field — controls auto-suggest
    prev: false, curr: false, rate: false, other: false, date: false, label: false,
  };
  let pendingConfirm = null;  // function to call when user confirms modal

  /* -------- DOM -------- */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* -------- formatters -------- */
  const fmtPHP = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtNum = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 2 });
  const monthFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short' });
  const fullDateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  const formatDate  = (iso) => { if (!iso) return '—'; const d = parseDate(iso); return isNaN(d) ? iso : fullDateFmt.format(d); };
  const formatMonth = (iso) => { const d = parseDate(iso); return isNaN(d) ? iso : monthFmt.format(d); };
  const parseDate   = (iso) => new Date(iso + 'T00:00:00');

  const todayISO = () => {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  };

  const uid = () => 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  /* -------- persistence -------- */
  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      entries = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(entries)) entries = [];
    } catch (e) {
      console.warn('Could not parse stored entries:', e);
      entries = [];
    }
  }
  function persistEntries() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(entries));
    } catch (e) {
      console.warn('Could not persist:', e);
      toast('Could not save to local storage', true);
    }
  }
  function persistLastRate(r) {
    try { localStorage.setItem(RATE_KEY, String(r)); } catch (_) {}
  }
  function loadLastRate() {
    try {
      const v = parseFloat(localStorage.getItem(RATE_KEY));
      return Number.isFinite(v) && v > 0 ? v : NaN;
    } catch (_) { return NaN; }
  }
  function loadDraft() {
    try {
      const raw = sessionStorage.getItem(FORM_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function saveDraft(obj) {
    try {
      if (!obj) sessionStorage.removeItem(FORM_KEY);
      else sessionStorage.setItem(FORM_KEY, JSON.stringify(obj));
    } catch (_) {}
  }
  function clearDraft() {
    try { sessionStorage.removeItem(FORM_KEY); } catch (_) {}
  }

  /* -------- toast -------- */
  let toastTimer;
  function toast(msg, isDanger) {
    const el = $('#toast');
    $('#toastMsg').textContent = msg;
    el.classList.toggle('danger', !!isDanger);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* -------- modal -------- */
  function openModal(title, text, onConfirm) {
    $('#modalTitle').textContent = title;
    $('#modalText').textContent = text;
    pendingConfirm = onConfirm;
    $('#modalBg').classList.add('open');
  }
  function closeModal() {
    $('#modalBg').classList.remove('open');
    pendingConfirm = null;
  }

  /* -------- form helpers -------- */
  function setUserTouched(field, val) {
    if (userTouched[field] !== val) {
      userTouched[field] = val;
      autosaveDraft();
    }
  }
  function resetUserTouched() {
    userTouched = { prev: false, curr: false, rate: false, other: false, date: false, label: false };
  }
  function isFormEmpty() {
    return ['f_date','f_label','f_prev','f_curr','f_rate','f_other']
      .every(id => String($('#'+id).value).trim() === '');
  }
  function showFormError(msg) {
    const el = $('#formError');
    el.textContent = msg;
    el.hidden = false;
  }
  function clearFormError() {
    const el = $('#formError');
    el.hidden = true;
    el.textContent = '';
  }

  /* -------- preview -------- */
  function calcUsage(prev, curr) {
    if (Number.isFinite(curr)) {
      if (Number.isFinite(prev) && prev >= 0) return Math.max(0, curr - prev);
      return Math.max(0, curr); // no prev → assume full reading
    }
    return 0;
  }
  function updatePreview() {
    const prevRaw = $('#f_prev').value.trim();
    const currRaw = $('#f_curr').value.trim();
    const rateRaw = $('#f_rate').value.trim();
    const other   = parseFloat($('#f_other').value) || 0;

    const prev = prevRaw === '' ? NaN : parseFloat(prevRaw);
    const curr = currRaw === '' ? NaN : parseFloat(currRaw);
    const rate = rateRaw === '' ? NaN : parseFloat(rateRaw);

    // usage
    let usage = 0;
    let usageValid = false;
    if (Number.isFinite(curr)) {
      usage = calcUsage(prev, curr);
      usageValid = true;
    }

    // formula text
    let formulaText = 'Fill in current reading and rate to see a preview.';
    if (usageValid) {
      if (Number.isFinite(prev)) {
        formulaText = `${fmtNum.format(curr)} − ${fmtNum.format(prev)} = ${fmtNum.format(usage)} kWh`;
      } else {
        formulaText = `No previous reading · entire ${fmtNum.format(curr)} kWh`;
      }
    }

    // total
    let totalValid = false;
    let total = 0;
    if (usageValid && Number.isFinite(rate) && rate >= 0) {
      total = usage * rate + other;
      totalValid = true;
    }

    $('#prevUsage').textContent = usageValid ? fmtNum.format(usage) : '0';
    $('#prevFormula').textContent = formulaText;
    $('#prevTotal').textContent = totalValid ? '₱' + fmtPHP.format(total) : '₱0.00';

    // Use-last button visibility — only when form is empty-ish and history exists
    const showUseLast = !editingId
      && entries.length > 0
      && ['f_prev','f_curr','f_label'].every(id => String($('#'+id).value).trim() === '')
      && !$('#f_curr').matches(':focus');
    $('#btnUseLast').hidden = !showUseLast;

    autosaveDraft();
  }

  /* -------- autosuggest / use last -------- */
  function getLatestEntry() {
    if (entries.length === 0) return null;
    return entries.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
  }
  function autosuggestFromHistory() {
    if (editingId) return;
    const last = getLatestEntry();
    if (!last) return;
    $('#f_prev').value = last.curr;
    $('#f_rate').value = last.rate;
    $('#autoPrevTag').hidden = false;
    userTouched.prev = false; // flag as auto-filled so user clearing it counts as user action
    updatePreview();
  }
  function useLastReading() {
    autosuggestFromHistory();
    $('#f_curr').focus();
    toast('Loaded last reading as your starting point');
  }

  /* -------- form read/write -------- */
  function readForm() {
    return {
      date:  $('#f_date').value || todayISO(),
      label: $('#f_label').value.trim(),
      prevRaw: $('#f_prev').value,
      currRaw: $('#f_curr').value,
      rateRaw: $('#f_rate').value,
      otherRaw: $('#f_other').value,
    };
  }
  function validateAndBuildEntry() {
    clearFormError();
    const f = readForm();
    const prev = f.prevRaw === '' ? 0 : parseFloat(f.prevRaw);
    const curr = parseFloat(f.currRaw);
    const rate = parseFloat(f.rateRaw);
    const other = parseFloat(f.otherRaw) || 0;

    if (!Number.isFinite(curr) || curr < 0) {
      showFormError('Add a current reading (in kWh).');
      $('#f_curr').focus();
      return null;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      showFormError('Add a rate per kWh in pesos (₱).');
      $('#f_rate').focus();
      return null;
    }
    if (!Number.isFinite(prev) || prev < 0) {
      showFormError('Previous reading must be 0 or a positive number.');
      $('#f_prev').focus();
      return null;
    }

    return {
      date: f.date,
      label: f.label || '',
      prev, curr,
      rate,
      other,
    };
  }

  function writeForm(entry, opts = {}) {
    $('#f_date').value  = entry.date;
    $('#f_label').value = entry.label || '';
    $('#f_prev').value  = entry.prev;
    $('#f_curr').value  = entry.curr;
    $('#f_rate').value  = entry.rate;
    $('#f_other').value = entry.other || 0;
    $('#autoPrevTag').hidden = !!opts.hideAutoTag;
    clearFormError();
    updatePreview();
  }

  /* -------- add / update / delete -------- */
  function addEntry(payload) {
    const e = {
      id: uid(),
      date: payload.date,
      label: payload.label,
      prev: payload.prev,
      curr: payload.curr,
      rate: payload.rate,
      other: payload.other,
      savedAt: Date.now(),
    };
    entries.push(e);
    persistEntries();
    persistLastRate(payload.rate);
    return e;
  }
  function updateEntry(id, payload) {
    const idx = entries.findIndex(e => e.id === id);
    if (idx < 0) return null;
    const updated = {
      ...entries[idx],
      date: payload.date,
      label: payload.label,
      prev: payload.prev,
      curr: payload.curr,
      rate: payload.rate,
      other: payload.other,
      updatedAt: Date.now(),
    };
    entries[idx] = updated;
    persistEntries();
    persistLastRate(payload.rate);
    return updated;
  }
  function deleteEntry(id) {
    const before = entries.length;
    entries = entries.filter(e => e.id !== id);
    if (entries.length !== before) {
      persistEntries();
      render();
      toast('Entry removed');
    }
  }

  /* -------- edit flow -------- */
  function startEdit(id) {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    editingId = id;
    writeForm(entry, { hideAutoTag: true });
    setEditModeUI(entry);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Editing — update the form, then save');
  }
  function cancelEdit() {
    editingId = null;
    resetForm({ keepAutoTag: false });
    toast('Edit cancelled');
  }
  function setEditModeUI(entry) {
    $('#editBanner').hidden = false;
    $('#editBannerDate').textContent = formatDate(entry.date) + (entry.label ? ` · ${entry.label}` : '');
    $('#btnSubmitLabel').textContent = 'Save changes';
    const icon = $('#btnSubmitIcon');
    icon.innerHTML = '<path d="M5 12l5 5L20 7"/>';
    $('#btnUseLast').hidden = true;
  }
  function clearEditModeUI() {
    $('#editBanner').hidden = true;
    $('#btnSubmitLabel').textContent = 'Save reading';
    const icon = $('#btnSubmitIcon');
    icon.innerHTML = '<path d="M5 12l5 5L20 7"/>';
  }

  /* -------- reset form -------- */
  function resetForm({ keepDraft = false } = {}) {
    $('#f_date').value = todayISO();
    $('#f_label').value = '';
    $('#f_prev').value = '';
    $('#f_curr').value = '';
    $('#f_rate').value = '';
    $('#f_other').value = '0';
    // restore rate from last-saved (only if not editing)
    if (!editingId) {
      const r = loadLastRate();
      if (!isNaN(r)) $('#f_rate').value = r;
    }
    $('#autoPrevTag').hidden = true;
    editingId = null;
    resetUserTouched();
    clearFormError();
    clearEditModeUI();
    updatePreview();
    if (!keepDraft) clearDraft();
  }

  /* -------- use a saved entry as previous -------- */
  function useEntryAsPrevious(id) {
    const e = entries.find(x => x.id === id);
    if (!e) return;
    if (editingId) {
      // cancel current edit silently to switch into create-mode w/ suggestion
      editingId = null;
      clearEditModeUI();
    }
    $('#f_prev').value = e.curr;
    $('#f_date').value = bumpMonth(e.date);
    $('#f_rate').value = e.rate;
    $('#autoPrevTag').hidden = false;
    userTouched.prev = false;
    clearFormError();
    updatePreview();
    $('#f_curr').focus();
    toast('Loaded as your new starting point');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function bumpMonth(iso) {
    const d = parseDate(iso);
    if (isNaN(d)) return todayISO();
    d.setMonth(d.getMonth() + 1);
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    const next = local.toISOString().slice(0, 10);
    return next < todayISO() ? todayISO() : next;
  }

  /* -------- submit -------- */
  function handleSubmit(ev) {
    ev.preventDefault();
    const payload = validateAndBuildEntry();
    if (!payload) return;

    if (editingId) {
      const updated = updateEntry(editingId, payload);
      editingId = null;
      clearEditModeUI();
      if (updated) {
        toast('Saved changes');
        // reset to fresh state, pre-suggest the updated entry as previous
        editingId = null;
        resetForm();
        // re-suggest using updated
        $('#f_prev').value = updated.curr;
        $('#f_date').value = bumpMonth(updated.date);
        $('#autoPrevTag').hidden = false;
        updatePreview();
        render();
        return;
      }
    } else {
      const added = addEntry(payload);
      toast('Saved');
      // auto-prepare for next month
      resetForm();
      $('#f_prev').value = added.curr;
      $('#f_date').value = bumpMonth(added.date);
      $('#autoPrevTag').hidden = false;
      userTouched.prev = false;
      updatePreview();
      render();
    }
  }

  /* -------- draft save -------- */
  function autosaveDraft() {
    if (editingId) return;
    const draft = {
      date:  $('#f_date').value,
      label: $('#f_label').value,
      prev:  $('#f_prev').value,
      curr:  $('#f_curr').value,
      rate:  $('#f_rate').value,
      other: $('#f_other').value,
      touched: userTouched,
    };
    saveDraft(draft);
  }

  /* -------- render -------- */
  function getFilteredEntries() {
    const sorted = entries.slice().sort((a, b) => a.date.localeCompare(b.date));
    if (activeFilter === 'all')   return sorted;
    if (activeFilter === 'year')  return sorted.filter(e => parseDate(e.date).getFullYear() === new Date().getFullYear());
    if (activeFilter === 'recent') return sorted.slice(-6);
    return sorted;
  }

  function renderHistory() {
    const host = $('#historyHost');
    const list = getFilteredEntries();
    if (list.length === 0) {
      host.innerHTML = `
        <div class="hist-empty">
          <div class="hist-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
          </div>
          <div class="hist-empty-title">${entries.length === 0 ? 'No readings yet' : 'Nothing matches that filter'}</div>
          <div>${entries.length === 0 ? 'Save your first reading above and it will show up here.' : 'Pick a different filter to see more entries.'}</div>
        </div>`;
      return;
    }
    const display = list.slice().reverse();
    host.innerHTML = `<div class="history-list">${display.map(rowHTML).join('')}</div>`;

    host.querySelectorAll('[data-action="edit"]').forEach(b => {
      b.addEventListener('click', () => startEdit(b.dataset.id));
    });
    host.querySelectorAll('[data-action="use"]').forEach(b => {
      b.addEventListener('click', () => useEntryAsPrevious(b.dataset.id));
    });
    host.querySelectorAll('[data-action="delete"]').forEach(b => {
      b.addEventListener('click', () => {
        const e = entries.find(x => x.id === b.dataset.id);
        if (!e) return;
        openModal(
          'Delete this reading?',
          `Remove the ${formatDate(e.date)} reading? This cannot be undone.`,
          () => deleteEntry(e.id)
        );
      });
    });
  }

  function rowHTML(e) {
    const usage = Math.max(0, e.curr - e.prev);
    const total = usage * e.rate + (e.other || 0);
    const warn  = e.curr < e.prev;
    const isEditing = editingId === e.id;
    return `
      <div class="hist-row ${warn ? 'is-warning' : ''} ${isEditing ? 'is-editing' : ''}" data-id="${e.id}">
        <div>
          <div class="hist-meta">
            <span class="hist-date">${formatDate(e.date)}</span>
            ${e.label ? `<span class="hist-label">${escapeHTML(e.label)}</span>` : ''}
            ${warn ? `<span class="hist-label warn">check readings</span>` : ''}
            ${isEditing ? `<span class="hist-label" style="background: var(--accent-soft); color: var(--accent-deep);">currently editing</span>` : ''}
          </div>
          <div class="hist-info">
            <span>Prev <b>${fmtNum.format(e.prev)}</b></span>
            <span>Curr <b>${fmtNum.format(e.curr)}</b></span>
            <span>Used <b>${fmtNum.format(usage)}</b> kWh</span>
            <span>Rate <b>₱${fmtPHP.format(e.rate)}</b></span>
            ${e.other ? `<span>Other <b>₱${fmtPHP.format(e.other)}</b></span>` : ''}
          </div>
        </div>
        <div class="hist-amount">
          <div class="hist-amount-num">₱${fmtPHP.format(total)}</div>
          <div class="hist-amount-sub">${warn ? 'total this row' : 'billed'}</div>
        </div>
        <div class="hist-row-actions">
          <button class="btn btn-ghost btn-sm" data-action="edit"   data-id="${e.id}">Edit</button>
          <button class="btn btn-ghost btn-sm" data-action="use"    data-id="${e.id}">Use as previous</button>
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${e.id}">Delete</button>
        </div>
      </div>
    `;
  }

  function renderStats() {
    const totalKwh = entries.reduce((s, e) => s + Math.max(0, e.curr - e.prev), 0);
    const totalBill = entries.reduce((s, e) => s + Math.max(0, e.curr - e.prev) * e.rate + (e.other || 0), 0);
    $('#statMonths').textContent = String(entries.length);
    $('#statKwh').textContent = fmtNum.format(totalKwh);
    $('#statBill').textContent = '₱' + fmtPHP.format(totalBill);
  }

  function renderChart() {
    const host = $('#chartHost');
    const sorted = entries.slice().sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length === 0) {
      host.innerHTML = '<div class="chart-empty">Once you save a few readings, a trend of usage and pesos over time will appear here.</div>';
      return;
    }

    const W = 720, H = 220, padL = 50, padR = 18, padT = 18, padB = 36;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const kwhs  = sorted.map(e => Math.max(0, e.curr - e.prev));
    const bills = sorted.map(e => Math.max(0, e.curr - e.prev) * e.rate + (e.other || 0));
    const maxKwh  = Math.max(1, ...kwhs);
    const maxBill = Math.max(1, ...bills);

    const stepX = sorted.length === 1 ? 0 : innerW / (sorted.length - 1);

    const ptsKwh  = sorted.map((_, i) => [padL + i * stepX, padT + innerH - (kwhs[i]  / maxKwh)  * innerH]);
    const ptsBill = sorted.map((_, i) => [padL + i * stepX, padT + innerH - (bills[i] / maxBill) * innerH]);

    const pathOf = (pts) => {
      if (pts.length === 0) return '';
      if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
      return pts.map((p, i) => (i === 0 ? 'M' : 'L') + ' ' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    };

    let grid = '';
    for (let g = 0; g <= 3; g++) {
      const y = padT + innerH * (g / 3);
      grid += `<line x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${'#ECE6D6'}" stroke-dasharray="2 5"/>`;
    }

    let yLabels = '';
    for (let g = 0; g <= 3; g++) {
      const v = maxKwh * (1 - g / 3);
      const y = padT + innerH * (g / 3);
      yLabels += `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#7A7367" font-family="Inter, sans-serif">${fmtNum.format(v)}</text>`;
    }

    let xLabels = '';
    const targetCount = Math.min(sorted.length, 5);
    const indices = sorted.length <= targetCount
      ? sorted.map((_, i) => i)
      : Array.from({ length: targetCount }, (_, i) => Math.round(i * (sorted.length - 1) / (targetCount - 1)));
    indices.forEach(idx => {
      const x = padL + idx * stepX;
      xLabels += `<text x="${x.toFixed(1)}" y="${H - 14}" text-anchor="middle" font-size="10.5" fill="#7A7367" font-family="Inter, sans-serif">${escapeHTML(formatMonth(sorted[idx].date))}</text>`;
    });

    const dotKwh  = ptsKwh.map(([x, y], i)  => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" fill="#0E5C5C" stroke="#fff" stroke-width="2"><title>${escapeHTML(formatDate(sorted[i].date))} · ${fmtNum.format(kwhs[i])} kWh</title></circle>`).join('');
    const dotBill = ptsBill.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="#C2701F" opacity="0.85"><title>${escapeHTML(formatDate(sorted[i].date))} · ₱${fmtPHP.format(bills[i])}</title></circle>`).join('');

    const areaKwh = ptsKwh.length > 1
      ? `<path d="${pathOf(ptsKwh)} L ${ptsKwh[ptsKwh.length - 1][0].toFixed(1)} ${(padT + innerH).toFixed(1)} L ${ptsKwh[0][0].toFixed(1)} ${(padT + innerH).toFixed(1)} Z" fill="rgba(14,92,92,0.08)"/>`
      : '';

    host.innerHTML = `
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Trend of kWh and peso amounts over time">
        ${grid}
        ${areaKwh}
        <path d="${pathOf(ptsKwh)}"  fill="none" stroke="#0E5C5C" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${pathOf(ptsBill)}" fill="none" stroke="#C2701F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="5 4"/>
        ${dotKwh}${dotBill}
        ${xLabels}${yLabels}
      </svg>
    `;
  }

  function render() {
    renderHistory();
    renderStats();
    renderChart();
    // status pill
    const status = entries.length === 0 ? 'No saved readings yet' : `${entries.length} reading${entries.length === 1 ? '' : 's'} saved`;
    $('#statusText').textContent = status;
  }

  /* -------- export / clear -------- */
  function exportJSON() {
    if (entries.length === 0) {
      toast('Nothing to export yet', true);
      return;
    }
    const payload = {
      generatedAt: new Date().toISOString(),
      app: 'Kuryente',
      count: entries.length,
      entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kuryente-readings-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Downloaded as JSON');
  }
  function clearAll() {
    if (entries.length === 0) { toast('Nothing to clear'); return; }
    openModal(
      'Clear every saved reading?',
      `This removes all ${entries.length} saved reading${entries.length === 1 ? '' : 's'} from this browser. This cannot be undone.`,
      () => {
        entries = [];
        persistEntries();
        editingId = null;
        clearEditModeUI();
        clearFormError();
        resetForm();
        render();
        toast('All readings cleared');
      }
    );
  }

  /* -------- wire events -------- */
  function wireForm() {
    // initial fill
    const draft = loadDraft();
    if (draft && !draft.touched) {
      // only restore if user never started typing
      $('#f_date').value  = draft.date  || todayISO();
      $('#f_label').value = draft.label || '';
      $('#f_prev').value  = draft.prev  || '';
      $('#f_curr').value  = draft.curr  || '';
      $('#f_rate').value  = draft.rate  || '';
      $('#f_other').value = draft.other || '0';
    } else {
      $('#f_date').value = todayISO();
      $('#f_other').value = '0';
      const r = loadLastRate();
      if (!isNaN(r)) $('#f_rate').value = r;
    }

    const tracked = [
      ['f_date',  'date'],
      ['f_label', 'label'],
      ['f_prev',  'prev'],
      ['f_curr',  'curr'],
      ['f_rate',  'rate'],
      ['f_other', 'other'],
    ];
    tracked.forEach(([id, key]) => {
      const el = $('#' + id);
      el.addEventListener('input', () => {
        setUserTouched(key, true);
        if (id === 'f_prev' && el.value === '') $('#autoPrevTag').hidden = true;
        if (id === 'f_prev' && el.value !== '' && !$('#autoPrevTag').hidden) {
          // keep tag visible if still has the auto value
        }
        updatePreview();
      });
    });

    // submit
    $('#calcForm').addEventListener('submit', handleSubmit);

    // reset
    $('#btnReset').addEventListener('click', () => {
      resetForm();
      toast('Form cleared');
    });

    // use last
    $('#btnUseLast').addEventListener('click', useLastReading);

    // cancel edit
    $('#editCancel').addEventListener('click', cancelEdit);

    // filter chips
    $$('.seg-btn').forEach(b => {
      b.addEventListener('click', () => {
        $$('.seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        activeFilter = b.dataset.filter;
        renderHistory();
      });
    });

    // clear all
    $('#btnClearAll').addEventListener('click', clearAll);

    // export
    $('#btnExport').addEventListener('click', exportJSON);

    // modal
    $('#modalCancel').addEventListener('click', closeModal);
    $('#modalOk').addEventListener('click', () => {
      const cb = pendingConfirm;
      closeModal();
      if (typeof cb === 'function') cb();
    });
    $('#modalBg').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if ($('#modalBg').classList.contains('open')) closeModal();
      }
    });

    // initial state
    updatePreview();
  }

  /* -------- init -------- */
  function init() {
    loadEntries();
    wireForm();
    render();
    // Fresh page reset that doesn't undo rate-from-last
    // (rate was filled in wireForm above)
    if (entries.length === 0) {
      // first-ever visit — make rate focusable hint, but no auto data
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
