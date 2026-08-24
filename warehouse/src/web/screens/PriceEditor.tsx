import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text, TextInput } from '../Translated';
import { Pager } from '../Table';
import { listLocations } from '../../db/locations';
import { listProducts, saveStorePrices, storePrices } from '../../db/products';
import { formatMoneyWeb, parseMoney } from '../../domain/money';
import type { Kopecks } from '../../domain/money';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { FORM_BORDER, web, WEB_FONT } from '../../ui/webTheme';

const PER_PAGE = 50;

/**
 * «Редактор цен» — пункт меню «Действия», который был приглушён.
 *
 * Разметка их же (`js/pages/card/catalog/price-editor/_view.html`,
 * отдаётся без входа): зелёная «Сохранить» слева, поиск рядом, а ниже
 * таблица — название со снимком, артикул, штрихкод, себестоимость (её тут
 * не правят), закупочная цена, цена продажи и по колонке на каждый
 * магазин. Всё, что правится, — белые поля ввода; сохраняется одним
 * нажатием, а не по строке.
 *
 * Смысл экрана — переписать цены полусотне позиций подряд, не открывая
 * полсотни карточек. Поэтому здесь и нет ничего, кроме цен.
 */
export function PriceEditor() {
  const router = useRouter();
  const { db, refresh } = useDatabase();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const products = useQuery((database) => listProducts(database, { search }), [search]);
  const stores = useQuery((database) => listLocations(database));

  // Цены по магазинам лежат отдельной таблицей: тянем их разом для
  // показанной страницы, а не по товару на каждую отрисовку.
  const shown = useMemo(
    () => products.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [products, page],
  );
  const perStore = useQuery(
    (database) => new Map(shown.map((one) => [one.id, storePrices(database, one.id)])),
    [shown.map((one) => one.id).join(',')],
  );

  /**
   * Что человек напечатал, но ещё не сохранил.
   *
   * Ключ — «товар:поле», значение — строка ровно как введена. Хранить
   * разобранные копейки нельзя: пока набирают «12,», числа ещё нет, а поле
   * не должно дёргаться.
   */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const changed = Object.keys(edits).length;

  const key = (id: Id, field: string) => `${id}:${field}`;
  const put = (id: Id, field: string, value: string) =>
    setEdits((current) => ({ ...current, [key(id, field)]: value }));

  const shownValue = (id: Id, field: string, fallback: Kopecks | null) => {
    const typed = edits[key(id, field)];
    if (typed !== undefined) return typed;
    return fallback === null ? '' : formatMoneyWeb(fallback);
  };

  function save() {
    // Сначала разбираем всё, и только потом пишем: если в одной клетке
    // опечатка, сохранять половину цен нельзя — эту половину потом не
    // найти.
    const byProduct = new Map<Id, { purchase?: Kopecks; price?: Kopecks }>();
    const byStore = new Map<Id, Map<Id, number | null>>();

    for (const [field, text] of Object.entries(edits)) {
      const [rawId, what] = field.split(':');
      const id = Number(rawId);
      const empty = text.trim() === '';

      if (what.startsWith('store')) {
        const storeId = Number(what.slice('store'.length));
        const money = empty ? null : parseMoney(text);
        if (!empty && money === null) return bad(text);

        const map = byStore.get(id) ?? new Map<Id, number | null>();
        map.set(storeId, money);
        byStore.set(id, map);
        continue;
      }

      const money = parseMoney(empty ? '0' : text);
      if (money === null) return bad(text);

      const one = byProduct.get(id) ?? {};
      if (what === 'purchase') one.purchase = money;
      else one.price = money;
      byProduct.set(id, one);
    }

    db.tx(() => {
      for (const [id, one] of byProduct) {
        if (one.price !== undefined) {
          db.run('UPDATE products SET sale_price = ?, updated_at = ? WHERE id = ?', [
            one.price,
            new Date().toISOString(),
            id,
          ]);
        }
        if (one.purchase !== undefined) {
          db.run('UPDATE products SET purchase_price = ?, updated_at = ? WHERE id = ?', [
            one.purchase,
            new Date().toISOString(),
            id,
          ]);
        }
      }
    });

    for (const [id, prices] of byStore) saveStorePrices(db, id, prices);

    refresh();
    setEdits({});
    say('Готово', `Цены изменились у ${byProduct.size + byStore.size} поз.`);
  }

  function bad(text: string) {
    say('Проверьте цену', `«${text}» — это не цена. Ничего не сохранено.`);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          disabled={changed === 0}
          onPress={save}
          style={[styles.green, changed === 0 && styles.greenOff]}
        >
          <Text style={styles.greenLabel}>Сохранить</Text>
        </Pressable>

        <View style={styles.search}>
          <WebIcon.search size={15} color={web.textMuted} />
          <TextInput
            value={search}
            onChangeText={(text) => {
              setSearch(text);
              setPage(1);
            }}
            placeholder="Поиск"
            placeholderTextColor={web.textMuted}
            accessibilityLabel="Поиск"
            style={styles.searchInput}
          />
        </View>

        {changed > 0 ? (
          <Text style={styles.changed}>Не сохранено: {changed} клеток</Text>
        ) : null}
      </View>

      <ScrollView horizontal>
        <View>
          <View style={styles.head}>
            <Text style={[styles.th, styles.name]}>Название</Text>
            <Text style={[styles.th, styles.small]}>Артикул</Text>
            <Text style={[styles.th, styles.small]}>Штрих-код</Text>
            <Text style={[styles.th, styles.money]}>Себестоимость</Text>
            <Text style={[styles.th, styles.money]}>Закупочная цена</Text>
            <Text style={[styles.th, styles.money]}>Цена продажи</Text>
            {stores.map((store) => (
              <Text key={store.id} style={[styles.th, styles.money]} numberOfLines={1}>
                {store.name}
              </Text>
            ))}
          </View>

          <ScrollView style={styles.body}>
            {shown.map((product) => (
              <View key={product.id} style={styles.row}>
                <View style={[styles.cell, styles.name]}>
                  {product.photo_uri ? (
                    <Image source={{ uri: product.photo_uri }} style={styles.thumb} />
                  ) : (
                    <View style={styles.thumb} />
                  )}
                  <Text
                    accessibilityRole="link"
                    style={styles.link}
                    numberOfLines={1}
                    onPress={() =>
                      router.push({
                        pathname: '/product/[id]',
                        params: { id: String(product.id) },
                      })
                    }
                  >
                    {product.name}
                  </Text>
                </View>

                <Text style={[styles.cell, styles.small, styles.plain]} numberOfLines={1}>
                  {product.sku ?? ''}
                </Text>
                <Text style={[styles.cell, styles.small, styles.plain]} numberOfLines={1}>
                  {product.barcode ?? ''}
                </Text>
                {/* Себестоимость здесь только показывается: она берётся из
                    приходов, и переписать её вручную значит соврать отчёту
                    о прибыли. */}
                <Text style={[styles.cell, styles.money, styles.plain]}>
                  {formatMoneyWeb(product.cost_price)}
                </Text>

                <TextInput
                  value={shownValue(product.id, 'purchase', product.purchase_price)}
                  onChangeText={(text) => put(product.id, 'purchase', text)}
                  accessibilityLabel={`Закупочная цена: ${product.name}`}
                  style={[styles.input, styles.money]}
                />
                <TextInput
                  value={shownValue(product.id, 'price', product.sale_price)}
                  onChangeText={(text) => put(product.id, 'price', text)}
                  accessibilityLabel={`Цена продажи: ${product.name}`}
                  style={[styles.input, styles.money]}
                />

                {stores.map((store) => (
                  <TextInput
                    key={store.id}
                    value={shownValue(
                      product.id,
                      `store${store.id}`,
                      perStore.get(product.id)?.get(store.id) ?? null,
                    )}
                    onChangeText={(text) => put(product.id, `store${store.id}`, text)}
                    // Пусто — значит «как у всех»: подсказкой стоит общая цена.
                    placeholder={formatMoneyWeb(product.sale_price)}
                    placeholderTextColor={web.textMuted}
                    accessibilityLabel={`Цена в «${store.name}»: ${product.name}`}
                    style={[styles.input, styles.money]}
                  />
                ))}
              </View>
            ))}

            {shown.length === 0 ? (
              <Text style={styles.empty}>Ничего не нашлось</Text>
            ) : null}
          </ScrollView>
        </View>
      </ScrollView>

      <Pager
        page={page}
        pages={Math.max(1, Math.ceil(products.length / PER_PAGE))}
        onPage={setPage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: FORM_BORDER,
  },
  green: {
    paddingHorizontal: 22,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: '#21BA45',
  },
  greenOff: { opacity: 0.45 },
  greenLabel: { fontFamily: WEB_FONT, fontSize: 14, color: '#FFFFFF' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    width: 320,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
  },
  searchInput: { flex: 1, fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  changed: { fontFamily: WEB_FONT, fontSize: 13, color: web.link },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: FORM_BORDER,
  },
  th: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  body: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F4',
  },
  cell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plain: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  name: { width: 340 },
  small: { width: 130 },
  money: { width: 130 },

  thumb: { width: 20, height: 20, borderRadius: 2, backgroundColor: '#F1F3F4' },
  link: { flex: 1, fontFamily: WEB_FONT, fontSize: 14, color: web.link },

  input: {
    height: 32,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 3,
    paddingHorizontal: 8,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
    textAlign: 'right',
    backgroundColor: '#FFFFFF',
  },

  empty: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted, padding: 40 },
});
