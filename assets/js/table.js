/* =============================================================================
   PNERA — base de dados
   A tabela completa do recorte: ordenavel, paginada, com detalhe do curso em
   modal e exportacao do recorte em CSV. E tambem a alternativa acessivel a
   qualquer grafico do painel.
   ========================================================================== */

window.Tabela = (function () {
  'use strict';

  const P = window.PNERA;
  const F = window.Filters;
  const { int, pct } = P;

  const COLUNAS = [
    { key: 'nomeProcessual', label: 'Curso', cls: 'cell-name', get: (c) => c.nomeProcessual },
    { key: 'fase', label: 'Fase', get: (c) => c.fase, render: (c) => faseTag(c.fase) },
    { key: 'areaTematica', label: 'Área temática', get: (c) => c.areaTematica },
    { key: 'nivel', label: 'Nível', get: (c) => c.nivel },
    { key: 'uf', label: 'UF', get: (c) => c.ufSigla },
    { key: 'municipio', label: 'Município', get: (c) => c.municipio },
    { key: 'ies', label: 'Instituição', get: (c) => c.ies?.nome },
    { key: 'anoInicio', label: 'Início', num: true, get: (c) => c.anoInicio },
    { key: 'anoFim', label: 'Fim', num: true, get: (c) => c.anoFim },
    { key: 'turmas', label: 'Turmas', num: true, get: (c) => c.turmas },
    { key: 'matriculados', label: 'Matriculados', num: true, get: (c) => c.matriculados },
    { key: 'concluintes', label: 'Concluintes', num: true, get: (c) => c.concluintes },
    { key: 'taxaConclusao', label: 'Conclusão', num: true, get: (c) => c.taxaConclusao, render: (c) => (c.taxaConclusao == null ? '<span class="muted">—</span>' : pct(c.taxaConclusao)) },
  ];

  const TAMANHOS = [25, 50, 100, 250];

  const estado = { ordem: 'anoInicio', dir: -1, pagina: 1, tamanho: 50 };
  let container = null;
  let linhasAtuais = [];

  const faseTag = (fase) => (!fase ? '<span class="muted">—</span>'
    : `<span class="tag tag--${fase === 'PNERA II' ? 'fase2' : 'fase3'}">${fase}</span>`);

  const escapar = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

  /** Nulos sempre no fim, independente da direcao — nao poluem o topo do ranking. */
  function ordenar(rows) {
    const col = COLUNAS.find((c) => c.key === estado.ordem) || COLUNAS[0];
    return rows.slice().sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * estado.dir;
      return String(va).localeCompare(String(vb), 'pt-BR') * estado.dir;
    });
  }

  function montar(el, rows) {
    container = el;
    el.innerHTML = `
      <section class="card span-12">
        <div class="card__head">
          <div>
            <h3 class="card__title">Base de dados</h3>
            <p class="card__hint">Os cursos do recorte atual. Clique numa linha para ver o registro completo.</p>
          </div>
          <div class="card__tools">
            <button type="button" class="icon-btn js-csv">Exportar CSV</button>
          </div>
        </div>
        <div class="data-toolbar">
          <span class="js-contagem muted"></span>
          <span class="ms-auto d-flex align-items-center gap-2">
            <label class="muted" for="tam-pagina">Linhas</label>
            <select id="tam-pagina" class="form-select form-select-sm" style="width:auto">
              ${TAMANHOS.map((t) => `<option value="${t}"${t === estado.tamanho ? ' selected' : ''}>${t}</option>`).join('')}
            </select>
          </span>
        </div>
        <div class="data-scroll js-scroll"></div>
        <div class="pager js-pager"></div>
      </section>`;

    el.querySelector('.js-csv').addEventListener('click', exportarCsv);
    el.querySelector('#tam-pagina').addEventListener('change', (ev) => {
      estado.tamanho = Number(ev.target.value);
      estado.pagina = 1;
      pintar(linhasAtuais);
    });
    pintar(rows);
  }

  function pintar(rows) {
    linhasAtuais = rows;
    if (!container) return;
    const scroll = container.querySelector('.js-scroll');

    if (!rows.length) {
      scroll.innerHTML = `<div class="empty">
        <span class="empty__title">Nada neste recorte</span>
        <span>Nenhum curso corresponde aos filtros aplicados.</span>
        <button type="button" class="icon-btn js-limpar">Limpar filtros</button></div>`;
      container.querySelector('.js-pager').innerHTML = '';
      container.querySelector('.js-contagem').textContent = '';
      return;
    }

    const ordenadas = ordenar(rows);
    const paginas = Math.max(1, Math.ceil(ordenadas.length / estado.tamanho));
    estado.pagina = Math.min(estado.pagina, paginas);
    const inicio = (estado.pagina - 1) * estado.tamanho;
    const pagina = ordenadas.slice(inicio, inicio + estado.tamanho);

    const cab = COLUNAS.map((c) => {
      const ativa = estado.ordem === c.key;
      const seta = ativa ? `<span class="dir">${estado.dir === 1 ? '↑' : '↓'}</span>` : '';
      return `<th scope="col" class="sortable ${c.num ? 'num' : ''}" data-col="${c.key}"
        aria-sort="${ativa ? (estado.dir === 1 ? 'ascending' : 'descending') : 'none'}">${c.label} ${seta}</th>`;
    }).join('');

    const corpo = pagina.map((c) => `<tr tabindex="0" data-id="${c.id}">`
      + COLUNAS.map((col) => {
        const conteudo = col.render ? col.render(c) : (() => {
          const v = col.get(c);
          if (v == null || v === '') return '<span class="muted">—</span>';
          return col.num ? int(v) : escapar(v);
        })();
        return `<td class="${col.cls || ''} ${col.num ? 'num' : ''}">${conteudo}</td>`;
      }).join('')
      + '</tr>').join('');

    scroll.innerHTML = `<table class="data-table">
      <caption class="visually-hidden">Cursos do recorte atual</caption>
      <thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table>`;

    scroll.querySelectorAll('th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (estado.ordem === col) estado.dir *= -1;
        else { estado.ordem = col; estado.dir = COLUNAS.find((c) => c.key === col)?.num ? -1 : 1; }
        pintar(linhasAtuais);
      });
    });

    scroll.querySelectorAll('tbody tr').forEach((tr) => {
      const abrir = () => detalhe(rows.find((c) => c.id === Number(tr.dataset.id)));
      tr.addEventListener('click', abrir);
      tr.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); abrir(); }
      });
    });

    container.querySelector('.js-contagem').textContent = F.temFiltro()
      ? `${int(rows.length)} cursos no recorte (de ${int(P.data.length)})`
      : `${int(rows.length)} cursos`;

    pintarPaginador(paginas, ordenadas.length, inicio, pagina.length);
  }

  function pintarPaginador(paginas, total, inicio, nesta) {
    const el = container.querySelector('.js-pager');
    el.innerHTML = `
      <button type="button" class="icon-btn js-prev" ${estado.pagina === 1 ? 'disabled' : ''}>← Anterior</button>
      <span class="num">${int(inicio + 1)}–${int(inicio + nesta)} de ${int(total)}</span>
      <button type="button" class="icon-btn js-next" ${estado.pagina === paginas ? 'disabled' : ''}>Próxima →</button>
      <span class="muted ms-auto">Página ${estado.pagina} de ${paginas}</span>`;
    el.querySelector('.js-prev').addEventListener('click', () => { estado.pagina--; pintar(linhasAtuais); });
    el.querySelector('.js-next').addEventListener('click', () => { estado.pagina++; pintar(linhasAtuais); });
  }

  /* -------------------------------------------------------------- detalhe --- */

  function bloco(titulo, pares) {
    const itens = pares.filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length));
    if (!itens.length) return '';
    return `<h6 class="text-uppercase mt-3 mb-2" style="letter-spacing:.06em;font-size:var(--step--1);color:var(--ink-muted)">${titulo}</h6>`
      + `<dl class="row mb-0">${itens.map(([k, v]) => `
        <dt class="col-sm-5 fw-normal" style="color:var(--ink-muted)">${k}</dt>
        <dd class="col-sm-7">${Array.isArray(v) ? v.map(escapar).join('<br>') : escapar(v)}</dd>`).join('')}</dl>`;
  }

  function detalhe(curso) {
    if (!curso) return;
    const el = document.getElementById('modalCurso');
    el.querySelector('.modal-title').textContent = curso.nomeProcessual || 'Curso';
    el.querySelector('.modal-body').innerHTML = `
      <p class="mb-2">${faseTag(curso.fase)}
        <span class="tag">${escapar(curso.areaTematica ?? '—')}</span>
        <span class="tag">${escapar(curso.nivel ?? '—')}</span></p>
      ${bloco('Identificação', [
    ['Nome do curso', curso.curso],
    ['Código SEI', curso.codigoSei],
    ['NUP', curso.nup],
    ['Modalidade', curso.modalidade],
    ['Área do conhecimento', curso.areaConhecimento],
  ])}
      ${bloco('Território', [
    ['Macrorregião', curso.macrorregiao],
    ['Estado', curso.uf],
    ['Município', curso.municipio],
    ['Código IBGE', curso.codMunicipio],
    ['Superintendência', curso.superintendencia],
  ])}
      ${bloco('Execução', [
    ['Instrumento', curso.instrumento],
    ['Nº do instrumento', curso.numeroInstrumento],
    ['Vigência', [curso.vigenciaInicio, curso.vigenciaFim].filter(Boolean).join(' a ') || null],
    ['Previsto', [curso.previstoInicio, curso.previstoFim].filter(Boolean).join(' a ') || null],
    ['Realizado', [curso.inicio, curso.fim].filter(Boolean).join(' a ') || null],
  ])}
      ${bloco('Números', [
    ['Turmas', curso.turmas == null ? null : int(curso.turmas)],
    ['Meta inicial', curso.metaInicial == null ? null : int(curso.metaInicial)],
    ['Meta final', curso.metaFinal == null ? null : int(curso.metaFinal)],
    ['Matriculados', curso.matriculados == null ? null : int(curso.matriculados)],
    ['Concluintes', curso.concluintes == null ? null : int(curso.concluintes)],
    ['Taxa de conclusão', curso.taxaConclusao == null ? null : pct(curso.taxaConclusao)],
    ['Bolsistas', curso.bolsistas == null ? null : int(curso.bolsistas)],
  ])}
      ${bloco('Instituição realizadora', [
    ['Nome', curso.ies?.nome],
    ['Natureza', curso.ies?.natureza],
    ['Sede', [curso.ies?.municipio, curso.ies?.uf].filter(Boolean).join(' / ') || null],
  ])}
      ${bloco('Coordenação', (curso.coordenadores || []).map((c) => [c.papel, [c.nome, c.titulacao].filter(Boolean).join(' — ')]))}
      ${bloco('Demanda e parcerias', [
    ['Organização demandante', curso.demandante?.nome],
    ['Natureza da demandante', curso.demandante?.natureza],
    ['Abrangência', curso.demandante?.abrangencia],
    ['Instituições parceiras', curso.parceiras?.nomes],
    ['Atuação das parceiras', curso.parceiras?.atuacao],
  ])}`;
    window.bootstrap.Modal.getOrCreateInstance(el).show();
  }

  /* ----------------------------------------------------------------- CSV ---- */

  const CSV_COLUNAS = [
    ['id', (c) => c.id], ['fase', (c) => c.fase], ['codigo_sei', (c) => c.codigoSei],
    ['nome_processual', (c) => c.nomeProcessual], ['curso', (c) => c.curso],
    ['area_tematica', (c) => c.areaTematica], ['area_conhecimento', (c) => c.areaConhecimento],
    ['nivel', (c) => c.nivel], ['modalidade', (c) => c.modalidade],
    ['macrorregiao', (c) => c.macrorregiao], ['uf', (c) => c.uf], ['uf_sigla', (c) => c.ufSigla],
    ['municipio', (c) => c.municipio], ['cod_municipio', (c) => c.codMunicipio],
    ['superintendencia', (c) => c.superintendencia], ['instrumento', (c) => c.instrumento],
    ['ano_inicio', (c) => c.anoInicio], ['ano_fim', (c) => c.anoFim],
    ['turmas', (c) => c.turmas], ['meta_inicial', (c) => c.metaInicial], ['meta_final', (c) => c.metaFinal],
    ['matriculados', (c) => c.matriculados], ['concluintes', (c) => c.concluintes],
    ['taxa_conclusao', (c) => c.taxaConclusao], ['bolsistas', (c) => c.bolsistas],
    ['instituicao', (c) => c.ies?.nome], ['instituicao_natureza', (c) => (c.ies?.natureza || []).join('; ')],
    ['instituicao_uf', (c) => c.ies?.uf], ['demandante', (c) => c.demandante?.nome],
    ['parceiras', (c) => (c.parceiras?.nomes || []).join('; ')],
  ];

  function exportarCsv() {
    const linhas = [CSV_COLUNAS.map(([nome]) => nome).join(';')];
    for (const c of ordenar(linhasAtuais)) {
      linhas.push(CSV_COLUNAS.map(([, get]) => {
        const v = get(c);
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[;"\n]/.test(s) ? `"${s}"` : s;
      }).join(';'));
    }
    // BOM para o Excel abrir os acentos corretamente.
    const blob = new Blob([`﻿${linhas.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pnera-${linhasAtuais.length}-cursos.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { montar, pintar, detalhe };
}());
