# Backoffice Vendedores Minum

Painel administrativo em React + Firebase para importar clientes, acompanhar rotas e gerenciar vendedores do app Android Vendedores Minum.

## Como rodar

1. Instale as dependencias:

```bash
npm install
```

2. Copie `.env.example` para `.env` e preencha as variaveis do seu projeto Firebase.

3. Inicie o ambiente local:

```bash
npm run dev
```

4. Abra a URL exibida pelo Vite.

## Estrutura esperada no Realtime Database

- `users/{uid}`: dados do usuario, incluindo `role: "admin"` ou `role: "vendedor"` e `active`.
- `customers/{id}`: clientes importados da planilha.
- `plannedRoutes/{routeId}`: rotas planejadas ou realizadas pelo app Android.
- `plannedRouteStops/{routeId}/{stopId}`: paradas de cada rota.

## Integracao com o app Android

Os dois projetos usam o mesmo Firebase Auth e o mesmo Realtime Database.

- O back office importa clientes para `customers/{id}`.
- O app Android baixa `customers` apos login autorizado e salva no Room para uso offline.
- O app Android publica rotas salvas em `plannedRoutes/{routeId}`.
- O app Android publica as paradas em `plannedRouteStops/{routeId}/{customerId}`.
- O back office escuta esses nos em tempo real para alimentar dashboard e historico.

Campos minimos em `users/{uid}`:

```json
{
  "email": "usuario@empresa.com",
  "name": "Nome do usuario",
  "role": "admin",
  "active": true,
  "allowedAccess": true,
  "deleted": false
}
```

Use `role: "admin"` para acesso ao painel e `role: "vendedor"` para acesso ao app.

## Importacao de clientes

A tela Upload aceita `.xlsx` e `.xls` com estes cabecalhos:

`Opportunity`, `(CPF/CNPJ)`, `ID`, `Deal - Address`, `Client - Email`, `Client - State`, `Cidade`, `Client - Phone`, `Deal - Segment`, `Responsável`, `Ultima Atualizacao`, `Deal - Distributor`, `Deal - Responsable Salesperson`, `Deal - Tags`, `Deal - Expected Revenue`, `Deal - Notes`, `Deal - Origem`, `Deal - Pipeline Stage`, `Client - Name`, `latitude`, `longitude`, `Country`.

O modo **Mesclar** grava/atualiza clientes por `ID`. O modo **Substituir todos** remove o no `customers` e grava somente os registros importados.

### Exportacao bruta do Odoo

Quando a tela de Upload identifica as colunas `Oportunidade`, `Codigo do sistema MINUM` e `Marcadores/Nome do marcador`, ela envia o arquivo para uma Cloud Function protegida por administrador. O processamento:

- consolida as linhas extras de marcadores na oportunidade correta;
- preserva CPF/CNPJ, telefone e ID como texto;
- completa somente campos vazios confirmados por clientes existentes ou BrasilAPI;
- gera coordenadas apenas quando a geocodificacao permanente do Mapbox estiver configurada;
- mostra uma previa, uma planilha tratada e um CSV de auditoria antes de gravar;
- remove automaticamente previas nao confirmadas apos 24 horas.

Para habilitar o fluxo no Firebase, execute na raiz do projeto:

```bash
npm --prefix functions install
firebase functions:secrets:set MAPBOX_ACCESS_TOKEN
firebase deploy --only functions,database,hosting
```

O deploy de Functions requer o plano Blaze. O token do Mapbox fica somente no segredo do Firebase; nunca use uma variavel `VITE_` para ele.

## Regras de seguranca sugeridas

As regras finais devem ser aplicadas no console do Firebase, nao no frontend. Exemplo base:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || root.child('users').child(auth.uid).child('role').val() === 'admin')",
        ".write": "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'"
      }
    },
    "customers": {
      ".read": "auth != null && root.child('users').child(auth.uid).child('active').val() === true && root.child('users').child(auth.uid).child('deleted').val() !== true",
      ".write": "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'"
    },
    "plannedRoutes": {
      ".read": "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'",
      ".write": "auth != null && root.child('users').child(auth.uid).child('active').val() === true && root.child('users').child(auth.uid).child('deleted').val() !== true"
    },
    "plannedRouteStops": {
      ".read": "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'",
      ".write": "auth != null && root.child('users').child(auth.uid).child('active').val() === true && root.child('users').child(auth.uid).child('deleted').val() !== true"
    }
  }
}
```

## Scripts

- `npm run dev`: inicia o Vite.
- `npm run build`: gera a versao de producao.
- `npm run preview`: serve o build localmente.
- `npm run lint`: valida o codigo.
