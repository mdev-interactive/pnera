/**
 * Gera assets/js/uf-paths.js: geometria das 27 UFs como paths SVG prontos,
 * para o mapa coropletico funcionar offline, sem GeoJSON nem biblioteca de mapa.
 *
 * Fonte: malha territorial do IBGE (qualidade minima), projecao Mercator.
 * Roda uma unica vez; o dashboard so consome o arquivo gerado.
 *
 * Uso: node tools/build-uf-map.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'data', 'ibge-uf.geojson');
const IBGE_URL = 'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR'
  + '?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF';

const WIDTH = 1000;
const PAD = 8;
const PRECISION = 1;
/** Faixa livre a direita do desenho, onde ficam as etiquetas das UFs pequenas. */
const GUTTER = 96;

const COD_UF = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL',
  28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
  41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

/**
 * UFs pequenas demais para caber a sigla dentro do proprio desenho. A etiqueta
 * vai para a faixa livre a direita, alinhada na latitude do estado e ligada por
 * uma linha guia. Sao justamente os estados da costa leste, que se amontoam.
 */
const GUTTER_LABELS = ['RN', 'PB', 'PE', 'AL', 'SE', 'ES', 'RJ'];
/** Espaco vertical minimo entre duas etiquetas da faixa, em unidades do viewBox. */
const GUTTER_SPACING = 30;
/** Casos isolados que cabem perto do estado, com um empurrao manual. */
const MANUAL_OFFSET = { DF: [34, -20] };

async function loadGeoJson() {
  if (fs.existsSync(CACHE)) {
    console.log(`Usando malha em cache: ${path.relative(ROOT, CACHE)}`);
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  }
  console.log('Baixando malha das UFs no IBGE…');
  const res = await fetch(IBGE_URL);
  if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, text);
  return JSON.parse(text);
}

/**
 * Mercator esferico. As duas coordenadas saem em radianos — misturar grau em x
 * com radiano em y achata o mapa. y e invertido depois, na conversao para tela.
 */
const mercatorX = (lon) => (lon * Math.PI) / 180;
const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** Extrai os aneis externos de Polygon ou MultiPolygon. */
function ringsOf(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  throw new Error(`Geometria nao suportada: ${geometry.type}`);
}

/** Area e centroide de um anel pela formula do poligono (shoelace). */
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

async function main() {
  const geo = await loadGeoJson();

  // Projeta tudo primeiro para descobrir os limites reais do Brasil.
  const projected = geo.features.map((f) => {
    const sigla = COD_UF[Number(f.properties.codarea)];
    if (!sigla) throw new Error(`Codigo de UF desconhecido: ${f.properties.codarea}`);
    const rings = ringsOf(f.geometry).map((ring) => ring.map(([lon, lat]) => [mercatorX(lon), mercatorY(lat)]));
    return { sigla, rings };
  });

  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const { rings } of projected) {
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const scale = (WIDTH - PAD * 2) / (maxX - minX);
  const height = Math.round((maxY - minY) * scale + PAD * 2);
  const toScreen = ([x, y]) => [
    (x - minX) * scale + PAD,
    (maxY - y) * scale + PAD, // y cresce para baixo na tela
  ];
  const round = (n) => Number(n.toFixed(PRECISION));

  const paths = {};
  const labels = {};

  for (const { sigla, rings } of projected) {
    const screenRings = rings.map((ring) => ring.map(toScreen));

    // Um "M x y L …" por anel, fechado com Z. Pontos repetidos sao descartados.
    paths[sigla] = screenRings.map((ring) => {
      const pts = [];
      for (const [x, y] of ring) {
        const p = `${round(x)},${round(y)}`;
        if (p !== pts[pts.length - 1]) pts.push(p);
      }
      return `M${pts.join('L')}Z`;
    }).join('');

    const biggest = screenRings
      .map((ring) => ({ ring, ...ringMetrics(ring) }))
      .sort((a, b) => b.area - a.area)[0];

    const anchor = [round(biggest.cx), round(biggest.cy)];
    const offset = MANUAL_OFFSET[sigla];
    labels[sigla] = offset
      ? { x: round(anchor[0] + offset[0]), y: round(anchor[1] + offset[1]), from: anchor, outside: true }
      : { x: anchor[0], y: anchor[1], outside: false };
  }

  // Etiquetas da faixa: mesma coluna, ordenadas por latitude e sem sobreposicao.
  const gutterX = WIDTH + 12;
  let ultimoY = -Infinity;
  for (const sigla of GUTTER_LABELS.map((s) => ({ s, y: labels[s].y })).sort((a, b) => a.y - b.y).map((o) => o.s)) {
    const anchor = [labels[sigla].x, labels[sigla].y];
    const y = Math.max(labels[sigla].y, ultimoY + GUTTER_SPACING);
    ultimoY = y;
    labels[sigla] = { x: gutterX, y: round(y), from: anchor, outside: true };
  }

  // Parametros da projecao, para o painel colocar um par lat/lon no mesmo
  // referencial dos paths (circulos por municipio sobre o coropleto). Sao
  // radianos: precisao alta, senao o ponto escorrega dezenas de quilometros.
  const projection = {
    minX: Number(minX.toFixed(8)),
    maxY: Number(maxY.toFixed(8)),
    scale: Number(scale.toFixed(6)),
    pad: PAD,
  };

  const out = `/* Gerado por tools/build-uf-map.mjs a partir da malha do IBGE — nao editar a mao. */\n`
    + `window.UF_MAP = ${JSON.stringify({
      viewBox: `0 0 ${WIDTH + GUTTER} ${height}`, mapWidth: WIDTH, projection, paths, labels,
    })};\n`;

  fs.mkdirSync(path.join(ROOT, 'assets', 'js'), { recursive: true });
  const target = path.join(ROOT, 'assets', 'js', 'uf-paths.js');
  fs.writeFileSync(target, out);

  const sizeKb = (fs.statSync(target).size / 1024).toFixed(0);
  console.log(`\n${Object.keys(paths).length} UFs · viewBox 0 0 ${WIDTH} ${height} · ${sizeKb} KB`);
  console.log(`Gerado: ${path.relative(ROOT, target)}`);
  const faltando = Object.values(COD_UF).filter((s) => !paths[s]);
  if (faltando.length) throw new Error(`UFs ausentes: ${faltando.join(', ')}`);
}

main().catch((err) => {
  console.error(`\nFalhou: ${err.message}`);
  process.exit(1);
});
