# Funcoes de importacao Odoo

Estas Cloud Functions recebem exportacoes brutas de oportunidades do Odoo e entregam
uma previa auditavel antes de qualquer alteracao em `customers`.

## O que a automacao faz

- Consolida linhas isoladas de `Marcadores/Nome do marcador` na oportunidade anterior.
- Mantem uma oportunidade por linha e preserva IDs, CPF/CNPJ e telefones como texto.
- Reaproveita somente dados ja confirmados no Firebase para completar campos vazios.
- Consulta BrasilAPI apenas quando existe CNPJ valido e campo elegivel vazio.
- Geocodifica apenas enderecos confirmados e salva coordenadas somente com resultado
  permanente autorizado no Mapbox.
- Gera auditoria de dados preenchidos, nao encontrados e inconsistencias.
- Guarda a previa no Realtime Database por 24 horas; apenas quem a criou pode confirma-la.

## Preparacao local

```powershell
npm --prefix functions install
npm --prefix functions run lint
npm --prefix functions test
```

## Preparacao do Firebase

O deploy de Cloud Functions requer que o projeto Firebase esteja no plano Blaze.
Configure o token secreto somente no Firebase CLI, nunca no `.env` do front-end:

```powershell
firebase functions:secrets:set MAPBOX_ACCESS_TOKEN
```

Para permitir armazenamento de resultados de geocodificacao, confirme primeiro que
sua conta Mapbox possui esse direito e altere `MAPBOX_GEOCODING_PERMANENT` para `true`
no ambiente das Functions. Sem essa configuracao, a importacao continua funcionando,
mas coordenadas ausentes ficam sinalizadas como pendentes para revisao.

## Deploy

Na raiz do backoffice:

```powershell
firebase deploy --only functions,database,hosting
```

