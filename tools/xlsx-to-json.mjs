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

/**
 * Codigo IBGE reconciliado com a UF da linha. A planilha tem codigo trocado
 * (Marabá/PA com 1200401, que e Rio Branco/AC), e o codigo errado poe o
 * circulo do mapa em outro estado — a UF e o nome do municipio sao a fonte de
 * verdade, o codigo e so o atalho. Quando o prefixo do codigo diverge da UF, o
 * municipio e reprocurado pelo nome dentro da UF certa; nao achando, o codigo
 * cai para null (o curso continua na base, apenas sem ponto no mapa).
 */
const municipiosPorUf = new Map();

/**
 * Chave de municipio: alem do que `key` faz, apaga hifen e apostrofo, que a
 * planilha escreve solto ("CEARA MIRIM" para "Ceará-Mirim").
 */
const keyMunicipio = (nome) => key(nome).replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();

function nomesDaUf(sigla) {
  const prefixo = UF_IBGE[sigla];
  if (!prefixo) return null;
  if (!municipiosPorUf.has(prefixo)) {
    const arquivo = path.join(ROOT, 'data', 'ibge-municipios', `${prefixo}-nomes.json`);
    let mapa = null;
    if (fs.existsSync(arquivo)) {
      mapa = new Map();
      for (const m of JSON.parse(fs.readFileSync(arquivo, 'utf8'))) mapa.set(keyMunicipio(m.nome), String(m.id));
    }
    municipiosPorUf.set(prefixo, mapa);
  }
  return municipiosPorUf.get(prefixo);
}

const codigosCorrigidos = [];

