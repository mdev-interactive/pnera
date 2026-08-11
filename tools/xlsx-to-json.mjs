/**
 * Conversor OFICIAL PNERA_*.xlsx -> data/pnera.json + data/pnera.meta.json
 * + assets/js/dataset.js (para uso via file://).
 *
 * Node >= 18, sem dependencias externas: um .xlsx e um zip, lido aqui via zlib.
 *
 * Fonte autoritativa: aba "CURSOS GERAL" (linha 3 = cabecalho, linhas 4+ = cursos).
 * As 33 abas ocultas sao recortes deslocados da mesma aba e sao ignoradas.
 *
 * Uso: node tools/xlsx-to-json.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEET_NAME = 'CURSOS GERAL';
const HEADER_ROW = 3;

/* ------------------------------------------------------------------ zip ---- */

/** Le um zip e devolve { nomeDoArquivo: Buffer } apenas das entradas pedidas. */
function readZip(file, wanted) {
  const buf = fs.readFileSync(file);
  // End of central directory: assinatura 0x06054b50, procurada de tras para frente.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Zip invalido: EOCD nao encontrado');

  const entries = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const out = {};

  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Zip invalido: header central');
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    ptr += 46 + nameLen + extraLen + commentLen;

    if (!wanted(name)) continue;

    // Header local: o tamanho do nome/extra pode diferir do central.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    out[name] = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
  }
  return out;
}

/* ------------------------------------------------------------------ xml ---- */

const XML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
};
function unescapeXml(s) {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m])
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Concatena todo o texto <t> de um fragmento (rich text vira string unica). */
function textOf(fragment) {
  let out = '';
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(fragment))) out += m[1];
  return unescapeXml(out);
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) strings.push(textOf(m[1]));
  return strings;
}

/** Devolve Map<numeroDaLinha, { A: valor, B: valor, ... }>. */
function parseSheet(xml, sharedStrings) {
  const rows = new Map();
  const rowRe = /<row[^>]*\sr="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c[^>]*?r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let r;
  while ((r = rowRe.exec(xml))) {
    const cells = {};
    let c;
    cellRe.lastIndex = 0;
    while ((c = cellRe.exec(r[2]))) {
      const col = c[1];
      const attrs = c[2] || '';
      const inner = c[3] || '';
      let value = null;
      const inline = /<is>([\s\S]*?)<\/is>/.exec(inner);
      if (inline) {
        value = textOf(inline[1]);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (v) {
          value = /t="s"/.test(attrs) ? sharedStrings[+v[1]] : unescapeXml(v[1]);
        }
      }
      if (value != null && value !== '') cells[col] = value;
    }
    rows.set(+r[1], cells);
  }
  return rows;
}

/* --------------------------------------------------------- normalizacao ---- */

const MISSING = new Set([
  'NAO LOCALIZADO', 'NAO LOCALIZADA', 'NAO INFORMADO', 'N.I', 'N.I.', 'NI',
  'NAO SE APLICA', 'N/A', '-', '--', 'SEM INFORMACAO',
]);

