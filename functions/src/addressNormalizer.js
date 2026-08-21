/**
 * Normalizacao deterministica de enderecos brasileiros antes da geocodificacao.
 * O endereco original nunca e alterado: os campos abaixo existem apenas para
 * pesquisa, auditoria e formacao da chave de cache.
 */
const GEOCODING_ALGORITHM_VERSION = 3;

const STATE_NAMES = {
  AC: 'ACRE', AL: 'ALAGOAS', AP: 'AMAPA', AM: 'AMAZONAS', BA: 'BAHIA', CE: 'CEARA',
  DF: 'DISTRITO FEDERAL', ES: 'ESPIRITO SANTO', GO: 'GOIAS', MA: 'MARANHAO', MT: 'MATO GROSSO',
  MS: 'MATO GROSSO DO SUL', MG: 'MINAS GERAIS', PA: 'PARA', PB: 'PARAIBA', PR: 'PARANA',
  PE: 'PERNAMBUCO', PI: 'PIAUI', RJ: 'RIO DE JANEIRO', RN: 'RIO GRANDE DO NORTE',
  RS: 'RIO GRANDE DO SUL', RO: 'RONDONIA', RR: 'RORAIMA', SC: 'SANTA CATARINA', SP: 'SAO PAULO',
  SE: 'SERGIPE', TO: 'TOCANTINS',
};

const COMPLEMENT_PATTERN = /\b(?:ap(?:to)?\.?|apartamento|bloco|casa|conj(?:unto)?|ed(?:ificio)?\.?|fundos|galp(?:ao|ão)(?:port(?:ao|ão))?|loja|lote|port(?:ao|ão)|quadra|sala|sl\.?|sobreloja|torre|unidade)\b/i;
const RURAL_PATTERN = /\b(?:zona rural|estrada|chacara|chácara|sitio|sítio|fazenda|rodovia|km\s*\d+)\b/i;
const NO_NUMBER_PATTERN = /\b(?:s\s*\/\s*n(?:[ºo])?|sem\s+numero|sem\s+n[uú]mero|sn)\b/i;

