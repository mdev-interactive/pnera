# Painel PNERA — Educação na Reforma Agrária

Painel analítico dos dados da **Pesquisa Nacional de Educação na Reforma Agrária**
(PNERA II e III — INCRA / Universidade de Brasília) sobre os cursos do **Pronera**.

Converte a planilha `OFICIAL PNERA_22-06-2026.xlsx` em JSON limpo e serve um
dashboard estático com filtros cruzados. **Não precisa de servidor, build nem
internet** — basta abrir `index.html`.

---

## Como usar

Abra `index.html` no navegador (duplo clique já funciona).

Há uma segunda página, `maps-interativo.html` — o mapa de círculos proporcionais
por município. **Ela é a única que precisa de internet** (ver abaixo).

Para regerar os dados depois de atualizar a planilha:

```bash
node tools/xlsx-to-json.mjs
```

O script imprime um relatório de sanidade. Os valores conferidos contra a aba
`CURSOS GERAL` são:

| Medida | Valor |
|---|---|
| Cursos | 581 |
| Matriculados | 186.024 |
| Concluintes | 96.136 |
| Turmas | 9.125 |
| Bolsistas | 5.718 |
| UFs | 27 |
| Municípios | 247 |
| Instituições realizadoras | 154 |
| Período | 1998–2026 (início) |

Se algum número divergir, a conversão quebrou — não publique.

As medidas **Concluintes** (e a taxa de conclusão derivada dela) e **Bolsistas**
seguem sendo extraídas e conferidas aqui, mas **não são exibidas no painel** nem
no CSV exportado — permanecem apenas como checagem de sanidade da conversão.

A geometria do mapa (`assets/js/uf-paths.js`) já está gerada e versionada.
Só precisa ser refeita se a malha do IBGE mudar:

```bash
node tools/build-uf-map.mjs
```

As coordenadas dos municípios (`assets/js/municipio-coords.js`), usadas só pelo
mapa interativo, também já estão geradas. Refaça só se a planilha passar a citar
municípios novos:

```bash
node tools/build-municipio-coords.mjs
```

O relatório tem de fechar em **246 de 246 municípios resolvidos, 0 faltando**. O
script quebra se algum código ficar sem coordenada, sem nome ou com coordenada
fora do Brasil — um círculo no lugar errado é pior que nenhum círculo.

### Ao publicar: incremente a versão dos assets

O painel é estático e sem build, então o navegador cacheia CSS e JS pelo
caminho do arquivo. Para que uma correção chegue a quem já abriu o painel, cada
asset próprio é carregado com um selo de versão em `index.html`:

```html
<link rel="stylesheet" href="assets/css/app.css?v=2">
<script src="assets/js/app.js?v=2"></script>
```

**Sempre que alterar qualquer arquivo em `assets/css/` ou `assets/js/`,
incremente esse número em todas as linhas com `?v=` no `index.html`.** URL nova,
download novo. O `assets/vendor/` fica de fora: Bootstrap e Chart.js só mudam
quando o arquivo é substituído por outra versão.

O selo só resolve se o próprio `index.html` não vier do cache. Ele carrega um
`<meta http-equiv="Cache-Control" content="no-cache">` como reforço, mas o
correto é o servidor mandar esse cabeçalho para o HTML — e, aí sim, cache longo
para `assets/` (as URLs versionadas tornam isso seguro).

---

## Estrutura

```
OFICIAL PNERA_22-06-2026.xlsx   planilha original (nunca é modificada)
index.html                      o painel
maps-interativo.html            o mapa de círculos proporcionais (exige internet)
tools/
  xlsx-to-json.mjs              conversor, sem dependências
  build-uf-map.mjs              gera o SVG das 27 UFs a partir da malha do IBGE
  build-municipio-coords.mjs    gera os centroides dos 246 municípios (IBGE)
data/
  pnera.json                    581 cursos normalizados
  pnera.meta.json               dicionários, coberturas e totais
  ibge-uf.geojson               malha das UFs em cache
  ibge-municipios/              malhas municipais em cache (6 MB, fora do git)
assets/
  vendor/                       Bootstrap 5.3.3, Chart.js 4.4.4 e Leaflet 1.9.4 locais
  css/theme.css                 tokens (paleta, tipografia, superfícies)
  css/app.css                   layout e componentes
  css/maps-interativo.css       estilos do mapa interativo (só dessa página)
  js/dataset.js                 os dados embutidos (para funcionar em file://)
  js/uf-paths.js                paths SVG das UFs
  js/municipio-coords.js        lat/lon e nome acentuado dos 246 municípios
  js/data.js                    formatação e agregação
  js/filters.js                 estado dos filtros, cruzamento e URL
  js/charts.js                  padrões de marca e ciclo de vida dos cartões
  js/map.js                     mapa coroplético
  js/views.js                   definição de cada visual
  js/table.js                   base de dados, detalhe e exportação CSV
  js/app.js                     montagem do painel
  js/maps-interativo.js         lógica do mapa interativo (só dessa página)
```

