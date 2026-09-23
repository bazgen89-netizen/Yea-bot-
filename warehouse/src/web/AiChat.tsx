import { useEffect, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  Text as RnText,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from './Translated';

import { runSql, type AskResult } from '../db/ask';
import {
  ASK_KEY_HINT,
  ASK_KEY_PAGE,
  ASK_KINDS,
  ASK_NAMES,
  chooseAskKind,
  getAskSettings,
  hasAskKey,
  saveAskSettings,
  type AskKind,
} from '../db/askSettings';
import type { SqlDriver } from '../db/driver';
import { какСказал, type Реплика } from '../domain/askPrompt';
import { askWarehouse } from '../net/assistant';
import { ServerError } from '../net/server';
import { useDatabase, useQuery } from '../state/DatabaseProvider';
import { colors } from '../ui/theme';
import { useDesktop } from '../ui/useDesktop';
import { WebIcon } from '../ui/icons';
import { web, WEB_FONT } from '../ui/webTheme';
import { Ответ_ } from './screens/Assistant';

/**
 * Чат с ИИ.
 *
 * Вазген: «спросить у склада как-то не вписывается. Может сделать не
 * страницу, а чат, где можно спросить у искусственного интеллекта, и
 * оформить это современно». Прежний экран был анкетой: поле, кнопка, один
 * ответ, и следующий вопрос стирал предыдущий. Здесь — разговор: вопросы и
 * ответы идут лентой, «а в июле?» понимается как продолжение, а спросить
 * можно не только про цифры, но и совета.
 *
 * Модели три — Gemini, DeepSeek, ChatGPT. Клода нет: Вазген убрал его как
 * платного — «там будут люди пользоваться, надо бесплатную». По-настоящему
 * бесплатный из троих только Gemini, поэтому он первый и по умолчанию.
 *
 * Отвечать про склад модель по-прежнему может только запросом к базе, а
 * считает само устройство: наружу уходит вопрос и описание таблиц, но не
 * товары, чеки и телефоны клиентов. Это сказано в самом чате.
 *
 * Два вида: `панель` — выезжает справа поверх любой страницы кабинета;
 * `экран` — на телефоне, на всё окно.
 */

interface Сообщение {
  id: number;
  роль: 'user' | 'assistant';
  текст: string;
  /** Запрос, которым посчитан ответ. Пусто — ответ словами. */
  sql?: string;
  /** Посчитанное. `null` — сообщение из прошлого раза, таблицу не храним. */
  результат?: AskResult | null;
  /** Ответ не пришёл — текст беды. */
  беда?: boolean;
}

/** Что показать, пока не спросили ничего. Два про склад, два — просто так. */
const ПОДСКАЗКИ = [
  'Что лучше всего продавалось в этом месяце?',
  'Какие товары скоро закончатся?',
  'Придумай пост про новый улун для Instagram',
  'Как поднять средний чек в чайной?',
];

const КЛЮЧ_ИСТОРИИ = 'ai_chat';
/** Сколько сообщений помнить между запусками. Больше глазами не листают. */
const ХРАНИМ = 60;

export function ЧатИИ({ вид, onClose }: { вид: 'панель' | 'экран'; onClose?: () => void }) {
  const { db, refresh } = useDatabase();
  const settings = useQuery((база) => getAskSettings(база));
  const готовы = useQuery((база) =>
    Object.fromEntries(ASK_KINDS.map((kind) => [kind, hasAskKey(база, kind)])),
  ) as Record<AskKind, boolean>;

  /*
   * Цвет кнопок и своих реплик. В кабинете — палитры кабинета; на телефоне —
   * синий самого телефонного приложения: зелёные кнопки кабинета под синей
   * шапкой телефона выглядели чужими.
   */
  const desktop = useDesktop();
  const акцент = desktop ? web.action : colors.primary;
  const залить = { backgroundColor: акцент };

  const [сообщения, setСообщения] = useState<Сообщение[]>(() => загрузить(db));
  const [ввод, setВвод] = useState('');
  const [думает, setДумает] = useState(false);
  const лента = useRef<ScrollView>(null);

  useEffect(() => сохранить(db, сообщения), [db, сообщения]);

  const естьКлюч = готовы[settings.kind];

  const отправить = async (текст: string) => {
    const вопрос = текст.trim();
    if (!вопрос || думает || !естьКлюч) return;

    const история: Реплика[] = сообщения
      .filter((одно) => !одно.беда)
      .map((одно) => ({
        роль: одно.роль,
        текст: одно.роль === 'assistant' ? какСказал(одно.текст, одно.sql ?? '') : одно.текст,
      }));

    const мой: Сообщение = { id: Date.now(), роль: 'user', текст: вопрос };
    setСообщения((было) => [...было, мой]);
    setВвод('');
    setДумает(true);

    try {
      const ответ = await askWarehouse(db, вопрос, { чат: true, история });
      setСообщения((было) => [
        ...было,
        {
          id: Date.now() + 1,
          роль: 'assistant',
          текст: ответ.comment,
          sql: ответ.sql,
          результат: ответ.result,
        },
      ]);
    } catch (error) {
      setСообщения((было) => [
        ...было,
        {
          id: Date.now() + 1,
          роль: 'assistant',
          текст: error instanceof ServerError ? error.message : String(error),
          беда: true,
        },
      ]);
    } finally {
      setДумает(false);
    }
  };

  return (
    <View style={вид === 'панель' ? styles.панель : styles.экран}>
      {/* На телефоне «ИИ-помощник» уже написан в шапке самого экрана —
          второй раз его не повторяем, остаётся только строка о модели. */}
      <View style={[styles.шапка, !desktop && styles.шапкаТонкая]}>
        {desktop ? (
          <View style={[styles.значок, залить]}>
            <WebIcon.sparkles size={16} color="#FFFFFF" />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          {desktop ? <Text style={styles.заголовок}>ИИ-помощник</Text> : null}
          <RnText style={styles.подзаголовок}>
            {ASK_NAMES[settings.kind]}
            {settings.kind === 'gemini' ? ' · бесплатно' : ' · платно'}
          </RnText>
        </View>
        {сообщения.length ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Новый разговор"
            onPress={() => setСообщения([])}
            hitSlop={8}
            style={styles.кнопкаШапки}
          >
            <WebIcon.trash size={18} color={web.textMuted} />
          </Pressable>
        ) : null}
        {onClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть чат"
            onPress={onClose}
            hitSlop={8}
            style={styles.кнопкаШапки}
          >
            <WebIcon.close size={22} color={web.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* Переключатель модели. Точка — есть ли у неё ключ. */}
      <View style={styles.модели}>
        {ASK_KINDS.map((kind) => {
          const выбрана = kind === settings.kind;
          return (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityState={{ selected: выбрана }}
              onPress={() => {
                chooseAskKind(db, kind);
                refresh();
              }}
              style={[styles.модель, выбрана && styles.модельВыбрана]}
            >
              <View
                style={[styles.точка, { backgroundColor: готовы[kind] ? '#22C55E' : web.border }]}
              />
              <RnText style={[styles.модельИмя, выбрана && styles.модельИмяВыбрана]}>
                {ASK_NAMES[kind]}
              </RnText>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        ref={лента}
        style={styles.лента}
        contentContainerStyle={styles.лентаВнутри}
        onContentSizeChange={() => лента.current?.scrollToEnd({ animated: true })}
      >
        {!естьКлюч ? <НуженКлюч kind={settings.kind} акцент={акцент} /> : null}

        {естьКлюч && !сообщения.length ? (
          <View style={styles.пусто}>
            <View style={styles.пустоЗначок}>
              <WebIcon.sparkles size={28} color={акцент} />
            </View>
            <Text style={styles.пустоЗаголовок}>Чем помочь?</Text>
            <Text style={styles.пустоТекст}>
              Спросите про продажи, остатки и клиентов — посчитаю по вашему складу. Или просто
              попросите совета или текст.
            </Text>
            <View style={styles.подсказки}>
              {ПОДСКАЗКИ.map((одна) => (
                <Pressable
                  key={одна}
                  accessibilityRole="button"
                  onPress={() => void отправить(одна)}
                  style={styles.подсказка}
                >
                  <RnText style={styles.подсказкаТекст}>{одна}</RnText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {сообщения.map((одно) =>
          одно.роль === 'user' ? (
            <View key={одно.id} style={styles.мояСтрока}>
              <View style={[styles.мой, залить]}>
                <RnText selectable style={styles.мойТекст}>
                  {одно.текст}
                </RnText>
              </View>
            </View>
          ) : (
            <Реплика_ key={одно.id} одно={одно} db={db} акцент={акцент} />
          ),
        )}

        {думает ? (
          <View style={styles.егоСтрока}>
            <View style={[styles.аватар, залить]}>
              <WebIcon.sparkles size={13} color="#FFFFFF" />
            </View>
            <View style={[styles.его, styles.думает]}>
              <Text style={styles.думаетТекст}>Думаю…</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.низ}>
        <View style={[styles.поле, !естьКлюч && { opacity: 0.5 }]}>
          <TextInput
            value={ввод}
            onChangeText={setВвод}
            editable={естьКлюч}
            placeholder={естьКлюч ? 'Спросите что угодно…' : 'Сначала вставьте ключ выше'}
            placeholderTextColor={web.textMuted}
            multiline
            style={styles.ввод}
            onKeyPress={(event) => {
              // На компьютере Enter отправляет, Shift+Enter — новая строка.
              const e = event.nativeEvent as { key: string; shiftKey?: boolean };
              if (Platform.OS === 'web' && e.key === 'Enter' && !e.shiftKey) {
                (event as unknown as { preventDefault: () => void }).preventDefault();
                void отправить(ввод);
              }
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Отправить"
            disabled={!ввод.trim() || думает || !естьКлюч}
            onPress={() => void отправить(ввод)}
            style={[styles.отправить, залить, (!ввод.trim() || думает) && styles.отправитьВыкл]}
          >
            <WebIcon.send size={18} color="#FFFFFF" />
          </Pressable>
        </View>
        <Text style={styles.сноска}>
          Наружу уходит только вопрос и список таблиц — не товары, не чеки и не телефоны. Считает
          ваше устройство.
        </Text>
      </View>
    </View>
  );
}

/** Ответ помощника: слова, таблица, если считал, и чем считал. */
function Реплика_({ одно, db, акцент }: { одно: Сообщение; db: SqlDriver; акцент: string }) {
  const [таблица, setТаблица] = useState(одно.результат ?? null);
  const [вся, setВся] = useState(false);
  const [запрос, setЗапрос] = useState(false);

  return (
    <View style={styles.егоСтрока}>
      <View style={[styles.аватар, { backgroundColor: одно.беда ? web.danger : акцент }]}>
        <WebIcon.sparkles size={13} color="#FFFFFF" />
      </View>
      <View style={[styles.его, одно.беда && styles.беда]}>
        {одно.текст ? (
          <RnText selectable style={[styles.егоТекст, одно.беда && { color: web.danger }]}>
            {одно.текст}
          </RnText>
        ) : null}

        {таблица ? (
          вся ? (
            <View style={styles.всяТаблица}>
              <Ответ_
                ответ={{ comment: '', sql: одно.sql ?? '', result: таблица, через: 'ключ' }}
              />
            </View>
          ) : (
            <МалаяТаблица результат={таблица} />
          )
        ) : null}

        {/* Таблицу между запусками не храним — пересчитать её можно даром:
            считает устройство, к модели обращаться не нужно. */}
        {одно.sql && !таблица ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              try {
                setТаблица(runSql(db, одно.sql!));
              } catch {
                // Запрос устарел — например, таблицы поменялись. Молча ничего.
              }
            }}
          >
            <Text style={styles.ссылка}>Посчитать снова</Text>
          </Pressable>
        ) : null}

        {одно.sql ? (
          <View style={styles.ссылки}>
            {таблица && таблица.rows.length > 5 ? (
              <Pressable accessibilityRole="button" onPress={() => setВся(!вся)}>
                <RnText style={styles.ссылка}>
                  {вся ? 'Свернуть' : `Вся таблица · ${таблица.total} строк`}
                </RnText>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => setЗапрос(!запрос)}>
              <Text style={styles.ссылка}>{запрос ? 'Скрыть, как посчитано' : 'Как посчитано'}</Text>
            </Pressable>
          </View>
        ) : null}

        {запрос && одно.sql ? (
          <RnText selectable style={styles.код}>
            {одно.sql}
          </RnText>
        ) : null}
      </View>
    </View>
  );
}

/** Первые строки ответа — чтобы не листать чат через таблицу на двести строк. */
function МалаяТаблица({ результат }: { результат: AskResult }) {
  const строки = результат.rows.slice(0, 5);
  if (!результат.rows.length) {
    return <Text style={styles.пустаяТаблица}>Ничего не нашлось.</Text>;
  }

  return (
    <ScrollView horizontal style={styles.малая} showsHorizontalScrollIndicator={false}>
      <View>
        <View style={styles.малаяШапка}>
          {результат.columns.map((колонка, j) => (
            <RnText
              key={колонка}
              style={[styles.малаяЯчейка, styles.малаяЗаголовок, j === 0 && styles.перваяЯчейка]}
            >
              {колонка}
            </RnText>
          ))}
        </View>
        {строки.map((строка, i) => (
          <View key={i} style={styles.малаяСтрока}>
            {строка.map((значение, j) => (
              <RnText
                key={j}
                style={[
                  styles.малаяЯчейка,
                  j === 0 && styles.перваяЯчейка,
                  typeof значение === 'number' && styles.число,
                ]}
                numberOfLines={1}
              >
                {вид(значение)}
              </RnText>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function вид(значение: unknown): string {
  if (значение === null || значение === undefined) return '—';
  if (typeof значение === 'number') {
    return значение.toLocaleString('ru-RU', {
      maximumFractionDigits: Number.isInteger(значение) ? 0 : 2,
    });
  }
  return String(значение);
}

/**
 * Ключа нет — показываем, где взять, прямо в ленте.
 *
 * Не «зайдите в настройки», а поле здесь же: вставил — и спрашивай. Для
 * Gemini отдельно сказано, что он бесплатный, — это и есть ответ на «надо
 * бесплатную версию».
 */
function НуженКлюч({ kind, акцент }: { kind: AskKind; акцент: string }) {
  const { db, refresh } = useDatabase();
  const [ключ, setКлюч] = useState('');

  return (
    <View style={styles.ключ}>
      <Text style={styles.ключЗаголовок}>Нужен ключ {ASK_NAMES[kind]}</Text>
      <Text style={styles.ключТекст}>
        {kind === 'gemini'
          ? 'Gemini бесплатный: ключ выдаёт Google, платить не нужно — есть только ограничение по числу вопросов в минуту. Войдите своим Google-аккаунтом, нажмите «Create API key» и скопируйте ключ сюда.'
          : kind === 'deepseek'
            ? 'DeepSeek платный, но дешёвый — копейки за вопрос. Счёт пополняется в личном кабинете DeepSeek.'
            : 'ChatGPT платный: вопросы оплачиваются с баланса в личном кабинете OpenAI.'}
      </Text>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(ASK_KEY_PAGE[kind])}>
        <Text style={styles.ссылка}>Получить ключ {ASK_NAMES[kind]} →</Text>
      </Pressable>
      <View style={styles.ключСтрока}>
        <TextInput
          value={ключ}
          onChangeText={setКлюч}
          placeholder={ASK_KEY_HINT[kind]}
          placeholderTextColor={web.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.ключПоле}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!ключ.trim()}
          onPress={() => {
            const был = getAskSettings(db);
            saveAskSettings(db, { kind, key: ключ.trim(), model: был.kind === kind ? был.model : '' });
            setКлюч('');
            refresh();
          }}
          style={[styles.ключКнопка, { backgroundColor: акцент }, !ключ.trim() && { opacity: 0.5 }]}
        >
          <Text style={styles.ключКнопкаТекст}>Сохранить</Text>
        </Pressable>
      </View>
      <Text style={styles.сноска}>
        Ключ остаётся в этом браузере. В файле программы его нет — файл можно переслать, не выдав
        ключ.
      </Text>
    </View>
  );
}

/** История разговора — в базе устройства, как и прочие настройки. */
function загрузить(db: SqlDriver): Сообщение[] {
  try {
    const row = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [
      КЛЮЧ_ИСТОРИИ,
    ]);
    if (!row) return [];
    const было = JSON.parse(row.value) as Сообщение[];
    // Таблицы не хранятся: их можно пересчитать даром, а место в базе они
    // заняли бы быстро — двести строк на ответ.
    return было.map((одно) => ({ ...одно, результат: null }));
  } catch {
    return [];
  }
}

function сохранить(db: SqlDriver, сообщения: Сообщение[]): void {
  try {
    const лёгкие = сообщения
      .slice(-ХРАНИМ)
      .map(({ id, роль, текст, sql, беда }) => ({ id, роль, текст, sql, беда }));
    db.run(
      `INSERT INTO app_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [КЛЮЧ_ИСТОРИИ, JSON.stringify(лёгкие)],
    );
  } catch {
    // Не записалось — разговор просто не переживёт перезагрузку.
  }
}

const радиус = 18;

const styles = StyleSheet.create({
  панель: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 440,
    maxWidth: '100%',
    backgroundColor: web.bg,
    borderLeftWidth: 1,
    borderLeftColor: web.border,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: -6, height: 0 },
    zIndex: 50,
  },
  экран: { flex: 1, backgroundColor: web.bg },

  шапка: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  значок: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: web.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  заголовок: { fontFamily: WEB_FONT, fontSize: 17, fontWeight: '600', color: web.text },
  подзаголовок: { fontFamily: WEB_FONT, fontSize: 12.5, color: web.textMuted, marginTop: 1 },
  кнопкаШапки: { padding: 6 },
  шапкаТонкая: { paddingTop: 10, paddingBottom: 8 },

  модели: {
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: 18,
    marginBottom: 10,
    padding: 4,
    borderRadius: 12,
    backgroundColor: web.pageBg,
  },
  модель: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 9,
  },
  модельВыбрана: {
    backgroundColor: web.bg,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  точка: { width: 7, height: 7, borderRadius: 4 },
  модельИмя: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted, fontWeight: '500' },
  модельИмяВыбрана: { color: web.text, fontWeight: '600' },

  лента: { flex: 1, borderTopWidth: 1, borderTopColor: web.border },
  лентаВнутри: { padding: 18, gap: 14, flexGrow: 1 },

  мояСтрока: { flexDirection: 'row', justifyContent: 'flex-end' },
  мой: {
    maxWidth: '85%',
    backgroundColor: web.action,
    borderRadius: радиус,
    borderBottomRightRadius: 5,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  мойТекст: { fontFamily: WEB_FONT, fontSize: 14.5, lineHeight: 20, color: '#FFFFFF' },

  егоСтрока: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  аватар: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: web.action,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  его: {
    flexShrink: 1,
    maxWidth: '88%',
    backgroundColor: web.pageBg,
    borderRadius: радиус,
    borderTopLeftRadius: 5,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  егоТекст: { fontFamily: WEB_FONT, fontSize: 14.5, lineHeight: 21, color: web.text },
  беда: { borderWidth: 1, borderColor: web.danger },
  думает: { paddingVertical: 12 },
  думаетТекст: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted, fontStyle: 'italic' },

  ссылки: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  ссылка: { fontFamily: WEB_FONT, fontSize: 13, color: web.link, fontWeight: '500' },
  код: {
    fontFamily: Platform.select({ web: 'ui-monospace, Menlo, Consolas, monospace', default: 'monospace' }),
    fontSize: 12,
    lineHeight: 17,
    color: web.text,
    backgroundColor: web.bg,
    borderRadius: 8,
    padding: 10,
  },

  малая: { borderRadius: 10, backgroundColor: web.bg },
  малаяШапка: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: web.border },
  малаяСтрока: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: web.gridLine },
  малаяЯчейка: {
    width: 120,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontFamily: WEB_FONT,
    fontSize: 12.5,
    color: web.text,
  },
  малаяЗаголовок: { fontWeight: '600', color: web.textMuted },
  /** Первая колонка — названия товаров, им нужно больше места, чем числам. */
  перваяЯчейка: { width: 180 },
  число: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  пустаяТаблица: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  всяТаблица: { marginHorizontal: -14 },

  пусто: { alignItems: 'center', paddingTop: 36, paddingHorizontal: 6, gap: 8 },
  пустоЗначок: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: web.pageBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  пустоЗаголовок: { fontFamily: WEB_FONT, fontSize: 21, fontWeight: '600', color: web.text },
  пустоТекст: {
    fontFamily: WEB_FONT,
    fontSize: 14,
    lineHeight: 20,
    color: web.textMuted,
    textAlign: 'center',
    maxWidth: 330,
  },
  подсказки: { width: '100%', gap: 8, marginTop: 14 },
  подсказка: {
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  подсказкаТекст: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  ключ: {
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  ключЗаголовок: { fontFamily: WEB_FONT, fontSize: 16, fontWeight: '600', color: web.text },
  ключТекст: { fontFamily: WEB_FONT, fontSize: 13.5, lineHeight: 19, color: web.textMuted },
  ключСтрока: { flexDirection: 'row', gap: 8 },
  ключПоле: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
    outlineStyle: 'none',
  } as object,
  ключКнопка: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: web.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ключКнопкаТекст: { fontFamily: WEB_FONT, fontSize: 14, fontWeight: '600', color: '#FFFFFF' },

  низ: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14, gap: 6 },
  поле: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 22,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    backgroundColor: web.bg,
  },
  ввод: {
    flex: 1,
    minHeight: 34,
    maxHeight: 130,
    paddingVertical: 7,
    fontFamily: WEB_FONT,
    fontSize: 14.5,
    color: web.text,
    outlineStyle: 'none',
  } as object,
  отправить: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: web.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  отправитьВыкл: { opacity: 0.35 },
  сноска: { fontFamily: WEB_FONT, fontSize: 11.5, lineHeight: 15, color: web.textMuted, textAlign: 'center' },
});
