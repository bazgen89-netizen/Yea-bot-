import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Translated';

import { Dropdown, type Option } from '../Dropdown';
import { ToolButton } from '../Table';
import {
  blankDoc,
  docPaid,
  docTotal,
  loadDoc,
  nextNumber,
  saveDoc,
  type DocDraft,
  type DocFormLine,
  type DocPaymentInput,
} from '../../db/docs';
import { listCounterparties } from '../../db/counterparties';
import { listLocations } from '../../db/locations';
import { accountBalances } from '../../db/money';
import { listProducts } from '../../db/products';
import { DOC_STATES, DOC_TYPES, hasOrderState, partyTitle } from '../../domain/docTypes';
import { formatMoneyWeb, parseMoney } from '../../domain/money';
import { formatQty, parseQty } from '../../domain/qty';
import { DOC_KIND_LABEL, type DocKind, type Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { FORM_BORDER, web, webText, WEB_FONT } from '../../ui/webTheme';

/**
 * Форма документа кабинета — одна на все виды.
 *
 * У него она устроена так же: `documents/_view.html` не знает, продажа это
 * или списание, а читает таблицу видов и по ней решает, показывать ли цену,
 * бывает ли вторая сторона и есть ли вкладка оплат. Восемь отдельных экранов
 * отличались бы тремя строчками каждый, а расходились бы поодиночке.
 *
 * Слева витрина каталога, справа сам документ: витрину у них можно свернуть
 * стрелками в углу таблицы, и тогда позиции занимают всю ширину.
 */

/**
 * Черновик формы: те же поля, что у документа, но позиции с названиями.
 *
 * Название, артикул и остаток нужны, чтобы нарисовать строку, и брать их
 * запросом на каждую перерисовку значило бы ходить в базу за тем, что и так
 * известно с момента, когда позицию добавили.
 */
type FormDraft = Omit<DocDraft, 'lines'> & { lines: DocFormLine[] };

export function DocForm({ kind, id }: { kind: DocKind; id?: Id }) {
  const router = useRouter();
  const { db, refresh } = useDatabase();

  const spec = DOC_TYPES[kind];

  const locations = useQuery((database) => listLocations(database));
  const clients = useQuery((database) => listCounterparties(database, { kind: 'customer' }));
  const suppliers = useQuery((database) => listCounterparties(database, { kind: 'supplier' }));
  const accounts = useQuery((database) => accountBalances(database));

  const loaded = useQuery((database) => (id ? loadDoc(database, id) : null), [id]);

  // Черновик заводится один раз: пока форма открыта, правки живут в нём, а
  // не в базе — сохранение у него отдельной кнопкой, и до нажатия документа
  // в журнале быть не должно.
  const [draft, setDraft] = useState<FormDraft>(() => ({ ...blankDoc(kind), lines: [] }));
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<'products' | 'orders'>('products');
  const [search, setSearch] = useState('');
  const [rowSearch, setRowSearch] = useState('');
  const [panel, setPanel] = useState(true);
  const [orderOn, setOrderOn] = useState(false);

  // Первая отрисовка: либо открываем заведённый документ, либо ставим номер
  // и магазин по умолчанию — как он и открывает форму.
  if (!ready && (id ? loaded : true)) {
    if (id && loaded) {
      setDraft(loaded);
      setOrderOn(loaded.state !== 0);
    } else {
      setDraft((current) => ({
        ...current,
        number: nextNumber(db, kind),
        locationId: spec.from === 'stores' ? locations[0]?.id ?? null : null,
        locationToId: spec.to === 'stores' ? locations[0]?.id ?? null : null,
      }));
    }
    setReady(true);
  }

  const catalog = useQuery(
    (database) => listProducts(database, { search }),
    [search],
  );

  const shopOptions: Option<string>[] = locations.map((location) => ({
    value: String(location.id),
    label: location.name,
  }));
  const clientOptions: Option<string>[] = clients.map((party) => ({
    value: String(party.id),
    label: party.name,
  }));
  const supplierOptions: Option<string>[] = suppliers.map((party) => ({
    value: String(party.id),
    label: party.name,
  }));

  const optionsFor = (side: 'from' | 'to'): Option<string>[] => {
    const party = side === 'from' ? spec.from : spec.to;
    if (party === 'clients') return clientOptions;
    if (party === 'suppliers') return supplierOptions;
    return shopOptions;
  };

  /** Значение стороны: магазин лежит в locationId, контрагент — в counterpartyId. */
  const sideValue = (side: 'from' | 'to'): string => {
    const party = side === 'from' ? spec.from : spec.to;
    if (party === 'stores') {
      const value = side === 'from' ? draft.locationId : draft.locationToId;
      return value === null ? '' : String(value);
    }
    return draft.counterpartyId === null ? '' : String(draft.counterpartyId);
  };

  const setSide = (side: 'from' | 'to', value: string): void => {
    const party = side === 'from' ? spec.from : spec.to;
    const numeric = value ? Number(value) : null;

    if (party === 'stores') {
      setDraft((current) =>
        side === 'from'
          ? { ...current, locationId: numeric }
          : { ...current, locationToId: numeric },
      );
      return;
    }

    const list = party === 'clients' ? clients : suppliers;
    const found = list.find((party_) => party_.id === numeric);
    setDraft((current) => ({
      ...current,
      counterpartyId: numeric,
      counterparty: found?.name ?? '',
    }));
  };

  /** Магазин, по которому показывать остаток в витрине. */
  const stockShop = spec.from === 'stores' ? draft.locationId : draft.locationToId;

  function addProduct(product: (typeof catalog)[number]): void {
    setDraft((current) => {
      const index = current.lines.findIndex((line) => line.product_id === product.id);
      if (index !== -1) {
        const lines = [...current.lines];
        lines[index] = { ...lines[index], qty: lines[index].qty + 1000 };
        return { ...current, lines };
      }
      return {
        ...current,
        lines: [
          ...current.lines,
          {
            product_id: product.id,
            qty: 1000,
            // Цена подставляется та, которую он подставляет: закупочная в
            // закупке и оприходовании, продажная в продаже и списании.
            price: spec.price === 'purchase' ? product.cost_price : product.sale_price,
            discount_bp: 0,
            name: product.name,
            unit: product.unit,
            code: product.code ?? null,
            sku: product.sku,
            barcode: product.barcode,
            stock: product.stock,
          },
        ],
      };
    });
  }

  function patchLine(productId: Id, patch: Partial<DocFormLine>): void {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.product_id === productId ? { ...line, ...patch } : line,
      ),
    }));
  }

  function removeLine(productId: Id): void {
    setDraft((current) => ({
      ...current,
      lines: current.lines.filter((line) => line.product_id !== productId),
    }));
  }

  function addAll(): void {
    for (const product of catalog) addProduct(product);
  }

  function save(): void {
    try {
      saveDoc(db, { ...draft, state: orderOn ? draft.state : 0 });
      refresh();
      router.back();
    } catch (error) {
      say('Документ не сохранён', String(error));
    }
  }

  const total = docTotal(draft.lines, draft.discount_bp);
  const paid = docPaid(draft.payments);
  const visibleLines = useMemo(() => {
    const needle = rowSearch.trim().toLowerCase();
    if (!needle) return draft.lines;
    return draft.lines.filter((line) => line.name.toLowerCase().includes(needle));
  }, [draft.lines, rowSearch]);

  return (
    <View style={styles.screen}>
      {panel ? (
        <CatalogPanel
          search={search}
          onSearch={setSearch}
          products={catalog}
          chosen={new Set(draft.lines.map((line) => line.product_id))}
          shop={stockShop}
          onPick={addProduct}
          onAddAll={addAll}
        />
      ) : null}

      <ScrollView style={styles.form} contentContainerStyle={styles.formContent}>
        <View style={styles.docsHeader}>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: draft.posted }}
            accessibilityLabel={draft.posted ? 'Документ проведен' : 'Документ отложен'}
            onPress={() => setDraft((current) => ({ ...current, posted: !current.posted }))}
            style={styles.postedRow}
          >
            <View style={[styles.track, draft.posted && styles.trackOn]}>
              <View style={[styles.knob, draft.posted && styles.knobOn]} />
            </View>
            <Text style={styles.postedLabel}>
              {draft.posted ? 'Документ проведен' : 'Документ отложен'}
            </Text>
          </Pressable>

          {hasOrderState(kind) ? (
            <View style={styles.stateRow}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: orderOn }}
                accessibilityLabel="Заказ"
                onPress={() => setOrderOn((on) => !on)}
                style={styles.checkRow}
              >
                <View style={[styles.box, orderOn && styles.boxOn]}>
                  {orderOn ? <Text style={styles.tick}>✓</Text> : null}
                </View>
                <Text style={styles.checkLabel}>Заказ</Text>
              </Pressable>

              {orderOn ? (
                <Dropdown
                  value={String(draft.state)}
                  options={DOC_STATES.map((state) => ({
                    value: String(state.id),
                    label: state.name,
                  }))}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, state: Number(value) }))
                  }
                  placeholder="Выберите статус"
                />
              ) : null}
            </View>
          ) : null}

          <View style={styles.spacer} />

          <View style={styles.dateBox}>
            <WebIcon.pencil size={14} color={web.textMuted} />
            <TextInput
              value={draft.date.slice(0, 10)}
              onChangeText={(value) =>
                setDraft((current) => ({ ...current, date: `${value}T00:00:00.000Z` }))
              }
              accessibilityLabel="Дата документа"
              style={styles.dateInput}
            />
          </View>
        </View>

        <View style={styles.panelWhite}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={styles.docsTitle}>{spec.title} #</Text>
              <TextInput
                value={draft.number}
                onChangeText={(value) => setDraft((current) => ({ ...current, number: value }))}
                accessibilityLabel="Номер документа"
                style={styles.numberInput}
              />
            </View>

            <View style={styles.sides}>
              <View style={styles.side}>
                <Text style={styles.fieldLabel}>{partyTitle(kind, 'from')}</Text>
                <Dropdown
                  value={sideValue('from')}
                  options={optionsFor('from')}
                  onChange={(value) => setSide('from', value)}
                  variant="field"
                  placeholder={`Выберите: ${partyTitle(kind, 'from').toLowerCase()}`}
                />
              </View>

              {spec.to ? (
                <View style={styles.side}>
                  <Text style={styles.fieldLabel}>{partyTitle(kind, 'to')}</Text>
                  <Dropdown
                    value={sideValue('to')}
                    options={optionsFor('to')}
                    onChange={(value) => setSide('to', value)}
                    variant="field"
                    placeholder={`Выберите: ${partyTitle(kind, 'to').toLowerCase()}`}
                  />
                </View>
              ) : null}
            </View>
          </View>

          {draft.lines.length === 0 ? (
            <View style={styles.blank}>
              <Text style={styles.blankTitle}>← Выберите товар</Text>
              <Text style={styles.blankHint}>или отсканируйте штрихкод</Text>
            </View>
          ) : (
            <>
              <View style={styles.tabs}>
                <Pressable accessibilityRole="tab" onPress={() => setTab('products')}>
                  <Text style={[styles.tab, tab === 'products' && styles.tabActive]}>Товары</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="tab"
                  disabled={!spec.pay}
                  onPress={() => spec.pay && setTab('orders')}
                >
                  <Text
                    style={[
                      styles.tab,
                      tab === 'orders' && styles.tabActive,
                      !spec.pay && styles.tabDisabled,
                    ]}
                  >
                    Счета и оплаты
                  </Text>
                </Pressable>
              </View>

              {tab === 'products' ? (
                <LinesTable
                  lines={visibleLines}
                  spec={spec}
                  search={rowSearch}
                  onSearch={setRowSearch}
                  panel={panel}
                  onTogglePanel={() => setPanel((on) => !on)}
                  onChange={patchLine}
                  onRemove={removeLine}
                />
              ) : (
                <PaymentsTab
                  payments={draft.payments}
                  accounts={accounts.map((account) => account.name)}
                  onChange={(payments) => setDraft((current) => ({ ...current, payments }))}
                />
              )}

              <View style={styles.totals}>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Итого:</Text>
                  <Text style={styles.totalValue}>{formatMoneyWeb(total)}</Text>
                </View>

                {spec.pay ? (
                  <View style={styles.totalRow}>
                    <Text style={styles.subLabel}>Оплачено:</Text>
                    <Text style={styles.subValue}>{formatMoneyWeb(paid)}</Text>
                  </View>
                ) : null}

                {spec.discount ? (
                  <View style={styles.totalRow}>
                    <Text style={styles.subLabel}>Скидка на документ:</Text>
                    <View style={styles.discountBox}>
                      <TextInput
                        value={draft.discount_bp ? String(draft.discount_bp / 100) : ''}
                        onChangeText={(value) =>
                          setDraft((current) => ({
                            ...current,
                            discount_bp: Math.round((Number(value.replace(',', '.')) || 0) * 100),
                          }))
                        }
                        accessibilityLabel="Скидка на документ"
                        style={styles.discountInput}
                      />
                      <Text style={styles.subValue}>%</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            </>
          )}

          <View style={styles.commentBlock}>
            <Text style={styles.commentTitle}>
              {kind === 'writeoff' ? 'Комментарий/Причина списания' : 'Комментарий'}
            </Text>
            <TextInput
              value={draft.note}
              onChangeText={(value) => setDraft((current) => ({ ...current, note: value }))}
              multiline
              accessibilityLabel="Комментарий"
              style={styles.comment}
            />
          </View>
        </View>

        <View style={styles.actions}>
          <ToolButton label="Сохранить" tone="green" onPress={save} />
          <ToolButton label="Отмена" onPress={() => router.back()} />
        </View>

        {loaded ? (
          <View style={styles.statusBar}>
            <Text style={styles.statusItem}>{loaded.author ?? 'Неизвестно кто'}</Text>
            <Text style={styles.statusItem}>
              Создан {new Date(loaded.created_at).toLocaleString('ru-RU')}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Левая витрина: поиск, «Создать товар», «Добавить все» и список товаров. */
function CatalogPanel({
  search,
  onSearch,
  products,
  chosen,
  shop,
  onPick,
  onAddAll,
}: {
  search: string;
  onSearch: (value: string) => void;
  products: ReturnType<typeof listProducts>;
  chosen: Set<Id>;
  shop: Id | null;
  onPick: (product: ReturnType<typeof listProducts>[number]) => void;
  onAddAll: () => void;
}) {
  const router = useRouter();

  return (
    <View style={styles.left}>
      <View style={styles.leftSearch}>
        <TextInput
          value={search}
          onChangeText={onSearch}
          placeholder="Поиск товара"
          placeholderTextColor={web.textMuted}
          accessibilityLabel="Поиск товара"
          style={styles.leftSearchInput}
        />
      </View>

      <View style={styles.leftActions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/product/[id]', params: { id: 'new' } })}
          style={styles.leftAction}
        >
          <Text style={styles.leftActionText}>+ Создать товар</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Добавить все товары"
          onPress={onAddAll}
          style={styles.leftIconButton}
        >
          <WebIcon.done size={14} color={web.textMuted} />
        </Pressable>
      </View>

      <ScrollView style={styles.leftList}>
        {products.length === 0 ? (
          <Text style={styles.leftEmpty}>Ничего не найдено</Text>
        ) : (
          products.map((product) => (
            <Pressable
              key={product.id}
              accessibilityRole="button"
              onPress={() => onPick(product)}
              style={[styles.leftItem, chosen.has(product.id) && styles.leftItemActive]}
            >
              <Text style={styles.leftCount}>
                {formatQty(shop === null ? product.stock : product.stock)} {product.unit}
              </Text>
              <Text style={styles.leftName} numberOfLines={1}>
                {product.name}
              </Text>
              <Text style={styles.leftDescription} numberOfLines={1}>
                {product.sku ? `Арт. ${product.sku}  ` : ''}
                {product.barcode ? `ШК ${product.barcode}  ` : ''}
                {formatMoneyWeb(product.sale_price)}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

/** Таблица позиций документа. */
function LinesTable({
  lines,
  spec,
  search,
  onSearch,
  panel,
  onTogglePanel,
  onChange,
  onRemove,
}: {
  lines: DocFormLine[];
  spec: (typeof DOC_TYPES)[DocKind];
  search: string;
  onSearch: (value: string) => void;
  panel: boolean;
  onTogglePanel: () => void;
  onChange: (productId: Id, patch: Partial<DocFormLine>) => void;
  onRemove: (productId: Id) => void;
}) {
  const priceTitle = spec.price === 'purchase' ? 'Цена закупки' : 'Цена';

  return (
    <View>
      <View style={styles.tableTools}>
        <TextInput
          value={search}
          onChangeText={onSearch}
          placeholder="Поиск по позициям"
          placeholderTextColor={web.textMuted}
          accessibilityLabel="Поиск по позициям"
          style={styles.rowSearch}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={panel ? 'Свернуть витрину' : 'Показать витрину'}
          onPress={onTogglePanel}
          style={styles.leftIconButton}
        >
          <Text style={styles.expandIcon}>{panel ? '⤢' : '⤡'}</Text>
        </Pressable>
      </View>

      <View style={styles.headRow}>
        <Text style={[styles.head, styles.colIndex]}>#</Text>
        <Text style={[styles.head, styles.colName]}>Наименование</Text>
        {panel ? null : (
          <>
            <Text style={[styles.head, styles.colCode]}>Код товара</Text>
            <Text style={[styles.head, styles.colCode]}>Артикул</Text>
            <Text style={[styles.head, styles.colCode]}>Штрихкод</Text>
          </>
        )}
        <Text style={[styles.head, styles.colUnit]}>Ед.</Text>
        <Text style={[styles.head, styles.colQty]}>Кол-во</Text>
        {spec.price ? <Text style={[styles.head, styles.colMoney]}>{priceTitle}</Text> : null}
        {spec.price && spec.discount ? (
          <Text style={[styles.head, styles.colDiscount]}>Скидка, %</Text>
        ) : null}
        {spec.price ? <Text style={[styles.head, styles.colMoney]}>Сумма</Text> : null}
        <View style={styles.colRemove} />
      </View>

      {lines.map((line, index) => (
        <LineRow
          key={line.product_id}
          line={line}
          index={index}
          spec={spec}
          wide={!panel}
          onChange={(patch) => onChange(line.product_id, patch)}
          onRemove={() => onRemove(line.product_id)}
        />
      ))}
    </View>
  );
}

function LineRow({
  line,
  index,
  spec,
  wide,
  onChange,
  onRemove,
}: {
  line: DocFormLine;
  index: number;
  spec: (typeof DOC_TYPES)[DocKind];
  wide: boolean;
  onChange: (patch: Partial<DocFormLine>) => void;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState(formatQty(line.qty));
  const [price, setPrice] = useState(String(line.price / 100));

  const gross = Math.round((line.qty * line.price) / 1000);
  const sum = gross - Math.round((gross * (line.discount_bp ?? 0)) / 10000);

  return (
    <View style={styles.row}>
      <Text style={[styles.cell, styles.colIndex]}>{index + 1}</Text>
      <Text style={[styles.cellName, styles.colName]} numberOfLines={1}>
        {line.name}
      </Text>
      {wide ? (
        <>
          <Text style={[styles.cell, styles.colCode]}>{line.code ?? ''}</Text>
          <Text style={[styles.cell, styles.colCode]}>{line.sku ?? ''}</Text>
          <Text style={[styles.cell, styles.colCode]}>{line.barcode ?? ''}</Text>
        </>
      ) : null}
      <Text style={[styles.cell, styles.colUnit]}>{line.unit}</Text>

      <View style={styles.colQty}>
        <TextInput
          value={qty}
          onChangeText={setQty}
          onBlur={() => {
            const parsed = parseQty(qty);
            if (parsed === null) setQty(formatQty(line.qty));
            else onChange({ qty: parsed });
          }}
          accessibilityLabel={`Количество: ${line.name}`}
          style={styles.cellInput}
        />
      </View>

      {spec.price ? (
        <View style={styles.colMoney}>
          <TextInput
            value={price}
            onChangeText={setPrice}
            onBlur={() => {
              const parsed = parseMoney(price);
              if (parsed === null) setPrice(String(line.price / 100));
              else onChange({ price: parsed });
            }}
            accessibilityLabel={`Цена: ${line.name}`}
            style={styles.cellInput}
          />
        </View>
      ) : null}

      {spec.price && spec.discount ? (
        <View style={styles.colDiscount}>
          <TextInput
            value={line.discount_bp ? String(line.discount_bp / 100) : ''}
            onChangeText={(value) =>
              onChange({ discount_bp: Math.round((Number(value.replace(',', '.')) || 0) * 100) })
            }
            accessibilityLabel={`Скидка: ${line.name}`}
            style={styles.cellInput}
          />
        </View>
      ) : null}

      {spec.price ? (
        <Text style={[styles.cellNumber, styles.colMoney]}>{formatMoneyWeb(sum)}</Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Убрать: ${line.name}`}
        onPress={onRemove}
        style={styles.colRemove}
      >
        <Text style={styles.removeIcon}>✕</Text>
      </Pressable>
    </View>
  );
}

/** Вкладка «Счета и оплаты». */
function PaymentsTab({
  payments,
  accounts,
  onChange,
}: {
  payments: DocPaymentInput[];
  accounts: string[];
  onChange: (payments: DocPaymentInput[]) => void;
}) {
  const add = () =>
    onChange([
      ...payments,
      {
        account: accounts[0] ?? 'Касса магазина',
        amount: 0,
        paid: false,
        date: new Date().toISOString().slice(0, 10),
      },
    ]);

  const patch = (index: number, next: Partial<DocPaymentInput>) =>
    onChange(payments.map((payment, i) => (i === index ? { ...payment, ...next } : payment)));

  if (payments.length === 0) {
    return (
      <View style={styles.blank}>
        <Text style={styles.blankTitle}>Оплат нет</Text>
        <Pressable accessibilityRole="button" onPress={add} style={styles.addPayment}>
          <Text style={styles.addPaymentText}>Создать</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.payments}>
      {payments.map((payment, index) => (
        <View key={index} style={styles.paymentRow}>
          <View style={styles.paymentCell}>
            <Text style={styles.fieldLabel}>Оплачено</Text>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: payment.paid }}
              accessibilityLabel={`Оплата ${index + 1} проведена`}
              onPress={() => patch(index, { paid: !payment.paid })}
            >
              <View style={[styles.track, payment.paid && styles.trackOn]}>
                <View style={[styles.knob, payment.paid && styles.knobOn]} />
              </View>
            </Pressable>
          </View>

          <View style={styles.paymentCell}>
            <Text style={styles.fieldLabel}>Счет</Text>
            <Dropdown
              value={payment.account}
              options={accounts.map((name) => ({ value: name, label: name }))}
              onChange={(value) => patch(index, { account: value })}
              variant="field"
            />
          </View>

          <View style={styles.paymentCell}>
            <Text style={styles.fieldLabel}>Сумма</Text>
            <TextInput
              value={payment.amount ? String(payment.amount / 100) : ''}
              onChangeText={(value) =>
                patch(index, { amount: parseMoney(value) ?? 0 })
              }
              accessibilityLabel={`Сумма оплаты ${index + 1}`}
              style={styles.paymentInput}
            />
          </View>

          <View style={styles.paymentCell}>
            <Text style={styles.fieldLabel}>Дата</Text>
            <TextInput
              value={payment.date.slice(0, 10)}
              onChangeText={(value) => patch(index, { date: value })}
              accessibilityLabel={`Дата оплаты ${index + 1}`}
              style={styles.paymentInput}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Убрать оплату ${index + 1}`}
            onPress={() => onChange(payments.filter((_, i) => i !== index))}
            style={styles.colRemove}
          >
            <Text style={styles.removeIcon}>✕</Text>
          </Pressable>
        </View>
      ))}

      <Pressable accessibilityRole="button" onPress={add} style={styles.addPayment}>
        <Text style={styles.addPaymentText}>+ Добавить оплату</Text>
      </Pressable>
    </View>
  );
}

/** Заголовок вкладки браузера: «Движение товара / Продажа». */
export function docFormTitle(kind: DocKind): string {
  return `Движение товара / ${DOC_KIND_LABEL[kind]}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, flexDirection: 'row', backgroundColor: web.pageBg },

  left: {
    width: 320,
    backgroundColor: web.bg,
    borderRightWidth: 1,
    borderRightColor: web.border,
  },
  leftSearch: { padding: 12, borderBottomWidth: 1, borderBottomColor: web.border },
  leftSearchInput: {
    height: 36,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 10,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  leftAction: { paddingVertical: 4 },
  leftActionText: { fontFamily: WEB_FONT, fontSize: 14, color: web.link },
  leftIconButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
  },
  leftList: { flex: 1 },
  leftEmpty: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted, padding: 16 },
  leftItem: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  leftItemActive: { backgroundColor: '#E8F4FD' },
  leftCount: {
    fontFamily: WEB_FONT,
    fontSize: 11,
    color: web.textMuted,
    fontVariant: ['tabular-nums'],
  },
  leftName: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  leftDescription: { fontFamily: WEB_FONT, fontSize: 11, color: web.textMuted },

  form: { flex: 1 },
  formContent: { padding: 20, gap: 12 },

  docsHeader: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  spacer: { flex: 1 },
  postedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  postedLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  track: { width: 49, height: 21, borderRadius: 11, backgroundColor: '#D4D4D5', padding: 2 },
  trackOn: { backgroundColor: web.green },
  knob: { width: 17, height: 17, borderRadius: 9, backgroundColor: '#FFFFFF' },
  knobOn: { transform: [{ translateX: 30 }] },

  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  box: {
    width: 17,
    height: 17,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: web.link, borderColor: web.link },
  tick: { color: '#FFFFFF', fontSize: 12 },
  checkLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  dateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 34,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    backgroundColor: web.bg,
  },
  dateInput: {
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
    minWidth: 100,
    fontVariant: ['tabular-nums'],
  },

  panelWhite: {
    backgroundColor: web.bg,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 4,
  },
  header: { padding: 25, borderBottomWidth: 1, borderBottomColor: web.border },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  docsTitle: { fontFamily: WEB_FONT, fontSize: 27, color: web.text, fontWeight: '400' },
  numberInput: {
    fontFamily: WEB_FONT,
    fontSize: 27,
    color: web.text,
    borderBottomWidth: 1,
    borderBottomColor: FORM_BORDER,
    minWidth: 90,
    paddingBottom: 2,
  },
  sides: { flexDirection: 'row', gap: 20, marginTop: 18 },
  side: { flex: 1, gap: 6 },
  fieldLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.text, fontWeight: '700' },

  blank: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  blankTitle: { fontFamily: WEB_FONT, fontSize: 22, color: web.textMuted },
  blankHint: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },

  tabs: { flexDirection: 'row', gap: 26, paddingHorizontal: 25, paddingTop: 18 },
  tab: {
    fontFamily: WEB_FONT,
    fontSize: 18,
    color: web.textMuted,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { color: web.link, borderBottomColor: web.link },
  tabDisabled: { color: '#D0D3D6' },

  tableTools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 25,
    paddingTop: 14,
  },
  rowSearch: {
    flex: 1,
    height: 32,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 10,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  expandIcon: { fontSize: 14, color: web.textMuted },

  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 25,
    paddingVertical: 10,
    marginTop: 10,
    backgroundColor: web.tableHead,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: web.gridLine,
  },
  head: { fontFamily: WEB_FONT, fontSize: 13, color: web.columnHead, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 25,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  cell: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  cellName: { fontFamily: WEB_FONT, fontSize: 14, color: web.link },
  cellNumber: {
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  cellInput: {
    height: 30,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 3,
    paddingHorizontal: 6,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
    textAlign: 'right',
  },

  colIndex: { width: 34 },
  colName: { flex: 1, minWidth: 140 },
  colCode: { width: 110 },
  colUnit: { width: 54 },
  colQty: { width: 92, paddingHorizontal: 4 },
  colMoney: { width: 116, paddingHorizontal: 4 },
  colDiscount: { width: 86, paddingHorizontal: 4 },
  colRemove: { width: 34, alignItems: 'center' },
  removeIcon: { fontSize: 14, color: web.textMuted },

  totals: { paddingHorizontal: 25, paddingVertical: 16, gap: 8, alignItems: 'flex-end' },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  totalLabel: { fontFamily: WEB_FONT, fontSize: 20, color: web.text },
  totalValue: {
    fontFamily: WEB_FONT,
    fontSize: 20,
    color: web.text,
    fontVariant: ['tabular-nums'],
  },
  subLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
  subValue: {
    fontFamily: WEB_FONT,
    fontSize: 15,
    color: web.text,
    fontVariant: ['tabular-nums'],
  },
  discountBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  discountInput: {
    width: 60,
    height: 28,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 3,
    paddingHorizontal: 6,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
    textAlign: 'right',
  },

  payments: { padding: 25, gap: 16 },
  paymentRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  paymentCell: { flex: 1, gap: 6 },
  paymentInput: {
    height: 34,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 10,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  addPayment: { alignSelf: 'flex-end' },
  addPaymentText: { fontFamily: WEB_FONT, fontSize: 14, color: web.link },

  commentBlock: { paddingHorizontal: 25, paddingBottom: 25, gap: 8 },
  commentTitle: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },
  comment: {
    minHeight: 66,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    padding: 10,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
    textAlignVertical: 'top',
  },

  actions: { flexDirection: 'row', gap: 10 },

  statusBar: { flexDirection: 'row', gap: 20, paddingTop: 4 },
  statusItem: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },
});

// Оставлено на будущее: подписи колонок отчёта берут стиль отсюда.
export const DOC_FORM_TEXT = webText;
