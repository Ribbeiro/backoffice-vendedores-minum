import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, CircularProgress } from '@mui/material';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const SOURCE_ID = 'minum-customers';
const LAYER_ID = 'minum-customers-points';
const INITIAL_CENTER = [-54.8, -14.2];

export default function CustomerMap({ customers, selectedCustomerId, onCustomerSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const sourceDataRef = useRef(emptyFeatureCollection());
  const onCustomerSelectRef = useRef(onCustomerSelect);
  const hasFittedBoundsRef = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState('');

  onCustomerSelectRef.current = onCustomerSelect;

  const sourceData = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: customers.map((customer) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [Number(customer.longitude), Number(customer.latitude)],
        },
        properties: {
          id: String(customer.id),
          visitStatus: customer.visitStatus,
          selected: String(customer.id) === String(selectedCustomerId),
        },
      })),
    }),
    [customers, selectedCustomerId],
  );

  sourceDataRef.current = sourceData;

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return undefined;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/standard-satellite',
      center: INITIAL_CENTER,
      zoom: 3.4,
      pitch: 42,
      bearing: -10,
      projection: 'globe',
      attributionControl: false,
    });

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      addOrUpdateCustomerLayer(map, sourceDataRef.current);
      setMapLoaded(true);
    });

    map.on('click', LAYER_ID, (event) => {
      const customerId = event.features?.[0]?.properties?.id;
      if (customerId) onCustomerSelectRef.current?.(customerId);
    });
    map.on('mouseenter', LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('error', (event) => {
      const message = String(event.error?.message || '');
      if (/access token|unauthorized|forbidden/i.test(message)) {
        setMapError('O token publico do Mapbox nao foi aceito para carregar o mapa.');
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    addOrUpdateCustomerLayer(map, sourceData);

    if (!hasFittedBoundsRef.current && customers.length > 0) {
      fitMapToCustomers(map, customers);
      hasFittedBoundsRef.current = true;
    }
  }, [customers, mapLoaded, sourceData]);

  if (!MAPBOX_TOKEN) {
    return <Alert severity="error">Configure VITE_MAPBOX_ACCESS_TOKEN para carregar o mapa de clientes.</Alert>;
  }

  return (
    <Box position="relative" height={{ xs: 420, lg: 590 }} borderRadius={1} overflow="hidden" bgcolor="#dbeafe">
      <Box ref={containerRef} width="100%" height="100%" />
      {!mapLoaded && !mapError && (
        <Box position="absolute" inset={0} display="grid" sx={{ placeItems: 'center', bgcolor: 'rgba(248, 250, 252, 0.74)' }}>
          <CircularProgress />
        </Box>
      )}
      {mapError && <Alert severity="error" sx={{ position: 'absolute', left: 16, right: 16, top: 16 }}>{mapError}</Alert>}
    </Box>
  );
}

function addOrUpdateCustomerLayer(map, sourceData) {
  const source = map.getSource(SOURCE_ID);
  if (source) {
    source.setData(sourceData);
    return;
  }

  map.addSource(SOURCE_ID, { type: 'geojson', data: sourceData });
  map.addLayer({
    id: LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-radius': ['case', ['get', 'selected'], 10, 7],
      'circle-color': [
        'match',
        ['get', 'visitStatus'],
        'visited', '#16a34a',
        'not_visited', '#dc2626',
        '#2563eb',
      ],
      'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.5],
      'circle-stroke-color': ['case', ['get', 'selected'], '#0f172a', '#ffffff'],
      'circle-opacity': 0.96,
    },
  });
}

function fitMapToCustomers(map, customers) {
  if (customers.length === 1) {
    map.flyTo({
      center: [Number(customers[0].longitude), Number(customers[0].latitude)],
      zoom: 13.5,
      pitch: 48,
      essential: true,
    });
    return;
  }

  const bounds = customers.reduce(
    (currentBounds, customer) => currentBounds.extend([Number(customer.longitude), Number(customer.latitude)]),
    new mapboxgl.LngLatBounds(),
  );
  map.fitBounds(bounds, { padding: 56, maxZoom: 12.5, duration: 0 });
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}
