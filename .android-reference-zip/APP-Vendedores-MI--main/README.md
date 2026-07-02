# Vendedores Minum

Aplicativo Android nativo para planejar visitas comerciais a partir de um prospecto principal e encontrar clientes próximos importados de uma planilha Excel.

## Arquitetura escolhida

O projeto segue MVVM em camadas:

- `data`: Room, DAOs, entidades, repositórios, importador Excel.
- `domain`: modelos de negócio, Haversine, filtros, busca por proximidade e otimização de ordem de visita.
- `presentation`: telas Jetpack Compose, ViewModels, navegação e componentes reutilizáveis.
- `utils`: normalização de cabeçalhos, formatação e cálculo geográfico.

A lógica crítica funciona offline: clientes ficam no Room e a busca por proximidade usa bounding box + Haversine localmente. O Google Maps é usado para visualização; a chave fica em `local.properties`.

## Funcionalidades implementadas

- Importação de `.xlsx` e `.xls` com Apache POI.
- Identificação flexível de cabeçalhos, mesmo com colunas fora de ordem.
- Validação de latitude e longitude.
- Persistência local com Room.
- Tela de nova visita com origem por coordenadas, endereço, mapa, localização atual ou cliente existente.
- Busca por raio configurável: 1, 2, 5, 10 e 20 km.
- Filtros por segmento, cidade, estado, status, telefone e ativo.
- Mapa com marcador do prospecto, marcadores dos clientes próximos e linha da sequência selecionada.
- Lista inferior de clientes próximos com seleção, chamada, navegação e detalhes.
- Heurística de rota por vizinho mais próximo.
- Histórico simples de rotas planejadas.
- Configurações locais com DataStore.

## Como rodar

1. Abra a pasta do projeto no Android Studio.
2. Copie `local.properties.example` para `local.properties`.
3. Preencha a chave:

```properties
MAPS_API_KEY=SUA_CHAVE_GOOGLE_MAPS
```

4. Sincronize o Gradle.
5. Rode o app em um dispositivo ou emulador Android com Google Play Services.

Sem a chave do Maps, o restante do app ainda representa a arquitetura e a lógica local, mas o mapa não carregará corretamente.

## Modelo de planilha

A planilha precisa conter latitude e longitude. As demais colunas são opcionais.

Cabeçalhos aceitos incluem variações como:

- `nome`, `cliente`, `razao_social`
- `endereco`, `logradouro`
- `cidade`, `municipio`
- `estado`, `uf`
- `latitude`, `lat`
- `longitude`, `lng`, `lon`
- `telefone`, `celular`, `whatsapp`
- `segmento`, `categoria`
- `status`, `situacao`
- `observacoes`, `obs`

Veja `samples/clientes_modelo.csv` como referência visual de colunas.

## Observações técnicas

- A busca usa bounding box antes do Haversine para reduzir o volume de cálculo em bases grandes.
- A importação roda em `Dispatchers.IO`, evitando travar a interface.
- A rota otimizada atual é uma heurística simples de vizinho mais próximo, pronta para ser substituída por Google Directions API, OSRM, GraphHopper ou outro serviço.
- Para reduzir custo e dependência externa, uma evolução viável é trocar o mapa para OSMDroid/OpenStreetMap mantendo a mesma camada de domínio.

