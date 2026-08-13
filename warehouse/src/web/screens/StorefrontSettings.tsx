import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Dropdown } from '../Dropdown';
import { listLocations } from '../../db/locations';
import { listCategories, listProducts } from '../../db/products';
import { getSettings, saveSettings, type Storefront } from '../../db/settings';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { FORM_BORDER, web, WEB_FONT } from '../../ui/webTheme';

/**
 * «Интернет-витрина» — его экран настроек витрины.
 *
 * Сверху название, ссылка на адрес и переключатель «Включена / Выключена»
 * справа; ниже четыре вкладки — Домен, Товары, О магазине, Аналитика — и
 * зелёная «Сохранить» под ними.
 *
 * Самой витрины у нас нет: сайт, который бы её показывал, — отдельная работа,
 * и делать вид, что он есть, здесь не стоит. Настройки при этом настоящие и
 * сохраняются: их заполняют раньше, чем витрину открывают, и переносить их
 * потом откуда-то ещё было бы нечем.
 */

type Tab = 'domain' | 'products' | 'about' | 'analytics';

const TABS: { value: Tab; label: string }[] = [
  { value: 'domain', label: 'Домен' },
  { value: 'products', label: 'Товары' },
  { value: 'about', label: 'О магазине' },
  { value: 'analytics', label: 'Аналитика' },
];

const ZERO_STOCKS: { value: Storefront['zeroStocks']; label: string }[] = [
  { value: 'hide', label: 'Не показывать' },
  { value: 'show', label: 'Показывать' },
  { value: 'order', label: 'Показывать под заказ' },
];

