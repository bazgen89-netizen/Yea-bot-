import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Translated';

import { ToolButton } from '../Table';
import {
  ASK_NAMES,
  getAskSettings,
  saveAskSettings,
  type AskKind,
} from '../../db/askSettings';
import type { AskResult } from '../../db/ask';
import {
  isMoneyColumn,
  отобрать,
  самСтолбец,
  суммы,
  упорядочить,
} from '../../domain/askTable';
import { askWarehouse, askWay, type Ответ } from '../../net/assistant';
import { ServerError } from '../../net/server';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { web, webText, WEB_FONT, FORM_BORDER } from '../../ui/webTheme';

/**
 * «Спросить у склада».
 *
 * Смысл экрана в одном: владелец знает, что хочет узнать, но не знает, в
 * какой отчёт за этим идти. «Сколько я заработал на пуэре в августе» — это
 * не отчёт «Продажи по товарам» с четырьмя фильтрами, это вопрос. Здесь его
 * и задают.
 *
 * Запрос показывается всегда, а не прячется под «подробнее». Ответ, которому
 * нельзя заглянуть внутрь, — это не ответ, а гадание: человек имеет право
 * увидеть, что именно посчитали, и не поверить.
 *
 * Наружу уходит только вопрос и список таблиц. Считает устройство, у себя.
 * Это написано на самом экране — не мелким шрифтом внизу, а там, где видно.
 *
 * Настройка стоит здесь же, а не в отдельном разделе. Так вышло не из
 * удобства: сперва помощник умел спрашивать только через сервер, и на пустом
 * складе экран говорил «войдите в учётную запись магазина» — а входить было
 * некуда, сервер не поднят. Тупик. Теперь, если спросить пока нечем, экран
 * не отсылает никуда, а сразу показывает, что вписать.
 */

/**
 * Вопросы, с которых начинают.
 *
 * Пустое поле ввода и мигающий курсор — худшее начало: человек не знает, что
 * можно спрашивать, и уходит. Эти пять взяты из того, что он спрашивает
 * вслух про свою лавку.
 */
const ПРИМЕРЫ = [
  'Какие товары кончаются — осталось меньше 100 грамм?',
  'Что лучше всего продавалось в прошлом месяце?',
  'Сколько выручки было по каждому магазину за август?',
  'На каких товарах я больше всего заработал?',
  'Кто из клиентов покупал больше всех за всё время?',
];

/**
 * Где взять ключ — ссылкой, чтобы не искать.
 *
 * Адрес консоли Клода переехал с `console.anthropic.com` на
 * `platform.claude.com`; старый пока переадресует, но вести человека надо
 * сразу туда, где он окажется.
 */
const ГДЕ_КЛЮЧ: Record<AskKind, string> = {
  claude: 'https://platform.claude.com/settings/keys',
  openai: 'https://platform.deepseek.com/api_keys',
};

