import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Translated';

import { Dropdown, type Option } from './Dropdown';
import { listCategoryViews } from '../db/categories';
import { listLocations } from '../db/locations';
import type { CatalogQuery, Compare } from '../db/products';
import { parseMoney } from '../domain/money';
import { parseQty } from '../domain/qty';
import { useQuery } from '../state/DatabaseProvider';
import { web, WEB_FONT } from '../ui/webTheme';

/**
 * Окно «Фильтр» в каталоге — тем же набором полей, что у него.
 *
 * Раньше здесь стояли восемь готовых наборов: «нет в наличии», «нулевая
 * себестоимость» и так далее. Они отвечали на восемь вопросов, а вопрос у
 * него каждый раз свой — «базовая цена больше пятисот и остаток общий меньше
 * десяти», — и собирает он его сам. Поля и порядок взяты с его снимка:
 * пресеты, три галочки вида, категория, цена, остатки, срок годности,
 * изменения, продаваемость.
 *
 * Готовые наборы никуда не делись: они и есть «пресеты» сверху, только
 * теперь это сохранённые условия, а не восемь неподвижных строк.
 */
export interface CatalogFilterValue extends CatalogQuery {
  /** Ничего не выбрано — кнопка «Фильтр» не подсвечена. */
  active?: number;
}

const KINDS: { value: 'product' | 'service' | 'set'; label: string }[] = [
  { value: 'product', label: 'Товар' },
  { value: 'service', label: 'Услуга' },
  { value: 'set', label: 'Комплект' },
];

const COMPARE: Option<Compare>[] = [
  { value: 'gt', label: 'больше' },
  { value: 'lt', label: 'меньше' },
  { value: 'eq', label: 'равно' },
];

const PRICE_FIELD: Option<'sale' | 'purchase'>[] = [
  { value: 'sale', label: 'базовая' },
  { value: 'purchase', label: 'закупочная' },
];

const SOLD: Option<'in' | 'out'>[] = [
  { value: 'in', label: 'продавался в течение' },
  { value: 'out', label: 'не продавался в течение' },
];

