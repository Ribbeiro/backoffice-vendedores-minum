# Reducao de downloads do Realtime Database

## Comportamento

- O agendamento de cinco minutos consulta `odooSyncQueue` por `nextAttemptAt`,
  com indice e limite de 20 entradas por padrao (maximo 100). Uma fila vazia
  nao le `customers` nem `visitEvents`. Cada item aponta para o evento original.
- O envio imediato continua ativo. Alteracoes nos feedbacks acordam a fila;
  eventos sincronizados/excluidos sao retirados, falhas aguardam sua retentativa
  e locks expirados podem ser recuperados. Uma versao impede que um worker
  apague uma notificacao mais recente. A fila tambem recebe eventos enquanto
  ODOO_SYNC_ENABLED esta desativado, para recupera-los quando for habilitado.
- O reparo legado completo permanece disponivel somente pela chamada
  administrativa `processOdooVisitEvents`. Ela ainda pode ler a base inteira;
  nao deve ser usada como polling do painel ou tarefa agendada.
- `customersBySeller/{uid}/{customerId}` contem a carteira preparada no servidor.
  Alteracoes de clientes atualizam as carteiras; mudancas de identidade/acesso
  do usuario reconstroem sua carteira. A reconstrucao de perfil e uma operacao
  excepcional que le clientes, nao um trabalho periodico.
- A projecao preserva coordenadas de navegacao e status de qualidade, mas nao
  replica respostas extensas do geocodificador. O original fica em `customers`.
- O Android atualizado escuta somente sua carteira e mantem o filtro local
  defensivo. Nao existe fallback para baixar todos os clientes.
- O painel busca as ultimas 50 rotas por `createdAt` e as rotas abertas nos
  estados `assigned`, `planned`, `in_progress`, `em andamento`, `awaiting_feedback`.
  Paradas e eventos sao assinados individualmente para essas rotas. Consultas
  antigas podem ser ampliadas em blocos de 50; os indicadores, exportacoes e
  retornos comerciais refletem o conjunto carregado, indicado no aviso da tela.
  Rotas legadas sem `createdAt` podem exigir carregar paginas adicionais.
  Visitas e retornos de rotas antigas encerradas nao aparecem ate sua pagina
  ser carregada. Nenhum historico e apagado.
- Paginas sem acompanhamento operacional nao mantem assinaturas do historico.

## Ordem obrigatoria de ativacao

O commit nao publica Firebase nem distribui um APK. Use esta ordem para evitar
que o aplicativo atualizado encontre uma carteira ainda vazia:

1. Instalar dependencias com `npm ci` e `npm --prefix functions ci`.
2. Publicar primeiro as regras e Functions, no projeto Firebase correto:
   `firebase deploy --only database,functions`.
3. Pausar importacoes e alteracoes de cadastro durante a migracao inicial.
   Com Application Default Credentials administrativas configuradas, definir
   `FIREBASE_DATABASE_URL` para a instancia correta e executar uma vez:
   `node functions/scripts/backfillCostIndexes.js --apply`.
   O script le o historico uma vez, enfileira eventos pendentes e prepara as
   carteiras existentes. Pode ser repetido apos falha; nao cria atividades Odoo
   diretamente e a sincronizacao conserva a idempotencia do evento.
4. Conferir no console uma carteira vazia, uma preenchida e a troca de
   responsavel. Verificar pendencias antigas na fila e novos feedbacks enviados
   uma unica vez. Retomar as importacoes.
5. Compilar/publicar o painel: `npm run build` e
   `firebase deploy --only hosting`.
6. Compilar/testar o Android com JDK 17, SDK e token de download Mapbox
   configurados. Somente depois distribuir a atualizacao do aplicativo.

As regras antigas de `customers` continuam disponiveis para celulares ainda
na versao anterior. A economia dos celulares depende da atualizacao deles.
Nao ha escrita dos clientes em `customersBySeller` ou `odooSyncQueue`: somente
o servidor administrativo mantem esses caminhos.

## Verificacao

- `npm --prefix functions test`: inclui casos de fila vazia, concorrencia,
  retentativa, exclusao, limite, resolucao por cliente, distribuicao de carteira
  e ciclo de assinaturas do painel, alem das suites anteriores.
- `npm run lint` e `npm run build`.
- `gradlew.bat :app:compileDebugKotlin :app:testDebugUnitTest` no repositorio Android.
- Validar regras no emulador com uma sessao de vendedor: propria carteira
  permitida, carteira alheia negada, escrita de projecao/fila negada, usuario
  desativado negado. O emulador requer Java.
- Comparar MB/dia e o perfil de consultas antes/depois com uso semelhante,
  inclusive um periodo sem celulares/painel abertos. O job nao deve mais ler
  as raizes de clientes/eventos a cada cinco minutos.

## Reversao

Se for necessario voltar ao aplicativo anterior, sua leitura de `customers`
continua permitida pelas regras existentes. Preserve a fila e as carteiras:
elas sao derivadas, e sua exclusao nao e necessaria para reverter o frontend.
Nao desative a recuperacao Odoo sem acompanhar os feedbacks pendentes.
