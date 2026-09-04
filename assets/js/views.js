/* =============================================================================
   PNERA — definicao dos visuais
   Cada cartao declara como agrega o recorte, o que desenha e o gemeo em tabela.
   Regras seguidas aqui:
   - dimensao nominal em barras usa UM tom (o comprimento ja mostra o valor);
   - dimensao ordinal (nivel, titulacao, duracao) usa a rampa de um tom;
   - nunca mais de 7 categorias coloridas: a cauda vira "Outros" em cinza;
   - duas medidas de mesma unidade em um eixo; jamais dois eixos.
   ========================================================================== */

(function () {
  'use strict';

  const P = window.PNERA;
  const V = window.Viz;
  const F = window.Filters;
  const { int, compact, pct } = P;

  const registrar = V.registrar;

  /**
   * Rotulo curto para o eixo. Cortar no meio produziria varios
   * "Federacao dos Trabalhadores n…" indistinguiveis, porque o que diferencia
   * essas entidades e a sigla no fim do nome — entao ela e que vira o rotulo.
   */
  function nomesLimitados(s, max = 34) {
    if (!s || s.length <= max) return s;
    const sigla = /\(([^)]{2,24})\)\s*$/.exec(s);
    if (sigla) {
      const curto = sigla[1].trim();
      if (curto.length <= max) return curto;
    }
    return `${s.slice(0, max - 1)}…`;
  }


  /** Tabela padrao de um ranking (categoria + medidas). */
  function tabelaRanking(linhas, medidas) {
    return {
      columns: [{ key: 'chave', label: 'Categoria' }, ...medidas.map((m) => ({ key: m.key, label: m.label, num: true }))],
      rows: linhas.map((l) => {
        const row = { chave: l.chave };
        for (const m of medidas) row[m.key] = m.fmt ? m.fmt(l) : int(l[m.key]);
        return row;
      }),
    };
  }

  const semDados = (rows) => rows.length === 0;

  /* ======================================================= ABA: VISAO GERAL == */

  registrar({
    id: 'evolucao',
    aba: 'geral',
    span: 8,
    height: 320,
    title: 'Cursos iniciados por ano',
    hint: 'Quando cada curso começou, empilhado pelas duas fases da pesquisa.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      const { anos, series } = P.serieAnual(rows, { de: F.state.anoDe, ate: F.state.anoAte });
      const cores = series.map((s, i) => (s.nome === 'PNERA II' ? V.slot(0) : s.nome === 'PNERA III' ? V.slot(1) : V.slot(i + 2)));
      const comCor = series.map((s, i) => ({ ...s, cor: cores[i] }));
      const cob = P.total(rows, 'anoInicio');
      return {
        config: V.areaEmpilhada({ labels: anos, series: comCor }),
        legend: comCor.map((s) => ({ nome: s.nome, cor: s.cor, linha: true })),
        coverage: { preenchidos: cob.base, total: cob.total, rotulo: 'ano de início' },
        table: {
          columns: [{ key: 'ano', label: 'Ano' }, ...comCor.map((s) => ({ key: s.nome, label: s.nome, num: true })),
            { key: 'total', label: 'Total', num: true }],
          rows: anos.map((ano, i) => {
            const row = { ano };
            let t = 0;
            for (const s of comCor) { row[s.nome] = int(s.valores[i]); t += s.valores[i]; }
            row.total = int(t);
            return row;
          }),
        },
      };
    },
  });

  registrar({
    id: 'kpiNivel',
    aba: 'geral',
    span: 4,
    title: 'Cursos por nível de ensino',
    hint: 'O nível tem ordem natural, então a cor vai do claro ao escuro acompanhando a escala.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      const ordem = P.meta.valores?.nivel ?? [];
      const grupos = P.groupBy(rows, (c) => c.nivel, ['matriculados'])
        .sort((a, b) => ordem.indexOf(a.chave) - ordem.indexOf(b.chave));
      const passos = V.T.seq;
      const cores = grupos.map((_, i) => passos[Math.min(passos.length - 1, Math.round((i / Math.max(1, grupos.length - 1)) * (passos.length - 1)))]);
      const config = V.barrasH({
        labels: grupos.map((g) => g.chave),
        valores: grupos.map((g) => g.cursos),
        rotulo: 'Cursos',
      });
      config.data.datasets[0].backgroundColor = cores;
      return {
        config,
        table: tabelaRanking(grupos, [
          { key: 'cursos', label: 'Cursos' },
          { key: 'matriculados', label: 'Matriculados' },
        ]),
        note: 'Escala do ensino fundamental à pós-graduação.',
      };
    },
  });

  registrar({
    id: 'areaTematica',
    aba: 'geral',
    span: 6,
    title: 'Matriculados por área temática',
    hint: 'As 11 áreas temáticas do Pronera, ordenadas pelo total de estudantes.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      const grupos = P.groupBy(rows, (c) => c.areaTematica, ['matriculados'])
        .sort(P.desc('matriculados'));
      const cob = P.total(rows, 'matriculados');
      return {
        config: V.barrasH({
          labels: grupos.map((g) => g.chave),
          valores: grupos.map((g) => g.matriculados),
          rotulo: 'Matriculados',
          formato: compact,
        }),
        coverage: { preenchidos: cob.base, total: cob.total, rotulo: 'nº de matriculados' },
        table: tabelaRanking(grupos, [
          { key: 'matriculados', label: 'Matriculados' },
          { key: 'cursos', label: 'Cursos' },
        ]),
      };
    },
    onPick(ponto, chart) {
      F.alternar('areaTematica', chart.data.labels[ponto.index]);
    },
  });

  registrar({
    id: 'matPorRegiao',
    aba: 'geral',
    span: 6,
    height: 360,
    title: 'Matriculados por macrorregião',
    hint: 'Total de estudantes matriculados em cada macrorregião do país.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      const grupos = P.groupBy(rows, (c) => c.macrorregiao, ['matriculados'])
        .sort(P.desc('matriculados'));
      const cobM = P.total(rows, 'matriculados');
      return {
        config: V.colunasAgrupadas({
          labels: grupos.map((g) => g.chave),
          series: [
            { nome: 'Matriculados', valores: grupos.map((g) => g.matriculados), cor: V.slot(0) },
          ],
        }),
        legend: [
          { nome: 'Matriculados', cor: V.slot(0) },
        ],
        coverage: { preenchidos: cobM.base, total: cobM.total, rotulo: 'nº de matriculados' },
        table: tabelaRanking(grupos, [
          { key: 'matriculados', label: 'Matriculados' },
          { key: 'cursos', label: 'Cursos' },
        ]),
      };
    },
    onPick(ponto, chart) {
      F.alternar('macrorregiao', chart.data.labels[ponto.index]);
    },
  });

  /* ======================================================== ABA: TERRITORIOS = */

  const MEDIDAS_MAPA = {
    cursos: { rotulo: 'cursos', campo: null },
    matriculados: { rotulo: 'matriculados', campo: 'matriculados' },
  };
  let medidaMapa = 'cursos';

  /**
   * Agrega o recorte por municipio, para a camada de circulos do mapa. Usa os
   * centroides de assets/js/municipio-coords.js; o que nao tem codigo IBGE
   * mapeavel entra em `fora`, para o rodape declarar a base real do desenho.
   */
  function pontosMunicipio(rows, cfg) {
    const coords = window.MUNICIPIO_COORDS;
    if (!coords) return { pontos: [], maxPonto: 0, plotados: 0 };

    const porMun = new Map();
    let plotados = 0;

    for (const c of rows) {
      const cod = c.codMunicipio ? String(c.codMunicipio) : null;
      const geo = cod ? coords[cod] : null;
      if (!geo) continue;
      let m = porMun.get(cod);
      if (!m) {
        m = {
          nome: geo.nome || c.municipio || cod,
          uf: geo.uf,
          lat: geo.lat,
          lon: geo.lon,
          cursos: 0,
          matriculados: 0,
          matriculadosBase: 0,
        };
        porMun.set(cod, m);
      }
      m.cursos++;
      plotados++;
      // Ausencia nunca vira zero: a base conta so quem tinha o dado.
      if (c.matriculados != null) { m.matriculados += c.matriculados; m.matriculadosBase++; }
    }

    const pontos = [...porMun.values()].map((m) => ({
      ...m,
      valor: cfg.campo ? m[cfg.campo] : m.cursos,
    }));
    const maxPonto = Math.max(0, ...pontos.map((p) => p.valor || 0));
    return { pontos, maxPonto, plotados };
  }

  registrar({
    id: 'mapa',
    aba: 'territorios',
    span: 7,
    title: 'Distribuição pelo território nacional',
    hint: 'Cada círculo é um município, com área proporcional à medida. Clique no círculo ou no estado para filtrar todo o painel.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      const cfg = MEDIDAS_MAPA[medidaMapa];
      const grupos = P.groupBy(rows, (c) => c.ufSigla, ['matriculados']);
      const valores = new Map(grupos.map((g) => [g.chave, {
        valor: cfg.campo ? g[cfg.campo] : g.cursos,
        cursos: g.cursos,
      }]));
      const nomes = P.groupBy(rows, (c) => c.uf, ['matriculados']).sort(P.desc('cursos'));
      const { pontos, maxPonto, plotados } = pontosMunicipio(rows, cfg);
      const desenhaveis = pontos.filter((p) => p.valor).length;
      const semMedida = pontos.length - desenhaveis;
      return {
        valores,
        cfg,
        pontos,
        maxPonto,
        table: tabelaRanking(nomes, [
          { key: 'cursos', label: 'Cursos' },
          { key: 'matriculados', label: 'Matriculados' },
        ]),
        coverage: { preenchidos: plotados, total: rows.length, rotulo: 'município localizado' },
        // Circulo so existe onde ha valor: com "matriculados", municipio sem o
        // dado nao entra — a nota conta o que foi desenhado, nao o que existe.
        note: `${valores.size} de 27 UFs com cursos no recorte · ${desenhaveis} municípios no mapa`
          + (semMedida ? ` (${semMedida} sem ${cfg.rotulo} informado).` : '.'),
      };
    },
    render(box, rows, res) {
      const barra = document.createElement('div');
      barra.className = 'data-toolbar';
      barra.innerHTML = `<label class="muted" for="medida-mapa">Medida</label>
        <select id="medida-mapa" class="form-select form-select-sm" style="width:auto">
          ${Object.entries(MEDIDAS_MAPA).map(([k, v]) => `<option value="${k}"${k === medidaMapa ? ' selected' : ''}>${v.rotulo}</option>`).join('')}
        </select>`;
      barra.querySelector('select').addEventListener('change', (ev) => {
        medidaMapa = ev.target.value;
        V.atualizar(F.recorte());
      });
      box.appendChild(barra);
      window.MapaUF.desenhar(box, {
        valores: res.valores,
        rotuloMedida: res.cfg.rotulo,
        ativos: F.state.selecao.uf,
        onPick: (nome) => F.alternar('uf', nome),
        pontos: res.pontos,
        maxPonto: res.maxPonto,
      });
    },
  });

  registrar({
    id: 'rankUf',
    aba: 'territorios',
    span: 5,
    title: 'Estados com mais cursos',
    hint: 'Ranking completo das UFs presentes no recorte.',
    build(rows) {
      if (semDados(rows)) return { vazio: true, linhas: [] };
      const grupos = P.groupBy(rows, (c) => c.uf, ['matriculados']);
      // Sao no maximo 27 UFs e o cartao acompanha a altura do mapa ao lado:
      // cabe o ranking inteiro, sem cauda escondida.
      const { linhas, dobradas } = P.topN(grupos, 27, 'cursos', { semOutros: true });
      return {
        linhas,
        config: V.barrasH({
          labels: linhas.map((l) => l.chave),
          valores: linhas.map((l) => l.cursos),
          rotulo: 'Cursos',
        }),
        note: dobradas ? `${dobradas} UFs somadas em "Outros".` : null,
        table: tabelaRanking(grupos.sort(P.desc('cursos')), [
          { key: 'cursos', label: 'Cursos' },
          { key: 'matriculados', label: 'Matriculados' },
        ]),
      };
    },
    onPick(ponto, chart, res) {
      const chave = chart.data.labels[ponto.index];
      if (res.linhas[ponto.index]?.__outros) return;
      F.alternar('uf', chave);
    },
  });

  registrar({
    id: 'municipios',
    aba: 'territorios',
    span: 6,
    title: 'Municípios que mais receberam cursos',
    hint: 'O curso é registrado no município onde a turma funcionou.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      const grupos = P.groupBy(rows, (c) => (c.municipio ? `${c.municipio} (${c.ufSigla ?? '—'})` : null), ['matriculados']);
      const { linhas, dobradas } = P.topN(grupos, 12, 'cursos', { semOutros: true });
      const cob = grupos.reduce((s, g) => s + g.cursos, 0);
      return {
        config: V.barrasH({
          labels: linhas.map((l) => nomesLimitados(l.chave)),
          titulos: linhas.map((l) => l.chave),
          valores: linhas.map((l) => l.cursos),
          rotulo: 'Cursos',
        }),
        coverage: { preenchidos: cob, total: rows.length, rotulo: 'município identificado' },
        note: dobradas ? `${dobradas} outros municípios agrupados.` : null,
        table: tabelaRanking(grupos.sort(P.desc('cursos')).slice(0, 60), [
          { key: 'cursos', label: 'Cursos' },
          { key: 'matriculados', label: 'Matriculados' },
        ]),
      };
    },
  });

  registrar({
    id: 'superintendencia',
    aba: 'territorios',
    span: 6,
    title: 'Superintendências regionais do INCRA',
    hint: 'Unidade do INCRA responsável pelo território onde o curso ocorreu.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      const grupos = P.groupBy(rows, (c) => c.superintendencia, ['matriculados']);
      const { linhas, dobradas } = P.topN(grupos, 12, 'cursos', { semOutros: true });
      return {
        config: V.barrasH({
          labels: linhas.map((l) => nomesLimitados(l.chave, 28)),
          titulos: linhas.map((l) => l.chave),
          valores: linhas.map((l) => l.cursos),
          rotulo: 'Cursos',
        }),
        note: dobradas ? `${dobradas} outras superintendências agrupadas.` : null,
        table: tabelaRanking(grupos.sort(P.desc('cursos')), [
          { key: 'cursos', label: 'Cursos' },
          { key: 'matriculados', label: 'Matriculados' },
        ]),
      };
    },
  });

  /* ====================================================== ABA: CURSOS/AREAS == */

  registrar({
    id: 'matriz',
    aba: 'cursos',
    span: 12,
    title: 'Área temática por nível de ensino',
    hint: 'Número de cursos em cada cruzamento. A intensidade da cor acompanha a contagem.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      const niveis = (P.meta.valores?.nivel ?? []).filter((n) => rows.some((r) => r.nivel === n));
      const areas = P.groupBy(rows, (c) => c.areaTematica, []).sort(P.desc('cursos')).map((g) => g.chave);
      const celulas = new Map();
      for (const r of rows) {
        if (!r.areaTematica || !r.nivel) continue;
        const k = `${r.areaTematica}||${r.nivel}`;
        celulas.set(k, (celulas.get(k) ?? 0) + 1);
      }
      const max = Math.max(0, ...celulas.values());
      return {
        niveis,
        areas,
        celulas,
        max,
        table: {
          columns: [{ key: 'area', label: 'Área temática' },
            ...niveis.map((n) => ({ key: n, label: n, num: true })),
            { key: 'total', label: 'Total', num: true }],
          rows: areas.map((a) => {
            const row = { area: a };
            let t = 0;
            for (const n of niveis) {
              const v = celulas.get(`${a}||${n}`) ?? 0;
              row[n] = v || '—';
              t += v;
            }
            row.total = int(t);
            return row;
          }),
        },
      };
    },
    render(box, rows, res) {
      const tabela = document.createElement('table');
      tabela.className = 'matrix';
      const cols = `<colgroup><col class="matrix__label">`
        + res.niveis.concat(['total']).map(() => '<col>').join('') + '</colgroup>';
      const cab = `<thead><tr><th class="row-head" scope="col">Área temática</th>`
        + res.niveis.map((n) => `<th scope="col">${n}</th>`).join('')
        + `<th scope="col">Total</th></tr></thead>`;
      const corpo = res.areas.map((a) => {
        let total = 0;
        const cels = res.niveis.map((n) => {
          const v = res.celulas.get(`${a}||${n}`) ?? 0;
          total += v;
          if (!v) return `<td class="matrix__zero" aria-label="${a}, ${n}: nenhum curso">—</td>`;
          const bg = V.seqColor(v, res.max);
          return `<td style="background:${bg};color:${V.inkOn(bg)}" title="${a} · ${n}: ${int(v)} cursos">${int(v)}</td>`;
        }).join('');
        return `<tr><th class="row-head" scope="row">${a}</th>${cels}`
          + `<td style="background:var(--surface-2);font-weight:600">${int(total)}</td></tr>`;
      }).join('');
      tabela.innerHTML = `${cols}${cab}<tbody>${corpo}</tbody>`;
      const scroll = document.createElement('div');
      scroll.style.overflowX = 'auto';
      scroll.appendChild(tabela);
      box.appendChild(scroll);
    },
  });

  registrar({
    id: 'modalidade',
    aba: 'cursos',
    span: 7,
    height: 340,
    title: 'Composição das modalidades por macrorregião',
    hint: 'Participação de cada modalidade dentro da região. Barras de 100%.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      const topo = P.topN(P.groupBy(rows, (c) => c.modalidade, []), 6, 'cursos');
      const principais = topo.linhas.filter((l) => !l.__outros).map((l) => l.chave);
      const regioes = P.groupBy(rows, (c) => c.macrorregiao, []).sort(P.desc('cursos')).map((g) => g.chave);

      const chaveDe = (c) => (principais.includes(c.modalidade) ? c.modalidade : 'Outros');
      const contagem = new Map();
      for (const r of rows) {
        if (!r.macrorregiao || !r.modalidade) continue;
        const k = `${r.macrorregiao}||${chaveDe(r)}`;
        contagem.set(k, (contagem.get(k) ?? 0) + 1);
      }
      const categorias = principais.concat(topo.dobradas ? ['Outros'] : []);
      const totalRegiao = regioes.map((reg) => categorias.reduce((s, cat) => s + (contagem.get(`${reg}||${cat}`) ?? 0), 0));

      const series = categorias.map((cat, i) => ({
        nome: cat,
        cor: cat === 'Outros' ? V.T.outros : V.slot(i),
        valores: regioes.map((reg, ri) => {
          const t = totalRegiao[ri];
          return t ? Math.round(((contagem.get(`${reg}||${cat}`) ?? 0) / t) * 1000) / 10 : 0;
        }),
      }));

      return {
        config: V.empilhada100({ labels: regioes, series }),
        legend: series.map((s) => ({ nome: s.nome, cor: s.cor })),
        formatoTip: (v) => pct(v),
        note: topo.dobradas ? `${topo.dobradas} modalidades menores somadas em "Outros".` : null,
        table: {
          columns: [{ key: 'regiao', label: 'Macrorregião' }, ...categorias.map((c) => ({ key: c, label: c, num: true }))],
          rows: regioes.map((reg, ri) => {
            const row = { regiao: reg };
            for (const cat of categorias) {
              const v = contagem.get(`${reg}||${cat}`) ?? 0;
              row[cat] = totalRegiao[ri] ? `${int(v)} (${pct((v / totalRegiao[ri]) * 100, 0)})` : '—';
            }
            return row;
          }),
        },
      };
    },
  });

  registrar({
    id: 'duracao',
    aba: 'cursos',
    span: 5,
    title: 'Duração dos cursos',
    hint: 'Anos entre o início e o fim registrados. Faixas em ordem crescente.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      const FAIXAS = [
        { rotulo: 'Menos de 1 ano', teste: (d) => d < 1 },
        { rotulo: '1 ano', teste: (d) => d === 1 },
        { rotulo: '2 anos', teste: (d) => d === 2 },
        { rotulo: '3 anos', teste: (d) => d === 3 },
        { rotulo: '4 a 5 anos', teste: (d) => d >= 4 && d <= 5 },
        { rotulo: '6 anos ou mais', teste: (d) => d >= 6 },
      ];
      const contagem = FAIXAS.map(() => 0);
      let base = 0;
      for (const r of rows) {
        if (r.duracaoAnos == null) continue;
        base++;
        const i = FAIXAS.findIndex((f) => f.teste(r.duracaoAnos));
        if (i >= 0) contagem[i]++;
      }
      const passos = V.T.seq;
      const config = V.barrasH({
        labels: FAIXAS.map((f) => f.rotulo),
        valores: contagem,
        rotulo: 'Cursos',
      });
      config.data.datasets[0].backgroundColor = FAIXAS.map((_, i) => passos[Math.min(passos.length - 1, Math.round((i / (FAIXAS.length - 1)) * (passos.length - 1)))]);
      return {
        config,
        coverage: { preenchidos: base, total: rows.length, rotulo: 'início e fim informados' },
        table: {
          columns: [{ key: 'faixa', label: 'Duração' }, { key: 'cursos', label: 'Cursos', num: true }],
          rows: FAIXAS.map((f, i) => ({ faixa: f.rotulo, cursos: int(contagem[i]) })),
        },
      };
    },
  });

  registrar({
    id: 'metaVsReal',
    aba: 'cursos',
    span: 12,
    height: 420,
    title: 'Meta de vagas e matrículas efetivas',
    hint: 'Cada ponto é um curso. Acima da linha, matriculou mais que a meta; abaixo, menos.',
    build(rows) {
      const validos = rows.filter((r) => r.metaFinal != null && r.matriculados != null);
      if (!validos.length) {
        return {
          vazio: true,
          vazioMensagem: 'Nenhum curso do recorte tem meta final e matrículas informadas ao mesmo tempo.',
        };
      }
      const limite = Math.max(...validos.map((r) => Math.max(r.metaFinal, r.matriculados)));
      const pontos = validos.map((r) => ({ x: r.metaFinal, y: r.matriculados, curso: r }));
      const acima = validos.filter((r) => r.matriculados > r.metaFinal).length;
      return {
        config: V.dispersao({
          pontos,
          xTitulo: 'Meta final de vagas',
          yTitulo: 'Matriculados',
          limite: Math.ceil(limite * 1.02),
        }),
        legend: [
          { nome: 'Curso', cor: V.slot(0) },
          { nome: 'Meta cumprida exatamente', cor: V.T.baseline, linha: true },
        ],
        coverage: { preenchidos: validos.length, total: rows.length, rotulo: 'meta e matrícula' },
        note: `${int(acima)} de ${int(validos.length)} cursos superaram a meta.`,
        tooltip: (pontos_, chart) => {
          const p = pontos_[0];
          if (p.datasetIndex !== 0) return '';
          const d = chart.data.datasets[0].data[p.index];
          const c = d.curso;
          return `<div class="viz-tip__title">${nomesLimitados(c.nomeProcessual, 52)}</div>`
            + V.linhaTip(V.T.baseline, 'Meta final', int(c.metaFinal))
            + V.linhaTip(V.slot(0), 'Matriculados', int(c.matriculados))
            + `<div class="viz-tip__note">${c.uf ?? '—'} · ${c.areaTematica ?? '—'}</div>`;
        },
        table: {
          columns: [
            { key: 'curso', label: 'Curso' },
            { key: 'uf', label: 'UF' },
            { key: 'meta', label: 'Meta final', num: true },
            { key: 'mat', label: 'Matriculados', num: true },
            { key: 'dif', label: 'Diferença', num: true },
          ],
          rows: validos
            .slice()
            .sort((a, b) => (b.matriculados - b.metaFinal) - (a.matriculados - a.metaFinal))
            .map((r) => ({
              curso: nomesLimitados(r.nomeProcessual, 60),
              uf: r.ufSigla ?? '—',
              meta: int(r.metaFinal),
              mat: int(r.matriculados),
              dif: `${r.matriculados - r.metaFinal > 0 ? '+' : ''}${int(r.matriculados - r.metaFinal)}`,
            })),
        },
      };
    },
  });

  /* ==================================================== ABA: INSTITUICOES ==== */

  registrar({
    id: 'rankIes',
    aba: 'instituicoes',
    span: 7,
    title: 'Instituições de ensino realizadoras',
    hint: 'Quem executou os cursos. Clique para filtrar o painel pela instituição.',
    build(rows) {
      if (semDados(rows)) return { vazio: true, linhas: [] };
      const grupos = P.groupBy(rows, (c) => c.ies?.nome, ['matriculados']);
      const { linhas, dobradas } = P.topN(grupos, 14, 'cursos', { semOutros: true });
      return {
        linhas,
        config: V.barrasH({
          labels: linhas.map((l) => nomesLimitados(l.chave, 32)),
          titulos: linhas.map((l) => l.chave),
          valores: linhas.map((l) => l.cursos),
          rotulo: 'Cursos',
        }),
        note: dobradas ? `${dobradas} outras instituições agrupadas.` : null,
        table: tabelaRanking(grupos.sort(P.desc('cursos')), [
          { key: 'cursos', label: 'Cursos' },
          { key: 'matriculados', label: 'Matriculados' },
        ]),
      };
    },
    onPick(ponto, chart, res) {
      const linha = res.linhas[ponto.index];
      if (!linha || linha.__outros) return;
      F.alternar('ies', linha.chave);
    },
  });

  registrar({
    id: 'natureza',
    aba: 'instituicoes',
    span: 5,
    title: 'Natureza das instituições',
    hint: 'Um curso pode envolver mais de uma natureza; nesse caso conta em cada uma.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      const grupos = P.groupBy(rows, (c) => c.ies?.natureza ?? [], ['matriculados']).sort(P.desc('cursos'));
      return {
        config: V.barrasH({
          labels: grupos.map((g) => g.chave),
          valores: grupos.map((g) => g.cursos),
          rotulo: 'Cursos',
        }),
        table: tabelaRanking(grupos, [
          { key: 'cursos', label: 'Cursos' },
          { key: 'matriculados', label: 'Matriculados' },
        ]),
      };
    },
    onPick(ponto, chart) {
      F.alternar('iesNatureza', chart.data.labels[ponto.index]);
    },
  });

  registrar({
    id: 'titulacao',
    aba: 'instituicoes',
    span: 5,
    title: 'Titulação de quem coordenou',
    hint: 'Contagem de pessoas em funções de coordenação, por titulação.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      const ORDEM = ['Graduação', 'Especialização', 'Mestrado', 'Doutorado', 'Pós-doutorado'];
      const contagem = new Map();
      for (const r of rows) {
        for (const c of r.coordenadores || []) {
          if (c.titulacao) contagem.set(c.titulacao, (contagem.get(c.titulacao) ?? 0) + 1);
        }
      }
      const chaves = ORDEM.filter((k) => contagem.has(k));
      const passos = V.T.seq;
      const config = V.barrasH({
        labels: chaves,
        valores: chaves.map((k) => contagem.get(k)),
        rotulo: 'Pessoas',
      });
      config.data.datasets[0].backgroundColor = chaves.map((_, i) => passos[Math.min(passos.length - 1, Math.round((i / Math.max(1, chaves.length - 1)) * (passos.length - 1)))]);
      const total = [...contagem.values()].reduce((a, b) => a + b, 0);
      return {
        config,
        note: `${int(total)} registros de coordenação com titulação informada.`,
        table: {
          columns: [{ key: 'chave', label: 'Titulação' }, { key: 'n', label: 'Pessoas', num: true }],
          rows: chaves.map((k) => ({ chave: k, n: int(contagem.get(k)) })),
        },
      };
    },
  });

  registrar({
    id: 'demandantes',
    aba: 'instituicoes',
    span: 6,
    title: 'Organizações demandantes',
    hint: 'Movimentos sociais, sindicatos e entidades que pediram os cursos.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      // Agrupa pela lista, nao pelo campo bruto: um curso pode ter varias
      // organizacoes demandantes num mesmo texto, e cada uma conta uma vez.
      const grupos = P.groupBy(rows, (c) => c.demandante?.nomes ?? [], ['matriculados']);
      const { linhas, dobradas } = P.topN(grupos, 12, 'cursos', { semOutros: true });
      const cob = rows.filter((r) => (r.demandante?.nomes ?? []).length).length;
      return {
        config: V.barrasH({
          labels: linhas.map((l) => nomesLimitados(l.chave, 30)),
          titulos: linhas.map((l) => l.chave),
          valores: linhas.map((l) => l.cursos),
          rotulo: 'Cursos',
        }),
        coverage: { preenchidos: cob, total: rows.length, rotulo: 'demandante identificado' },
        note: dobradas ? `${dobradas} outras organizações agrupadas.` : null,
        table: tabelaRanking(grupos.sort(P.desc('cursos')), [
          { key: 'cursos', label: 'Cursos' },
          { key: 'matriculados', label: 'Matriculados' },
        ]),
      };
    },
  });

  registrar({
    id: 'parceiras',
    aba: 'instituicoes',
    span: 6,
    title: 'Instituições parceiras mais presentes',
    hint: 'Cada curso pode ter várias parceiras; todas são contadas.',
    build(rows) {
      if (semDados(rows)) return { vazio: true };
      const grupos = P.groupBy(rows, (c) => c.parceiras?.nomes ?? [], ['matriculados']);
      const { linhas, dobradas } = P.topN(grupos, 12, 'cursos', { semOutros: true });
      const cob = rows.filter((r) => (r.parceiras?.nomes ?? []).length).length;
      return {
        config: V.barrasH({
          labels: linhas.map((l) => nomesLimitados(l.chave, 30)),
          titulos: linhas.map((l) => l.chave),
          valores: linhas.map((l) => l.cursos),
          rotulo: 'Cursos',
        }),
        coverage: { preenchidos: cob, total: rows.length, rotulo: 'parceira informada' },
        note: dobradas ? `${dobradas} outras parceiras agrupadas.` : null,
        table: tabelaRanking(grupos.sort(P.desc('cursos')).slice(0, 80), [
          { key: 'cursos', label: 'Cursos' },
          { key: 'matriculados', label: 'Matriculados' },
        ]),
      };
    },
  });
}());
