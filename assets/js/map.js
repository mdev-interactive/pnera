/* =============================================================================
   PNERA — mapa do territorio nacional
   Duas camadas sobre o mesmo SVG, gerado de tools/build-uf-map.mjs (malha IBGE):
   1) coropleto por UF — rampa sequencial de um so tom, em que o passo mais claro
      significa "perto de zero" e recua ate a superficie de proposito (por isso
      cada UF leva contorno hairline);
   2) circulos por municipio — AREA proporcional a medida, a leitura fina que o
      coropleto por estado nao da.
   Clique na UF ou no circulo alterna o filtro de estado.
   ========================================================================== */

window.MapaUF = (function () {
  'use strict';

  const { int, meta } = window.PNERA;
  const {
    seqColor, T, rgba, linhaTip, mostrarTip, esconderTip,
  } = window.Viz;

  const SIGLA_NOME = Object.fromEntries(
    Object.entries(meta.ufSiglas || {}).map(([nome, sigla]) => [sigla, nome]),
  );

  /**
   * Raio do circulo em unidades do viewBox (largura 1000), nao pixels de tela.
   * AREA proporcional ao valor — por isso a raiz quadrada.
   */
  const R_MIN = 4;
  const R_MAX = 34;
  const raio = (v, max) => (!v || !max ? 0 : R_MIN + (R_MAX - R_MIN) * Math.sqrt(v / max));

  /** Cor dos circulos: slot categorico proprio, distinto da rampa verde do fundo. */
  const corPonto = () => T.series[3] || T.ink;

  /**
   * Mercator esferico identico ao de tools/build-uf-map.mjs. Os parametros da
   * projecao (`projection`) vem do proprio arquivo gerado, para o ponto cair no
   * mesmo referencial dos paths.
   */
  function projetor(projection) {
    if (!projection) return null;
    const { minX, maxY, scale, pad } = projection;
    return (lat, lon) => {
      const x = (lon * Math.PI) / 180;
      const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
      return [(x - minX) * scale + pad, (maxY - y) * scale + pad];
    };
  }

  /**
   * Desenha o mapa. `valores` e um Map sigla -> { valor, cursos, nome }.
   * `pontos` e a lista de municipios ({ nome, uf, lat, lon, valor, cursos }) e
   * `maxPonto` o maior valor entre eles — a escala dos circulos.
   * `onPick(nomeDaUf)` recebe o clique; `ativos` e o Set de UFs filtradas.
   */
  function desenhar(box, {
    valores, rotuloMedida, onPick, ativos, pontos = [], maxPonto = 0,
  }) {
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
    svg.setAttribute('aria-label', `Mapa do Brasil: ${rotuloMedida} por unidade federativa no preenchimento dos estados`
      + ` e por município nos círculos, com área proporcional ao valor. Os números estão na tabela deste cartão.`);

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

    // Circulos por municipio, por cima das siglas. Do maior para o menor, para
    // que um municipio pequeno nunca fique escondido sob o vizinho grande.
    const projetar = projetor(mapa.projection);
    const desenhados = [];
    if (projetar && pontos.length && maxPonto > 0) {
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', 'map-dots');
      const cor = corPonto();

      for (const p of [...pontos].sort((a, b) => (b.valor || 0) - (a.valor || 0))) {
        const r = raio(p.valor, maxPonto);
        if (!r) continue;
        const [cx, cy] = projetar(p.lat, p.lon);
        const nomeUf = SIGLA_NOME[p.uf] || p.uf;
        const rotulo = `${p.nome} (${p.uf})`;

        const c = document.createElementNS(svgNS, 'circle');
        c.setAttribute('cx', cx.toFixed(1));
        c.setAttribute('cy', cy.toFixed(1));
        c.setAttribute('r', r.toFixed(1));
        c.setAttribute('class', 'map-dot');
        c.setAttribute('fill', rgba(cor, 0.72));
        c.setAttribute('tabindex', '0');
        c.setAttribute('role', 'button');
        c.setAttribute('aria-pressed', String(ativos.has(nomeUf)));
        c.setAttribute('aria-label', `${rotulo}: ${int(p.valor)} ${rotuloMedida}`);

        const conteudoTip = () => `<div class="viz-tip__title">${rotulo}</div>`
          + linhaTip(cor, rotuloMedida, int(p.valor))
          + linhaTip(null, 'cursos', int(p.cursos ?? 0))
          + `<div class="viz-tip__note">Clique para ${ativos.has(nomeUf) ? 'remover' : 'aplicar'} o filtro de ${nomeUf}</div>`;

        c.addEventListener('mousemove', (ev) => mostrarTip(conteudoTip(), ev.clientX, ev.clientY));
        c.addEventListener('mouseleave', esconderTip);
        c.addEventListener('click', () => onPick(nomeUf));
        c.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(nomeUf); }
        });
        c.addEventListener('focus', () => {
          const b = c.getBoundingClientRect();
          mostrarTip(conteudoTip(), b.right, b.top + b.height / 2);
        });
        c.addEventListener('blur', esconderTip);

        g.appendChild(c);
        desenhados.push(p);
      }
      svg.appendChild(g);
    }

    wrap.appendChild(svg);
    wrap.appendChild(legenda(max, rotuloMedida));
    if (desenhados.length) wrap.appendChild(legendaPontos(maxPonto, rotuloMedida));
    if (!projetar && pontos.length) {
      const aviso = document.createElement('p');
      aviso.className = 'muted';
      aviso.innerHTML = 'Camada de municípios indisponível: a geometria em cache não traz a projeção. '
        + 'Rode <code>node tools/build-uf-map.mjs</code>.';
      wrap.appendChild(aviso);
    }
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

  /**
   * Escala dos circulos: tres aneis concentricos apoiados na mesma base, com o
   * valor anotado a direita de cada um por uma linha guia. Como a area e
   * proporcional ao valor, os degraus max, max/4 e max/16 dao raios 1, 1/2 e
   * 1/4 — a progressao que a legenda do III PNERA usa.
   */
  function legendaPontos(max, rotuloMedida) {
    const el = document.createElement('div');
    el.className = 'scale-legend dots-legend';

    const degraus = [max, Math.round(max / 4), Math.round(max / 16)]
      .map((v) => Math.max(1, v))
      .filter((v, i, arr) => arr.indexOf(v) === i);

    const rMax = 22;
    const gutter = 42; // faixa a direita, para as linhas guia e os numeros
    const larg = rMax * 2 + 2 + gutter;
    const alt = rMax * 2 + 2;
    const cx = rMax + 1;
    const cor = corPonto();

    const aneis = degraus.map((v) => {
      const r = rMax * Math.sqrt(v / max);
      const topo = alt - 1 - r * 2; // aneis tangentes pela borda de baixo
      return `<circle cx="${cx}" cy="${(alt - 1 - r).toFixed(1)}" r="${r.toFixed(1)}"
          fill="${rgba(cor, 0.16)}" stroke="${cor}" stroke-width="1"></circle>`
        + `<line x1="${cx}" y1="${topo.toFixed(1)}" x2="${cx + rMax + 6}" y2="${topo.toFixed(1)}"
          stroke="${cor}" stroke-width="0.75" stroke-dasharray="2 2"></line>`
        + `<text x="${cx + rMax + 9}" y="${topo.toFixed(1)}" class="dots-legend__num">${int(v)}</text>`;
    }).join('');

    el.innerHTML = `<span>${rotuloMedida} por município:</span>`
      + `<svg class="dots-legend__svg" viewBox="0 0 ${larg} ${alt}" width="${larg}" height="${alt}"`
      + ` role="img" aria-label="Escala dos círculos: ${degraus.map((v) => int(v)).reverse().join(', ')} ${rotuloMedida}">${aneis}</svg>`;
    return el;
  }

  return { desenhar };
}());
