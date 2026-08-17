import { Grid, MenuItem, TextField } from '@mui/material';

export default function CustomerFilters({ filters, onChange, segments, states, statuses }) {
  function setField(field, value) {
    onChange({ ...filters, [field]: value });
  }

  return (
    <Grid container spacing={2} mb={2}>
      <Grid item xs={12} md={3}>
        <TextField fullWidth label="Nome" value={filters.name} onChange={(event) => setField('name', event.target.value)} />
      </Grid>
      <Grid item xs={12} md={3}>
        <TextField fullWidth label="Cidade" value={filters.city} onChange={(event) => setField('city', event.target.value)} />
      </Grid>
      <Grid item xs={12} sm={6} md={2}>
        <TextField fullWidth select label="UF" value={filters.state} onChange={(event) => setField('state', event.target.value)}>
          <MenuItem value="">Todos</MenuItem>
          {states.map((state) => (
            <MenuItem key={state} value={state}>
              {state}
            </MenuItem>
          ))}
        </TextField>
      </Grid>
      <Grid item xs={12} sm={6} md={2}>
        <TextField fullWidth select label="Segmento" value={filters.segment} onChange={(event) => setField('segment', event.target.value)}>
          <MenuItem value="">Todos</MenuItem>
          {segments.map((segment) => (
            <MenuItem key={segment} value={segment}>
              {segment}
            </MenuItem>
          ))}
        </TextField>
      </Grid>
      <Grid item xs={12} md={2}>
        <TextField fullWidth select label="Status" value={filters.status} onChange={(event) => setField('status', event.target.value)}>
          <MenuItem value="">Todos</MenuItem>
          {statuses.map((status) => (
            <MenuItem key={status} value={status}>
              {status}
            </MenuItem>
          ))}
        </TextField>
      </Grid>
    </Grid>
  );
}
