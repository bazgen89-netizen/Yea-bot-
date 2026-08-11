import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Column, HeadRow, Pager, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import { listCounterparties } from '../../db/counterparties';
import type { CounterpartyWithTotals, PartyKind } from '../../domain/types';
import { useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { web, webText, WEB_FONT } from '../../ui/webTheme';

/** 3184 клиента дают 64 страницы — ровно как в исходном приложении. */
const PAGE_SIZE = 50;

const COLUMNS: Column[] = [
  { key: 'name', title: 'Клиент', width: 320, sortable: true },
  { key: 'phone', title: 'Телефон', width: 180 },
  { key: 'email', title: 'Email', width: 220 },
  { key: 'birthday', title: 'День рождения', width: 170, sortable: true },
  { key: 'gender', title: 'Пол', width: 120, sortable: true },
  { key: 'note', title: 'Описание', width: 260 },
  { key: 'address', title: 'Адрес', width: 180 },
  { key: 'by', title: 'Добавил', width: 160 },
];

/** «Клиенты» и «Поставщики» — таблица кабинета. */
export function PartiesTable({ kind }: { kind: PartyKind }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

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
          onPress={() =>
            router.push({ pathname: '/counterparty/[id]', params: { id: 'new', kind } })
          }
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
        <ToolButton label="Информация" tone="blueOutline" soon />
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
          <HeadRow columns={COLUMNS} />

          <ScrollView>
            {shown.map((party) => (
              <PartyRow
                key={party.id}
                party={party}
                onPress={() =>
                  router.push({ pathname: '/counterparty/[id]', params: { id: String(party.id) } })
                }
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
    </View>
  );
}

function PartyRow({
  party,
  onPress,
}: {
  party: CounterpartyWithTotals;
  onPress: () => void;
}) {
  const [name, phone, email, birthday, gender, note, address, by] = COLUMNS;

  return (
    <Row onPress={onPress}>
      <View style={[styles.nameCell, { width: name.width }]}>
        <WebIcon.parties size={15} color={web.link} />
        <Text style={webText.link} numberOfLines={2}>
          {party.name}
        </Text>
      </View>

      <Text style={[webText.link, { width: phone.width }]} numberOfLines={1}>
        {party.phone ?? ''}
      </Text>
      <Text style={[webText.link, { width: email.width }]} numberOfLines={1}>
        {party.email ?? ''}
      </Text>
      <Text style={[webText.cell, { width: birthday.width }]}>{party.birthday ?? '-'}</Text>
      <Text style={[webText.cell, { width: gender.width }]}>{party.gender ?? ''}</Text>
      <Text style={[webText.cell, { width: note.width }]} numberOfLines={2}>
        {party.note ?? ''}
      </Text>
      <Text style={[webText.cell, { width: address.width }]} numberOfLines={1}>
        {party.address ?? ''}
      </Text>
      <Text style={[webText.link, { width: by.width }]} numberOfLines={1}>
        {party.created_by ?? ''}
      </Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  nameCell: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  total: { fontFamily: WEB_FONT, fontSize: 16, color: web.text, marginHorizontal: 6 },
  empty: { padding: 40, fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
});