/** Colapsa espacos, remove acentos e caixa para servir de chave de comparacao. */
function key(value) {
  return String(value)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Limpa a celula bruta: espacos, quebras de linha e marcadores de ausencia. */
function clean(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (MISSING.has(key(s))) return null;
  return s;
}

/** Numero a partir de texto tipo "1502301.0", "1.116", "42,5". */
function num(raw) {
  const s = clean(raw);
  if (s == null) return null;
  let t = s.replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function int(raw) {
  const n = num(raw);
  return n == null ? null : Math.round(n);
}

/** Codigo IBGE de municipio: 7 digitos, sem o ".0" do Excel. */
function ibge(raw) {
  const n = int(raw);
  if (n == null) return null;
  const s = String(n);
  return s.length === 7 ? s : s.padStart(7, '0');
}

const UF_NOMES = {
  ACRE: 'Acre', ALAGOAS: 'Alagoas', AMAPA: 'Amapá', AMAZONAS: 'Amazonas',
  BAHIA: 'Bahia', CEARA: 'Ceará', 'DISTRITO FEDERAL': 'Distrito Federal',
  'ESPIRITO SANTO': 'Espírito Santo', GOIAS: 'Goiás', MARANHAO: 'Maranhão',
  'MATO GROSSO': 'Mato Grosso', 'MATO GROSSO DO SUL': 'Mato Grosso do Sul',
  'MINAS GERAIS': 'Minas Gerais', PARA: 'Pará', PARAIBA: 'Paraíba',
  PARANA: 'Paraná', PERNAMBUCO: 'Pernambuco', PIAUI: 'Piauí',
  'RIO DE JANEIRO': 'Rio de Janeiro', 'RIO GRANDE DO NORTE': 'Rio Grande do Norte',
  'RIO GRANDE DO SUL': 'Rio Grande do Sul', RONDONIA: 'Rondônia', RORAIMA: 'Roraima',
  'SANTA CATARINA': 'Santa Catarina', 'SAO PAULO': 'São Paulo', SERGIPE: 'Sergipe',
  TOCANTINS: 'Tocantins',
};

const UF_SIGLAS = {
  Acre: 'AC', Alagoas: 'AL', Amapá: 'AP', Amazonas: 'AM', Bahia: 'BA', Ceará: 'CE',
  'Distrito Federal': 'DF', 'Espírito Santo': 'ES', Goiás: 'GO', Maranhão: 'MA',
  'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG', Pará: 'PA',
  Paraíba: 'PB', Paraná: 'PR', Pernambuco: 'PE', Piauí: 'PI', 'Rio de Janeiro': 'RJ',
  'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS', Rondônia: 'RO',
  Roraima: 'RR', 'Santa Catarina': 'SC', 'São Paulo': 'SP', Sergipe: 'SE',
  Tocantins: 'TO',
};

const UF_REGIAO = {
  AC: 'Norte', AP: 'Norte', AM: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte',
  AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste',
  PE: 'Nordeste', PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste',
  DF: 'Centro-Oeste', GO: 'Centro-Oeste', MT: 'Centro-Oeste', MS: 'Centro-Oeste',
  ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste',
  PR: 'Sul', RS: 'Sul', SC: 'Sul',
};

const SMALL_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos', 'a', 'o', 'as', 'os', 'com', 'sem', 'por', 'ao', 'aos', 'para']);

/**
 * Siglas mantidas em caixa alta. Comeca com um nucleo fixo e e enriquecida em
 * tempo de execucao por collectAcronyms(): tudo que a planilha escreve entre
 * parenteses (UFPA, EMBRAPA, FETAGRI, ...) tambem vale solto no meio do texto.
 */
const KEEP_UPPER = new Set(['EJA', 'TED', 'SEI', 'NUP', 'SR', 'IES', 'PNERA', 'PRONERA', 'INCRA', 'MDA', 'CNPQ', 'MEC', 'EAD', 'UF', 'ONG', 'II', 'III', 'IV']);

/**
 * Palavras que aparecem entre parenteses na planilha mas sao palavras comuns,
 * nao siglas — se entrassem na lista, "normal" viraria "NORMAL" em texto livre.
 */
const NAO_SIGLA = new Set(['NORMAL', 'FORMAL', 'INTEGRADO', 'SUBSEQUENTE', 'CONCOMITANTE', 'INICIO', 'FIM', 'NOVO', 'ANTIGO']);

/**
 * Varre todas as celulas e registra como sigla o que aparece entre parenteses.
 * Aceita siglas compostas curtas ("FETAGRI PA", "CAR RR") e guarda tanto a forma
 * inteira quanto cada parte, porque no texto elas aparecem como tokens soltos.
 */
function collectAcronyms(rows) {
  const re = /\(([A-Z0-9][A-Z0-9.\-/]{1,11}(?:\s+[A-Z]{2,4})*)\)/g;
  for (const cells of rows.values()) {
    for (const value of Object.values(cells)) {
      for (const m of String(value).matchAll(re)) {
        const partes = m[1].split(/\s+/).concat(m[1]);
        for (const parte of partes) {
          const sigla = parte.replace(/[^A-Z0-9]/g, '');
          if (sigla.length >= 2 && !NAO_SIGLA.has(sigla)) KEEP_UPPER.add(sigla);
        }
      }
    }
  }
}

/**
 * A planilha e toda sem acento. Restaura os nomes de UF em texto livre.
 * "PARA" fica de fora do padrao geral porque colide com a preposicao "para" —
 * so e tratado quando precedido de artigo ("DO PARA").
 */
const UF_ACENTOS = Object.entries(UF_NOMES)
  .filter(([sem, com]) => sem !== com && sem !== 'PARA')
  .map(([sem, com]) => [new RegExp(`\\b${sem}\\b`, 'gi'), com]);

function restoreUfAccents(s) {
  let out = s
    // "DO PARA", "SR 01 - PARA", "PARA / BELEM" -> estado; "PARA" solto = preposicao.
    .replace(/\b(DO|DE)\s+PARA\b/gi, (_, art) => `${art} Pará`)
    .replace(/(-\s*)PARA\b/gi, (_, dash) => `${dash}Pará`)
    .replace(/\bPARA(\s*\/)/gi, (_, tail) => `Pará${tail}`)
    // "SAO" e sempre "São" em portugues (Sao Paulo, Sao Francisco, Sao Luis).
    .replace(/\bSAO\b/g, 'São');
  for (const [re, com] of UF_ACENTOS) out = out.replace(re, com);
  return out;
}

/** Title Case pt-BR: preposicoes minusculas, siglas e acentos de UF preservados. */
function titleCase(raw) {
  const s = clean(raw);
  if (s == null) return null;
  return restoreUfAccents(s).split(' ').map((word, i) => {
    const bare = word.replace(/[^\p{L}\p{N}]/gu, '');
    if (!bare) return word;
    // Sigla (entre parenteses ou reconhecida) mantem a caixa alta.
    if (KEEP_UPPER.has(bare.toUpperCase())) return word.toUpperCase();
    const lower = bare.toLowerCase();
    if (i > 0 && SMALL_WORDS.has(lower)) return word.toLowerCase();
    // Palavra ja acentuada por restoreUfAccents nao deve ser rebaixada.
    if (/\p{Lu}\p{Ll}/u.test(word) && /[À-ÿ]/.test(word)) return word;
    return word.replace(/\p{L}[\p{L}\p{N}'’-]*/u, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
  }).join(' ');
}

/** Codigo SEI: numerico vira inteiro ("1004.0" -> "1004"); protocolo fica igual. */
function codigoSei(raw) {
  const s = clean(raw);
  if (s == null) return null;
  return /^\d+(\.0+)?$/.test(s) ? String(Math.round(Number.parseFloat(s))) : s;
}

/** Fabrica um normalizador de dominio fechado a partir de um mapa canonico. */
function domain(map, { fallback = titleCase } = {}) {
  const table = new Map(Object.entries(map).map(([k, v]) => [key(k), v]));
  return (raw) => {
    const s = clean(raw);
    if (s == null) return null;
    return table.get(key(s)) ?? fallback(s);
  };
}

// "80" aparece como ruido na coluna de macrorregiao da instituicao realizadora.
const REGIOES_VALIDAS = new Set(['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul']);
const normRegiao = domain({
  NORTE: 'Norte', NORDESTE: 'Nordeste', NORDETE: 'Nordeste',
  'CENTRO-OESTE': 'Centro-Oeste', 'CENTRO OESTE': 'Centro-Oeste',
  SUDESTE: 'Sudeste', SUL: 'Sul',
}, { fallback: () => null });

const normUf = domain(UF_NOMES, { fallback: () => null });

const normAreaTematica = domain({
  EJA: 'EJA',
  'FORMACAO DE EDUCADORES': 'Formação de Educadores',
  AGROECOLOGIA: 'Agroecologia',
  'RESIDENCIA AGRARIA': 'Residência Agrária',
  'SAUDE/SERVICO SOCIAL': 'Saúde e Serviço Social',
  'LINGUAGEM/COMUNICACAO/ARTE': 'Linguagem, Comunicação e Arte',
  'CIENCIAS AGRARIAS': 'Ciências Agrárias',
  GEOGRAFIA: 'Geografia',
  'AGROINDUSTRIA/COOPERATIVISMO': 'Agroindústria e Cooperativismo',
  HISTORIA: 'História',
  DIREITO: 'Direito',
});

const normAreaConhecimento = domain({
  MULTIDISCIPLINAR: 'Multidisciplinar',
  'CIENCIAS HUMANAS': 'Ciências Humanas',
  'CIENCIAS AGRARIAS': 'Ciências Agrárias',
  'CIENCIAS DA SAUDE': 'Ciências da Saúde',
  'LINGUISTICA LETRAS E ARTES': 'Linguística, Letras e Artes',
  'CIENCIAS SOCIAIS APLICADAS': 'Ciências Sociais Aplicadas',
  'CIENCIAS BIOLOGICAS': 'Ciências Biológicas',
  ENGENHARIAS: 'Engenharias',
  'CIENCIAS EXATAS E DA TERRA': 'Ciências Exatas e da Terra',
});

const normNivel = domain({
  'EJA FUNDAMENTAL': 'EJA Fundamental',
  'NIVEL FUNDAMENTAL': 'Fundamental',
  'NIVEL MEDIO': 'Médio',
  'NIVEL SUPERIOR': 'Superior',
  SUPERIOR: 'Superior',
  'RESIDENCIA AGRARIA': 'Residência Agrária',
  CAPACITACAO: 'Capacitação',
});

const normModalidade = domain({
  'EJA ALFABETIZACAO': 'EJA Alfabetização',
  'EJA ANOS INICIAIS': 'EJA Anos Iniciais',
  'EJA ANOS FINAIS': 'EJA Anos Finais',
  'EJA ENSINO MEDIO (MAGISTERIO/FORMAL)': 'EJA Ensino Médio (Magistério)',
  'EJA ENSINO MEDIO (NORMAL)': 'EJA Ensino Médio (Normal)',
  'EJA ENSINO MEDIO/TECNICO (INTEGRADO)': 'EJA Ensino Médio/Técnico (Integrado)',
  'ENSINO MEDIO/TECNICO (INTEGRADO)': 'Ensino Médio/Técnico (Integrado)',
  'TECNICO INTEGRADO': 'Ensino Médio/Técnico (Integrado)',
  'ENSINO MEDIO/TECNICO (CONCOMITANTE)': 'Ensino Médio/Técnico (Concomitante)',
  'TECNICO CONCOMITANTE': 'Ensino Médio/Técnico (Concomitante)',
  'ENSINO MEDIO/TECNICO (SUBSEQUENTE)': 'Ensino Médio/Técnico (Subsequente)',
  'ENSINO MEDIO PROFISSIONAL (POS-MEDIO)': 'Ensino Médio Profissional (Pós-médio)',
  'NIVEL MEDIO PROFISSIONAL (SUBSEQUENTE)': 'Ensino Médio Profissional (Subsequente)',
  GRADUACAO: 'Graduação',
  TECNOLOGO: 'Tecnólogo',
  ESPECIALIZACAO: 'Especialização',
  MESTRADO: 'Mestrado',
  'RESIDENCIA AGRARIA': 'Residência Agrária',
  'TECNICO (RESIDENCIA AGRARIA - 2014)': 'Técnico (Residência Agrária 2014)',
  'EXTENSAO (RESIDENCIA AGRARIA JOVEM - 2014)': 'Extensão (Residência Agrária Jovem 2014)',
  'ESPECIALIZACAO (RESIDENCIA AGRARIA - 2012)': 'Especialização (Residência Agrária 2012)',
});

const normNatureza = domain({
  'PUBLICA FEDERAL': 'Pública Federal',
  'PUBLICA ESTADUAL': 'Pública Estadual',
  'PUBLICA MUNICIPAL': 'Pública Municipal',
  PUBLICA: 'Pública',
  'PRIVADA SEM FINS LUCRATIVOS': 'Privada sem fins lucrativos',
  'PRIVADA COM FINS LUCRATIVOS': 'Privada com fins lucrativos',
  'MOVIMENTO SOCIAL': 'Movimento Social',
  'MOVIMENTOS SOCIAIS DO CAMPO': 'Movimento Social',
  'MOVIMENTO POPULAR RURAL': 'Movimento Social',
  MOVIMENTO: 'Movimento Social',
  'ORGANIZACAO CIVIL': 'Organização Civil',
  'ORGANIZACAO NAO GOVERNAMENTAL': 'Organização Não Governamental',
  SINDICATO: 'Sindicato',
  SINCIDATO: 'Sindicato',
  COOPERATIVA: 'Cooperativa',
  ASSOCIACAO: 'Associação',
  IGREJA: 'Igreja',
  FUNDACAO: 'Fundação',
});

const normAbrangencia = domain({
  INTERNACIONAL: 'Internacional', NACIONAL: 'Nacional', REGIONAL: 'Regional',
  ESTADUAL: 'Estadual', MUNICIPAL: 'Municipal', LOCAL: 'Local',
});

const normTitulacao = domain({
  GRADUACAO: 'Graduação', ESPECIALIZACAO: 'Especialização',
  MESTRADO: 'Mestrado', DOUTORADO: 'Doutorado', 'POS-DOUTORADO': 'Pós-doutorado',
}, { fallback: () => null });

const normInstrumento = domain({
  CONVENIO: 'Convênio',
  'TERMO DE COOPERACAO': 'Termo de Cooperação',
  'TERMO DE EXECUCAO DESCENTRALIZADA (TED)': 'Termo de Execução Descentralizada (TED)',
  FOMENTO: 'Fomento',
});

/** Campo multivalorado ("A; B; C") -> array normalizado, sem vazios nem repetidos. */
function multi(raw, normalize = titleCase) {
  const s = clean(raw);
  if (s == null) return [];
  const out = [];
  for (const part of s.split(/\s*[;/]\s*/)) {
    const v = normalize(part);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Lista de nomes separados por ";" (nao normaliza para dominio, so Title Case). */
function multiNomes(raw) {
  const s = clean(raw);
  if (s == null) return [];
  const out = [];
  for (const part of s.split(';')) {
    const v = titleCase(part);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Titulacoes vem as vezes como "DOUTORADO; MESTRADO" — pega a primeira valida. */
function primeiraTitulacao(raw) {
  const s = clean(raw);
  if (s == null) return null;
  for (const part of s.split(';')) {
    const t = normTitulacao(part);
    if (t) return t;
  }
  return null;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** "MM/AAAA", "DD/MM/AAAA", ISO ou serial do Excel -> { texto, ano, mes }. */
function periodo(raw) {
  const s = clean(raw);
  if (s == null) return { texto: null, ano: null, mes: null };

  let m = /^(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return { texto: `${m[1].padStart(2, '0')}/${m[2]}`, ano: +m[2], mes: +m[1] };

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return { texto: `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`, ano: +m[3], mes: +m[2] };

  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return { texto: `${m[3]}/${m[2]}/${m[1]}`, ano: +m[1], mes: +m[2] };

  // Serial do Excel (ex. 40680.0 = 22/05/2011).
  const n = num(s);
  if (n != null && n > 20000 && n < 60000) {
    const d = new Date(EXCEL_EPOCH + Math.round(n) * 86400000);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return { texto: `${dd}/${mm}/${d.getUTCFullYear()}`, ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
  }

  m = /(\d{4})/.exec(s);
  return { texto: s, ano: m ? +m[1] : null, mes: null };
}

/** Ano plausivel para o PNERA (rejeita ruido de digitacao). */
function ano(raw) {
  const n = int(raw);
  return n != null && n >= 1990 && n <= 2035 ? n : null;
}

/* ------------------------------------------------------- transformacao ---- */

function buildCurso(cells, index) {
  const inicio = periodo(cells.V);
  const fim = periodo(cells.X);
  const previstoInicio = periodo(cells.S);
  const previstoFim = periodo(cells.T);
  const vigenciaInicio = periodo(cells.Q);
  const vigenciaFim = periodo(cells.R);

  const anoInicio = ano(cells.W) ?? inicio.ano ?? previstoInicio.ano;
  const anoFim = ano(cells.Y) ?? fim.ano ?? previstoFim.ano;

  const uf = normUf(cells.K);
  const ufSigla = uf ? UF_SIGLAS[uf] ?? null : null;
  // Macrorregiao da planilha, com a UF como fonte de verdade quando divergir.
  const macrorregiao = (ufSigla && UF_REGIAO[ufSigla]) || normRegiao(cells.J);

  const iesUf = normUf(cells.AP);
  const iesSigla = iesUf ? UF_SIGLAS[iesUf] ?? null : null;
  const iesRegiao = (iesSigla && UF_REGIAO[iesSigla]) || normRegiao(cells.AO);

  const coordenadores = [
    ['Coordenação do projeto', cells.AF, cells.AG],
    ['Coordenação geral', cells.AH, cells.AI],
    ['Vice-coordenação', cells.AJ, cells.AK],
    ['Coordenação pedagógica', cells.AL, cells.AM],
  ]
    .map(([papel, nome, titulacao]) => ({ papel, nome: titleCase(nome), titulacao: primeiraTitulacao(titulacao) }))
    .filter((c) => c.nome || c.titulacao);

  const matriculados = int(cells.AC);
  const concluintes = int(cells.AD);

  const parceiraRegiaoUf = normUf(cells.AZ);

  return {
    id: index + 1,
    fase: clean(cells.B),
    codigoSei: codigoSei(cells.C),
    nomeProcessual: titleCase(cells.D),
    curso: titleCase(cells.E),

    areaTematica: normAreaTematica(cells.F),
    areaConhecimento: normAreaConhecimento(cells.G),
    nivel: normNivel(cells.H),
    modalidade: normModalidade(cells.I),

    macrorregiao,
    uf,
    ufSigla,
    municipio: titleCase(cells.L),
    codMunicipio: ibge(cells.M),
    superintendencia: titleCase(cells.N),

    instrumento: normInstrumento(cells.O),
    numeroInstrumento: clean(cells.P),
    vigenciaInicio: vigenciaInicio.texto,
    vigenciaFim: vigenciaFim.texto,
    nup: clean(cells.U),

    previstoInicio: previstoInicio.texto,
    previstoFim: previstoFim.texto,
    inicio: inicio.texto,
    fim: fim.texto,
    anoInicio: anoInicio ?? null,
    mesInicio: inicio.mes ?? null,
    anoFim: anoFim ?? null,
    mesFim: fim.mes ?? null,
    duracaoAnos: anoInicio && anoFim && anoFim >= anoInicio ? anoFim - anoInicio : null,

    turmas: int(cells.Z),
    metaInicial: int(cells.AA),
    metaFinal: int(cells.AB),
    matriculados,
    concluintes,
    bolsistas: int(cells.AE),
    taxaConclusao: matriculados && concluintes != null && matriculados > 0
      ? Math.round((concluintes / matriculados) * 1000) / 10
      : null,

    coordenadores,

    ies: {
      nome: titleCase(cells.AN),
      macrorregiao: iesRegiao,
      uf: iesUf,
      ufSigla: iesSigla,
      municipio: titleCase(cells.AQ),
      codMunicipio: ibge(cells.AR),
      natureza: multi(cells.AS, normNatureza),
    },

    demandante: {
      nome: titleCase(cells.AT),
      nomes: multiNomes(cells.AT),
      natureza: multi(cells.AU, normNatureza),
      abrangencia: multi(cells.AV, normAbrangencia),
    },

    parceiras: {
      nomes: multiNomes(cells.AW),
      natureza: multi(cells.AX, normNatureza),
      macrorregiao: (parceiraRegiaoUf && UF_REGIAO[UF_SIGLAS[parceiraRegiaoUf]]) || normRegiao(cells.AY),
      uf: parceiraRegiaoUf,
      abrangencia: multi(cells.BA, normAbrangencia),
      atuacao: multiNomes(cells.BB),
    },
  };
}

/* -------------------------------------------------------------- metadados -- */

const DIMENSOES = {
  fase: (c) => [c.fase],
  areaTematica: (c) => [c.areaTematica],
  areaConhecimento: (c) => [c.areaConhecimento],
  nivel: (c) => [c.nivel],
  modalidade: (c) => [c.modalidade],
  macrorregiao: (c) => [c.macrorregiao],
  uf: (c) => [c.uf],
  municipio: (c) => [c.municipio],
  superintendencia: (c) => [c.superintendencia],
  instrumento: (c) => [c.instrumento],
  ies: (c) => [c.ies.nome],
  iesNatureza: (c) => c.ies.natureza,
  demandanteNatureza: (c) => c.demandante.natureza,
  demandanteAbrangencia: (c) => c.demandante.abrangencia,
  parceiraNatureza: (c) => c.parceiras.natureza,
  titulacaoCoordenacao: (c) => c.coordenadores.map((x) => x.titulacao),
};

const MEDIDAS = ['turmas', 'metaInicial', 'metaFinal', 'matriculados', 'concluintes', 'bolsistas'];

const ORDEM_NIVEL = ['EJA Fundamental', 'Fundamental', 'Médio', 'Superior', 'Residência Agrária', 'Capacitação'];

function buildMeta(cursos, sourceFile) {
  const valores = {};
  for (const [nome, get] of Object.entries(DIMENSOES)) {
    const set = new Set();
    for (const c of cursos) for (const v of get(c)) if (v) set.add(v);
    let lista = [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (nome === 'nivel') {
      lista = lista.sort((a, b) => {
        const ia = ORDEM_NIVEL.indexOf(a); const ib = ORDEM_NIVEL.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    }
    valores[nome] = lista;
  }

  const cobertura = {};
  const registrar = (campo, preenchidos) => { cobertura[campo] = { preenchidos, total: cursos.length }; };
  for (const m of MEDIDAS) registrar(m, cursos.filter((c) => c[m] != null).length);
  for (const campo of ['curso', 'anoInicio', 'anoFim', 'instrumento', 'municipio', 'duracaoAnos']) {
    registrar(campo, cursos.filter((c) => c[campo] != null).length);
  }
  registrar('demandante', cursos.filter((c) => c.demandante.nome).length);
  registrar('parceiras', cursos.filter((c) => c.parceiras.nomes.length).length);

  const totais = { cursos: cursos.length };
  for (const m of MEDIDAS) totais[m] = cursos.reduce((s, c) => s + (c[m] ?? 0), 0);
  totais.taxaConclusaoGlobal = totais.matriculados
    ? Math.round((totais.concluintes / totais.matriculados) * 1000) / 10
    : null;
  totais.ufs = valores.uf.length;
  totais.municipios = valores.municipio.length;
  totais.instituicoes = valores.ies.length;

  const anos = cursos.map((c) => c.anoInicio).filter(Boolean);
  const anosFim = cursos.map((c) => c.anoFim).filter(Boolean);

  return {
    fonte: path.basename(sourceFile),
    aba: SHEET_NAME,
    geradoEm: new Date().toISOString(),
    totalCursos: cursos.length,
    periodo: {
      anoMin: Math.min(...anos),
      anoMax: Math.max(...anos, ...anosFim),
      anoInicioMax: Math.max(...anos),
    },
    ufSiglas: UF_SIGLAS,
    ufRegiao: UF_REGIAO,
    valores,
    cobertura,
    totais,
  };
}

/* ------------------------------------------------------------------ main --- */

function findSourceFile() {
  const explicit = process.argv[2];
  if (explicit) return path.resolve(ROOT, explicit);
  const candidates = fs.readdirSync(ROOT).filter((f) => /^OFICIAL PNERA.*\.xlsx$/i.test(f));
  if (!candidates.length) throw new Error('Planilha "OFICIAL PNERA*.xlsx" nao encontrada na raiz do projeto');
  return path.join(ROOT, candidates.sort().pop());
}

function main() {
  const sourceFile = findSourceFile();
  console.log(`Lendo ${path.basename(sourceFile)}`);

  const files = readZip(sourceFile, (n) => n === 'xl/workbook.xml' || n === 'xl/sharedStrings.xml'
    || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));

  const workbook = files['xl/workbook.xml'].toString('utf8');
  const rels = files['xl/_rels/workbook.xml.rels'].toString('utf8');

  // name -> r:id -> Target, para achar a aba certa independentemente do sheetId.
  const sheetTag = new RegExp(`<sheet[^>]*name="${SHEET_NAME}"[^>]*>`).exec(workbook);
  if (!sheetTag) throw new Error(`Aba "${SHEET_NAME}" nao encontrada`);
  const rid = /r:id="([^"]+)"/.exec(sheetTag[0])[1];
  const relTag = new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*>`).exec(rels);
  const target = /Target="([^"]+)"/.exec(relTag[0])[1].replace(/^\/?xl\//, '').replace(/^\//, '');
  const sheetPath = `xl/${target}`;
  if (!files[sheetPath]) throw new Error(`Worksheet ${sheetPath} nao encontrada no pacote`);

  const sharedStrings = parseSharedStrings(files['xl/sharedStrings.xml']?.toString('utf8'));
  const rows = parseSheet(files[sheetPath].toString('utf8'), sharedStrings);
  collectAcronyms(rows);

  const header = rows.get(HEADER_ROW);
  if (!header || key(header.D) !== 'NOME PROCESSUAL DO CURSO') {
    throw new Error(`Cabecalho inesperado na linha ${HEADER_ROW}: ${JSON.stringify(header)}`);
  }

  const maxRow = Math.max(...rows.keys());
  const cursos = [];
  for (let r = HEADER_ROW + 1; r <= maxRow; r++) {
    const cells = rows.get(r);
    // Linha valida = tem nome processual do curso (coluna D).
    if (!cells || !clean(cells.D)) continue;
    cursos.push(buildCurso(cells, cursos.length));
  }

  const meta = buildMeta(cursos, sourceFile);

  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'assets', 'js'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'pnera.json'), JSON.stringify(cursos, null, 1));
  fs.writeFileSync(path.join(ROOT, 'data', 'pnera.meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(
    path.join(ROOT, 'assets', 'js', 'dataset.js'),
    `/* Gerado por tools/xlsx-to-json.mjs — nao editar a mao. */\n`
    + `window.PNERA_META = ${JSON.stringify(meta)};\n`
    + `window.PNERA_DATA = ${JSON.stringify(cursos)};\n`,
  );

  report(cursos, meta);
}

const fmt = (n) => n.toLocaleString('pt-BR');

function report(cursos, meta) {
  const { totais, cobertura } = meta;
  // Valores de referencia conferidos contra a aba "CURSOS GERAL" (linhas 4-584).
  console.log('\n== Sanidade =====================================');
  console.log(`cursos ............... ${fmt(totais.cursos)}   (esperado 581)`);
  console.log(`matriculados ......... ${fmt(totais.matriculados)}   (esperado 186.024)`);
  console.log(`concluintes .......... ${fmt(totais.concluintes)}   (esperado 96.136)`);
  console.log(`turmas ............... ${fmt(totais.turmas)}   (esperado 9.125)`);
  console.log(`bolsistas ............ ${fmt(totais.bolsistas)}   (esperado 5.718)`);
  console.log(`UFs .................. ${totais.ufs}   (esperado 27)`);
  console.log(`municipios ........... ${totais.municipios}`);
  console.log(`instituicoes ......... ${totais.instituicoes}`);
  console.log(`periodo .............. ${meta.periodo.anoMin}–${meta.periodo.anoMax}`);
  console.log(`taxa de conclusao .... ${totais.taxaConclusaoGlobal}%`);

  console.log('\n-- cobertura (preenchidos / total) --------------');
  for (const [campo, c] of Object.entries(cobertura)) {
    const pct = ((c.preenchidos / c.total) * 100).toFixed(0);
    console.log(`  ${campo.padEnd(16)} ${String(c.preenchidos).padStart(4)}/${c.total}  ${pct}%`);
  }

  console.log('\n-- area tematica -------------------------------');
  const porArea = new Map();
  for (const c of cursos) {
    const k = c.areaTematica ?? '(sem area)';
    const acc = porArea.get(k) ?? { n: 0, alunos: 0 };
    acc.n++; acc.alunos += c.matriculados ?? 0;
    porArea.set(k, acc);
  }
  for (const [k, v] of [...porArea].sort((a, b) => b[1].alunos - a[1].alunos)) {
    console.log(`  ${k.padEnd(32)} ${String(v.n).padStart(3)} cursos  ${fmt(v.alunos).padStart(8)} alunos`);
  }

  console.log('\n-- dimensoes normalizadas ----------------------');
  for (const dim of ['fase', 'macrorregiao', 'nivel', 'modalidade', 'areaConhecimento', 'iesNatureza']) {
    console.log(`  ${dim.padEnd(18)} ${meta.valores[dim].length} valores: ${meta.valores[dim].slice(0, 6).join(' | ')}${meta.valores[dim].length > 6 ? ' …' : ''}`);
  }

  const sujeira = cursos.filter((c) => JSON.stringify(c).toUpperCase().includes('NAO LOCALIZADO'));
  console.log(`\nresiduos "NAO LOCALIZADO": ${sujeira.length}${sujeira.length ? ' (INVESTIGAR)' : ' ✓'}`);
  const regiaoInvalida = cursos.filter((c) => c.macrorregiao && !REGIOES_VALIDAS.has(c.macrorregiao));
  console.log(`macrorregioes invalidas: ${regiaoInvalida.length}${regiaoInvalida.length ? ' (INVESTIGAR)' : ' ✓'}`);
  console.log('\nGerado: data/pnera.json, data/pnera.meta.json, assets/js/dataset.js');
}

main();