export function Assistant() {
  const { db } = useDatabase();
  const way = useQuery((database) => askWay(database));

  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [ответ, setОтвет] = useState<Ответ | null>(null);
  const [беда, setБеда] = useState('');
  const [настройка, setНастройка] = useState(false);

  const спросить = async (текст: string) => {
    const вопрос = текст.trim();
    if (!вопрос || busy) return;

    setBusy(true);
    setБеда('');
    setОтвет(null);

    try {
      setОтвет(await askWarehouse(db, вопрос));
    } catch (error) {
      setБеда(error instanceof ServerError ? error.message : String(error));
      // Спрашивать нечем — сразу открываем настройку, а не оставляем в тупике.
      if (way === null) setНастройка(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={webText.pageTitle}>Спросить у склада</Text>

      <View style={styles.card}>
        <Text style={styles.note}>
          Спросите обычными словами — помощник посчитает по вашему складу и покажет, чем считал.
          Наружу уходит вопрос, список таблиц и служебные слова программы («cash», «шт», «receipt»).
          Ни одного товара, чека или телефона клиента. Считает само устройство.
        </Text>

        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder="Например: сколько я заработал на пуэре в августе"
          placeholderTextColor={web.textMuted}
          multiline
          style={styles.input}
          onSubmitEditing={() => спросить(question)}
        />

        <View style={styles.actions}>
          <ToolButton
            label={busy ? 'Считаю…' : 'Спросить'}
            tone="green"
            onPress={() => спросить(question)}
          />
          {ответ || беда ? (
            <ToolButton
              label="Очистить"
              onPress={() => {
                setQuestion('');
                setОтвет(null);
                setБеда('');
              }}
            />
          ) : null}
          <Pressable accessibilityRole="button" onPress={() => setНастройка(!настройка)}>
            <Text style={styles.link}>
              {настройка ? 'Скрыть настройку' : 'Настроить помощника'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.examples}>
          <Text style={styles.examplesTitle}>С чего начать:</Text>
          {ПРИМЕРЫ.map((пример) => (
            <Pressable
              key={пример}
              accessibilityRole="button"
              onPress={() => {
                setQuestion(пример);
                спросить(пример);
              }}
            >
              <Text style={styles.example}>{пример}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {беда ? (
        <View style={[styles.card, styles.trouble]}>
          <Text style={styles.troubleText}>{беда}</Text>
        </View>
      ) : null}

      {ответ ? <Ответ_ ответ={ответ} /> : null}

      {настройка || way === null ? <Настройка onSaved={() => setНастройка(true)} /> : null}
    </ScrollView>
  );
}

/**
 * Чем помощник отвечает.
 *
 * Два способа, и выбирать между ними человеку почти не надо: свой ключ — это
 * «работает сразу, у себя», сервер — «для многих магазинов сразу». Поэтому
 * на экране стоит ключ, а про сервер сказано одной строкой.
 */
function Настройка({ onSaved }: { onSaved: () => void }) {
  const { db, refresh } = useDatabase();
  const saved = useQuery((database) => getAskSettings(database));

  const [kind, setKind] = useState<AskKind>(saved.kind);
  const [key, setKey] = useState(saved.key);
  const [model, setModel] = useState(saved.model);
  const [сказано, setСказано] = useState('');

  return (
    <View style={styles.card}>
      <Text style={styles.setupTitle}>Настройка помощника</Text>

      <Text style={styles.note}>
        Помощнику нужна модель — она превращает ваш вопрос в подсчёт. Вписанный здесь ключ
        остаётся в этом браузере: в файле программы его нет, и файл можно переслать кому угодно,
        не выдав ключ. Ключ уходит только к самой модели и никуда больше.
      </Text>

      <View style={styles.actions}>
        {(['claude', 'openai'] as AskKind[]).map((one) => (
          <ToolButton
            key={one}
            label={ASK_NAMES[one]}
            tone={kind === one ? 'blueOutline' : 'plain'}
            onPress={() => setKind(one)}
          />
        ))}
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Ключ</Text>
        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder={kind === 'claude' ? 'sk-ant-…' : 'sk-…'}
          placeholderTextColor={web.textMuted}
          style={styles.input}
        />
      </View>

      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(ГДЕ_КЛЮЧ[kind])}
      >
        <Text style={styles.link}>Где взять ключ {ASK_NAMES[kind]} →</Text>
      </Pressable>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Модель (можно оставить пустым)</Text>
        <TextInput
          value={model}
          onChangeText={setModel}
          placeholder={kind === 'claude' ? 'claude-opus-5' : 'deepseek-chat'}
          placeholderTextColor={web.textMuted}
          style={styles.input}
        />
      </View>

      <View style={styles.actions}>
        <ToolButton
          label="Сохранить"
          tone="green"
          onPress={() => {
            saveAskSettings(db, { kind, key: key.trim(), model: model.trim() });
            // Раньше блок настройки после сохранения исчезал вместе с
            // подтверждением: он держался на «спрашивать нечем», а спрашивать
            // стало чем. Человек нажимал «Сохранить» и не видел ничего.
            onSaved();
            refresh();
            setСказано(
              key.trim()
                ? 'Готово. Задайте вопрос выше — помощник ответит.'
                : 'Ключ убран. Помощник будет спрашивать через сервер магазина, если в него вошли.',
            );
          }}
        />
        {saved.key ? (
          <ToolButton
            label="Убрать ключ"
            onPress={() => {
              saveAskSettings(db, { kind, key: '', model });
              setKey('');
              refresh();
              setСказано('Ключ убран.');
            }}
          />
        ) : null}
      </View>

      {сказано ? <Text style={styles.saidText}>{сказано}</Text> : null}

      <View style={styles.divider} />

      <Text style={styles.note}>
        Второй способ — через сервер магазина: тогда ключ лежит на сервере, а не на устройстве, и
        помощник работает у всех сотрудников сразу. Это настраивается на сервере
        (`ASSISTANT_KEY`), а здесь достаточно войти в учётную запись: Компания → Настройки →
        Синхронизация.
      </Text>
    </View>
  );
}

/**
 * Число так, как его читают глазами.
 *
 * Раньше в таблицу падало то, что вернула база: `186400.5`. Столбец с
 * деньгами и столбец с граммами выглядели одинаково, разряды не отбиты, и
 * чтобы понять, сто восемьдесят тысяч это или миллион, приходилось считать
 * нули пальцем. Это и была та самая костыльность.
 */
function число(value: unknown, деньги: boolean): string {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);

  const дробных = деньги ? 2 : Number.isInteger(value) ? 0 : 1;
  const записано = value.toLocaleString('ru-RU', {
    minimumFractionDigits: дробных,
    maximumFractionDigits: дробных,
  });

  return деньги ? `${записано} ₽` : записано;
}

/** Сколько строк показываем зараз. Больше человек глазами не осилит. */
const ПОКАЗЫВАЕМ = 200;

function Ответ_({ ответ }: { ответ: Ответ }) {
  const { result } = ответ;
  const [видноЗапрос, setВидноЗапрос] = useState(false);
  const [отбор, setОтбор] = useState('');
  const [порядок, setПорядок] = useState<{ place: number; убывание: boolean } | null>(null);

  /**
   * Отбор и порядок — на месте, без единого обращения к модели.
   *
   * Он спросил, не нужен ли фильтр. Нужен, и стоить он не должен ничего:
   * строки уже посчитаны и лежат здесь, а переспрашивать модель ради другого
   * порядка — платить за то, что и так есть.
   */
  const строки = useMemo(() => {
    if (!result) return [];
    const отобранные = отобрать(result.rows, отбор);
    const по = порядок ?? { place: самСтолбец(отобранные, result.columns) ?? -1, убывание: true };
    return по.place < 0 ? отобранные : упорядочить(отобранные, по.place, по.убывание);
  }, [result, отбор, порядок]);

  const итоги = useMemo(
    () => (result ? суммы(строки, result.columns) : []),
    [строки, result],
  );

  if (result === null) {
    return (
      <View style={styles.card}>
        {ответ.comment ? <Text style={styles.comment}>{ответ.comment}</Text> : null}
        <Запрос ответ={ответ} видно={видноЗапрос} переключить={() => setВидноЗапрос(!видноЗапрос)} />
      </View>
    );
  }

  const сортировать = (place: number) =>
    setПорядок(
      порядок?.place === place ? { place, убывание: !порядок.убывание } : { place, убывание: true },
    );

  const сейчас = порядок ?? {
    place: самСтолбец(строки, result.columns) ?? -1,
    убывание: true,
  };

  return (
    <View style={styles.card}>
      {ответ.comment ? <Text style={styles.comment}>{ответ.comment}</Text> : null}

      {result.total === 0 ? (
        <Text style={styles.empty}>
          Ничего не нашлось — по этому вопросу в базе пусто. Если ждали другого, посмотрите
          подсчёт: может быть, помощник искал не то.
        </Text>
      ) : (
        <>
          <View style={styles.totals}>
            {result.columns.map((name, place) =>
              итоги[place] === null ? null : (
                <View key={name} style={styles.total}>
                  <Text style={styles.totalValue}>{число(итоги[place], isMoneyColumn(name))}</Text>
                  <Text style={styles.totalLabel}>{name} — всего</Text>
                </View>
              ),
            )}
            <View style={styles.total}>
              <Text style={styles.totalValue}>{строки.length.toLocaleString('ru-RU')}</Text>
              <Text style={styles.totalLabel}>
                {отбор.trim() ? `строк из ${result.total.toLocaleString('ru-RU')}` : 'строк нашлось'}
              </Text>
            </View>
          </View>

          <View style={styles.tools}>
            <TextInput
              value={отбор}
              onChangeText={setОтбор}
              placeholder="Отобрать строки: слово из названия"
              placeholderTextColor={web.textMuted}
              style={styles.filter}
            />
            {отбор || порядок ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setОтбор('');
                  setПорядок(null);
                }}
              >
                <Text style={styles.link}>Сбросить</Text>
              </Pressable>
            ) : null}
            <Text style={styles.hint}>Столбец — заголовок, чтобы упорядочить</Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll}>
            <View style={styles.table}>
              <View style={[styles.row, styles.head]}>
                {result.columns.map((column, place) => (
                  <Pressable
                    key={column}
                    accessibilityRole="button"
                    onPress={() => сортировать(place)}
                    style={place === 0 ? styles.firstCell : styles.numCell}
                  >
                    <Text
                      style={[
                        styles.cell,
                        styles.headCell,
                        итоги[place] !== null && place > 0 ? styles.right : null,
                      ]}
                    >
                      {column}
                      {сейчас.place === place ? (сейчас.убывание ? '  ↓' : '  ↑') : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {строки.slice(0, ПОКАЗЫВАЕМ).map((row, index) => (
                <View key={index} style={[styles.row, index % 2 === 1 && styles.stripe]}>
                  {row.map((value, place) => (
                    <Text
                      key={place}
                      style={[
                        styles.cell,
                        place === 0 ? styles.firstCell : styles.numCell,
                        typeof value === 'number' ? styles.right : null,
                      ]}
                    >
                      {число(value, isMoneyColumn(result.columns[place]))}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>

          {строки.length > ПОКАЗЫВАЕМ ? (
            <Text style={styles.more}>
              Показаны первые {ПОКАЗЫВАЕМ} строк из {строки.length.toLocaleString('ru-RU')} — итоги
              наверху посчитаны по всем.
            </Text>
          ) : null}

          {result.total > result.rows.length ? (
            <Text style={styles.more}>
              Найдено {result.total.toLocaleString('ru-RU')} строк, в работу взяты первые{' '}
              {result.rows.length.toLocaleString('ru-RU')}. Спросите поуже — например, за месяц.
            </Text>
          ) : null}
        </>
      )}

      <Запрос ответ={ответ} видно={видноЗапрос} переключить={() => setВидноЗапрос(!видноЗапрос)} />
    </View>
  );
}

function Запрос({
  ответ,
  видно,
  переключить,
}: {
  ответ: Ответ;
  видно: boolean;
  переключить: () => void;
}) {
  if (!ответ.sql) return null;

  return (
    <View>
      <Pressable accessibilityRole="button" onPress={переключить}>
        <Text style={styles.link}>
          {видно ? 'Скрыть подсчёт' : 'Показать, как это посчитано'}
          {ответ.через === 'ключ' ? '' : ' (через сервер)'}
        </Text>
      </Pressable>
      {видно ? (
        <View style={styles.sqlBox}>
          <Text style={styles.sql}>{ответ.sql}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.pageBg },
  content: { padding: 26, gap: 20 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    padding: 22,
    gap: 16,
  },
  note: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted, lineHeight: 21, maxWidth: 780 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: WEB_FONT,
    fontSize: 16,
    color: web.text,
  },
  actions: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  link: { fontFamily: WEB_FONT, fontSize: 14, color: '#2185D0' },
  examples: { gap: 6, marginTop: 4 },
  examplesTitle: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  example: { fontFamily: WEB_FONT, fontSize: 14, color: '#2185D0', lineHeight: 22 },

  setupTitle: { fontFamily: WEB_FONT, fontSize: 18, color: web.text },
  field: { gap: 6 },
  fieldLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  saidText: { fontFamily: WEB_FONT, fontSize: 14, color: '#21BA45' },
  divider: { height: 1, backgroundColor: web.border },

  trouble: { borderColor: '#E0B4B4', backgroundColor: '#FFF6F6' },
  troubleText: { fontFamily: WEB_FONT, fontSize: 15, color: '#9F3A38', lineHeight: 22 },

  comment: { fontFamily: WEB_FONT, fontSize: 17, color: web.text, lineHeight: 26 },
  empty: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted, lineHeight: 23 },

  tools: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  filter: {
    width: 320,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  hint: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  totals: { flexDirection: 'row', flexWrap: 'wrap', gap: 30, paddingVertical: 4 },
  total: { gap: 2 },
  totalValue: { fontFamily: WEB_FONT, fontSize: 26, color: web.text, fontWeight: '500' },
  totalLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  tableScroll: { borderWidth: 1, borderColor: web.border, borderRadius: 3 },
  table: { minWidth: '100%' },
  row: { flexDirection: 'row' },
  head: { backgroundColor: '#F9FAFB' },
  stripe: { backgroundColor: '#FCFCFD' },
  cell: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  // Название — широкое и слева, числа — узкие и справа: так столбец цифр
  // читается сверху вниз, а не рассыпается.
  firstCell: { flex: 3, minWidth: 240 },
  numCell: { flex: 1, minWidth: 110 },
  right: { textAlign: 'right' },
  headCell: { fontWeight: '600', color: web.textMuted },
  more: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  sqlBox: {
    backgroundColor: '#F7F8F9',
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    padding: 14,
    marginTop: 10,
  },
  sql: { fontFamily: 'monospace', fontSize: 13, color: web.text, lineHeight: 20 },
});