export function StorefrontSettings() {
  const { db, refresh } = useDatabase();
  const saved = useQuery((database) => getSettings(database));
  const locations = useQuery((database) => listLocations(database));
  const categories = useQuery((database) => listCategories(database));
  const products = useQuery((database) => listProducts(database, {}));

  const [tab, setTab] = useState<Tab>('domain');
  const [draft, setDraft] = useState<Storefront>(saved.storefront);

  const set = (patch: Partial<Storefront>) => setDraft((current) => ({ ...current, ...patch }));

  function save() {
    saveSettings(db, { ...saved, storefront: draft });
    refresh();
    say('Сохранено', 'Настройки витрины обновлены.');
  }

  const address = draft.domain || (draft.subdomain ? `${draft.subdomain}.waystea.shop` : '');

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{draft.title || 'Интернет-витрина'}</Text>
          {address ? (
            <View style={styles.addressRow}>
              <WebIcon.storefront size={14} color={web.link} />
              <Text style={styles.address}>{address}</Text>
            </View>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: draft.on }}
          accessibilityLabel={draft.on ? 'Включена' : 'Выключена'}
          onPress={() => set({ on: !draft.on })}
          style={styles.toggleRow}
        >
          <View style={[styles.track, draft.on && styles.trackOn]}>
            <View style={[styles.knob, draft.on && styles.knobOn]} />
          </View>
          <Text style={styles.toggleLabel}>{draft.on ? 'Включена' : 'Выключена'}</Text>
        </Pressable>
      </View>

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
        {tab === 'domain' ? (
          <>
            <Text style={styles.blockTitle}>Поддомен</Text>
            <View style={styles.domainRow}>
              <View style={styles.prefix}>
                <Text style={styles.prefixText}>https://</Text>
              </View>
              <TextInput
                value={draft.subdomain}
                onChangeText={(subdomain) =>
                  set({ subdomain: subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '') })
                }
                accessibilityLabel="Поддомен"
                style={[styles.input, styles.domainInput]}
              />
              <View style={styles.suffix}>
                <Text style={styles.prefixText}>.waystea.shop</Text>
              </View>
            </View>
            <Notice tone="warning">
              Можно использовать буквы a-z, цифры и дефис, от 4 до 20 символов.
            </Notice>

            <Text style={styles.blockTitle}>Свой домен</Text>
            <TextInput
              value={draft.domain}
              onChangeText={(domain) => set({ domain })}
              placeholder="example.com"
              placeholderTextColor={web.textMuted}
              accessibilityLabel="Свой домен"
              style={styles.input}
            />
            <Notice tone="info" title="Как прикрепить свой домен">
              В панели управления доменом у регистратора пропишите запись типа A, указывающую на
              IP-адрес вашего сервера с витриной.
            </Notice>
          </>
        ) : null}

        {tab === 'products' ? (
          <>
            <Text style={styles.blockTitle}>Магазин</Text>
            <Dropdown
              value={draft.storeId === null ? '' : String(draft.storeId)}
              options={locations.map((location) => ({
                value: String(location.id),
                label: location.name,
              }))}
              onChange={(value) => set({ storeId: Number(value) })}
              variant="field"
              label="Магазин витрины"
              placeholder="Выберите магазин"
            />
            <Notice tone="warning">
              Магазин нужен, чтобы по заказу с витрины заводился документ продажи и списывался
              остаток именно этой точки.
            </Notice>

            <Text style={styles.blockTitle}>Нулевые остатки</Text>
            <Dropdown
              value={draft.zeroStocks}
              options={ZERO_STOCKS}
              onChange={(value) => set({ zeroStocks: value as Storefront['zeroStocks'] })}
              variant="field"
              label="Нулевые остатки"
            />

            <Text style={styles.blockTitle}>Категории</Text>
            <Text style={styles.hint}>
              Выбранные категории будут показаны на витрине. Ничего не выбрано — показываются все.
            </Text>
            <View style={styles.chips}>
              {categories.map((category) => {
                const on = draft.categories.includes(category.name);
                const count = products.filter(
                  (product) => product.category_id === category.id,
                ).length;
                return (
                  <Pressable
                    key={category.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={category.name}
                    onPress={() =>
                      set({
                        categories: on
                          ? draft.categories.filter((name) => name !== category.name)
                          : [...draft.categories, category.name],
                      })
                    }
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                      {category.name}
                    </Text>
                    <Text style={styles.chipCount}>{count}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {tab === 'about' ? (
          <>
            <Text style={styles.blockTitle}>Описание</Text>
            <Field
              label="Название"
              counter={`не больше 60 символов`}
              value={draft.title}
              onChange={(title) => set({ title: title.slice(0, 60) })}
            />
            <Field
              label="Краткое описание"
              counter="не больше 140 символов"
              value={draft.description}
              onChange={(description) => set({ description: description.slice(0, 140) })}
              multiline
            />
            <Field
              label="О магазине"
              value={draft.about}
              onChange={(about) => set({ about })}
              multiline
            />

            <Text style={styles.blockTitle}>Контакты</Text>
            <Field label="Email" value={draft.email} onChange={(email) => set({ email })} />
            <Field label="Телефон" value={draft.phone} onChange={(phone) => set({ phone })} />
            <Field
              label="Адрес"
              value={draft.address}
              onChange={(address) => set({ address })}
              multiline
            />
          </>
        ) : null}

        {tab === 'analytics' ? (
          <>
            <Text style={styles.blockTitle}>Яндекс Метрика</Text>
            <Field label="Номер счётчика" value={draft.ym} onChange={(ym) => set({ ym })} />

            <Text style={styles.blockTitle}>Google Analytics</Text>
            <Field label="Номер счётчика" value={draft.ga} onChange={(ga) => set({ ga })} />

            <Text style={styles.blockTitle}>Идентификатор Яндекс Вебмастер</Text>
            <Field label="Идентификатор" value={draft.ywm} onChange={(ywm) => set({ ywm })} />

            <Text style={styles.blockTitle}>Идентификатор Google Search Console</Text>
            <Field label="Идентификатор" value={draft.gwm} onChange={(gwm) => set({ gwm })} />
          </>
        ) : null}

        <Pressable accessibilityRole="button" onPress={save} style={styles.save}>
          <Text style={styles.saveLabel}>Сохранить</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  counter,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  counter?: string;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {counter ? <Text style={styles.counter}>{counter}</Text> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        accessibilityLabel={label}
        style={[styles.input, multiline && styles.area]}
      />
    </View>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: 'warning' | 'info';
  title?: string;
  children: string;
}) {
  return (
    <View style={[styles.notice, tone === 'info' ? styles.noticeInfo : styles.noticeWarning]}>
      {title ? <Text style={styles.noticeTitle}>{title}</Text> : null}
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 30,
    paddingTop: 24,
    gap: 20,
  },
  headerText: { gap: 4 },
  title: { fontFamily: WEB_FONT, fontSize: 27, color: web.text },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  address: { fontFamily: WEB_FONT, fontSize: 14, color: web.link },

  tabs: {
    flexDirection: 'row',
    gap: 24,
    paddingHorizontal: 30,
    paddingTop: 18,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  tab: { paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: web.link },
  tabLabel: { fontFamily: WEB_FONT, fontSize: 18, color: web.textMuted },
  tabLabelActive: { color: web.link },

  content: { padding: 30, gap: 14, maxWidth: 720, width: '100%' },
  blockTitle: { fontFamily: WEB_FONT, fontSize: 18, color: web.text, marginTop: 12 },
  field: { gap: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontFamily: WEB_FONT, fontSize: 13, color: web.text, fontWeight: '700' },
  counter: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },
  hint: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  input: {
    minHeight: 38,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 10,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  area: { minHeight: 76, paddingVertical: 8, textAlignVertical: 'top' },

  domainRow: { flexDirection: 'row', alignItems: 'stretch' },
  prefix: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#E8E8E8',
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: FORM_BORDER,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
  },
  suffix: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#E8E8E8',
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: FORM_BORDER,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  prefixText: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },
  domainInput: { flex: 1, borderRadius: 0 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
  },
  chipOn: { borderColor: web.link, backgroundColor: '#E8F4FD' },
  chipLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  chipLabelOn: { color: web.link },
  chipCount: { fontFamily: WEB_FONT, fontSize: 11, color: web.textMuted },

  notice: { borderRadius: 4, padding: 12, gap: 4 },
  noticeWarning: { backgroundColor: web.warningBg },
  noticeInfo: { backgroundColor: '#E8F4FD' },
  noticeTitle: { fontFamily: WEB_FONT, fontSize: 13, color: web.text, fontWeight: '700' },
  noticeText: { fontFamily: WEB_FONT, fontSize: 13, color: web.text },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { width: 49, height: 21, borderRadius: 11, backgroundColor: '#D4D4D5', padding: 2 },
  trackOn: { backgroundColor: web.green },
  knob: { width: 17, height: 17, borderRadius: 9, backgroundColor: '#FFFFFF' },
  knobOn: { transform: [{ translateX: 30 }] },
  toggleLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  save: {
    alignSelf: 'flex-start',
    marginTop: 20,
    paddingHorizontal: 24,
    height: 42,
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: web.green,
  },
  saveLabel: { fontFamily: WEB_FONT, fontSize: 16, color: '#FFFFFF' },
});
