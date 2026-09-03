import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Translated';

import { Dropdown, type Option } from '../Dropdown';
import { ToolButton } from '../Table';
import { stockCsv } from '../../db/export';
import {
  TAX_SYSTEMS,
  VAT_RATES,
  getSettings,
  saveSettings,
  type CompanySettings as Settings,
} from '../../db/settings';
import { seedCounts } from '../../db/seed';
import { getServer, signOut } from '../../db/server';
import { ServerError, register, signIn, syncNow } from '../../net/server';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { pickFile, saveFile } from '../../ui/download';
import { parsePercent } from '../../domain/pricing';
import { web, webText, WEB_FONT, FORM_BORDER } from '../../ui/webTheme';

/**
 * «Настройки / настройки компании» — вкладки, как в оригинале.
 *
 * Значения лежат в одном объекте и сохраняются целиком по кнопке, а не по
 * каждому нажатию клавиши: иначе наполовину набранный ИНН уходил бы в базу
 * и возвращался бы оттуда при следующем открытии.
 */

type Tab = 'main' | 'legal' | 'taxes' | 'report' | 'data' | 'sync';

const TABS: { value: Tab; label: string }[] = [
  { value: 'main', label: 'Основные' },
  { value: 'legal', label: 'Реквизиты' },
  { value: 'taxes', label: 'Налоги' },
  { value: 'report', label: 'Email отчет' },
  { value: 'data', label: 'Данные' },
  { value: 'sync', label: 'Синхронизация' },
];

