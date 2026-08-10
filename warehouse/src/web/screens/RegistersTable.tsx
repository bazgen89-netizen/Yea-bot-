import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Column, HeadRow, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import { formatDay, formatTime } from '../../db/journal';
import { listRegisters, openShift, type RegisterWithState } from '../../db/shifts';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { web, webText, WEB_FONT } from '../../ui/webTheme';

// Колонок мало, и кнопка — последняя из них: ширины подобраны так, чтобы
// она помещалась целиком, а не пряталась за горизонтальной прокруткой.
const COLUMNS: Column[] = [
  { key: 'name', title: 'Касса', width: 270 },
  { key: 'shop', title: 'Магазин', width: 230 },
  { key: 'state', title: 'Состояние', width: 200 },
  { key: 'since', title: 'Смена открыта', width: 200 },
  { key: 'action', title: '', width: 190 },
];

/** «Кассовый раздел / кассы»: где стоит касса и открыта ли на ней смена. */
export function RegistersTable() {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const [search, setSearch] = useState('');

  const registers = useQuery((database) => listRegisters(database));

  const filtered = search.trim()
    ? registers.filter((register) =>
        `${register.name} ${register.location_name ?? ''}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      )
    : registers;

  return (
    <View style={styles.screen}>
      <Toolbar>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="поиск по названию или магазину"
          width={306}
        />
        <ToolButton
          label="Интерфейс кассира"
          tone="blueOutline"
          onPress={() => router.push('/cashier')}
        />
        <ToolButton label="Смены" tone="plain" onPress={() => router.push('/shifts')} />
      </Toolbar>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <HeadRow columns={COLUMNS} lead={<View style={styles.statusHead} />} />

          <ScrollView>
            {filtered.map((register) => (
              <RegisterRow
                key={register.id}
                register={register}
                onOpen={() => {
                  openShift(db, { registerId: register.id, cashier: 'waystea' });
                  refresh();
                }}
                onShifts={() => router.push('/shifts')}
              />
            ))}

            {filtered.length === 0 ? (
              <Text style={styles.empty}>
                {search ? 'Ничего не нашлось' : 'Касс пока нет'}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

function RegisterRow({
  register,
  onOpen,
  onShifts,
}: {
  register: RegisterWithState;
  onOpen: () => void;
  onShifts: () => void;
}) {
  const [name, shop, state, since, action] = COLUMNS;
  const isOpen = register.open_shift_id !== null;

  return (
    <View style={styles.rowWrap}>
      <View style={[styles.stripe, { backgroundColor: isOpen ? web.green : web.border }]} />

      <View style={styles.rowInner}>
        <Row>
          <View style={styles.status}>
            {isOpen ? (
              <WebIcon.lockOpen size={17} color={web.greenText} />
            ) : (
              <WebIcon.lockClosed size={17} color={web.textMuted} />
            )}
          </View>

          <Text style={[webText.link, { width: name.width }]} numberOfLines={1}>
            {register.name}
          </Text>
          <Text style={[webText.cell, { width: shop.width }]} numberOfLines={1}>
            {register.location_name ?? '—'}
          </Text>
          <Text
            style={[
              webText.cell,
              { width: state.width },
              isOpen ? { color: web.greenText } : { color: web.textMuted },
            ]}
          >
            {isOpen ? `Смена №${register.open_shift_id} открыта` : 'Смена закрыта'}
          </Text>
          <Text style={[webText.cell, { width: since.width }]}>
            {register.opened_at
              ? `${formatDay(register.opened_at.slice(0, 10))}, ${formatTime(register.opened_at)}`
              : '—'}
          </Text>

          <View style={{ width: action.width }}>
            <ToolButton
              label={isOpen ? 'К сменам' : 'Открыть смену'}
              tone={isOpen ? 'plain' : 'greenOutline'}
              onPress={isOpen ? onShifts : onOpen}
            />
          </View>
        </Row>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  statusHead: { width: 46 },
  rowWrap: { flexDirection: 'row' },
  stripe: { width: 4 },
  rowInner: { flex: 1 },
  status: { width: 42, alignItems: 'center' },
  empty: { padding: 40, fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
});
