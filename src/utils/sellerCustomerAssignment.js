const ASSIGNEE_SEPARATOR = /[,;|/\n]+/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const NAME_CONNECTORS = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);

/**
 * Retorna o nome mais confiavel para apresentar a carteira do vendedor.
 */
export function getSellerDisplayName(seller) {
  return String(seller?.name || seller?.displayName || seller?.email || seller?.id || 'vendedor').trim();
}

/**
 * Verifica se o cliente foi atribuido ao vendedor selecionado no cadastro/importacao.
 *
 * A base possui nomes de campos antigos e novos por compatibilidade com Odoo. A comparacao
 * aceita nome completo ou e-mail, ignorando acentos, diferencas de caixa e espacos extras.
 */
export function isCustomerAssignedToSeller(customer, seller) {
  const sellerIdentifiers = sellerIdentityCandidates(seller);
  if (sellerIdentifiers.length === 0) return false;

  return customerAssignmentCandidates(customer).some((assignee) =>
    sellerIdentifiers.some((sellerIdentifier) => representsSameSeller(assignee, sellerIdentifier)));
}

function sellerIdentityCandidates(seller) {
  return unique([
    ...identityCandidates(seller?.name),
    ...identityCandidates(seller?.displayName),
    ...identityCandidates(seller?.email),
  ]);
}

function customerAssignmentCandidates(customer) {
  return unique([
    ...identityCandidates(customer?.responsavel),
    ...identityCandidates(customer?.responsible),
    ...identityCandidates(customer?.responsableSalesperson),
    ...identityCandidates(customer?.responsibleSalesperson),
  ]);
}

function identityCandidates(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return [];

  return unique([
    normalizeIdentity(rawValue),
    ...rawValue.split(ASSIGNEE_SEPARATOR).map(normalizeIdentity),
    ...(rawValue.match(EMAIL_PATTERN) || []).map(normalizeIdentity),
  ].filter(Boolean));
}

function representsSameSeller(first, second) {
  if (first === second) return true;
  if (first.includes('@') || second.includes('@')) return false;

  const firstTokens = meaningfulNameTokens(first);
  const secondTokens = meaningfulNameTokens(second);
  return firstTokens.length >= 2
    && secondTokens.length >= 2
    && firstTokens[0] === secondTokens[0]
    && firstTokens[firstTokens.length - 1] === secondTokens[secondTokens.length - 1];
}

function meaningfulNameTokens(value) {
  return value.split(' ').filter((token) => token && !NAME_CONNECTORS.has(token));
}

function normalizeIdentity(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function unique(values) {
  return [...new Set(values)];
}
