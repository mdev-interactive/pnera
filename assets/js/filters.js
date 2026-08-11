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

  const state = {
    selecao: Object.fromEntries(DIMS.map((d) => [d, new Set()])),
    anoDe: ANO_MIN,
    anoAte: ANO_MAX,
    busca: '',
    aba: 'geral',
  };

  const ouvintes = new Set();
  const subscribe = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };

  /* ------------------------------------------------------------- predicados -- */

  /** Um curso passa por uma dimensao se nada foi escolhido ou se casa a escolha. */
  function casaDimensao(curso, dim) {
    const escolhidos = state.selecao[dim];
    if (!escolhidos.size) return true;
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

  function casaBusca(curso) {
    if (!state.busca) return true;
    const termos = fold(state.busca).split(/\s+/).filter(Boolean);
    const hay = haystack(curso);
    return termos.every((t) => hay.includes(t));
  }

  /** Recorte atual. `exceto` deixa uma dimensao de fora (usado no cruzamento). */
  function aplicar(exceto = null) {
    return data.filter((c) => {
      if (!casaPeriodo(c) || !casaBusca(c)) return false;
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
      state.selecao[dim].clear();
    } else {
      for (const d of DIMS) state.selecao[d].clear();
      state.anoDe = ANO_MIN;
      state.anoAte = ANO_MAX;
      state.busca = '';
    }
    notificar();
  }

  function periodo(de, ate) {
    state.anoDe = Math.max(ANO_MIN, Math.min(de, ate));
    state.anoAte = Math.min(ANO_MAX, Math.max(de, ate));
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
      for (const v of state.selecao[d]) out.push({ tipo: 'dim', dim: d, rotulo: DIMENSOES[d].rotulo, valor: v });
    }
    if (state.anoDe > ANO_MIN || state.anoAte < ANO_MAX) {
      out.push({ tipo: 'periodo', rotulo: 'Período', valor: `${state.anoDe}–${state.anoAte}` });
    }
    if (state.busca) out.push({ tipo: 'busca', rotulo: 'Busca', valor: state.busca });
    return out;
  }

  const temFiltro = () => ativos().length > 0;

  /* -------------------------------------------------------------------- URL -- */

  let ignorarHash = false;

  function gravarUrl() {
    const p = new URLSearchParams();
    p.set('aba', state.aba);
    for (const d of DIMS) {
      if (state.selecao[d].size) p.set(d, [...state.selecao[d]].join('~'));
    }
    if (state.anoDe > ANO_MIN) p.set('de', state.anoDe);
    if (state.anoAte < ANO_MAX) p.set('ate', state.anoAte);
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
      if (raw) state.selecao[d] = new Set(raw.split('~').filter(Boolean));
    }
    const de = Number(p.get('de'));
    const ate = Number(p.get('ate'));
    if (Number.isFinite(de) && de) state.anoDe = Math.max(ANO_MIN, de);
    if (Number.isFinite(ate) && ate) state.anoAte = Math.min(ANO_MAX, ate);
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
    subscribe,
    recorte,
    opcoes,
    alternar,
    definir,
    limpar,
    periodo,
    buscar,
    aba,
    ativos,
    temFiltro,
    lerUrl,
    notificar,
  };
}());
