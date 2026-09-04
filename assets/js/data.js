/* =============================================================================
   PNERA — dados e agregacao
   Os 585 cursos ficam em memoria; todo recorte e recalculado a cada filtro.
   ========================================================================== */

window.PNERA = (function () {
  'use strict';

  const data = window.PNERA_DATA || [];
  const meta = window.PNERA_META || {};

  /* ------------------------------------------------------------ formatacao -- */

  const nf = new Intl.NumberFormat('pt-BR');
  const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /** Inteiro com separador de milhar; "—" quando nao ha dado. */
  const int = (v) => (v == null || Number.isNaN(v) ? '—' : nf.format(Math.round(v)));

  /** Forma compacta para numeros grandes em espaco curto (186,0 mil). */
  function compact(v) {
    if (v == null || Number.isNaN(v)) return '—';
    const n = Math.round(v);
    if (Math.abs(n) >= 1e6) return `${nf1.format(n / 1e6)} mi`;
    if (Math.abs(n) >= 10000) return `${nf1.format(n / 1000)} mil`;
    return nf.format(n);
  }

  const pct = (v, digits = 1) => (v == null || Number.isNaN(v) ? '—'
    : `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)}%`);

  /** Acentos e caixa fora, para busca textual tolerante. */
  const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* -------------------------------------------------------------- acessores -- */

  /** Campos varridos pela busca global. */
  function haystack(c) {
    if (c.__hay === undefined) {
      c.__hay = fold([
        c.nomeProcessual, c.curso, c.ies?.nome, c.municipio, c.uf, c.areaTematica,
        c.modalidade, c.demandante?.nome, c.codigoSei, c.superintendencia,
        ...(c.parceiras?.nomes || []),
        ...(c.coordenadores || []).map((x) => x.nome),
      ].filter(Boolean).join(' '));
    }
    return c.__hay;
  }

  /* ------------------------------------------------------------ agregacao --- */

  /**
   * Agrupa linhas por uma chave e soma as medidas pedidas.
   * Devolve [{ chave, cursos, <medida>: soma, <medida>Base: quantos tinham dado }].
   * Contar a base separado e o que permite dizer "base: 497 de 585" sem tratar
   * ausencia como zero.
   */
  function groupBy(rows, keyOf, measures = []) {
    const acc = new Map();
    for (const row of rows) {
      const keys = keyOf(row);
      for (const chave of Array.isArray(keys) ? keys : [keys]) {
        if (chave == null || chave === '') continue;
        let bucket = acc.get(chave);
        if (!bucket) {
          bucket = { chave, cursos: 0 };
          for (const m of measures) { bucket[m] = 0; bucket[`${m}Base`] = 0; }
          acc.set(chave, bucket);
        }
        bucket.cursos++;
        for (const m of measures) {
          const v = row[m];
          if (v != null) { bucket[m] += v; bucket[`${m}Base`]++; }
        }
      }
    }
    return [...acc.values()];
  }

  const desc = (field) => (a, b) => (b[field] ?? 0) - (a[field] ?? 0)
    || String(a.chave).localeCompare(String(b.chave), 'pt-BR');

  /**
   * Mantem os N maiores. Em graficos de composicao a cauda e somada em "Outros"
   * (cinza — nunca uma 8a cor inventada). Em ranking, `semOutros` descarta a
   * cauda: uma barra "Outros" somando 400 cursos achataria as 12 primeiras e
   * esconderia justamente a comparacao que o ranking existe para mostrar.
   * De um jeito ou de outro `dobradas` diz quantas ficaram de fora, para a
   * interface declarar isso em vez de truncar em silencio.
   */
  function topN(groups, n, field = 'cursos', { rotulo = 'Outros', semOutros = false } = {}) {
    const ordenado = groups.slice().sort(desc(field));
    if (ordenado.length <= n) return { linhas: ordenado, dobradas: 0 };
    const cabeca = ordenado.slice(0, n);
    const cauda = ordenado.slice(n);
    if (semOutros) return { linhas: cabeca, dobradas: cauda.length };
    const outros = { chave: rotulo, cursos: 0, __outros: true, __membros: cauda.map((g) => g.chave) };
    for (const g of cauda) {
      for (const k of Object.keys(g)) {
        if (typeof g[k] === 'number') outros[k] = (outros[k] ?? 0) + g[k];
      }
    }
    return { linhas: cabeca.concat(outros), dobradas: cauda.length };
  }

  /** Soma de uma medida + quantas linhas tinham o dado. */
  function total(rows, field) {
    let soma = 0; let base = 0;
    for (const r of rows) {
      const v = r[field];
      if (v != null) { soma += v; base++; }
    }
    return { soma, base, total: rows.length };
  }

  /** Contagem de valores distintos de uma dimensao (ignora nulos). */
  function distintos(rows, keyOf) {
    const set = new Set();
    for (const r of rows) {
      const keys = keyOf(r);
      for (const k of Array.isArray(keys) ? keys : [keys]) if (k) set.add(k);
    }
    return set.size;
  }

  /** Serie continua de anos, sem buracos, para o grafico temporal. */
  function serieAnual(rows, { de, ate }) {
    const anos = [];
    for (let a = de; a <= ate; a++) anos.push(a);
    const porFase = new Map();
    for (const r of rows) {
      if (r.anoInicio == null || r.anoInicio < de || r.anoInicio > ate) continue;
      const fase = r.fase || 'Sem fase informada';
      if (!porFase.has(fase)) porFase.set(fase, new Map());
      const m = porFase.get(fase);
      m.set(r.anoInicio, (m.get(r.anoInicio) ?? 0) + 1);
    }
    return {
      anos,
      series: [...porFase.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
        .map(([fase, m]) => ({ nome: fase, valores: anos.map((a) => m.get(a) ?? 0) })),
    };
  }

  /* --------------------------------------------------------------- dimensoes - */

  /**
   * Dicionario unico das dimensoes filtraveis: rotulo, como extrair o valor de
   * um curso e a ordem dos valores. Filtros, chips e URL leem tudo daqui.
   */
  const DIMENSOES = {
    fase: { rotulo: 'Fase da pesquisa', get: (c) => c.fase },
    areaTematica: { rotulo: 'Área temática', get: (c) => c.areaTematica },
    areaConhecimento: { rotulo: 'Área do conhecimento', get: (c) => c.areaConhecimento },
    nivel: { rotulo: 'Nível de ensino', get: (c) => c.nivel },
    modalidade: { rotulo: 'Modalidade', get: (c) => c.modalidade },
    macrorregiao: { rotulo: 'Macrorregião', get: (c) => c.macrorregiao },
    uf: { rotulo: 'Estado', get: (c) => c.uf },
    iesNatureza: { rotulo: 'Natureza da instituição', get: (c) => c.ies?.natureza ?? [] },
    ies: { rotulo: 'Instituição de ensino', get: (c) => c.ies?.nome },
    instrumento: { rotulo: 'Instrumento', get: (c) => c.instrumento },
  };

  return {
    data,
    meta,
    DIMENSOES,
    int,
    compact,
    pct,
    fold,
    haystack,
    groupBy,
    topN,
    total,
    distintos,
    serieAnual,
    desc,
  };
}());
