/* =============================================================================
   PNERA — mapa coropletico por UF
   SVG das 27 unidades federativas gerado de tools/build-uf-map.mjs (malha IBGE).
   Rampa sequencial de um so tom: o passo mais claro significa "perto de zero" e
   recua ate a superficie de proposito — por isso cada UF leva contorno hairline.
   Clique na UF alterna o filtro de estado.
   ========================================================================== */

window.MapaUF = (function () {
  'use strict';

  const { int, meta } = window.PNERA;
  const { seqColor, T, linhaTip, mostrarTip, esconderTip } = window.Viz;

  const SIGLA_NOME = Object.fromEntries(
    Object.entries(meta.ufSiglas || {}).map(([nome, sigla]) => [sigla, nome]),
  );

  /**
   * Desenha o mapa. `valores` e um Map sigla -> { valor, cursos, nome }.
   * `onPick(nomeDaUf)` recebe o clique; `ativos` e o Set de UFs filtradas.
   */
  function desenhar(box, { valores, rotuloMedida, onPick, ativos }) {
    const mapa = window.UF_MAP;
    if (!mapa) {
      box.innerHTML = '<p class="muted">Geometria do mapa não encontrada. Rode <code>node tools/build-uf-map.mjs</code>.</p>';
      return;
    }

    const max = Math.max(0, ...[...valores.values()].map((v) => v.valor || 0));

    const wrap = document.createElement('div');
    wrap.className = 'map-wrap';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', mapa.viewBox);
    svg.setAttribute('class', 'map-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Mapa do Brasil: ${rotuloMedida} por unidade federativa. Os números estão na tabela deste cartão.`);

    // Guias das etiquetas primeiro, para ficarem sob o desenho dos estados.
    for (const [sigla, lab] of Object.entries(mapa.labels)) {
      if (!lab.outside) continue;
      const linha = document.createElementNS(svgNS, 'line');
      linha.setAttribute('x1', lab.from[0]);
      linha.setAttribute('y1', lab.from[1]);
      linha.setAttribute('x2', lab.x - 3);
      linha.setAttribute('y2', lab.y);
      linha.setAttribute('class', 'map-leader');
      svg.appendChild(linha);
      void sigla;
    }

    const preenchimento = new Map();

    for (const [sigla, d] of Object.entries(mapa.paths)) {
      const nome = SIGLA_NOME[sigla] || sigla;
      const info = valores.get(sigla);
      const valor = info?.valor ?? null;
      const fill = valor ? seqColor(valor, max) : T.seqEmpty;
      preenchimento.set(sigla, fill);

      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', `map-uf${ativos.has(nome) ? ' is-active' : ''}`);
      path.setAttribute('fill', fill);
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-pressed', String(ativos.has(nome)));
      path.setAttribute('aria-label', `${nome}: ${valor == null ? 'sem dados' : int(valor)} ${rotuloMedida}`);

      const conteudoTip = () => `<div class="viz-tip__title">${nome}</div>`
        + linhaTip(fill, rotuloMedida, valor == null ? 'sem dados' : int(valor))
        + linhaTip(null, 'cursos', int(info?.cursos ?? 0))
        + `<div class="viz-tip__note">Clique para ${ativos.has(nome) ? 'remover' : 'aplicar'} o filtro</div>`;

      path.addEventListener('mousemove', (ev) => mostrarTip(conteudoTip(), ev.clientX, ev.clientY));
      path.addEventListener('mouseleave', esconderTip);
      path.addEventListener('click', () => onPick(nome));
      path.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(nome); }
      });
      path.addEventListener('focus', () => {
        const r = path.getBoundingClientRect();
        mostrarTip(conteudoTip(), r.right, r.top + r.height / 2);
      });
      path.addEventListener('blur', esconderTip);

      svg.appendChild(path);
    }

    // Etiquetas por cima de tudo. Dentro do estado a sigla e a excecao em que o
    // texto vai sobre um preenchimento colorido: a cor sai da luminancia do
    // fundo, para clarear onde o verde e escuro. Fora, tinta de texto normal.
    for (const [sigla, lab] of Object.entries(mapa.labels)) {
      const texto = document.createElementNS(svgNS, 'text');
      texto.setAttribute('x', lab.x);
      texto.setAttribute('y', lab.y);
      texto.setAttribute('class', `map-label${lab.outside ? ' map-label--outside' : ''}`);
      // style inline, nao atributo: um atributo `fill` perde para a regra
      // `.map-label { fill: ... }` do CSS e a sigla ficaria ilegivel no verde escuro.
      if (!lab.outside) texto.style.fill = window.Viz.inkOn(preenchimento.get(sigla));
      texto.textContent = sigla;
      svg.appendChild(texto);
    }

    wrap.appendChild(svg);
    wrap.appendChild(legenda(max, rotuloMedida));
    box.appendChild(wrap);
  }

  /** Escala do mapa: faixas da rampa com os limites em numero. */
  function legenda(max, rotuloMedida) {
    const el = document.createElement('div');
    el.className = 'scale-legend';
    const passos = T.seq.length;
    const faixas = T.seq.map((cor, i) => {
      const de = Math.round((max / passos) * i) + (i ? 1 : 0);
      const ate = Math.round((max / passos) * (i + 1));
      return `<span class="scale-legend__step" style="background:${cor}" title="${int(de)} a ${int(ate)} ${rotuloMedida}"></span>`;
    }).join('');
    el.innerHTML = `<span>${rotuloMedida}:</span><span>0</span>`
      + `<span class="scale-legend__steps">${faixas}</span>`
      + `<span>${int(max)}</span>`
      + `<span class="scale-legend__step" style="background:${T.seqEmpty}" title="Sem cursos no recorte"></span>`
      + `<span>sem cursos</span>`;
    return el;
  }

  return { desenhar };
}());