function codigoMunicipio(raw, nome, ufSigla) {
  const cod = ibge(raw);
  if (!cod || !ufSigla || !UF_IBGE[ufSigla]) return cod;
  if (cod.slice(0, 2) === UF_IBGE[ufSigla]) return cod;

  const porNome = nomesDaUf(ufSigla);
  const achado = nome && porNome ? porNome.get(keyMunicipio(nome)) ?? null : null;
  codigosCorrigidos.push({ nome: clean(nome), ufSigla, de: cod, para: achado });
  return achado;
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

/** Prefixo IBGE (dois primeiros digitos do codigo de municipio) por sigla. */
const UF_IBGE = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27',
  SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35',
  PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
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
  'CIENCIAS SOCIAIS': 'Ciências Sociais',
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

const normSituacao = domain({
  CONCLUIDO: 'Concluído',
  CONCLUIDA: 'Concluído',
  'EM ANDAMENTO': 'Em andamento',
  ANDAMENTO: 'Em andamento',
}, { fallback: () => null });

/* ------------------------------------------------------------- colunas ---- */

/**
 * Mapa campo -> cabecalho, na ordem em que as colunas aparecem na aba. As letras
 * nao sao fixas de proposito: a planilha de 16/09/2026 inseriu "SITUACAO" em F e
 * empurrou tudo que vinha depois uma casa. Resolver pelo cabecalho faz a proxima
 * insercao ser inofensiva; com letras fixas, ela renomearia silenciosamente
 * metade da base (municipio viraria codigo, coordenador viraria titulacao).
 */
const COLUNAS = [
  ['fase', 'PNERA II / PNERA III'],
  ['codigoSei', 'CODIGO SEI'],
  // O nome do curso vem so daqui. A coluna "CURSO (Ocultar)" logo ao lado
  // esta desativada e e ignorada de proposito.
  ['nomeProcessual', 'NOME PROCESSUAL DO CURSO'],
  ['situacao', 'SITUACAO'],
  ['areaTematica', 'AREA TEMATICA'],
  ['areaConhecimento', 'AREA DO CONHECIMENTO'],
  ['nivel', 'NIVEL DO CURSO'],
  ['modalidade', 'MODALIDADE'],
  ['macrorregiao', 'MACRO-REGIAO'],
  ['uf', 'ESTADO'],
  ['municipio', 'MUNICIPIO'],
  ['codMunicipio', 'COD MUNICIPIO'],
  ['superintendencia', 'SUPER INTENDENCIA'],
  ['instrumento', 'INSTRUMENTO'],
  ['numeroInstrumento', 'NUMERO DO INSTRUMENTO'],
  ['vigenciaInicio', 'VIGENCIA DO INSTRUMENTO (INICIO)'],
  ['vigenciaFim', 'VIGENCIA DO INSTRUMENTO (FIM)'],
  ['previstoInicio', 'MES/ANO PREVISTO PARA INICIO DO CURSO'],
  ['previstoFim', 'MES/ANO PREVISTO PARA FIM DO CURSO'],
  ['nup', 'NUP'],
  ['inicio', 'MES/ANO INICIO DO CURSO'],
  ['anoInicio', 'ANO DE INICIO DO CURSO'],
  ['fim', 'MES/ANO FIM DO CURSO'],
  ['anoFim', 'ANO DE FIM DO CURSO'],
  ['turmas', 'NUMERO DE TURMAS'],
  ['metaInicial', 'NUMERO DE ALUNOS (META INICIAL)'],
  ['metaFinal', 'NUMERO DE ALUNOS (META FINAL)'],
  ['matriculados', 'NUMERO DE ALUNOS INGRESSANTES (MATRICULADOS)'],
  ['concluintes', 'NUMERO DE ALUNOS CONCLUINTES (FORMADOS)'],
  ['bolsistas', 'NUMERO DE BOLSISTAS'],
  ['coordProjeto', 'COORDENADOR DO PROJETO'],
  ['coordProjetoTit', 'TITULACAO DO COORDENADOR DO PROJETO'],
  ['coordGeral', 'COORDENADOR GERAL'],
  ['coordGeralTit', 'TITULACAO DO COORDENADOR GERAL'],
  ['viceCoord', 'VICE COORDENADOR'],
  ['viceCoordTit', 'TITULACAO DO VICE COORDENADOR'],
  ['coordPedagogico', 'COORDENADOR PEDAGOGICO'],
  ['coordPedagogicoTit', 'TITULACAO DO COORDENADOR PEDAGOGICO'],
  ['iesNome', 'INSTITUICAO DE ENSINO REALIZADORA'],
  ['iesMacrorregiao', 'MACRO-REGIAO DA INSTITUICAO REALIZADORA'],
  ['iesUf', 'ESTADO'],
  ['iesMunicipio', 'MUNICIPIO'],
  ['iesCodMunicipio', 'COD MUNICIPIO'],
  ['iesNatureza', 'NATUREZA DA INSTITUICAO REALIZADORA'],
  // Ate 16/09/2026 o demandante vinha numa coluna so; a partir de 23/09/2026 ela
  // foi dividida em tres (movimento isolado, comunidade, articulacao de varios).
  ['demandanteNome', 'NOME DA ORGANIZACAO DEMANDANTE'],
  ['demandanteMovimento', 'MOVIMENTO / INSTITUICAO'],
  ['demandanteComunidade', 'COMUNIDADE'],
  ['demandanteArticulacao', 'ARTICULACAO DE MOVIMENTOS / INSTITUICOES'],
  ['demandanteNatureza', 'NATUREZA DA ORGANIZACAO DEMANDANTE'],
  ['demandanteAbrangencia', 'ABRANGENCIA DA INSTITUICAO DEMANDANTE'],
  ['parceiraNomes', 'NOME DA INSTITUICAO PARCEIRA'],
  ['parceiraNatureza', 'NATUREZA DA INSTITUICAO PARCEIRA'],
  ['parceiraMacrorregiao', 'LOCALIZACAO DA INSTITUICAO PARCEIRA MACRO REGIAO'],
  ['parceiraUf', 'LOCALIZACAO DA INSTITUICAO PARCEIRA ESTADO'],
  ['parceiraAbrangencia', 'ABRANGENCIA DA INSTITUICAO PARCEIRA'],
  ['parceiraAtuacao', 'ATUACAO DA INSTITUICAO PARCEIRA'],
];

/** Colunas obrigatorias: sem elas o dataset sai mudo em vez de sair errado. */
const COLUNAS_OBRIGATORIAS = new Set([
  'fase', 'nomeProcessual', 'areaTematica', 'nivel', 'uf', 'municipio',
  'matriculados', 'iesNome',
]);

/** "A".."Z", "AA".. -> posicao numerica, para ordenar as colunas do cabecalho. */
function colIndex(letra) {
  let n = 0;
  for (const ch of letra) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * Resolve campo -> letra casando os cabecalhos em ordem. Como COLUNAS segue a
 * ordem da planilha, o cursor avanca e "ESTADO"/"MUNICIPIO" duplicados caem
 * naturalmente no par certo (o do curso primeiro, o da IES depois). O casamento
 * aceita prefixo porque a planilha anota titulos ("CURSO (Ocultar)").
 */
function mapearColunas(header) {
  const letras = Object.keys(header).sort((a, b) => colIndex(a) - colIndex(b));
  const titulos = letras.map((l) => key(header[l]));

  const mapa = {};
  const faltando = [];
  let cursor = 0;
  for (const [campo, titulo] of COLUNAS) {
    const alvo = key(titulo);
    let achado = -1;
    for (let i = cursor; i < titulos.length; i++) {
      if (titulos[i] === alvo || titulos[i].startsWith(`${alvo} `) || titulos[i].startsWith(`${alvo}(`)) {
        achado = i;
        break;
      }
    }
    if (achado < 0) { faltando.push(campo); continue; }
    mapa[campo] = letras[achado];
    cursor = achado + 1;
  }

  const criticas = faltando.filter((c) => COLUNAS_OBRIGATORIAS.has(c));
  if (criticas.length) {
    throw new Error(`Colunas obrigatorias nao encontradas no cabecalho: ${criticas.join(', ')}`);
  }
  if (faltando.length) console.log(`aviso: colunas ausentes na planilha: ${faltando.join(', ')}`);
  return mapa;
}

/* ------------------------------------------------------- transformacao ---- */

function buildCurso(cells, index, col) {
  const at = (campo) => (col[campo] ? cells[col[campo]] : undefined);

  const inicio = periodo(at('inicio'));
  const fim = periodo(at('fim'));
  const previstoInicio = periodo(at('previstoInicio'));
  const previstoFim = periodo(at('previstoFim'));
  const vigenciaInicio = periodo(at('vigenciaInicio'));
  const vigenciaFim = periodo(at('vigenciaFim'));

  const anoInicio = ano(at('anoInicio')) ?? inicio.ano ?? previstoInicio.ano;
  const anoFim = ano(at('anoFim')) ?? fim.ano ?? previstoFim.ano;

  const uf = normUf(at('uf'));
  const ufSigla = uf ? UF_SIGLAS[uf] ?? null : null;
  // Macrorregiao da planilha, com a UF como fonte de verdade quando divergir.
  const macrorregiao = (ufSigla && UF_REGIAO[ufSigla]) || normRegiao(at('macrorregiao'));

  const iesUf = normUf(at('iesUf'));
  const iesSigla = iesUf ? UF_SIGLAS[iesUf] ?? null : null;
  const iesRegiao = (iesSigla && UF_REGIAO[iesSigla]) || normRegiao(at('iesMacrorregiao'));

  const coordenadores = [
    ['Coordenação do projeto', at('coordProjeto'), at('coordProjetoTit')],
    ['Coordenação geral', at('coordGeral'), at('coordGeralTit')],
    ['Vice-coordenação', at('viceCoord'), at('viceCoordTit')],
    ['Coordenação pedagógica', at('coordPedagogico'), at('coordPedagogicoTit')],
  ]
    .map(([papel, nome, titulacao]) => ({ papel, nome: titleCase(nome), titulacao: primeiraTitulacao(titulacao) }))
    .filter((c) => c.nome || c.titulacao);

  const matriculados = int(at('matriculados'));
  const concluintes = int(at('concluintes'));

  const parceiraRegiaoUf = normUf(at('parceiraUf'));

  // Planilha antiga: coluna unica. Nova: tres colunas, unidas na mesma lista.
  const demandanteNomes = [];
  const demandanteTipos = [];
  for (const [campo, tipo] of [
    ['demandanteNome', null],
    ['demandanteMovimento', 'Movimento / instituição'],
    ['demandanteComunidade', 'Comunidade'],
    ['demandanteArticulacao', 'Articulação de movimentos'],
  ]) {
    const nomes = multiNomes(at(campo));
    for (const n of nomes) if (!demandanteNomes.includes(n)) demandanteNomes.push(n);
    if (tipo && nomes.length) demandanteTipos.push(tipo);
  }

  return {
    id: index + 1,
    fase: clean(at('fase')),
    codigoSei: codigoSei(at('codigoSei')),
    nomeProcessual: titleCase(at('nomeProcessual')),
    situacao: normSituacao(at('situacao')),

    areaTematica: normAreaTematica(at('areaTematica')),
    areaConhecimento: normAreaConhecimento(at('areaConhecimento')),
    nivel: normNivel(at('nivel')),
    modalidade: normModalidade(at('modalidade')),

    macrorregiao,
    uf,
    ufSigla,
    municipio: titleCase(at('municipio')),
    codMunicipio: codigoMunicipio(at('codMunicipio'), at('municipio'), ufSigla),
    superintendencia: titleCase(at('superintendencia')),

    instrumento: normInstrumento(at('instrumento')),
    numeroInstrumento: clean(at('numeroInstrumento')),
    vigenciaInicio: vigenciaInicio.texto,
    vigenciaFim: vigenciaFim.texto,
    nup: clean(at('nup')),

    previstoInicio: previstoInicio.texto,
    previstoFim: previstoFim.texto,
    inicio: inicio.texto,
    fim: fim.texto,
    anoInicio: anoInicio ?? null,
    mesInicio: inicio.mes ?? null,
    anoFim: anoFim ?? null,
    mesFim: fim.mes ?? null,
    duracaoAnos: anoInicio && anoFim && anoFim >= anoInicio ? anoFim - anoInicio : null,

    turmas: int(at('turmas')),
    metaInicial: int(at('metaInicial')),
    metaFinal: int(at('metaFinal')),
    matriculados,
    concluintes,
    bolsistas: int(at('bolsistas')),
    taxaConclusao: matriculados && concluintes != null && matriculados > 0
      ? Math.round((concluintes / matriculados) * 1000) / 10
      : null,

    coordenadores,

    ies: {
      nome: titleCase(at('iesNome')),
      macrorregiao: iesRegiao,
      uf: iesUf,
      ufSigla: iesSigla,
      municipio: titleCase(at('iesMunicipio')),
      codMunicipio: codigoMunicipio(at('iesCodMunicipio'), at('iesMunicipio'), iesSigla),
      natureza: multi(at('iesNatureza'), normNatureza),
    },

    demandante: {
      nome: demandanteNomes.length ? demandanteNomes.join('; ') : null,
      nomes: demandanteNomes,
      tipo: demandanteTipos,
      natureza: multi(at('demandanteNatureza'), normNatureza),
      abrangencia: multi(at('demandanteAbrangencia'), normAbrangencia),
    },

    parceiras: {
      nomes: multiNomes(at('parceiraNomes')),
      natureza: multi(at('parceiraNatureza'), normNatureza),
      macrorregiao: (parceiraRegiaoUf && UF_REGIAO[UF_SIGLAS[parceiraRegiaoUf]]) || normRegiao(at('parceiraMacrorregiao')),
      uf: parceiraRegiaoUf,
      abrangencia: multi(at('parceiraAbrangencia'), normAbrangencia),
      atuacao: multiNomes(at('parceiraAtuacao')),
    },
  };
}

/* -------------------------------------------------------------- metadados -- */

const DIMENSOES = {
  fase: (c) => [c.fase],
  situacao: (c) => [c.situacao],
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
  for (const campo of ['situacao', 'anoInicio', 'anoFim', 'instrumento', 'municipio', 'duracaoAnos']) {
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

/**
 * Acha a planilha na raiz ou em data/. A ordenacao alfabetica nao serve para
 * escolher a mais recente ("03-09" viria antes de "22-06"), entao a data no
 * nome (DD-MM-AAAA) e lida e comparada de verdade.
 */
function findSourceFile() {
  const explicit = process.argv[2];
  if (explicit) return path.resolve(ROOT, explicit);

  const dirs = [ROOT, path.join(ROOT, 'data')];
  const candidates = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/^OFICIAL PNERA.*\.xlsx$/i.test(f) || f.startsWith('~$')) continue;
      const m = /(\d{2})-(\d{2})-(\d{4})/.exec(f);
      candidates.push({ file: path.join(dir, f), stamp: m ? `${m[3]}${m[2]}${m[1]}` : '' });
    }
  }
  if (!candidates.length) {
    throw new Error('Planilha "OFICIAL PNERA*.xlsx" nao encontrada na raiz do projeto nem em data/');
  }
  candidates.sort((a, b) => a.stamp.localeCompare(b.stamp) || a.file.localeCompare(b.file));
  return candidates.pop().file;
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
  if (!header) throw new Error(`Cabecalho ausente na linha ${HEADER_ROW}`);
  const col = mapearColunas(header);

  const maxRow = Math.max(...rows.keys());
  const cursos = [];
  for (let r = HEADER_ROW + 1; r <= maxRow; r++) {
    const cells = rows.get(r);
    // Linha valida = tem nome processual do curso.
    if (!cells || !clean(cells[col.nomeProcessual])) continue;
    cursos.push(buildCurso(cells, cursos.length, col));
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
  // Valores de referencia conferidos contra a aba "CURSOS GERAL" (linhas 4-588)
  // da planilha OFICIAL PNERA_16-09-2026.xlsx. Ante a de 03-09 mudou so uma
  // celula: a linha 472 moveu 1.394 de "meta final" para "matriculados".
  console.log('\n== Sanidade =====================================');
  console.log(`cursos ............... ${fmt(totais.cursos)}   (esperado 587)`);
  console.log(`matriculados ......... ${fmt(totais.matriculados)}   (esperado 203.229)`);
  console.log(`concluintes .......... ${fmt(totais.concluintes)}   (esperado 96.194)`);
  console.log(`turmas ............... ${fmt(totais.turmas)}   (esperado 9.142)`);
  console.log(`bolsistas ............ ${fmt(totais.bolsistas)}   (esperado 5.718)`);
  console.log(`UFs .................. ${totais.ufs}   (esperado 27)`);
  console.log(`municipios ........... ${totais.municipios}`);
  console.log(`instituicoes ......... ${totais.instituicoes}`);
  console.log(`periodo .............. ${meta.periodo.anoMin}–${meta.periodo.anoMax}`);
  console.log(`taxa de conclusao .... ${totais.taxaConclusaoGlobal}%`);
  const semSituacao = cursos.filter((c) => !c.situacao).length;
  const porSituacao = new Map();
  for (const c of cursos) porSituacao.set(c.situacao ?? '(sem situacao)', (porSituacao.get(c.situacao ?? '(sem situacao)') ?? 0) + 1);
  console.log(`situacao ............. ${[...porSituacao].map(([k, v]) => `${k}: ${fmt(v)}`).join(' · ')}`
    + `${semSituacao ? '  (INVESTIGAR)' : ' ✓'}`);

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
  for (const dim of ['fase', 'situacao', 'macrorregiao', 'nivel', 'modalidade', 'areaConhecimento', 'iesNatureza']) {
    console.log(`  ${dim.padEnd(18)} ${meta.valores[dim].length} valores: ${meta.valores[dim].slice(0, 6).join(' | ')}${meta.valores[dim].length > 6 ? ' …' : ''}`);
  }

  const sujeira = cursos.filter((c) => JSON.stringify(c).toUpperCase().includes('NAO LOCALIZADO'));
  console.log(`\nresiduos "NAO LOCALIZADO": ${sujeira.length}${sujeira.length ? ' (INVESTIGAR)' : ' ✓'}`);
  const regiaoInvalida = cursos.filter((c) => c.macrorregiao && !REGIOES_VALIDAS.has(c.macrorregiao));
  console.log(`macrorregioes invalidas: ${regiaoInvalida.length}${regiaoInvalida.length ? ' (INVESTIGAR)' : ' ✓'}`);
  console.log(`codigos IBGE fora da UF: ${codigosCorrigidos.length}${codigosCorrigidos.length ? '' : ' ✓'}`);
  for (const c of codigosCorrigidos) {
    console.log(`  ${c.nome ?? '—'} (${c.ufSigla}): ${c.de} -> ${c.para ?? 'null (nome não encontrado na UF)'}`);
  }
  console.log('\nGerado: data/pnera.json, data/pnera.meta.json, assets/js/dataset.js');
}

main();
