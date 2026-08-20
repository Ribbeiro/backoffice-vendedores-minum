const GEOCODING_ALGORITHM_VERSION = 2;

const STATE_NAMES = {
  AC: 'ACRE', AL: 'ALAGOAS', AP: 'AMAPA', AM: 'AMAZONAS', BA: 'BAHIA', CE: 'CEARA',
  DF: 'DISTRITO FEDERAL', ES: 'ESPIRITO SANTO', GO: 'GOIAS', MA: 'MARANHAO', MT: 'MATO GROSSO',
  MS: 'MATO GROSSO DO SUL', MG: 'MINAS GERAIS', PA: 'PARA', PB: 'PARAIBA', PR: 'PARANA',
  PE: 'PERNAMBUCO', PI: 'PIAUI', RJ: 'RIO DE JANEIRO', RN: 'RIO GRANDE DO NORTE',
  RS: 'RIO GRANDE DO SUL', RO: 'RONDONIA', RR: 'RORAIMA', SC: 'SANTA CATARINA', SP: 'SAO PAULO',
  SE: 'SERGIPE', TO: 'TOCANTINS',
};

function normalizeString(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCell(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\u00a0/g, ' ').trim();
}

/**
 * Normaliza o campo de cidade/estado do Odoo.
 * Exemplos:
 *   rawCity = "MS - Campo Grande", state = "MS" => { place: "Campo Grande", region: "MS" }
 *   rawCity = "Campo Grande", state = "MS" => { place: "Campo Grande", region: "MS" }
 */
function normalizeCityAndState(rawCity, rawState) {
  let cityStr = cleanCell(rawCity);
  let stateStr = cleanCell(rawState).toUpperCase();

  // Caso "MS - Campo Grande" ou "SP - São Paulo"
  const prefixMatch = cityStr.match(/^([A-Za-z]{2})\s*-\s*(.+)$/);
  if (prefixMatch) {
    const extractedUf = prefixMatch[1].toUpperCase();
    if (STATE_NAMES[extractedUf]) {
      stateStr = extractedUf;
      cityStr = prefixMatch[2].trim();
    }
  }

  // Normalização do estado
  let region = stateStr;
  if (stateStr.length > 2) {
    const norm = normalizeString(stateStr).toUpperCase();
    const found = Object.entries(STATE_NAMES).find(([, name]) => name === norm);
    region = found ? found[0] : stateStr.slice(0, 2);
  }

  return {
    place: cityStr,
    region: region,
  };
}

/**
 * Identifica se uma string contém número com separador de milhar brasileiro (ex: 7.881 -> 7881).
 * Não deve alterar CEP, decimais, complementos ou anos.
 */
function parseThousandHouseNumber(value) {
  if (!value) return null;
  const cleaned = cleanCell(value);

  // Exemplo: 7.881 ou 1.234 isolado ou precedido por vírgula/espaço
  const match = cleaned.match(/\b(\d{1,3})\.(\d{3})\b/);
  if (match) {
    return `${match[1]}${match[2]}`;
  }

  const pureDigits = cleaned.replace(/\D/g, '');
  return pureDigits || null;
}

/**
 * Parser de Endereços Brasileiros
 * Interpreta logradouro, número do imóvel, complemento, bairro, cidade, UF, CEP.
 */
