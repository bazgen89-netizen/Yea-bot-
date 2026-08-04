import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ColorValue } from 'react-native';

import { colors } from './theme';

/**
 * Иконки собраны в одном месте: на экранах указывается назначение
 * («магазин», «сканер»), а не название глифа из конкретного набора.
 * Поменять набор потом можно здесь, не трогая экраны.
 */

// Навигация отдаёт цвет вкладки как ColorValue, а не строкой — принимаем оба.
type Props = { size?: number; color?: ColorValue };

export const Icon = {
  home: (p: Props & { filled?: boolean }) => (
    <Ionicons name={p.filled ? 'home' : 'home-outline'} size={p.size ?? 24} color={p.color} />
  ),
  catalog: (p: Props & { filled?: boolean }) => (
    <MaterialCommunityIcons
      name={p.filled ? 'archive' : 'archive-outline'}
      size={p.size ?? 24}
      color={p.color}
    />
  ),
  journal: (p: Props) => (
    <Ionicons name="document-text-outline" size={p.size ?? 24} color={p.color} />
  ),
  menu: (p: Props) => <Ionicons name="menu" size={p.size ?? 26} color={p.color} />,
  plus: (p: Props) => <Ionicons name="add" size={p.size ?? 32} color={p.color} />,

  store: (p: Props) => (
    <MaterialCommunityIcons name="storefront-outline" size={p.size ?? 26} color={p.color} />
  ),
  bell: (p: Props) => <Ionicons name="notifications-outline" size={p.size ?? 24} color={p.color} />,
  filter: (p: Props) => <Ionicons name="funnel-outline" size={p.size ?? 22} color={p.color} />,
  scan: (p: Props) => (
    <MaterialCommunityIcons name="barcode-scan" size={p.size ?? 22} color={p.color} />
  ),
  more: (p: Props) => (
    <Ionicons name="ellipsis-vertical" size={p.size ?? 20} color={p.color ?? colors.textMuted} />
  ),
  search: (p: Props) => (
    <Ionicons name="search" size={p.size ?? 22} color={p.color ?? colors.textMuted} />
  ),
  mic: (p: Props) => (
    <Ionicons name="mic-outline" size={p.size ?? 22} color={p.color ?? colors.textMuted} />
  ),
  info: (p: Props) => (
    <Ionicons name="information-circle" size={p.size ?? 22} color={p.color ?? '#8A8F98'} />
  ),
  chevron: (p: Props) => (
    <Ionicons name="chevron-forward" size={p.size ?? 20} color={p.color ?? colors.textMuted} />
  ),
  reorder: (p: Props) => (
    <Ionicons name="swap-vertical" size={p.size ?? 20} color={p.color ?? colors.accent} />
  ),
  refresh: (p: Props) => (
    <Ionicons name="refresh" size={p.size ?? 22} color={p.color ?? colors.textMuted} />
  ),
  barcode: (p: Props) => (
    <MaterialCommunityIcons name="barcode" size={p.size ?? 14} color={p.color ?? colors.textMuted} />
  ),
  asterisk: (p: Props) => (
    <Ionicons name="pricetag-outline" size={p.size ?? 13} color={p.color ?? colors.textMuted} />
  ),
  box: (p: Props) => (
    <MaterialCommunityIcons name="package-variant" size={p.size ?? 22} color={p.color} />
  ),
  check: (p: Props) => <Ionicons name="checkmark" size={p.size ?? 20} color={p.color} />,
};

/** Иконки плиток отчётов на главной. */
export const ReportIcon = {
  daily: (p: Props) => <Ionicons name="calendar" size={22} color={p.color} />,
  products: (p: Props) => <MaterialCommunityIcons name="cube-outline" size={22} color={p.color} />,
  customers: (p: Props) => <Ionicons name="people" size={22} color={p.color} />,
  moves: (p: Props) => <Ionicons name="swap-horizontal" size={22} color={p.color} />,
  staff: (p: Props) => <Ionicons name="person" size={22} color={p.color} />,
  finance: (p: Props) => (
    <MaterialCommunityIcons name="currency-usd" size={22} color={p.color} />
  ),
};
