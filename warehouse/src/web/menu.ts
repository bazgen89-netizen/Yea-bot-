import type { Href } from 'expo-router';

import type { WebIcon } from '../ui/icons';

/**
 * Боковое меню кабинета: состав и порядок в точности как в привычном
 * пользователю приложении. Порядок держим здесь, а не раскидываем по экранам,
 * чтобы его нельзя было нечаянно поменять правкой одного пункта.
 */

export interface MenuChild {
  label: string;
  href?: Href;
  /** «Скачать программу» — синяя строка со значком загрузки. */
  accent?: boolean;
  soon?: boolean;
}

export interface MenuEntry {
  label: string;
  icon: keyof typeof WebIcon;
  href?: Href;
  children?: MenuChild[];
  /** Приглушённый пункт — «Корзина». */
  dim?: boolean;
  soon?: boolean;
}

export const MENU: MenuEntry[] = [
  { label: 'Главная', icon: 'home', href: '/' },
  { label: 'Товары и услуги', icon: 'products', href: '/catalog' },
  {
    label: 'Кассы и смены',
    icon: 'registers',
    children: [
      { label: 'Смены', soon: true },
      { label: 'Кассы', soon: true },
      { label: 'Скачать программу', accent: true, soon: true },
    ],
  },
  { label: 'Движение товара', icon: 'goods', href: '/journal' },
  { label: 'Движение денег', icon: 'money', soon: true },
  { label: 'Отчеты', icon: 'reports', href: '/reports' },
  {
    label: 'Контрагенты',
    icon: 'parties',
    children: [
      { label: 'Поставщики', href: { pathname: '/counterparties', params: { kind: 'supplier' } } },
      { label: 'Клиенты', href: { pathname: '/counterparties', params: { kind: 'customer' } } },
    ],
  },
  {
    label: 'Компания',
    icon: 'company',
    children: [
      { label: 'Настройки', soon: true },
      { label: 'Сотрудники', soon: true },
      { label: 'Магазины', soon: true },
      { label: 'Счета', soon: true },
      { label: 'Лояльность', soon: true },
      { label: 'Печатные формы', soon: true },
      { label: 'Интернет-витрина', soon: true },
    ],
  },
  { label: 'Интернет-витрина', icon: 'storefront', soon: true },
  { label: 'Интеграции', icon: 'integrations', soon: true },
  { label: 'Лаборатория', icon: 'lab', soon: true },
  { label: 'Тарифы и оплата', icon: 'billing', soon: true },
  { label: 'Корзина', icon: 'trash', dim: true, soon: true },
];

/** Нижняя часть меню — она отделена от разделов и не прокручивается вместе с ними. */
export const MENU_FOOTER: MenuEntry[] = [
  { label: 'Что нового', icon: 'whatsNew', soon: true },
  { label: 'База знаний', icon: 'help', soon: true },
  { label: 'Предложения', icon: 'suggest', soon: true },
];

/** Заголовок в шапке для текущего адреса. */
export function titleFor(pathname: string, kind?: string): string {
  if (pathname.startsWith('/catalog')) return 'Товары и услуги / справочник';
  if (pathname.startsWith('/journal')) return 'Движение товара';
  if (pathname.startsWith('/money')) return 'Движение денег';
  if (pathname.startsWith('/reports')) return 'Отчеты';
  if (pathname.startsWith('/shifts')) return 'Кассовый раздел / смены';
  if (pathname.startsWith('/company')) return 'Настройки / настройки компании';
  if (pathname.startsWith('/counterparties')) {
    return kind === 'supplier' ? 'Поставщики' : 'Клиенты';
  }
  if (pathname.startsWith('/counterparty')) return 'Карточка контрагента';
  if (pathname.startsWith('/product')) return 'Товары и услуги / карточка';
  return 'Главная';
}
