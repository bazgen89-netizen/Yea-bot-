import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { listLocations } from '../src/db/locations';
import {
  archiveStaff,
  clearCurrentStaff,
  createStaff,
  currentStaff,
  listStaff,
  restoreStaff,
  setCurrentStaff,
  updateStaff,
  type Staff,
} from '../src/db/staff';
import {
  PERMISSIONS,
  PERMISSION_LABEL,
  ROLE_HINT,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  permissionsOf,
  type Permission,
  type Role,
} from '../src/domain/permissions';
import { useDatabase, useQuery } from '../src/state/DatabaseProvider';
import { Badge, Button, Card, Choice, Empty, Field, Row } from '../src/ui/components';
import { colors, radius, spacing, text } from '../src/ui/theme';
import { confirm, say } from '../src/ui/alert';
import { useDesktop } from '../src/ui/useDesktop';
import { StaffCards } from '../src/web/screens/StaffCards';

/**
 * Сотрудники и права.
 *
 * Раньше здесь была заглушка, и это было честно: роль без сотрудников — просто
 * слово. Экран заводит людей, раздаёт им права и отвечает на вопрос «кто сейчас
 * работает» — без последнего права остаются описанием, которое ни на что не
 * влияет.
 *
 * Кода у сотрудника может не быть: в чайной с одним продавцом набирать четыре
 * цифры на каждую смену — работа без причины.
 */
export default function StaffScreen() {
  const { db, refresh } = useDatabase();
  const staff = useQuery((database) => listStaff(database, true));
  const working = useQuery((database) => currentStaff(database));

  const [editing, setEditing] = useState<Staff | 'new' | null>(null);

  // На широком экране сотрудники показаны карточками, как в кабинете:
  // счётчики по ролям, карточка на человека, уволенные под сворачивающейся
  // полосой. Форма правки — общая с телефоном, отличать её незачем.
  const desktop = useDesktop();

  if (editing) {
    return (
      <StaffForm
        staff={editing === 'new' ? null : editing}
        onDone={() => {
          setEditing(null);
          refresh();
        }}
      />
    );
  }

  if (desktop) return <StaffCards onEdit={setEditing} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={text.heading}>Кто работает</Text>
        <Text style={[text.muted, styles.hint]}>
          {working
            ? `${working.name} · ${ROLE_LABEL[working.role]}`
            : staff.some((item) => !item.archived)
              ? 'Никто не выбран — программа открыта целиком'
              : 'Сотрудников нет — программа открыта целиком'}
        </Text>

        {working ? (
          <Button
            title="Выйти"
            variant="secondary"
            onPress={() => {
              clearCurrentStaff(db);
              refresh();
            }}
          />
        ) : null}
      </Card>

      {staff.length === 0 ? (
        <Empty
          title="Сотрудников пока нет"
          hint="Заведите продавца, чтобы за кассу можно было пустить кого-то ещё"
        />
      ) : (
        <Card style={styles.list}>
          {staff.map((item) => (
            <Row
              key={item.id}
              onPress={() => setEditing(item)}
              left={
                <>
                  <Text style={text.body}>{item.name}</Text>
                  <Text style={text.muted}>
                    {ROLE_LABEL[item.role]}
                    {item.permissions ? ' · свои права' : ''}
                    {item.phone ? ` · ${item.phone}` : ''}
                  </Text>
                </>
              }
              right={
                item.archived ? (
                  <Badge label="В архиве" tone="danger" />
                ) : working?.id === item.id ? (
                  <Badge label="Работает" tone="success" />
                ) : (
                  <SwitchButton staff={item} />
                )
              }
            />
          ))}
        </Card>
      )}

      <Button title="Добавить сотрудника" onPress={() => setEditing('new')} />
    </ScrollView>
  );
}

/** Постановка за прилавок: с кодом, если он задан. */
function SwitchButton({ staff }: { staff: Staff }) {
  const { db, refresh } = useDatabase();
  const [pin, setPin] = useState('');
  const [asking, setAsking] = useState(false);

  function enter(code?: string) {
    if (setCurrentStaff(db, staff.id, code)) {
      setAsking(false);
      setPin('');
      refresh();
      return;
    }
    say('Код не подошёл', 'Попробуйте ещё раз или обратитесь к владельцу.');
  }

  if (staff.pin && asking) {
    return (
      <View style={styles.pinRow}>
        <TextInput
          value={pin}
          onChangeText={setPin}
          placeholder="Код"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          secureTextEntry
          autoFocus
          style={styles.pinInput}
        />
        <Pressable accessibilityRole="button" onPress={() => enter(pin)} hitSlop={8}>
          <Text style={styles.pinGo}>Войти</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => (staff.pin ? setAsking(true) : enter())}
      hitSlop={8}
    >
      <Text style={styles.switchLabel}>За прилавок</Text>
    </Pressable>
  );
}

