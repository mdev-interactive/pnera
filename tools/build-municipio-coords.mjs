/**
 * Gera assets/js/municipio-coords.js: centroide (lat/lon) e nome acentuado de
 * cada municipio que aparece em data/pnera.json, para o mapa interativo de
 * circulos proporcionais plotar ponto a ponto.
 *
 * A planilha traz o codigo IBGE de 7 digitos, mas nenhuma coordenada. Aqui a
 * coordenada vem da malha territorial do IBGE (qualidade minima), uma
 * requisicao por UF com intrarregiao=municipio — 27 chamadas em vez de 246.
 * O nome acentuado vem da API de localidades: na planilha os toponimos estao
 * sem acento, e o mapa mostra o nome correto.
 *
 * Roda uma unica vez; a pagina so consome o arquivo gerado.
 *
 * Uso: node tools/build-municipio-coords.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DADOS = path.join(ROOT, 'data', 'pnera.json');
const CACHE_DIR = path.join(ROOT, 'data', 'ibge-municipios');
const ALVO = path.join(ROOT, 'assets', 'js', 'municipio-coords.js');

const PRECISION = 4;

/** Bounding box do Brasil, com folga. Coordenada fora disso e erro de conversao. */
const BBOX = { latMin: -34.5, latMax: 6.0, lonMin: -74.5, lonMax: -33.5 };

const COD_UF = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL',
  28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
  41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

const malhaUrl = (codUf) => 'https://servicodados.ibge.gov.br/api/v3/malhas/estados/'
  + `${codUf}?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio`;

const nomesUrl = (codUf) => 'https://servicodados.ibge.gov.br/api/v1/localidades/'
  + `estados/${codUf}/municipios`;

/** Baixa e cacheia em disco. O cache existe so para reexecutar o script sem rede. */
async function baixar(url, cache) {
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IBGE respondeu ${res.status} em ${url}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, text);
  return JSON.parse(text);
}

/** Extrai os aneis de Polygon ou MultiPolygon. */
function ringsOf(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  throw new Error(`Geometria nao suportada: ${geometry.type}`);
}

/**
 * Area e centroide de um anel pela formula do poligono (shoelace).
 * Mesma funcao de tools/build-uf-map.mjs — aqui sobre lon/lat cru, sem projetar,
 * porque o Leaflet quer graus. A distorcao do centroide em graus e irrelevante
 * na escala de um municipio.
 */
function ringMetrics(ring) {
  let area = 0; let cx = 0; let cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  area /= 2;
  if (!area) return { area: 0, cx: ring[0][0], cy: ring[0][1] };
  return { area: Math.abs(area), cx: cx / (6 * area), cy: cy / (6 * area) };
}

/** Centroide do maior anel — o mesmo criterio usado para ancorar as siglas das UFs. */
function centroide(geometry) {
  const maior = ringsOf(geometry)
    .map((ring) => ringMetrics(ring))
    .sort((a, b) => b.area - a.area)[0];
  return { lon: maior.cx, lat: maior.cy };
}

async function main() {
  const cursos = JSON.parse(fs.readFileSync(DADOS, 'utf8'));

  // Codigos pedidos: municipio do curso. O da IES fica de fora — o mapa plota
  // onde o curso aconteceu, nao onde fica a universidade.
  const pedidos = new Set();
  for (const c of cursos) if (c.codMunicipio) pedidos.add(String(c.codMunicipio));
  console.log(`${pedidos.size} municipios distintos em ${path.relative(ROOT, DADOS)}`);

  // So as UFs que realmente aparecem no recorte.
  const ufsNecessarias = [...new Set([...pedidos].map((cod) => Number(cod.slice(0, 2))))]
    .sort((a, b) => a - b);

  const resolvidos = {};
  const round = (n) => Number(n.toFixed(PRECISION));

  for (const codUf of ufsNecessarias) {
    const sigla = COD_UF[codUf];
    if (!sigla) throw new Error(`Codigo de UF desconhecido: ${codUf}`);

    const malha = await baixar(malhaUrl(codUf), path.join(CACHE_DIR, `${codUf}.geojson`));
    const nomes = await baixar(nomesUrl(codUf), path.join(CACHE_DIR, `${codUf}-nomes.json`));
    const porCodigo = new Map(nomes.map((m) => [String(m.id), m.nome]));

    let achados = 0;
    for (const f of malha.features) {
      const cod = String(f.properties.codarea);
      if (!pedidos.has(cod)) continue;
      const { lat, lon } = centroide(f.geometry);
      resolvidos[cod] = {
        lat: round(lat),
        lon: round(lon),
        nome: porCodigo.get(cod) || null,
        uf: sigla,
      };
      achados++;
    }
    console.log(`  ${sigla} · ${achados} municipios`);
  }

  // --- Sanidade: sem isso o mapa plota circulo no lugar errado em silencio. ---
  const faltando = [...pedidos].filter((cod) => !resolvidos[cod]);
  if (faltando.length) {
    throw new Error(`${faltando.length} municipios sem coordenada: ${faltando.join(', ')}`);
  }

  const semNome = Object.entries(resolvidos).filter(([, m]) => !m.nome).map(([cod]) => cod);
  if (semNome.length) {
    throw new Error(`${semNome.length} municipios sem nome no IBGE: ${semNome.join(', ')}`);
  }

  const foraDoBrasil = Object.entries(resolvidos).filter(([, m]) => (
    m.lat < BBOX.latMin || m.lat > BBOX.latMax || m.lon < BBOX.lonMin || m.lon > BBOX.lonMax
  ));
  if (foraDoBrasil.length) {
    throw new Error(`Coordenadas fora do Brasil: ${foraDoBrasil.map(([c]) => c).join(', ')}`);
  }

  // Chaves em ordem, para o diff do arquivo gerado ser legivel entre execucoes.
  const ordenado = {};
  for (const cod of Object.keys(resolvidos).sort()) ordenado[cod] = resolvidos[cod];

  const out = '/* Gerado por tools/build-municipio-coords.mjs a partir da malha do IBGE — nao editar a mao. */\n'
    + `window.MUNICIPIO_COORDS = ${JSON.stringify(ordenado)};\n`;

  fs.mkdirSync(path.dirname(ALVO), { recursive: true });
  fs.writeFileSync(ALVO, out);

  const sizeKb = (fs.statSync(ALVO).size / 1024).toFixed(0);
  console.log(`\n${Object.keys(ordenado).length} de ${pedidos.size} municipios resolvidos · 0 faltando · ${sizeKb} KB`);
  console.log(`Gerado: ${path.relative(ROOT, ALVO)}`);
}

main().catch((err) => {
  console.error(`\nFalhou: ${err.message}`);
  process.exit(1);
});
