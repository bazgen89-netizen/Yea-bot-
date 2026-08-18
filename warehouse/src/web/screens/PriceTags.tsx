import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { Dropdown } from '../Dropdown';
import { listLocations } from '../../db/locations';
import { listProducts } from '../../db/products';
import { getSettings } from '../../db/settings';
import { stockByLocation } from '../../db/locations';
import { formatMoneyWeb } from '../../domain/money';
import { formatQtyWeb } from '../../domain/qty';
import { useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { FORM_BORDER, web, WEB_FONT } from '../../ui/webTheme';

/**
 * «Компания / Печатные формы».
 *
 * В кабинете этот пункт открывает не свой экран, а плагин `print-templates`,
 * который внутри называется **«Конструктор ценников»**: карточки с видами
 * ценников, флажки «с учётом остатков», «по ценам магазина», «печать на
 * принтере этикеток» и синяя кнопка «Скачать ценники».
 *
 * У нас ценники не скачиваются файлом, а открываются страницей печати: файл,
 * который надо ещё чем-то открыть, чтобы нажать «Печать», — лишний шаг, а
 * браузер умеет и то и другое сам.
 */

/** Виды ценников — размеры, по которым режут бумагу. */
interface TagKind {
  id: string;
  name: string;
  /** Ширина и высота ценника в миллиметрах. */
  width: number;
  height: number;
  /** Показывать ли штрихкод. */
  barcode: boolean;
}

const KINDS: TagKind[] = [
  { id: 'big', name: 'Большой, 58 × 40 мм', width: 58, height: 40, barcode: true },
  { id: 'medium', name: 'Средний, 43 × 25 мм', width: 43, height: 25, barcode: true },
  { id: 'small', name: 'Маленький, 30 × 20 мм', width: 30, height: 20, barcode: false },
  { id: 'shelf', name: 'Полочный, 80 × 50 мм', width: 80, height: 50, barcode: true },
];

export function PriceTags() {
  const settings = useQuery((database) => getSettings(database));
  const locations = useQuery((database) => listLocations(database));
  const products = useQuery((database) => listProducts(database, {}));
  const byLocation = useQuery((database) => stockByLocation(database));

  const [kind, setKind] = useState<string>(KINDS[0].id);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [storePrices, setStorePrices] = useState(false);
  const [storeId, setStoreId] = useState<number | null>(null);

  const shop = storeId ?? locations[0]?.id ?? null;
  const chosen = KINDS.find((item) => item.id === kind) ?? KINDS[0];

  /** Что попадёт на печать. */
  const selected = products.filter((product) => {
    if (!onlyInStock) return true;
    if (shop === null) return product.stock > 0;
    return (byLocation.get(product.id)?.get(shop) ?? 0) > 0;
  });

  function print() {
    if (selected.length === 0) {
      say('Печатать нечего', 'Ни один товар не подошёл под выбранные условия.');
      return;
    }

    const page = globalThis.open?.('', '_blank');
    if (!page) {
      say('Не удалось открыть страницу печати', 'Разрешите всплывающие окна для этой страницы.');
      return;
    }

    const shopName = locations.find((location) => location.id === shop)?.name ?? '';

    const tags = selected
      .map((product) => {
        const stock =
          shop === null ? product.stock : (byLocation.get(product.id)?.get(shop) ?? 0);
        return `<div class="tag">
          <div class="company">${escape(settings.name)}</div>
          <div class="name">${escape(product.name)}</div>
          <div class="price">${formatMoneyWeb(product.sale_price)} ${escape(settings.currencyView)}</div>
          <div class="foot">
            ${product.sku ? `Арт. ${escape(product.sku)}` : ''}
            ${onlyInStock ? ` · ${formatQtyWeb(stock)} ${escape(product.unit)}` : ''}
          </div>
          ${chosen.barcode && product.barcode ? `<div class="barcode">${escape(product.barcode)}</div>` : ''}
        </div>`;
      })
      .join('');

    page.document.write(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>Ценники — ${escape(settings.name)}${shopName ? ` · ${escape(shopName)}` : ''}</title>
<style>
  @page { margin: 8mm; }
  body { font-family: Roboto, Arial, sans-serif; margin: 0; }
  .sheet { display: flex; flex-wrap: wrap; gap: 2mm; }
  .tag {
    width: ${chosen.width}mm; height: ${chosen.height}mm;
    box-sizing: border-box; padding: 1.5mm;
    border: 1px solid #999; display: flex; flex-direction: column;
    justify-content: space-between; overflow: hidden;
  }
  .company { font-size: ${chosen.height > 30 ? 7 : 6}pt; color: #666; }
  .name { font-size: ${chosen.height > 30 ? 8 : 6.5}pt; line-height: 1.15; flex: 1; }
  .price { font-size: ${chosen.height > 30 ? 16 : 11}pt; font-weight: 700; }
  .foot { font-size: 6pt; color: #666; }
  .barcode { font-size: 6pt; color: #666; font-family: monospace; }
  @media print { .hint { display: none; } }
  .hint { padding: 10px 0; font-size: 13px; color: #555; }
</style></head>
<body>
  <div class="hint">Ценников: ${selected.length}. Нажмите Ctrl+P, чтобы напечатать.</div>
  <div class="sheet">${tags}</div>
</body></html>`);
    page.document.close();
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View>
        <Text style={styles.title}>Подготовка ценников</Text>
        <Text style={styles.subtitle}>
          Выберите нужный тип ценников и условия — и отправьте их на печать.
        </Text>
      </View>

      <View style={styles.cards}>
        {KINDS.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === item.id }}
            onPress={() => setKind(item.id)}
            style={[styles.card, kind === item.id && styles.cardOn]}
          >
            <View style={styles.preview}>
              {/* Предпросмотр в масштабе: по нему видно пропорцию ценника,
                  а не только его название. */}
              <View
                style={[
                  styles.previewTag,
                  { width: item.width * 1.7, height: item.height * 1.7 },
                ]}
              >
                <Text style={styles.previewName} numberOfLines={1}>
                  Шу пуэр
                </Text>
                <Text style={styles.previewPrice}>1 300,00</Text>
              </View>
            </View>
            <View style={styles.cardFoot}>
              {kind === item.id ? <WebIcon.done size={14} color={web.greenText} /> : null}
              <Text style={styles.cardName}>{item.name}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      <Check
        label="С учётом остатков товара"
        on={onlyInStock}
        onChange={setOnlyInStock}
        extra={
          onlyInStock && locations.length > 1 ? (
            <Dropdown
              value={shop === null ? '' : String(shop)}
              options={locations.map((location) => ({
                value: String(location.id),
                label: location.name,
              }))}
              onChange={(value) => setStoreId(Number(value))}
              label="Магазин"
            />
          ) : null
        }
      />

      <Check
        label="По ценам магазина"
        on={storePrices}
        onChange={setStorePrices}
        extra={
          storePrices ? (
            <Text style={styles.hint}>
              Цены магазина заводятся в карточке товара, в блоке «Цены».
            </Text>
          ) : null
        }
      />

      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          Готово к печати: {selected.length} из {products.length}
        </Text>
      </View>

      <Pressable accessibilityRole="button" onPress={print} style={styles.print}>
        <Text style={styles.printLabel}>Печать ценников</Text>
      </Pressable>
    </ScrollView>
  );
}

function Check({
  label,
  on,
  onChange,
  extra,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  extra?: React.ReactNode;
}) {
  return (
    <View style={styles.checkBlock}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={label}
        onPress={() => onChange(!on)}
        style={styles.checkRow}
      >
        <View style={[styles.box, on && styles.boxOn]}>
          {on ? <Text style={styles.tick}>✓</Text> : null}
        </View>
        <Text style={styles.checkLabel}>{label}</Text>
      </Pressable>
      {extra}
    </View>
  );
}

/** Ценник печатается в HTML — названия товаров надо обезвредить. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  content: { padding: 30, gap: 20, maxWidth: 900, width: '100%' },

  title: { fontFamily: WEB_FONT, fontSize: 22, color: web.text },
  subtitle: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted, marginTop: 4 },

  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  card: {
    width: 200,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  cardOn: { borderColor: web.green },
  preview: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F8FA',
  },
  previewTag: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#B0B4B8',
    padding: 4,
    justifyContent: 'space-between',
  },
  previewName: { fontFamily: WEB_FONT, fontSize: 8, color: web.text },
  previewPrice: { fontFamily: WEB_FONT, fontSize: 13, color: web.text, fontWeight: '700' },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: web.border,
  },
  cardName: { fontFamily: WEB_FONT, fontSize: 13, color: web.text },

  checkBlock: { gap: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  hint: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted, marginLeft: 27 },

  summary: { paddingTop: 6 },
  summaryText: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },

  print: {
    alignSelf: 'flex-start',
    paddingHorizontal: 24,
    height: 42,
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: web.link,
  },
  printLabel: { fontFamily: WEB_FONT, fontSize: 16, color: '#FFFFFF' },
});
