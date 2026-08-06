import XLSX from 'xlsx-js-style';
import { formatDate, formatDateTime } from './formatters';
import { formatTelemetryDistance, formatTelemetryDuration } from './routeTelemetry';
import {
  feedbackCoverageLabel,
  routeStatusLabel,
  routeTypeLabel,
  stopStatusLabel,
} from './routeReport';

const COLORS = {
  dark: '00463A',
  primary: '009279',
  energy: '00D2AE',
  light: 'A4E0CE',
  surface: 'F2F4FA',
  subtle: 'E7F2EE',
  white: 'FFFFFF',
  text: '12342F',
  muted: '526761',
  border: 'D9E5E1',
  success: 'D8F4EC',
  warning: 'FFF8D1',
  error: 'FCE8E5',
};

const titleStyle = {
  font: { name: 'Aptos Display', sz: 18, bold: true, color: { rgb: COLORS.white } },
  fill: { fgColor: { rgb: COLORS.dark } },
  alignment: { vertical: 'center' },
};

const subtitleStyle = {
  font: { name: 'Aptos', sz: 10, color: { rgb: COLORS.white } },
  fill: { fgColor: { rgb: COLORS.primary } },
  alignment: { vertical: 'center' },
};

const sectionStyle = {
  font: { name: 'Aptos', sz: 11, bold: true, color: { rgb: COLORS.dark } },
  fill: { fgColor: { rgb: COLORS.light } },
  alignment: { vertical: 'center' },
};

const headerStyle = {
  font: { name: 'Aptos', sz: 10, bold: true, color: { rgb: COLORS.white } },
  fill: { fgColor: { rgb: COLORS.primary } },
  alignment: { vertical: 'center', wrapText: true },
  border: {
    top: { style: 'thin', color: { rgb: COLORS.primary } },
    bottom: { style: 'thin', color: { rgb: COLORS.primary } },
    left: { style: 'thin', color: { rgb: COLORS.primary } },
    right: { style: 'thin', color: { rgb: COLORS.primary } },
  },
};

function bodyStyle(index, wrapText = false) {
  return {
    font: { name: 'Aptos', sz: 10, color: { rgb: COLORS.text } },
    fill: { fgColor: { rgb: index % 2 === 0 ? COLORS.white : COLORS.surface } },
    alignment: { vertical: 'top', wrapText },
    border: {
      bottom: { style: 'hair', color: { rgb: COLORS.border } },
    },
  };
}

/**
 * Gera uma pasta de trabalho pronta para gestao. Cada aba usa a mesma
 * linguagem visual para facilitar a leitura mesmo fora do backoffice.
 */
export function exportRouteReportWorkbook({ report, filterLabels }) {
  const workbook = XLSX.utils.book_new();
  appendSummarySheet(workbook, report, filterLabels);
  appendTableSheet(workbook, {
    name: 'Rotas',
    title: 'Rotas filtradas',
    subtitle: 'Uma linha por rota, com execucao, cobertura de feedback e resultado.',
    columns: routeColumns,
    rows: report.routes,
  });
  appendTableSheet(workbook, {
    name: 'Visitas',
    title: 'Visitas e feedbacks',
    subtitle: 'Uma linha por cliente selecionado nas rotas do relatorio.',
    columns: stopColumns,
    rows: report.stops,
  });
  appendTableSheet(workbook, {
    name: 'Vendedores',
    title: 'Desempenho por vendedor',
    subtitle: 'Consolidado das rotas e visitas conforme os filtros aplicados.',
    columns: sellerColumns,
    rows: report.sellers,
  });
  appendReadmeSheet(workbook);

  XLSX.writeFile(workbook, `relatorio-minum-${fileDate(report.generatedAt)}.xlsx`, {
    compression: true,
  });
}