function parseBrazilianAddress(rawAddress, rawCity = '', rawState = '', rawCountry = 'Brasil') {
  const originalAddress = cleanCell(rawAddress);
  const cityState = normalizeCityAndState(rawCity, rawState);

  let street = '';
  let houseNumber = null;
  let complement = null;
  let neighborhood = null;
  let postcode = null;
  let isRural = false;
  let hasNoNumber = false;
  let km = null;

  if (!originalAddress) {
    return {
      originalAddress,
      street,
      houseNumber,
      complement,
      neighborhood,
      place: cityState.place,
      region: cityState.region,
      postcode,
      country: cleanCell(rawCountry) || 'Brasil',
      isRural,
      hasNoNumber,
      km,
      normalizedSearchAddress: [cityState.place, cityState.region, rawCountry].filter(Boolean).join(', '),
    };
  }

  // Extração de CEP se presente no texto do endereço
  const cepMatch = originalAddress.match(/(?:CEP\s*:?\s*)?(\d{5}-?\d{3})/i);
  if (cepMatch) {
    postcode = cepMatch[1].replace('-', '');
  }

  let text = originalAddress
    .replace(/(?:CEP\s*:?\s*)?\d{5}-?\d{3}/gi, '')
    .replace(/,\s*Brasil$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Verificar se é Rural / Estrada
  if (/\b(?:zona rural|estrada|chacara|sitio|fazenda|km\s*\d+)\b/i.test(text)) {
    isRural = true;
  }

  // Extrair KM se houver
  const kmMatch = text.match(/\bkm\s*(\d+)\b/i);
  if (kmMatch) {
    km = kmMatch[1];
  }

  // Verificar S/N (sem número)
  if (/\b(?:s\/n|sem numero|s\/nº|sn)\b/i.test(text)) {
    hasNoNumber = true;
  }

  // Remover S/N para não confundir parser
  let workingText = text.replace(/\b(?:s\/n|sem numero|s\/nº|sn)\b/gi, '').trim();

  let extractedComplement = null;

  // Tratar número com milhar ex: AVENIDA MARECHAL DEODORO, 7.881
  const thousandMatch = workingText.match(/(.*?),?\s*(\d{1,3}\.\d{3})\b(.*)/i);
  if (thousandMatch) {
    street = thousandMatch[1].trim();
    houseNumber = thousandMatch[2].replace('.', '');
    const remainder = thousandMatch[3].trim();
    if (remainder) {
      extractedComplement = remainder.replace(/^[\s,-]+/, '');
    }
  } else {
    // Tentar padrão tradicional: RUA ALGO, 123, COMPLEMENTO
    const numberMatch = workingText.match(/^(.*?)[,\s]+(\d+)\b(.*)$/);
    if (numberMatch && !isRural) {
      street = numberMatch[1].trim();
      houseNumber = numberMatch[2];
      const remainder = numberMatch[3].trim();
      if (remainder) {
        extractedComplement = remainder.replace(/^[\s,-]+/, '');
      }
    } else {
      street = workingText;
    }
  }

  // Limpeza de vírgulas trailing em rua
  street = street.replace(/^[,\s]+|[,\s]+$/g, '');

  if (extractedComplement) {
    complement = extractedComplement;
  }

  // Se não foi identificado número e não é S/N / Rural, verificar se rua termina com dígitos
  if (!houseNumber && !hasNoNumber && !isRural) {
    const trailingNumMatch = street.match(/^(.*)\s+(\d+)$/);
    if (trailingNumMatch) {
      street = trailingNumMatch[1].trim();
      houseNumber = trailingNumMatch[2];
    }
  }

  // Normalização de abreviações para busca (ex: R. -> Rua, AV. -> Avenida)
  let searchStreet = street
    .replace(/^r\.\s+/i, 'Rua ')
    .replace(/^rua\s+/i, 'Rua ')
    .replace(/^(?:av\.|ave\.|avenida)\s+/i, 'Avenida ');

  // Montagem do endereço de busca estruturado
  const parts = [
    searchStreet,
    houseNumber,
    complement,
    cityState.place,
    cityState.region,
    postcode,
    cleanCell(rawCountry) || 'Brasil',
  ].filter(Boolean);

  return {
    originalAddress,
    street: searchStreet || street,
    houseNumber: houseNumber || null,
    complement: complement || null,
    neighborhood: neighborhood || null,
    place: cityState.place,
    region: cityState.region,
    postcode: postcode || null,
    country: cleanCell(rawCountry) || 'Brasil',
    isRural,
    hasNoNumber: hasNoNumber || (!houseNumber && !isRural),
    km: km || null,
    normalizedSearchAddress: parts.join(', '),
  };
}

/**
 * Gera a Chave Canônica do Endereço para Cache e Deduplicação.
 * Garante que:
 *   canonicalKey("Avenida Florestal", "370", "Campo Grande", "MS")
 *   != canonicalKey("Avenida Três Barras", "370", "Campo Grande", "MS")
 */
function canonicalKey(street, houseNumber, place, region, postcode = '', country = 'BR') {
  const normStreet = normalizeString(street).toLowerCase();
  const normNumber = parseThousandHouseNumber(houseNumber) || cleanCell(houseNumber).toLowerCase();
  const normPlace = normalizeString(place).toLowerCase();
  const normRegion = normalizeString(region).toUpperCase();
  const normPostcode = cleanCell(postcode).replace(/\D/g, '');
  const normCountry = normalizeString(country).toUpperCase();

  return [
    `v${GEOCODING_ALGORITHM_VERSION}`,
    normStreet,
    normNumber,
    normPlace,
    normRegion,
    normPostcode,
    normCountry,
  ].join('|');
}

module.exports = {
  GEOCODING_ALGORITHM_VERSION,
  STATE_NAMES,
  canonicalKey,
  cleanCell,
  normalizeCityAndState,
  normalizeString,
  parseBrazilianAddress,
  parseThousandHouseNumber,
};