export function CatalogFilter({
  visible,
  value,
  onClose,
  onApply,
  saved,
  onSave,
}: {
  visible: boolean;
  value: CatalogQuery;
  onClose: () => void;
  onApply: (query: CatalogQuery) => void;
  /** Сохранённые наборы — «Пресеты фильтров» сверху. */
  saved: { name: string; query: CatalogQuery }[];
  onSave: (name: string, query: CatalogQuery) => void;
}) {
  const [draft, setDraft] = useState<CatalogQuery>(value);
  const [preset, setPreset] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const categories = useQuery((db) => listCategoryViews(db));
  const stores = useQuery((db) => listLocations(db));

  const set = (patch: Partial<CatalogQuery>) => setDraft((current) => ({ ...current, ...patch }));

  const kinds = draft.kinds ?? [];
  const toggleKind = (kind: 'product' | 'service' | 'set') =>
    set({
      kinds: kinds.includes(kind) ? kinds.filter((one) => one !== kind) : [...kinds, kind],
    });

  const presetOptions: Option<string>[] = [
    { value: '', label: 'Выберите' },
    ...saved.map((item) => ({ value: item.name, label: item.name })),
  ];

  const categoryOptions: Option<string>[] = [
    { value: '', label: 'Выбрать категорию' },
    ...categories.map((item) => ({ value: String(item.id), label: item.name })),
  ];

  const storeOptions: Option<string>[] = [
    { value: '', label: 'общие' },
    ...stores.map((item: { id: number; name: string }) => ({ value: String(item.id), label: item.name })),
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Закрыть фильтр" />

      <View style={styles.panel}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.title}>Пресеты фильтров</Text>
          <Dropdown
            value={preset}
            options={presetOptions}
            variant="field"
            label="Пресеты фильтров"
            onChange={(picked) => {
              setPreset(picked);
              const found = saved.find((item) => item.name === picked);
              if (found) setDraft(found.query);
            }}
          />

          {/* Три галочки одной полосой — как у него. */}
          <View style={styles.kinds}>
            {KINDS.map((kind) => {
              const on = kinds.includes(kind.value);
              return (
                <Pressable
                  key={kind.value}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => toggleKind(kind.value)}
                  style={styles.kind}
                >
                  <View style={[styles.box, on && styles.boxOn]}>
                    {on ? <Text style={styles.tick}>✓</Text> : null}
                  </View>
                  <Text style={[styles.kindLabel, on && styles.kindLabelOn]}>{kind.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.title}>Категории</Text>
          <Dropdown
            value={draft.categoryId == null ? '' : String(draft.categoryId)}
            options={categoryOptions}
            variant="field"
            label="Категория"
            onChange={(picked) => set({ categoryId: picked ? Number(picked) : null })}
          />

          <Text style={styles.title}>Цена</Text>
          <View style={styles.row}>
            <Dropdown
              value={draft.price?.field ?? 'sale'}
              options={PRICE_FIELD}
              variant="field"
              width={160}
              label="Какая цена"
              onChange={(field) =>
                set({ price: { op: 'gt', value: 0, ...draft.price, field } })
              }
            />
            <Dropdown
              value={draft.price?.op ?? 'gt'}
              options={COMPARE}
              variant="field"
              width={150}
              label="Условие цены"
              onChange={(op) => set({ price: { field: 'sale', value: 0, ...draft.price, op } })}
            />
            <TextInput
              value={draft.price ? String(draft.price.value / 100) : ''}
              onChangeText={(text) => {
                const money = parseMoney(text);
                set({
                  price:
                    money == null
                      ? undefined
                      : { field: 'sale', op: 'gt', ...draft.price, value: money },
                });
              }}
              placeholder=""
              accessibilityLabel="Цена"
              style={styles.line}
            />
          </View>

          <Text style={styles.title}>Остатки</Text>
          <View style={styles.row}>
            <Dropdown
              value={draft.stock?.locationId == null ? '' : String(draft.stock.locationId)}
              options={storeOptions}
              variant="field"
              width={160}
              label="Где остаток"
              onChange={(picked) =>
                set({
                  stock: {
                    op: 'gt',
                    value: 0,
                    ...draft.stock,
                    locationId: picked ? Number(picked) : null,
                  },
                })
              }
            />
            <Dropdown
              value={draft.stock?.op ?? 'gt'}
              options={COMPARE}
              variant="field"
              width={150}
              label="Условие остатка"
              onChange={(op) => set({ stock: { value: 0, ...draft.stock, op } })}
            />
            <TextInput
              value={draft.stock ? String(draft.stock.value / 1000) : ''}
              onChangeText={(text) => {
                const qty = parseQty(text);
                set({ stock: qty == null ? undefined : { op: 'gt', ...draft.stock, value: qty } });
              }}
              placeholder=""
              accessibilityLabel="Остаток"
              style={styles.line}
            />
          </View>

          <Text style={styles.title}>Срок годности</Text>
          <View style={styles.row}>
            <Text style={styles.fixed}>истекает в течение</Text>
            <TextInput
              value={draft.expiresInDays == null ? '' : String(draft.expiresInDays)}
              onChangeText={(text) =>
                set({ expiresInDays: text.trim() ? Number(text.replace(/\D/g, '')) : undefined })
              }
              placeholder=""
              accessibilityLabel="Срок годности, дней"
              style={styles.line}
            />
            <Text style={styles.unit}>дней</Text>
          </View>

          <Text style={styles.title}>Изменения товара</Text>
          <View style={styles.row}>
            <Text style={styles.fixed}>изменялся в течение</Text>
            <TextInput
              value={draft.changedInDays == null ? '' : String(draft.changedInDays)}
              onChangeText={(text) =>
                set({ changedInDays: text.trim() ? Number(text.replace(/\D/g, '')) : undefined })
              }
              placeholder=""
              accessibilityLabel="Изменялся, дней"
              style={styles.line}
            />
            <Text style={styles.unit}>дней</Text>
          </View>

          <Text style={styles.title}>Продаваемость</Text>
          <View style={styles.row}>
            <Dropdown
              value={draft.sold?.within === false ? 'out' : 'in'}
              options={SOLD}
              variant="field"
              width={230}
              label="Продаваемость"
              onChange={(picked) =>
                set({ sold: { days: draft.sold?.days ?? 30, within: picked === 'in' } })
              }
            />
            <TextInput
              value={draft.sold == null ? '' : String(draft.sold.days)}
              onChangeText={(text) =>
                set({
                  sold: text.trim()
                    ? { within: draft.sold?.within ?? true, days: Number(text.replace(/\D/g, '')) }
                    : undefined,
                })
              }
              placeholder=""
              accessibilityLabel="Продавался, дней"
              style={styles.line}
            />
            <Text style={styles.unit}>дней</Text>
          </View>

          {naming ? (
            <View style={styles.row}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Название пресета"
                placeholderTextColor={web.textMuted}
                accessibilityLabel="Название пресета"
                style={[styles.line, styles.nameInput]}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (!name.trim()) return;
                  onSave(name.trim(), draft);
                  setNaming(false);
                  setName('');
                }}
                style={[styles.button, styles.green]}
              >
                <Text style={styles.greenLabel}>Сохранить</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onApply(draft);
              onClose();
            }}
            style={[styles.button, styles.green]}
          >
            <Text style={styles.greenLabel}>Применить</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setDraft({});
              setPreset('');
              onApply({});
            }}
            style={styles.button}
          >
            <Text style={styles.buttonLabel}>Сбросить</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => setNaming(true)}
            style={[styles.button, styles.greenOutline]}
          >
            <Text style={styles.greenOutlineLabel}>Сохранить пресет</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Сколько частей условия заполнено — по этому числу подсвечена кнопка. */
