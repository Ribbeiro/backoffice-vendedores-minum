/**
 * A oportunidade e o nome operacional do prospecto na Minum. O contato e
 * preservado separadamente para chamadas e acompanhamento comercial.
 */
function text(value) {
  return String(value ?? '').trim();
}

export function customerPrimaryName(customer, fallback = 'Cliente sem nome') {
  return text(customer?.opportunity)
    || text(customer?.name)
    || text(customer?.clientName)
    || text(customer?.contactName)
    || text(customer?.externalId)
    || text(customer?.id)
    || fallback;
}

export function customerContactName(customer) {
  const contact = text(customer?.clientName) || text(customer?.contactName);
  return contact && contact !== customerPrimaryName(customer, '') ? contact : '';
}

export function customerSearchText(customer) {
  return [
    customerPrimaryName(customer, ''),
    customerContactName(customer),
    text(customer?.city),
    text(customer?.state),
    text(customer?.cnpjCpf || customer?.cpfCnpj),
    text(customer?.externalId || customer?.id),
  ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
}

export function stopPrimaryName(stop, customer, fallback = 'Cliente sem nome') {
  return text(stop?.opportunity)
    || customerPrimaryName(customer, '')
    || text(stop?.customerName)
    || text(stop?.clienteNome)
    || text(stop?.name)
    || text(stop?.clientName)
    || text(stop?.customerId)
    || fallback;
}
