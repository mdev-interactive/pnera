/* =============================================================================
   PNERA — mapa interativo de circulos proporcionais (maps-interativo.html)

   O painel principal tem um coropletico por UF: responde "quais estados", mas
   achata tudo dentro do estado. Aqui o simbolo e o municipio — 246 pontos,
   coordenada vinda do centroide da malha do IBGE (assets/js/municipio-coords.js).

   Duas series sobrepostas, como no mapa de referencia do Atlas da Questao
   Agraria: matriculados (verde) e cursos (terracota).

   ATENCAO — esta e a UNICA pagina do projeto que depende de internet: os tiles
   vem do OpenStreetMap. Sem rede a pagina abre e tudo funciona; so o fundo fica
   vazio, e um aviso aparece abaixo do mapa.

   Reaproveita window.PNERA (assets/js/data.js) para formatacao, dobra de acentos
   e busca textual. O estado dos filtros e proprio desta pagina.
   ========================================================================== */

(function () {
  'use strict';

  const P = window.PNERA;
  const COORDS = window.MUNICIPIO_COORDS || {};
  const { int, compact, fold, haystack } = P;

  const $ = (sel, raiz = document) => raiz.querySelector(sel);

  /* ------------------------------------------------------------- tokens ----- */

  /** Le a paleta do CSS: a cor nunca e escrita duas vezes no projeto. */
  const css = getComputedStyle(document.documentElement);
  const token = (nome, fallback) => (css.getPropertyValue(nome).trim() || fallback);

  const T = {
    matriculados: token('--series-1', '#2E7D32'),
    cursos: token('--series-4', '#B4552F'),
    surface: token('--surface', '#FBFAF6'),
  };

  /* ------------------------------------------------------------- series ----- */

  /**
   * As duas medidas plotadas. `valor` le o agregado do municipio; `base` diz
   * quantos cursos daquele municipio tinham o dado — ausencia nunca vira zero.
   */
  const SERIES = [
    {
      id: 'matriculados',
      rotulo: 'Matriculados',
      cor: T.matriculados,
      paneZ: 411,
      valor: (m) => m.matriculados,
      base: (m) => m.matriculadosBase,
    },
    {
      id: 'cursos',
      rotulo: 'Cursos',
      cor: T.cursos,
      paneZ: 410,
      valor: (m) => m.cursos,
      base: (m) => m.cursos,
    },
  ];

  /** Raio em pixels. AREA proporcional ao valor — por isso a raiz quadrada. */
  const R_MIN = 3;
  const R_MAX = 30;
  const raio = (v, max) => (!v || !max ? 0 : R_MIN + (R_MAX - R_MIN) * Math.sqrt(v / max));

  /* -------------------------------------------------------------- estado ---- */

  const ANO_MIN = P.meta.periodo?.anoMin ?? 1998;
  const ANO_MAX = P.meta.periodo?.anoInicioMax ?? 2026;

  /** Dimensoes filtraveis nesta pagina — o recorte enxuto que o mapa pede. */
  const GRUPOS = [
    { dim: 'fase', aberto: true },
    { dim: 'areaTematica', aberto: true },
    { dim: 'nivel', aberto: false },
    { dim: 'macrorregiao', aberto: true },
    { dim: 'uf', aberto: false, busca: true },
  ];
  const DIMS = GRUPOS.map((g) => g.dim);

  const estado = {
    dims: Object.fromEntries(DIMS.map((d) => [d, new Set()])),
    anoDe: ANO_MIN,
    anoAte: ANO_MAX,
    busca: '',
    camadas: new Set(SERIES.map((s) => s.id)),
  };

  /* ------------------------------------------------------------ recorte ----- */

  function recorte() {
    const termo = fold(estado.busca);
    return P.data.filter((c) => {
      for (const dim of DIMS) {
        const escolhidos = estado.dims[dim];
        if (!escolhidos.size) continue;
        const v = P.DIMENSOES[dim].get(c);
        const lista = Array.isArray(v) ? v : [v];
        if (!lista.some((x) => escolhidos.has(x))) return false;
      }
      // Cursos sem ano de inicio (11 na fonte) so somem quando a faixa e apertada.
      if (estado.anoDe > ANO_MIN || estado.anoAte < ANO_MAX) {
        if (c.anoInicio == null || c.anoInicio < estado.anoDe || c.anoInicio > estado.anoAte) return false;
      }
      if (termo && !haystack(c).includes(termo)) return false;
      return true;
    });
  }

  /**
   * Agrega o recorte por municipio. Devolve tambem o que ficou de fora do mapa,
   * para o rodape declarar a base real em vez de sumir com o resto em silencio.
   */
  function agregar(rows) {
    const porMun = new Map();
    const fora = { cursos: 0, matriculados: 0 };

    for (const c of rows) {
      const cod = c.codMunicipio ? String(c.codMunicipio) : null;
      const geo = cod ? COORDS[cod] : null;
      if (!geo) {
        fora.cursos++;
        if (c.matriculados != null) fora.matriculados += c.matriculados;
        continue;
      }
      let m = porMun.get(cod);
      if (!m) {
        m = {
          cod,
          nome: geo.nome || c.municipio || cod,
          uf: geo.uf,
          lat: geo.lat,
          lon: geo.lon,
          cursos: 0,
          matriculados: 0,
          matriculadosBase: 0,
          turmas: 0,
          turmasBase: 0,
          lista: [],
        };
        porMun.set(cod, m);
      }
      m.cursos++;
      m.lista.push(c);
      if (c.matriculados != null) { m.matriculados += c.matriculados; m.matriculadosBase++; }
      if (c.turmas != null) { m.turmas += c.turmas; m.turmasBase++; }
    }

    const municipios = [...porMun.values()];
    const max = {};
    for (const s of SERIES) max[s.id] = Math.max(0, ...municipios.map((m) => s.valor(m) || 0));
    return { municipios, max, fora };
  }

  /* ---------------------------------------------------------------- mapa ---- */

  let mapa = null;
  const camadas = {};
  let controleLegenda = null;
  let ultimo = null; // ultimo agregado desenhado, para reenquadrar e para a tabela

  function iniciarMapa() {
    mapa = L.map('mapa', {
      center: [-14.5, -52.5],
      zoom: 4,
      minZoom: 3,
      maxZoom: 12,
      keyboard: true,
      worldCopyJump: false,
      // O simbolo e o dado: o scroll da pagina nao deve virar zoom por acidente.
      scrollWheelZoom: 'center',
    });

    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Atribuicao obrigatoria pela licenca do OpenStreetMap — nao remover.
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · dados PNERA (INCRA/UnB) · coordenadas IBGE',
    });

    // Sem rede o mapa continua util; o aviso explica por que o fundo esta vazio.
    tiles.on('tileerror', () => { $('#avisoRede').hidden = false; });
    tiles.addTo(mapa);

    for (const s of SERIES) {
      mapa.createPane(`pane-${s.id}`).style.zIndex = String(s.paneZ);
      camadas[s.id] = L.layerGroup().addTo(mapa);
    }

    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(mapa);
    controleReenquadrar().addTo(mapa);
    controleLegenda = criarLegenda();
    controleLegenda.addTo(mapa);
  }

  function controleReenquadrar() {
    const Ctrl = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const el = L.DomUtil.create('div', 'ctrl-mapa');
        el.innerHTML = '<button type="button" title="Enquadrar o recorte atual">'
          + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
          + '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>Reenquadrar</button>';
        L.DomEvent.disableClickPropagation(el);
        el.querySelector('button').addEventListener('click', enquadrar);
        return el;
      },
    });
    return new Ctrl();
  }

  function enquadrar() {
    const pontos = (ultimo?.municipios || []).map((m) => [m.lat, m.lon]);
    if (!pontos.length) { mapa.setView([-14.5, -52.5], 4); return; }
    mapa.fitBounds(L.latLngBounds(pontos), { padding: [36, 36], maxZoom: 9 });
  }

  /* ------------------------------------------------------------- simbolos --- */

  function desenhar(agregado) {
    ultimo = agregado;

    for (const s of SERIES) {
      const grupo = camadas[s.id];
      grupo.clearLayers();
      if (!estado.camadas.has(s.id)) continue;

      const max = agregado.max[s.id];
      // Maiores primeiro: os pequenos ficam por cima e continuam clicaveis.
      const ordenados = agregado.municipios
        .filter((m) => s.valor(m) > 0)
        .sort((a, b) => s.valor(b) - s.valor(a));

      for (const m of ordenados) {
        const c = L.circleMarker([m.lat, m.lon], {
          pane: `pane-${s.id}`,
          radius: raio(s.valor(m), max),
          color: s.cor,
          weight: 1.25,
          opacity: 0.9,
          fillColor: s.cor,
          fillOpacity: 0.42,
          className: 'simbolo',
        });
        c.bindTooltip(() => tooltipHtml(m), {
          className: 'tip-mun', direction: 'top', offset: [0, -4], opacity: 1,
        });
        c.on('click', () => abrirDetalhe(m));
        c.addTo(grupo);
        acessibilizar(c, m, s);
      }
    }

    atualizarLegenda(agregado);
    atualizarTabela(agregado);
  }

  /**
   * Da teclado e leitor de tela ao circulo. O SVG do Leaflet nao e focavel por
   * padrao; o painel principal faz o mesmo com as UFs em map.js.
   */
  function acessibilizar(circulo, m, serie) {
    const el = circulo.getElement();
    if (!el) return;
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label',
      `${m.nome}, ${m.uf}: ${int(serie.valor(m))} ${serie.rotulo.toLowerCase()}. `
      + 'Abrir a lista de cursos do município.');
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrirDetalhe(m); }
    });
    el.addEventListener('focus', () => circulo.openTooltip());
    el.addEventListener('blur', () => circulo.closeTooltip());
  }

  function tooltipHtml(m) {
    const linha = (cor, rotulo, valor) => '<div class="tip-mun__row">'
      + (cor ? `<span class="tip-mun__swatch" style="background:${cor}"></span>` : '')
      + `<span class="tip-mun__label">${rotulo}</span>`
      + `<span class="tip-mun__value">${valor}</span></div>`;

    const semMat = m.cursos - m.matriculadosBase;
    return `<div class="tip-mun__title">${m.nome} · ${m.uf}</div>`
      + linha(T.matriculados, 'Matriculados', int(m.matriculados))
      + linha(T.cursos, 'Cursos', int(m.cursos))
      + linha(null, 'Turmas', m.turmasBase ? int(m.turmas) : '—')
      + (semMat
        ? `<div class="tip-mun__note">${semMat} ${semMat === 1 ? 'curso sem nº' : 'cursos sem nº'} de matriculados</div>`
        : '')
      + '<div class="tip-mun__note">Clique para ver os cursos</div>';
  }

  /* ------------------------------------------------------------- legenda ---- */

  function criarLegenda() {
    const Ctrl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd() {
        const el = L.DomUtil.create('div', 'legenda-mapa');
        L.DomEvent.disableClickPropagation(el);
        el.setAttribute('aria-hidden', 'true'); // os numeros estao na tabela do cartão
        this._el = el;
        return el;
      },
    });
    return new Ctrl();
  }

  /** Arredonda para 1, 2 ou 5 vezes uma potencia de 10 — escala legivel. */
  function redondo(v) {
    if (v <= 0) return 0;
    const e = 10 ** Math.floor(Math.log10(v));
    const m = v / e;
    return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e;
  }

  function atualizarLegenda(agregado) {
    const el = controleLegenda._el;
    if (!el) return;

    const ativas = SERIES.filter((s) => estado.camadas.has(s.id) && agregado.max[s.id] > 0);
    if (!ativas.length) {
      el.innerHTML = '<div class="legenda-mapa__titulo">Sem círculos no recorte</div>';
      return;
    }

    el.innerHTML = '<div class="legenda-mapa__titulo">Área proporcional ao valor</div>'
      + `<div class="legenda-mapa__series">${ativas.map((s) => serieLegenda(s, agregado.max[s.id])).join('')}</div>`
      + '<div class="legenda-mapa__nota">A escala é recalculada a cada filtro.</div>';
  }

  /** Circulos concentricos, como no mapa de referencia: maior atras, menor na frente. */
  function serieLegenda(serie, max) {
    // As duas medidas sao contagens inteiras: uma marca "0,2" na legenda de
    // cursos mostraria um circulo rotulado "0". Piso em 1 e sem repetidos.
    const valores = [...new Set(
      [max, redondo(max / 4), redondo(max / 16)].map((v) => Math.max(1, Math.round(v))),
    )].sort((a, b) => b - a);

    const largura = R_MAX * 2 + 4;
    const altura = R_MAX * 2 + 4;
    const cx = largura / 2;

    // Topo de cada circulo, empurrado para baixo o minimo necessario para os
    // rotulos nao se encavalarem — mesmo criterio das etiquetas de UF do painel.
    const ESPACO = 13;
    let ultimoY = -Infinity;
    const marcas = valores.map((v) => {
      const r = raio(v, max);
      const topo = altura - 2 - r * 2;
      const y = Math.max(topo, ultimoY + ESPACO);
      ultimoY = y;
      return { v, r, topo, y };
    });

    const circulos = marcas.map(({ r, topo }) => {
      const cy = altura - 2 - r;
      return `<circle cx="${cx}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"`
        + ` fill="${serie.cor}" fill-opacity="0.14" stroke="${serie.cor}" stroke-width="1.1"/>`
        + `<line x1="${cx}" y1="${topo.toFixed(1)}" x2="${largura - 2}" y2="${topo.toFixed(1)}"`
        + ` stroke="${serie.cor}" stroke-width="0.75" stroke-dasharray="2 2"/>`;
    }).join('');

    const rotulos = marcas.map(({ v, y }) => (
      `<div style="position:absolute;right:0;top:${Math.max(0, y - 7).toFixed(1)}px">${compact(v)}</div>`
    )).join('');

    return '<div>'
      + `<div class="legenda-mapa__nome"><span class="legenda-mapa__swatch" style="background:${serie.cor}"></span>${serie.rotulo}</div>`
      + '<div class="legenda-mapa__serie">'
      + `<svg width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}" aria-hidden="true">${circulos}</svg>`
      + `<div class="legenda-mapa__valores" style="position:relative;height:${altura}px;flex:1 1 auto">${rotulos}</div>`
      + '</div></div>';
  }

  /* ------------------------------------------------------------ KPIs/base --- */

  function atualizarKpis(rows, agregado) {
    const mat = P.total(rows, 'matriculados');
    const turmas = P.total(rows, 'turmas');

    const kpis = [
      {
        hero: true,
        rotulo: 'Cursos no recorte',
        valor: int(rows.length),
        sub: `${int(agregado.municipios.length)} municípios no mapa`,
      },
      { rotulo: 'Matriculados', valor: compact(mat.soma), sub: `base: ${int(mat.base)} de ${int(rows.length)} cursos` },
      { rotulo: 'Turmas', valor: int(turmas.soma), sub: `base: ${int(turmas.base)} de ${int(rows.length)} cursos` },
      { rotulo: 'Estados alcançados', valor: int(P.distintos(rows, (c) => c.ufSigla)), sub: 'de 27 UFs' },
    ];

    $('#kpis').innerHTML = kpis.map((k) => `
      <div class="kpi${k.hero ? ' kpi--hero' : ''}">
        <span class="kpi__label">${k.rotulo}</span>
        <span class="kpi__value">${k.valor}</span>
        <span class="kpi__sub">${k.sub}</span>
      </div>`).join('');
  }

  function atualizarRodape(rows, agregado) {
    const mat = P.total(rows, 'matriculados');
    const foraTexto = agregado.fora.cursos
      ? `<span class="coverage"><strong>${int(agregado.fora.cursos)}</strong> curso${agregado.fora.cursos === 1 ? '' : 's'} fora do mapa (sem município na fonte)</span>`
      : '<span class="coverage">Todos os cursos do recorte estão no mapa</span>';

    $('#rodapeMapa').innerHTML = foraTexto
      + `<span class="coverage">base de matriculados: <strong>${int(mat.base)}</strong> de ${int(rows.length)} cursos</span>`
      + '<span class="coverage">coordenada = centroide do município (IBGE)</span>';
  }

  /* ------------------------------------------------------------- tabela ----- */

  /** Todo visual do projeto tem gemeo em tabela — nenhum valor so no hover. */
  function atualizarTabela(agregado) {
    const linhas = agregado.municipios
      .slice()
      .sort((a, b) => b.matriculados - a.matriculados || b.cursos - a.cursos
        || a.nome.localeCompare(b.nome, 'pt-BR'));

    $('#tabelaMun').innerHTML = `
      <table>
        <thead><tr>
          <th scope="col">Município</th><th scope="col">UF</th>
          <th scope="col" class="num">Matriculados</th>
          <th scope="col" class="num">Cursos</th>
          <th scope="col" class="num">Turmas</th>
        </tr></thead>
        <tbody>${linhas.map((m) => `
          <tr><td>${m.nome}</td><td>${m.uf}</td>
            <td class="num">${m.matriculadosBase ? int(m.matriculados) : '—'}</td>
            <td class="num">${int(m.cursos)}</td>
            <td class="num">${m.turmasBase ? int(m.turmas) : '—'}</td></tr>`).join('')}
        </tbody>
      </table>`;
  }

  /* ------------------------------------------------------------- detalhe ---- */

  let modal = null;

  function abrirDetalhe(m) {
    const alvo = $('#modalMunicipio');
    modal = modal || new bootstrap.Modal(alvo);

    $('#modalMunicipioTitulo').textContent = `${m.nome} · ${m.uf}`;

    const cursos = m.lista.slice().sort((a, b) => (b.anoInicio ?? 0) - (a.anoInicio ?? 0));
    $('.modal-body', alvo).innerHTML = `
      <p class="mb-3" style="font-size:var(--step--1);color:var(--ink-muted)">
        ${int(m.cursos)} curso${m.cursos === 1 ? '' : 's'} ·
        ${m.matriculadosBase ? `${int(m.matriculados)} matriculados (base ${int(m.matriculadosBase)} de ${int(m.cursos)})` : 'sem nº de matriculados na fonte'} ·
        ${m.turmasBase ? `${int(m.turmas)} turmas` : 'turmas não informadas'}
      </p>
      <ul class="mun-lista">${cursos.map((c) => `
        <li>
          <div class="mun-lista__nome">${c.curso || c.nomeProcessual || 'Curso sem nome na fonte'}</div>
          <div class="mun-lista__meta">
            ${[c.nivel, c.areaTematica, c.fase].filter(Boolean).join(' · ')}
            ${c.anoInicio ? ` · ${c.anoInicio}${c.anoFim && c.anoFim !== c.anoInicio ? `–${c.anoFim}` : ''}` : ''}
          </div>
          <div class="mun-lista__meta">${c.ies?.nome || 'Instituição não informada'}</div>
          <div class="mun-lista__meta mun-lista__num">
            ${c.matriculados != null ? `${int(c.matriculados)} matriculados` : 'matriculados não informados'}
            ${c.turmas != null ? ` · ${int(c.turmas)} turmas` : ''}
          </div>
        </li>`).join('')}</ul>`;

    modal.show();
  }

  /* ------------------------------------------------- painel de filtros ------ */

  const CHEVRON = '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  function montarPainel(el) {
    el.innerHTML = `
      <div class="filters-panel__head">
        <h2>Filtros</h2>
        <button type="button" class="chips__clear js-limpar-tudo" hidden>Limpar tudo</button>
      </div>

      <div class="filter-group">
        <div class="filter-group__btn" style="cursor:default">Camadas do mapa</div>
        <div class="filter-group__body">
          <div class="camadas">${SERIES.map((s) => `
            <label class="camada">
              <input type="checkbox" class="js-camada" data-serie="${s.id}" checked>
              <span class="camada__swatch" style="background:${s.cor};color:${s.cor}"></span>
              <span class="camada__label">${s.rotulo}</span>
              <span class="camada__max js-camada-max" data-serie="${s.id}"></span>
            </label>`).join('')}
          </div>
        </div>
      </div>

      <div class="filter-group">
        <div class="filter-group__btn" style="cursor:default">Período de início</div>
        <div class="filter-group__body">
          <div class="range-row">
            <input type="number" class="js-ano-de" inputmode="numeric"
                   min="${ANO_MIN}" max="${ANO_MAX}" aria-label="Ano inicial">
            <span class="muted">até</span>
            <input type="number" class="js-ano-ate" inputmode="numeric"
                   min="${ANO_MIN}" max="${ANO_MAX}" aria-label="Ano final">
          </div>
        </div>
      </div>

      ${GRUPOS.map((g, i) => grupoHtml(g, i, el.id)).join('')}`;

    const de = $('.js-ano-de', el);
    const ate = $('.js-ano-ate', el);
    de.value = estado.anoDe;
    ate.value = estado.anoAte;
    const aplicarPeriodo = () => {
      estado.anoDe = Math.min(Math.max(Number(de.value) || ANO_MIN, ANO_MIN), ANO_MAX);
      estado.anoAte = Math.min(Math.max(Number(ate.value) || ANO_MAX, ANO_MIN), ANO_MAX);
      if (estado.anoDe > estado.anoAte) [estado.anoDe, estado.anoAte] = [estado.anoAte, estado.anoDe];
      atualizar();
    };
    de.addEventListener('change', aplicarPeriodo);
    ate.addEventListener('change', aplicarPeriodo);

    $('.js-limpar-tudo', el).addEventListener('click', limparTudo);

    el.querySelectorAll('.js-grupo-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const aberto = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!aberto));
        $(`#${btn.dataset.alvo}`).hidden = aberto;
      });
    });

    el.querySelectorAll('.js-filtrar-opcoes').forEach((input) => {
      input.addEventListener('input', () => {
        const termo = fold(input.value);
        $(`#${input.dataset.alvo}`).querySelectorAll('.opt').forEach((opt) => {
          opt.hidden = Boolean(termo) && !fold(opt.dataset.valor).includes(termo);
        });
      });
    });

    // Um ouvinte por painel, em vez de um por caixa.
    el.addEventListener('change', (ev) => {
      const camada = ev.target.closest('input.js-camada');
      if (camada) {
        if (camada.checked) estado.camadas.add(camada.dataset.serie);
        else estado.camadas.delete(camada.dataset.serie);
        atualizar();
        return;
      }
      const opt = ev.target.closest('input[type="checkbox"][data-dim]');
      if (!opt) return;
      const set = estado.dims[opt.dataset.dim];
      if (opt.checked) set.add(opt.dataset.valor); else set.delete(opt.dataset.valor);
      atualizar();
    });
  }

  function grupoHtml(g, i, prefixo) {
    const dim = P.DIMENSOES[g.dim];
    const idCorpo = `${prefixo}-g${i}`;
    const valores = P.meta.valores?.[g.dim] || [];
    return `
      <div class="filter-group" data-dim="${g.dim}">
        <button type="button" class="filter-group__btn js-grupo-btn" data-alvo="${idCorpo}"
                aria-expanded="${g.aberto}" aria-controls="${idCorpo}">
          ${dim.rotulo}
          <span class="filter-group__count js-count" hidden></span>
          ${CHEVRON}
        </button>
        <div class="filter-group__body" id="${idCorpo}" ${g.aberto ? '' : 'hidden'}>
          ${g.busca ? `<input type="search" class="form-control form-control-sm mb-2 js-filtrar-opcoes"
              data-alvo="${idCorpo}-lista" placeholder="Buscar ${dim.rotulo.toLowerCase()}…"
              aria-label="Buscar em ${dim.rotulo}">` : ''}
          <div class="filter-group__scroll js-opcoes" id="${idCorpo}-lista">
            ${valores.map((v) => {
              const id = `${idCorpo}-${fold(v).replace(/[^a-z0-9]+/g, '-')}`;
              return `<label class="opt" for="${id}" data-valor="${v}">
                <input type="checkbox" id="${id}" data-dim="${g.dim}" data-valor="${v}">
                <span class="opt__label">${v}</span>
              </label>`;
            }).join('')}
          </div>
        </div>
      </div>`;
  }

  /** Reflete o estado nas caixas de todos os paineis (desktop e offcanvas). */
  function sincronizarPainel() {
    document.querySelectorAll('.filters-panel').forEach((painel) => {
      painel.querySelectorAll('input[type="checkbox"][data-dim]').forEach((input) => {
        input.checked = estado.dims[input.dataset.dim].has(input.dataset.valor);
      });
      painel.querySelectorAll('input.js-camada').forEach((input) => {
        input.checked = estado.camadas.has(input.dataset.serie);
      });
      painel.querySelectorAll('.filter-group[data-dim]').forEach((grupo) => {
        const n = estado.dims[grupo.dataset.dim].size;
        const contador = $('.js-count', grupo);
        contador.hidden = !n;
        contador.textContent = n;
      });
      const de = $('.js-ano-de', painel);
      const ate = $('.js-ano-ate', painel);
      if (de) de.value = estado.anoDe;
      if (ate) ate.value = estado.anoAte;
      $('.js-limpar-tudo', painel).hidden = !temFiltro();
    });
  }

  function temFiltro() {
    return DIMS.some((d) => estado.dims[d].size > 0)
      || estado.anoDe > ANO_MIN || estado.anoAte < ANO_MAX || Boolean(estado.busca);
  }

  function limparTudo() {
    for (const d of DIMS) estado.dims[d].clear();
    estado.anoDe = ANO_MIN;
    estado.anoAte = ANO_MAX;
    estado.busca = '';
    $('#busca').value = '';
    atualizar();
  }

  /* --------------------------------------------------------------- chips ---- */

  function pintarChips() {
    const chips = [];
    for (const dim of DIMS) {
      for (const valor of estado.dims[dim]) {
        chips.push({ dim, valor, rotulo: P.DIMENSOES[dim].rotulo });
      }
    }
    if (estado.anoDe > ANO_MIN || estado.anoAte < ANO_MAX) {
      chips.push({ dim: '__periodo', valor: `${estado.anoDe}–${estado.anoAte}`, rotulo: 'Período' });
    }
    if (estado.busca) chips.push({ dim: '__busca', valor: estado.busca, rotulo: 'Busca' });

    const el = $('#chips');
    el.innerHTML = chips.map((c) => `
      <span class="chip">
        <span class="chip__dim">${c.rotulo}:</span>
        <span class="chip__val" title="${c.valor}">${c.valor}</span>
        <button type="button" class="chip__x" data-dim="${c.dim}" data-valor="${c.valor}"
                aria-label="Remover filtro ${c.rotulo}: ${c.valor}">&times;</button>
      </span>`).join('')
      + (chips.length > 1 ? '<button type="button" class="chips__clear js-limpar-chips">Limpar tudo</button>' : '');
  }

  /* ------------------------------------------------------------- URL hash --- */

  function lerHash() {
    const hash = location.hash.replace(/^#/, '');
    if (!hash) return;
    for (const par of hash.split('&')) {
      const [chave, bruto] = par.split('=');
      if (!chave || bruto == null) continue;
      const valor = decodeURIComponent(bruto);
      if (DIMS.includes(chave)) {
        estado.dims[chave] = new Set(valor.split('~').filter(Boolean));
      } else if (chave === 'de') {
        estado.anoDe = Number(valor) || ANO_MIN;
      } else if (chave === 'ate') {
        estado.anoAte = Number(valor) || ANO_MAX;
      } else if (chave === 'busca') {
        estado.busca = valor;
      } else if (chave === 'camadas') {
        estado.camadas = new Set(valor.split('~').filter((s) => SERIES.some((x) => x.id === s)));
      }
    }
  }

  function escreverHash() {
    const partes = [];
    for (const dim of DIMS) {
      const set = estado.dims[dim];
      if (set.size) partes.push(`${dim}=${encodeURIComponent([...set].join('~'))}`);
    }
    if (estado.anoDe > ANO_MIN) partes.push(`de=${estado.anoDe}`);
    if (estado.anoAte < ANO_MAX) partes.push(`ate=${estado.anoAte}`);
    if (estado.busca) partes.push(`busca=${encodeURIComponent(estado.busca)}`);
    if (estado.camadas.size !== SERIES.length) {
      partes.push(`camadas=${encodeURIComponent([...estado.camadas].join('~'))}`);
    }
    const novo = partes.length ? `#${partes.join('&')}` : location.pathname + location.search;
    // Em file:// alguns navegadores recusam replaceState. O mapa nao depende
    // disso — so o link compartilhavel — entao a falha e silenciosa.
    try { history.replaceState(null, '', novo); } catch { /* sem hash, tudo bem */ }
  }

  /* ---------------------------------------------------------- ciclo geral --- */

  function atualizar() {
    const rows = recorte();
    const agregado = agregar(rows);

    desenhar(agregado);
    atualizarKpis(rows, agregado);
    atualizarRodape(rows, agregado);
    pintarChips();
    sincronizarPainel();

    document.querySelectorAll('.js-camada-max').forEach((el) => {
      const max = agregado.max[el.dataset.serie];
      el.textContent = max > 0 ? `máx ${compact(max)}` : '—';
    });

    escreverHash();
  }

  /* ----------------------------------------------------------------- boot --- */

  function iniciar() {
    if (!window.L) {
      $('#mapa').innerHTML = '<p class="muted p-3">Leaflet não encontrado em <code>assets/vendor/leaflet.js</code>.</p>';
      return;
    }
    if (!Object.keys(COORDS).length) {
      $('#mapa').innerHTML = '<p class="muted p-3">Coordenadas dos municípios não encontradas. '
        + 'Rode <code>node tools/build-municipio-coords.mjs</code>.</p>';
      return;
    }

    lerHash();
    montarPainel($('#filtros-desktop'));
    montarPainel($('#filtros-mobile'));
    iniciarMapa();

    // Busca livre, com respiro para nao refiltrar a cada tecla.
    const busca = $('#busca');
    const limpar = $('.clear-search');
    busca.value = estado.busca;
    let timer = null;
    busca.addEventListener('input', () => {
      limpar.hidden = !busca.value;
      clearTimeout(timer);
      timer = setTimeout(() => { estado.busca = busca.value.trim(); atualizar(); }, 220);
    });
    limpar.addEventListener('click', () => {
      busca.value = '';
      limpar.hidden = true;
      estado.busca = '';
      atualizar();
      busca.focus();
    });

    // Chips: um ouvinte para todos os "x".
    $('#chips').addEventListener('click', (ev) => {
      if (ev.target.closest('.js-limpar-chips')) { limparTudo(); return; }
      const btn = ev.target.closest('.chip__x');
      if (!btn) return;
      const { dim, valor } = btn.dataset;
      if (dim === '__periodo') { estado.anoDe = ANO_MIN; estado.anoAte = ANO_MAX; }
      else if (dim === '__busca') { estado.busca = ''; $('#busca').value = ''; $('.clear-search').hidden = true; }
      else estado.dims[dim].delete(valor);
      atualizar();
    });

    // Alterna mapa e tabela — o gemeo em numeros de todo visual do projeto.
    const btnTabela = $('#btnTabela');
    btnTabela.addEventListener('click', () => {
      const mostrandoTabela = btnTabela.getAttribute('aria-pressed') === 'true';
      btnTabela.setAttribute('aria-pressed', String(!mostrandoTabela));
      $('#mapa').hidden = !mostrandoTabela;
      $('#tabelaMun').hidden = mostrandoTabela;
      // O Leaflet nao mede um container escondido: refazer a conta ao voltar.
      if (mostrandoTabela) mapa.invalidateSize();
    });

    atualizar();
    enquadrar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
}());
