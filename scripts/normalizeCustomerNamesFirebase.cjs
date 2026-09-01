#!/usr/bin/env node

/*
 * Corrige os registros gerados antes da separacao entre oportunidade e
 * contato. A oportunidade e o nome principal exibido; o contato permanece
 * em clientName. O script reproduz a migracao administrativa publicada na
 * Cloud Function para casos em que seja preciso executa-la pelo Firebase CLI.
 *
 * Uso:
 *   node scripts/normalizeCustomerNamesFirebase.cjs          # apenas previa
 *   node scripts/normalizeCustomerNamesFirebase.cjs --apply  # aplica no RTDB
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');
const REPORT_ARGUMENT = process.argv.find((argument) => argument.startsWith('--report='));
const REPORT_PATH = REPORT_ARGUMENT ? path.resolve(REPORT_ARGUMENT.slice('--report='.length)) : null;
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'minum-customer-names-'));
const ROOT_NODES = [
  'customers',
  'plannedRouteStops',
  'sharedRoutesBySeller',
  'visitEvents',
  'visitAttendances',
];

function textValue(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** A oportunidade identifica o prospecto; o contato nunca a substitui. */
function primaryCustomerName(customer) {
  return textValue(customer?.opportunity)
    || textValue(customer?.name)
    || textValue(customer?.clientName)
    || textValue(customer?.contactName)
    || textValue(customer?.externalId)
    || textValue(customer?.id);
}

function addCustomerIdentity(index, type, value, customer) {
  const normalized = textValue(value);
  if (normalized) index.set(`${type}:${normalized}`, customer);
}

function buildCustomerNameIndex(customers) {
  const index = new Map();
  Object.entries(customers || {}).forEach(([key, rawCustomer]) => {
    const name = primaryCustomerName(rawCustomer);
    if (!name) return;

    const customer = {
      name,
      opportunity: textValue(rawCustomer?.opportunity),
      clientName: textValue(rawCustomer?.clientName) || textValue(rawCustomer?.contactName),
    };

    addCustomerIdentity(index, 'key', key, customer);
    addCustomerIdentity(index, 'id', rawCustomer?.id, customer);
    addCustomerIdentity(index, 'external', rawCustomer?.externalId, customer);
    addCustomerIdentity(index, 'minum', rawCustomer?.minumCode, customer);
    addCustomerIdentity(index, 'odoo', rawCustomer?.odooLeadId, customer);
    addCustomerIdentity(index, 'odooExternal', rawCustomer?.odooExternalId, customer);
  });
  return index;
}

function findCustomerForSnapshot(snapshot, customerIndex) {
  const identities = [
    ['key', snapshot?.customerKey],
    ['id', snapshot?.customerId],
    ['external', snapshot?.customerExternalId],
    ['external', snapshot?.externalId],
    ['minum', snapshot?.minumCode],
    ['odoo', snapshot?.odooLeadId],
    ['odooExternal', snapshot?.odooExternalId],
  ];

  for (const [type, value] of identities) {
    const customer = customerIndex.get(`${type}:${textValue(value)}`);
    if (customer) return customer;
  }
  return null;
}

function normalizeSnapshotNames(node, currentPath, customerIndex, updates, counts) {
  if (!node || typeof node !== 'object') return;

  if (Object.prototype.hasOwnProperty.call(node, 'customerName')) {
    const customer = findCustomerForSnapshot(node, customerIndex);
    if (customer) {
      if (textValue(node.customerName) !== customer.name) {
        updates[`${currentPath}/customerName`] = customer.name;
        counts.snapshotsUpdated += 1;
      }
      if (customer.opportunity && textValue(node.opportunity) !== customer.opportunity) {
        updates[`${currentPath}/opportunity`] = customer.opportunity;
      }
      if (customer.clientName && !textValue(node.clientName)) {
        updates[`${currentPath}/clientName`] = customer.clientName;
      }
    }
  }

  Object.entries(node).forEach(([childKey, childValue]) => {
    if (childValue && typeof childValue === 'object') {
      normalizeSnapshotNames(childValue, `${currentPath}/${childKey}`, customerIndex, updates, counts);
    }
  });
}

function firebase(...args) {
  // No Windows o Firebase CLI e um .cmd; execSync deixa o shell resolver o
  // lancador corretamente sem depender de extensoes na variavel PATH do Node.
  const command = ['firebase', ...args]
    .map((argument) => `"${String(argument).replaceAll('"', '\\"')}"`)
    .join(' ');
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readRootNode(nodeName) {
  const outputPath = path.join(TEMP_DIR, `${nodeName}.json`);
  firebase('database:get', `/${nodeName}`, '-o', outputPath);
  return JSON.parse(fs.readFileSync(outputPath, 'utf8')) || {};
}

function applyUpdates(entries) {
  for (let index = 0; index < entries.length; index += 350) {
    const chunk = Object.fromEntries(entries.slice(index, index + 350));
    const inputPath = path.join(TEMP_DIR, `updates-${index / 350}.json`);
    fs.writeFileSync(inputPath, JSON.stringify(chunk), 'utf8');
    firebase('database:update', '/', inputPath, '--force');
  }
}

function cleanup() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

try {
  const data = Object.fromEntries(ROOT_NODES.map((nodeName) => [nodeName, readRootNode(nodeName)]));
  const customers = data.customers || {};
  const customerIndex = buildCustomerNameIndex(customers);
  const updates = {};
  const counts = { customersUpdated: 0, snapshotsUpdated: 0 };

  Object.entries(customers).forEach(([customerId, customer]) => {
    const primaryName = primaryCustomerName(customer);
    if (primaryName && textValue(customer?.name) !== primaryName) {
      updates[`customers/${customerId}/name`] = primaryName;
      counts.customersUpdated += 1;
    }
  });

  [
    ['plannedRouteStops', data.plannedRouteStops],
    ['sharedRoutesBySeller', data.sharedRoutesBySeller],
    ['visitEvents', data.visitEvents],
    ['visitAttendances', data.visitAttendances],
  ].forEach(([nodeName, node]) => normalizeSnapshotNames(node, nodeName, customerIndex, updates, counts));

  const entries = Object.entries(updates);
  const result = {
    ...counts,
    fieldsUpdated: entries.length,
    applied: APPLY,
  };

  if (APPLY && entries.length) applyUpdates(entries);

  if (REPORT_PATH) fs.writeFileSync(REPORT_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result));
} finally {
  cleanup();
}