function appendSummarySheet(workbook, report, filterLabels) {
  const summary = report.summary;
  const metrics = [
    ['Rotas no relatorio', summary.routes],
    ['Rotas concluidas', summary.completedRoutes],
    ['Rotas nao realizadas', summary.notCompletedRoutes],
    ['Rotas em andamento', summary.inProgressRoutes],
    ['Vendedores envolvidos', summary.sellers],
    ['Clientes nas rotas', summary.totalStops],
    ['Feedbacks registrados', summary.reportedStops],
    ['Cobertura de feedback', feedbackCoverageLabel(summary.feedbackCoveragePercent)],
    ['Clientes visitados', summary.visitedStops],
    ['Taxa de visitas', feedbackCoverageLabel(summary.visitRatePercent)],
    ['Distancia planejada', formatTelemetryDistance(summary.plannedDistanceMeters)],
    ['Distancia percorrida com GPS', formatTelemetryDistance(summary.actualDistanceMeters)],
    ['Tempo total em rota', formatTelemetryDuration(summary.actualDurationSeconds)],
    ['Tempo em deslocamento', formatTelemetryDuration(summary.movingDurationSeconds)],
    ['Tempo parado', formatTelemetryDuration(summary.stoppedDurationSeconds)],
    ['Tempo medio por visita', formatTelemetryDuration(summary.averageVisitDurationSeconds)],
  ];
  const appliedFilters = Object.entries(filterLabels || {}).map(([label, value]) => [label, value || 'Todos']);
  const rows = [
    ['Relatorio gerencial Minum'],
    [`Gerado em ${formatDateTime(report.generatedAt)} | Dados sincronizados do Firebase`],
    [],
    ['Indicadores consolidados'],
    ['Indicador', 'Valor'],
    ...metrics,
    [],
    ['Filtros aplicados'],
    ['Criterio', 'Selecao'],
    ...appliedFilters,
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const lastRow = rows.length;

  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 5 } },
    { s: { r: metrics.length + 6, c: 0 }, e: { r: metrics.length + 6, c: 5 } },
  ];
  sheet['!cols'] = [{ wch: 33 }, { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  sheet['!rows'] = [{ hpt: 28 }, { hpt: 20 }, null, { hpt: 20 }];

  styleRange(sheet, 0, 0, 5, titleStyle);
  styleRange(sheet, 1, 0, 5, subtitleStyle);
  styleRange(sheet, 3, 0, 5, sectionStyle);
  styleRange(sheet, 4, 0, 1, headerStyle);
  styleRange(sheet, metrics.length + 6, 0, 5, sectionStyle);
  styleRange(sheet, metrics.length + 7, 0, 1, headerStyle);
  styleBodyRows(sheet, 5, metrics.length + 4, 2, []);
  styleBodyRows(sheet, metrics.length + 8, lastRow - 1, 2, []);
  sheet['!autofilter'] = { ref: `A5:B${metrics.length + 5}` };

  XLSX.utils.book_append_sheet(workbook, sheet, 'Resumo');
}

function appendTableSheet(workbook, { name, title, subtitle, columns, rows }) {
  const values = rows.length
    ? rows.map((row) => columns.map((column) => column.value(row)))
    : [columns.map((column, index) => (index === 0 ? 'Nenhum dado encontrado para os filtros selecionados.' : ''))];
  const sheetRows = [
    [title],
    [subtitle],
    [],
    columns.map((column) => column.label),
    ...values,
  ];
  const sheet = XLSX.utils.aoa_to_sheet(sheetRows);
  const lastColumn = Math.max(columns.length - 1, 0);
  const lastRow = sheetRows.length - 1;

  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastColumn } },
  ];
  sheet['!cols'] = columns.map((column) => ({ wch: column.width || 18 }));
  sheet['!rows'] = [{ hpt: 28 }, { hpt: 20 }, null, { hpt: 30 }];
  sheet['!autofilter'] = rows.length ? { ref: `A4:${columnLetter(lastColumn)}${lastRow + 1}` } : undefined;

  styleRange(sheet, 0, 0, lastColumn, titleStyle);
  styleRange(sheet, 1, 0, lastColumn, subtitleStyle);
  styleRange(sheet, 3, 0, lastColumn, headerStyle);
  styleBodyRows(sheet, 4, lastRow, columns.length, columns
    .map((column, index) => (column.wrap ? index : null))
    .filter(Number.isInteger));

  if (name === 'Visitas') {
    sheet['!rows'] = sheetRows.map((_, index) => (index >= 4 ? { hpt: 42 } : sheet['!rows'][index]));
  }

  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function appendReadmeSheet(workbook) {
  const rows = [
    ['Como ler este relatorio'],
    ['Definicoes para manter a analise comercial consistente.'],
    [],
    ['Campo', 'Como interpretar'],
    ['Cobertura de feedback', 'Percentual de clientes da rota que receberam um desfecho registrado pelo vendedor.'],
    ['Taxa de visitas', 'Percentual de clientes da rota marcados como visitados. Clientes nao visitados continuam contabilizados como feedback registrado.'],
    ['Distancia percorrida com GPS', 'Soma dos deslocamentos plausiveis registrados durante uma navegacao ativa. Pode ficar indisponivel quando o GPS nao foi autorizado.'],
    ['Tempo medio por visita', 'Media entre chegada e saida do cliente quando esses eventos foram capturados pelo aplicativo.'],
    ['Distancia do cliente', 'Distancia em linha reta entre a posicao salva no feedback e a coordenada do cliente. Nao representa distancia pelas ruas.'],
    ['Dados ausentes', 'Um tracinho indica que o aplicativo nao recebeu a informacao suficiente para fazer uma medicao confiavel.'],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
  ];
  sheet['!cols'] = [{ wch: 30 }, { wch: 100 }, { wch: 18 }, { wch: 18 }];
  sheet['!rows'] = [{ hpt: 28 }, { hpt: 20 }, null, { hpt: 28 }, ...rows.slice(4).map(() => ({ hpt: 44 }))];
  styleRange(sheet, 0, 0, 3, titleStyle);
  styleRange(sheet, 1, 0, 3, subtitleStyle);
  styleRange(sheet, 3, 0, 1, headerStyle);
  styleBodyRows(sheet, 4, rows.length - 1, 2, [1]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sobre o relatorio');
}

function styleRange(sheet, row, startColumn, endColumn, style) {
  for (let column = startColumn; column <= endColumn; column += 1) {
    const address = XLSX.utils.encode_cell({ r: row, c: column });
    if (!sheet[address]) sheet[address] = { t: 's', v: '' };
    sheet[address].s = style;
  }
}

function styleBodyRows(sheet, startRow, endRow, columnsCount, wrapColumns) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = 0; column < columnsCount; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (!sheet[address]) sheet[address] = { t: 's', v: '' };
      sheet[address].s = bodyStyle(row, wrapColumns.includes(column));
    }
  }
}

