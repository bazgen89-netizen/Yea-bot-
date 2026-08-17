import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useCashierKeys } from './useCashierKeys';
import { listCounterparties } from '../../db/counterparties';
import type { SqlDriver } from '../../db/driver';
import { listProducts } from '../../db/products';
import {
  groupByDay,
  receiptJournal,
  receiptLines,
  type Receipt,
} from '../../db/receipts';
import { refundSale } from '../../db/sales';
import { formatMoney } from '../../domain/money';
import { formatQty } from '../../domain/qty';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { Scrollable } from '../Scrollable';
import { WebIcon } from '../../ui/icons';
import { pos } from '../../ui/webTheme';

/**
 * «Журнал чеков» — окно кассы поверх продажи.
 *
 * Кассир открывает журнал не ради статистики, а чтобы **найти одну покупку**:
 * напечатать чек заново или оформить возврат. Поэтому список — не таблица, а
 * карточки: в каждой сразу видно, кто пробил, в каком магазине, кому, чем
 * оплатили и сколько позиций, — то есть всё, по чему покупку узнают.
 *
 * Слева — фильтр, четыре условия, как у него: дата, номер документа,
 * покупатель, товар. Они складываются: «этот клиент, этот товар, этот день».
 * Один поиск по всему тексту здесь не годится — кассир помнит не строку,
 * а обстоятельства.
 */
