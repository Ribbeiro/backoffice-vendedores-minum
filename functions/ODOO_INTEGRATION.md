# Integracao segura Minum -> Odoo

Esta Function cria uma atividade em `mail.activity` para um `crm.lead` somente
quando um feedback de visita possuir um `odooLeadId` confirmado. Ela nao usa
nome, CNPJ ou texto livre para tentar localizar oportunidades.

## Identificadores usados

Cada cliente importado conserva tres campos independentes:

- `minumCode`: codigo Minum, tambem mantido em `externalId` por compatibilidade.
- `odooLeadId`: ID tecnico numerico do `crm.lead`.
- `odooExternalId`: ID externo exportado pelo Odoo.

As rotas, paradas e feedbacks levam uma copia desses campos. Apenas
`feedback_submitted` com `odooLeadId` valido entra na fila. Os demais eventos
recebem `odooSyncStatus=not_required` e continuam apenas no historico Minum.

## Importacao direta da planilha do Odoo

Na tela **Importar base**, envie diretamente a exportacao `crm.lead` do Odoo.
O adaptador reconhece os cabecalhos `id`, `name`, `street` e `tag_ids`, sem
exigir que alguem preencha o modelo Minum antes.

- `__export__.crm_lead_64208_...` e convertido em `odooLeadId=64208` e o ID
  externo completo continua armazenado em `odooExternalId`.
- Quando ainda nao existe codigo Minum, `odoo_lead_<id>` vira a chave estavel
  do novo cliente. Se o cliente ja existir por lead Odoo, ID externo ou
  CPF/CNPJ, a chave legada do Firebase e mantida para evitar duplicidade.
- Cidade e UF sao normalizadas, inclusive valores como `MS - Anastacio`.
- O endereco segue pelo Mapbox Structured Geocoding v6 e somente coordenadas
  confirmadas por forward/reverse entram como destino de navegacao. Resultados
  incompletos ficam na auditoria para revisao humana.
- O importador mostra uma previa antes de gravar; apenas o botao **Confirmar
  importacao** escreve em `customers`.

Isso deixa o cliente preparado para o envio futuro de feedbacks ao Odoo, mas
nao ativa a sincronizacao de visitas por si so.

## Configuracao inicial

1. Confirme com o administrador do Odoo a URL da API publicada pelo proxy e o
   protocolo suportado. A URL da tela do CRM nao e, por si so, uma confirmacao
   do endpoint de integracao.
2. Crie a chave sem coloca-la em arquivos, terminal, front-end ou logs:

   ```powershell
   firebase functions:secrets:set ODOO_API_KEY
   ```

   O Firebase solicitara o valor de forma interativa.
3. Copie `.env.example` para `.env` dentro desta pasta e preencha apenas os
   parametros nao secretos. O arquivo `.env` ja e ignorado pelo Git.
4. Em Odoo 18 com `jsonrpc`, a Minum agenda a atividade diretamente no
   `crm.lead`, sem exigir leitura tecnica de `ir.model`; se nao for informado
   um tipo, o CRM aplica o tipo padrao da oportunidade. Em `json2`, informe os
   IDs reais de `ir.model` para `crm.lead` e do tipo de atividade.
5. Use a acao administrativa **Criar atividade de teste**. Ela trabalha apenas
   no lead `58680` com o resumo fixo `Minum | Teste de integracao`; repetir o
   teste reutiliza a mesma atividade. Depois da validacao, defina
   `ODOO_SYNC_ENABLED=true` no `functions/.env` e publique novamente.

## Protocolos

- `json2`: usa `POST /json/2/<model>/<method>`, chave Bearer e, quando
  necessario, `X-Odoo-Database`.
- `jsonrpc`: usa `POST /jsonrpc` e exige `ODOO_DATABASE` e `ODOO_LOGIN` alem da
  chave. No Odoo 18, a atividade e criada por `crm.lead.activity_schedule`,
  preservando as permissoes funcionais do CRM sem depender do modelo tecnico.

O worker consulta uma atividade com o resumo `Minum | Visita <eventId>` antes
de criar outra. Isso torna a operacao idempotente quando ocorrer timeout ou uma
tentativa repetida.

## Estados da fila

- `pending`: feedback aguardando sincronizacao.
- `processing`: evento protegido por lock do worker.
- `synced`: atividade criada ou encontrada no Odoo.
- `failed`: falha temporaria; o worker agenda nova tentativa.
- `blocked`: falta `odooLeadId` ou ocorreu erro definitivo confirmado.
- `not_required`: evento que nao deve virar atividade no Odoo.

Uma configuracao Odoo ausente ou incompleta nao bloqueia nem modifica
feedbacks pendentes. O job apenas aguarda uma configuracao valida. Falhas de
autenticacao tambem recebem retentativas com backoff, permitindo trocar a chave
diaria sem perder feedbacks.

## Operacao automatica

Com `ODOO_SYNC_ENABLED=true`, um feedback elegivel e enviado logo apos ser
gravado em `visitEvents`. O agendamento de cinco minutos continua ativo como
recuperacao para indisponibilidade de rede, atualizacao de chave ou qualquer
falha temporaria. A atividade e pesquisada pelo resumo unico antes da criacao,
portanto as duas vias nao geram duplicidades.

## Teste de aceite

1. Importe uma oportunidade de teste contendo codigo Minum, `odooLeadId` e
   `odooExternalId`.
2. Crie uma rota para esse cliente e salve um feedback no aplicativo.
3. Confirme no Realtime Database que o evento ficou `pending`.
4. Com a sincronizacao habilitada, confirme que o evento vira `synced` em
   poucos segundos. Se o envio imediato falhar, o job de cinco minutos retoma
   automaticamente.
5. Confirme uma unica atividade no `crm.lead` de teste e o evento com
   `odooSyncStatus=synced` e `odooActivityId`.
6. Repita o job e confirme que nenhuma atividade duplicada foi criada.

## Reprocessamento manual de um feedback do aplicativo

Mesmo com a fila automatica ativa, o backoffice permite validar ou reenviar um
unico feedback pendente sem processar o restante da fila:

1. Salve no app um feedback para um cliente que tenha `odooLeadId` valido.
2. No backoffice, abra **Inteligencia operacional** e valide a conexao Odoo.
3. Na secao **Teste com feedback do aplicativo**, escolha o feedback pendente
   e use **Enviar este feedback**.
4. A Function `processSingleOdooVisitEvent` processa apenas esse caminho no
   Firebase. Ao concluir, o evento recebe `odooSyncStatus=synced` e
   `odooActivityId`.

O mesmo evento pode ser reenviado sem criar uma atividade duplicada: depois da
primeira confirmacao, o backoffice informa que ele ja esta sincronizado.