function columnLetter(index) {
  return XLSX.utils.encode_col(index);
}

function fileDate(value) {
  const date = value instanceof Date ? value : new Date();
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

const routeColumns = [
  { label: 'Data da rota', value: (row) => formatDateTime(row.routeDate), width: 19 },
  { label: 'Rota', value: (row) => row.name, width: 28, wrap: true },
  { label: 'ID da rota', value: (row) => row.id, width: 27 },
  { label: 'Tipo', value: (row) => routeTypeLabel(row.type), width: 25 },
  { label: 'Vendedor', value: (row) => row.sellerName, width: 24 },
  { label: 'E-mail do vendedor', value: (row) => row.sellerEmail, width: 28 },
  { label: 'Estado', value: (row) => row.state || '-', width: 10 },
  { label: 'Status', value: (row) => routeStatusLabel(row.status), width: 18 },
  { label: 'Paradas', value: (row) => row.totalStops, width: 11 },
  { label: 'Feedbacks', value: (row) => row.reportedStops, width: 12 },
  { label: 'Cobertura de feedback', value: (row) => feedbackCoverageLabel(row.feedbackCoveragePercent), width: 22 },
  { label: 'Visitados', value: (row) => row.visitedStops, width: 12 },
  { label: 'Nao visitados', value: (row) => row.notVisitedStops, width: 15 },
  { label: 'Taxa de visitas', value: (row) => feedbackCoverageLabel(row.visitRatePercent), width: 17 },
  { label: 'Meta de conclusao', value: (row) => feedbackCoverageLabel(row.completionTargetPercent), width: 19 },
  { label: 'Distancia planejada', value: (row) => formatTelemetryDistance(row.plannedDistanceMeters), width: 19 },
  { label: 'Distancia percorrida', value: (row) => formatTelemetryDistance(row.actualDistanceMeters), width: 19 },
  { label: 'Tempo em rota', value: (row) => formatTelemetryDuration(row.actualDurationSeconds), width: 17 },
  { label: 'Tempo medio por visita', value: (row) => formatTelemetryDuration(row.averageVisitDurationSeconds), width: 21 },
  { label: 'Motivo da nao realizacao', value: (row) => row.notCompletedReason || '-', width: 34, wrap: true },
  { label: 'Orientacoes da rota', value: (row) => row.routeNotes || '-', width: 34, wrap: true },
  { label: 'Prazo', value: (row) => formatDate(row.dueDate), width: 14 },
];

const stopColumns = [
  { label: 'Data da rota', value: (row) => formatDateTime(row.routeDate), width: 19 },
  { label: 'Rota', value: (row) => row.routeName, width: 28, wrap: true },
  { label: 'Vendedor', value: (row) => row.sellerName, width: 24 },
  { label: 'Estado', value: (row) => row.state || '-', width: 10 },
  { label: 'Ordem', value: (row) => row.order || '-', width: 10 },
  { label: 'Cliente', value: (row) => row.customerName, width: 32, wrap: true },
  { label: 'ID externo', value: (row) => row.customerExternalId, width: 18 },
  { label: 'CPF/CNPJ', value: (row) => row.customerCnpjCpf, width: 18 },
  { label: 'Cidade', value: (row) => row.city || '-', width: 18 },
  { label: 'Segmento', value: (row) => row.segment || '-', width: 24 },
  { label: 'Status da visita', value: (row) => stopStatusLabel(row.status), width: 18 },
  { label: 'Data e horario do feedback', value: (row) => formatDateTime(row.feedbackAt), width: 23 },
  { label: 'Chegada', value: (row) => formatDateTime(row.arrivedAt), width: 20 },
  { label: 'Saida', value: (row) => formatDateTime(row.departedAt), width: 20 },
  { label: 'Permanencia', value: (row) => formatTelemetryDuration(row.visitDurationSeconds), width: 16 },
  { label: 'Distancia do cliente', value: (row) => formatTelemetryDistance(row.feedbackDistanceMeters), width: 19 },
  { label: 'Precisao do GPS', value: (row) => formatTelemetryDistance(row.feedbackLocationAccuracyMeters), width: 16 },
  { label: 'Feedback', value: (row) => row.feedback || '-', width: 52, wrap: true },
  { label: 'Motivo de nao visita', value: (row) => row.notVisitedReason || '-', width: 30, wrap: true },
  { label: 'Resultado comercial', value: (row) => row.commercialOutcome || '-', width: 28, wrap: true },
  { label: 'Proximo passo', value: (row) => row.nextAction || '-', width: 30, wrap: true },
  { label: 'Data do proximo passo', value: (row) => row.nextActionDueDate || '-', width: 21 },
];

const sellerColumns = [
  { label: 'Vendedor', value: (row) => row.sellerName, width: 28 },
  { label: 'E-mail', value: (row) => row.sellerEmail, width: 30 },
  { label: 'Estados', value: (row) => row.states || '-', width: 16 },
  { label: 'Rotas', value: (row) => row.routes, width: 11 },
  { label: 'Concluidas', value: (row) => row.completedRoutes, width: 13 },
  { label: 'Nao realizadas', value: (row) => row.notCompletedRoutes, width: 16 },
  { label: 'Clientes', value: (row) => row.totalStops, width: 12 },
  { label: 'Feedbacks', value: (row) => row.reportedStops, width: 13 },
  { label: 'Cobertura de feedback', value: (row) => feedbackCoverageLabel(row.feedbackCoveragePercent), width: 22 },
  { label: 'Visitados', value: (row) => row.visitedStops, width: 12 },
  { label: 'Taxa de visitas', value: (row) => feedbackCoverageLabel(row.visitRatePercent), width: 17 },
  { label: 'Distancia planejada', value: (row) => formatTelemetryDistance(row.plannedDistanceMeters), width: 19 },
  { label: 'Distancia percorrida', value: (row) => formatTelemetryDistance(row.actualDistanceMeters), width: 19 },
  { label: 'Tempo em rota', value: (row) => formatTelemetryDuration(row.actualDurationSeconds), width: 17 },
  { label: 'Tempo medio por visita', value: (row) => formatTelemetryDuration(row.averageVisitDurationSeconds), width: 21 },
];
