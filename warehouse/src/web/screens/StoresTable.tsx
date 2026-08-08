import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Column, HeadRow, Row, ToolButton, Toolbar } from '../Table';
import {
  archiveLocation,
  createLocation,
  listLocationsWithTotals,
  renameLocation,
  type LocationWithTotals,
} from '../../db/locations';
import { formatMoneyWeb } from '../../domain/money';
import { formatQtyWeb } from '../../domain/qty';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { web, webText } from '../../ui/webTheme';

// Кнопки — последняя колонка: ширины подобраны так, чтобы они помещались,
// а не прятались за горизонтальной прокруткой.
const COLUMNS: Column[] = [
  { key: 'name', title: 'Магазин', width: 300 },
  { key: 'positions', title: 'Позиций', width: 110, numeric: true },
  { key: 'quantity', title: 'Количество', width: 170, numeric: true },
  { key: 'value', title: 'В розничных ценах, руб', width: 230, numeric: true },
  { key: 'action', title: '', width: 230 },
];

/**
 * «Компания / магазины».
 *
 * Магазин здесь не строчка в справочнике, а то, к чему привязан каждый
 * остаток: поэтому рядом с названием сразу видно, сколько в нём лежит.
 */
export function StoresTable() {
  const { db, refresh } = useDatabase();
  const stores = useQuery((database) => listLocationsWithTotals(database));

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  function add() {
    try {
      createLocation(db, name);
      setName('');
      setAdding(false);
      refresh();
    } catch (error) {
      say('Не удалось добавить магазин', String(error));
    }
  }

  return (
    <View style={styles.screen}>
      <Toolbar>
        <ToolButton
          label={adding ? 'Отменить' : 'Добавить магазин'}
          tone={adding ? 'plain' : 'green'}
          onPress={() => setAdding((current) => !current)}
        />
      </Toolbar>

      {adding ? (
        <View style={styles.form}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Название магазина"
            placeholderTextColor={web.textMuted}
            style={styles.input}
            autoFocus
            onSubmitEditing={add}
          />
          <ToolButton label="Добавить" tone="green" onPress={add} />
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <HeadRow columns={COLUMNS} />

          <ScrollView>
            {stores.map((store) => (
              <StoreRow key={store.id} store={store} />
            ))}

            {stores.length === 0 ? (
              <Text style={styles.empty}>Магазинов пока нет</Text>
            ) : null}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

function StoreRow({ store }: { store: LocationWithTotals }) {
  const { db, refresh } = useDatabase();
  const [name, setName] = useState(store.name);
  const [editing, setEditing] = useState(false);

  const [nameCol, positions, quantity, value, action] = COLUMNS;

  function rename() {
    try {
      renameLocation(db, store.id, name);
      setEditing(false);
      refresh();
    } catch (error) {
      say('Не удалось переименовать', String(error));
    }
  }

  function remove() {
    confirm(
      `Убрать «${store.name}»?`,
      'Магазин исчезнет из списков. История движений по нему останется.',
      'Убрать',
      () => {
        try {
          archiveLocation(db, store.id);
          refresh();
        } catch (error) {
          say('Магазин нельзя убрать', String(error));
        }
      },
    );
  }

  return (
    <Row>
      <View style={{ width: nameCol.width }}>
        {editing ? (
          <View style={styles.rename}>
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.inputSmall}
              autoFocus
              onSubmitEditing={rename}
            />
            <ToolButton label="ОК" tone="greenOutline" onPress={rename} />
          </View>
        ) : (
          <Text style={webText.link} numberOfLines={1}>
            {store.name}
          </Text>
        )}
      </View>

      <Text style={[webText.cellNumber, styles.right, { width: positions.width }]}>
        {store.positions}
      </Text>
      <Text style={[webText.cellNumber, styles.right, { width: quantity.width }]}>
        {formatQtyWeb(store.quantity)}
      </Text>
      <Text style={[webText.cellNumber, styles.right, { width: value.width }]}>
        {formatMoneyWeb(store.retailValue)}
      </Text>

      <View style={[styles.actions, { width: action.width }]}>
        <ToolButton
          label={editing ? 'Отмена' : 'Название'}
          onPress={() => {
            setName(store.name);
            setEditing((current) => !current);
          }}
        />
        <ToolButton label="Убрать" tone="orangeOutline" onPress={remove} />
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  form: { flexDirection: 'row', gap: 12, paddingHorizontal: 22, paddingBottom: 18 },
  input: {
    width: 380,
    height: 42,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingHorizontal: 12,
    fontSize: 15,
    color: web.text,
  },
  inputSmall: {
    flex: 1,
    height: 34,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingHorizontal: 10,
    fontSize: 14,
    color: web.text,
  },
  rename: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingRight: 12 },
  right: { textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', paddingLeft: 12 },
  empty: { padding: 40, fontSize: 15, color: web.textMuted },
});
