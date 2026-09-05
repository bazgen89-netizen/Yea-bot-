import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { Card, CardGrid, CardLine, CardsNotice, CreateCard } from '../Cards';
import { archiveStaff, listStaff, restoreStaff, type Staff } from '../../db/staff';
import { listLocations } from '../../db/locations';
import { ROLE_LABEL, type Role } from '../../domain/permissions';
import { pluralize } from '../../domain/plural';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { web, WEB_FONT } from '../../ui/webTheme';

/**
 * «Компания / Сотрудники» — карточки кабинета.
 *
 * Сверху сообщение «Всего N сотрудников» и разбивка по ролям: владельцев,
 * управляющих, кассиров, кладовщиков. Разбивка не украшение — по ней сразу
 * видно, что кассиров нет ни одного, а владельцев почему-то трое.
 *
 * Уволенные не исчезают и не мешаются: они уходят под сворачивающуюся полосу
 * «Уволенные сотрудники» в конце списка, и у каждого кнопка «Восстановить».
 * Удалить сотрудника нельзя вовсе — на него ссылаются чеки и документы, и
 * «кто продал» перестало бы отвечаться.
 */

/** Порядок и подписи счётчиков — его. */
const COUNTERS: { role: Role; label: string }[] = [
  { role: 'owner', label: 'Владельцев' },
  { role: 'manager', label: 'Управляющих' },
  { role: 'cashier', label: 'Кассиры' },
  { role: 'storekeeper', label: 'Кладовщиков' },
];

export function StaffCards({ onEdit }: { onEdit: (staff: Staff | 'new') => void }) {
  const { db, refresh } = useDatabase();
  const staff = useQuery((database) => listStaff(database, true));
  const locations = useQuery((database) => listLocations(database));

  const [showFired, setShowFired] = useState(false);

  const working = staff.filter((person) => person.archived === 0);
  const fired = staff.filter((person) => person.archived === 1);

  const shopName = (id: number | null) =>
    locations.find((location) => location.id === id)?.name ?? null;

  function fire(person: Staff) {
    confirm(
      `Уволить ${person.name}?`,
      'Сотрудник уйдёт из списка, но останется в чеках и документах: без него «кто продал» стало бы нечем ответить. Восстановить можно в любой момент.',
      'Уволить',
      () => {
        archiveStaff(db, person.id);
        refresh();
      },
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <CardsNotice
        title={`Всего ${pluralize(working.length, 'сотрудник', 'сотрудника', 'сотрудников')}`}
      >
        {COUNTERS.map((counter) => (
          <Text key={counter.role} style={styles.counter}>
            {counter.label}: {working.filter((person) => person.role === counter.role).length}
          </Text>
        ))}
      </CardsNotice>

      <CardGrid>
        <CreateCard onPress={() => onEdit('new')} />

        {working.map((person) => (
          <Card
            key={person.id}
            icon={<WebIcon.parties size={20} color={web.textMuted} />}
            title={person.name}
            onOpen={() => onEdit(person)}
            lines={
              <>
                <CardLine icon={<WebIcon.gear size={13} color={web.textMuted} />}>
                  {ROLE_LABEL[person.role]}
                </CardLine>
                <CardLine icon={<WebIcon.storefront size={13} color={web.textMuted} />}>
                  {person.phone ?? '—'}
                </CardLine>
                {person.email ? (
                  <CardLine icon={<WebIcon.comment size={13} color={web.textMuted} />}>
                    {person.email}
                  </CardLine>
                ) : null}
                {shopName(person.location_id) ? (
                  <CardLine icon={<WebIcon.company size={13} color={web.textMuted} />}>
                    {shopName(person.location_id)}
                  </CardLine>
                ) : null}
              </>
            }
            onEdit={() => onEdit(person)}
            onDelete={() => fire(person)}
          />
        ))}
      </CardGrid>

      {fired.length > 0 ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showFired }}
            onPress={() => setShowFired((on) => !on)}
            style={styles.firedToggle}
          >
            <Text style={styles.firedLabel}>Уволенные сотрудники</Text>
            {showFired ? (
              <WebIcon.chevronUp size={14} color={web.text} />
            ) : (
              <WebIcon.chevronDown size={14} color={web.text} />
            )}
          </Pressable>

          {showFired ? (
            <CardGrid>
              {fired.map((person) => (
                <Card
                  key={person.id}
                  icon={<WebIcon.parties size={20} color={web.textMuted} />}
                  title={person.name}
                  lines={
                    <>
                      <CardLine icon={<WebIcon.gear size={13} color={web.textMuted} />}>
                        {ROLE_LABEL[person.role]}
                      </CardLine>
                      <CardLine icon={<WebIcon.storefront size={13} color={web.textMuted} />}>
                        {person.phone ?? '—'}
                      </CardLine>
                    </>
                  }
                  footer={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Восстановить ${person.name}`}
                      onPress={() => {
                        restoreStaff(db, person.id);
                        refresh();
                      }}
                      style={styles.restore}
                    >
                      <WebIcon.goods size={14} color={web.orange} />
                      <Text style={styles.restoreLabel}>Восстановить</Text>
                    </Pressable>
                  }
                />
              ))}
            </CardGrid>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  content: { padding: 24, gap: 20 },
  counter: { fontFamily: WEB_FONT, fontSize: 14, color: web.text, marginLeft: 14 },

  firedToggle: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 4,
  },
  firedLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  restore: {
    flex: 1,
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: web.orange,
    borderRadius: 4,
  },
  restoreLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.orange },
});
