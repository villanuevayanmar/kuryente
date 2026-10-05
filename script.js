(function(){
  'use strict';

  const STORE_KEY = 'kuryente.v1.entries';
  const RATE_KEY = 'kuryente.v1.lastRate';
  const LABEL_KEY = 'kuryente.v1.recurringLabels';

  /** @type {Array<{id:string,date:string,label:string,prev:number,curr:number,rate:number,other:number,savedAt:number}>} */
  let entries = [];

  let activeFilter = 'all';

  // ---------- HELPERS ----------
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const fmtPHP = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtNum = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 2 });
  const fmtDate = (iso) => {
    if(!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const fmtMonth = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  };
  const uid = () => 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);

  // ---------- STORAGE ----------
  function load(){
    try{
      const raw = localStorage.getItem(STORE_KEY);
      entries = raw ? JSON.parse(raw) : [];
      if(!Array.isArray(entries)) entries = [];
    }catch(e){
      console.error('failed to load', e);
      entries = [];
    }
  }
  function persist(){
    try{
      localStorage.setItem(STORE_KEY, JSON.stringify(entries));
    }catch(e){
      console.error('failed to save', e);
      toast('Could not save to localStorage', true);
    }
  }

  // ---------- TOAST ----------
  let toastTimer;
  function toast(msg, isDanger){
    const el = $('#toast');
    $('#toastMsg').textContent = msg;
    el.classList.toggle('danger', !!isDanger);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- FORM ----------
  function todayISO(){
    const d = new Date();
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off*60000);
    return local.toISOString().slice(0,10);
  }

  function autoFillFromLast(){
    const f = $('#f_date');
    if(!f.value) f.value = todayISO();
  }

  function suggestPrevFromHistory(){
    if(entries.length === 0) return null;
    // use most recent entry's "curr" as auto suggestion, only if form prev is empty
    const last = entries.slice().sort((a,b)=> b.savedAt - a.savedAt)[0];
    return last.curr;
  }

  function setAutoPrevTag(visible){
    const t = $('#autoPrevTag');
    t.style.display = visible ? '' : 'none';
  }

  function updatePreview(){
    const prev = parseFloat($('#f_prev').value);
    const curr = parseFloat($('#f_curr').value);
    const rate = parseFloat($('#f_rate').value);
    const other = parseFloat($('#f_other').value) || 0;

    let usage = 0;
    let validUsage = false;
    if(!isNaN(curr)){
      if(!isNaN(prev) && prev >= 0){
        usage = curr - prev;
        validUsage = true;
      } else {
        // no prev provided → assume prev = 0 (whole reading is the period)
        usage = curr;
        validUsage = true;
      }
    }

    let total = 0;
    let validTotal = false;
    if(validUsage && !isNaN(rate) && rate >= 0){
      total = Math.max(0, usage) * rate + (other || 0);
      validTotal = true;
    }

    if(validTotal){
      $('#prevTotal').textContent = '₱' + fmtPHP.format(total);
      $('#prevUsage').textContent = fmtNum.format(Math.max(0, usage));
      $('#prevFormula').textContent = !isNaN(prev)
        ? `${fmtNum.format(curr)} − ${fmtNum.format(prev)} = ${fmtNum.format(Math.max(0, usage))} kWh`
        : `No previous reading · entire ${fmtNum.format(curr)} kWh`;
    } else {
      $('#prevTotal').textContent = '₱0.00';
      $('#prevUsage').textContent = '0';
      $('#prevFormula').textContent = 'Fill in current reading and rate to see a preview.';
    }

    // Pulse animation once when total changes meaningfully
    if(validTotal){
      $('#prevTotal').classList.remove('pulse-once');
      void $('#prevTotal').offsetWidth;
    }
  }

  // ---------- READ / WRITE FORM FROM ENTRY ----------
  function loadEntryIntoForm(e){
    $('#f_date').value = e.date;
    $('#f_label').value = e.label || '';
    $('#f_prev').value = e.prev;
    $('#f_curr').value = e.curr;
    $('#f_rate').value = e.rate;
    $('#f_other').value = e.other || 0;
    $('#f_curr').focus();
    setAutoPrevTag(false);
    updatePreview();
    toast('Loaded — saved as new starting point');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function useEntryAsPrevious(e){
    // Sets a fresh entry: prev = e.curr, current blank, date = original month end + ~1 month-ish
    $('#f_prev').value = e.curr;
    // try to bump date by 1 month
    let nextDate = '';
    try{
      const d = new Date(e.date + 'T00:00:00');
      d.setMonth(d.getMonth() + 1);
      const off = d.getTimezoneOffset();
      const local = new Date(d.getTime() - off*60000);
      nextDate = local.toISOString().slice(0,10);
    }catch(_){ nextDate = todayISO(); }
    const today = todayISO();
    $('#f_date').value = nextDate < today ? today : nextDate;
    $('#f_curr').value = '';
    // keep rate if same as last, else clear
    if(!$('#f_rate').value) $('#f_rate').value = e.rate;
    setAutoPrevTag(true);
    $('#f_curr').focus();
    updatePreview();
    toast('Loaded as previous reading');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- ADD / REMOVE ----------
  function addEntry(){
    const date = $('#f_date').value || todayISO();
    const label = $('#f_label').value.trim();
    const prevRaw = $('#f_prev').value;
    const currRaw = $('#f_curr').value;
    const rateRaw = $('#f_rate').value;
    const otherRaw = parseFloat($('#f_other').value) || 0;

    const curr = parseFloat(currRaw);
    const rate = parseFloat(rateRaw);
    const prev = prevRaw === '' ? 0 : parseFloat(prevRaw);

    if(isNaN(curr) || curr < 0){ toast('Current reading is required', true); $('#f_curr').focus(); return; }
    if(isNaN(rate) || rate < 0){ toast('Rate per kWh is required', true); $('#f_rate').focus(); return; }
    if(isNaN(prev) || prev < 0){ toast('Previous reading must be 0 or more', true); $('#f_prev').focus(); return; }

    const entry = {
      id: uid(),
      date, label,
      prev: prev, curr: curr,
      rate: rate, other: otherRaw,
      savedAt: Date.now(),
    };
    entries.push(entry);
    persist();

    // remember last rate for convenience
    try{ localStorage.setItem(RATE_KEY, String(rate)); }catch(_){}

    toast('Saved to history');
    // prepare for next month automatically
    useEntryAsPrevious(entry);
  }

  function deleteEntry(id){
    entries = entries.filter(e => e.id !== id);
    persist();
    render();
    toast('Entry removed');
  }

  // ---------- RENDERING ----------
  function getFilteredEntries(){
    const sorted = entries.slice().sort((a,b) => a.date.localeCompare(b.date));
    if(activeFilter === 'all') return sorted;
    if(activeFilter === 'year'){
      const thisYear = new Date().getFullYear();
      return sorted.filter(e => new Date(e.date + 'T00:00:00').getFullYear() === thisYear);
    }
    if(activeFilter === 'recent'){
      return sorted.slice(-6);
    }
    return sorted;
  }

  function renderHistory(){
    const host = $('#historyHost');
    const list = getFilteredEntries();
    if(list.length === 0){
      host.innerHTML = `
        <div class="empty">
          <div class="empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          </div>
          <div class="empty-title">No readings yet</div>
          <div>Save your first calculation and it'll show up here.</div>
        </div>`;
      return;
    }
    const display = list.slice().reverse(); // newest first
    host.innerHTML = `<div class="history-list">${display.map(rowHTML).join('')}</div>`;

    // Wire actions
    host.querySelectorAll('[data-action="use-prev"]').forEach(b => {
      b.addEventListener('click', () => {
        const e = entries.find(x => x.id === b.dataset.id);
        if(e) useEntryAsPrevious(e);
      });
    });
    host.querySelectorAll('[data-action="load"]').forEach(b => {
      b.addEventListener('click', () => {
        const e = entries.find(x => x.id === b.dataset.id);
        if(e) loadEntryIntoForm(e);
      });
    });
    host.querySelectorAll('[data-action="delete"]').forEach(b => {
      b.addEventListener('click', () => {
        const e = entries.find(x => x.id === b.dataset.id);
        if(!e) return;
        pendingDeleteId = e.id;
        openModal('Delete this entry?', `Remove the ${fmtDate(e.date)} reading? This cannot be undone.`, () => {
          deleteEntry(pendingDeleteId);
          pendingDeleteId = null;
        });
      });
    });
  }

  function rowHTML(e){
    const usage = Math.max(0, e.curr - e.prev);
    const total = usage * e.rate + (e.other || 0);
    const isPending = e.curr < e.prev;
    return `
      <div class="hist-row ${isPending ? 'is-pending' : ''}" data-id="${e.id}">
        <div>
          <div class="hist-meta">
            <span class="hist-date">${fmtDate(e.date)}</span>
            ${e.label ? `<span class="hist-tag">${escapeHTML(e.label)}</span>` : ''}
            ${isPending ? `<span class="hist-tag warn">check readings</span>` : ''}
          </div>
          <div class="hist-stats">
            <span><span style="color:var(--muted)">prev</span> <b>${fmtNum.format(e.prev)}</b></span>
            <span><span style="color:var(--muted)">curr</span> <b>${fmtNum.format(e.curr)}</b></span>
            <span><span style="color:var(--muted)">used</span> <b>${fmtNum.format(usage)}</b> <span style="color:var(--muted)">kWh</span></span>
            <span><span style="color:var(--muted)">rate</span> <b>₱${fmtPHP.format(e.rate)}</b></span>
          </div>
        </div>
        <div>
          <div class="hist-amount">₱${fmtPHP.format(total)}</div>
          <div class="hist-amount-note">total billed</div>
          <div class="hist-actions" style="margin-top:10px;">
            <button class="btn btn-ghost btn-sm" data-action="use-prev" data-id="${e.id}" title="Use this reading as your next starting point">
              Use as previous
            </button>
            <button class="btn btn-ghost btn-sm" data-action="load" data-id="${e.id}" title="Open this entry in the form">
              Open
            </button>
            <button class="btn btn-danger btn-sm" data-action="delete" data-id="${e.id}">
              Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function escapeHTML(s){
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function renderKPIs(){
    const all = entries;
    $('#kpiMonths').textContent = String(all.length);
    const totalKwh = all.reduce((s,e) => s + Math.max(0, e.curr - e.prev), 0);
    const totalBill = all.reduce((s,e) => s + Math.max(0, e.curr - e.prev) * e.rate + (e.other||0), 0);
    $('#kpiKwh').innerHTML = fmtNum.format(totalKwh) + '<span class="kpi-unit">kWh</span>';
    $('#kpiBill').textContent = '₱' + fmtPHP.format(totalBill);
    $('#kpiAvg').textContent = '₱' + (all.length ? fmtPHP.format(totalBill/all.length) : '0.00');
  }

  // ---------- CHART ----------
  function renderChart(){
    const host = $('#chartHost');
    const sorted = entries.slice().sort((a,b) => a.date.localeCompare(b.date));
    if(sorted.length === 0){
      host.innerHTML = `
        <div class="empty" style="padding: 26px 18px;">
          <div style="font-size:13px;">Once you save readings, a chart of usage and pesos over time will appear here.</div>
        </div>`;
      return;
    }
    const W = 1160, H = 240, padL = 56, padR = 24, padT = 18, padB = 38;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const kwhs = sorted.map(e => Math.max(0, e.curr - e.prev));
    const bills = sorted.map(e => Math.max(0, e.curr - e.prev) * e.rate + (e.other||0));
    const maxKwh = Math.max(1, ...kwhs);
    const maxBill = Math.max(1, ...bills);

    const stepX = sorted.length === 1 ? 0 : innerW / (sorted.length - 1);

    const ptsKwh = sorted.map((e, i) => {
      const x = padL + i * stepX;
      const y = padT + innerH - (kwhs[i] / maxKwh) * innerH;
      return [x, y];
    });
    const ptsBill = sorted.map((e, i) => {
      const x = padL + i * stepX;
      const y = padT + innerH - (bills[i] / maxBill) * innerH;
      return [x, y];
    });

    // path
    const path = (pts) => {
      if(pts.length === 0) return '';
      if(pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
      return pts.map((p, i) => (i===0 ? 'M' : 'L') + ' ' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    };

    // gridlines (4 horizontal)
    let gridLines = '';
    for(let g = 0; g <= 3; g++){
      const y = padT + innerH * (g / 3);
      gridLines += `<line x1="${padL}" x2="${W-padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#E5E2DA" stroke-dasharray="2 4"/>`;
    }

    // x labels — show first, last, and a few between, max 6
    let xLabels = '';
    const labelCount = Math.min(sorted.length, 6);
    const labelIdxs = sorted.length <= labelCount
      ? sorted.map((_, i) => i)
      : Array.from({length: labelCount}, (_, i) => Math.round(i * (sorted.length - 1) / (labelCount - 1)));
    labelIdxs.forEach(idx => {
      const x = padL + idx * stepX;
      xLabels += `<text x="${x.toFixed(1)}" y="${H - 14}" text-anchor="middle" font-size="11" fill="#6B7280" font-family="Inter, sans-serif">${escapeHTML(fmtMonth(sorted[idx].date))}</text>`;
    });

    // y labels (maxKwh)
    let yLabels = '';
    for(let g = 0; g <= 3; g++){
      const v = maxKwh * (1 - g/3);
      const y = padT + innerH * (g / 3);
      yLabels += `<text x="${padL - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6B7280" font-family="Inter, sans-serif">${fmtNum.format(v)}</text>`;
    }

    const dotsKwh = ptsKwh.map(([x,y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#0E5C5C" stroke="#fff" stroke-width="2"/><title>${escapeHTML(fmtDate(sorted[i].date))} · ${fmtNum.format(kwhs[i])} kWh · ₱${fmtPHP.format(bills[i])}</title>`).join('');
    const dotsBill = ptsBill.map(([x,y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#B8651B" opacity="0.85"/>`).join('');

    // area under kWh line
    const areaKwh = ptsKwh.length > 1
      ? `<path d="${path(ptsKwh)} L ${ptsKwh[ptsKwh.length-1][0].toFixed(1)} ${(padT + innerH).toFixed(1)} L ${ptsKwh[0][0].toFixed(1)} ${(padT + innerH).toFixed(1)} Z" fill="rgba(14,92,92,0.08)"/>`
      : '';

    host.innerHTML = `
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Usage trend chart">
        ${gridLines}
        ${areaKwh}
        <path d="${path(ptsKwh)}" fill="none" stroke="#0E5C5C" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${path(ptsBill)}" fill="none" stroke="#B8651B" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round" stroke-linejoin="round"/>
        ${dotsKwh}
        ${dotsBill}
        ${xLabels}
        ${yLabels}
        <text x="${padL - 36}" y="${padT - 4}" font-size="10" fill="#9CA3AF" font-family="Inter, sans-serif">kWh</text>
      </svg>
    `;
  }

  function render(){
    renderHistory();
    renderKPIs();
    renderChart();
  }

  // ---------- MODAL ----------
  let pendingDeleteId = null;
  let pendingClearAll = false;
  let pendingConfirm = null;
  function openModal(title, text, onConfirm){
    $('#modalTitle').textContent = title;
    $('#modalText').textContent = text;
    pendingConfirm = onConfirm;
    $('#modalBg').classList.add('open');
  }
  function closeModal(){
    $('#modalBg').classList.remove('open');
    pendingConfirm = null;
  }

  // ---------- EVENTS ----------
  function wire(){
    // form inputs live preview
    ['f_prev','f_curr','f_rate','f_other'].forEach(id => {
      $('#'+id).addEventListener('input', updatePreview);
    });

    // suggestion helpers
    const rateStored = (() => { try { return parseFloat(localStorage.getItem(RATE_KEY) || ''); } catch(_) { return NaN; } })();
    if(!isNaN(rateStored) && rateStored > 0) $('#f_rate').value = rateStored;

    autoFillFromLast();

    // initial preview
    updatePreview();

    // submit
    $('#calcForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      addEntry();
    });

    // reset
    $('#btnReset').addEventListener('click', () => {
      $('#calcForm').reset();
      $('#f_date').value = todayISO();
      $('#f_other').value = 0;
      setAutoPrevTag(false);
      updatePreview();
      toast('Form cleared');
    });

    // filter chips
    $$('.seg').forEach(b => {
      b.addEventListener('click', () => {
        $$('.seg').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        activeFilter = b.dataset.filter;
        renderHistory();
      });
    });

    // clear all
    $('#btnClearAll').addEventListener('click', () => {
      if(entries.length === 0){ toast('Nothing to clear'); return; }
      openModal('Clear all history?', 'This removes every saved reading from this browser. This cannot be undone.', () => {
        entries = [];
        persist();
        render();
        toast('All history cleared');
      });
    });

    // export
    $('#btnExport').addEventListener('click', () => {
      if(entries.length === 0){ toast('Nothing to export yet', true); return; }
      const payload = {
        exportedAt: new Date().toISOString(),
        count: entries.length,
        entries: entries,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kuryente-history-' + todayISO() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Exported as JSON');
    });

    // modal
    $('#modalCancel').addEventListener('click', closeModal);
    $('#modalOk').addEventListener('click', () => {
      const cb = pendingConfirm;
      closeModal();
      if(typeof cb === 'function') cb();
    });
    $('#modalBg').addEventListener('click', e => { if(e.target === e.currentTarget) closeModal(); });
    document.addEventListener('keydown', e => { if(e.key === 'Escape') closeModal(); });
  }

  // ---------- INIT ----------
  load();
  wire();
  // auto-set "auto" tag contextually based on previous value presence
  // (we'll keep it simple: show when prev was suggested from history)
  render();
})();