`data/pnera.json` e `assets/js/dataset.js` têm o mesmo conteúdo. O `.json` é o
artefato de dados; o `.js` existe porque `fetch()` é bloqueado no protocolo
`file://`, e o painel precisa abrir sem servidor.

---

## O que o painel faz

Cinco visões, todas governadas pelo **mesmo painel de filtros** (nunca filtro
por cartão):

- **Visão geral** — KPIs, cursos iniciados por ano, matriculados por área
  temática, nível de ensino e macrorregião.
- **Territórios** — mapa coroplético por UF (clique filtra), ranking das 27 UFs,
  municípios e superintendências do INCRA.
- **Cursos e áreas** — matriz área temática × nível, composição das modalidades,
  duração e meta de vagas × matrículas efetivas.
- **Instituições e redes** — instituições realizadoras, natureza, titulação da
  coordenação, organizações demandantes e parceiras.
- **Base de dados** — tabela completa ordenável, detalhe do curso e exportação
  do recorte em CSV.

Filtros disponíveis: fase, área temática, nível, modalidade, área do
conhecimento, macrorregião, UF, natureza da instituição, instituição,
instrumento, período de início e busca textual livre.

Os filtros são **cruzados**: a contagem ao lado de cada opção mostra quantos
cursos sobrariam se ela fosse marcada, considerando os outros filtros ativos.
Opções que zeram ficam desabilitadas em vez de desaparecer, para a lista não
pular sob o cursor.

O estado inteiro vive no hash da URL — dá para compartilhar um recorte:

```
index.html#aba=territorios&areaTematica=Agroecologia&uf=Bahia~Paraná&de=2010&ate=2020
```

---

## Mapa interativo (`maps-interativo.html`)

Página à parte, com CSS e JS próprios, para a pergunta que o coroplético não
responde: **onde exatamente**. O coroplético pinta o Pará inteiro do mesmo verde;
aqui o símbolo é o município — 246 pontos.

Duas séries de círculos sobrepostas, no desenho do Atlas da Questão Agrária:

| Série | Cor | Medida |
|---|---|---|
| Matriculados | folha (`--series-1`) | soma de matriculados no município |
| Cursos | terracota (`--series-4`) | nº de cursos realizados no município |

Terracota e não vermelho puro porque é o slot 4 da paleta já validada — cor nova
não se inventa nem no mapa.

**Área proporcional, nunca raio.** `r = 3 + 27·√(v/máx)`. Escalar o raio pelo
valor bruto infla os grandes ao quadrado; é o erro clássico deste tipo de mapa.
A escala é recalculada a cada filtro, e a legenda de círculos concêntricos diz
isso. Dentro de cada série os círculos entram do maior para o menor, para que os
pequenos fiquem por cima e continuem clicáveis.

**Cobertura declarada, como no resto do painel.** 552 dos 581 cursos têm
município na fonte; os 29 restantes ficam fora do mapa e o rodapé diz quantos
são. Ausência de matriculados nunca vira zero.

**Coordenadas.** A planilha traz o código IBGE de 7 dígitos, não a coordenada.
`tools/build-municipio-coords.mjs` resolve os 246 códigos no centroide do maior
anel da malha do IBGE (mesmo critério que ancora as siglas das UFs) e traz de
quebra o **nome acentuado** do município — que na planilha vem sem acento.

**Filtros próprios e enxutos:** fase, área temática, nível, macrorregião, UF,
período de início e busca livre, com chips e estado no hash da URL. Sem contagem
cruzada por opção — essa complexidade fica no painel principal (`js/filters.js`).

```
maps-interativo.html#macrorregiao=Sul&areaTematica=Agroecologia&de=2010&ate=2015
```

### Esta página precisa de internet

O fundo vem dos tiles do **OpenStreetMap** — é a única dependência de rede do
projeto inteiro. Sem conexão a página abre, os 246 círculos aparecem sobre o
plano trigo, filtros e tabela funcionam; só o mapa de fundo fica vazio, e um
aviso abaixo do mapa explica por quê. A atribuição do OpenStreetMap é exigência
da licença e não pode ser removida.

