import { Tooltip } from '@mui/material';

const sizes = { sm: 16, md: 20, lg: 24, xl: 32 };

/** Mantem os icones operacionais na mesma escala e linguagem linear da Minum. */
export default function MinumIcon({ icon: Icon, size = 'md', label, sx }) {
  const graphic = <Icon aria-hidden={!label} sx={{ fontSize: sizes[size] || sizes.md, ...sx }} />;
  return label ? <Tooltip title={label}><span>{graphic}</span></Tooltip> : graphic;
}
