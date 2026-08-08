import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View,  } from 'react-native';

import {
  archiveProduct,
  createProduct,
  ensureCategory,
  getProduct,
  listCategories,
  restoreProduct,
  updateProduct,
  type ProductInput,
} from '../../src/db/products';
import { adjustStock, listMoves } from '../../src/db/stock';
import { formatMoney, formatMoneyWithSign, parseMoney } from '../../src/domain/money';
import { formatQty, formatQtyWithUnit, parseQty } from '../../src/domain/qty';
import type { MoveReason } from '../../src/domain/types';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { useScanner } from '../../src/state/ScannerProvider';
import { Badge, Button, Card, Field, Row } from '../../src/ui/components';
import { colors, radius, spacing, text } from '../../src/ui/theme';
import { confirm, say } from '../../src/ui/alert';

const REASON_LABEL: Record<MoveReason, string> = {
  receipt: 'Приход',
  writeoff: 'Списание',
  sale: 'Продажа',
  adjust: 'Инвентаризация',
  return: 'Возврат',
};

export default function ProductScreen() {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const { scanBarcode } = useScanner();
  const params = useLocalSearchParams<{ id: string; barcode?: string }>();

  const isNew = params.id === 'new';
  const productId = isNew ? null : Number(params.id);

  const product = useQuery(
    (database) => (productId ? getProduct(database, productId) : null),
    [productId],
  );
  const categories = useQuery((database) => listCategories(database));

  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? params.barcode ?? '');
  const [unit, setUnit] = useState(product?.unit ?? 'шт');
  const [category, setCategory] = useState(product?.category_name ?? '');
  const [costPrice, setCostPrice] = useState(
    product ? formatMoney(product.cost_price) : '',
  );
  const [salePrice, setSalePrice] = useState(
    product ? formatMoney(product.sale_price) : '',
  );
  const [minQty, setMinQty] = useState(product?.min_qty ? formatQty(product.min_qty) : '');
  const [photoUri, setPhotoUri] = useState(product?.photo_uri ?? null);

  function save() {
    if (!name.trim()) {
      say('Нужно название', 'Без названия товар не сохранить.');
      return;
    }

    const cost = costPrice.trim() ? parseMoney(costPrice) : 0;
    const sale = salePrice.trim() ? parseMoney(salePrice) : 0;
    const min = minQty.trim() ? parseQty(minQty) : 0;

    if (cost === null || sale === null || min === null) {
      say('Проверьте числа', 'Цены и минимальный остаток должны быть числами.');
      return;
    }

    const input: ProductInput = {
      name: name.trim(),
      sku: sku.trim() || null,
      barcode: barcode.trim() || null,
      category_id: category.trim() ? ensureCategory(db, category) : null,
      unit: unit.trim() || 'шт',
      cost_price: cost,
      sale_price: sale,
      min_qty: min,
      photo_uri: photoUri,
    };

    try {
      if (productId) {
        updateProduct(db, productId, input);
      } else {
        createProduct(db, input);
      }
      refresh();
      router.back();
    } catch (error) {
      const message = String(error);
      // Единственное ограничение уникальности в таблице — штрихкод.
      say(
        'Не удалось сохранить',
        message.includes('UNIQUE')
          ? 'Такой штрихкод уже есть у другого товара.'
          : message,
      );
    }
  }

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      say('Нет доступа к фото', 'Разрешите доступ к галерее в настройках.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: isNew ? 'Новый товар' : 'Товар' }} />

      <Card>
        <Pressable onPress={pickPhoto} style={styles.photoBox} accessibilityRole="button">
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photo} />
          ) : (
            <Text style={text.muted}>Добавить фото</Text>
          )}
        </Pressable>

        <Field label="Название" value={name} onChangeText={setName} placeholder="Шу пуэр 2019" />
        <Field
          label="Категория"
          value={category}
          onChangeText={setCategory}
          placeholder="Пуэр"
          hint={
            categories.length > 0
              ? `Уже есть: ${categories.map((c) => c.name).join(', ')}`
              : 'Новая категория создастся автоматически'
          }
        />

        <View style={styles.pair}>
          <Field
            label="Артикул"
            value={sku}
            onChangeText={setSku}
            placeholder="SH-01"
            containerStyle={styles.pairInput}
          />
          <Field
            label="Единица"
            value={unit}
            onChangeText={setUnit}
            placeholder="шт / кг / г"
            containerStyle={styles.pairInput}
          />
        </View>

        <Text style={text.muted}>Штрихкод</Text>
        <View style={styles.barcodeRow}>
          <TextInput
            value={barcode}
            onChangeText={setBarcode}
            placeholder="4600000000001"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            style={styles.barcodeInput}
          />
          <Button
            title="Скан"
            variant="secondary"
            onPress={async () => {
              const code = await scanBarcode();
              if (code) setBarcode(code);
            }}
            style={styles.scanButton}
          />
        </View>
        <Text style={[text.muted, styles.hint]}>
          Отсканированный код подставится в это поле
        </Text>

        <View style={styles.pair}>
          <Field
            label="Закупочная цена"
            value={costPrice}
            onChangeText={setCostPrice}
            placeholder="0,00"
            keyboardType="decimal-pad"
            containerStyle={styles.pairInput}
          />
          <Field
            label="Цена продажи"
            value={salePrice}
            onChangeText={setSalePrice}
            placeholder="0,00"
            keyboardType="decimal-pad"
            containerStyle={styles.pairInput}
          />
        </View>

        <Field
          label="Сообщать, когда останется меньше"
          value={minQty}
          onChangeText={setMinQty}
          placeholder="0"
          keyboardType="decimal-pad"
          hint="0 — не следить за остатком этого товара"
        />

        <Button title="Сохранить" onPress={save} />
      </Card>

      {product ? <StockCard productId={product.id} /> : null}
      {product ? <HistoryCard productId={product.id} /> : null}

      {product ? (
        <Button
          title={product.archived ? 'Вернуть из архива' : 'В архив'}
          variant={product.archived ? 'secondary' : 'danger'}
          onPress={() => {
            if (product.archived) {
              restoreProduct(db, product.id);
              refresh();
              return;
            }
            confirm(
              'Убрать товар в архив?',
              'Товар исчезнет из списков и кассы, но останется в истории продаж.',
              'В архив',
              () => {
                archiveProduct(db, product.id);
                refresh();
                router.back();
              },
            );
          }}
        />
      ) : null}
    </ScrollView>
  );
}

