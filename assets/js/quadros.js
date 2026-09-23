/* =============================================================================
   PNERA — quadros
   Relatorios tabulares do recorte: organizacoes demandantes cruzadas com o
   territorio (macrorregiao, superintendencia, estado e municipio) e o quadro
   das instituicoes que realizaram os cursos. Seguem o mesmo painel de filtros
   do resto do painel, exportam em CSV e imprimem sozinhos.
   ========================================================================== */

window.Quadros = (function () {
  'use strict';

  const P = window.PNERA;
  const F = window.Filters;
  const V = window.Viz;
  const { int } = P;

  const SEM_DEMANDANTE = 'Organização demandante não informada';
  const SEM_IES = 'Instituição não informada';
  const NAO_INFORMADO = 'Não informado';

  /** Ordem geografica, de norte a sul; regiao fora dela entra no fim. */
  const REGIOES = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];

  const escapar = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

  /* ------------------------------------------------------------ agregacao --- */

  /** Medidas de cada linha dos quadros, na ordem das colunas. */
  const MEDIDAS = [
    { key: 'cursos', label: 'Cursos' },
    { key: 'concluidos', label: 'Concluídos' },
    { key: 'andamento', label: 'Em andamento' },
    { key: 'turmas', label: 'Turmas' },
    { key: 'matriculados', label: 'Matriculados' },
    { key: 'concluintes', label: 'Concluintes' },
  ];
  const SOMAVEIS = ['turmas', 'matriculados', 'concluintes'];

  function acumulador(chave) {
    const acc = { chave, cursos: 0, concluidos: 0, andamento: 0, ids: new Set() };
    for (const m of SOMAVEIS) { acc[m] = 0; acc[`${m}Base`] = 0; }
    return acc;
  }

  /**
   * Soma um curso no acumulador uma unica vez: a mesma organizacao pode vir
   * repetida no texto de um curso, e o total de um grupo precisa contar cursos,
   * nao pares curso-organizacao.
   */
  function somar(acc, c) {
    if (acc.ids.has(c.id)) return;
    acc.ids.add(c.id);
    acc.cursos++;
    if (c.situacao === 'Concluído') acc.concluidos++;
    else if (c.situacao === 'Em andamento') acc.andamento++;
    for (const m of SOMAVEIS) {
      if (c[m] != null) { acc[m] += c[m]; acc[`${m}Base`]++; }
    }
  }

  /** Ausencia nunca vira zero: sem nenhum curso informando, a celula fica "—". */
  const valor = (acc, key) => (acc == null ? null
    : SOMAVEIS.includes(key) && !acc[`${key}Base`] ? null : acc[key]);

  const demandantesDe = (c) => {
    const nomes = c.demandante?.nomes ?? [];
    return nomes.length ? [...new Set(nomes)] : [SEM_DEMANDANTE];
  };

  /** Linhas "nao informado" vao sempre para o fim, fora da ordenacao. */
  const ehResto = (chave) => chave === SEM_DEMANDANTE || chave === SEM_IES || chave === NAO_INFORMADO;

  const porCursos = (a, b) => (ehResto(a.chave) - ehResto(b.chave))
    || b.cursos - a.cursos
    || String(a.chave).localeCompare(String(b.chave), 'pt-BR');

  /* --------------------------------------------------------------- quadros --- */

  /**
   * Quadros agrupados: um bloco por territorio, com as organizacoes daquele
   * territorio dentro. `grupo` diz a chave, o rotulo e a ordem natural.
   */
  const AGRUPADOS = {
    superintendencia: {
      rotuloGrupo: 'Superintendência',
      grupo: (c) => c.superintendencia && {
        chave: c.superintendencia,
        rotulo: c.superintendencia,
        ordem: c.superintendencia,
      },
    },
    uf: {
      rotuloGrupo: 'Estado',
      grupo: (c) => c.uf && {
        chave: c.uf,
        rotulo: `${c.uf}${c.ufSigla ? ` (${c.ufSigla})` : ''}`,
        sub: c.macrorregiao,
        ordem: c.uf,
      },
    },
    municipio: {
      rotuloGrupo: 'Município',
      grupo: (c) => c.municipio && {
        chave: `${c.municipio}|${c.ufSigla ?? ''}`,
        rotulo: `${c.municipio}${c.ufSigla ? ` — ${c.ufSigla}` : ''}`,
        sub: c.superintendencia,
        ordem: `${c.ufSigla ?? ''}|${P.fold(c.municipio)}`,
      },
    },
  };

  const QUADROS = [
    {
      id: 'macrorregiao',
      aba: 'Demandantes × Macrorregião',
      titulo: 'Organizações demandantes por macrorregião',
      dica: 'Quantos cursos cada organização demandou em cada região do país. A cor da célula acompanha o valor.',
      tipo: 'cruzado',
    },
    {
      id: 'superintendencia',
      aba: 'Demandantes × Superintendência',
      titulo: 'Organizações demandantes por superintendência',
      dica: 'Organizações que demandaram cursos no território de cada superintendência regional do INCRA.',
      tipo: 'agrupado',
    },
    {
      id: 'uf',
      aba: 'Demandantes × Estado',
      titulo: 'Organizações demandantes por estado',
      dica: 'Organizações que demandaram cursos em cada unidade da federação.',
      tipo: 'agrupado',
    },
    {
      id: 'municipio',
      aba: 'Demandantes × Município',
      titulo: 'Organizações demandantes por município',
      dica: 'Organizações por município onde a turma funcionou, agrupados por UF.',
      tipo: 'agrupado',
    },
    {
      id: 'ies',
      aba: 'Instituições realizadoras',
      titulo: 'Instituições que realizaram os cursos',
      dica: 'Cada instituição de ensino que executou cursos no recorte, com seus números. Clique no cabeçalho para ordenar.',
      tipo: 'ies',
    },
  ];

  const estado = {
    quadro: 'macrorregiao',
    busca: '',
    medida: 'cursos',
    ordemGrupos: 'nome',
    ordem: { macrorregiao: { col: 'total', dir: -1 }, ies: { col: 'cursos', dir: -1 } },
    fechados: new Set(),
  };

  let container = null;
  let linhasAtuais = [];
  /** O que esta na tela agora, para o CSV sair igual ao que se ve. */
  let exportavel = null;

  /* --------------------------------------------------- quadro agrupado ------ */

  function agregarAgrupado(rows, def) {
    const grupos = new Map();
    const total = acumulador('total');
    for (const c of rows) {
      somar(total, c);
      const g = def.grupo(c) || { chave: NAO_INFORMADO, rotulo: NAO_INFORMADO, ordem: '￿' };
      let grupo = grupos.get(g.chave);
      if (!grupo) {
        grupo = { ...g, total: acumulador(g.chave), orgs: new Map() };
        grupos.set(g.chave, grupo);
      }
      somar(grupo.total, c);
      for (const nome of demandantesDe(c)) {
        if (!grupo.orgs.has(nome)) grupo.orgs.set(nome, acumulador(nome));
        somar(grupo.orgs.get(nome), c);
      }
    }
    const lista = [...grupos.values()].map((g) => ({ ...g, orgs: [...g.orgs.values()].sort(porCursos) }));
    lista.sort(estado.ordemGrupos === 'cursos'
      ? (a, b) => (ehResto(a.chave) - ehResto(b.chave)) || b.total.cursos - a.total.cursos
        || a.ordem.localeCompare(b.ordem, 'pt-BR')
      : (a, b) => a.ordem.localeCompare(b.ordem, 'pt-BR'));
    return { grupos: lista, total };
  }

  /** Busca: o grupo que casa entra inteiro; senao, so as organizacoes que casam. */
  function filtrarGrupos(grupos) {
    const termo = P.fold(estado.busca);
    if (!termo) return grupos;
    return grupos
      .map((g) => (P.fold(`${g.rotulo} ${g.sub ?? ''}`).includes(termo)
        ? g
        : { ...g, orgs: g.orgs.filter((o) => P.fold(o.chave).includes(termo)) }))
      .filter((g) => g.orgs.length);
  }

  const celulasMedidas = (acc) => MEDIDAS.map((m) => {
    const v = valor(acc, m.key);
    return `<td class="num">${v == null ? '<span class="muted">—</span>' : int(v)}</td>`;
  }).join('');

  function pintarAgrupado(q, rows) {
    const def = AGRUPADOS[q.id];
    const { grupos, total } = agregarAgrupado(rows, def);
    const visiveis = filtrarGrupos(grupos);
    const orgsDistintas = new Set(grupos.flatMap((g) => g.orgs.map((o) => o.chave).filter((n) => !ehResto(n))));

    resumo(`${int(grupos.filter((g) => !ehResto(g.chave)).length)} ${def.rotuloGrupo.toLowerCase()}${grupos.length === 1 ? '' : 's'} · `
      + `${int(orgsDistintas.size)} organizações · ${int(total.cursos)} cursos`
      + (estado.busca ? ` · ${int(visiveis.length)} com "${escapar(estado.busca)}"` : ''));

    if (!visiveis.length) return semResultado();

    const cab = `<thead><tr>
      <th scope="col" class="quadro-col-nome">${def.rotuloGrupo} / organização demandante</th>
      ${MEDIDAS.map((m) => `<th scope="col" class="num">${m.label}</th>`).join('')}
    </tr></thead>`;

    const corpo = visiveis.map((g) => {
      const idG = `${q.id}:${g.chave}`;
      const fechado = estado.fechados.has(idG);
      const nOrgs = g.orgs.filter((o) => !ehResto(o.chave)).length;
      const rotuloOrgs = !nOrgs ? 'sem organização identificada'
        : `${int(nOrgs)} ${nOrgs === 1 ? 'organização' : 'organizações'}`;
      const detalhe = [g.sub, rotuloOrgs].filter(Boolean).join(' · ');
      return `<tbody class="quadro-grupo${fechado ? ' is-fechado' : ''}">
        <tr class="quadro-grupo__head">
          <th scope="rowgroup">
            <button type="button" class="quadro-grupo__btn js-q-grupo" data-g="${escapar(idG)}" aria-expanded="${!fechado}">
              <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
              <span class="quadro-grupo__nome">${escapar(g.rotulo)}</span>
              <span class="quadro-grupo__sub">${escapar(detalhe)}</span>
            </button>
          </th>
          ${celulasMedidas(g.total)}
        </tr>
        ${g.orgs.map((o) => `<tr class="quadro-linha${ehResto(o.chave) ? ' is-resto' : ''}">
          <td class="quadro-org">${escapar(o.chave)}</td>${celulasMedidas(o)}</tr>`).join('')}
      </tbody>`;
    }).join('');

    const rodape = `<tfoot><tr><th scope="row">Total do recorte</th>${celulasMedidas(total)}</tr></tfoot>`;
    tabela(`<table class="quadro-table quadro-table--agrupado">
      <caption class="visually-hidden">${escapar(q.titulo)}</caption>${cab}${corpo}${rodape}</table>`);

    container.querySelectorAll('.js-q-grupo').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.g;
        const fechar = !estado.fechados.has(id);
        if (fechar) estado.fechados.add(id); else estado.fechados.delete(id);
        btn.setAttribute('aria-expanded', String(!fechar));
        btn.closest('tbody').classList.toggle('is-fechado', fechar);
      });
    });

    nota(rows, total);

    exportavel = {
      nome: `pnera-demandantes-por-${q.id}`,
      linhas: [
        [def.rotuloGrupo, 'Organização demandante', ...MEDIDAS.map((m) => m.label)],
        ...visiveis.flatMap((g) => [
          [g.rotulo, `Total — ${def.rotuloGrupo.toLowerCase()}`, ...MEDIDAS.map((m) => valor(g.total, m.key))],
          ...g.orgs.map((o) => [g.rotulo, o.chave, ...MEDIDAS.map((m) => valor(o, m.key))]),
        ]),
        ['Total do recorte', '', ...MEDIDAS.map((m) => valor(total, m.key))],
      ],
    };
  }

  /* --------------------------------------------- quadro cruzado (regioes) --- */

  const MEDIDAS_CRUZADO = [
    { key: 'cursos', label: 'Cursos' },
    { key: 'matriculados', label: 'Matriculados' },
    { key: 'turmas', label: 'Turmas' },
    { key: 'concluintes', label: 'Concluintes' },
  ];

  function pintarCruzado(q, rows) {
    const orgs = new Map();
    const porRegiao = new Map(REGIOES.map((r) => [r, acumulador(r)]));
    const total = acumulador('total');

    for (const c of rows) {
      somar(total, c);
      const reg = c.macrorregiao;
      if (reg && !porRegiao.has(reg)) porRegiao.set(reg, acumulador(reg));
      if (reg) somar(porRegiao.get(reg), c);
      for (const nome of demandantesDe(c)) {
        let o = orgs.get(nome);
        if (!o) {
          o = { chave: nome, total: acumulador(nome), regioes: new Map() };
          orgs.set(nome, o);
        }
        somar(o.total, c);
        if (reg) {
          if (!o.regioes.has(reg)) o.regioes.set(reg, acumulador(reg));
          somar(o.regioes.get(reg), c);
        }
      }
    }

    const regioes = [...porRegiao.keys()];
    const med = estado.medida;
    const rotuloMed = MEDIDAS_CRUZADO.find((m) => m.key === med)?.label ?? 'Cursos';
    const termo = P.fold(estado.busca);
    let linhas = [...orgs.values()].filter((o) => !termo || P.fold(o.chave).includes(termo));

    // Ordenacao pelo cabecalho clicado; o "nao informado" fica sempre no fim.
    const ord = estado.ordem.macrorregiao;
    const chaveOrdem = (o) => (ord.col === 'nome' ? o.chave
      : ord.col === 'total' ? valor(o.total, med) : valor(o.regioes.get(ord.col), med));
    linhas.sort((a, b) => {
      const resto = ehResto(a.chave) - ehResto(b.chave);
      if (resto) return resto;
      const va = chaveOrdem(a);
      const vb = chaveOrdem(b);
      if (ord.col === 'nome') return String(va).localeCompare(String(vb), 'pt-BR') * ord.dir;
      return ((va ?? -1) - (vb ?? -1)) * ord.dir || a.chave.localeCompare(b.chave, 'pt-BR');
    });

    const nOrgs = [...orgs.keys()].filter((n) => !ehResto(n)).length;
    resumo(`${int(nOrgs)} organizações · ${int(total.cursos)} cursos · células em <strong>${rotuloMed.toLowerCase()}</strong>`
      + (estado.busca ? ` · ${int(linhas.length)} com "${escapar(estado.busca)}"` : ''));

    if (!linhas.length) return semResultado();

    const max = Math.max(0, ...linhas.flatMap((o) => regioes.map((r) => valor(o.regioes.get(r), med) ?? 0)));
    const seta = (col) => (ord.col === col ? `<span class="dir">${ord.dir === 1 ? '↑' : '↓'}</span>` : '');
    const ariaSort = (col) => (ord.col === col ? (ord.dir === 1 ? 'ascending' : 'descending') : 'none');

    const cab = `<thead><tr>
      <th scope="col" class="sortable quadro-col-nome" data-col="nome" aria-sort="${ariaSort('nome')}">Organização demandante ${seta('nome')}</th>
      ${regioes.map((r) => `<th scope="col" class="sortable num" data-col="${escapar(r)}" aria-sort="${ariaSort(r)}">${escapar(r)} ${seta(r)}</th>`).join('')}
      <th scope="col" class="sortable num quadro-col-total" data-col="total" aria-sort="${ariaSort('total')}">Total ${seta('total')}</th>
    </tr></thead>`;

    const celula = (v) => {
      if (v == null || v === 0) return '<td class="num quadro-zero">—</td>';
      const bg = V.seqColor(v, max);
      return `<td class="num" style="background:${bg};color:${V.inkOn(bg)}">${int(v)}</td>`;
    };

    const corpo = linhas.map((o) => `<tr class="quadro-linha${ehResto(o.chave) ? ' is-resto' : ''}">
      <td class="quadro-org">${escapar(o.chave)}</td>
      ${regioes.map((r) => celula(valor(o.regioes.get(r), med))).join('')}
      <td class="num quadro-col-total">${int(valor(o.total, med))}</td></tr>`).join('');

    const rodape = `<tfoot><tr><th scope="row">Total do recorte</th>
      ${regioes.map((r) => `<td class="num">${int(valor(porRegiao.get(r), med))}</td>`).join('')}
      <td class="num quadro-col-total">${int(valor(total, med))}</td></tr></tfoot>`;

    tabela(`<table class="quadro-table quadro-table--cruzado">
      <caption class="visually-hidden">${escapar(q.titulo)}</caption>${cab}<tbody>${corpo}</tbody>${rodape}</table>`);

    ligarOrdenacao('macrorregiao', { nome: 1 });
    nota(rows, total);

    exportavel = {
      nome: `pnera-demandantes-por-macrorregiao-${med}`,
      linhas: [
        ['Organização demandante', ...regioes, 'Total'],
        ...linhas.map((o) => [o.chave, ...regioes.map((r) => valor(o.regioes.get(r), med) ?? 0), valor(o.total, med)]),
        ['Total do recorte', ...regioes.map((r) => valor(porRegiao.get(r), med)), valor(total, med)],
      ],
    };
  }

  /* ------------------------------------------------ quadro das instituicoes -- */

  const COLUNAS_IES = [
    { key: 'nome', label: 'Instituição', get: (l) => l.chave, texto: true },
    { key: 'natureza', label: 'Natureza', get: (l) => l.natureza, texto: true },
    { key: 'sede', label: 'Sede', get: (l) => l.sede, texto: true },
    ...MEDIDAS.map((m) => ({ key: m.key, label: m.label, get: (l) => valor(l, m.key), num: true })),
    { key: 'periodo', label: 'Período', get: (l) => l.anoMin, render: (l) => periodoTexto(l), num: true },
    { key: 'ufs', label: 'UFs atendidas', get: (l) => l.ufs.size, render: (l) => ufsTexto(l), texto: true },
  ];

  const periodoTexto = (l) => (l.anoMin == null ? null
    : l.anoMin === l.anoMax ? String(l.anoMin) : `${l.anoMin}–${l.anoMax}`);
  const ufsTexto = (l) => [...l.ufs].sort().join(', ') || null;

  function pintarIes(q, rows) {
    const mapa = new Map();
    const total = acumulador('total');
    for (const c of rows) {
      somar(total, c);
      const nome = c.ies?.nome || SEM_IES;
      let l = mapa.get(nome);
      if (!l) {
        l = Object.assign(acumulador(nome), {
          natureza: (c.ies?.natureza ?? []).join(', ') || null,
          sede: [c.ies?.municipio, c.ies?.ufSigla].filter(Boolean).join(' / ') || null,
          anoMin: null,
          anoMax: null,
          ufs: new Set(),
        });
        mapa.set(nome, l);
      }
      somar(l, c);
      if (c.anoInicio != null) {
        l.anoMin = l.anoMin == null ? c.anoInicio : Math.min(l.anoMin, c.anoInicio);
        l.anoMax = l.anoMax == null ? c.anoInicio : Math.max(l.anoMax, c.anoInicio);
      }
      if (c.ufSigla) l.ufs.add(c.ufSigla);
    }

    const termo = P.fold(estado.busca);
    const todas = [...mapa.values()];
    const linhas = todas.filter((l) => !termo || P.fold(`${l.chave} ${l.natureza ?? ''} ${l.sede ?? ''}`).includes(termo));

    const ord = estado.ordem.ies;
    const col = COLUNAS_IES.find((c) => c.key === ord.col) ?? COLUNAS_IES[3];
    linhas.sort((a, b) => {
      const resto = ehResto(a.chave) - ehResto(b.chave);
      if (resto) return resto;
      const va = col.get(a);
      const vb = col.get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number') return (va - vb) * ord.dir || a.chave.localeCompare(b.chave, 'pt-BR');
      return String(va).localeCompare(String(vb), 'pt-BR') * ord.dir;
    });

    const nIes = todas.filter((l) => !ehResto(l.chave)).length;
    resumo(`${int(nIes)} instituições · ${int(total.cursos)} cursos`
      + (estado.busca ? ` · ${int(linhas.length)} com "${escapar(estado.busca)}"` : ''));

    if (!linhas.length) return semResultado();

    const seta = (k) => (ord.col === k ? `<span class="dir">${ord.dir === 1 ? '↑' : '↓'}</span>` : '');
    const cab = `<thead><tr>${COLUNAS_IES.map((c) => `<th scope="col"
      class="sortable${c.num ? ' num' : ''}${c.key === 'nome' ? ' quadro-col-nome' : ''}" data-col="${c.key}"
      aria-sort="${ord.col === c.key ? (ord.dir === 1 ? 'ascending' : 'descending') : 'none'}">${c.label} ${seta(c.key)}</th>`).join('')}</tr></thead>`;

    const corpo = linhas.map((l) => `<tr class="quadro-linha${ehResto(l.chave) ? ' is-resto' : ''}">`
      + COLUNAS_IES.map((c) => {
        const v = c.render ? c.render(l) : c.get(l);
        const cls = [c.num ? 'num' : '', c.key === 'nome' ? 'quadro-org' : '', c.key === 'ufs' ? 'quadro-ufs' : '',
          c.key === 'natureza' || c.key === 'sede' ? 'nowrap' : ''].filter(Boolean).join(' ');
        const txt = v == null || v === '' ? '<span class="muted">—</span>' : c.num && !c.render ? int(v) : escapar(v);
        return `<td class="${cls}">${txt}</td>`;
      }).join('') + '</tr>').join('');

    const rodape = `<tfoot><tr><th scope="row" colspan="3">Total do recorte</th>${celulasMedidas(total)}
      <td class="num">${periodoTotal(rows)}</td><td>${int(P.distintos(rows, (c) => c.ufSigla))} UFs</td></tr></tfoot>`;

    tabela(`<table class="quadro-table quadro-table--ies">
      <caption class="visually-hidden">${escapar(q.titulo)}</caption>${cab}<tbody>${corpo}</tbody>${rodape}</table>`);

    ligarOrdenacao('ies', { nome: 1, natureza: 1, sede: 1, ufs: -1, periodo: 1 });
    nota(rows, total, { ies: true });

    exportavel = {
      nome: 'pnera-instituicoes-realizadoras',
      linhas: [
        COLUNAS_IES.map((c) => c.label),
        ...linhas.map((l) => COLUNAS_IES.map((c) => (c.render ? c.render(l) : c.get(l)))),
      ],
    };
  }

  function periodoTotal(rows) {
    const anos = rows.map((c) => c.anoInicio).filter((a) => a != null);
    if (!anos.length) return '—';
    const de = Math.min(...anos);
    const ate = Math.max(...anos);
    return de === ate ? String(de) : `${de}–${ate}`;
  }

  /** Clique no cabecalho: mesma coluna inverte; coluna nova usa a direcao natural dela. */
  function ligarOrdenacao(quadro, direcaoInicial) {
    container.querySelectorAll('.js-q-corpo th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const ord = estado.ordem[quadro];
        const col = th.dataset.col;
        if (ord.col === col) ord.dir *= -1;
        else { ord.col = col; ord.dir = direcaoInicial[col] ?? -1; }
        pintar(linhasAtuais);
      });
    });
  }

  /* ------------------------------------------------------------ montagem ---- */

  const ICONE_IMPRIMIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M6 9V3h12v6"/><path d="M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/>'
    + '<path d="M6 14h12v7H6z"/></svg>';
  const ICONE_CSV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>';

  const quadroAtual = () => QUADROS.find((q) => q.id === estado.quadro) ?? QUADROS[0];

  function montar(el, rows) {
    container = el;
    el.innerHTML = `
      <section class="card span-12 quadros">
        <nav class="subnav js-q-nav" role="tablist" aria-label="Quadros disponíveis">
          ${QUADROS.map((q) => `<button type="button" class="subnav__btn" role="tab" data-q="${q.id}"
            aria-selected="${q.id === estado.quadro}">${q.aba}</button>`).join('')}
        </nav>
        <div class="card__head">
          <div>
            <h3 class="card__title js-q-titulo"></h3>
            <p class="card__hint js-q-dica"></p>
          </div>
          <div class="card__tools">
            <button type="button" class="icon-btn js-q-csv" title="Baixar o quadro como aparece na tela">${ICONE_CSV}Exportar CSV</button>
            <button type="button" class="icon-btn js-q-imprimir" title="Imprimir apenas este quadro, com o recorte atual">${ICONE_IMPRIMIR}Imprimir</button>
          </div>
        </div>
        <div class="data-toolbar quadro-toolbar">
          <input type="search" class="form-control form-control-sm quadro-busca js-q-busca"
                 placeholder="Buscar no quadro…" aria-label="Buscar no quadro" value="${escapar(estado.busca)}">
          <span class="d-flex align-items-center gap-2 js-q-medida-box">
            <label class="muted" for="q-medida">Células</label>
            <select id="q-medida" class="form-select form-select-sm js-q-medida" style="width:auto">
              ${MEDIDAS_CRUZADO.map((m) => `<option value="${m.key}"${m.key === estado.medida ? ' selected' : ''}>${m.label}</option>`).join('')}
            </select>
          </span>
          <span class="d-flex align-items-center gap-2 js-q-grupos-box">
            <label class="muted" for="q-ordem">Ordenar</label>
            <select id="q-ordem" class="form-select form-select-sm js-q-ordem" style="width:auto">
              <option value="nome"${estado.ordemGrupos === 'nome' ? ' selected' : ''}>Por nome</option>
              <option value="cursos"${estado.ordemGrupos === 'cursos' ? ' selected' : ''}>Por nº de cursos</option>
            </select>
            <button type="button" class="icon-btn js-q-abrir">Expandir tudo</button>
            <button type="button" class="icon-btn js-q-fechar">Recolher tudo</button>
          </span>
          <span class="muted ms-auto js-q-resumo"></span>
        </div>
        <div class="data-scroll quadro-scroll js-q-corpo"></div>
        <div class="card__foot js-q-nota"></div>
      </section>`;

    el.querySelectorAll('.subnav__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        estado.quadro = btn.dataset.q;
        estado.busca = '';
        el.querySelector('.js-q-busca').value = '';
        el.querySelectorAll('.subnav__btn').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
        pintar(linhasAtuais);
      });
    });

    let timer;
    el.querySelector('.js-q-busca').addEventListener('input', (ev) => {
      clearTimeout(timer);
      timer = setTimeout(() => { estado.busca = ev.target.value.trim(); pintar(linhasAtuais); }, 160);
    });
    el.querySelector('.js-q-medida').addEventListener('change', (ev) => {
      estado.medida = ev.target.value;
      pintar(linhasAtuais);
    });
    el.querySelector('.js-q-ordem').addEventListener('change', (ev) => {
      estado.ordemGrupos = ev.target.value;
      pintar(linhasAtuais);
    });
    el.querySelector('.js-q-abrir').addEventListener('click', () => {
      for (const id of [...estado.fechados]) if (id.startsWith(`${estado.quadro}:`)) estado.fechados.delete(id);
      pintar(linhasAtuais);
    });
    el.querySelector('.js-q-fechar').addEventListener('click', () => {
      el.querySelectorAll('.js-q-grupo').forEach((b) => estado.fechados.add(b.dataset.g));
      pintar(linhasAtuais);
    });
    el.querySelector('.js-q-csv').addEventListener('click', exportarCsv);
    el.querySelector('.js-q-imprimir').addEventListener('click', imprimir);

    pintar(rows);
  }

  function pintar(rows) {
    linhasAtuais = rows;
    if (!container || !container.querySelector('.quadros')) return;
    const q = quadroAtual();
    container.querySelector('.js-q-titulo').textContent = q.titulo;
    container.querySelector('.js-q-dica').textContent = q.dica;
    container.querySelector('.js-q-medida-box').hidden = q.tipo !== 'cruzado';
    container.querySelector('.js-q-grupos-box').hidden = q.tipo !== 'agrupado';
    container.querySelector('.js-q-nota').innerHTML = '';
    exportavel = null;

    if (!rows.length) {
      resumo('');
      container.querySelector('.js-q-corpo').innerHTML = `<div class="empty">
        <span class="empty__title">Nada neste recorte</span>
        <span>Nenhum curso corresponde aos filtros aplicados.</span>
        <button type="button" class="icon-btn js-limpar">Limpar filtros</button></div>`;
      return;
    }

    if (q.tipo === 'cruzado') pintarCruzado(q, rows);
    else if (q.tipo === 'agrupado') pintarAgrupado(q, rows);
    else pintarIes(q, rows);
  }

  /* -------------------------------------------------------------- partes ---- */

  function resumo(html) {
    container.querySelector('.js-q-resumo').innerHTML = html;
  }

  function tabela(html) {
    container.querySelector('.js-q-corpo').innerHTML = html;
  }

  function semResultado() {
    tabela(`<div class="empty">
      <span class="empty__title">Nada encontrado</span>
      <span>Nenhuma linha do quadro contém "${escapar(estado.busca)}".</span></div>`);
  }

  /** Rodape: a base do quadro e o aviso de dupla contagem, sem truncar em silencio. */
  function nota(rows, total, { ies = false } = {}) {
    const partes = [];
    if (ies) {
      const sem = rows.filter((c) => !c.ies?.nome).length;
      partes.push(`<span class="coverage">Base: <strong>${int(total.cursos)}</strong> cursos do recorte</span>`);
      if (sem) partes.push(`<span>${int(sem)} sem instituição informada.</span>`);
      partes.push('<span>Período: anos de início do primeiro e do último curso.</span>');
    } else {
      const com = rows.filter((c) => (c.demandante?.nomes ?? []).length).length;
      partes.push(`<span class="coverage"><strong>${int(com)}</strong> de ${int(rows.length)} cursos com organização demandante identificada</span>`);
      partes.push('<span>Um curso com mais de uma organização demandante conta em cada uma; por isso as linhas podem somar mais que o total, que conta cada curso uma vez.</span>');
    }
    const soma = (m) => total[`${m}Base`];
    partes.push(`<span>Matriculados informados em ${int(soma('matriculados'))} cursos; concluintes em ${int(soma('concluintes'))}.</span>`);
    container.querySelector('.js-q-nota').innerHTML = partes.join('');
  }

  /* ----------------------------------------------------------- exportacao --- */

  function exportarCsv() {
    if (!exportavel) return;
    const linhas = exportavel.linhas.map((l) => l.map((v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[;"\n]/.test(s) ? `"${s}"` : s;
    }).join(';'));
    // BOM para o Excel abrir os acentos corretamente.
    const blob = new Blob([`﻿${linhas.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportavel.nome}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Imprime so o cartao do quadro, no mesmo esquema do mapa: o documento entra
   * em modo de impressao e o CSS esconde o resto. A legenda leva o recorte,
   * porque na folha o painel de filtros nao aparece.
   */
  function imprimir() {
    const card = container.querySelector('.quadros');
    let legenda = card.querySelector('.js-print-caption');
    if (!legenda) {
      legenda = document.createElement('p');
      legenda.className = 'print-caption js-print-caption';
      card.querySelector('.card__head').after(legenda);
    }
    const ativos = F.ativos();
    const recorte = ativos.length
      ? ativos.map((a) => `${a.rotulo}: ${a.valor}`).join(' · ')
      : 'todos os cursos (sem filtros)';
    legenda.textContent = `PNERA — Educação na Reforma Agrária · Pronera. Recorte: ${recorte}. `
      + (estado.busca ? `Busca no quadro: "${estado.busca}". ` : '')
      + `${int(linhasAtuais.length)} de ${int(P.data.length)} cursos. `
      + `Impresso em ${new Date().toLocaleDateString('pt-BR')}.`;

    card.classList.add('is-print-target');
    document.body.classList.add('imprimindo-quadro');
    const limpar = () => {
      window.removeEventListener('afterprint', limpar);
      document.body.classList.remove('imprimindo-quadro');
      card.classList.remove('is-print-target');
    };
    window.addEventListener('afterprint', limpar);
    window.print();
    setTimeout(limpar, 1000);
  }

  return { montar, pintar };
}());
