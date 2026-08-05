(() => {
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
