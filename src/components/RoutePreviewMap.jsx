import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, CircularProgress, Typography, useTheme } from '@mui/material';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { minumTokens } from '../design/tokens';
import { customerPrimaryName } from '../utils/customerDisplay';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const ROUTE_SOURCE_ID = 'shared-route-preview';
const ROUTE_LAYER_ID = 'shared-route-preview-line';
const INITIAL_CENTER = [-54.8, -14.2];

/** Mostra os clientes numerados e a rota por ruas antes de atribui-la ao vendedor. */
export default function RoutePreviewMap({ customers, preview, isLoading }) {
  const theme = useTheme();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState('');

  const routeData = useMemo(() => ({
    type: 'FeatureCollection',
    features: preview?.geometry ? [{
      type: 'Feature',
      properties: {},
      geometry: preview.geometry,
    }] : [],
  }), [preview]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return undefined;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/standard',
      center: INITIAL_CENTER,
      zoom: 3.4,
      pitch: 35,
      bearing: -8,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: emptyFeatureCollection() });
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        paint: {
          'line-color': minumTokens.brand.primary,
          'line-width': 5,
          'line-opacity': 0.9,
        },
      });
      setMapLoaded(true);
    });
    map.on('error', (event) => {
      const message = String(event.error?.message || '');
      if (/access token|unauthorized|forbidden/i.test(message)) {
        setMapError('O token publico do Mapbox nao foi aceito para carregar o mapa.');
      }
    });

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const source = map.getSource(ROUTE_SOURCE_ID);
    source?.setData(routeData);
    updateMarkers(map, customers, markersRef);
    fitMapToCustomers(map, customers);
  }, [customers, mapLoaded, routeData]);

  if (!MAPBOX_TOKEN) {
    return <Alert severity="error">Configure VITE_MAPBOX_ACCESS_TOKEN para carregar a previa da rota.</Alert>;
  }

  return (
    <Box position="relative" height={{ xs: 340, md: 440 }} borderRadius={1} overflow="hidden" bgcolor="action.hover">
      <Box ref={containerRef} width="100%" height="100%" />
      {!mapLoaded && !mapError && (
        <Box position="absolute" inset={0} display="grid" sx={{ placeItems: 'center', bgcolor: theme.palette.background.default, opacity: 0.82 }}>
          <CircularProgress />
        </Box>
      )}
      {isLoading && mapLoaded && (
        <Box position="absolute" top={16} left={16} px={1.5} py={0.75} borderRadius={1} bgcolor={minumTokens.brand.primaryDark} color={minumTokens.text.inverse} display="flex" alignItems="center" gap={1}>
          <CircularProgress size={16} color="inherit" />
          <Typography variant="caption">Calculando percurso por ruas...</Typography>
        </Box>
      )}
      {!isLoading && customers.length > 1 && !preview?.geometry && mapLoaded && (
        <Box position="absolute" left={16} bottom={16} px={1.5} py={0.75} borderRadius={1} bgcolor="background.paper">
          <Typography variant="caption">Use &quot;Atualizar mapa&quot; para desenhar o trajeto real.</Typography>
        </Box>
      )}
      {mapError && <Alert severity="error" sx={{ position: 'absolute', left: 16, right: 16, top: 16 }}>{mapError}</Alert>}
    </Box>
  );
}

function updateMarkers(map, customers, markersRef) {
  markersRef.current.forEach((marker) => marker.remove());
  markersRef.current = customers.map((customer, index) => {
    const markerElement = document.createElement('button');
    markerElement.type = 'button';
    markerElement.textContent = String(index + 1);
    markerElement.title = customerPrimaryName(customer, `Parada ${index + 1}`);
    markerElement.style.cssText = [
      'width:30px',
      'height:30px',
      'border-radius:50%',
      `border:3px solid ${minumTokens.text.inverse}`,
      `box-shadow:${minumTokens.shadow.low}`,
      `color:${minumTokens.text.inverse}`,
      'font-weight:700',
      'font-size:13px',
      'cursor:default',
      `background:${markerColor(index, customers.length)}`,
    ].join(';');
    return new mapboxgl.Marker({ element: markerElement, anchor: 'center' })
      .setLngLat([Number(customer.longitude), Number(customer.latitude)])
      .addTo(map);
  });
}

function markerColor(index, count) {
  if (index === 0) return minumTokens.feedback.success;
  if (index === count - 1) return minumTokens.feedback.error;
  return minumTokens.brand.primary;
}

function fitMapToCustomers(map, customers) {
  if (customers.length === 0) return;
  if (customers.length === 1) {
    map.flyTo({
      center: [Number(customers[0].longitude), Number(customers[0].latitude)],
      zoom: 13.5,
      pitch: 44,
      essential: true,
    });
    return;
  }

  const bounds = customers.reduce(
    (currentBounds, customer) => currentBounds.extend([Number(customer.longitude), Number(customer.latitude)]),
    new mapboxgl.LngLatBounds(),
  );
  map.fitBounds(bounds, { padding: 72, maxZoom: 13, duration: 550 });
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}
