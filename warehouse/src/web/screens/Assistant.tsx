import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Translated';

import { ToolButton } from '../Table';
import {
  ASK_NAMES,
  getAskSettings,
  saveAskSettings,
  type AskKind,
} from '../../db/askSettings';
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
          Наружу уходит только вопрос и список таблиц: ни товаров, ни чеков, ни телефонов клиентов.
          Считает само устройство.
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

function Ответ_({ ответ }: { ответ: Ответ }) {
  const { result } = ответ;

  return (
    <View style={styles.card}>
      {ответ.comment ? <Text style={styles.comment}>{ответ.comment}</Text> : null}

      {result === null ? null : result.total === 0 ? (
        <Text style={styles.empty}>Ничего не нашлось — по этому вопросу в базе пусто.</Text>
      ) : (
        <>
          <View style={styles.table}>
            <View style={[styles.row, styles.head]}>
              {result.columns.map((column) => (
                <Text key={column} style={[styles.cell, styles.headCell]}>
                  {column}
                </Text>
              ))}
            </View>
            {result.rows.map((row, index) => (
              <View key={index} style={[styles.row, index % 2 === 1 && styles.stripe]}>
                {row.map((value, place) => (
                  <Text key={place} style={styles.cell}>
                    {value === null || value === undefined ? '—' : String(value)}
                  </Text>
                ))}
              </View>
            ))}
          </View>

          {result.total > result.rows.length ? (
            <Text style={styles.more}>
              Показаны первые {result.rows.length} строк из {result.total}.
            </Text>
          ) : null}
        </>
      )}

      {ответ.sql ? (
        <View style={styles.sqlBox}>
          <Text style={styles.sqlTitle}>
            Чем он это посчитал {ответ.через === 'ключ' ? '(своим ключом)' : '(через сервер)'}
          </Text>
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

  comment: { fontFamily: WEB_FONT, fontSize: 16, color: web.text, lineHeight: 24 },
  empty: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },

  table: { borderWidth: 1, borderColor: web.border, borderRadius: 3, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  head: { backgroundColor: '#F9FAFB' },
  stripe: { backgroundColor: '#FCFCFD' },
  cell: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  headCell: { fontWeight: '600', color: web.textMuted },
  more: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  sqlBox: {
    backgroundColor: '#F7F8F9',
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    padding: 14,
    gap: 8,
  },
  sqlTitle: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  sql: { fontFamily: 'monospace', fontSize: 13, color: web.text, lineHeight: 20 },
});