/** Текущий остаток и пересчёт по факту. */
function StockCard({ productId }: { productId: number }) {
  const { db, refresh } = useDatabase();
  const product = useQuery((database) => getProduct(database, productId), [productId]);
  const [actual, setActual] = useState('');

  if (!product) return null;

  function applyInventory() {
    const parsed = parseQty(actual);
    if (parsed === null || parsed < 0) {
      say('Проверьте количество', 'Фактический остаток должен быть числом не меньше нуля.');
      return;
    }

    const delta = adjustStock(db, productId, parsed, 'Инвентаризация из карточки товара');
    refresh();
    setActual('');

    say(
      'Остаток обновлён',
      delta === 0
        ? 'Расхождения не было.'
        : `Расхождение: ${delta > 0 ? '+' : ''}${formatQty(delta)} ${product!.unit}.`,
    );
  }

  return (
    <Card>
      <View style={styles.stockHeader}>
        <View>
          <Text style={text.muted}>Остаток</Text>
          <Text style={text.title}>{formatQtyWithUnit(product.stock, product.unit)}</Text>
        </View>
        <View style={styles.stockValue}>
          <Text style={text.muted}>В закупке</Text>
          <Text style={text.amount}>
            {formatMoneyWithSign(Math.round((product.stock * product.cost_price) / 1000))}
          </Text>
        </View>
      </View>

      <Text style={[text.muted, styles.hint]}>
        Пересчитали товар? Введите фактическое количество — разница запишется в историю.
      </Text>

      <View style={styles.barcodeRow}>
        <TextInput
          value={actual}
          onChangeText={setActual}
          placeholder={formatQty(product.stock)}
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          style={styles.barcodeInput}
        />
        <Button
          title="Пересчёт"
          variant="secondary"
          onPress={applyInventory}
          disabled={!actual.trim()}
          style={styles.scanButton}
        />
      </View>
    </Card>
  );
}

/** История движений — объясняет, откуда взялся текущий остаток. */
function HistoryCard({ productId }: { productId: number }) {
  const moves = useQuery((database) => listMoves(database, productId, 30), [productId]);

  return (
    <Card style={styles.historyCard}>
      <Text style={[text.heading, styles.historyTitle]}>История движений</Text>

      {moves.length === 0 ? (
        <Text style={[text.muted, styles.historyEmpty]}>Движений пока не было</Text>
      ) : (
        moves.map((move) => (
          <Row
            key={move.id}
            left={
              <>
                <Text style={text.body}>{REASON_LABEL[move.reason]}</Text>
                <Text style={text.muted}>
                  {new Date(move.created_at).toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {move.counterparty ? ` · ${move.counterparty}` : ''}
                </Text>
              </>
            }
            right={
              <Badge
                label={`${move.qty_delta > 0 ? '+' : ''}${formatQty(move.qty_delta)} ${move.unit}`}
                tone={move.qty_delta > 0 ? 'success' : 'danger'}
              />
            }
          />
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  photoBox: {
    height: 140,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
  pair: { flexDirection: 'row', gap: spacing.md },
  pairInput: { flex: 1 },
  barcodeRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  barcodeInput: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  scanButton: { minWidth: 96 },
  hint: { marginTop: spacing.xs, marginBottom: spacing.md, fontSize: 12 },
  stockHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  stockValue: { alignItems: 'flex-end' },
  historyCard: { padding: 0, paddingTop: spacing.lg, overflow: 'hidden' },
  historyTitle: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  historyEmpty: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
});
