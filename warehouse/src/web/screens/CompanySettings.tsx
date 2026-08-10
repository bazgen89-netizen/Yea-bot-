import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

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
import { SEED_CLIENTS, SEED_PRODUCTS } from '../../db/seed';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { pickFile, saveFile } from '../../ui/download';
import { web, webText, WEB_FONT } from '../../ui/webTheme';

/**
 * «Настройки / настройки компании» — вкладки, как в оригинале.
 *
 * Значения лежат в одном объекте и сохраняются целиком по кнопке, а не по
 * каждому нажатию клавиши: иначе наполовину набранный ИНН уходил бы в базу
 * и возвращался бы оттуда при следующем открытии.
 */

type Tab = 'main' | 'legal' | 'taxes' | 'report' | 'data';

const TABS: { value: Tab; label: string }[] = [
  { value: 'main', label: 'Основные' },
  { value: 'legal', label: 'Реквизиты' },
  { value: 'taxes', label: 'Налоги' },
  { value: 'report', label: 'Email отчет' },
  { value: 'data', label: 'Данные' },
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
          <Block title="Основные">
            <WebField label="Название" value={draft.name} onChange={(name) => set({ name })} />
            <WebField label="Телефон" value={draft.phone} onChange={(phone) => set({ phone })} />
            <WebField label="Email" value={draft.email} onChange={(email) => set({ email })} />
            <WebField label="Сайт" value={draft.site} onChange={(site) => set({ site })} />
          </Block>
        ) : null}

        {tab === 'legal' ? (
          <Block title="Реквизиты">
            <WebField
              label="Юридическое лицо"
              value={draft.legalName}
              onChange={(legalName) => set({ legalName })}
            />
            <WebField label="ИНН" value={draft.inn} onChange={(inn) => set({ inn })} />
            <WebField label="КПП" value={draft.kpp} onChange={(kpp) => set({ kpp })} />
            <WebField
              label="Юридический адрес"
              value={draft.address}
              onChange={(address) => set({ address })}
            />
            <WebField label="Банк" value={draft.bank} onChange={(bank) => set({ bank })} />
            <WebField
              label="Расчётный счёт"
              value={draft.account}
              onChange={(account) => set({ account })}
            />
          </Block>
        ) : null}

        {tab === 'taxes' ? (
          <Block title="Налоги">
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
          <Block title="Email отчет">
            <WebField
              label="Куда слать отчёт"
              value={draft.reportEmail}
              onChange={(reportEmail) => set({ reportEmail })}
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

        {tab === 'data' ? null : (
          <View style={styles.actions}>
            <ToolButton label="Сохранить" tone="green" onPress={save} />
            <ToolButton label="Отменить" onPress={() => setDraft(saved)} />
          </View>
        )}
      </ScrollView>
    </View>
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
        <Count label="Товаров" value={counts.products} of={SEED_PRODUCTS} />
        <Count label="Контрагентов" value={counts.clients} of={SEED_CLIENTS} />
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
