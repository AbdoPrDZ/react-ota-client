/**
 * Shared style tokens. Every component accepts a `style` / `textStyle`
 * override, so these are only defaults — override anything you do not like.
 */
export const otaColors = {
  background: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.72)',
  card: '#FFFFFF',
  title: '#111827',
  body: '#4B5563',
  muted: '#9CA3AF',
  primary: '#2563EB',
  primaryText: '#FFFFFF',
  secondary: '#E5E7EB',
  secondaryText: '#111827',
  danger: '#DC2626',
  track: '#E5E7EB',
} as const;

export const otaSpacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const otaRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;