export function activeParts(query: CatalogQuery): number {
  return [
    query.kinds?.length,
    query.categoryId != null,
    query.price,
    query.stock,
    query.expiresInDays != null,
    query.changedInDays != null,
    query.sold,
  ].filter(Boolean).length;
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.15)' },
  panel: {
    position: 'absolute',
    top: 116,
    left: 232,
    width: 560,
    maxHeight: '82%',
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: web.border,
    shadowColor: '#0B1220',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  body: { padding: 20, gap: 10 },
  title: { fontFamily: WEB_FONT, fontSize: 19, color: web.text, marginTop: 8 },

  kinds: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 4,
    marginTop: 6,
  },
  kind: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    borderRightWidth: 1,
    borderRightColor: web.border,
  },
  box: {
    width: 18,
    height: 18,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#B7BDC6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: web.link, borderColor: web.link },
  tick: { color: '#FFFFFF', fontSize: 12, lineHeight: 14 },
  kindLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  kindLabelOn: { color: web.link },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  fixed: {
    flex: 1,
    fontFamily: WEB_FONT,
    fontSize: 15,
    color: web.text,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  line: {
    flex: 1,
    height: 38,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
    fontFamily: WEB_FONT,
    fontSize: 15,
    color: web.text,
  },
  nameInput: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12 },
  unit: { fontFamily: WEB_FONT, fontSize: 15, color: web.text, width: 54 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: web.border,
  },
  button: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: web.border,
    backgroundColor: '#FFFFFF',
  },
  buttonLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  green: { backgroundColor: web.green, borderColor: web.green },
  greenLabel: { fontFamily: WEB_FONT, fontSize: 15, color: '#FFFFFF' },
  greenOutline: { borderColor: web.green },
  greenOutlineLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.green },
});
