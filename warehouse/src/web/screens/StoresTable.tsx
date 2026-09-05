import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Translated';

import { Card, CardGrid, CardLine, CreateCard } from '../Cards';
import { Drawer, DrawerButton } from '../Drawer';
import {
  archiveLocation,
  blankLocation,
  getLocation,
  listLocationsWithTotals,
  saveLocation,
  type LocationInput,
  type LocationWithTotals,
} from '../../db/locations';
import { getSettings } from '../../db/settings';
import { formatMoneyWeb } from '../../domain/money';
import { formatQtyWeb } from '../../domain/qty';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { FORM_BORDER, web, WEB_FONT } from '../../ui/webTheme';

/**
 * «Компания / Магазины».
 *
 * Карточками, как у него: пунктирная «Создать», дальше по карточке на точку —
 * дата создания, адрес, описание, снизу «Изменить» и корзина. Уголок с
 * галочкой у той, что по умолчанию.
 *
 * Остаток точки — не его поле, а наше: магазин здесь не строчка справочника,
 * а то, к чему привязан каждый остаток, и «сколько в нём лежит» — первое, за
 * чем сюда заходят.
 */
export function StoresTable() {
  const { db, refresh } = useDatabase();
  const stores = useQuery((database) => listLocationsWithTotals(database));

  const [editing, setEditing] = useState<Id | 'new' | null>(null);

  function remove(store: LocationWithTotals) {
    confirm(
      `Удалить магазин «${store.name}»?`,
      'Магазин с остатком удалить нельзя — сначала переместите или спишите товар.',
      'Удалить',
      () => {
        try {
          archiveLocation(db, store.id);
          refresh();
        } catch (error) {
          say('Магазин не удалён', String(error));
        }
      },
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <CardGrid>
          <CreateCard onPress={() => setEditing('new')} />

          {stores.map((store) => (
            <Card
              key={store.id}
              ribbon={store.is_default === 1}
              icon={<WebIcon.company size={20} color={web.textMuted} />}
              title={store.name}
              onOpen={() => setEditing(store.id)}
              lines={
                <>
                  <CardLine icon={<WebIcon.calendar size={13} color={web.textMuted} />}>
                    Создан {new Date(store.created_at).toLocaleDateString('ru-RU')}
                  </CardLine>
                  {store.address ? (
                    <CardLine icon={<WebIcon.home size={13} color={web.textMuted} />}>
                      {store.address}
                    </CardLine>
                  ) : null}
                  {store.description ? (
                    <CardLine icon={<WebIcon.comment size={13} color={web.textMuted} />}>
                      {store.description}
                    </CardLine>
                  ) : null}
                  <CardLine icon={<WebIcon.goods size={13} color={web.textMuted} />}>
                    {store.positions} поз. · {formatQtyWeb(store.quantity)} ·{' '}
                    {formatMoneyWeb(store.retailValue)} в розничных ценах
                  </CardLine>
                </>
              }
              onEdit={() => setEditing(store.id)}
              onDelete={() => remove(store)}
            />
          ))}
        </CardGrid>
      </ScrollView>

      {editing !== null ? (
        <StoreForm id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </View>
  );
}

function StoreForm({ id, onClose }: { id: Id | null; onClose: () => void }) {
  const { db, refresh } = useDatabase();
  const loaded = useQuery((database) => (id ? getLocation(database, id) : null), [id]);
  const settings = useQuery((database) => getSettings(database));

  const [draft, setDraft] = useState<LocationInput>(blankLocation);
  const [ready, setReady] = useState(false);

  if (!ready && (id ? loaded : true)) {
    if (id && loaded) {
      setDraft({
        name: loaded.name,
        address: loaded.address,
        description: loaded.description,
        is_default: loaded.is_default === 1,
        taxes: loaded.taxes ? loaded.taxes.split(',').filter(Boolean) : [],
      });
    }
    setReady(true);
  }

  const set = (patch: Partial<LocationInput>) => setDraft((current) => ({ ...current, ...patch }));

  function save() {
    try {
      saveLocation(db, id, draft);
      refresh();
      onClose();
    } catch (error) {
      say('Магазин не сохранён', String(error));
    }
  }

  return (
    <Drawer
      visible
      size="s"
      onClose={onClose}
      actions={<DrawerButton label="Сохранить" tone="green" onPress={save} />}
    >
      <View style={styles.form}>
        <Text style={styles.formTitle}>
          {id ? 'Редактирование магазина' : 'Создание магазина'}
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>
            Наименование<Text style={styles.required}> *</Text>
          </Text>
          <TextInput
            value={draft.name}
            onChangeText={(name) => set({ name })}
            accessibilityLabel="Наименование магазина"
            style={styles.input}
          />
        </View>

        {/* Налоги точки: в разных точках ставки бывают разными, и чек
            печатается с той, что у точки. Список берётся из настроек
            компании — заводить его здесь второй раз незачем. */}
        <View style={styles.field}>
          <Text style={styles.label}>Налоги</Text>
          {settings.taxes.length === 0 ? (
            <Text style={styles.hint}>
              Налоги не заведены — «Компания / Настройки / Налоги».
            </Text>
          ) : (
            <View style={styles.taxes}>
              {settings.taxes.map((tax) => {
                const on = draft.taxes.includes(tax.code);
                return (
                  <Pressable
                    key={tax.code}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={tax.name}
                    onPress={() =>
                      set({
                        taxes: on
                          ? draft.taxes.filter((code) => code !== tax.code)
                          : [...draft.taxes, tax.code],
                      })
                    }
                    style={[styles.tax, on && styles.taxOn]}
                  >
                    <Text style={[styles.taxLabel, on && styles.taxLabelOn]}>
                      {tax.name} · {tax.rate_bp / 100} %
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Адрес</Text>
          <TextInput
            value={draft.address ?? ''}
            onChangeText={(address) => set({ address })}
            multiline
            accessibilityLabel="Адрес магазина"
            style={[styles.input, styles.area]}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Описание</Text>
          <TextInput
            value={draft.description ?? ''}
            onChangeText={(description) => set({ description })}
            multiline
            accessibilityLabel="Описание магазина"
            style={[styles.input, styles.area]}
          />
        </View>

        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: draft.is_default }}
          accessibilityLabel="По умолчанию"
          onPress={() => set({ is_default: !draft.is_default })}
          style={styles.toggleRow}
        >
          <View style={[styles.track, draft.is_default && styles.trackOn]}>
            <View style={[styles.knob, draft.is_default && styles.knobOn]} />
          </View>
          <Text style={styles.toggleLabel}>По умолчанию</Text>
        </Pressable>
      </View>
    </Drawer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  content: { padding: 24, gap: 20 },

  form: { padding: 26, gap: 16 },
  formTitle: { fontFamily: WEB_FONT, fontSize: 27, color: web.text },
  field: { gap: 6 },
  label: { fontFamily: WEB_FONT, fontSize: 13, color: web.text, fontWeight: '700' },
  required: { color: web.danger },
  hint: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },
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
  area: { minHeight: 66, paddingVertical: 8, textAlignVertical: 'top' },

  taxes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tax: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
  },
  taxOn: { borderColor: web.link, backgroundColor: '#E8F4FD' },
  taxLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  taxLabelOn: { color: web.link },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { width: 49, height: 21, borderRadius: 11, backgroundColor: '#D4D4D5', padding: 2 },
  trackOn: { backgroundColor: web.green },
  knob: { width: 17, height: 17, borderRadius: 9, backgroundColor: '#FFFFFF' },
  knobOn: { transform: [{ translateX: 30 }] },
  toggleLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
});