O Leaflet fica vendorizado em `assets/vendor/`, como Bootstrap e Chart.js — CDN
continua fora do projeto. Os tiles do OSM passam por
`filter: saturate(.32)` para o fundo recuar e os círculos, que são o dado,
ficarem em primeiro plano.

---

## Decisões que valem saber

**Fonte única.** Só a aba `CURSOS GERAL` é lida. As 33 abas ocultas são recortes
da mesma aba, deslocados uma coluna à esquerda; `LINGCOMART` e `SC` são cópias
integrais desatualizadas. Usá-las duplicaria registros.

**Ausência não é zero.** A planilha marca dado faltante como `NAO LOCALIZADO`, e
isso é frequente: 89 cursos sem nº de matriculados, 150 sem concluintes, 324 sem
o nome padronizado do curso. Tudo isso vira `null`, fica **fora dos cálculos**, e
cada cartão declara no rodapé sua base real (“base: 492 de 581 cursos com nº de
matriculados”). Médias e taxas nunca são diluídas por zeros inventados.

**Normalização.** Números com sufixo `.0` do Excel, variantes de macrorregião
(`NORDETE`, `CENTRO OESTE`), níveis duplicados (`SUPERIOR` / `NIVEL SUPERIOR`),
espaços duplos e campos multivalorados separados por `;` são resolvidos no
conversor. Acentos são restaurados nas listas fechadas (UFs, áreas, níveis,
modalidades, naturezas); nomes próprios de municípios e pessoas permanecem sem
acento, como estão na fonte. A macrorregião é derivada da UF, que é mais
confiável que a coluna de região.

**Cores.** A paleta é agro, mas foi **validada, não escolhida a olho**: 7 slots
categóricos em ordem fixa, pior par adjacente com ΔE 16,6 sob protanopia e
deuteranopia e 20,6 em visão normal (OKLab ×100; alvo 8 e piso 15). Sete e não
oito porque nenhum oitavo tom agro passou o piso de visão normal — verdes,
ocres e marrons se aglomeram justamente onde a visão de cores colapsa. Passado o
sétimo, a cauda vira “Outros” em cinza; nunca uma cor nova.

O mapa e a matriz usam rampa sequencial de um só tom (verde, 5 passos,
lightness monótona). O passo mais claro recua até a superfície de propósito —
significa “perto de zero” — e por isso cada UF leva contorno hairline.

**Dimensão nominal em barras usa um único tom.** O comprimento da barra já mostra
o valor; colorir cada barra de um jeito gastaria o canal de identidade
duplicando o que o eixo diz. Já nível, titulação e duração **têm ordem natural**,
então recebem a rampa clara→escura.

**Um eixo, sempre.** Medidas comparadas no mesmo gráfico têm de compartilhar a
unidade e o eixo. Não existe gráfico de eixo duplo no painel.

**Rankings não têm barra “Outros”.** Uma barra somando 400 cursos achataria as 12
primeiras e esconderia a comparação que o ranking existe para mostrar. A cauda
fica de fora e o rodapé diz quantas categorias ficaram — nada é truncado em
silêncio.

**Rótulos por sigla.** Nomes longos de entidades são reduzidos à sigla entre
parênteses (`FETAGRI PA`, não `Federacao dos Trabalhadores n…`), porque é a sigla
que as distingue. O nome completo aparece no tooltip e na tabela.

**Todo gráfico tem gêmeo em tabela.** O botão no canto de cada cartão troca o
desenho pelos números. Nenhum valor depende de passar o mouse.

**Acessibilidade.** Contraste AA na tinta (16,1:1 primária, 7,0:1 secundária,
4,6:1 muted), foco visível, navegação por teclado no mapa e nos filtros, faixa
inteira da categoria como alvo de clique (o vão entre barras não é zona morta),
`aria-label` descritivo nos visuais e respeito a `prefers-reduced-motion`.

---

## Limitações conhecidas

- Nomes de municípios, pessoas e entidades vêm sem acento na planilha e assim
  permanecem no painel — restaurá-los exigiria uma base externa de topônimos.
  A exceção é o mapa interativo: lá o nome do município vem acentuado da API de
  localidades do IBGE, junto com a coordenada.
- `meta inicial` (46% de cobertura) e `meta final` (35%) são esparsos; a
  dispersão meta × matrícula cobre 178 dos 581 cursos e diz isso no rodapé.
- Alguns anos de fim são previsões (cursos de graduação iniciados em 2025 com
  término em 2030), como registrado na fonte.
- O painel é deliberadamente **light**, sem tema escuro.