export function CashierReceipts({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { db, refresh } = useDatabase();

  /**
   * Возврат по чеку целиком.
   *
   * Спрашиваем перед тем, как проводить: товар вернётся на склад, деньги уйдут
   * из кассы, и отменить это нажатием «назад» нельзя. Частичный возврат —
   * другой разговор: его набирают чеком через «Создать возврат».
   */
  const returnAll = (receipt: Receipt) => {
    try {
      refundSale(db, receipt.id);
      refresh();
      say(
        'Возврат оформлен',
        `По чеку #${receipt.id} товар вернулся на склад, ${formatMoney(receipt.total)} руб выданы из кассы.`,
      );
    } catch (error) {
      say('Возврат не оформлен', String(error instanceof Error ? error.message : error));
    }
  };

  const [day, setDay] = useState<string | null>(null);
  const [pickingDay, setPickingDay] = useState(false);
  const [number, setNumber] = useState('');
  const [customerId, setCustomerId] = useState<Id | null>(null);
  const [productId, setProductId] = useState<Id | null>(null);

  useCashierKeys(visible, (event) => {
    if (event.key === 'Escape') onClose();
  });

  // Условия — в зависимостях запроса: без них `useQuery` запоминает первый
  // ответ и список не меняется, сколько ни набирай в фильтре.
  const receipts = useQuery(
    (db) => receiptJournal(db, { date: day, number, customerId, productId }),
    [day, number, customerId, productId],
  );
  // Дни для выбора даты берём из всех чеков, а не из отфильтрованных: иначе,
  // выбрав день, из списка исчезли бы все остальные.
  const days = useQuery((db) => groupByDay(receiptJournal(db, { limit: 500 })).map((g) => g.day));

  const groups = groupByDay(receipts);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть журнал чеков"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          <View style={styles.head}>
            <Text style={styles.title}>Журнал чеков</Text>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeRow}>
              <Text style={styles.closeLabel}>ЗАКРЫТЬ</Text>
              <View style={styles.key}>
                <Text style={styles.keyLabel}>ESC</Text>
              </View>
            </Pressable>
          </View>

          <View style={styles.body}>
            <View style={styles.filter}>
              <View style={styles.columnHead}>
                <WebIcon.funnel color={pos.muted} size={17} />
                <Text style={styles.columnHeadLabel}>Фильтр</Text>
              </View>

              <Scrollable style={styles.filterBody} contentContainerStyle={styles.filterInner}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPickingDay((open) => !open)}
                  style={styles.dateButton}
                >
                  <WebIcon.calendar color={pos.bar} size={20} />
                  <Text style={styles.dateLabel}>
                    {day ? dayTitle(day).toUpperCase() : 'ВЫБЕРИТЕ ДАТУ'}
                  </Text>
                </Pressable>

                {/*
                  Календаря нет намеренно: чеки бывают только в те дни, когда
                  работали, и список этих дней короче любого календаря — в нём
                  не выбрать пустое число.
                */}
                {pickingDay ? (
                  <View style={styles.dayList}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setDay(null);
                        setPickingDay(false);
                      }}
                      style={styles.dayRow}
                    >
                      <Text style={[styles.dayRowLabel, day === null && styles.dayRowActive]}>
                        Все дни
                      </Text>
                    </Pressable>
                    {days.map((value) => (
                      <Pressable
                        key={value}
                        accessibilityRole="button"
                        onPress={() => {
                          setDay(value);
                          setPickingDay(false);
                        }}
                        style={styles.dayRow}
                      >
                        <Text style={[styles.dayRowLabel, day === value && styles.dayRowActive]}>
                          {dayTitle(value)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                <Text style={styles.fieldLabel}>Номер документа</Text>
                <View style={[styles.field, number.length > 0 && styles.fieldFull]}>
                  <Text style={styles.hash}>#</Text>
                  <TextInput
                    value={number}
                    onChangeText={(text) => setNumber(text.replace(/\D/g, ''))}
                    placeholder="Введите номер"
                    placeholderTextColor={pos.muted}
                    accessibilityLabel="Номер документа"
                    style={styles.input}
                  />
                </View>

                <Text style={styles.fieldLabel}>Клиенты</Text>
                <Picker
                  placeholder="Поиск по клиентам"
                  value={customerId}
                  options={(db) =>
                    listCounterparties(db, { kind: 'customer' }).map((client) => ({
                      id: client.id,
                      label: client.name,
                    }))
                  }
                  onChange={setCustomerId}
                />

                <Text style={styles.fieldLabel}>Товары</Text>
                <Picker
                  placeholder="Поиск по товарам"
                  value={productId}
                  options={(db) =>
                    listProducts(db).map((product) => ({ id: product.id, label: product.name }))
                  }
                  onChange={setProductId}
                />
              </Scrollable>
            </View>

            <View style={styles.list}>
              <View style={styles.columnHead}>
                <WebIcon.calendar color={pos.muted} size={18} />
                <Text style={styles.columnHeadLabel}>
                  {groups.length > 0 ? dayTitle(groups[0].day) : 'Чеков нет'}
                </Text>
              </View>

              <Scrollable style={styles.listBody} contentContainerStyle={styles.listInner} toTop>
                {groups.length === 0 ? (
                  <Text style={styles.empty}>
                    По этим условиям чеков не нашлось. Снимите часть условий — они складываются.
                  </Text>
                ) : null}

                {groups.map((group) => (
                  <View key={group.day}>
                    <View style={styles.dayHead}>
                      <WebIcon.calendar color={pos.muted} size={18} />
                      <Text style={styles.dayHeadLabel}>{dayTitle(group.day)}</Text>
                    </View>

                    {group.receipts.map((receipt) => (
                      <Card key={receipt.id} receipt={receipt} onReturn={returnAll} />
                    ))}
                  </View>
                ))}
              </Scrollable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Карточка чека. */
function Card({
  receipt,
  onReturn,
}: {
  receipt: Receipt;
  onReturn: (receipt: Receipt) => void;
}) {
  const [showPayment, setShowPayment] = useState(false);
  const [showLines, setShowLines] = useState(false);
  /**
   * Печать берёт позиции чека тем же запросом, что и раскрытый список, но
   * только когда её попросили: держать шестьсот строк в памяти ради кнопки,
   * которую нажимают раз в день, незачем.
   */
  const [printing, setPrinting] = useState(false);

  return (
    <View style={styles.card}>
      {printing ? <Print receipt={receipt} onDone={() => setPrinting(false)} /> : null}
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>
          {receipt.total === 0 ? 'Возврат' : 'Продажа'} #{receipt.id}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Напечатать чек №${receipt.id}`}
          onPress={() => setPrinting(true)}
          style={styles.cardButton}
        >
          <WebIcon.printer color={pos.text} size={17} />
          <Text style={styles.cardButtonLabel}>ПЕЧАТЬ</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => onReturn(receipt)}
          style={styles.cardButton}
        >
          <Text style={styles.cardButtonLabel}>ВОЗВРАТ</Text>
        </Pressable>

        <View style={styles.cardSpace} />
        <Text style={styles.cardSum}>{formatMoney(receipt.total)} руб</Text>
      </View>

      <View style={styles.cardInfo}>
        <View style={styles.infoRow}>
          <WebIcon.calendar color={pos.muted} size={18} />
          <Text style={styles.infoText}>
            {timeTitle(receipt.created_at)}
            {receipt.staff ? ` · ${receipt.staff}` : ''}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <WebIcon.store color={pos.muted} size={18} />
          <Text style={styles.infoText}>{receipt.location ?? 'Без магазина'}</Text>
          <Text style={styles.infoDot}>·</Text>
          <WebIcon.parties color={pos.muted} size={16} />
          <Text style={styles.infoText}>{receipt.customer ?? 'Розничный покупатель'}</Text>
        </View>
      </View>

      {/* Комментарий кассира — на светло-оранжевой полосе: его пишут не для
          порядка, а чтобы объяснить чек, и он должен бросаться в глаза. */}
      {receipt.note ? (
        <View style={styles.note}>
          <WebIcon.comment color={pos.accent} size={17} />
          <Text style={styles.noteText}>{receipt.note}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showPayment }}
        onPress={() => setShowPayment((open) => !open)}
        style={styles.cardFold}
      >
        <WebIcon.checkCircle color={pos.text} size={20} />
        <Text style={styles.foldLabel}>
          {receipt.debt > 0 ? 'Оплачен частично' : 'Оплачен'}
        </Text>
        <View style={styles.cardSpace} />
        {showPayment ? (
          <WebIcon.chevronUp color={pos.muted} size={18} />
        ) : (
          <WebIcon.chevronDown color={pos.muted} size={18} />
        )}
      </Pressable>

      {showPayment ? (
        <View style={styles.fold}>
          <Fold label={PAYMENT_LABEL[receipt.payment]} value={`${formatMoney(receipt.total - receipt.debt)} руб`} />
          {receipt.discount > 0 ? (
            <Fold label="Скидка" value={`${formatMoney(receipt.discount)} руб`} />
          ) : null}
          {receipt.debt > 0 ? (
            <Fold label="Отсрочка" value={`${formatMoney(receipt.debt)} руб`} />
          ) : null}
          {receipt.refunded > 0 ? <Fold label="По чеку был возврат" value="" /> : null}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showLines }}
        onPress={() => setShowLines((open) => !open)}
        style={styles.cardFold}
      >
        <WebIcon.tiles color={pos.text} size={20} />
        <Text style={styles.foldLabel}>Список товаров</Text>
        <View style={styles.cardSpace} />
        <Text style={styles.foldCount}>{receipt.positions} поз.</Text>
        {showLines ? (
          <WebIcon.chevronUp color={pos.muted} size={18} />
        ) : (
          <WebIcon.chevronDown color={pos.muted} size={18} />
        )}
      </Pressable>

      {showLines ? <Lines saleId={receipt.id} /> : null}
    </View>
  );
}

/**
 * Печать чека — через скрытую врезку, а не отдельное окно.
 *
 * Отдельное окно браузеры кассы блокируют как всплывающее, и кассир видел бы
 * не чек, а предупреждение. Врезка печатается тем же диалогом печати, в
 * который потом подставляют чековый принтер.
 *
 * Ширина листа — 58 миллиметров: столько у рулона в чековом принтере. На
 * обычном A4 то же самое печатается узкой полосой, и это правильнее, чем
 * растянуть чек на весь лист.
 */
function Print({ receipt, onDone }: { receipt: Receipt; onDone: () => void }) {
  const lines = useQuery((db) => receiptLines(db, receipt.id));

  useEffect(() => {
    const frame = globalThis.document?.createElement('iframe');
    if (!frame) {
      onDone();
      return;
    }

    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);

    const rows = lines
      .map(
        (line) =>
          `<tr><td>${escape(line.name)}</td><td class="q">${formatQty(line.qty)} × ${formatMoney(line.price)}</td>` +
          `<td class="s">${formatMoney(line.total)}</td></tr>`,
      )
      .join('');

    frame.contentDocument?.write(
      `<html><head><meta charset="utf-8"><style>
        @page { size: 58mm auto; margin: 3mm }
        body { width: 52mm; font: 11px/1.35 -apple-system, Roboto, sans-serif; color: #000 }
        h1 { font-size: 13px; margin: 0 0 6px; text-align: center }
        .meta { font-size: 10px; margin-bottom: 6px }
        table { width: 100%; border-collapse: collapse }
        td { vertical-align: top; padding: 2px 0 }
        .q, .s { text-align: right; white-space: nowrap; padding-left: 4px }
        .total { border-top: 1px solid #000; margin-top: 6px; padding-top: 4px;
                 display: flex; justify-content: space-between; font-weight: 700 }
      </style></head><body>
        <h1>${receipt.total === 0 ? 'Возврат' : 'Продажа'} №${receipt.id}</h1>
        <div class="meta">
          ${escape(timeTitle(receipt.created_at))}<br>
          ${escape(receipt.location ?? '')}<br>
          ${escape(receipt.customer ?? 'Розничный покупатель')}
        </div>
        <table>${rows}</table>
        <div class="total"><span>Итог</span><span>${formatMoney(receipt.total)} руб</span></div>
      </body></html>`,
    );
    frame.contentDocument?.close();
    frame.contentWindow?.focus();
    frame.contentWindow?.print();

    // Убираем врезку после диалога: он останавливает поток, и к этой строке
    // мы приходим уже с закрытым окном печати.
    frame.remove();
    onDone();
  });

  return null;
}

/** Экранирование для печатной формы: в названиях чая встречаются кавычки. */
function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function Lines({ saleId }: { saleId: Id }) {
  const lines = useQuery((db) => receiptLines(db, saleId));

  return (
    <View style={styles.fold}>
      {lines.map((line, index) => (
        <View key={index} style={styles.lineRow}>
          <Text style={styles.lineName} numberOfLines={1}>
            {line.name}
          </Text>
          <Text style={styles.lineQty}>
            {formatQty(line.qty)} × {formatMoney(line.price)}
          </Text>
          <Text style={styles.lineSum}>{formatMoney(line.total)} руб</Text>
        </View>
      ))}
    </View>
  );
}

function Fold({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.lineRow}>
      <Text style={styles.lineName}>{label}</Text>
      <Text style={styles.lineSum}>{value}</Text>
    </View>
  );
}

/**
 * Поле выбора из справочника: набирают часть названия, выбирают из найденного.
 *
 * Список читается из базы целиком, но показываются только совпадения и не
 * больше восьми: шестьсот товаров в раскрытом списке искать труднее, чем
 * набрать три буквы.
 */
function Picker({
  placeholder,
  value,
  options,
  onChange,
}: {
  placeholder: string;
  value: Id | null;
  options: (db: SqlDriver) => { id: Id; label: string }[];
  onChange: (id: Id | null) => void;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const { db } = useDatabase();
  const all = useQuery(options);

  const chosen = value === null ? null : all.find((item) => item.id === value);

  if (chosen) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Убрать условие: ${chosen.label}`}
        onPress={() => onChange(null)}
        style={[styles.field, styles.fieldFull]}
      >
        <Text style={styles.chosen} numberOfLines={1}>
          {chosen.label}
        </Text>
        <WebIcon.close color={pos.muted} size={16} />
      </Pressable>
    );
  }

  const found =
    text.trim().length === 0
      ? []
      : all
          .filter((item) => item.label.toLowerCase().includes(text.trim().toLowerCase()))
          .slice(0, 8);

  return (
    <View>
      <View style={styles.field}>
        <TextInput
          value={text}
          onChangeText={(next) => {
            setText(next);
            setOpen(true);
          }}
          placeholder={placeholder}
          placeholderTextColor={pos.muted}
          accessibilityLabel={placeholder}
          style={styles.input}
        />
        <WebIcon.caretDown color={pos.muted} size={14} />
      </View>

      {open && found.length > 0 ? (
        <View style={styles.dayList}>
          {found.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => {
                onChange(item.id);
                setText('');
                setOpen(false);
                // База не читается заново: список уже загружен, и здесь только
                // выбор. `db` берём, чтобы не потерять зависимость на обновление.
                void db;
              }}
              style={styles.dayRow}
            >
              <Text style={styles.dayRowLabel} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Наличные',
  card: 'Безналичные',
  transfer: 'Перевод',
};

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** `2026-08-17` → «17 августа 2026». */
function dayTitle(day: string): string {
  const [year, month, date] = day.split('-');
  return `${Number(date)} ${MONTHS[Number(month) - 1] ?? ''} ${year}`;
}

/** ISO → «17 августа 11:33». */
function timeTitle(iso: string): string {
  const when = new Date(iso);
  const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  return `${when.getDate()} ${MONTHS[when.getMonth()]} ${time}`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: '92%',
    height: '92%',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    overflow: 'hidden',
    zIndex: 1,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    height: 66,
  },
  title: { fontFamily: pos.font, fontSize: 22, color: pos.text },
  closeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  closeLabel: { fontFamily: pos.font, fontSize: 13, color: pos.muted, letterSpacing: 0.6 },
  key: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 3,
  },
  keyLabel: { fontFamily: pos.font, fontSize: 11, color: pos.muted },

  body: { flex: 1, flexDirection: 'row', minHeight: 0 },

  // Фильтр — слева, своей шириной: условия читаются в столбик, а карточкам
  // чеков нужно всё остальное место.
  filter: {
    width: 300,
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: pos.border,
  },
  filterBody: { flex: 1, minHeight: 0 },
  filterInner: { padding: 24, gap: 4 },

  columnHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: pos.border,
  },
  columnHeadLabel: { fontFamily: pos.font, fontSize: 16, color: pos.muted },

  // Кнопка даты — светло-синяя, как у него: она не подтверждает и не
  // отменяет, поэтому и не синяя целиком.
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    height: 52,
    borderRadius: 4,
    backgroundColor: '#E8F1FB',
    marginBottom: 12,
  },
  dateLabel: { fontFamily: pos.font, fontSize: 15, color: pos.bar, letterSpacing: 0.6 },

  dayList: {
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 4,
    marginTop: 4,
    marginBottom: 12,
    overflow: 'hidden',
  },
  dayRow: { paddingHorizontal: 12, paddingVertical: 10 },
  dayRowLabel: { fontFamily: pos.font, fontSize: 15, color: pos.text },
  dayRowActive: { color: pos.bar },

  fieldLabel: {
    fontFamily: pos.font,
    fontSize: 15,
    fontWeight: '500',
    color: pos.text,
    marginTop: 12,
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 4,
  },
  // Заполненное условие обведено оранжевым — так у него отмечено поле,
  // которое участвует в поиске.
  fieldFull: { borderColor: pos.accent, borderWidth: 2 },
  hash: { fontFamily: pos.font, fontSize: 17, color: pos.muted },
  input: {
    flex: 1,
    fontFamily: pos.font,
    fontSize: 15,
    color: pos.text,
    outlineWidth: 0,
  },
  chosen: { flex: 1, fontFamily: pos.font, fontSize: 15, color: pos.text },

  list: { flex: 1, minHeight: 0 },
  listBody: { flex: 1, minHeight: 0, backgroundColor: pos.bg },
  listInner: { padding: 16 },
  empty: {
    fontFamily: pos.font,
    fontSize: 16,
    color: pos.muted,
    textAlign: 'center',
    marginTop: 40,
  },

  dayHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  dayHeadLabel: { fontFamily: pos.font, fontSize: 16, color: pos.muted },

  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 6,
    marginBottom: 16,
    overflow: 'hidden',
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
  },
  cardTitle: { fontFamily: pos.font, fontSize: 23, color: pos.text },
  cardSpace: { flex: 1 },
  cardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 4,
    backgroundColor: '#EDEFF1',
  },
  cardButtonLabel: { fontFamily: pos.font, fontSize: 13, color: pos.text, letterSpacing: 0.6 },
  cardSum: {
    fontFamily: pos.font,
    fontSize: 23,
    fontWeight: '700',
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },

  cardInfo: { paddingHorizontal: 20, paddingBottom: 16, gap: 8 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoText: { fontFamily: pos.font, fontSize: 15, color: pos.text },
  infoDot: { fontFamily: pos.font, fontSize: 15, color: pos.muted, marginHorizontal: 4 },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FDF3E3',
  },
  noteText: { fontFamily: pos.font, fontSize: 15, color: pos.accent },

  cardFold: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 54,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: pos.border,
  },
  foldLabel: { fontFamily: pos.font, fontSize: 16, color: pos.text },
  foldCount: { fontFamily: pos.font, fontSize: 15, color: pos.muted, marginRight: 12 },

  fold: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: pos.border,
  },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  lineName: { flex: 1, fontFamily: pos.font, fontSize: 15, color: pos.text },
  lineQty: { fontFamily: pos.font, fontSize: 14, color: pos.muted, fontVariant: ['tabular-nums'] },
  lineSum: {
    fontFamily: pos.font,
    fontSize: 15,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },
});