export function CompanySettings() {
  const { db, refresh } = useDatabase();
  const saved = useQuery((database) => getSettings(database));

  const [tab, setTab] = useState<Tab>('main');
  const [draft, setDraft] = useState<Settings>(saved);

  const set = (patch: Partial<Settings>) => setDraft((current) => ({ ...current, ...patch }));

  function save() {
    saveSettings(db, draft);
    refresh();
    say('Сохранено', 'Настройки компании обновлены.');
  }

  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        {TABS.map((item) => (
          <Pressable
            key={item.value}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === item.value }}
            onPress={() => setTab(item.value)}
            style={[styles.tab, tab === item.value && styles.tabActive]}
          >
            <Text style={[styles.tabLabel, tab === item.value && styles.tabLabelActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === 'main' ? (
          <>
          <Block title="Настройки компании">
            <WebField
              label="Наименование организации"
              value={draft.name}
              onChange={(name) => set({ name })}
            />
            <WebField label="Страна" value={draft.country} onChange={(country) => set({ country })} />
            <WebField
              label="Основная валюта"
              value={draft.currency}
              onChange={(currency) => set({ currency })}
            />
            <WebField
              label="Отображение валюты"
              value={draft.currencyView}
              onChange={(currencyView) => set({ currencyView })}
            />
            {/* Префикс весового штрихкода: две цифры, с которых начинается
                код, напечатанный весами. По ним касса понимает, что в коде
                зашит вес, а не количество. */}
            <WebField
              label="Префикс штрихкода весового товара"
              value={draft.pluPrefix}
              onChange={(pluPrefix) => set({ pluPrefix: pluPrefix.replace(/\D/g, '').slice(0, 2) })}
            />

            {/* Телефоны и почты списками: у него под каждым «добавить еще»,
                и у компании с двумя точками телефонов два. */}
            <ListField
              label="Телефон"
              values={draft.phones}
              placeholder="Введите номер телефона"
              onChange={(phones) => set({ phones })}
            />
            <ListField
              label="Email"
              values={draft.emails}
              placeholder="mail@example.com"
              onChange={(emails) => set({ emails })}
            />
            <WebField label="Cайт" value={draft.site} onChange={(site) => set({ site })} />
          </Block>

          {/* Отдельным блоком, а не строкой среди названий и телефонов:
              это правило работы кассы, и искать его будут не там, где ИНН. */}
          <Block title="Продажа товаров">
            <WebToggle
              label="Разрешить продажу в минус"
              on={draft.negativeSale}
              onChange={(negativeSale) => set({ negativeSale })}
            />
            <Text style={styles.note}>
              Обычно чек не проводится, если товара на складе меньше, чем в чеке. Включите,
              если товар лежит на прилавке, а приход на него ещё не провели: касса пробьёт
              чек, а остаток уйдёт в минус и сам станет верным, когда приход проведут.
            </Text>
          </Block>
          </>
        ) : null}

        {tab === 'legal' ? (
          <Block title="Реквизиты">
            <WebField
              label="Наименование организации"
              value={draft.legalName}
              onChange={(legalName) => set({ legalName })}
            />
            <WebField
              label="Полное наименование организации"
              value={draft.legalFullName}
              onChange={(legalFullName) => set({ legalFullName })}
            />
            <WebField
              label="Юридический адрес"
              value={draft.legalAddress}
              onChange={(legalAddress) => set({ legalAddress })}
            />
            <WebField
              label="Фактический адрес"
              value={draft.actualAddress}
              onChange={(actualAddress) => set({ actualAddress })}
            />
            <WebField
              label="Налоговый номер компании"
              value={draft.taxNumber}
              onChange={(taxNumber) => set({ taxNumber })}
            />

            {/* Реквизиты списком «название → номер»: у ИП нет КПП, у
                бюджетников есть ОКТМО и КБК. Колонками их не перечислить. */}
            <Text style={styles.subTitle}>Реквизиты организации</Text>
            {draft.requisites.map((item, index) => (
              <View key={index} style={styles.pair}>
                <View style={styles.pairHalf}>
                  <WebField
                    label="Наименование реквизита (например: ИНН)"
                    value={item.key}
                    onChange={(key) => set({ requisites: replaceAt(draft.requisites, index, { ...item, key }) })}
                  />
                </View>
                <View style={styles.pairHalf}>
                  <WebField
                    label="Номер реквизита (например: 5702001741)"
                    value={item.value}
                    onChange={(value) => set({ requisites: replaceAt(draft.requisites, index, { ...item, value }) })}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Убрать реквизит"
                  onPress={() => set({ requisites: draft.requisites.filter((_, at) => at !== index) })}
                  style={styles.removeCell}
                >
                  <Text style={styles.removeMark}>×</Text>
                </Pressable>
              </View>
            ))}
            <Text
              accessibilityRole="link"
              style={styles.addLink}
              onPress={() => set({ requisites: [...draft.requisites, { key: '', value: '' }] })}
            >
              добавить еще
            </Text>
            <Text style={styles.note}>Используются для печатных форм.</Text>

            <WebField
              label="Должность руководителя"
              value={draft.directorTitle}
              onChange={(directorTitle) => set({ directorTitle })}
            />
            <WebField
              label="ФИО руководителя"
              value={draft.directorName}
              onChange={(directorName) => set({ directorName })}
            />
            <WebField
              label="ФИО бухгалтера"
              value={draft.accountantName}
              onChange={(accountantName) => set({ accountantName })}
            />
            <WebToggle
              label="Плательщик НДС"
              on={draft.vatPayer}
              onChange={(vatPayer) => set({ vatPayer })}
            />
          </Block>
        ) : null}

        {tab === 'taxes' ? (
          <Block title="Список налогов">
            {/* У него налоги — список, а не одна ставка на всю компанию: в
                одном чеке встречаются позиции с разными ставками. */}
            {draft.taxes.map((tax, index) => (
              <View key={index} style={styles.pair}>
                <View style={styles.pairHalf}>
                  <WebField
                    label="Наименование"
                    value={tax.name}
                    onChange={(name) => set({ taxes: replaceAt(draft.taxes, index, { ...tax, name }) })}
                  />
                </View>
                <View style={styles.pairThird}>
                  <WebField
                    label="Код налога"
                    value={tax.code}
                    onChange={(code) => set({ taxes: replaceAt(draft.taxes, index, { ...tax, code }) })}
                  />
                </View>
                <View style={styles.pairThird}>
                  <WebField
                    label="Процент"
                    value={String(tax.rate_bp / 100)}
                    onChange={(text) =>
                      set({
                        taxes: replaceAt(draft.taxes, index, {
                          ...tax,
                          rate_bp: parsePercent(text) ?? 0,
                        }),
                      })
                    }
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Убрать налог"
                  onPress={() => set({ taxes: draft.taxes.filter((_, at) => at !== index) })}
                  style={styles.removeCell}
                >
                  <Text style={styles.removeMark}>×</Text>
                </Pressable>
              </View>
            ))}
            <Text
              accessibilityRole="link"
              style={styles.addLink}
              onPress={() => set({ taxes: [...draft.taxes, { name: '', code: '', rate_bp: 0 }] })}
            >
              добавить еще
            </Text>

            <WebSelect
              label="Система налогообложения"
              value={draft.taxSystem}
              options={TAX_SYSTEMS.map((value) => ({ value, label: value }))}
              onChange={(taxSystem) => set({ taxSystem })}
            />
            <WebSelect
              label="Ставка НДС по умолчанию"
              value={draft.vat}
              options={VAT_RATES.map((value) => ({ value, label: value }))}
              onChange={(vat) => set({ vat })}
            />
            <Text style={styles.note}>
              Ставка подставляется в новые товары. На уже заведённые она не влияет — цена в
              карточке останется той, за которую товар продавали.
            </Text>
          </Block>
        ) : null}

        {tab === 'report' ? (
          <Block title="Ежедневный отчет на электронную почту по продажам и складу">
            <WebToggle
              label={draft.reportOn ? 'Рассылка включена' : 'Рассылка выключена'}
              on={draft.reportOn}
              onChange={(reportOn) => set({ reportOn })}
            />
            <WebField
              label="Куда слать отчёт"
              value={draft.reportEmail}
              onChange={(reportEmail) => set({ reportEmail })}
            />
            <WebField
              label="Часовой пояс"
              value={draft.timezone}
              onChange={(timezone) => set({ timezone })}
            />
            <WebField
              label="Во сколько"
              value={draft.reportTime}
              onChange={(reportTime) => set({ reportTime })}
            />
            <Text style={styles.note}>
              Отправка ещё не сделана: приложение работает без сервера, а письмо самому себе
              браузер отправить не может. Настройки сохранятся и подхватятся, когда появится
              синхронизация.
            </Text>
          </Block>
        ) : null}

        {tab === 'data' ? <DataTab /> : null}
        {tab === 'sync' ? <SyncTab /> : null}

        {tab === 'data' || tab === 'sync' ? null : (
          <View style={styles.actions}>
            <ToolButton label="Сохранить" tone="green" onPress={save} />
            <ToolButton label="Отменить" onPress={() => setDraft(saved)} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Вкладка «Синхронизация»: учётная запись магазина и обмен с сервером.
 *
 * Программа работает и без неё — так и было задумано: касса не должна
 * зависеть от связи. Сервер нужен для другого: чтобы товары, чеки и клиенты
 * сходились между устройствами, и чтобы за одним складом работали вдвоём.
 *
 * Поэтому здесь нет ни одной обязательной строки на пустой базе: не вошёл —
 * работай как работал.
 */
function SyncTab() {
  const { db, refresh } = useDatabase();
  const link = useQuery((database) => getServer(database));

  const [url, setUrl] = useState(link?.url ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'in' | 'new'>('in');
  const [busy, setBusy] = useState(false);

  const вошли = Boolean(link?.token);

  /** Одинаково для входа, регистрации и обмена: занять, сделать, отпустить. */
  const run = async (what: string, action: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    try {
      say(what, await action());
      refresh();
    } catch (error) {
      // Слова сервера показываем как есть: «неверная почта или пароль»
      // полезнее, чем «не удалось».
      say(what, error instanceof ServerError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (вошли) {
    return (
      <View style={styles.block}>
        <Text style={styles.note}>
          Устройство связано с магазином «{link?.org_name ?? link?.org}». Вошли как{' '}
          {link?.user_name} ({link?.role === 'owner' ? 'владелец' : link?.role}).
          {link?.synced_at
            ? ` Последний обмен: ${new Date(link.synced_at).toLocaleString('ru-RU')}.`
            : ' Обмена ещё не было.'}
        </Text>

        <View style={styles.actions}>
          <ToolButton
            label={busy ? 'Обмен идёт…' : 'Синхронизировать'}
            tone="green"
            onPress={() =>
              run('Синхронизация', async () => {
                const report = await syncNow(db);
                const строки =
                  report.sent === 0 && report.added === 0 && report.updated === 0
                    ? ['Всё уже сошлось — отправлять и забирать нечего.']
                    : [
                        `Отправлено записей: ${report.sent}.`,
                        `Приехало новых: ${report.added}, обновлено: ${report.updated}.`,
                      ];

                // О непринятом молчать нельзя: иначе человек уверен, что
                // клиентская база уехала, а её там нет.
                if (report.ignored.length > 0) {
                  строки.push(
                    `Сервер не принял и не знает, что это: ${report.ignored.join(', ')}. ` +
                      'Обновите сервер склада.',
                  );
                }

                return строки.join(' ');
              })
            }
          />
          <ToolButton
            label="Выйти из учётной записи"
            onPress={() =>
              confirm(
                'Выйти из учётной записи?',
                'Товары, чеки и клиенты останутся на этом устройстве. Обмен с сервером прекратится.',
                'Выйти',
                () => {
                  signOut(db);
                  refresh();
                },
              )
            }
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Text style={styles.note}>
        Сервер нужен, чтобы товары, чеки и клиенты сходились между устройствами: касса, телефон
        кладовщика, компьютер в кабинете. Без него программа работает как работала — всё лежит на
        этом устройстве.
      </Text>

      <View style={styles.actions}>
        <ToolButton
          label="Вход"
          tone={mode === 'in' ? 'blueOutline' : 'plain'}
          onPress={() => setMode('in')}
        />
        <ToolButton
          label="Завести магазин"
          tone={mode === 'new' ? 'blueOutline' : 'plain'}
          onPress={() => setMode('new')}
        />
      </View>

      <WebField label="Адрес сервера" value={url} onChange={setUrl} />

      {mode === 'new' ? (
        <>
          <WebField label="Название магазина" value={orgName} onChange={setOrgName} />
          <WebField label="Ваше имя" value={name} onChange={setName} />
        </>
      ) : null}

      <WebField label="Почта" value={email} onChange={setEmail} />
      <WebField label="Пароль" value={password} onChange={setPassword} />

      <View style={styles.actions}>
        <ToolButton
          label={busy ? 'Минуту…' : mode === 'in' ? 'Войти' : 'Завести магазин'}
          tone="green"
          onPress={() =>
            run(mode === 'in' ? 'Вход' : 'Регистрация магазина', async () => {
              if (mode === 'in') {
                const who = await signIn(db, url, { email, password, device: 'Wayshop' });
                return `Вошли как ${who.userName}. Теперь нажмите «Синхронизировать».`;
              }

              const who = await register(db, url, { orgName, name, email, password });
              return `Магазин «${orgName}» заведён, вы его владелец (${who.userName}).`;
            })
          }
        />
      </View>
    </View>
  );
}

/** Заменяет один элемент списка — короче, чем `map` с индексом на каждом поле. */
function replaceAt<T>(list: T[], index: number, item: T): T[] {
  return list.map((current, at) => (at === index ? item : current));
}

/** Переключатель — тот же, что в карточке товара: дорожка 49×21. */
function WebToggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={() => onChange(!on)}
      style={styles.toggleRow}
    >
      <View style={[styles.track, on && styles.trackOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
      <Text style={styles.toggleLabel}>{label}</Text>
    </Pressable>
  );
}

/** Вкладка «Данные»: резервная копия и выгрузки. */
function DataTab() {
  const { db } = useDatabase();

  const counts = useQuery((database) => ({
    products: database.get<{ n: number }>('SELECT COUNT(*) AS n FROM products')?.n ?? 0,
    clients: database.get<{ n: number }>('SELECT COUNT(*) AS n FROM counterparties')?.n ?? 0,
    sales: database.get<{ n: number }>('SELECT COUNT(*) AS n FROM sales')?.n ?? 0,
    moves: database.get<{ n: number }>('SELECT COUNT(*) AS n FROM stock_moves')?.n ?? 0,
  }));

  const today = new Date().toISOString().slice(0, 10);

  async function backup() {
    if (!db.snapshot) {
      say('Копия недоступна', 'На этом устройстве база лежит файлом — копируйте её средствами системы.');
      return;
    }
    await saveFile(`waystea-${today}.sqlite`, db.snapshot(), 'application/x-sqlite3');
  }

  async function restore() {
    if (!db.restore) {
      say('Восстановление недоступно', 'Работает в веб-версии.');
      return;
    }

    const bytes = await pickFile('.sqlite,.db');
    if (!bytes) return;

    // Восстановление затирает всё, что есть сейчас, и отменить его нечем —
    // спрашиваем до, а не жалеем после.
    confirm(
      'Заменить данные копией?',
      'Всё, что сейчас в программе, будет заменено содержимым файла. Отменить нельзя.',
      'Заменить',
      () => void db.restore?.(bytes),
    );
  }

  return (
    <Block title="Данные">
      <View style={styles.counts}>
        <Count label="Товаров" value={counts.products} of={seedCounts().products} />
        <Count label="Контрагентов" value={counts.clients} of={seedCounts().clients} />
        <Count label="Чеков" value={counts.sales} />
        <Count label="Движений товара" value={counts.moves} />
      </View>

      <Text style={styles.note}>
        Данные лежат в самом браузере, а не на сервере. Это значит, что они никуда не уходят —
        и что копию нужно снимать самому: очистка данных сайта стирает и их.
      </Text>

      <View style={styles.actions}>
        <ToolButton label="Скачать резервную копию" tone="green" onPress={backup} />
        <ToolButton label="Восстановить из копии" tone="orangeOutline" onPress={restore} />
        <ToolButton
          label="Выгрузить остатки в CSV"
          tone="blueOutline"
          onPress={() =>
            void saveFile(`Остатки ${today}.csv`, stockCsv(db), 'text/csv;charset=utf-8')
          }
        />
      </View>
    </Block>
  );
}

function Count({ label, value, of }: { label: string; value: number; of?: number }) {
  return (
    <View style={styles.count}>
      <Text style={webText.metric}>{value.toLocaleString('ru-RU')}</Text>
      <Text style={webText.metricLabel}>
        {label}
        {of !== undefined && value !== of ? ` (в поставке ${of.toLocaleString('ru-RU')})` : ''}
      </Text>
    </View>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.block}>
      <Text style={webText.blockTitle}>{title}</Text>
      {children}
    </View>
  );
}

function WebField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} style={styles.input} />
    </View>
  );
}

/**
 * Поле, которого бывает несколько: телефон, почта.
 *
 * Ссылка «добавить еще» стоит в самой подписи — так у него, и это заметно
 * лучше кнопки под списком: видно, что добавлять есть куда, ещё до того как
 * заполнил первое.
 */
function ListField({
  label,
  values,
  placeholder,
  onChange,
}: {
  label: string;
  values: string[];
  placeholder?: string;
  onChange: (values: string[]) => void;
}) {
  // Пустой список всё равно рисуется одной строкой: поле, в которое нечего
  // ввести, выглядит как поломка.
  const rows = values.length ? values : [''];

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label} (
        <Text
          accessibilityRole="link"
          onPress={() => onChange([...rows, ''])}
          style={styles.addMore}
        >
          добавить еще
        </Text>
        )
      </Text>

      {rows.map((value, index) => (
        <View key={index} style={styles.listRow}>
          <TextInput
            value={value}
            onChangeText={(next) => onChange(rows.map((item, i) => (i === index ? next : item)))}
            placeholder={placeholder}
            placeholderTextColor={web.textMuted}
            accessibilityLabel={`${label} ${index + 1}`}
            style={[styles.input, styles.listInput]}
          />
          {rows.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Убрать ${label.toLowerCase()} ${index + 1}`}
              onPress={() => onChange(rows.filter((_, i) => i !== index))}
              style={styles.listRemove}
            >
              <Text style={styles.listRemoveSign}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function WebSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option<string>[];
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Dropdown value={value} options={options} onChange={onChange} width={420} label={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  addMore: { color: web.link, fontWeight: '400' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listInput: { flex: 1 },
  listRemove: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
  },
  listRemoveSign: { fontSize: 13, color: web.textMuted },
  subTitle: { fontFamily: WEB_FONT, fontSize: 15, fontWeight: '700', color: web.text, marginTop: 10 },
  pair: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  pairHalf: { flex: 1 },
  pairThird: { width: 190 },
  removeCell: { width: 34, height: 38, alignItems: 'center', justifyContent: 'center' },
  removeMark: { fontFamily: WEB_FONT, fontSize: 22, color: web.textMuted },
  addLink: { fontFamily: WEB_FONT, fontSize: 14, color: web.link, marginTop: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  track: { width: 49, height: 21, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.05)' },
  trackOn: { backgroundColor: web.link },
  knob: {
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(34,36,38,0.15)',
  },
  knobOn: { marginLeft: 30 },
  toggleLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 26,
    paddingTop: 20,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  tab: {
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: web.link },
  tabLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
  tabLabelActive: { color: web.link },
  content: { padding: 26, gap: 26, maxWidth: 900, width: '100%' },
  block: { gap: 16 },
  field: { gap: 6 },
  fieldLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.columnHead },
  input: {
    width: 420,
    height: 42,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingHorizontal: 12,
    fontFamily: WEB_FONT, fontSize: 15,
    color: web.text,
    backgroundColor: '#FFFFFF',
  },
  note: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted, maxWidth: 620, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  counts: { flexDirection: 'row', gap: 40, flexWrap: 'wrap' },
  count: { gap: 4 },
});
