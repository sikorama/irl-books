(() => {
  // Page de statistiques. Elle porte le même en-tête que la bibliothèque : les
  // filtres décrivent une sélection de titres, et tout ce qui est plus bas — le
  // grand total, les jauges, chaque graphe — est recalculé sur cette sélection
  // seule. Un seul jeu de filtres pour toute la page, jamais un par graphe,
  // sinon deux chiffres de la même page finiraient par se contredire.

  const searchInput = document.getElementById('search');
  const libSelect = document.getElementById('library-filter');
  const genreSelect = document.getElementById('genre-filter');
  const flagInputs = [...document.querySelectorAll('.flag-filters input[data-flag]')];
  const cloudToggle = document.getElementById('cloud-toggle');
  const resetBtn = document.getElementById('reset-btn');
  const gridLink = document.getElementById('grid-link');
  const statusEl = document.getElementById('status');
  const emptyEl = document.getElementById('stats-empty');

  const heroFigure = document.getElementById('hero-figure');
  const heroNote = document.getElementById('hero-note');
  const kpiRow = document.getElementById('kpi-row');
  const coverageMeters = document.getElementById('coverage-meters');
  const chartsEl = document.getElementById('charts');
  const tooltipEl = document.getElementById('chart-tooltip');

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function uiLang() {
    return localStorage.getItem('irl-books:lang') || 'fr';
  }

  // --- Mise en forme --------------------------------------------------------

  const numberFmt = new Intl.NumberFormat('fr-FR');

  function fmtInt(n) {
    return numberFmt.format(Math.round(n || 0));
  }

  function fmtPct(part, whole) {
    if (!whole) return '—';
    return `${Math.round((part / whole) * 100)} %`;
  }

  function fmtBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
  }

  function plural(n, one, many) {
    return `${fmtInt(n)} ${n === 1 ? one : many}`;
  }

  // --- Utilitaires SVG -----------------------------------------------------

  function svgEl(name, attrs = {}) {
    const el = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }

  // Les intitulés viennent de la base : titres, noms d'auteurs, éditeurs saisis
  // à la main ou importés. Ils sont insérés en `textContent` — jamais concaténés
  // dans du HTML — parce qu'un « & » ou un chevron dans un nom d'éditeur ne doit
  // pas pouvoir devenir du balisage.
  function svgText(text, attrs = {}) {
    const el = svgEl('text', attrs);
    el.textContent = text;
    return el;
  }

  // Une barre a son extrémité côté valeur arrondie (4px) et reste carrée sur la
  // ligne de base : l'arrondi marque la fin de la donnée, la base est un axe.
  function barPath(x, y, w, h, r, dir) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    if (radius === 0) return `M${x} ${y}h${w}v${h}h${-w}Z`;
    if (dir === 'up') {
      return `M${x} ${y + h}V${y + radius}a${radius} ${radius} 0 0 1 ${radius} ${-radius}`
        + `h${w - 2 * radius}a${radius} ${radius} 0 0 1 ${radius} ${radius}V${y + h}Z`;
    }
    // dir === 'right'
    return `M${x} ${y}h${w - radius}a${radius} ${radius} 0 0 1 ${radius} ${radius}`
      + `v${h - 2 * radius}a${radius} ${radius} 0 0 1 ${-radius} ${radius}H${x}Z`;
  }

  // Mesure réelle du texte : c'est ce qui permet de réserver la gouttière des
  // intitulés au plus juste, et de ne poser une étiquette que si elle rentre.
  const measureCtx = document.createElement('canvas').getContext('2d');
  function textWidth(text, font) {
    measureCtx.font = font;
    return measureCtx.measureText(String(text)).width;
  }

  const AXIS_FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
  const VALUE_FONT = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';

  // Graduations sur des nombres ronds : 0 / 50 / 100, jamais 0 / 37 / 74.
  //
  // La dernière graduation est *toujours* supérieure ou égale au maximum, et
  // c'est elle qui borne l'échelle : sinon la plus grande barre dépasse le cadre
  // et son étiquette sort du graphe. Le pas est choisi parmi les multiples
  // habituels, en préférant celui qui laisse le moins de vide au-dessus des
  // données. Il reste entier, parce qu'un axe qui compte des titres n'a pas de
  // graduation à 1,5.
  function niceScale(max, preferred = 4) {
    if (!(max > 0)) return { top: 1, ticks: [0, 1] };
    const mag = 10 ** Math.floor(Math.log10(max / preferred));
    let best = null;
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20]) {
      const step = m * mag;
      if (!Number.isInteger(step)) continue;
      const count = Math.ceil(max / step);
      if (count < 2 || count > 6) continue;
      const score = (count * step - max) / max + Math.abs(count - preferred) * 0.05;
      if (!best || score < best.score) best = { step, count, score };
    }
    if (!best) {
      const step = Math.max(1, Math.ceil(max / preferred));
      best = { step, count: Math.ceil(max / step) };
    }
    const ticks = [];
    for (let i = 0; i <= best.count; i += 1) ticks.push(best.step * i);
    return { top: best.step * best.count, ticks };
  }

  // --- Infobulle -----------------------------------------------------------
  //
  // L'infobulle complète, elle ne conditionne rien : chaque valeur qu'elle
  // montre est aussi lisible sans souris, dans le tableau replié sous le graphe.

  let hideTimer = null;

  function showTooltip(rows, anchor) {
    clearTimeout(hideTimer);
    tooltipEl.textContent = '';
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'tt-row';
      if (row.keyed) {
        const key = document.createElement('span');
        key.className = 'tt-key';
        line.appendChild(key);
      }
      const value = document.createElement('span');
      value.className = 'tt-value';
      value.textContent = row.value;
      const label = document.createElement('span');
      label.className = 'tt-label';
      label.textContent = row.label;
      // La valeur d'abord : le lecteur sait déjà sur quelle barre il pointe,
      // c'est le nombre qu'il vient chercher.
      line.append(value, label);
      tooltipEl.appendChild(line);
    }
    tooltipEl.classList.remove('hidden');

    const box = tooltipEl.getBoundingClientRect();
    const margin = 8;
    let left = anchor.x - box.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
    let top = anchor.y - box.height - 12;
    if (top < margin) top = anchor.y + 18;
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  }

  function hideTooltip() {
    hideTimer = setTimeout(() => tooltipEl.classList.add('hidden'), 60);
  }

  // --- Graphe en colonnes (une série, un axe temporel) ---------------------

  function renderColumns(host, spec) {
    const width = Math.max(280, host.clientWidth);
    const items = spec.items;
    const padLeft = 44;
    const padRight = 10;
    const padTop = 26;
    const padBottom = 30;
    const plotH = 190;
    const height = plotH + padTop + padBottom;
    const plotW = width - padLeft - padRight;

    const svg = svgEl('svg', {
      width, height, viewBox: `0 0 ${width} ${height}`, class: 'chart-svg', role: 'img',
      'aria-label': spec.ariaLabel,
    });

    const { top, ticks } = niceScale(Math.max(...items.map((i) => i.count), 1));
    const yOf = (v) => padTop + plotH - (v / top) * plotH;

    for (const tick of ticks) {
      const y = yOf(tick);
      svg.appendChild(svgEl('line', {
        x1: padLeft, y1: y, x2: padLeft + plotW, y2: y,
        class: tick === 0 ? 'chart-baseline' : 'chart-grid',
      }));
      svg.appendChild(svgText(fmtInt(tick), {
        x: padLeft - 8, y: y + 4, class: 'chart-tick', 'text-anchor': 'end',
      }));
    }

    const band = plotW / items.length;
    const barW = Math.max(2, Math.min(24, band - 2));
    const bars = [];
    const maxIndex = items.reduce((best, item, i) => (item.count > items[best].count ? i : best), 0);

    items.forEach((item, i) => {
      const x = padLeft + i * band + (band - barW) / 2;
      const h = (item.count / top) * plotH;
      const y = padTop + plotH - h;
      const bar = svgEl('path', { d: barPath(x, y, barW, h, 4, 'up'), class: 'chart-mark' });
      svg.appendChild(bar);
      bars.push({ el: bar, item, cx: x + barW / 2, top: y });

      // Une seule étiquette directe, sur le sommet : un nombre au-dessus de
      // chaque colonne ne se lit pas, et l'axe plus l'infobulle portent le reste.
      if (i === maxIndex && item.count > 0) {
        svg.appendChild(svgText(fmtInt(item.count), {
          x: x + barW / 2, y: y - 7, class: 'chart-value', 'text-anchor': 'middle',
        }));
      }
    });

    // Étiquettes d'axe éclaircies jusqu'à ce qu'elles ne se chevauchent plus.
    // Ancrées sur la fin : le dernier pas est toujours étiqueté, la lecture
    // « jusqu'à aujourd'hui » est celle qui compte sur un axe de temps.
    const labelW = Math.max(...items.map((i) => textWidth(i.label, AXIS_FONT))) + 10;
    const step = Math.max(1, Math.ceil(labelW / band));
    const labelled = new Set();
    for (let i = items.length - 1; i >= 0; i -= step) labelled.add(i);
    // La barre de tête repliée n'est pas une période comme les autres : elle
    // porte toujours son intitulé, sinon « avant 1970 » se lirait comme 1970.
    // Les voisines trop proches cèdent la place plutôt que de se superposer.
    if (items[0] && items[0].folded) {
      for (let i = 1; i < step; i += 1) labelled.delete(i);
      labelled.add(0);
    }
    items.forEach((item, i) => {
      if (!labelled.has(i)) return;
      svg.appendChild(svgText(item.label, {
        x: padLeft + i * band + band / 2, y: padTop + plotH + 18,
        class: 'chart-axis-label', 'text-anchor': 'middle',
      }));
    });

    // Couche de survol unique : le lecteur vise une période, pas une colonne de
    // quelques pixels. Le curseur se cale sur la colonne la plus proche, au
    // clavier aussi (flèches gauche/droite).
    const overlay = svgEl('rect', {
      x: padLeft, y: padTop, width: plotW, height: plotH,
      class: 'chart-overlay', tabindex: 0, role: 'application',
      'aria-label': `${spec.ariaLabel} — arrow keys to read each value`,
    });
    let cursor = -1;

    function focusBar(index, clientPoint) {
      if (index < 0 || index >= bars.length) return;
      if (cursor >= 0 && bars[cursor]) bars[cursor].el.classList.remove('is-hovered');
      cursor = index;
      const bar = bars[index];
      bar.el.classList.add('is-hovered');
      const rect = svg.getBoundingClientRect();
      showTooltip(
        [{ label: bar.item.label, value: spec.tooltipValue(bar.item), keyed: false }],
        clientPoint || { x: rect.left + bar.cx, y: rect.top + bar.top },
      );
    }

    overlay.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const i = Math.floor((e.clientX - rect.left - padLeft) / band);
      focusBar(Math.max(0, Math.min(items.length - 1, i)), { x: e.clientX, y: e.clientY });
    });
    overlay.addEventListener('pointerleave', () => {
      if (cursor >= 0 && bars[cursor]) bars[cursor].el.classList.remove('is-hovered');
      cursor = -1;
      hideTooltip();
    });
    overlay.addEventListener('focus', () => focusBar(cursor < 0 ? items.length - 1 : cursor));
    overlay.addEventListener('blur', () => {
      if (cursor >= 0 && bars[cursor]) bars[cursor].el.classList.remove('is-hovered');
      cursor = -1;
      hideTooltip();
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const start = cursor < 0 ? items.length - 1 : cursor;
      focusBar(Math.max(0, Math.min(items.length - 1, start + (e.key === 'ArrowRight' ? 1 : -1))));
    });
    svg.appendChild(overlay);

    host.textContent = '';
    host.appendChild(svg);
  }

  // --- Graphe en barres horizontales (classements, noms longs) -------------

  function renderBars(host, spec) {
    const width = Math.max(280, host.clientWidth);
    const items = spec.items;
    const band = 26;
    const barH = 24;
    const padTop = 6;
    const padBottom = 26;
    const height = items.length * band + padTop + padBottom;

    // La gouttière des intitulés est mesurée, puis plafonnée : au-delà d'un tiers
    // de la largeur les barres n'auraient plus la place de se comparer, et les
    // noms trop longs sont abrégés — le nom entier reste dans l'infobulle et
    // dans le tableau.
    const valueGutter = Math.max(...items.map((i) => textWidth(fmtInt(i.count), VALUE_FONT))) + 12;
    const wanted = Math.max(...items.map((i) => textWidth(i.label, AXIS_FONT))) + 12;
    const padLeft = Math.min(wanted, Math.max(90, width * 0.34));
    const plotW = width - padLeft - valueGutter;

    const svg = svgEl('svg', {
      width, height, viewBox: `0 0 ${width} ${height}`, class: 'chart-svg', role: 'img',
      'aria-label': spec.ariaLabel,
    });

    const { top, ticks } = niceScale(Math.max(...items.map((i) => i.count), 1), 3);

    for (const tick of ticks) {
      const x = padLeft + (tick / top) * plotW;
      svg.appendChild(svgEl('line', {
        x1: x, y1: padTop, x2: x, y2: padTop + items.length * band,
        class: tick === 0 ? 'chart-baseline' : 'chart-grid',
      }));
      svg.appendChild(svgText(fmtInt(tick), {
        x, y: height - 8, class: 'chart-tick', 'text-anchor': tick === 0 ? 'start' : 'middle',
      }));
    }

    items.forEach((item, i) => {
      const y = padTop + i * band + (band - barH) / 2;
      const w = Math.max(1, (item.count / top) * plotW);

      let label = item.label;
      while (label.length > 4 && textWidth(label, AXIS_FONT) > padLeft - 12) {
        label = `${label.slice(0, -2)}…`;
      }
      svg.appendChild(svgText(label, {
        x: padLeft - 10, y: y + barH / 2 + 4, class: 'chart-axis-label', 'text-anchor': 'end',
      }));

      const bar = svgEl('path', { d: barPath(padLeft, y, w, barH, 4, 'right'), class: 'chart-mark' });
      svg.appendChild(bar);

      // Valeur au bout de la barre, à l'extérieur : elle ne peut donc jamais être
      // rognée par une barre trop courte.
      svg.appendChild(svgText(fmtInt(item.count), {
        x: padLeft + w + 6, y: y + barH / 2 + 4, class: 'chart-value', 'text-anchor': 'start',
      }));

      // Cible de survol sur toute la bande, pas sur les pixels peints : une barre
      // à une unité reste attrapable.
      const hit = svgEl('rect', {
        x: 0, y: padTop + i * band, width, height: band,
        class: 'chart-hit', tabindex: 0, role: 'img',
        'aria-label': `${item.label}: ${spec.tooltipValue(item)}`,
      });
      const enter = (point) => {
        bar.classList.add('is-hovered');
        showTooltip([{ label: item.label, value: spec.tooltipValue(item), keyed: false }], point);
      };
      const leave = () => { bar.classList.remove('is-hovered'); hideTooltip(); };
      hit.addEventListener('pointermove', (e) => enter({ x: e.clientX, y: e.clientY }));
      hit.addEventListener('pointerleave', leave);
      hit.addEventListener('focus', () => {
        const r = hit.getBoundingClientRect();
        enter({ x: r.left + r.width / 2, y: r.top });
      });
      hit.addEventListener('blur', leave);
      svg.appendChild(hit);
    });

    host.textContent = '';
    host.appendChild(svg);
  }

  // --- Carte de graphe -----------------------------------------------------
  //
  // Chaque graphe est doublé d'un tableau replié : c'est la version sans couleur
  // ni survol, qui rend toute valeur atteignable au clavier et à la lecture
  // d'écran. L'infobulle enrichit, elle ne conditionne rien.

  const registry = [];

  function chartCard(spec) {
    const card = document.createElement('section');
    card.className = 'chart-card';

    const title = document.createElement('h3');
    title.textContent = spec.title;
    card.appendChild(title);

    if (spec.note) {
      const note = document.createElement('p');
      note.className = 'chart-note';
      note.textContent = spec.note;
      card.appendChild(note);
    }

    if (spec.controls) card.appendChild(spec.controls);

    const plot = document.createElement('div');
    plot.className = 'chart-plot';
    card.appendChild(plot);

    const details = document.createElement('details');
    details.className = 'chart-table';
    const summary = document.createElement('summary');
    summary.textContent = `Table — ${spec.items.length} row${spec.items.length === 1 ? '' : 's'}`;
    details.appendChild(summary);

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const heading of [spec.dimensionName, 'Titles', 'Share']) {
      const th = document.createElement('th');
      th.textContent = heading;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const shareBase = spec.shareBase || spec.items.reduce((sum, i) => sum + i.count, 0);
    for (const item of spec.items) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.setAttribute('scope', 'row');
      th.textContent = item.label;
      const value = document.createElement('td');
      value.textContent = fmtInt(item.count);
      const share = document.createElement('td');
      share.textContent = fmtPct(item.count, shareBase);
      tr.append(th, value, share);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    details.appendChild(table);
    card.appendChild(details);

    const draw = () => (spec.kind === 'columns' ? renderColumns(plot, spec) : renderBars(plot, spec));
    registry.push(draw);
    chartsEl.appendChild(card);
    draw();
    return card;
  }

  // Un seul observateur pour toute la page : les graphes sont dessinés en pixels
  // réels plutôt qu'étirés par le navigateur, donc ils sont redessinés quand la
  // largeur change — c'est ce qui garde le texte net et la géométrie juste.
  let resizeTimer = null;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => registry.forEach((draw) => draw()), 120);
  }).observe(chartsEl);

  // --- Jauges et tuiles ----------------------------------------------------

  function statTile(label, value, note) {
    const tile = document.createElement('div');
    tile.className = 'stat-tile';
    const l = document.createElement('p');
    l.className = 'stat-label';
    l.textContent = label;
    const v = document.createElement('p');
    v.className = 'stat-value';
    v.textContent = value;
    tile.append(l, v);
    if (note) {
      const n = document.createElement('p');
      n.className = 'stat-note';
      n.textContent = note;
      tile.appendChild(n);
    }
    return tile;
  }

  function meterRow(label, part, whole) {
    const row = document.createElement('div');
    row.className = 'meter-row';

    const head = document.createElement('div');
    head.className = 'meter-head';
    const name = document.createElement('span');
    name.className = 'meter-label';
    name.textContent = label;
    const value = document.createElement('span');
    value.className = 'meter-value';
    value.textContent = `${fmtPct(part, whole)} · ${fmtInt(part)}/${fmtInt(whole)}`;
    head.append(name, value);

    const track = document.createElement('div');
    // La piste est une nuance claire de la même teinte que le remplissage : l'état
    // se lit sur toute la longueur, pas seulement sur la partie remplie.
    track.className = 'meter-track';
    const fill = document.createElement('div');
    fill.className = 'meter-fill';
    fill.style.width = whole ? `${(part / whole) * 100}%` : '0%';
    track.appendChild(fill);

    row.append(head, track);
    return row;
  }

  // --- Découpage de l'axe des années --------------------------------------
  //
  // Un axe de temps doit rester continu : une décennie vide est un trou, pas une
  // barre qu'on saute. Mais ce catalogue contient une édition de 1492 pour
  // 923 titres datés — telle quelle, l'échelle irait de 1490 à 2010 et écraserait
  // tout le corpus dans son dernier dixième. Les tranches de tête sont donc
  // repliées dans une seule barre « avant AAAA », tant qu'elles pèsent moins de
  // 2 % des titres datés : le graphe garde sa forme et le compte reste juste,
  // parce que la barre repliée est étiquetée pour ce qu'elle est.
  function buildTimeline(yearItems, granularity) {
    const size = granularity === 'decade' ? 10 : 1;
    const buckets = new Map();
    let total = 0;
    for (const item of yearItems) {
      const year = Number(item.key);
      if (!Number.isFinite(year)) continue;
      const bucket = Math.floor(year / size) * size;
      buckets.set(bucket, (buckets.get(bucket) || 0) + item.count);
      total += item.count;
    }
    if (!buckets.size) return { items: [], folded: 0, foldedUpTo: null };

    const keys = [...buckets.keys()].sort((a, b) => a - b);
    const last = keys[keys.length - 1];
    const maxSlots = granularity === 'decade' ? 14 : 40;
    const foldBudget = total * 0.02;

    let start = keys[0];
    let folded = 0;
    let index = 0;
    while (index < keys.length - 1) {
      const slots = (last - start) / size + 1;
      if (slots <= maxSlots) break;
      const next = buckets.get(keys[index]) || 0;
      if (folded + next > foldBudget) break;
      folded += next;
      index += 1;
      start = keys[index];
    }

    const items = [];
    if (folded > 0) {
      items.push({
        key: `<${start}`,
        label: `< ${start}`,
        count: folded,
        folded: true,
      });
    }
    for (let bucket = start; bucket <= last; bucket += size) {
      items.push({
        key: String(bucket),
        label: granularity === 'decade' ? `${bucket}s` : String(bucket),
        count: buckets.get(bucket) || 0,
      });
    }
    return { items, folded, foldedUpTo: folded > 0 ? start : null, total };
  }

  // --- Filtres -------------------------------------------------------------

  function buildQuery() {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
    if (libSelect.value) params.set('library', libSelect.value);
    if (genreSelect.value) params.set('genre', genreSelect.value);
    // Comme dans la bibliothèque : les documents numériques ne comptent que si
    // on les demande, sinon les statistiques porteraient sur un ensemble plus
    // large que la grille d'où l'on vient.
    if (cloudToggle.checked) params.set('cloud', '1');
    for (const input of flagInputs) {
      if (input.checked) params.set(input.dataset.flag, '1');
    }
    return params;
  }

  function describeFilters() {
    const bits = [];
    if (searchInput.value.trim()) bits.push(`matching “${searchInput.value.trim()}”`);
    if (libSelect.value) bits.push(`in ${libSelect.value}`);
    if (genreSelect.value) {
      const opt = genreSelect.selectedOptions[0];
      bits.push(`categorized as ${opt ? opt.textContent.replace(/\s*\(\d+\)$/, '') : genreSelect.value}`);
    }
    if (cloudToggle.checked) bits.push('cloud documents included');
    for (const input of flagInputs) {
      if (input.checked) bits.push({ no_cover: 'without a cover', no_isbn: 'without an ISBN' }[input.dataset.flag]);
    }
    return bits.join(', ');
  }

  // Les filtres vivent dans l'URL, donc une sélection intéressante se met en
  // favori et se partage. Ils ne sont pas écrits dans le stockage local de la
  // bibliothèque : régler un filtre ici ne doit pas déplacer la pièce courante,
  // qui décide où les prochains livres seront rangés.
  function syncUrl() {
    const params = buildQuery();
    const qs = params.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
    gridLink.href = qs ? `/index.html?${qs}` : '/index.html';
  }

  function readUrl() {
    const params = new URLSearchParams(location.search);
    searchInput.value = params.get('q') || '';
    for (const input of flagInputs) input.checked = params.get(input.dataset.flag) === '1';
    const library = params.get('library') || '';
    cloudToggle.checked = params.get('cloud') === '1' || library === 'cloud';
    return { library, genre: params.get('genre') || '' };
  }

  async function loadFilterOptions(wanted) {
    const [libsRes, genresRes] = await Promise.all([
      fetch('/api/libraries'),
      fetch(`/api/genres?lang=${encodeURIComponent(uiLang())}`),
    ]);
    const libs = await libsRes.json();
    const genreData = await genresRes.json();

    for (const lib of libs) {
      if (!lib.name) continue;
      const opt = document.createElement('option');
      opt.value = lib.name;
      opt.textContent = `${lib.name} (${lib.count})`;
      libSelect.appendChild(opt);
    }

    for (const g of genreData.genres) {
      const opt = document.createElement('option');
      opt.value = g.value;
      opt.textContent = `${g.label} (${g.count})`;
      genreSelect.appendChild(opt);
    }
    const none = document.createElement('option');
    none.value = '(aucun)';
    none.textContent = `No genre (${genreData.no_genre_count})`;
    genreSelect.appendChild(none);

    // Un filtre venu de l'URL qui ne figure pas dans la liste est honoré quand
    // même : une pièce vide — le cloud sans document, par exemple — n'apparaît
    // pas dans le catalogue des pièces, et sans cela `?library=cloud` retomberait
    // silencieusement sur « toutes les pièces », c'est-à-dire sur des chiffres
    // qui ne sont pas ceux qu'on a demandés.
    for (const [select, value] of [[libSelect, wanted.library], [genreSelect, wanted.genre]]) {
      if (!value) continue;
      select.value = value;
      if (select.value !== value) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = `${value} (0)`;
        select.appendChild(opt);
        select.value = value;
      }
    }
  }

  // --- Rendu ---------------------------------------------------------------

  let timelineGranularity = 'decade';

  function renderCharts(stats) {
    chartsEl.textContent = '';
    registry.length = 0;

    const total = stats.total;

    // 1. Le temps. Le graphe demandé « nombre de livres par année » : par décennie
    //    par défaut parce que c'est là que la forme du fonds se voit, avec l'année
    //    exacte à un clic.
    // Une seule barre n'est pas un graphe : c'est le total, déjà affiché en haut
    // de la page. Chaque carte exige donc de quoi comparer — au moins deux
    // périodes ici, au moins deux parts pour une composition, et pour un
    // classement un premier qui dépasse réellement les suivants.
    const timeline = buildTimeline(stats.by_year.items, timelineGranularity);
    if (timeline.items.length > 1) {
      const controls = document.createElement('div');
      controls.className = 'chart-controls';
      for (const [value, label] of [['decade', 'By decade'], ['year', 'By year']]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `secondary chart-toggle${timelineGranularity === value ? ' active' : ''}`;
        btn.textContent = label;
        btn.setAttribute('aria-pressed', String(timelineGranularity === value));
        btn.addEventListener('click', () => {
          if (timelineGranularity === value) return;
          timelineGranularity = value;
          renderCharts(stats);
        });
        controls.appendChild(btn);
      }

      const notes = [];
      if (stats.by_year.unknown > 0) notes.push(`Left out — no year recorded: ${plural(stats.by_year.unknown, 'title', 'titles')}.`);
      if (timeline.folded > 0) {
        notes.push(`The first bar gathers ${plural(timeline.folded, 'title', 'titles')} published before ${timeline.foldedUpTo}, which would otherwise stretch the axis over empty centuries.`);
      }

      chartCard({
        kind: 'columns',
        title: timelineGranularity === 'decade' ? 'Titles per decade of publication' : 'Titles per year of publication',
        note: notes.join(' '),
        controls,
        items: timeline.items,
        dimensionName: timelineGranularity === 'decade' ? 'Decade' : 'Year',
        shareBase: timeline.total,
        ariaLabel: 'Titles per period of publication',
        tooltipValue: (item) => plural(item.count, 'title', 'titles'),
      });
    }

    // 2. Les catégories, l'autre graphe demandé.
    const genreItems = [...stats.by_genre.items];
    if (stats.by_genre.unknown > 0) genreItems.push({ key: '(none)', label: 'No category', count: stats.by_genre.unknown });
    if (genreItems.length > 1) {
      const items = genreItems;
      chartCard({
        kind: 'bars',
        title: 'Titles per category',
        note: `${stats.by_genre.distinct} categor${stats.by_genre.distinct === 1 ? 'y' : 'ies'} in this selection.`,
        items,
        dimensionName: 'Category',
        shareBase: total,
        ariaLabel: 'Titles per category',
        tooltipValue: (item) => `${plural(item.count, 'title', 'titles')} · ${fmtPct(item.count, total)}`,
      });
    }

    // 3. Les pièces — seulement quand la sélection en contient plusieurs : une
    //    barre unique n'est pas un graphe, c'est le total déjà affiché en haut.
    if (stats.by_room.items.length > 1) {
      chartCard({
        kind: 'bars',
        title: 'Titles per room',
        note: 'Where these titles physically live. The cloud is a room like any other — its documents are counted here too.',
        items: stats.by_room.items,
        dimensionName: 'Room',
        shareBase: total,
        ariaLabel: 'Titles per room',
        tooltipValue: (item) => `${plural(item.count, 'title', 'titles')} · ${fmtPct(item.count, total)}`,
      });
    }

    // 4. Éditeurs. Un classement où tout le monde est à égalité ne classe rien :
    //    il faut un premier qui dépasse.
    const ranks = (stats) => stats.items.length > 1 && stats.items[0].count > 1;
    if (ranks(stats.by_publisher)) {
      const notes = [`${stats.by_publisher.distinct} distinct publishers.`];
      if (stats.by_publisher.other > 0) notes.push(`Outside this top 12: ${plural(stats.by_publisher.other, 'title', 'titles')} across ${fmtInt(stats.by_publisher.distinct - stats.by_publisher.items.length)} more publishers.`);
      if (stats.by_publisher.unknown > 0) notes.push(`No publisher named: ${plural(stats.by_publisher.unknown, 'title', 'titles')}.`);
      chartCard({
        kind: 'bars',
        title: 'Top publishers',
        note: notes.join(' '),
        items: stats.by_publisher.items,
        dimensionName: 'Publisher',
        shareBase: total,
        ariaLabel: 'Titles per publisher, top 12',
        tooltipValue: (item) => `${plural(item.count, 'title', 'titles')} · ${fmtPct(item.count, total)}`,
      });
    }

    // 5. Auteurs récurrents. Un classement où tout le monde est à un titre ne
    //    classe rien : seuls les auteurs présents plusieurs fois sont tracés.
    const recurring = stats.by_author.items.filter((item) => item.count > 1);
    if (recurring.length > 1) {
      chartCard({
        kind: 'bars',
        title: 'Recurring authors',
        note: `Authors with more than one title in this selection, out of ${fmtInt(stats.by_author.distinct)} named in all. A title with several authors counts for each of them.`,
        items: recurring,
        dimensionName: 'Author',
        shareBase: total,
        ariaLabel: 'Titles per recurring author',
        tooltipValue: (item) => plural(item.count, 'title', 'titles'),
      });
    }

    // 6. Langues, étiquettes, formats : présents dans la collection numérique,
    //    absents des fiches papier. Chaque graphe n'apparaît donc que si la
    //    sélection porte réellement la donnée — une carte vide n'informe pas.
    if (stats.by_language.items.length > 1) {
      chartCard({
        kind: 'bars',
        title: 'Titles per language',
        note: stats.by_language.unknown > 0 ? `No language recorded: ${plural(stats.by_language.unknown, 'title', 'titles')}.` : '',
        items: stats.by_language.items,
        dimensionName: 'Language',
        shareBase: total,
        ariaLabel: 'Titles per language',
        tooltipValue: (item) => `${plural(item.count, 'title', 'titles')} · ${fmtPct(item.count, total)}`,
      });
    }

    if (ranks(stats.by_tag)) {
      const notes = [`${fmtInt(stats.by_tag.distinct)} distinct tags. A title carrying several tags counts for each.`];
      if (stats.by_tag.unknown > 0) notes.push(`No tag: ${plural(stats.by_tag.unknown, 'title', 'titles')}.`);
      chartCard({
        kind: 'bars',
        title: 'Most used tags',
        note: notes.join(' '),
        items: stats.by_tag.items,
        dimensionName: 'Tag',
        shareBase: total,
        ariaLabel: 'Titles per tag, top 12',
        tooltipValue: (item) => plural(item.count, 'title', 'titles'),
      });
    }

    if (stats.by_format.items.length > 1) {
      chartCard({
        kind: 'bars',
        title: 'Documents per file format',
        note: 'Cloud documents only — a paper record has no file.',
        items: stats.by_format.items,
        dimensionName: 'Format',
        shareBase: stats.documents,
        ariaLabel: 'Documents per file format',
        tooltipValue: (item) => `${plural(item.count, 'document', 'documents')} · ${fmtPct(item.count, stats.documents)}`,
      });
    }

    // 7. Notes. La colonne existe dans les deux tables mais n'est renseignée que
    //    sur une partie du fonds : sans note non nulle, le graphe ne dirait rien.
    const rated = stats.by_rating.items.filter((item) => Number(item.key) > 0);
    if (rated.length) {
      chartCard({
        kind: 'columns',
        title: 'Titles per rating',
        note: `Rated: ${plural(rated.reduce((s, i) => s + i.count, 0), 'title', 'titles')} out of ${fmtInt(total)}.`,
        items: rated.map((item) => ({ ...item, label: '★'.repeat(Number(item.key)) })),
        dimensionName: 'Rating',
        ariaLabel: 'Titles per rating',
        tooltipValue: (item) => plural(item.count, 'title', 'titles'),
      });
    }

    // Une sélection trop étroite ne remplit aucune carte. Le dire est utile :
    // sans ce mot, la page paraîtrait cassée alors qu'elle est simplement à
    // court de matière à comparer.
    if (!chartsEl.children.length) {
      const note = document.createElement('p');
      note.className = 'stats-thin';
      note.textContent = 'Too few titles here to draw a meaningful chart — the figures above cover this selection. Widen the filters to get the breakdowns.';
      chartsEl.appendChild(note);
    }
  }

  function renderSummary(stats) {
    const total = stats.total;
    heroFigure.textContent = fmtInt(total);

    const scope = describeFilters();
    heroNote.textContent = scope
      ? `Filtered: ${scope}.`
      : 'The whole catalogue — no filter applied.';

    kpiRow.textContent = '';
    kpiRow.appendChild(statTile('Paper records', fmtInt(stats.books), stats.books ? fmtPct(stats.books, total) : ''));
    kpiRow.appendChild(statTile('Cloud documents', fmtInt(stats.documents), stats.documents ? fmtPct(stats.documents, total) : ''));
    kpiRow.appendChild(statTile('Categories used', fmtInt(stats.by_genre.distinct), `${fmtInt(stats.by_genre.unknown)} uncategorized`));
    kpiRow.appendChild(statTile('Distinct authors', fmtInt(stats.by_author.distinct)));
    kpiRow.appendChild(statTile('Publishers', fmtInt(stats.by_publisher.distinct)));
    if (stats.coverage.loaned > 0) {
      kpiRow.appendChild(statTile('Loaned out', fmtInt(stats.coverage.loaned)));
    }
    if (stats.pages > 0) {
      kpiRow.appendChild(statTile('Pages in the cloud', fmtInt(stats.pages), fmtBytes(stats.bytes)));
    }

    coverageMeters.textContent = '';
    coverageMeters.appendChild(meterRow('Has a cover', stats.coverage.with_cover, total));
    coverageMeters.appendChild(meterRow('Has an author', stats.coverage.with_author, total));
    coverageMeters.appendChild(meterRow('Has a category', stats.coverage.with_genre, total));
    coverageMeters.appendChild(meterRow('Has a publication year', stats.coverage.with_year, total));
    coverageMeters.appendChild(meterRow('Has an ISBN', stats.coverage.with_isbn, total));
  }

  let inFlight = 0;

  async function load() {
    syncUrl();
    const token = ++inFlight;
    const params = buildQuery();
    params.set('lang', uiLang());
    // Pendant le rechargement la page garde son rendu, en retrait : pas de
    // squelette qui clignote, pas de saut de mise en page.
    document.body.classList.add('is-loading');
    statusEl.textContent = 'Computing…';
    try {
      const res = await fetch(`/api/stats?${params.toString()}`);
      const stats = await res.json();
      if (token !== inFlight) return;
      if (!res.ok) throw new Error(stats.error || `HTTP ${res.status}`);

      emptyEl.classList.toggle('hidden', stats.total > 0);
      document.querySelector('.stats-hero').classList.toggle('hidden', stats.total === 0);
      document.querySelector('.kpi-row').classList.toggle('hidden', stats.total === 0);
      document.querySelector('.stats-section').classList.toggle('hidden', stats.total === 0);

      if (stats.total === 0) {
        chartsEl.textContent = '';
        registry.length = 0;
        statusEl.textContent = '0 title';
        return;
      }

      renderSummary(stats);
      renderCharts(stats);
      statusEl.textContent = `${plural(stats.total, 'title', 'titles')} in this selection`;
    } catch (e) {
      if (token === inFlight) statusEl.textContent = `Error: ${e.message}`;
    } finally {
      if (token === inFlight) document.body.classList.remove('is-loading');
    }
  }

  let debounceTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(load, 250);
  });
  libSelect.addEventListener('change', () => {
    if (libSelect.value === 'cloud') cloudToggle.checked = true;
    load();
  });
  cloudToggle.addEventListener('change', () => {
    if (!cloudToggle.checked && libSelect.value === 'cloud') libSelect.value = '';
    load();
  });
  genreSelect.addEventListener('change', load);
  for (const input of flagInputs) input.addEventListener('change', load);

  resetBtn.addEventListener('click', () => {
    searchInput.value = '';
    libSelect.value = '';
    genreSelect.value = '';
    for (const input of flagInputs) input.checked = false;
    cloudToggle.checked = false;
    load();
  });

  (async () => {
    const wanted = readUrl();
    await loadFilterOptions(wanted);
    await load();
  })();
})();
