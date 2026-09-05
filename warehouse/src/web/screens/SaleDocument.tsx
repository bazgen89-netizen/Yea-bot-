import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Drawer } from '../Drawer';
import { Text, TextInput } from '../Translated';
import { getSale, refundSale, updateSale } from '../../db/sales';
import { SALE_ACCOUNT } from '../../db/money';
import { MoneyDocumentDrawer } from './MoneyDocument';
import { PartyCard } from './PartyCard';
import { ProductCard } from './ProductCard';
import { formatMoneyWeb, parseMoney } from '../../domain/money';
import { formatQty, parseQty } from '../../domain/qty';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { saveFile } from '../../ui/download';
import { WebIcon } from '../../ui/icons';
import { FORM_BORDER, web, WEB_FONT } from '../../ui/webTheme';

/**
 * Просмотр чека — как у него страница документа.
 *
 * Шапка отвечает на «что это и чьё»: магазин, клиент, автор, касса, смена
 * слева; скидка, сумма, оплачено, налог справа. Ниже — чем платили и что
 * купили, двумя таблицами.
 *
 * Раньше здесь была карточка телефона: номер, дата, список строк. На широком
 * экране она отвечала на четверть вопросов — ни магазина, ни автора, ни того,
 * какой скидкой сложилась цена.
 */
export function SaleDocument({ id }: { id: Id }) {
  const router = useRouter();

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/journal');
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Body id={id} onClose={back} />
    </ScrollView>
  );
}

/**
 * Тот же документ, но панелью поверх журнала — как открывается у него.
 *
 * Он кликает документ в «Движении товара», и журнал остаётся слева: закрыл
 * панель — и ты там же, где был, не надо заново искать строку. У нас документ
 * открывался отдельной страницей, и журнал уезжал целиком.
 */
export function SaleDocumentDrawer({ id, onClose }: { id: Id; onClose: () => void }) {
  return (
    <Drawer visible size="xl" onClose={onClose} actions={<Actions id={id} onClose={onClose} />}>
      <View style={styles.content}>
        <Body id={id} onClose={onClose} bare />
      </View>
    </Drawer>
  );
}

/**
 * Кнопки полосы действий — его набор.
 *
 * Правка, печать и выгрузка приглушены: правка проведённого чека, печать
 * чека и выгрузка документа файлом ещё не сделаны, и кнопка, которая делает
 * вид, что работает, хуже приглушённой. Возврат — работает.
 */
