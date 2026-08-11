import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { importParties, importProducts, type ImportResult } from '../src/db/import';
import { seedCatalog } from '../src/db/seed';
import { useDatabase } from '../src/state/DatabaseProvider';
import { say } from '../src/ui/alert';
import { pickFile } from '../src/ui/download';
import { saveFile } from '../src/ui/download';
import { Button, Card } from '../src/ui/components';
import { colors, spacing, text } from '../src/ui/theme';

/**
 * Загрузка справочников из файла.
 *
 * Программа рассчитана не на один магазин: свои товары и клиентов заводит
 * тот, кто её поставил. Поэтому импорт — не служебная кнопка, а способ
 * начать работу, и живёт он на своём экране, а не в настройках.
 *
 * Формат — обычный CSV из Excel. Колонки распознаются по заголовку, лишние
 * не мешают, порядок неважен: у каждой программы выгрузка своя, и требовать
 * точный формат значило бы заставлять переделывать файл руками.
 */

type Kind = 'products' | 'customers' | 'suppliers';

const TITLE: Record<Kind, string> = {
  products: 'Импорт товаров',
  customers: 'Импорт клиентов',
  suppliers: 'Импорт поставщиков',
};

/** Какие колонки понимает загрузчик — список показывается прямо на экране. */
const COLUMNS: Record<Kind, string[]> = {
  products: [
    'Наименование — обязательно',
    'Вид — товар, услуга или комплект',
    'Код товара · Артикул · Штрих-код',
    'Ед. изм.',
    'Цена продажи · Цена закупки · Себестоимость',
    'Скидка · Страна · PLU код',
    'Категории — несколько через запятую',
    'Срок годности · Мин. остаток',
    'Остаток — заведётся одним документом',
    'Магазин — куда положить остаток',
  ],
  customers: [
    'Наименование — обязательно',
    'Телефон — по нему ищется совпадение',
    'Почта · Адрес · Пол',
    'День рождения',
    'Скидка · Описание',
  ],
  suppliers: [
    'Наименование — обязательно',
    'Телефон · Почта · Адрес',
    'Описание',
  ],
};

/** Образец файла: по нему видно и колонки, и как записывать значения. */
const SAMPLE: Record<Kind, string> = {
  products:
    'Наименование;Вид;Артикул;Штрих-код;Ед. изм.;Цена продажи;Цена закупки;Категории;Остаток\n' +
    'Шу пуэр 2019;товар;SH-01;4600000000001;кг;5000,00;2000,00;Пуэр, Подарочное;8\n' +
    'Чайная церемония;услуга;;;шт;1500,00;;Услуги;\n',
  customers:
    'Наименование;Телефон;Почта;День рождения;Пол;Скидка\n' +
    'Анна Иванова;+7 (999) 123-45-67;anna@example.com;13/07/1990;Женский;5\n',
  suppliers: 'Наименование;Телефон;Почта;Описание\nЧайный дом;+7 999 000-00-00;;Пуэры и улуны\n',
};

export default function ImportScreen() {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const params = useLocalSearchParams<{ kind?: string }>();

  const kind: Kind =
    params.kind === 'customers' || params.kind === 'suppliers' ? params.kind : 'products';

  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const file = await pickFile('.csv,text/csv,text/plain');
    if (!file) return;

    setBusy(true);
    try {
      const content = new TextDecoder('utf-8').decode(file);
      const loaded =
        kind === 'products'
          ? importProducts(db, content)
          : importParties(db, content, kind === 'suppliers' ? 'supplier' : 'customer');

      setResult(loaded);
      refresh();
    } catch (error) {
      say('Не удалось прочитать файл', String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: TITLE[kind] }} />

      <Card>
        <Text style={text.heading}>{TITLE[kind]}</Text>
        <Text style={[text.muted, styles.note]}>
          Файл CSV, какой сохраняет Excel («CSV с разделителями» подойдёт).
          Разделитель определяется сам, лишние колонки не мешают.
        </Text>

        <Button title={busy ? 'Читаю…' : 'Выбрать файл'} onPress={load} disabled={busy} />
        <Button
          title="Скачать образец"
          variant="secondary"
          onPress={() => saveFile(`образец-${kind}.csv`, `﻿${SAMPLE[kind]}`, 'text/csv;charset=utf-8')}
        />
      </Card>

      {result ? (
        <Card>
          <Text style={text.heading}>Загружено</Text>
          <Line label="Добавлено" value={String(result.added)} />
          <Line label="Обновлено" value={String(result.updated)} />
          <Line label="Не разобрано" value={String(result.problems.length)} />

          {result.problems.length > 0 ? (
            <>
              <Text style={[text.muted, styles.note]}>
                Эти строки пропущены — остальные загрузились:
              </Text>
              {result.problems.slice(0, 20).map((problem) => (
                <Text key={problem.line} style={styles.problem}>
                  строка {problem.line}: {problem.reason}
                </Text>
              ))}
              {result.problems.length > 20 ? (
                <Text style={text.muted}>…и ещё {result.problems.length - 20}</Text>
              ) : null}
            </>
          ) : null}

          <Button title="Готово" onPress={() => router.back()} />
        </Card>
      ) : null}

      <Card>
        <Text style={text.heading}>Какие колонки понимает</Text>
        {COLUMNS[kind].map((column) => (
          <Text key={column} style={styles.column}>
            · {column}
          </Text>
        ))}
        <Text style={[text.muted, styles.note]}>
          Товар опознаётся по штрихкоду, затем по коду и артикулу. Поэтому
          повторная загрузка того же файла не создаёт дубли, а обновляет цены.
        </Text>
      </Card>

      {kind === 'products' ? (
        <Card>
          <Text style={text.heading}>Посмотреть на примере</Text>
          <Text style={[text.muted, styles.note]}>
            Программа приходит пустой — своих товаров у неё нет. Если хочется
            сперва посмотреть, как всё выглядит с данными, загрузите пример:
            каталог чайной с остатками по магазинам и клиентской базой.
          </Text>
          <Button
            title="Загрузить пример"
            variant="secondary"
            onPress={() => {
              seedCatalog(db);
              refresh();
              say('Пример загружен', 'Каталог, клиенты и кассы заполнены примерными данными.');
            }}
          />
        </Card>
      ) : null}
    </ScrollView>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={text.muted}>{label}</Text>
      <Text style={text.body}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl, maxWidth: 900, width: '100%' },
  note: { marginTop: spacing.xs, marginBottom: spacing.md, fontSize: 13, lineHeight: 19 },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  column: { fontSize: 14, color: colors.text, paddingVertical: 3 },
  problem: { fontSize: 13, color: colors.danger, paddingVertical: 2 },
});
