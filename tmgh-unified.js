(() => {
  const h2hValues = () => ({ h2hA: document.getElementById('h2h-a')?.value || '', h2hB: document.getElementById('h2h-b')?.value || '' });
  window.TMGHH2H = {
    values: h2hValues,
    matches(row) {
      const { h2hA: a, h2hB: b } = h2hValues();
      return !a || !b || (a !== b &&
        ((row.dataset.h2hHome === a && row.dataset.h2hAway === b) ||
         (row.dataset.h2hHome === b && row.dataset.h2hAway === a)));
    }
  };
  const initH2H = () => {
    const first = document.getElementById('h2h-a'), second = document.getElementById('h2h-b');
    if (!first || !second) return;
    const help = document.getElementById('h2h-help');
    const updateHelp = () => {
      help.textContent = first.value && second.value
        ? first.value === second.value ? 'Válassz két különböző csapatot.' : 'Csak a két csapat egymás elleni, általad látott meccsei. A többi szűrő is érvényes.'
        : 'Válassz két csapatot. A hazai–vendég sorrend nem számít; a többi szűrő is érvényes.';
    };
    const reapply = () => {
      updateHelp();
      // Reuse each mode's own filtering, summary, sorting and pagination.
      document.querySelector('#filter-season, #season-filter, #season')?.dispatchEvent(new Event('change', { bubbles: true }));
    };
    first.addEventListener('change', reapply);
    second.addEventListener('change', reapply);
    const searches = [first, second].map(select => {
      const input = document.getElementById(select.id + '-search');
      const status = document.getElementById(select.id + '-search-status');
      const options = [...select.options].map(option => ({ value: option.value, label: option.textContent }));
      const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('hu').replace(/ø/g, 'o').replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
      const filter = () => {
        const query = normalize(input.value), selected = select.value;
        const matches = options.filter(option => option.value && normalize(option.label).includes(query));
        // Keep the selected team until the user explicitly changes it. Typing
        // narrows the choices but must not silently change the match filter.
        const visible = options.filter(option => !option.value || option.value === selected || matches.some(match => match.value === option.value));
        select.replaceChildren(...visible.map(option => new Option(option.label, option.value, false, option.value === selected)));
        status.textContent = query ? matches.length ? `${matches.length} találat` : 'Nincs ilyen csapat' : '';
      };
      input.addEventListener('input', filter);
      input.addEventListener('search', filter);
      select.addEventListener('change', filter);
      return { input, filter };
    });
    const clear = () => {
      first.value = ''; second.value = '';
      for (const search of searches) { search.input.value = ''; search.filter(); }
      updateHelp();
    };
    document.addEventListener('click', event => {
      if (event.target.closest('#reset, #reset-filters, #filter-reset')) clear();
    }, true);
    document.addEventListener('reset', clear, true);
  };
  const penaltyShootouts = new Map([
    ['4897219', { matchScore:'0:0', shootoutScore:'2:4' }],
    ['4568309', { matchScore:'1:1', shootoutScore:'5:3' }]
  ]);

  const matchIdFromLink = (link) => {
    const href = link?.getAttribute('href') || '';
    return href.match(/spielbericht\/(\d+)/)?.[1] || '';
  };

  const decorateMatchCells = () => {
    document.querySelectorAll('tbody td a[href*="spielbericht/"]').forEach((link) => {
      const title =
        link.querySelector(':scope > .match-title') ||
        link.querySelector(':scope > strong') ||
        link;

      if (!title.querySelector('.tmgh-team-separator')) {
        const teams = title.textContent.trim().split(/\s+-\s+/);
        if (teams.length === 2) {
          const homeTeam = document.createElement('span');
          homeTeam.className = 'tmgh-team-name tmgh-home-team';
          homeTeam.textContent = teams[0];

          const separator = document.createElement('span');
          separator.className = 'tmgh-team-separator';
          separator.textContent = '–';

          const awayTeam = document.createElement('span');
          awayTeam.className = 'tmgh-team-name tmgh-away-team';
          awayTeam.textContent = teams[1];

          title.replaceChildren(homeTeam, separator, awayTeam);
          title.classList.add('tmgh-match-title');
          link.classList.add('tmgh-match-link');
        }
      }

      const matchId = matchIdFromLink(link);
      const shootout = penaltyShootouts.get(matchId);
      if (!shootout) return;

      const cell = link.closest('td');
      const score = link.querySelector('.score') || cell?.querySelector(':scope > .score');
      if (!score || score.classList.contains('tmgh-penalty-score')) return;

      const value = document.createElement('span');
      value.className = 'tmgh-score-value';
      value.textContent = shootout.matchScore;

      const note = document.createElement('span');
      note.className = 'tmgh-score-note';
      note.textContent = `11-esek ${shootout.shootoutScore}`;

      score.replaceChildren(value, note);
      score.classList.add('tmgh-penalty-score');
      score.setAttribute(
        'aria-label',
        `Mérkőzés: ${shootout.matchScore}. Tizenegyespárbaj: ${shootout.shootoutScore}`
      );
      score.title = `Rendes játékidő és hosszabbítás: ${shootout.matchScore} · 11-esek: ${shootout.shootoutScore}`;
      cell?.classList.add('tmgh-shootout-match');

      const goals = shootout.matchScore
        .split(':')
        .reduce((total, part) => total + Number(part || 0), 0);
      const row = cell?.closest('tr');
      if (row?.hasAttribute('data-goals')) row.dataset.goals = String(goals);
    });
  };

  const cleanCurrentStatusLabels = () => {
    initH2H();
    const table = document.querySelector('table:not(.statistics-table)');
    if (table) {
      const body = table.tBodies[0];
      const updateRanks = () => {
        const page = Number(document.querySelector('[data-page-current]')?.textContent) || 1;
        const size = Number(document.querySelector('[data-page-size]')?.value) || 50;
        let rank = (page - 1) * size;
        for (const row of body?.rows || []) {
          if (row.hidden || row.classList.contains('hidden') || row.style.display === 'none') continue;
          let cell = row.querySelector('.tmgh-rank');
          if (!cell) {
            cell = document.createElement('span'); cell.className = 'rank tmgh-rank';
            row.cells[0].append(cell);
          }
          const value = '#' + (++rank);
          if (cell.textContent !== value) cell.textContent = value;
        }
        for (const cell of table.querySelectorAll('td[data-label="Nézőszám"]')) {
          const value = Number(cell.closest('tr').dataset.attendance);
          if (!Number.isFinite(value) || cell.closest('tr').dataset.attendanceKnown !== '1') continue;
          const content = cell.querySelector('strong, .value') || cell;
          const formatted = value.toLocaleString('hu-HU', { useGrouping: 'always' });
          if (content.textContent !== formatted) content.textContent = formatted;
        }
      };
      let pending = false;
      const scheduleRanks = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; updateRanks(); });
      };
      new MutationObserver(changes => {
        if (changes.some(m => m.type === 'attributes' ||
          [...m.addedNodes, ...m.removedNodes].some(n => n.nodeName === 'TR') ||
          m.target.parentElement?.closest('[data-page-current], [data-page-status]'))) scheduleRanks();
      }).observe(table.closest('.table-card') || table.parentElement, {
        subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class']
      });
      document.addEventListener('input', scheduleRanks);
      document.addEventListener('change', scheduleRanks);
      updateRanks();
    }
    document.querySelectorAll('.current-status').forEach((label) => label.remove());

    document.querySelectorAll('th').forEach((header) => {
      if (header.textContent.trim() === 'Mostani klub / státusz') {
        header.textContent = 'Mostani klub';
      }
    });

    document.querySelectorAll('td[data-label="Mostani klub / státusz"]').forEach((cell) => {
      cell.dataset.label = 'Mostani klub';
    });

    decorateMatchCells();

    const filterCard = document.querySelector('.filter-card');
    if (filterCard && !document.querySelector('.tmgh-filter-jump')) {
      const jumpButton = document.createElement('button');
      jumpButton.type = 'button';
      jumpButton.className = 'tmgh-filter-jump';
      jumpButton.innerHTML = '<span aria-hidden="true">↑</span><span>Szűrőkhöz</span>';
      jumpButton.setAttribute('aria-label', 'Ugrás vissza a szűrőkhöz');
      jumpButton.setAttribute('aria-hidden', 'true');
      document.body.appendChild(jumpButton);

      jumpButton.addEventListener('click', () => {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        filterCard.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'start'
        });
      });

      let ticking = false;
      const updateJumpButton = () => {
        const filtersAreAboveViewport = filterCard.getBoundingClientRect().bottom < 72;
        jumpButton.classList.toggle('is-visible', filtersAreAboveViewport);
        jumpButton.setAttribute('aria-hidden', filtersAreAboveViewport ? 'false' : 'true');
        ticking = false;
      };
      const scheduleUpdate = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(updateJumpButton);
      };

      window.addEventListener('scroll', scheduleUpdate, { passive:true });
      window.addEventListener('resize', scheduleUpdate, { passive:true });
      updateJumpButton();
    }

    document.documentElement.classList.add('tmgh-ui-ready');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cleanCurrentStatusLabels, { once:true });
  } else {
    cleanCurrentStatusLabels();
  }
})();