function Actions({ id, onClose }: { id: Id; onClose: () => void }) {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const sale = useQuery((database) => getSale(database, id), [id]);

  function askRefund() {
    confirm(
      'Оформить возврат?',
      'Товар вернётся на склад, а чек перестанет учитываться в выручке.',
      'Вернуть',
      () => {
        try {
          refundSale(db, id);
          refresh();
          onClose();
        } catch (error) {
          say('Не удалось оформить возврат', String(error));
        }
      },
    );
  }

  function print() {
    // Печать документа — то же окно печати браузера, что и у него: там
    // «Напечатать» открывает системный диалог, а не свой.
    if (typeof globalThis.print === 'function') globalThis.print();
  }

  function download() {
    if (!sale) return;

    const rows = [
      ['Наименование', 'Штрих-код', 'Артикул', 'Количество', 'Цена', 'Скидка', 'Итог'],
      ...sale.items.map((item) => {
        const sum = Math.round((item.qty * item.price) / 1000);
        return [
          item.name,
          item.barcode ?? '',
          item.sku ?? '',
          formatQty(item.qty),
          formatMoneyWeb(item.price),
          formatMoneyWeb(item.discount ?? 0),
          formatMoneyWeb(sum - (item.discount ?? 0)),
        ];
      }),
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\n');

    void saveFile(
      `Продажа ${sale.number ?? sale.id}.csv`,
      `\uFEFF${csv}`,
      'text/csv;charset=utf-8',
    );
  }

  return (
    <>
      {/* Правка — отдельной страницей, как у него: `card/doc/show/<id>`,
          «Документы / редактирование документа». Внутри просмотра её делать
          нельзя: там другой экран целиком. */}
      <Tool
        label="Редактировать"
        tone="green"
        onPress={() => {
          onClose();
          router.push({ pathname: '/sale/edit/[id]', params: { id: String(id) } });
        }}
      />
      <Tool
        label="Напечатать"
        icon={<WebIcon.printer size={17} color={web.text} />}
        onPress={print}
      />
      <Tool
        label="Выгрузить"
        icon={<WebIcon.download size={17} color={web.text} />}
        onPress={download}
      />
      <Tool
        label={sale?.refunded ? 'Возврат оформлен' : 'Возврат'}
        icon={<WebIcon.history size={17} color={sale?.refunded ? web.textMuted : web.text} />}
        soon={Boolean(sale?.refunded)}
        onPress={askRefund}
      />
      <Tool label="Удалить" tone="dangerOutline" right onPress={askRefund} />
    </>
  );
}

function Tool({
  label,
  icon,
  tone = 'plain',
  soon,
  right,
  onPress,
}: {
  label: string;
  icon?: React.ReactNode;
  tone?: 'plain' | 'green' | 'dangerOutline';
  /** Ещё не сделано: кнопка видна, но приглушена и не нажимается. */
  soon?: boolean;
  right?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: soon }}
      disabled={soon || !onPress}
      onPress={onPress}
      style={[
        styles.tool,
        tone === 'green' && styles.toolGreen,
        tone === 'dangerOutline' && styles.toolDanger,
        right && styles.toolRight,
        soon && styles.toolSoon,
      ]}
    >
      {icon}
      {/* У кнопок с одним значком подписи в кабинете нет — она нужна тем,
          кто слушает экран, поэтому остаётся невидимой подписью. */}
      {icon ? null : (
        <Text
          style={[
            styles.toolLabel,
            tone === 'green' && styles.toolLabelGreen,
            tone === 'dangerOutline' && styles.toolLabelDanger,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function Body({
  id,
  onClose,
  bare,
  editing,
  onSaved,
}: {
  id: Id;
  onClose: () => void;
  bare?: boolean;
  /** Открыт режим правки: количества и цены строк можно менять. */
  editing?: boolean;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const sale = useQuery((database) => getSale(database, id), [id]);
  const [search, setSearch] = useState('');

  /**
   * Правка строк.
   *
   * Держится отдельно от чека: пока не нажали «Сохранить», в базе ничего не
   * меняется. Ключ строки — её идентификатор, значение — что набрали в поле.
   */
  const [edits, setEdits] = useState<Record<number, { qty?: string; price?: string }>>({});
  const [dropped, setDropped] = useState<number[]>([]);

  /**
   * Что открыто поверх документа.
   *
   * Он сказал прямо: «кликаю на продажу, дальше всё внутри должно быть
   * кликабельно, например на контрагента кликаешь — его карточка должна
   * открыться». У него так и есть: адрес становится
   * `card/journal/m/clients/show/…`, карточка ложится панелью **поверх**
   * документа, а слева стрелка «назад». Я уводил из документа на список
   * контрагентов — документ при этом закрывался.
   */
  const [partyOpen, setPartyOpen] = useState<Id | null>(null);
  const [productOpen, setProductOpen] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);

  if (!sale) return <Text style={styles.empty}>Документ не найден</Text>;

  const subtotal = sale.items.reduce(
    (sum, item) => sum + Math.round((item.qty * item.price) / 1000),
    0,
  );
  // Скидка в процентах от того, что было до неё: у него в шапке стоит и
  // процент, и рубли — «17% (170.10 руб)».
  // Процент целым числом: у него в шапке «11% (31.50 руб)», а не «11.2%».
  const percent = subtotal ? Math.round((sale.discount / subtotal) * 100) : 0;
  const account = SALE_ACCOUNT[sale.payment] ?? 'Касса магазина';
  const quantity = sale.items.reduce((sum, item) => sum + item.qty, 0);

  function askRefund() {
    confirm(
      'Оформить возврат?',
      'Товар вернётся на склад, а чек перестанет учитываться в выручке.',
      'Вернуть',
      () => {
        try {
          refundSale(db, id);
          refresh();
        } catch (error) {
          say('Не удалось оформить возврат', String(error));
        }
      },
    );
  }

  /** Сохранить правку: пересобрать строки и переписать движения склада. */
  function save() {
    if (!sale) return;

    const lines = sale.items
      .filter((item) => !dropped.includes(item.id))
      .map((item) => {
        const edit = edits[item.id] ?? {};
        return {
          product_id: item.product_id,
          name: item.name,
          unit: item.unit,
          qty: edit.qty != null ? (parseQty(edit.qty) ?? item.qty) : item.qty,
          price: edit.price != null ? (parseMoney(edit.price) ?? item.price) : item.price,
          cost_price: item.cost_price,
          // Скидка строки сохраняется как есть: у перенесённых чеков она
          // задана суммой, и пересчёт по проценту обнулил бы её.
          discount: item.discount ?? 0,
          stock: 0,
        };
      })
      .filter((line) => line.qty > 0);

    if (lines.length === 0) {
      say('Пустой чек', 'В чеке должна остаться хотя бы одна строка.');
      return;
    }

    try {
      updateSale(db, id, { lines, discount: sale.discount, customerId: sale.customer_id });
      refresh();
      setEdits({});
      setDropped([]);
      onSaved?.();
    } catch (error) {
      say('Не удалось сохранить', String(error));
    }
  }

  const shown = search.trim()
    ? sale.items.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
    : sale.items;

  return (
    <>
      {/* Карточка контрагента и карточка товара — поверх документа, со
          стрелкой «назад»: закрывается карточка, а не весь чек. */}
      {partyOpen != null ? (
        <PartyCard id={partyOpen} kind="customer" nested onClose={() => setPartyOpen(null)} />
      ) : null}
      {productOpen != null ? (
        <ProductCard id={productOpen} nested onClose={() => setProductOpen(null)} />
      ) : null}
      {orderOpen ? (
        <MoneyDocumentDrawer id={id} source="sale" nested onClose={() => setOrderOpen(false)} />
      ) : null}

      {bare ? null : (
        <View style={styles.bar}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
            <Text style={styles.closeGlyph}>✕</Text>
          </Pressable>

          <View style={styles.barSpace} />

          {!sale.refunded ? (
            <Pressable accessibilityRole="button" onPress={askRefund} style={styles.danger}>
              <Text style={styles.dangerLabel}>Возврат</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <View style={styles.titleRow}>
        <Text style={styles.title}>
          {sale.refunded ? 'Возврат продажи' : 'Продажа'} #{sale.number ?? sale.id}
        </Text>
        <Text style={styles.kind}>Документ</Text>
      </View>

      <View style={styles.chips}>
        <View style={styles.chip}>
          <WebIcon.calendar size={14} color={web.textMuted} />
          <Text style={styles.chipLabel}>Создан {longDate(sale.created_at)}</Text>
        </View>

        <View style={[styles.chip, styles.chipDone]}>
          <Text style={[styles.chipLabel, styles.chipDoneLabel]}>
            {sale.refunded ? 'Документ возвращён' : 'Документ проведён'}
          </Text>
          <WebIcon.caretDown size={12} color="#FFFFFF" />
        </View>

        {/* «Статус заказа» — у него третьей фишкой. Заказов у нас нет:
            чек пробивается на кассе целиком, промежуточных состояний
            («собирается», «выдан») не бывает. Поэтому фишка стоит, но
            статуса не показывает — придумывать его я не стал. */}
        <View style={styles.chip}>
          <Text style={styles.chipLabel}>Статус заказа</Text>
          <WebIcon.caretDown size={12} color={web.textMuted} />
        </View>
      </View>

      <View style={styles.head}>
        <View style={styles.headColumn}>
          <Field label="Магазин" value={sale.store} link onPress={() => router.push('/stores')} />
          <Field
            label="Клиент"
            value={sale.customer ?? 'Розничный покупатель'}
            link
            onPress={sale.customer_id ? () => setPartyOpen(sale.customer_id) : undefined}
          />
          <Field label="Автор" value={sale.author} link onPress={() => router.push('/staff')} />
          <Field label="Касса" value={sale.register} link onPress={() => router.push('/registers')} />
          <Field
            label="Смена"
            value={sale.shift_number ? `#${sale.shift_number}` : null}
            link
            onPress={() => router.push('/shifts')}
          />
        </View>

        <View style={styles.headColumn}>
          <Field
            label="Скидка"
            value={
              sale.discount
                ? `${percent}% (${formatMoneyWeb(sale.discount)} руб)`
                : `0% (${formatMoneyWeb(0)} руб)`
            }
          />
          <Field label="Сумма" value={`${formatMoneyWeb(sale.total)} руб`} />
          <Field label="Оплаченные" value={`${formatMoneyWeb(sale.total - sale.debt)} руб`} />
          <Field label="Сумма налога" value={`${formatMoneyWeb(0)} руб`} />
        </View>
      </View>

      {/* Комментарий к чеку.
          У него он стоит ровно здесь — между шапкой и «Оплатой», отдельной
          кремовой плашкой со значком:
          `<div class="doc-comment" ng-if="!!item.comment">` и
          `.doc-comment{background:#FFFAF3;font-size:12px;padding:5px 10px;
           border-radius:6px}`. Пустой плашки не бывает: нет комментария —
          нет и полосы. */}
      {sale.note ? (
        <View style={styles.comment}>
          <WebIcon.comment size={13} color="rgba(0,0,0,0.3)" />
          <Text style={styles.commentText}>{sale.note.trim()}</Text>
        </View>
      ) : null}

      <Divider>Оплата</Divider>
      <View style={styles.table}>
        <View style={[styles.row, styles.headRow]}>
          <View style={styles.cellDot} />
          <Text style={[styles.cellNo, styles.headText]}>#</Text>
          <Text style={[styles.cellWide, styles.headText]}>Счёт</Text>
          <Text style={[styles.cellWide, styles.headText]}>Контрагент</Text>
          <Text style={[styles.cellDate, styles.headText]}>Дата</Text>
          <Text style={[styles.cellSum, styles.headText]}>Сумма</Text>
        </View>

        <View style={styles.row}>
          {/* Синяя точка слева — метка оплаты, как у него. */}
          <View style={styles.cellDot}>
            <View style={styles.dot} />
          </View>
          {/* Номер оплаты ведёт в сам ордер, как у него
              (`card.money_show({orderId})`), а не в общий список денег. */}
          <Text
            accessibilityRole="link"
            style={[styles.cellNo, styles.link]}
            onPress={() => setOrderOpen(true)}
          >
            {sale.money_number ?? sale.id}
          </Text>
          <Text
            accessibilityRole="link"
            style={[styles.cellWide, styles.link]}
            onPress={() => router.push('/accounts')}
          >
            {account}
          </Text>
          <Text
            accessibilityRole="link"
            style={[styles.cellWide, styles.link]}
            onPress={() =>
              sale.customer_id ? setPartyOpen(sale.customer_id) : router.push('/counterparties')
            }
          >
            {sale.customer ?? 'Розничный покупатель'}
          </Text>
          <Text style={styles.cellDate}>{longDate(sale.created_at)}</Text>
          <Text style={styles.cellSum}>{formatMoneyWeb(sale.total)} руб</Text>
        </View>
      </View>

      <Divider>Товары</Divider>

      {/* Поиск по строкам документа — как у него над таблицей товаров.
          В чеке на три позиции он не нужен, а в приходе на две сотни — да. */}
      <View style={styles.goodsBar}>
        <View style={styles.searchBox}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Поиск товаров"
            placeholderTextColor={web.textMuted}
            style={styles.searchInput}
          />
          <WebIcon.search size={16} color={web.textMuted} />
        </View>
      </View>

      <View style={styles.table}>
        <View style={[styles.row, styles.headRow]}>
          <Text style={[styles.cellName, styles.headText]}>Наименование</Text>
          <Text style={[styles.cellCode, styles.headText]}>Штрих-код</Text>
          <Text style={[styles.cellCode, styles.headText]}>Артикул</Text>
          <Text style={[styles.cellNum, styles.headText]}>Количество</Text>
          <Text style={[styles.cellNum, styles.headText]}>Цена</Text>
          <Text style={[styles.cellNum, styles.headText]}>Скидка</Text>
          <Text style={[styles.cellNum, styles.headText]}>Итог</Text>
        </View>

        {shown
          .filter((item) => !dropped.includes(item.id))
          .map((item) => {
            const edit = edits[item.id] ?? {};
            const qty = edit.qty != null ? (parseQty(edit.qty) ?? item.qty) : item.qty;
            const price = edit.price != null ? (parseMoney(edit.price) ?? item.price) : item.price;
            const sum = Math.round((qty * price) / 1000);

            return (
              <View key={item.id} style={styles.row}>
                <View style={styles.cellName}>
                  <WebIcon.products size={15} color={web.textMuted} />
                  <Text
                    accessibilityRole="link"
                    style={[styles.itemName, styles.link]}
                    numberOfLines={2}
                    onPress={() => setProductOpen(String(item.product_id))}
                  >
                    {item.name}
                  </Text>

                  {/* В правке строку можно убрать целиком — как у него
                      крестиком в конце строки документа. */}
                  {editing ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Убрать ${item.name}`}
                      onPress={() => setDropped((was) => [...was, item.id])}
                      hitSlop={6}
                    >
                      <Text style={styles.drop}>✕</Text>
                    </Pressable>
                  ) : null}
                </View>

                <Text style={styles.cellCode}>{item.barcode ?? ''}</Text>
                <Text style={styles.cellCode}>{item.sku ?? ''}</Text>

                {editing ? (
                  <TextInput
                    value={edit.qty ?? String(item.qty / 1000)}
                    onChangeText={(text) =>
                      setEdits((was) => ({ ...was, [item.id]: { ...was[item.id], qty: text } }))
                    }
                    accessibilityLabel={`Количество: ${item.name}`}
                    style={[styles.cellNum, styles.cellInput]}
                  />
                ) : (
                  <Text style={styles.cellNum}>{formatQty(item.qty)}</Text>
                )}

                {editing ? (
                  <TextInput
                    value={edit.price ?? String(item.price / 100)}
                    onChangeText={(text) =>
                      setEdits((was) => ({ ...was, [item.id]: { ...was[item.id], price: text } }))
                    }
                    accessibilityLabel={`Цена: ${item.name}`}
                    style={[styles.cellNum, styles.cellInput]}
                  />
                ) : (
                  <Text style={styles.cellNum}>{formatMoneyWeb(item.price)}</Text>
                )}

                <Text style={styles.cellNum}>{formatMoneyWeb(item.discount ?? 0)}</Text>
                <Text style={styles.cellNum}>{formatMoneyWeb(sum - (item.discount ?? 0))}</Text>
              </View>
            );
          })}

        <View style={[styles.row, styles.totalRow]}>
          <Text style={[styles.cellName, styles.totalText]}>Итог</Text>
          <Text style={styles.cellCode} />
          <Text style={styles.cellCode} />
          <Text style={[styles.cellNum, styles.totalText]}>{formatQty(quantity)}</Text>
          <Text style={styles.cellNum}>-</Text>
          <Text style={[styles.cellNum, styles.totalText]}>{formatMoneyWeb(sale.discount)}</Text>
          <Text style={[styles.cellNum, styles.totalText]}>{formatMoneyWeb(sale.total)}</Text>
        </View>
      </View>

      {editing ? (
        <View style={styles.saveRow}>
          <Pressable accessibilityRole="button" onPress={save} style={styles.save}>
            <Text style={styles.saveLabel}>Сохранить</Text>
          </Pressable>
          <Text style={styles.saveHint}>
            Склад пересчитается: движения этого чека заменятся новыми.
          </Text>
        </View>
      ) : null}
    </>
  );
}

/**
 * Строка шапки документа.
 *
 * В его кабинете **всё синее — ссылка**: магазин ведёт в карточку магазина,
 * клиент в карточку клиента, автор в профиль сотрудника, касса в кассу,
 * смена в смену. Это видно прямо в разметке их экрана
 * (`js/pages/journal/page/index.html`): `ui-sref="…card.profile"`,
 * `…card.register.showBox`, `…card.register.showShift`. Поэтому здесь не
 * «синий текст», а нажимаемая строка — иначе цвет обещает переход, которого
 * нет.
 */
function Field({
  label,
  value,
  link,
  onPress,
}: {
  label: string;
  value: string | null;
  link?: boolean;
  onPress?: () => void;
}) {
  const text = (
    <Text style={[styles.fieldValue, link && value ? styles.link : null]} numberOfLines={1}>
      {value ?? '—'}
    </Text>
  );

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {onPress && value ? (
        <Pressable accessibilityRole="link" onPress={onPress} style={styles.fieldPress}>
          {text}
        </Pressable>
      ) : (
        text
      )}
    </View>
  );
}

function Divider({ children }: { children: string }) {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerLabel}>{children.toUpperCase()}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

/** «20 августа 2026» — как подписан документ у него. */
function longDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  content: { padding: 24, paddingBottom: 60 },
  empty: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted, padding: 40 },

  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },

  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minWidth: 44,
    height: 38,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(34,36,38,0.15)',
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  toolGreen: { backgroundColor: web.green, borderColor: web.green },
  toolDanger: { borderColor: web.danger },
  toolRight: { marginLeft: 'auto' },
  toolSoon: { opacity: 0.45 },
  toolLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  toolLabelGreen: { color: '#FFFFFF' },
  toolLabelDanger: { color: web.danger },
  barSpace: { flex: 1 },
  close: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: { fontFamily: WEB_FONT, fontSize: 16, color: web.text },
  danger: {
    height: 38,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: web.danger,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.danger },

  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 16 },
  title: { flex: 1, fontFamily: WEB_FONT, fontSize: 30, color: web.text },
  kind: { fontFamily: WEB_FONT, fontSize: 24, color: '#D8DCE3' },

  chips: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 20 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipDone: { backgroundColor: '#00B5AD', borderColor: '#00B5AD' },
  chipLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  chipDoneLabel: { color: '#FFFFFF' },

  head: { flexDirection: 'row', gap: 60 },
  /** Между строками шапки пять пикселей — их `.description-item{padding-bottom:5px}`. */
  headColumn: { flex: 1, gap: 5 },
  field: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  fieldPress: { flex: 1 },
  /**
   * Подпись поля — их `.description-item b`: ширина 120, обычное начертание,
   * цвет `rgba(51,66,91,.7)`. У меня стояли свои 130 и общий серый.
   */
  fieldLabel: { width: 120, fontFamily: WEB_FONT, fontSize: 14, color: 'rgba(51,66,91,0.7)' },
  fieldValue: { flex: 1, fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  link: { color: web.link },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 32, marginBottom: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: FORM_BORDER },
  dividerLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted, letterSpacing: 0.6 },

  table: { borderWidth: 1, borderColor: FORM_BORDER, borderRadius: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: FORM_BORDER,
  },
  headRow: { backgroundColor: web.tableHead, borderTopWidth: 0 },
  headText: { color: web.textMuted },
  totalRow: { backgroundColor: web.tableHead },
  totalText: { fontWeight: '700' },

  cellDot: { width: 26, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: web.link },

  goodsBar: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: 280,
    height: 38,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  searchInput: { flex: 1, fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  itemName: { flex: 1, fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  drop: { fontFamily: WEB_FONT, fontSize: 13, color: web.danger, paddingHorizontal: 4 },
  cellInput: {
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    textAlign: 'right',
  },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 20 },
  save: {
    paddingHorizontal: 24,
    paddingVertical: 11,
    borderRadius: 4,
    backgroundColor: web.green,
  },
  saveLabel: { fontFamily: WEB_FONT, fontSize: 15, color: '#FFFFFF' },
  saveHint: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  cellNo: { width: 70, fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  cellWide: { flex: 1, fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  cellDate: { width: 170, fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  cellSum: {
    width: 130,
    textAlign: 'right',
    fontFamily: WEB_FONT,
    fontSize: 13,
    color: web.text,
    fontVariant: ['tabular-nums'],
  },

  /**
   * Плашка комментария — их `.doc-comment`.
   * `background:#FFFAF3; font-size:12px; padding:5px 10px; border-radius:6px;
   *  display:inline-flex; margin:5px 0`, значок серый на треть.
   * `align-self: flex-start` — это их `inline-flex`: плашка по ширине текста,
   * а не во всю страницу.
   */
  comment: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 20,
    marginBottom: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#FFFAF3',
  },
  commentText: { fontFamily: WEB_FONT, fontSize: 12, color: web.text },

  cellName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  /** Штрих-код и артикул — по правому краю: их таблица товаров вся
      `right aligned`, слева стоит только наименование. */
  cellCode: { width: 130, textAlign: 'right', fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  cellNum: {
    width: 96,
    textAlign: 'right',
    fontFamily: WEB_FONT,
    fontSize: 13,
    color: web.text,
    fontVariant: ['tabular-nums'],
  },
});
