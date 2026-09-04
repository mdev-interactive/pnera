# Painel PNERA — Educação na Reforma Agrária

Painel analítico dos dados da **Pesquisa Nacional de Educação na Reforma Agrária**
(PNERA II e III — INCRA / Universidade de Brasília) sobre os cursos do **Pronera**.

Converte a planilha `OFICIAL PNERA_03-09-2026-.xlsx` em JSON limpo e serve um
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

Sem argumento, o script pega a planilha `OFICIAL PNERA*.xlsx` mais recente na
raiz do projeto ou em `data/` — recente pela data no nome (`DD-MM-AAAA`), não
pela ordem alfabética. Para apontar outra, passe o caminho:
`node tools/xlsx-to-json.mjs "data/OFICIAL PNERA_03-09-2026-.xlsx"`.

O script imprime um relatório de sanidade. Os valores conferidos contra a aba
`CURSOS GERAL` são:

| Medida | Valor |
|---|---|
| Cursos | 585 |
| Matriculados | 201.785 |
| Concluintes | 96.194 |
| Turmas | 9.129 |
| Bolsistas | 5.718 |
| UFs | 27 |
| Municípios | 247 |
| Instituições realizadoras | 147 |
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

As coordenadas dos municípios (`assets/js/municipio-coords.js`), usadas pela
camada de círculos do mapa do painel e pelo mapa interativo, também já estão
geradas. Refaça só se a planilha passar a citar municípios novos:

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
index.html                      o painel
maps-interativo.html            o mapa de círculos proporcionais (exige internet)
tools/
  xlsx-to-json.mjs              conversor, sem dependências
  build-uf-map.mjs              gera o SVG das 27 UFs a partir da malha do IBGE
  build-municipio-coords.mjs    gera os centroides dos 246 municípios (IBGE)
data/
  OFICIAL PNERA_03-09-2026-.xlsx  planilha original (nunca é modificada)
  pnera.json                    585 cursos normalizados
  pnera.meta.json               dicionários, coberturas e totais
  ibge-uf.geojson               malha das UFs em cache
  ibge-municipios/              malhas municipais em cache (6 MB, fora do git)
assets/
  vendor/                       Bootstrap 5.3.3, Chart.js 4.4.4 e Leaflet 1.9.4 locais
  css/theme.css                 tokens (paleta, tipografia, superfícies)
  css/app.css                   layout e componentes
  css/maps-interativo.css       estilos do mapa interativo (só dessa página)
  js/dataset.js                 os dados embutidos (para funcionar em file://)
  js/uf-paths.js                paths SVG das UFs e os parâmetros da projeção
  js/municipio-coords.js        lat/lon e nome acentuado dos 246 municípios
  js/data.js                    formatação e agregação
  js/filters.js                 estado dos filtros, cruzamento e URL
  js/charts.js                  padrões de marca e ciclo de vida dos cartões
  js/map.js                     mapa do painel: círculos por município e aparato cartográfico
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
- **Territórios** — mapa monocromático de círculos proporcionais por município,
  com cruzetas de coordenada, norte e escala gráfica (clique no círculo ou no
  estado filtra), ranking das 27 UFs, municípios e superintendências do INCRA.
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

Página à parte, com CSS e JS próprios. O mapa do painel já mostra o município,
mas sobre a malha calada do IBGE; aqui os mesmos 246 pontos entram sobre base
cartográfica com zoom, escala e reenquadramento — para localizar de fato o
lugar, não só a nuvem.

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

**Cobertura declarada, como no resto do painel.** 556 dos 585 cursos têm
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

**Fonte única.** Só a aba `CURSOS GERAL` é lida. As outras 36 abas — 35 ocultas
mais a `CURSOS FINALIZADOS`, visível — são recortes da mesma aba, deslocados uma
coluna à esquerda; `LINGCOMART` e `SC` são cópias integrais desatualizadas.
Usá-las duplicaria registros: `CURSOS FINALIZADOS` traz 586 linhas que já estão
todas na `CURSOS GERAL`, uma delas repetida.

**Ausência não é zero.** A planilha marca dado faltante como `NAO LOCALIZADO`, e
isso é frequente: 88 cursos sem nº de matriculados, 152 sem concluintes, 324 sem
o nome padronizado do curso. Tudo isso vira `null`, fica **fora dos cálculos**, e
cada cartão declara no rodapé sua base real (“base: 497 de 585 cursos com nº de
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

A matriz área × nível usa rampa sequencial de um só tom (verde, 5 passos,
lightness monótona), com o passo mais claro recuando até a superfície de
propósito — significa “perto de zero”.

**O mapa do painel é monocromático.** A malha das UFs é base, não dado:
preenchimento neutro uniforme (`--seq-empty`, um passo mais escuro em
`--border-strong` na UF filtrada) e divisas em contorno hairline. Nenhuma sigla
de estado. Todo o dado vive nos círculos por município, em terracota
(`--series-4`) — o mesmo slot do mapa interativo. Uma coroplética de estado
sobre os círculos disputaria a mesma leitura duas vezes e, pior, faria o Pará
inteiro parecer homogêneo justamente onde o círculo mostra o contrário. Área
proporcional ao valor (raio pela raiz quadrada) e legenda de anéis concêntricos,
como no mapa interativo.

**Aparato cartográfico dentro do SVG.** Quatro cruzetas de coordenada (0°/70°O,
0°/40°O, 25°S/60°O, 25°S/40°O), seta de norte, escala gráfica em km e a legenda
dos círculos ficam no próprio desenho — não em HTML ao lado. Assim o mapa
continua completo se virar imagem, e o aparato acompanha qualquer largura.
Posições verificadas por ponto-em-polígono contra as 27 UFs e os 246 municípios:
nenhuma peça cai sobre a malha ou sobre um círculo.

**A escala declara a latitude.** Mercator não tem escala única — a mesma unidade
vale 4,43 km no equador e 3,83 km em 30° S. A barra é calculada em 15° S, a
latitude média da nuvem de pontos, e traz a nota `km · em 15° S`. Sem declarar,
a barra seria uma afirmação falsa em metade do mapa. O comprimento sai de
`UF_MAP.projection.scale`, nunca de número fixo.

**Aparato escala por peça, não por fonte.** O texto está em unidades do viewBox,
calibrado para o cartão largo (~600 px de SVG, rótulo a ~11 px). Onde a grade
colapsa, o SVG cai para ~360 px; aumentar só a fonte quebraria o encaixe — o
número da escala ficaria mais largo que o segmento. Então cada peça cresce por
inteiro em torno da própria âncora (`ajustarAparato` em `assets/js/map.js`),
mantendo a razão entre texto, barra e cruzeta.

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
  dispersão meta × matrícula cobre 182 dos 585 cursos e diz isso no rodapé.
- Alguns anos de fim são previsões (cursos de graduação iniciados em 2025 com
  término em 2030), como registrado na fonte.
- O painel é deliberadamente **light**, sem tema escuro.
