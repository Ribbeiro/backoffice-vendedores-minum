# Geolocalizacao e revalidacao de clientes

## Objetivo

O destino da navegacao nao e aceito apenas porque possui latitude e longitude. Cada coordenada precisa ter origem, nivel de precisao e evidencia de que pertence ao endereco informado. O Mapbox continua sendo o unico provedor de geocodificacao e navegacao.

## Modelo de coordenadas

Cada cliente pode conter os campos abaixo, sem remover os campos legados `latitude` e `longitude`:

- `sourceLatitude` e `sourceLongitude`: coordenada recebida do Odoo ou de uma base anterior.
- `geocodedLatitude` e `geocodedLongitude`: ponto geografico retornado pelo Mapbox v6.
- `navigationLatitude` e `navigationLongitude`: ponto veicular (`routable_point.default`) usado pelo Android quando confirmado.
- `entranceLatitude` e `entranceLongitude`: entrada fisica, quando o Mapbox a disponibilizar.
- `previousLatitude` e `previousLongitude`: valor anterior a uma aprovacao administrativa.
- `geocoding`: endereco original, endereco normalizado, consulta estruturada, resposta do provedor, `match_code`, confianca, precisao, resultado do reverse, versao do algoritmo e decisao da auditoria.
- `geocodingReview`: usuario, data e job que aprovou uma alteracao.

Coordenadas vindas do Odoo ou reaproveitadas do Firebase recebem `legacy_unverified` ate passarem pela auditoria. Elas nunca se tornam confirmadas so porque sao numericamente validas.

## Normalizacao

`functions/src/addressNormalizer.js` preserva `originalAddress` e cria componentes de pesquisa separados. Ele reconhece cidade no formato `MS - Campo Grande`, abreviacoes de logradouro, complementos, CEP, `S/N`, area rural e numeros brasileiros com separador de milhar. Por exemplo, `AVENIDA MARECHAL DEODORO, 7.881` gera `street = Avenida Marechal Deodoro` e `houseNumber = 7881`.

A chave de cache inclui versao do algoritmo, rua, numero, bairro, cidade, UF, CEP e pais. Assim, `Avenida Florestal, 370` e `Avenida Tres Barras, 370` nunca compartilham resultado de geocodificacao.

## Politica de confirmacao

Para um endereco urbano numerado ser elegivel para aprovacao, o Mapbox precisa retornar:

1. `feature_type = address`.
2. `match_code.address_number = matched` e `match_code.street = matched`.
3. Confianca `exact` ou `high`.
4. Precisao `rooftop`, `parcel` ou `point`.
5. Consistencia entre forward e reverse geocoding.

Resultados `street`, `place`, `postcode`, `interpolated`, `approximate`, sem numero, rurais ou sem evidencia suficiente ficam em revisao. Eles nao sao enviados ao aplicativo como um novo destino.

## Auditoria administrativa

A tela **Revalidacao** cria um job persistido em `geocodingAuditJobs`. O processamento ocorre em lotes de ate 50 enderecos, pode ser retomado depois e utiliza cache versionado em `leadImportCache`.

O administrador pode filtrar coordenadas legadas, centroides suspeitos, duplicidades de enderecos distintos, divergencias forward/reverse, conflitos com evidencia de campo e variacoes acima de 500 m ou 2 km. Ao abrir um registro, a tela mostra coordenadas atual, geocodificada, navegavel, distancia Haversine, `match_code`, evidencia de campo e motivo da decisao.

O botao **Aplicar aprovadas** chama uma Cloud Function administrativa. Somente propostas com evidencia tecnica valida sao gravadas em `customers`; a coordenada anterior continua no registro e a aprovacao fica auditavel.

Para excecoes comprovadas fora do Mapbox, a gaveta do registro permite uma **correcao manual**. Ela exige latitude, longitude e justificativa. O sistema marca a origem como manual, preserva a coordenada anterior e registra administrador, data e job. Essa opcao nao transforma dados incompletos em uma confirmacao automatica.

## Evidencia de campo

Check-ins de visitas sao usados apenas como sinal adicional. O sistema descarta GPS com precisao acima de 100 m e exige ao menos duas amostras no mesmo aglomerado de 150 m para formar uma mediana de campo. Um unico check-in nunca substitui endereco ou coordenada.

## Android

O app usa `navigationCoordinate` para calcular e iniciar rotas, com fallback retrocompativel para a coordenada geografica somente quando o cliente ainda e legado. A busca manual de origem usa a Cloud Function `geocodeAddress`, que aplica a mesma politica do backend. O fallback do Android `Geocoder` foi removido para evitar destinos diferentes entre celular e backoffice.

## Operacao e deploy

1. Configure o segredo no projeto Firebase:

   ```powershell
   firebase functions:secrets:set MAPBOX_ACCESS_TOKEN
   ```

2. Mantenha `MAPBOX_GEOCODING_PERMANENT=true` apenas se a conta e o uso estiverem adequados as regras de armazenamento do Mapbox.

3. Execute os testes das Functions:

   ```powershell
   cd functions
   npm test
   ```

4. Valide localmente, quando houver emuladores configurados:

   ```powershell
   firebase emulators:start --only functions,database
   ```

5. Publique Functions e regras depois de revisar o diff:

   ```powershell
   firebase deploy --only functions,database
   ```

6. Compile o Android:

   ```powershell
   $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
   .\gradlew.bat :app:compileDebugKotlin
   ```

## Verificacoes executadas

- `npm test` em `functions`: 19 testes aprovados.
- `npm run lint` no backoffice: aprovado.
- `npm run build` no backoffice: aprovado.
- `:app:compileDebugKotlin` no Android: aprovado.

## Limites intencionais

Uma proposta de endereco incompleto pode aparecer na auditoria para triagem, mas nao e promovida automaticamente. O backoffice nunca corrige a base por offset geografico, nunca calcula media de centroides e nunca inventa numero, bairro, CEP ou cidade.
