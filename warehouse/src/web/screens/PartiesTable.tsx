import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { Dropdown } from '../Dropdown';
import { partySets, SET_LABEL, type PartyColumn, type PartySet } from '../partyColumns';
import { HeadRow, Pager, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import { PartyCard } from './PartyCard';
import { listCounterparties } from '../../db/counterparties';
import type { CounterpartyWithTotals, Id, PartyKind } from '../../domain/types';
import { useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { web, webText, WEB_FONT } from '../../ui/webTheme';

/** 3184 клиента дают 64 страницы — ровно как в исходном приложении. */
const PAGE_SIZE = 50;

/**
 * «Клиенты» и «Поставщики» — таблица кабинета.
 *
 * Колонок не один набор, а несколько: у него сверху выпадающий список, и он
 * переключает всю таблицу — «Информация», «Лояльность», «Статистика».
 * См. `partyColumns`.
 */
export function PartiesTable({ kind }: { kind: PartyKind }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [set, setSet] = useState<PartySet>('basic');
  // Карточка открывается панелью справа, не уводя со списка: в кабинете
  // это `sidebar: true`, и после сохранения список остаётся на месте.
  const [open, setOpen] = useState<Id | 'new' | null>(null);

  const sets = useMemo(() => partySets(kind), [kind]);
  const columns = sets.find((item) => item.key === set)?.columns ?? sets[0].columns;

  const parties = useQuery(
    (db) => listCounterparties(db, { kind, search }),
    [kind, search],
  );

  const pages = Math.max(1, Math.ceil(parties.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = useMemo(
    () => parties.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    [parties, current],
  );

  const customers = kind !== 'supplier';

  return (
    <View style={styles.screen}>
      <Toolbar>
        <ToolButton
          label="Создать"
          tone="green"
          onPress={() => setOpen('new')}
        />
        <SearchBox
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="поиск"
          width={278}
        />
        <Dropdown
          value={set}
          onChange={setSet}
          options={sets.map((item) => ({ value: item.key, label: SET_LABEL[item.key] }))}
          width={190}
          label="Набор колонок"
        />
        {customers ? (
          <ToolButton label="Настройка системы лояльности" tone="orangeOutline" soon />
        ) : null}
        <Text style={styles.total}>Итог {parties.length}</Text>
        <ToolButton
          label={customers ? 'Импорт клиентов' : 'Импорт поставщиков'}
          tone="greenOutline"
          icon={<WebIcon.excel color={web.greenText} />}
          onPress={() =>
            router.push(`/import?kind=${customers ? 'customers' : 'suppliers'}`)
          }
        />
        <ToolButton
          label="Скачать в Excel"
          icon={<WebIcon.excel color={web.text} />}
          soon
        />
      </Toolbar>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <HeadRow
            columns={columns.map((column) => ({
              key: column.key,
              title: column.title,
              width: column.width,
              numeric: column.numeric,
            }))}
          />

          <ScrollView>
            {shown.map((party) => (
              <PartyRow
                key={party.id}
                party={party}
                columns={columns}
                onPress={() => setOpen(party.id)}
              />
            ))}

            {shown.length === 0 ? (
              <Text style={styles.empty}>
                {search ? 'Ничего не нашлось' : 'Пока никого нет'}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </ScrollView>

      <Pager page={current} pages={pages} onPage={setPage} />
      {open !== null ? (
        <PartyCard
          id={open === 'new' ? null : open}
          kind={kind}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </View>
  );
}

function PartyRow({
  party,
  columns,
  onPress,
}: {
  party: CounterpartyWithTotals;
  columns: PartyColumn[];
  onPress: () => void;
}) {
  return (
    <Row onPress={onPress}>
      {columns.map((column, index) => {
        // Первая колонка несёт значок и ссылку — по ней открывают карточку.
        if (index === 0) {
          return (
            <View key={column.key} style={[styles.nameCell, { width: column.width }]}>
              <WebIcon.parties size={15} color={web.link} />
              <Text style={webText.link} numberOfLines={2}>
                {column.value(party)}
              </Text>
            </View>
          );
        }

        // Телефон и почта — тоже ссылки: по ним звонят и пишут.
        const link = column.key === 'phone' || column.key === 'email';

        return (
          <Text
            key={column.key}
            style={[
              link ? webText.link : column.numeric ? webText.cellNumber : webText.cell,
              { width: column.width },
              column.numeric && styles.right,
            ]}
            numberOfLines={2}
          >
            {column.value(party)}
          </Text>
        );
      })}
    </Row>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  nameCell: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  right: { textAlign: 'right' },
  total: { fontFamily: WEB_FONT, fontSize: 16, color: web.text, marginHorizontal: 6 },
  empty: { padding: 40, fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
});
