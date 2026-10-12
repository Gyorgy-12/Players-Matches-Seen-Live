(() => {
  const data = JSON.parse(document.getElementById('statistics-data').textContent);
  const mode = document.body.dataset.statisticsMode;
  const columns = JSON.parse(document.getElementById('statistics-columns').textContent);
  const byId = id => document.getElementById(id);
  const controls = ['query', 'season', 'team', 'competition', 'match', 'sort', 'direction', 'minApps'];
  const form = byId('statistics-filters'), body = byId('statistics-rows');
  let page = 1, pageSize = 50, result = [];
  const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const exact = new Set(['apps', 'goalsAgainst', 'difference', 'wins', 'draws', 'losses']);
  if (mode === 'teams') exact.add('goals');
  function render() {
    const size = pageSize, pages = Math.max(1, Math.ceil(result.length / size));
    page = Math.min(page, pages);
    const start = (page - 1) * size;
    body.innerHTML = result.slice(start, start + size).map((r, index) => `<tr data-stat-id="${r.id}">${columns.map(([key, label]) => {
      let value;
      if (key === 'name') value = `<a href="https://www.transfermarkt.com/-/${mode === 'players' ? 'profil/spieler' : 'startseite/verein'}/${r.id}" target="_blank" rel="noopener"><strong>${escape(r.name)}</strong></a><span class="rank">#${start + index + 1}</span>`;
      else if (key === 'teams') value = `<span class="stat-teams">${r.teams.map(escape).join(' · ')}</span>`;
      else {
        const partial = !exact.has(key) && (mode === 'teams' ? r.unknown > 0 : r.missing[key] > 0);
        const unknown = mode === 'players' && r.missing[key] === r.apps;
        value = `<strong class="${key === byId('sort').value ? 'selected-metric' : ''}">${unknown ? '—' : r[key].toLocaleString('hu-HU')}${partial ? '<sup title="Hiányos meccsadat: ez a rögzített részösszeg">*</sup>' : ''}</strong>`;
      }
      return `<td data-label="${label}" data-metric="${key}">${value}</td>`;
    }).join('')}</tr>`).join('');
    byId('empty').hidden = result.length > 0;
    document.querySelectorAll('[data-page-status]').forEach(el => el.textContent = result.length ? `${start + 1}–${Math.min(start + size, result.length)} / ${result.length} ${mode === 'players' ? 'játékos' : 'csapat'}` : 'Nincs találat');
    document.querySelectorAll('[data-page-current]').forEach(el => el.textContent = page);
    document.querySelectorAll('[data-page-total]').forEach(el => el.textContent = pages);
    document.querySelectorAll('[data-page-action]').forEach(el => el.disabled = el.dataset.pageAction === 'prev' ? page === 1 : page === pages);
    document.querySelectorAll('[data-page-size]').forEach(el => el.value = String(pageSize));
  }
  function update() {
    const filters = Object.fromEntries(controls.map(id => [id, byId(id).value]));
    result = TMGHStatistics.aggregate(data, mode, filters); page = 1;
    byId('filter-summary').textContent = `${result.length} ${mode === 'players' ? 'játékos' : 'csapat'} · ${result.reduce((n, r) => n + r.apps, 0)} ${mode === 'players' ? 'pályára lépés' : 'csapatmeccs'} a szűrésben`;
    byId('partial-note').hidden = !result.some(r => r.unknown);
    render();
  }
  let pending;
  form.addEventListener('input', e => { if (!['query', 'minApps'].includes(e.target.id)) return; clearTimeout(pending); pending = setTimeout(update, 100); });
  form.addEventListener('change', () => { clearTimeout(pending); update(); });
  form.addEventListener('submit', e => e.preventDefault());
  byId('reset').addEventListener('click', () => { clearTimeout(pending); HTMLFormElement.prototype.reset.call(form); update(); });
  document.querySelectorAll('[data-page-size]').forEach(select => select.addEventListener('change', () => { pageSize = Number(select.value); page = 1; render(); }));
  document.querySelectorAll('[data-page-action]').forEach(button => button.addEventListener('click', () => {
    page += button.dataset.pageAction === 'next' ? 1 : -1; render();
    if (button.closest('.tmgh-pagination-bottom')) byId('statistics-table').scrollIntoView({ block: 'start' });
  }));
  const scroller = document.querySelector('.table-wrap');
  let drag = null, frame = 0, suppressClick = false;
  scroller.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || scroller.scrollWidth <= scroller.clientWidth) return;
    drag = { x: e.clientX, scroll: scroller.scrollLeft, pointer: e.pointerId, moved: false, next: scroller.scrollLeft };
    suppressClick = false; e.preventDefault();
  });
  window.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 5) return;
    if (!drag.moved) { drag.moved = true; scroller.setPointerCapture(e.pointerId); scroller.classList.add('is-dragging'); window.getSelection()?.removeAllRanges(); }
    drag.next = drag.scroll - dx;
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (drag) scroller.scrollLeft = drag.next; });
  });
  function endDrag() {
    if (!drag) return;
    if (frame) cancelAnimationFrame(frame); frame = 0;
    if (drag.moved) scroller.scrollLeft = drag.next;
    suppressClick = drag.moved;
    if (scroller.hasPointerCapture(drag.pointer)) scroller.releasePointerCapture(drag.pointer);
    drag = null; scroller.classList.remove('is-dragging');
  }
  window.addEventListener('pointerup', endDrag); window.addEventListener('pointercancel', endDrag); window.addEventListener('blur', endDrag);
  scroller.addEventListener('dragstart', e => e.preventDefault());
  scroller.addEventListener('selectstart', e => { if (drag) e.preventDefault(); });
  scroller.addEventListener('click', e => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; } }, true);
  update();
})();
