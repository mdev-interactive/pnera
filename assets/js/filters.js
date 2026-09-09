/* =============================================================================
   PNERA — estado de filtros
   Um unico painel de filtros governa todos os visuais (nunca filtro por cartao).
   Os filtros sao cruzados: as opcoes de cada dimensao sao recontadas contra o
   recorte das *outras* dimensoes, para nao oferecer combinacoes que dao zero.
   ========================================================================== */

window.Filters = (function () {
  'use strict';

  const { data, meta, DIMENSOES, fold, haystack } = window.PNERA;

  const DIMS = Object.keys(DIMENSOES);
  const ANO_MIN = meta.periodo?.anoMin ?? 1998;
  const ANO_MAX = meta.periodo?.anoInicioMax ?? 2026;

  /** Faixa de matriculados: extremos reais da base, nao um teto arbitrario. */
  const mats = data.map((c) => c.matriculados).filter((v) => Number.isFinite(v));
  const MAT_MIN = mats.length ? Math.min(...mats) : 0;
  const MAT_MAX = mats.length ? Math.max(...mats) : 0;

  /**
   * Dimensoes que nascem com todas as opcoes marcadas. Para elas a selecao
   * cheia *e* o estado neutro: nao vira chip, nao vai para a URL e é o que
   * "Limpar tudo" restaura. Como todo curso tem um valor dessas dimensoes,
   * marcar tudo dá o mesmo recorte que não filtrar nada.
   */
  const TODOS_POR_PADRAO = new Set(['areaConhecimento', 'superintendencia']);
  const universo = (dim) => meta.valores?.[dim] ?? [];
  const padrao = (dim) => new Set(TODOS_POR_PADRAO.has(dim) ? universo(dim) : []);

  /** A dimensao esta no seu estado neutro (nada escolhido, ou tudo escolhido). */
  function ehPadrao(dim) {
    const sel = state.selecao[dim];
    if (!TODOS_POR_PADRAO.has(dim)) return sel.size === 0;
    const todos = universo(dim);
    return sel.size === todos.length && todos.every((v) => sel.has(v));
  }

  const state = {
    selecao: Object.fromEntries(DIMS.map((d) => [d, padrao(d)])),
    anoDe: ANO_MIN,
    anoAte: ANO_MAX,
    matDe: MAT_MIN,
    matAte: MAT_MAX,
    busca: '',
    aba: 'geral',
  };

  const ouvintes = new Set();
  const subscribe = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };

  /* ------------------------------------------------------------- predicados -- */

  /**
   * Um curso passa por uma dimensao se nada foi escolhido ou se casa a escolha.
   * Nos grupos que nascem cheios, porem, "nada marcado" é uma escolha do
   * usuario (ele desmarcou tudo) e nao deixa passar nenhum curso.
   */
  function casaDimensao(curso, dim) {
    const escolhidos = state.selecao[dim];
    if (!escolhidos.size) return !TODOS_POR_PADRAO.has(dim);
    const valor = DIMENSOES[dim].get(curso);
    if (Array.isArray(valor)) return valor.some((v) => escolhidos.has(v));
    return escolhidos.has(valor);
  }

  /**
   * Faixa de anos: o curso entra se qualquer parte da sua vigencia toca a faixa.
   * Cursos sem ano de inicio nao sao descartados quando a faixa esta inteira —
   * so quando o usuario realmente estreitou o periodo.
   */
  function casaPeriodo(curso) {
    const cheia = state.anoDe <= ANO_MIN && state.anoAte >= ANO_MAX;
    if (cheia) return true;
    const de = curso.anoInicio;
    const ate = curso.anoFim ?? curso.anoInicio;
    if (de == null) return false;
    return de <= state.anoAte && (ate ?? de) >= state.anoDe;
  }

  /**
   * Faixa de matriculados. Como no periodo, cursos sem o numero informado so
   * caem fora quando o usuario realmente estreitou a faixa.
   */
  function casaMatriculados(curso) {
    if (state.matDe <= MAT_MIN && state.matAte >= MAT_MAX) return true;
    const n = curso.matriculados;
    if (!Number.isFinite(n)) return false;
    return n >= state.matDe && n <= state.matAte;
  }

  function casaBusca(curso) {
    if (!state.busca) return true;
    const termos = fold(state.busca).split(/\s+/).filter(Boolean);
    const hay = haystack(curso);
    return termos.every((t) => hay.includes(t));
  }

  /** Recorte atual. `exceto` deixa uma dimensao de fora (usado no cruzamento). */
  function aplicar(exceto = null) {
    return data.filter((c) => {
      if (!casaPeriodo(c) || !casaMatriculados(c) || !casaBusca(c)) return false;
      for (const d of DIMS) {
        if (d === exceto) continue;
        if (!casaDimensao(c, d)) return false;
      }
      return true;
    });
  }

  let cacheRecorte = null;
  const recorte = () => (cacheRecorte ??= aplicar());

  /**
   * Opcoes de uma dimensao com a contagem que ela teria se fosse escolhida.
   * Valores que zeram continuam listados (marcados como vazios) — esconder
   * opcoes faz a lista pular embaixo do cursor.
   */
  function opcoes(dim) {
    const base = aplicar(dim);
    const contagem = new Map();
    for (const c of base) {
      const valor = DIMENSOES[dim].get(c);
      for (const v of Array.isArray(valor) ? valor : [valor]) {
        if (v) contagem.set(v, (contagem.get(v) ?? 0) + 1);
      }
    }
    const universo = meta.valores?.[dim] ?? [...contagem.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return universo.map((valor) => ({
      valor,
      n: contagem.get(valor) ?? 0,
      escolhido: state.selecao[dim].has(valor),
    }));
  }

  /* ---------------------------------------------------------------- mutacao -- */

  function notificar() {
    cacheRecorte = null;
    const rows = recorte();
    for (const fn of ouvintes) fn(rows, state);
    gravarUrl();
  }

  function alternar(dim, valor, forcar) {
    const set = state.selecao[dim];
    const ligado = forcar === undefined ? !set.has(valor) : forcar;
    if (ligado) set.add(valor); else set.delete(valor);
    notificar();
  }

  function definir(dim, valores) {
    state.selecao[dim] = new Set(valores);
    notificar();
  }

  function limpar(dim) {
    if (dim) {
      state.selecao[dim] = padrao(dim);
    } else {
      for (const d of DIMS) state.selecao[d] = padrao(d);
      state.anoDe = ANO_MIN;
      state.anoAte = ANO_MAX;
      state.matDe = MAT_MIN;
      state.matAte = MAT_MAX;
      state.busca = '';
    }
    notificar();
  }

  function periodo(de, ate) {
    state.anoDe = Math.max(ANO_MIN, Math.min(de, ate));
    state.anoAte = Math.min(ANO_MAX, Math.max(de, ate));
    notificar();
  }

  function matriculas(de, ate) {
    state.matDe = Math.max(MAT_MIN, Math.min(de, ate));
    state.matAte = Math.min(MAT_MAX, Math.max(de, ate));
    notificar();
  }

  function buscar(texto) {
    state.busca = texto.trim();
    notificar();
  }

  function aba(id) {
    state.aba = id;
    gravarUrl();
  }

  /** Lista plana do que esta ativo, para a barra de chips. */
  function ativos() {
    const out = [];
    for (const d of DIMS) {
      if (ehPadrao(d)) continue;
      if (!state.selecao[d].size) {
        // Grupo cheio que ficou sem nenhuma marca: sem chip o usuario veria
        // zero cursos sem nada explicando por que.
        out.push({ tipo: 'dim-vazio', dim: d, rotulo: DIMENSOES[d].rotulo, valor: 'nenhuma marcada' });
        continue;
      }
      for (const v of state.selecao[d]) out.push({ tipo: 'dim', dim: d, rotulo: DIMENSOES[d].rotulo, valor: v });
    }
    if (state.anoDe > ANO_MIN || state.anoAte < ANO_MAX) {
      out.push({ tipo: 'periodo', rotulo: 'Período', valor: `${state.anoDe}–${state.anoAte}` });
    }
    if (state.matDe > MAT_MIN || state.matAte < MAT_MAX) {
      out.push({ tipo: 'matriculas', rotulo: 'Matrículas', valor: `${state.matDe}–${state.matAte}` });
    }
    if (state.busca) out.push({ tipo: 'busca', rotulo: 'Busca', valor: state.busca });
    return out;
  }

  const temFiltro = () => ativos().length > 0;

  /* -------------------------------------------------------------------- URL -- */

  let ignorarHash = false;

  /** Marca de "nenhuma opcao marcada" na URL, para grupos que nascem cheios. */
  const NENHUM = '∅';

  function gravarUrl() {
    const p = new URLSearchParams();
    p.set('aba', state.aba);
    for (const d of DIMS) {
      if (ehPadrao(d)) continue;
      // Grupo que nasce cheio e ficou sem nenhuma marca: precisa de um valor
      // proprio na URL, senao ao recarregar ele voltaria ao padrao (cheio).
      p.set(d, state.selecao[d].size ? [...state.selecao[d]].join('~') : NENHUM);
    }
    if (state.anoDe > ANO_MIN) p.set('de', state.anoDe);
    if (state.anoAte < ANO_MAX) p.set('ate', state.anoAte);
    if (state.matDe > MAT_MIN) p.set('mde', state.matDe);
    if (state.matAte < MAT_MAX) p.set('mate', state.matAte);
    if (state.busca) p.set('q', state.busca);
    ignorarHash = true;
    history.replaceState(null, '', `#${p.toString()}`);
    setTimeout(() => { ignorarHash = false; }, 0);
  }

  /** Le o hash da URL para restaurar aba, filtros e busca ao recarregar. */
  function lerUrl() {
    const hash = location.hash.replace(/^#/, '');
    if (!hash) return;
    const p = new URLSearchParams(hash);
    for (const d of DIMS) {
      const raw = p.get(d);
      if (raw === NENHUM) state.selecao[d] = new Set();
      else if (raw) state.selecao[d] = new Set(raw.split('~').filter(Boolean));
      else state.selecao[d] = padrao(d);
    }
    const de = Number(p.get('de'));
    const ate = Number(p.get('ate'));
    if (Number.isFinite(de) && de) state.anoDe = Math.max(ANO_MIN, de);
    if (Number.isFinite(ate) && ate) state.anoAte = Math.min(ANO_MAX, ate);
    const mde = Number(p.get('mde'));
    const mate = Number(p.get('mate'));
    state.matDe = p.has('mde') && Number.isFinite(mde) ? Math.max(MAT_MIN, mde) : MAT_MIN;
    state.matAte = p.has('mate') && Number.isFinite(mate) ? Math.min(MAT_MAX, mate) : MAT_MAX;
    state.busca = p.get('q') || '';
    state.aba = p.get('aba') || 'geral';
    cacheRecorte = null;
  }

  window.addEventListener('hashchange', () => {
    if (ignorarHash) return;
    lerUrl();
    notificar();
    document.dispatchEvent(new CustomEvent('pnera:aba', { detail: state.aba }));
  });

  return {
    state,
    DIMS,
    ANO_MIN,
    ANO_MAX,
    MAT_MIN,
    MAT_MAX,
    subscribe,
    recorte,
    opcoes,
    alternar,
    definir,
    limpar,
    periodo,
    matriculas,
    buscar,
    aba,
    ativos,
    temFiltro,
    lerUrl,
    notificar,
  };
}());