function StaffForm({ staff, onDone }: { staff: Staff | null; onDone: () => void }) {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const locations = useQuery((database) => listLocations(database));

  const [name, setName] = useState(staff?.name ?? '');
  const [phone, setPhone] = useState(staff?.phone ?? '');
  const [email, setEmail] = useState(staff?.email ?? '');
  const [pin, setPin] = useState(staff?.pin ?? '');
  const [role, setRole] = useState<Role>(staff?.role ?? 'seller');
  const [location, setLocation] = useState(staff?.location_id ?? null);
  const [rights, setRights] = useState<Permission[]>(
    staff ? permissionsOf(staff) : ROLE_PERMISSIONS.seller,
  );

  /** Смена роли переписывает права: их и выбирают ради роли. */
  function pickRole(value: Role) {
    setRole(value);
    setRights(ROLE_PERMISSIONS[value]);
  }

  function save() {
    if (!name.trim()) {
      say('Нужно имя', 'Без имени сотрудника не отличить от другого.');
      return;
    }

    const input = {
      name,
      phone,
      email,
      role,
      pin,
      location_id: location,
      permissions: rights,
    };

    if (staff) updateStaff(db, staff.id, input);
    else createStaff(db, input);

    refresh();
    onDone();
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Field label="Имя" value={name} onChangeText={setName} placeholder="Анна" />
        <Field
          label="Телефон"
          value={phone}
          onChangeText={setPhone}
          placeholder="+7 999 123-45-67"
          keyboardType="phone-pad"
        />
        <Field label="Почта" value={email} onChangeText={setEmail} placeholder="anna@example.com" />

        <Choice
          label="Роль"
          value={role}
          options={(Object.keys(ROLE_LABEL) as Role[]).map((value) => ({
            value,
            label: ROLE_LABEL[value],
          }))}
          onChange={pickRole}
        />
        <Text style={[text.muted, styles.hint]}>{ROLE_HINT[role]}</Text>

        {locations.length > 1 ? (
          <Choice
            label="Магазин"
            value={location}
            options={locations.map((item) => ({ value: item.id, label: item.name }))}
            onChange={setLocation}
          />
        ) : null}

        <Field
          label="Код для входа"
          value={pin}
          onChangeText={setPin}
          placeholder="Пусто — без кода"
          keyboardType="number-pad"
          secureTextEntry
          hint="Защищает от чужого нажатия, а не от подбора: база на устройстве читается целиком"
        />
      </Card>

      <Card style={styles.list}>
        <Text style={[text.heading, styles.rightsTitle]}>Права</Text>
        <Text style={[text.muted, styles.rightsHint]}>
          По умолчанию — права роли. Снятая или добавленная галочка сохранится
          отдельно и переживёт правку роли.
        </Text>

        {PERMISSIONS.map((permission) => {
          const on = rights.includes(permission);
          return (
            <Pressable
              key={permission}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() =>
                setRights((current) =>
                  on
                    ? current.filter((item) => item !== permission)
                    : [...current, permission],
                )
              }
              style={({ pressed }) => [styles.rightRow, pressed && { opacity: 0.6 }]}
            >
              <View style={[styles.box, on && styles.boxOn]}>
                {on ? <Text style={styles.tick}>✓</Text> : null}
              </View>
              <Text style={text.body}>{PERMISSION_LABEL[permission]}</Text>
            </Pressable>
          );
        })}
      </Card>

      <Button title="Сохранить" onPress={save} />

      {staff ? (
        <Button
          title={staff.archived ? 'Вернуть из архива' : 'Уволить'}
          variant={staff.archived ? 'secondary' : 'danger'}
          onPress={() => {
            if (staff.archived) {
              restoreStaff(db, staff.id);
              refresh();
              onDone();
              return;
            }
            confirm(
              'Уволить сотрудника?',
              'Он исчезнет из списка и не сможет встать за кассу, но останется в проведённых документах.',
              'Уволить',
              () => {
                archiveStaff(db, staff.id);
                refresh();
                onDone();
              },
            );
          }}
        />
      ) : null}

      <Button title="Назад" variant="secondary" onPress={() => (staff ? onDone() : router.back())} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl, maxWidth: 900, width: '100%' },
  hint: { marginTop: spacing.xs, marginBottom: spacing.md, fontSize: 13 },
  list: { padding: 0, paddingTop: spacing.lg, overflow: 'hidden' },
  rightsTitle: { paddingHorizontal: spacing.lg },
  rightsHint: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, fontSize: 13 },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  box: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { fontSize: 13, color: '#FFFFFF', lineHeight: 15 },
  switchLabel: { fontSize: 14, color: colors.accent },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pinInput: {
    width: 80,
    minHeight: 36,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    fontSize: 15,
    color: colors.text,
  },
  pinGo: { fontSize: 14, color: colors.accent },
});
