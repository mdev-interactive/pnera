/* =============================================================================
   PNERA — camada de visualizacao
   Um unico lugar define as especificacoes de marca (espessura, cantos, vaos,
   grade hairline) para que todos os graficos leiam como um sistema so.
   Todo cartao tem gemeo em tabela: o valor nunca depende do tooltip.
   ========================================================================== */

window.Viz = (function () {
  'use strict';

  const { int, compact, pct } = window.PNERA;

  /** Tokens lidos do CSS — a paleta vive em um lugar so. */
  const css = (nome) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

  const T = {};
  function lerTokens() {
    Object.assign(T, {
      surface: css('--surface'),
      surface2: css('--surface-2'),
      ink: css('--ink'),
      ink2: css('--ink-2'),
      muted: css('--ink-muted'),
      grid: css('--grid'),
      baseline: css('--baseline'),
      borderStrong: css('--border-strong'),
      series: [1, 2, 3, 4, 5, 6, 7].map((i) => css(`--series-${i}`)),
      outros: css('--series-other'),
      seq: [1, 2, 3, 4, 5].map((i) => css(`--seq-${i}`)),
      seqEmpty: css('--seq-empty'),
      divNeg: css('--div-neg'),
      divPos: css('--div-pos'),
    });
  }
  lerTokens();

  /** Slot categorico por indice. Passado o 7o slot, cinza "Outros" — nunca uma cor nova. */
  const slot = (i) => (i < T.series.length ? T.series[i] : T.outros);

  /** Cor da rampa sequencial por posicao relativa (0..1). */
  function seqColor(v, max) {
    if (v == null || max <= 0) return T.seqEmpty;
    if (v === 0) return T.seqEmpty;
    const i = Math.min(T.seq.length - 1, Math.floor((v / max) * T.seq.length - 1e-9));
    return T.seq[Math.max(0, i)];
  }

  /**
   * Branco ou tinta dentro de um preenchimento, conforme a luminancia relativa.
   * O limiar 0.2 e o ponto em que os dois contrastes se igualam para esta tinta
   * (resolvendo (L+0.05)² = 1.05 × (L_tinta + 0.05)); acima dele a tinta escura
   * ganha, abaixo a superficie clara ganha.
   */
  function inkOn(hex) {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.2 ? T.ink : T.surface;
  }

  const rgba = (hex, a) => {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return `rgba(${r},${g},${b},${a})`;
  };

  /* ------------------------------------------------------- padroes Chart.js -- */

  const Chart = window.Chart;
  const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  Chart.defaults.font.family = css('--font') || 'system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = T.muted;
  // Ajustar a propriedade, nao trocar o objeto: substituir defaults.animation
  // apaga o `easing` padrao e o Chart.js passa a resolver a funcao de animacao
  // como undefined, estourando "this._fn is not a function" no proximo quadro.
  if (reduzirMovimento) Chart.defaults.animation = false;
  else Chart.defaults.animation.duration = 260;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.display = false; // legenda propria, em HTML
  Chart.defaults.plugins.tooltip.enabled = false; // tooltip propria, em HTML
  Chart.defaults.elements.bar.borderRadius = 4;
  Chart.defaults.elements.bar.maxBarThickness = 24;
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.line.tension = 0.25;
  Chart.defaults.elements.line.capBezierPoints = true;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hoverRadius = 5;
  Chart.defaults.elements.point.hoverBorderWidth = 2;

  /** Eixo de valor: grade hairline solida, um passo fora da superficie. */
  const eixoValor = (extra = {}) => ({
    grid: { color: T.grid, lineWidth: 1, drawBorder: false, drawTicks: false, borderDash: [] },
    border: { display: false },
    ticks: { color: T.muted, padding: 6, callback: (v) => compact(v), maxTicksLimit: 6 },
    beginAtZero: true,
    ...extra,
  });

  /** Eixo de categoria: sem grade — a grade e do valor, nao da identidade. */
  const eixoCategoria = (extra = {}) => ({
    grid: { display: false },
    border: { color: T.baseline, width: 1 },
    ticks: { color: T.ink2, padding: 6, autoSkip: false },
    ...extra,
  });

  /* --------------------------------------------------------------- tooltip --- */

  let tipEl = null;
  function tip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'viz-tip';
      tipEl.setAttribute('role', 'status');
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  function mostrarTip(html, x, y) {
    const el = tip();
    el.innerHTML = html;
    el.classList.add('is-on');
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8);
    const top = Math.min(Math.max(8, y - r.height - 12), window.innerHeight - r.height - 8);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }
  const esconderTip = () => tip().classList.remove('is-on');

  const linhaTip = (cor, nome, valor) => `<div class="viz-tip__row">`
    + (cor ? `<span class="sw" style="background:${cor}"></span>` : '')
    + `<span>${nome}</span><span class="v">${valor}</span></div>`;

  /**
   * Tooltip em HTML para os graficos de canvas. Recebe uma funcao que monta o
   * conteudo a partir dos elementos sob o cursor.
   */
  /**
   * `intersect: false` deixa a faixa inteira da categoria valer como alvo. Com
   * intersect verdadeiro seria preciso acertar a barra em cheio, e o vao entre
   * barras — que existe de proposito — viraria uma zona morta no hover e no clique.
   */
  const ALVO = { intersect: false };

  function ligarTooltip(canvas, chart, montar) {
    const mover = (ev) => {
      const pontos = chart.getElementsAtEventForMode(ev, 'nearest', ALVO, true);
      if (!pontos.length) { esconderTip(); return; }
      const html = montar(pontos, chart);
      if (!html) { esconderTip(); return; }
      mostrarTip(html, ev.clientX, ev.clientY);
    };
    canvas.addEventListener('mousemove', mover);
    canvas.addEventListener('mouseleave', esconderTip);
    canvas.addEventListener('blur', esconderTip);
  }

  /* ----------------------------------------------------------- construtores -- */

  /**
   * Barras horizontais para ranking. Uma serie => um unico tom (slot 1): o
   * comprimento ja carrega o valor, colorir por valor gastaria o canal de
   * identidade. Rotulo direto na ponta de cada barra.
   */
  function barrasH({ labels, valores, cor, rotulo, formato = int, destaque = null, titulos = null }) {
    const cores = valores.map((_, i) => (destaque === i ? css('--brand-deep') : (cor || slot(0))));
    return {
      type: 'bar',
      data: {
        labels,
        // Nome completo por categoria: o eixo mostra a sigla, o tooltip o nome.
        titulos,
        datasets: [{
          label: rotulo,
          data: valores,
          backgroundColor: cores,
          borderSkipped: 'start', // ponta arredondada; quadrada na linha de base
          categoryPercentage: 0.82,
          barPercentage: 0.9,
        }],
      },
      options: {
        indexAxis: 'y',
        layout: { padding: { right: 44 } }, // espaco para o rotulo na ponta
        scales: { x: eixoValor({ display: false }), y: eixoCategoria() },
        plugins: {
          pontas: { formato },
        },
      },
    };
  }

  /** Colunas agrupadas (2 series de mesma unidade — um eixo, jamais dois). */
  function colunasAgrupadas({ labels, series, formato = int }) {
    return {
      type: 'bar',
      data: {
        labels,
        datasets: series.map((s, i) => ({
          label: s.nome,
          data: s.valores,
          backgroundColor: s.cor || slot(i),
          borderSkipped: 'bottom',
          categoryPercentage: 0.7,
          barPercentage: 0.84,
        })),
      },
      options: {
        scales: { y: eixoValor(), x: eixoCategoria() },
        plugins: { formatoValor: formato },
      },
    };
  }

  /**
   * Area empilhada no tempo. Preenchimento em ~12% (lavagem, nunca bloco
   * saturado) com a linha de 2px por cima carregando a identidade.
   */
  function areaEmpilhada({ labels, series }) {
    return {
      type: 'line',
      data: {
        labels,
        datasets: series.map((s, i) => ({
          label: s.nome,
          data: s.valores,
          borderColor: s.cor || slot(i),
          backgroundColor: rgba(s.cor || slot(i), 0.12),
          pointBackgroundColor: s.cor || slot(i),
          pointBorderColor: T.surface, // anel de 2px na cor da superficie
          fill: true,
        })),
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { ...eixoValor(), stacked: true },
          x: { ...eixoCategoria(), stacked: true, ticks: { ...eixoCategoria().ticks, autoSkip: true, maxTicksLimit: 14 } },
        },
      },
    };
  }

  /** Barras empilhadas 100%: vao de 2px na cor da superficie entre segmentos. */
  function empilhada100({ labels, series }) {
    return {
      type: 'bar',
      data: {
        labels,
        datasets: series.map((s, i) => ({
          label: s.nome,
          data: s.valores,
          backgroundColor: s.cor || slot(i),
          borderColor: T.surface,
          borderWidth: 2, // o vao que separa — nunca um contorno "de enfeite"
          borderSkipped: false,
          borderRadius: 3,
          categoryPercentage: 0.78,
          barPercentage: 0.92,
        })),
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: {
            stacked: true,
            max: 100,
            grid: { color: T.grid, lineWidth: 1 },
            border: { display: false },
            ticks: { color: T.muted, callback: (v) => `${v}%`, maxTicksLimit: 5 },
          },
          y: { ...eixoCategoria(), stacked: true },
        },
      },
    };
  }

  /** Dispersao meta x realizado, com a reta de referencia y = x. */
  function dispersao({ pontos, xTitulo, yTitulo, limite }) {
    return {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'Cursos',
            data: pontos,
            backgroundColor: rgba(slot(0), 0.72),
            borderColor: T.surface,
            borderWidth: 2, // anel na cor da superficie: legivel na sobreposicao
            pointRadius: 5,
            pointHoverRadius: 7,
          },
          {
            label: 'Meta cumprida exatamente',
            type: 'line',
            data: [{ x: 0, y: 0 }, { x: limite, y: limite }],
            borderColor: T.baseline,
            borderWidth: 1,
            pointRadius: 0,
            pointHitRadius: 0, // a reta de referencia nunca disputa o hover
            fill: false,
            tension: 0,
          },
        ],
      },
      options: {
        scales: {
          x: { ...eixoValor(), title: { display: true, text: xTitulo, color: T.muted } },
          y: { ...eixoValor(), title: { display: true, text: yTitulo, color: T.muted } },
        },
      },
    };
  }

  /* ------------------------------------------------- plugin: rotulo na ponta -- */

  /** Valor na ponta da barra — seletivo por definicao (uma serie, uma ponta). */
  const pluginPontas = {
    id: 'pontas',
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts || !opts.formato) return;
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      if (!meta || chart.data.datasets.length !== 1) return;
      ctx.save();
      ctx.font = `600 11px ${Chart.defaults.font.family}`;
      ctx.fillStyle = T.ink2;
      ctx.textBaseline = 'middle';
      const horizontal = chart.options.indexAxis === 'y';
      meta.data.forEach((barra, i) => {
        const v = chart.data.datasets[0].data[i];
        if (v == null) return;
        const texto = opts.formato(v);
        if (horizontal) {
          ctx.textAlign = 'left';
          ctx.fillText(texto, barra.x + 7, barra.y);
        } else {
          ctx.textAlign = 'center';
          ctx.fillText(texto, barra.x, barra.y - 9);
        }
      });
      ctx.restore();
    },
  };
  Chart.register(pluginPontas);

  /* ------------------------------------------------------------- cartoes ----- */

  const registro = [];
  const instancias = new Map();

  /** Registra um cartao. `build(rows)` devolve o que desenhar; `render` e livre. */
  const registrar = (spec) => { registro.push(spec); return spec; };

  const svgIcon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONE_TABELA = svgIcon('<path d="M3 5h18v14H3z"/><path d="M3 10h18M9 5v14"/>');

  /** Casca do cartao: cabecalho, legenda, area do grafico, gemeo em tabela, pe. */
  function casca(spec) {
    const el = document.createElement('section');
    el.className = `card span-${spec.span || 6}`;
    el.dataset.viz = spec.id;
    el.innerHTML = `
      <div class="card__head">
        <div>
          <h3 class="card__title" id="t-${spec.id}">${spec.title}</h3>
          ${spec.hint ? `<p class="card__hint">${spec.hint}</p>` : ''}
        </div>
        <div class="card__tools">
          <button type="button" class="icon-btn js-tabela" aria-pressed="false"
                  title="Ver os números em tabela" aria-label="Ver os números em tabela">
            ${ICONE_TABELA}<span class="visually-hidden">Tabela</span>
          </button>
        </div>
      </div>
      <div class="legend js-legend" aria-hidden="true"></div>
      <div class="chart-box js-plot" role="img" aria-labelledby="t-${spec.id}"></div>
      <div class="table-view js-table" hidden></div>
      <div class="card__foot js-foot"></div>`;
    return el;
  }

  function pintarLegenda(el, itens) {
    if (!itens || !itens.length) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = itens.map((i) => `<span class="legend__item${i.linha ? ' legend__item--line' : ''}">`
      + `<span class="legend__swatch" style="background:${i.cor}"></span>${i.nome}</span>`).join('');
  }

  function pintarTabela(el, tabela) {
    if (!tabela) { el.innerHTML = '<p class="muted p-2 m-0">Sem tabela para este visual.</p>'; return; }
    const cab = tabela.columns.map((c) => `<th class="${c.num ? 'num' : ''}" scope="col">${c.label}</th>`).join('');
    const corpo = tabela.rows.map((r) => `<tr>${tabela.columns
      .map((c) => `<td class="${c.num ? 'num' : ''}">${r[c.key] ?? '—'}</td>`).join('')}</tr>`).join('');
    el.innerHTML = `<table><caption class="visually-hidden">Números do gráfico</caption>`
      + `<thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table>`;
  }

  /** Nota de cobertura: quantos cursos do recorte tem o dado que o visual usa. */
  function pintarPe(el, res) {
    const partes = [];
    if (res.coverage) {
      const { preenchidos, total, rotulo } = res.coverage;
      const p = total ? Math.round((preenchidos / total) * 100) : 0;
      partes.push(`<span class="coverage" title="${p}% dos cursos do recorte têm ${rotulo}">`
        + `base: <strong>${int(preenchidos)} de ${int(total)}</strong> cursos com ${rotulo} (${p}%)</span>`);
    }
    if (res.note) partes.push(`<span>${res.note}</span>`);
    el.innerHTML = partes.join('');
    el.hidden = !partes.length;
  }

  const SVG_VAZIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.5-4.5"/></svg>';

  function pintarVazio(box, mensagem) {
    box.innerHTML = `<div class="empty">${SVG_VAZIO}`
      + `<span class="empty__title">Nada neste recorte</span>`
      + `<span>${mensagem || 'Nenhum curso corresponde aos filtros aplicados.'}</span>`
      + `<button type="button" class="icon-btn js-limpar">Limpar filtros</button></div>`;
  }

  /** Desenha (ou redesenha) um cartao contra o recorte atual. */
  function pintar(spec, el, rows) {
    const box = el.querySelector('.js-plot');
    const res = spec.build(rows) || {};

    pintarLegenda(el.querySelector('.js-legend'), res.legend);
    pintarPe(el.querySelector('.js-foot'), res);
    pintarTabela(el.querySelector('.js-table'), res.table);
    el.querySelector('.js-tabela').hidden = !res.table;

    const anterior = instancias.get(spec.id);
    if (anterior) {
      // stop() antes de destroy(): destruir com animacao em curso deixa um
      // callback orfao na fila do Chart.js, que estoura no proximo quadro.
      anterior.stop();
      anterior.destroy();
      instancias.delete(spec.id);
    }

    if (res.vazio) {
      box.style.height = '';
      pintarVazio(box, res.vazioMensagem);
      return;
    }

    // Renderizador livre (mapa, matriz): recebe o elemento e desenha o que quiser.
    if (spec.render) {
      box.style.height = '';
      box.innerHTML = '';
      spec.render(box, rows, res);
      return;
    }

    const altura = typeof spec.height === 'function' ? spec.height(res)
      : (spec.height || alturaAutomatica(res.config));
    box.style.height = `${altura}px`;
    box.innerHTML = '<canvas></canvas>';
    const canvas = box.querySelector('canvas');
    canvas.setAttribute('aria-hidden', 'true');

    const chart = new Chart(canvas, res.config);
    instancias.set(spec.id, chart);

    ligarTooltip(canvas, chart, res.tooltip || padraoTooltip(res));

    if (spec.onPick) {
      canvas.style.cursor = 'pointer';
      canvas.addEventListener('click', (ev) => {
        const pontos = chart.getElementsAtEventForMode(ev, 'nearest', ALVO, true);
        if (!pontos.length) return;
        // Fora do despacho do evento: aplicar o filtro destroi este grafico, e
        // o Chart.js ainda esta percorrendo os proprios ouvintes.
        const ponto = pontos[0];
        setTimeout(() => spec.onPick(ponto, chart, res), 0);
      });
    }
  }

  /**
   * Em barras horizontais a altura vem do numero de categorias: uma altura fixa
   * espalharia 5 barras num cartao alto (a espessura e limitada a 24px, o resto
   * viraria ar) ou apertaria 27 barras num cartao baixo.
   */
  function alturaAutomatica(config) {
    if (config?.options?.indexAxis === 'y') {
      return 56 + Math.max(1, config.data.labels.length) * 34;
    }
    return 300;
  }

  /** Tooltip padrao: titulo da categoria + uma linha por serie. */
  function padraoTooltip(res) {
    return (pontos, chart) => {
      const idx = pontos[0].index;
      const titulo = chart.data.titulos?.[idx] ?? chart.data.labels?.[idx] ?? '';
      const linhas = chart.data.datasets
        .filter((d) => d.type !== 'line' || chart.data.datasets.length === 1)
        .map((d) => {
          const v = d.data[idx];
          if (v == null || typeof v === 'object') return '';
          const cor = Array.isArray(d.backgroundColor) ? d.backgroundColor[idx] : (d.backgroundColor || d.borderColor);
          const fmt = res.formatoTip || int;
          return linhaTip(cor, d.label ?? '', fmt(v));
        }).filter(Boolean).join('');
      return `<div class="viz-tip__title">${titulo}</div>${linhas}`
        + (res.notaTip ? `<div class="viz-tip__note">${res.notaTip}</div>` : '');
    };
  }

  /* ------------------------------------------------------------- montagem ---- */

  const montados = new Map();

  /** Monta os cartoes de uma aba dentro do container. */
  function montarAba(container, aba, rows) {
    container.innerHTML = '';
    const grade = document.createElement('div');
    grade.className = 'grid';
    container.appendChild(grade);
    for (const spec of registro.filter((s) => s.aba === aba)) {
      const el = casca(spec);
      grade.appendChild(el);
      montados.set(spec.id, el);
      ligarBotoes(spec, el);
      pintar(spec, el, rows);
    }
  }

  function ligarBotoes(spec, el) {
    const btn = el.querySelector('.js-tabela');
    btn.addEventListener('click', () => {
      const ligado = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', String(!ligado));
      el.querySelector('.js-table').hidden = ligado;
      el.querySelector('.js-plot').hidden = !ligado;
      el.querySelector('.js-legend').hidden = !ligado ? true : !el.querySelector('.js-legend').innerHTML;
    });
  }

  /** Redesenha os cartoes ja montados (chamado a cada mudanca de filtro). */
  function atualizar(rows) {
    for (const [id, el] of montados) {
      if (!el.isConnected) { montados.delete(id); continue; }
      const spec = registro.find((s) => s.id === id);
      if (spec) pintar(spec, el, rows);
    }
  }

  function limparMontados() {
    for (const c of instancias.values()) c.destroy();
    instancias.clear();
    montados.clear();
  }

  return {
    T,
    slot,
    seqColor,
    inkOn,
    rgba,
    registrar,
    montarAba,
    atualizar,
    limparMontados,
    barrasH,
    colunasAgrupadas,
    areaEmpilhada,
    empilhada100,
    dispersao,
    eixoValor,
    eixoCategoria,
    linhaTip,
    mostrarTip,
    esconderTip,
    formato: { int, compact, pct },
  };
}());
