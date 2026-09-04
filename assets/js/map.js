/* =============================================================================
   PNERA — mapa do territorio nacional
   Um so SVG, gerado de tools/build-uf-map.mjs (malha IBGE), monocromatico:
   a malha das UFs e apenas base — preenchimento neutro uniforme, com as divisas
   em contorno hairline — e o dado inteiro vive nos circulos por municipio, de
   AREA proporcional a medida. Sem rampa de cor e sem siglas: um fundo calado
   deixa a nuvem de circulos ser lida de uma vez, como no mapa do III PNERA.
   Clique na UF ou no circulo alterna o filtro de estado.

   Junto vem o aparato de leitura, tambem em unidades do viewBox: cruzetas de
   coordenada, seta de norte, escala grafica em km e a legenda dos circulos.
   Fica tudo dentro do SVG de proposito — assim o mapa continua completo se
   virar imagem, e o aparato acompanha qualquer largura de tela.
   ========================================================================== */

window.MapaUF = (function () {
  'use strict';

  const { int, meta } = window.PNERA;
  const {
    T, rgba, linhaTip, mostrarTip, esconderTip,
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

  /** Cor dos circulos: a unica tinta de dado do mapa. */
  const corPonto = () => T.series[3] || T.ink;

  /** Base neutra da malha. A UF filtrada escurece um passo, sem mudar de matiz. */
  const corUf = (ativa) => (ativa ? T.borderStrong : T.seqEmpty);

  const svgNS = 'http://www.w3.org/2000/svg';

  /** Cria elemento SVG com atributos, para o aparato nao virar dez linhas cada. */
  function el(tag, attrs) {
    const node = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function texto(conteudo, attrs) {
    const node = el('text', attrs);
    node.textContent = conteudo;
    return node;
  }

  /**
   * Peca do aparato: grupo com ancora declarada, para `ajustarAparato` poder
   * escalar a peca inteira em torno dela — geometria e texto juntos.
   */
  function peca(pai, ax, ay) {
    const g = el('g', { 'data-anchor': `${ax},${ay}` });
    pai.appendChild(g);
    return g;
  }

  /**
   * O aparato e desenhado em unidades do viewBox (largura 1000), calibrado para
   * o cartao largo: ali o SVG sai a ~600 px e o rotulo de 19 unidades vira
   * ~11 px de tela. Quando a grade colapsa, o mesmo SVG cai para ~360 px e o
   * texto ficaria em 7 px. Escalar so a fonte quebraria o encaixe (numero da
   * escala mais largo que o segmento), entao cada peca cresce por inteiro, em
   * torno da propria ancora — a razao entre texto, barra e cruzeta se mantem.
   */
  const PX_POR_UNIDADE = 0.58; // alvo: 19 unidades ≈ 11 px de tela
  const K_MAX = 2.2;

  function ajustarAparato(svg) {
    if (!svg) return;
    const largura = svg.getBoundingClientRect().width;
    const mapWidth = Number(svg.viewBox?.baseVal?.width) || 1000;
    if (!largura) return; // fora da tela ainda: nada a medir
    const k = Math.min(K_MAX, Math.max(1, PX_POR_UNIDADE / (largura / mapWidth)));
    for (const g of svg.querySelectorAll('[data-anchor]')) {
      const [ax, ay] = g.dataset.anchor.split(',').map(Number);
      if (k === 1) g.removeAttribute('transform');
      else g.setAttribute('transform', `translate(${ax} ${ay}) scale(${k.toFixed(3)}) translate(${-ax} ${-ay})`);
    }
  }

  // Um listener para o modulo inteiro: o cartao e remontado a cada filtro, e
  // observar o proprio SVG deixaria um ResizeObserver orfao por remontagem.
  let reajuste = null;
  window.addEventListener('resize', () => {
    if (reajuste) cancelAnimationFrame(reajuste);
    reajuste = requestAnimationFrame(() => {
      reajuste = null;
      ajustarAparato(document.querySelector('.map-svg'));
    });
  });

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

    const wrap = document.createElement('div');
    wrap.className = 'map-wrap';

    const svg = document.createElementNS(svgNS, 'svg');
    // A faixa livre a direita do viewBox gerado existia para as etiquetas das
    // UFs pequenas. Sem siglas, ela e so vazio: o recorte volta a largura do
    // desenho e o mapa ganha esses ~9%.
    const alturaViewBox = Number(mapa.viewBox.split(/\s+/)[3]);
    svg.setAttribute('viewBox', `0 0 ${mapa.mapWidth} ${alturaViewBox}`);
    svg.setAttribute('class', 'map-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Mapa do Brasil: ${rotuloMedida} por município,`
      + ` cada círculo com área proporcional ao valor. Os números estão na tabela deste cartão.`);

    for (const [sigla, d] of Object.entries(mapa.paths)) {
      const nome = SIGLA_NOME[sigla] || sigla;
      const info = valores.get(sigla);
      const valor = info?.valor ?? null;
      const ativa = ativos.has(nome);

      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', `map-uf${ativa ? ' is-active' : ''}`);
      path.setAttribute('fill', corUf(ativa));
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-pressed', String(ativa));
      path.setAttribute('aria-label', `${nome}: ${valor == null ? 'sem dados' : int(valor)} ${rotuloMedida}`);

      const conteudoTip = () => `<div class="viz-tip__title">${nome}</div>`
        + linhaTip(null, rotuloMedida, valor == null ? 'sem dados' : int(valor))
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

    const projetar = projetor(mapa.projection);

    // Aparato cartografico antes dos circulos: o dado sempre por cima. Inerte
    // ao ponteiro (CSS), senao roubaria clique e tooltip da malha e dos pontos.
    if (projetar) {
      const aparato = el('g', { class: 'map-furniture', 'aria-hidden': 'true' });
      cruzetas(aparato, projetar);
      norte(aparato);
      escala(aparato, mapa.projection);
      svg.appendChild(aparato);
    }

    // Circulos por municipio, por cima da malha. Do maior para o menor, para
    // que um municipio pequeno nunca fique escondido sob o vizinho grande.
    const desenhados = [];
    if (projetar && pontos.length && maxPonto > 0) {
      const g = el('g', { class: 'map-dots' });
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

    // Legenda por ultimo, no canto vazio a sudoeste: precisa ficar por cima de
    // qualquer circulo que caia ali (o Paraguai e vazio, mas a Argentina nao).
    if (desenhados.length) svg.appendChild(legendaPontos(maxPonto, rotuloMedida));

    wrap.appendChild(svg);
    if (!projetar && pontos.length) {
      const aviso = document.createElement('p');
      aviso.className = 'muted';
      aviso.innerHTML = 'Camada de municípios indisponível: a geometria em cache não traz a projeção. '
        + 'Rode <code>node tools/build-uf-map.mjs</code>.';
      wrap.appendChild(aviso);
    }
    box.appendChild(wrap);
    // Depois de entrar no DOM: so agora o SVG tem largura para medir.
    ajustarAparato(svg);
  }

  /* ------------------------------------------------ aparato cartografico ---- */

  /**
   * Cruzetas de coordenada. Sao quatro, emoldurando o desenho, no arranjo do
   * mapa do III PNERA — e todas caem em area vazia (Colombia, Atlantico,
   * Paraguai), por isso nao escondem nem estado nem circulo. `fora` diz para
   * que lado o rotulo foge do desenho.
   */
  const MARCAS = [
    // 70° O e nao 72° como no impresso: a etiqueta do 72 ficaria a esquerda da
    // borda do viewBox, que aqui e justa (o impresso tinha margem larga).
    { lat: 0, lon: -70, fora: 'esq' },
    // A do canto nordeste vai para dentro: aquele canto e do norte, e a 1,6x a
    // etiqueta para fora encostava no "N".
    { lat: 0, lon: -40, fora: 'esq' },
    { lat: -25, lon: -60, fora: 'esq' },
    { lat: -25, lon: -40, fora: 'dir' },
  ];
  const BRACO = 11; // meio-braco da cruzeta, em unidades do viewBox

  /** Formato da referencia: hemisferio em minuscula antes do grau. */
  const grauLat = (lat) => (lat === 0 ? '0°' : `${lat < 0 ? 's' : 'n'} ${Math.abs(lat)}°`);
  const grauLon = (lon) => (lon === 0 ? '0°' : `${lon < 0 ? 'o' : 'l'} ${Math.abs(lon)}°`);

  function cruzetas(pai, projetar) {
    for (const { lat, lon, fora } of MARCAS) {
      const [x, y] = projetar(lat, lon);
      const g = peca(pai, x, y);
      g.appendChild(el('line', {
        x1: (x - BRACO).toFixed(1), y1: y.toFixed(1), x2: (x + BRACO).toFixed(1), y2: y.toFixed(1),
      }));
      g.appendChild(el('line', {
        x1: x.toFixed(1), y1: (y - BRACO).toFixed(1), x2: x.toFixed(1), y2: (y + BRACO).toFixed(1),
      }));

      // Latitude acima do braco, longitude abaixo: duas linhas curtas leem
      // melhor que uma etiqueta longa colada na cruzeta.
      const dx = fora === 'esq' ? -(BRACO + 4) : BRACO + 4;
      const anchor = fora === 'esq' ? 'end' : 'start';
      g.appendChild(texto(grauLat(lat), {
        x: (x + dx).toFixed(1), y: (y - 13).toFixed(1), 'text-anchor': anchor, class: 'map-furniture__label',
      }));
      g.appendChild(texto(grauLon(lon), {
        x: (x + dx).toFixed(1), y: (y + 13).toFixed(1), 'text-anchor': anchor, class: 'map-furniture__label',
      }));
    }
  }

  /**
   * Norte. Em Mercator sem rotacao o norte e a vertical exata, entao uma seta
   * resolve — rosa dos ventos de 16 pontas, neste tamanho, viraria borrao.
   */
  const NORTE = { x: 942, y: 30 };

  function norte(pai) {
    const { x, y } = NORTE;
    const g = peca(pai, x, y); // cresce para baixo, preso ao canto
    g.appendChild(el('path', {
      d: `M${x},${y}L${x - 14},${y + 44}L${x},${y + 32}L${x + 14},${y + 44}Z`,
      class: 'map-furniture__arrow',
    }));
    g.appendChild(texto('N', {
      x, y: y + 74, 'text-anchor': 'middle', class: 'map-furniture__north',
    }));
  }

  /**
   * Escala grafica. O comprimento sai da propria projecao, nunca de numero
   * fixo: se a malha ou a largura do gerador mudarem, a barra acompanha.
   *
   * Mercator nao tem escala unica — a mesma unidade vale 4,43 km no equador e
   * 3,83 km em 30° S. A barra e calculada em LAT_ESCALA, a latitude media da
   * nuvem de pontos, e a nota ao lado declara isso; sem declarar, a barra seria
   * uma afirmacao falsa em metade do mapa.
   */
  const R_TERRA = 6371.0088; // raio medio, km
  const LAT_ESCALA = -15;
  const ESCALA = { x: 762, y: 962, passos: 4, kmPorPasso: 200, alt: 12 };

  function escala(pai, projection) {
    const kmPorUnidade = (R_TERRA * Math.cos((LAT_ESCALA * Math.PI) / 180)) / projection.scale;
    const passo = ESCALA.kmPorPasso / kmPorUnidade;
    const { x, y, passos, alt } = ESCALA;
    // Ancora na ponta direita: ampliada, a barra cresce para dentro do mapa e
    // nao estoura a borda do viewBox.
    const g = peca(pai, x + passo * passos, y);

    // Segmentos cheios primeiro, moldura por cima: assim os vazios ficam com a
    // mesma borda dos cheios e a barra le como uma peca so.
    for (let i = 0; i < passos; i += 2) {
      g.appendChild(el('rect', {
        x: (x + passo * i).toFixed(1), y, width: passo.toFixed(1), height: alt,
        class: 'map-scale__seg',
      }));
    }
    g.appendChild(el('rect', {
      x, y, width: (passo * passos).toFixed(1), height: alt, class: 'map-scale__frame',
    }));
    for (let i = 0; i <= passos; i++) {
      g.appendChild(texto(int(i * ESCALA.kmPorPasso), {
        x: (x + passo * i).toFixed(1), y: y - 15, 'text-anchor': 'middle', class: 'map-furniture__label',
      }));
    }
    g.appendChild(texto(`km · em ${Math.abs(LAT_ESCALA)}° S`, {
      x: x.toFixed(1), y: y + alt + 20, 'text-anchor': 'start', class: 'map-furniture__label',
    }));
  }

  /**
   * Legenda dos circulos, no canto vazio a sudoeste: tres aneis concentricos
   * apoiados na mesma base, com o valor anotado a direita por uma linha guia.
   * Como a area e proporcional ao valor, os degraus max, max/4 e max/16 dao
   * raios 1, 1/2 e 1/4 — a progressao que a legenda do III PNERA usa.
   */
  const LEGENDA = { x: 92, base: 1012 }; // x = centro dos aneis; base = borda de baixo

  function legendaPontos(max, rotuloMedida) {
    const degraus = [max, Math.round(max / 4), Math.round(max / 16)]
      .map((v) => Math.max(1, v))
      .filter((v, i, arr) => arr.indexOf(v) === i);

    const rMax = raio(max, max); // o maior circulo do mapa, sem inventar escala
    const { x, base } = LEGENDA;
    const cor = corPonto();

    const wrap = el('g', {
      class: 'map-legend',
      role: 'img',
      'aria-label': `Escala dos círculos: ${degraus.map((v) => int(v)).reverse().join(', ')} ${rotuloMedida}`,
    });
    // Ancora no canto inferior esquerdo: ampliada, a legenda cresce para dentro.
    const g = peca(wrap, x - rMax, base);

    g.appendChild(texto(`${rotuloMedida} por município`, {
      x: (x - rMax).toFixed(1), y: (base - rMax * 2 - 26).toFixed(1), class: 'map-legend__title',
    }));

    // Os dois aneis menores tem o topo perto demais (raios 1/2 e 1/4 do maior):
    // o numero desce o minimo para nao colidir e a guia acompanha, inclinada.
    const MIN_VAO = 25;
    let ultimoRotulo = -Infinity;

    for (const v of degraus) {
      const r = rMax * Math.sqrt(v / max);
      const topo = base - r * 2; // aneis tangentes pela borda de baixo
      const yRotulo = Math.max(topo, ultimoRotulo + MIN_VAO);
      ultimoRotulo = yRotulo;

      g.appendChild(el('circle', {
        cx: x, cy: (base - r).toFixed(1), r: r.toFixed(1),
        fill: rgba(cor, 0.16), stroke: cor, 'stroke-width': 1,
      }));
      g.appendChild(el('line', {
        x1: x, y1: topo.toFixed(1), x2: (x + rMax + 8).toFixed(1), y2: yRotulo.toFixed(1),
        stroke: cor, 'stroke-width': 0.75, 'stroke-dasharray': '3 3',
      }));
      g.appendChild(texto(int(v), {
        x: (x + rMax + 12).toFixed(1), y: yRotulo.toFixed(1), class: 'map-legend__num',
      }));
    }
    return wrap;
  }

  return { desenhar };
}());
