# Design System Minum - Backoffice

## Fundamentos

Os tokens vivem em `src/design/tokens.js`. Eles centralizam marca, superficies, textos, bordas, feedback, raios, sombras e motion. `src/theme.js` aplica esses tokens aos componentes MUI, evitando cores espalhadas pelas telas.

Carbona e a familia oficial da Minum. Como os arquivos webfont nao foram fornecidos, a pilha temporaria usa Carbona quando instalada e recorre a Avenir Next e Segoe UI. Quando a licenca e os arquivos da Carbona estiverem disponiveis, adicione `@font-face` em um local protegido e mantenha o mesmo nome de familia.

## Componentes

- `MinumLogo`: wordmark oficial em superficies claras ou escuras.
- `MinumLine`: linha institucional de dois segmentos para titulos e detalhes de marca.
- `MinumIcon`: escala linear padronizada: 16, 20, 24 e 32 px.
- `MetricCard`, `PageHeader`, `StatusIndicator` e `EmptyState`: componentes operacionais reutilizaveis.
- MUI global: botoes, inputs, tabelas, chips, alertas, accordions e tooltips recebem estados de foco, hover, disabled e feedback pelo tema.

## Layout e responsividade

O backoffice usa sidebar institucional em desktop, drawer em telas menores e conteudo com largura maxima de 1600 px. Tabelas mantem densidade de trabalho, cabecalhos legiveis e estados vazios claros.

## Acessibilidade e motion

O tema inclui foco visivel, suporte a `prefers-reduced-motion`, textos de controles e tooltips para icones sem rotulo. Use cor junto de texto ou icone para comunicar status.
