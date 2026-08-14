/* =============================================================================
   PNERA — montagem do painel
   Amarra painel de filtros, chips, KPIs, abas e a base de dados no mesmo estado.
   ========================================================================== */

(function () {
  'use strict';

  const P = window.PNERA;
  const V = window.Viz;
  const F = window.Filters;
  const { int, compact } = P;

  const $ = (sel, raiz = document) => raiz.querySelector(sel);

  const ABAS = [
    { id: 'geral', rotulo: 'Visão geral' },
    { id: 'territorios', rotulo: 'Territórios' },
    { id: 'cursos', rotulo: 'Cursos e áreas' },
    { id: 'instituicoes', rotulo: 'Instituições e redes' },
    { id: 'dados', rotulo: 'Base de dados' },
  ];

  /* ------------------------------------------------------ painel de filtros -- */

  /** Grupos na ordem em que fazem sentido para quem lê: o que, onde, quem. */
  const GRUPOS = [
    { dim: 'fase', aberto: true },
    { dim: 'areaTematica', aberto: true },
    { dim: 'nivel', aberto: false },
    { dim: 'modalidade', aberto: false },
    { dim: 'areaConhecimento', aberto: false },
    { dim: 'macrorregiao', aberto: true },
    { dim: 'uf', aberto: false },
    { dim: 'iesNatureza', aberto: false },
    { dim: 'ies', aberto: false, busca: true },
    { dim: 'instrumento', aberto: false },
  ];

  const CHEVRON = '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  function montarPainel(el) {
    el.innerHTML = `
      <div class="filters-panel__head">
        <h2>Filtros</h2>
        <button type="button" class="chips__clear js-limpar-tudo" hidden>Limpar tudo</button>
      </div>
      <div class="filter-group">
        <div class="filter-group__btn" style="cursor:default">Período de início</div>
        <div class="filter-group__body">
          <div class="range-row">
            <input type="number" class="js-ano-de" inputmode="numeric"
                   min="${F.ANO_MIN}" max="${F.ANO_MAX}" aria-label="Ano inicial">
            <span class="muted">até</span>
            <input type="number" class="js-ano-ate" inputmode="numeric"
                   min="${F.ANO_MIN}" max="${F.ANO_MAX}" aria-label="Ano final">
          </div>
        </div>
      </div>
      ${GRUPOS.map((g, i) => grupoHtml(g, i, el.id)).join('')}`;

    // Faixa de anos.
    const de = $('.js-ano-de', el);
    const ate = $('.js-ano-ate', el);
    de.value = F.state.anoDe;
    ate.value = F.state.anoAte;
    const aplicarPeriodo = () => F.periodo(Number(de.value) || F.ANO_MIN, Number(ate.value) || F.ANO_MAX);
    de.addEventListener('change', aplicarPeriodo);
    ate.addEventListener('change', aplicarPeriodo);

    $('.js-limpar-tudo', el).addEventListener('click', () => F.limpar());

    // Sanfonas dos grupos.
    el.querySelectorAll('.js-grupo-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const aberto = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!aberto));
        $(`#${btn.dataset.alvo}`).hidden = aberto;
      });
    });

    // Busca dentro do grupo de instituições (154 valores).
    el.querySelectorAll('.js-filtrar-opcoes').forEach((input) => {
      input.addEventListener('input', () => {
        const termo = P.fold(input.value);
        $(`#${input.dataset.alvo}`).querySelectorAll('.opt').forEach((opt) => {
          opt.hidden = termo && !P.fold(opt.dataset.valor).includes(termo);
        });
      });
    });

    delegarOpcoes(el);
  }

  function grupoHtml(g, i, prefixo) {
    const dim = P.DIMENSOES[g.dim];
    const idCorpo = `${prefixo}-g${i}`;
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
          <div class="filter-group__scroll js-opcoes" id="${idCorpo}-lista"></div>
        </div>
      </div>`;
  }

  /** Um ouvinte por painel, em vez de um por caixa. */
  function delegarOpcoes(el) {
    el.addEventListener('change', (ev) => {
      const input = ev.target.closest('input[type="checkbox"][data-dim]');
      if (!input) return;
      F.alternar(input.dataset.dim, input.dataset.valor, input.checked);
    });
  }

  /** Repinta as opções e as contagens cruzadas de todos os painéis abertos. */
  function pintarOpcoes() {
    document.querySelectorAll('.filters-panel').forEach((painel) => {
      painel.querySelectorAll('.filter-group[data-dim]').forEach((grupo) => {
        const dim = grupo.dataset.dim;
        const lista = $('.js-opcoes', grupo);
        const opcoes = F.opcoes(dim);
        const escolhidos = opcoes.filter((o) => o.escolhido).length;

        const contador = $('.js-count', grupo);
        contador.hidden = !escolhidos;
        contador.textContent = escolhidos;

        const termo = P.fold($('.js-filtrar-opcoes', grupo)?.value ?? '');
        lista.innerHTML = opcoes.map((o) => {
          const id = `f-${dim}-${P.fold(o.valor).replace(/[^a-z0-9]+/g, '-')}`;
          const vazio = o.n === 0 && !o.escolhido;
          const oculto = termo && !P.fold(o.valor).includes(termo);
          return `<label class="opt${vazio ? ' opt--empty' : ''}" for="${id}"
                    data-valor="${o.valor.replace(/"/g, '&quot;')}"${oculto ? ' hidden' : ''}>
            <input type="checkbox" id="${id}" data-dim="${dim}"
                   data-valor="${o.valor.replace(/"/g, '&quot;')}" ${o.escolhido ? 'checked' : ''}
                   ${vazio ? 'disabled' : ''}>
            <span class="opt__label">${o.valor}</span>
            <span class="opt__n">${int(o.n)}</span>
          </label>`;
        }).join('');
      });

      const limpar = $('.js-limpar-tudo', painel);
      if (limpar) limpar.hidden = !F.temFiltro();
      const de = $('.js-ano-de', painel);
      const ate = $('.js-ano-ate', painel);
      if (de) de.value = F.state.anoDe;
      if (ate) ate.value = F.state.anoAte;
    });
  }

  /* ------------------------------------------------------------------ chips -- */

  function pintarChips(rows) {
    const el = $('#chips');
    const ativos = F.ativos();
    if (!ativos.length) { el.innerHTML = ''; return; }
    el.innerHTML = ativos.map((a, i) => `
      <span class="chip">
        <span class="chip__dim">${a.rotulo}:</span>
        <span class="chip__val" title="${a.valor}">${a.valor}</span>
        <button type="button" class="chip__x js-chip" data-i="${i}"
                aria-label="Remover filtro ${a.rotulo} ${a.valor}">&times;</button>
      </span>`).join('')
      + `<span class="chip" style="background:var(--brand-wash);border-color:var(--series-1)">
           <span class="chip__val">${int(rows.length)} de ${int(P.data.length)} cursos</span></span>`
      + `<button type="button" class="chips__clear js-limpar-tudo-chips">Limpar tudo</button>`;

    el.querySelectorAll('.js-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = ativos[Number(btn.dataset.i)];
        if (a.tipo === 'dim') F.alternar(a.dim, a.valor, false);
        else if (a.tipo === 'periodo') F.periodo(F.ANO_MIN, F.ANO_MAX);
        else F.buscar('');
      });
    });
    $('.js-limpar-tudo-chips', el).addEventListener('click', () => F.limpar());
  }

  /* ------------------------------------------------------------------- KPIs -- */

  /** O cartão herói é único na página: o número que o painel lidera. */
  function pintarKpis(rows) {
    const mat = P.total(rows, 'matriculados');
    const turmas = P.total(rows, 'turmas');

    const cartoes = [
      {
        hero: true,
        label: F.temFiltro() ? 'Cursos no recorte' : 'Cursos do Pronera mapeados',
        valor: int(rows.length),
        sub: F.temFiltro() ? `de ${int(P.data.length)} no total` : `PNERA II e III · ${P.meta.periodo?.anoMin}–${P.meta.periodo?.anoInicioMax}`,
      },
      { label: 'Estudantes matriculados', valor: compact(mat.soma), sub: `${int(mat.base)} de ${int(mat.total)} cursos informam` },
      { label: 'Turmas', valor: int(turmas.soma), sub: `${int(turmas.base)} cursos informam` },
      { label: 'Estados alcançados', valor: `${P.distintos(rows, (c) => c.uf)}`, sub: 'de 27 UFs' },
      { label: 'Municípios', valor: int(P.distintos(rows, (c) => c.municipio)), sub: 'onde houve turma' },
      { label: 'Instituições de ensino', valor: int(P.distintos(rows, (c) => c.ies?.nome)), sub: 'realizadoras' },
    ];

    $('#kpis').innerHTML = cartoes.map((c) => `
      <div class="kpi${c.hero ? ' kpi--hero' : ''}">
        <span class="kpi__label">${c.label}</span>
        <span class="kpi__value">${c.valor}</span>
        <span class="kpi__sub">${c.sub}</span>
      </div>`).join('');
  }

  /* ------------------------------------------------------------------- abas -- */

  function montarNav() {
    const el = $('#viewnav');
    el.innerHTML = ABAS.map((a) => `
      <button type="button" class="viewnav__btn" role="tab" data-aba="${a.id}"
              aria-selected="${a.id === F.state.aba}" aria-controls="painel">${a.rotulo}</button>`).join('');
    el.querySelectorAll('.viewnav__btn').forEach((btn) => {
      btn.addEventListener('click', () => trocarAba(btn.dataset.aba));
    });
  }

  function trocarAba(id) {
    F.aba(id);
    $('#viewnav').querySelectorAll('.viewnav__btn').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.aba === id));
    });
    const painel = $('#painel');
    V.limparMontados();
    const rows = F.recorte();
    if (id === 'dados') {
      painel.innerHTML = '<div class="grid"></div>';
      window.Tabela.montar($('.grid', painel), rows);
    } else {
      V.montarAba(painel, id, rows);
    }
    painel.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  /* --------------------------------------------------------------- ligacoes -- */

  function ligarBusca() {
    const input = $('#busca');
    const limpar = $('.clear-search');
    let timer;
    input.value = F.state.busca;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => F.buscar(input.value), 180);
      limpar.hidden = !input.value;
    });
    limpar.hidden = !input.value;
    limpar.addEventListener('click', () => {
      input.value = '';
      limpar.hidden = true;
      F.buscar('');
      input.focus();
    });
  }

  /** Botão "limpar filtros" dos estados vazios, onde quer que apareça. */
  function ligarLimparDelegado() {
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('.js-limpar')) F.limpar();
    });
  }

  function pintarRodape() {
    const geradoEm = P.meta.geradoEm ? new Date(P.meta.geradoEm) : null;
    const html = `Fonte: <strong>${P.meta.fonte ?? '—'}</strong>, aba ${P.meta.aba ?? '—'}`
      + `<br>${int(P.meta.totalCursos ?? 0)} cursos · convertido em `
      + (geradoEm ? geradoEm.toLocaleDateString('pt-BR') : '—');
    $('#meta-fonte').innerHTML = html;
    $('#meta-fonte-mobile').innerHTML = html;
  }

  /* ------------------------------------------------------------------ start -- */

  function iniciar() {
    if (!P.data.length) {
      $('#painel').innerHTML = `<div class="card span-12"><div class="empty">
        <span class="empty__title">Dados não carregados</span>
        <span>Rode <code>node tools/xlsx-to-json.mjs</code> para gerar
        <code>assets/js/dataset.js</code> a partir da planilha.</span></div></div>`;
      return;
    }

    F.lerUrl();
    montarPainel($('#filtros-desktop'));
    montarPainel($('#filtros-mobile'));
    montarNav();
    ligarBusca();
    ligarLimparDelegado();
    pintarRodape();

    F.subscribe((rows) => {
      pintarKpis(rows);
      pintarChips(rows);
      pintarOpcoes();
      if (F.state.aba === 'dados') window.Tabela.pintar(rows);
      else V.atualizar(rows);
    });

    document.addEventListener('pnera:aba', (ev) => trocarAba(ev.detail));

    const rows = F.recorte();
    pintarKpis(rows);
    pintarChips(rows);
    pintarOpcoes();
    trocarAba(F.state.aba);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
}());
