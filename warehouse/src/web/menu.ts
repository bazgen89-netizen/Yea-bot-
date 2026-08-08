import type { Href } from 'expo-router';

import type { WebIcon } from '../ui/icons';

/**
 * Боковое меню кабинета: состав и порядок в точности как в привычном
 * пользователю приложении. Порядок держим здесь, а не раскидываем по экранам,
 * чтобы его нельзя было нечаянно поменять правкой одного пункта.
 *
 * Каждый пункт куда-то ведёт. Разделы, экраны которых ещё не собраны,
 * открывают страницу с правильным заголовком и рассказом, что в ней будет:
 * нажатие, после которого ничего не происходит, читается как поломка.
 */

export interface MenuChild {
  label: string;
  href: Href;
  /** «Скачать программу» — синяя строка со значком загрузки. */
  accent?: boolean;
}

export interface MenuEntry {
  label: string;
  icon: keyof typeof WebIcon;
  href?: Href;
  children?: MenuChild[];
  /** Приглушённый пункт — «Корзина». */
  dim?: boolean;
}

export const MENU: MenuEntry[] = [
  { label: 'Главная', icon: 'home', href: '/' },
  { label: 'Товары и услуги', icon: 'products', href: '/catalog' },
  {
    label: 'Кассы и смены',
    icon: 'registers',
    children: [
      { label: 'Смены', href: '/shifts' },
      { label: 'Кассы', href: '/registers' },
      { label: 'Скачать программу', href: '/billing', accent: true },
    ],
  },
  { label: 'Движение товара', icon: 'goods', href: '/journal' },
  { label: 'Движение денег', icon: 'money', href: '/money' },
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
      { label: 'Настройки', href: '/company' },
      { label: 'Сотрудники', href: '/staff' },
      { label: 'Магазины', href: '/stores' },
      { label: 'Счета', href: '/accounts' },
      { label: 'Лояльность', href: '/loyalty' },
      { label: 'Печатные формы', href: '/print-forms' },
      { label: 'Интернет-витрина', href: '/storefront' },
    ],
  },
  { label: 'Интернет-витрина', icon: 'storefront', href: '/storefront' },
  { label: 'Интеграции', icon: 'integrations', href: '/integrations' },
  { label: 'Лаборатория', icon: 'lab', href: '/lab' },
  { label: 'Тарифы и оплата', icon: 'billing', href: '/billing' },
  { label: 'Корзина', icon: 'trash', href: '/trash', dim: true },
];

/** Нижняя часть меню — она отделена от разделов и не прокручивается вместе с ними. */
export const MENU_FOOTER: MenuEntry[] = [
  { label: 'Что нового', icon: 'whatsNew', href: '/lab' },
  { label: 'База знаний', icon: 'help', href: '/lab' },
  { label: 'Предложения', icon: 'suggest', href: '/lab' },
  { label: 'Партнерская программа', icon: 'partners', href: '/partners' },
];

/** Название документа в заголовке — то же, что на кнопке в списке создания. */
const DOC_TITLE: Record<string, string> = {
  purchase: 'Закупка',
  purchase_return: 'Возврат закупки',
  stock_in: 'Оприходование',
  writeoff: 'Списание',
  transfer: 'Перемещение',
  income: 'Приход',
  expense: 'Расход',
  transfer_money: 'Перевод',
};

/**
 * Заголовок в шапке для текущего адреса.
 *
 * `kind` — параметр адреса: он же различает клиентов и поставщиков на одном
 * экране контрагентов, и вид документа на одном экране создания.
 */
export function titleFor(pathname: string, kind?: string, type?: string): string {
  // Раньше остальных: путь создания документа начинается с «/money» и без
  // этой проверки читался бы как журнал движения денег.
  if (pathname.startsWith('/money/new')) {
    const label = DOC_TITLE[type === 'transfer' ? 'transfer_money' : (type ?? 'income')];
    return `Движение денег / ${label ?? 'создание'}`;
  }
  if (pathname.startsWith('/doc')) {
    return `Движение товара / ${DOC_TITLE[kind ?? 'purchase'] ?? 'создание'}`;
  }
  if (pathname.startsWith('/new')) return 'Создать документ';
  if (pathname.startsWith('/sale/new')) return 'Продажа';

  if (pathname.startsWith('/catalog')) return 'Товары и услуги / справочник';
  if (pathname.startsWith('/journal')) return 'Движение товара';
  if (pathname.startsWith('/money')) return 'Движение денег';
  if (pathname.startsWith('/reports')) return 'Отчеты';
  if (pathname.startsWith('/shifts')) return 'Кассовый раздел / смены';
  if (pathname.startsWith('/registers')) return 'Кассовый раздел / кассы';
  if (pathname.startsWith('/company')) return 'Настройки / настройки компании';
  if (pathname.startsWith('/staff')) return 'Компания / сотрудники';
  if (pathname.startsWith('/stores')) return 'Компания / магазины';
  if (pathname.startsWith('/accounts')) return 'Компания / счета';
  if (pathname.startsWith('/loyalty')) return 'Компания / лояльность';
  if (pathname.startsWith('/print-forms')) return 'Компания / печатные формы';
  if (pathname.startsWith('/storefront')) return 'Интернет-витрина';
  if (pathname.startsWith('/integrations')) return 'Интеграции';
  if (pathname.startsWith('/lab')) return 'Лаборатория';
  if (pathname.startsWith('/billing')) return 'Тарифы и оплата';
  if (pathname.startsWith('/trash')) return 'Корзина';
  if (pathname.startsWith('/partners')) return 'Партнерская программа';
  if (pathname.startsWith('/cashier')) return 'Интерфейс кассира';
  if (pathname.startsWith('/counterparties')) {
    return kind === 'supplier' ? 'Поставщики' : 'Клиенты';
  }
  if (pathname.startsWith('/counterparty')) return 'Карточка контрагента';
  if (pathname.startsWith('/product')) return 'Товары и услуги / карточка';
  return 'Главная';
}
