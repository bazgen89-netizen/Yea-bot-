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
  arrowBack: (p: Props) => <Ionicons name="arrow-back" size={p.size ?? 24} color={p.color} />,
};

/**
 * Иконки строк меню. Отдельный набор, потому что там своя логика: контурный
 * значок слева, одного размера у всех строк, и подбирается он по смыслу пункта.
 */
export const MenuIcon = {
  gear: (p: Props) => (
    <Ionicons name="settings-outline" size={p.size ?? 23} color={p.color ?? colors.primaryText} />
  ),
  company: (p: Props) => <Ionicons name="business-outline" size={p.size ?? 22} color={p.color} />,
  loyalty: (p: Props) => <Ionicons name="heart-outline" size={p.size ?? 22} color={p.color} />,
  billing: (p: Props) => <Ionicons name="card-outline" size={p.size ?? 22} color={p.color} />,

  customers: (p: Props) => <Ionicons name="people-outline" size={p.size ?? 22} color={p.color} />,
  suppliers: (p: Props) => (
    <MaterialCommunityIcons name="truck-outline" size={p.size ?? 22} color={p.color} />
  ),
  shops: (p: Props) => (
    <MaterialCommunityIcons name="storefront-outline" size={p.size ?? 22} color={p.color} />
  ),
  accounts: (p: Props) => <Ionicons name="wallet-outline" size={p.size ?? 22} color={p.color} />,
  staff: (p: Props) => (
    <MaterialCommunityIcons name="account-tie-outline" size={p.size ?? 22} color={p.color} />
  ),
  trash: (p: Props) => <Ionicons name="trash-outline" size={p.size ?? 22} color={p.color} />,

  register: (p: Props) => (
    <MaterialCommunityIcons name="cash-register" size={p.size ?? 22} color={p.color} />
  ),
  shifts: (p: Props) => <Ionicons name="time-outline" size={p.size ?? 22} color={p.color} />,
  money: (p: Props) => (
    <MaterialCommunityIcons name="cash-multiple" size={p.size ?? 22} color={p.color} />
  ),

  question: (p: Props) => (
    <Ionicons name="chatbubble-ellipses-outline" size={p.size ?? 22} color={p.color} />
  ),
  knowledge: (p: Props) => <Ionicons name="book-outline" size={p.size ?? 22} color={p.color} />,
  privacy: (p: Props) => (
    <Ionicons name="shield-checkmark-outline" size={p.size ?? 22} color={p.color} />
  ),
  license: (p: Props) => <Ionicons name="document-text-outline" size={p.size ?? 22} color={p.color} />,

  /** Стрелка «откроется снаружи» у ссылок на сайт. */
  external: (p: Props) => (
    <Ionicons name="open-outline" size={p.size ?? 17} color={p.color ?? colors.textMuted} />
  ),

  call: (p: Props) => <Ionicons name="call-outline" size={p.size ?? 20} color={p.color} />,
  person: (p: Props) => (
    <Ionicons name="person-circle-outline" size={p.size ?? 22} color={p.color} />
  ),
};

/**
 * Иконки бокового меню веб-кабинета. Отдельный набор: там свой размер
 * и свой смысл у пунктов, которых в телефоне нет вовсе.
 */
