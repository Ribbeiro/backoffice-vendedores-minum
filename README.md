<<<<<<< HEAD
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

## Importacao de clientes

A tela Upload aceita `.xlsx` e `.xls` com estes cabecalhos:

`Opportunity`, `(CPF/CNPJ)`, `ID`, `Deal - Address`, `Client - Email`, `Client - State`, `Cidade`, `Client - Phone`, `Deal - Segment`, `Responsável`, `Ultima Atualizacao`, `Deal - Distributor`, `Deal - Responsable Salesperson`, `Deal - Tags`, `Deal - Expected Revenue`, `Deal - Notes`, `Deal - Origem`, `Deal - Pipeline Stage`, `Client - Name`, `latitude`, `longitude`, `Country`.

O modo **Mesclar** grava/atualiza clientes por `ID`. O modo **Substituir todos** remove o no `customers` e grava somente os registros importados.

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
      ".read": "auth != null && root.child('users').child(auth.uid).child('active').val() !== false",
      ".write": "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'"
    },
    "plannedRoutes": {
      ".read": "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'",
      ".write": "auth != null"
    },
    "plannedRouteStops": {
      ".read": "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'",
      ".write": "auth != null"
    }
  }
}
```

## Scripts

- `npm run dev`: inicia o Vite.
- `npm run build`: gera a versao de producao.
- `npm run preview`: serve o build localmente.
- `npm run lint`: valida o codigo.
=======
# backoffice-vendedores-minum
Backoffcie do app para vendedores da Minum
>>>>>>> d28e6cf01786860d874653d472aa3ed555bc65fb