function cleanCell(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeString(value) {
  return cleanCell(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeCountryCode(value) {
  const normalized = normalizeString(value).toUpperCase();
  if (!normalized || normalized === 'BRASIL' || normalized === 'BRAZIL' || normalized === 'BR') return 'BR';
  return normalized.slice(0, 2);
}

function normalizeState(value) {
  const state = cleanCell(value).toUpperCase();
  if (STATE_NAMES[state]) return state;
  const normalized = normalizeString(state).toUpperCase();
  const found = Object.entries(STATE_NAMES).find(([, name]) => name === normalized);
  return found?.[0] || '';
}

/** Trata "MS - Campo Grande", "Campo Grande - MS" e nomes completos de UF. */
function normalizeCityAndState(rawCity, rawState) {
  let city = cleanCell(rawCity);
  let region = normalizeState(rawState);
  const prefix = city.match(/^([A-Za-z]{2})\s*-\s*(.+)$/);
  const suffix = city.match(/^(.+?)\s*-\s*([A-Za-z]{2})$/);
  if (prefix && STATE_NAMES[prefix[1].toUpperCase()]) {
    region = prefix[1].toUpperCase();
    city = prefix[2].trim();
  } else if (suffix && STATE_NAMES[suffix[2].toUpperCase()]) {
    region = suffix[2].toUpperCase();
    city = suffix[1].trim();
  }
  return { place: city, region };
}

/** Apenas o componente do numero pode sofrer a remocao do separador de milhar. */
function parseThousandHouseNumber(value) {
  const cleaned = cleanCell(value);
  if (!cleaned) return null;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(cleaned)) return cleaned.replace(/\./g, '');
  const digits = cleaned.replace(/\D/g, '');
  return digits || null;
}

function normalizeStreetForSearch(value) {
  return cleanCell(value)
    .replace(/^r\.\s*/i, 'Rua ')
    .replace(/^rua\s+/i, 'Rua ')
    .replace(/^(?:av\.?|ave\.?|avenida)\s+/i, 'Avenida ')
    .replace(/^rod\.\s*/i, 'Rodovia ')
    .replace(/^estr\.\s*/i, 'Estrada ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findLocationInAddress(address, fallback) {
  const tokens = cleanCell(address).split(',').map(cleanCell).filter(Boolean);
  let place = fallback.place;
  let region = fallback.region;
  let cutIndex = tokens.length;

  tokens.forEach((token, index) => {
    const suffix = token.match(/^(.+?)\s*-\s*([A-Za-z]{2})$/);
    const tokenState = normalizeState(token);
    const isKnownPlace = place && normalizeString(token).toUpperCase() === normalizeString(place).toUpperCase();
    if (suffix && STATE_NAMES[suffix[2].toUpperCase()]) {
      if (!place) place = suffix[1].trim();
      if (!region) region = suffix[2].toUpperCase();
      cutIndex = Math.min(cutIndex, index);
    } else if (isKnownPlace) {
      cutIndex = Math.min(cutIndex, index);
    } else if (tokenState) {
      if (!region) region = tokenState;
      cutIndex = Math.min(cutIndex, index);
    } else if (!place && index < tokens.length - 1 && /^[A-ZÀ-Ú\s.'-]+$/i.test(token) && normalizeState(tokens[index + 1])) {
      place = token;
      region = region || normalizeState(tokens[index + 1]);
      cutIndex = Math.min(cutIndex, index);
    }
  });

  return { place, region, addressTokens: tokens.slice(0, cutIndex) };
}

function splitRemainder(values) {
  const parts = values
    .flatMap((value) => cleanCell(value).split(/\s+-\s+/))
    .map(cleanCell)
    .filter(Boolean);
  const complementParts = parts.filter((part) => COMPLEMENT_PATTERN.test(part) || /\bkm\s*\d+/i.test(part));
  const neighborhoodParts = parts.filter((part) => !complementParts.includes(part) && !RURAL_PATTERN.test(part));
  return {
    complement: complementParts.join(', ') || null,
    neighborhood: neighborhoodParts.join(', ') || null,
  };
}

/** Interpreta enderecos heterogeneos sem inventar componentes que nao existem. */
function parseBrazilianAddress(rawAddress, rawCity = '', rawState = '', rawCountry = 'Brasil') {
  const originalAddress = cleanCell(rawAddress);
  const suppliedLocation = normalizeCityAndState(rawCity, rawState);
  const postcodeMatch = originalAddress.match(/(?:CEP\s*:?\s*)?(\d{5}-?\d{3})/i);
  const postcode = postcodeMatch ? postcodeMatch[1].replace('-', '') : null;
  const textWithoutPostcode = originalAddress
    .replace(/(?:CEP\s*:?\s*)?\d{5}-?\d{3}/gi, '')
    .replace(/,?\s*(?:Brasil|Brazil)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const location = findLocationInAddress(textWithoutPostcode, suppliedLocation);
  const addressTokens = location.addressTokens;
  const addressText = addressTokens.join(', ').trim();
  const isRural = RURAL_PATTERN.test(addressText);
  const hasNoNumber = NO_NUMBER_PATTERN.test(addressText);
  const kmMatch = addressText.match(/\bkm\s*(\d+)\b/i);

  let street = '';
  let houseNumber = null;
  let remainder = [];
  const first = addressTokens[0] || '';
  const second = addressTokens[1] || '';
  const trailingTokens = addressTokens.slice(2);
  const firstTwo = second ? `${first}, ${second}` : first;

  if (isRural) {
    street = first || addressText;
    remainder = addressTokens.slice(1);
  } else {
    const numbered = firstTwo.match(/^(.*?)(?:,|\s)+(\d{1,3}(?:\.\d{3})+|\d+)\b(?:[\s,-]+(.*))?$/i);
    const trailingNumber = first.match(/^(.*?)[\s,]+(\d{1,3}(?:\.\d{3})+|\d+)\b(?:[\s,-]+(.*))?$/i);
    const match = !hasNoNumber ? (numbered || trailingNumber) : null;
    if (match) {
      street = cleanCell(match[1]);
      houseNumber = parseThousandHouseNumber(match[2]);
      if (match[3]) remainder.push(match[3]);
      remainder.push(...(numbered ? trailingTokens : addressTokens.slice(1)));
    } else {
      street = first || addressText;
      remainder = addressTokens.slice(1);
    }
  }

  street = normalizeStreetForSearch(street.replace(NO_NUMBER_PATTERN, '').replace(/[\s,]+$/g, ''));
  const remainderParts = splitRemainder(remainder);
  const country = cleanCell(rawCountry) || 'Brasil';
  const normalizedSearchAddress = [
    street,
    houseNumber,
    remainderParts.complement,
    remainderParts.neighborhood,
    location.place,
    location.region,
    postcode,
    country,
  ].filter(Boolean).join(', ');

  return {
    originalAddress,
    street,
    houseNumber,
    complement: remainderParts.complement,
    neighborhood: remainderParts.neighborhood,
    place: location.place,
    region: location.region,
    postcode,
    country,
    countryCode: normalizeCountryCode(country),
    isRural,
    hasNoNumber: hasNoNumber || (!houseNumber && !isRural),
    km: kmMatch?.[1] || null,
    normalizedSearchAddress,
  };
}

/** A chave usa o endereco completo e a versao do algoritmo. */
function canonicalKey(street, houseNumber, place, region, postcode = '', country = 'BR', neighborhood = '') {
  const norm = (value) => normalizeString(value).toLowerCase();
  const normNumber = parseThousandHouseNumber(houseNumber) || norm(houseNumber);
  return [
    `v${GEOCODING_ALGORITHM_VERSION}`,
    norm(street),
    normNumber,
    norm(neighborhood),
    norm(place),
    normalizeString(region).toUpperCase(),
    cleanCell(postcode).replace(/\D/g, ''),
    normalizeCountryCode(country),
  ].join('|');
}

module.exports = {
  GEOCODING_ALGORITHM_VERSION,
  STATE_NAMES,
  canonicalKey,
  cleanCell,
  normalizeCityAndState,
  normalizeCountryCode,
  normalizeState,
  normalizeString,
  parseBrazilianAddress,
  parseThousandHouseNumber,
};