export const WebIcon = {
  home: (p: Props) => <MaterialCommunityIcons name="view-grid" size={p.size ?? 21} color={p.color} />,
  products: (p: Props) => (
    <MaterialCommunityIcons name="cube-outline" size={p.size ?? 21} color={p.color} />
  ),
  registers: (p: Props) => (
    <MaterialCommunityIcons name="inbox" size={p.size ?? 21} color={p.color} />
  ),
  goods: (p: Props) => <Ionicons name="refresh" size={p.size ?? 22} color={p.color} />,
  money: (p: Props) => (
    <MaterialCommunityIcons name="currency-usd" size={p.size ?? 21} color={p.color} />
  ),
  reports: (p: Props) => (
    <MaterialCommunityIcons name="chart-areaspline" size={p.size ?? 21} color={p.color} />
  ),
  parties: (p: Props) => <Ionicons name="person" size={p.size ?? 20} color={p.color} />,
  company: (p: Props) => <Ionicons name="people" size={p.size ?? 21} color={p.color} />,
  storefront: (p: Props) => <Ionicons name="globe-outline" size={p.size ?? 21} color={p.color} />,
  integrations: (p: Props) => <Ionicons name="attach" size={p.size ?? 21} color={p.color} />,
  lab: (p: Props) => <MaterialCommunityIcons name="flask" size={p.size ?? 21} color={p.color} />,
  billing: (p: Props) => (
    <MaterialCommunityIcons name="credit-card-outline" size={p.size ?? 21} color={p.color} />
  ),
  trash: (p: Props) => <Ionicons name="trash-outline" size={p.size ?? 20} color={p.color} />,
  download: (p: Props) => (
    <Ionicons name="arrow-down-circle" size={p.size ?? 18} color={p.color} />
  ),

  whatsNew: (p: Props) => (
    <Ionicons name="newspaper-outline" size={p.size ?? 21} color={p.color} />
  ),
  help: (p: Props) => <Ionicons name="help-circle-outline" size={p.size ?? 21} color={p.color} />,
  suggest: (p: Props) => <Ionicons name="bulb-outline" size={p.size ?? 21} color={p.color} />,
  partners: (p: Props) => (
    <MaterialCommunityIcons name="handshake-outline" size={p.size ?? 21} color={p.color} />
  ),

  /** Нижний ряд бокового меню. */
  rocket: (p: Props) => <Ionicons name="rocket-outline" size={p.size ?? 20} color={p.color} />,
  android: (p: Props) => <Ionicons name="logo-android" size={p.size ?? 20} color={p.color} />,
  apple: (p: Props) => <Ionicons name="logo-apple" size={p.size ?? 20} color={p.color} />,

  /** Значки в шапке. */
  language: (p: Props) => <Ionicons name="globe-outline" size={p.size ?? 22} color={p.color} />,
  barcode: (p: Props) => (
    <MaterialCommunityIcons name="barcode" size={p.size ?? 24} color={p.color} />
  ),
  calendar: (p: Props) => <Ionicons name="calendar-outline" size={p.size ?? 22} color={p.color} />,
  // В исходном кабинете это «alarm outline», а не колокольчик уведомлений.
  bell: (p: Props) => <Ionicons name="alarm-outline" size={p.size ?? 22} color={p.color} />,

  chevronDown: (p: Props) => <Ionicons name="chevron-down" size={p.size ?? 16} color={p.color} />,
  chevronUp: (p: Props) => <Ionicons name="chevron-up" size={p.size ?? 16} color={p.color} />,
  chevronLeft: (p: Props) => <Ionicons name="chevron-back" size={p.size ?? 18} color={p.color} />,
  chevronRight: (p: Props) => (
    <Ionicons name="chevron-forward" size={p.size ?? 18} color={p.color} />
  ),

  /** Кнопки над таблицами. */
  funnel: (p: Props) => <Ionicons name="funnel-outline" size={p.size ?? 17} color={p.color} />,
  excel: (p: Props) => (
    <MaterialCommunityIcons name="file-excel-outline" size={p.size ?? 18} color={p.color} />
  ),
  folderPlus: (p: Props) => (
    <MaterialCommunityIcons name="folder-plus-outline" size={p.size ?? 20} color={p.color} />
  ),
  folder: (p: Props) => <Ionicons name="folder" size={p.size ?? 22} color={p.color ?? '#5B9BD5'} />,
  pencil: (p: Props) => <Ionicons name="pencil" size={p.size ?? 16} color={p.color} />,
  gear: (p: Props) => <Ionicons name="settings-sharp" size={p.size ?? 20} color={p.color} />,
  // Замок кассы — контурный, как у неё: закрытый, пока смена закрыта, и
  // открывающийся под курсором на кнопке «Открыть смену».
  lockOpen: (p: Props) => (
    <MaterialCommunityIcons name="lock-open-variant-outline" size={p.size ?? 20} color={p.color} />
  ),
  lockClosed: (p: Props) => (
    <MaterialCommunityIcons name="lock-outline" size={p.size ?? 20} color={p.color} />
  ),

  /**
   * Значки меню кассы — те же, что в кассирском приложении.
   *
   * Названия там материальные: Logout, Loop, HighlightOff, ReceiptLong,
   * CalendarMonth. Здесь — их пары из наборов, которые в проекте уже есть.
   */
  logout: (p: Props) => (
    <MaterialCommunityIcons name="logout" size={p.size ?? 22} color={p.color} />
  ),
  loop: (p: Props) => <MaterialCommunityIcons name="sync" size={p.size ?? 22} color={p.color} />,
  closeCircle: (p: Props) => (
    <MaterialCommunityIcons name="close-circle-outline" size={p.size ?? 22} color={p.color} />
  ),
  receiptLong: (p: Props) => (
    <MaterialCommunityIcons name="receipt-text-outline" size={p.size ?? 22} color={p.color} />
  ),
  /** Бонусы покупателя — стопка монет, как у него в поиске клиентов. */
  coins: (p: Props) => (
    <MaterialCommunityIcons name="database" size={p.size ?? 18} color={p.color} />
  ),
  phone: (p: Props) => (
    <MaterialCommunityIcons name="phone-outline" size={p.size ?? 20} color={p.color} />
  ),
  /** «Добавить покупателя» — человечек с плюсом, оранжевая кнопка кассы. */
  personPlus: (p: Props) => (
    <MaterialCommunityIcons name="account-plus" size={p.size ?? 22} color={p.color} />
  ),
  printer: (p: Props) => (
    <MaterialCommunityIcons name="printer-outline" size={p.size ?? 20} color={p.color} />
  ),
  handshake: (p: Props) => (
    <MaterialCommunityIcons name="handshake-outline" size={p.size ?? 22} color={p.color} />
  ),
  done: (p: Props) => <Ionicons name="checkmark" size={p.size ?? 19} color={p.color} />,
  comment: (p: Props) => (
    <MaterialCommunityIcons name="comment" size={p.size ?? 17} color={p.color ?? '#9AA0A6'} />
  ),
  percent: (p: Props) => (
    <MaterialCommunityIcons name="percent" size={p.size ?? 15} color={p.color} />
  ),

  /** Формы: снять категорию, убрать упаковку, пояснение под полем. */
  close: (p: Props) => <Ionicons name="close" size={p.size ?? 16} color={p.color} />,
  info: (p: Props) => (
    <Ionicons name="information-circle-outline" size={p.size ?? 18} color={p.color} />
  ),
  search: (p: Props) => <Ionicons name="search" size={p.size ?? 16} color={p.color} />,
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
