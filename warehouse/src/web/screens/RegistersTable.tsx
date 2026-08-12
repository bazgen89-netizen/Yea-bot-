import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Column, HeadRow, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import { formatDay } from '../../db/journal';
import { formatMoneyWeb } from '../../domain/money';
import { listRegisters, openShift, type RegisterWithState } from '../../db/shifts';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { web, webText, WEB_FONT } from '../../ui/webTheme';

/**
 * Колонки — его: Наименование · Магазин · Кассиры · Терминалы · Создан.
 *
 * «Состояние» и «Смена открыта» были нашими: у него состояние видно по
 * значку слева и по кнопке справа, отдельной колонки под него нет. Терминалы
 * — эквайринговые устройства кассы; мы их не ведём, и колонка стоит пустой,
 * а не выброшена: без неё таблица разошлась бы с оригиналом на глаз.
 */
const COLUMNS: Column[] = [
  { key: 'name', title: 'Наименование', width: 260 },
  { key: 'shop', title: 'Магазин', width: 210 },
  { key: 'cashiers', title: 'Кассиры', width: 220 },
  { key: 'terminals', title: 'Терминалы', width: 170 },
  { key: 'created', title: 'Создан', width: 160 },
  { key: 'action', title: '', width: 190 },
];

/** «Кассовый раздел / кассы»: где стоит касса и открыта ли на ней смена. */
export function RegistersTable() {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const [search, setSearch] = useState('');

  const registers = useQuery((database) => listRegisters(database));

  // Сверху у него две суммы по всем кассам. «Всего денег в кассах» — то, что
  // сейчас в ящиках открытых смен; «Баланс» — то же с учётом чеков смены.
  const inDrawers = registers.reduce((sum, register) => sum + register.opening_cash, 0);

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
        <View style={styles.totals}>
          <Text style={styles.totalLabel}>Всего денег в кассах</Text>
          <Text style={styles.totalValue}>{formatMoneyWeb(inDrawers)}</Text>
        </View>
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
  const [name, shop, cashiers, terminals, created, action] = COLUMNS;
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
          <Text style={[webText.cell, { width: cashiers.width }]} numberOfLines={2}>
            {register.cashiers ?? '—'}
          </Text>
          <Text style={[webText.cell, { width: terminals.width }]}>—</Text>
          <Text style={[webText.cell, { width: created.width }]}>
            {formatDay(register.created_at.slice(0, 10))}
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
  totals: { marginLeft: 'auto', alignItems: 'flex-end' },
  totalLabel: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },
  totalValue: { fontFamily: WEB_FONT, fontSize: 17, color: web.text },
  statusHead: { width: 46 },
  rowWrap: { flexDirection: 'row' },
  stripe: { width: 4 },
  rowInner: { flex: 1 },
  status: { width: 42, alignItems: 'center' },
  empty: { padding: 40, fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
});
