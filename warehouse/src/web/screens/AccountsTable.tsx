import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Translated';

import { Card, CardGrid, CardLine, CardsNotice, CreateCard } from '../Cards';
import { Drawer, DrawerButton } from '../Drawer';
import { Dropdown } from '../Dropdown';
import { ToolButton, Toolbar } from '../Table';
import {
  ACCOUNT_TYPES,
  accountType,
  archiveAccount,
  blankAccount,
  createAccount,
  getAccount,
  listAccounts,
  totalBalance,
  updateAccount,
  type AccountInput,
  type AccountWithBalance,
} from '../../db/accounts';
import { formatMoneyWeb, parseMoney } from '../../domain/money';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { FORM_BORDER, web, WEB_FONT } from '../../ui/webTheme';

/**
 * «Компания / Счета».
 *
 * У него это карточки, а не таблица: сверху сообщение «Баланс …», ниже
 * пунктирная карточка «Создать» и по карточке на счёт — тип ярлыком, дата
 * создания, остаток, комментарий, снизу «Изменить» и корзина.
 *
 * Остаток по-прежнему не хранится: он складывается из чеков и денежных
 * документов. Хранится только начальный — то, что лежало на счёте до первого
 * документа, и это разные вещи.
 */
export function AccountsTable() {
  const router = useRouter();
  const { db, refresh } = useDatabase();

  const accounts = useQuery((database) => listAccounts(database));
  const total = useQuery((database) => totalBalance(database));

  const [editing, setEditing] = useState<Id | 'new' | null>(null);

  function remove(account: AccountWithBalance) {
    confirm(
      `Удалить счёт «${account.name}»?`,
      'Если по счёту уже ходили деньги, он не удалится, а спрячется: документы должны на что-то ссылаться.',
      'Удалить',
      () => {
        archiveAccount(db, account.id);
        refresh();
      },
    );
  }

  return (
    <View style={styles.screen}>
      <Toolbar>
        <ToolButton
          label="Приход"
          tone="greenOutline"
          onPress={() => router.push('/money/new?type=income')}
        />
        <ToolButton
          label="Расход"
          tone="orangeOutline"
          onPress={() => router.push('/money/new?type=expense')}
        />
        <ToolButton
          label="Перевод"
          tone="blueOutline"
          onPress={() => router.push('/money/new?type=transfer')}
        />
        <ToolButton label="Движение денег" onPress={() => router.push('/money')} />
      </Toolbar>

      <ScrollView contentContainerStyle={styles.content}>
        <CardsNotice title={`Баланс ${formatMoneyWeb(total)}`} />

        <CardGrid>
          <CreateCard onPress={() => setEditing('new')} />

          {accounts.map((account) => {
            const type = accountType(account.type);
            return (
              <Card
                key={account.id}
                label={type.title}
                ribbon={account.is_default === 1}
                icon={<WebIcon.money size={20} color={web.textMuted} />}
                title={account.name}
                onOpen={() => setEditing(account.id)}
                lines={
                  <>
                    <CardLine icon={<WebIcon.calendar size={13} color={web.textMuted} />}>
                      Создан {new Date(account.created_at).toLocaleDateString('ru-RU')}
                    </CardLine>
                    <CardLine icon={<WebIcon.money size={13} color={web.textMuted} />}>
                      Баланс {formatMoneyWeb(account.balance)}
                    </CardLine>
                    {account.description ? (
                      <CardLine icon={<WebIcon.comment size={13} color={web.textMuted} />}>
                        {account.description}
                      </CardLine>
                    ) : null}
                  </>
                }
                onEdit={type.edit ? () => setEditing(account.id) : undefined}
                onDelete={type.edit ? () => remove(account) : undefined}
              />
            );
          })}
        </CardGrid>
      </ScrollView>

      {editing !== null ? (
        <AccountForm id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </View>
  );
}

/** Заведение и правка счёта — его форма поле в поле. */
function AccountForm({ id, onClose }: { id: Id | null; onClose: () => void }) {
  const { db, refresh } = useDatabase();
  const loaded = useQuery((database) => (id ? getAccount(database, id) : null), [id]);

  const [draft, setDraft] = useState<AccountInput>(blankAccount);
  const [ready, setReady] = useState(false);

  if (!ready && (id ? loaded : true)) {
    if (id && loaded) {
      setDraft({
        name: loaded.name,
        type: loaded.type,
        opening_balance: loaded.opening_balance,
        include: loaded.include === 1,
        use_terminal: loaded.use_terminal === 1,
        account_number: loaded.account_number,
        bank_details: loaded.bank_details.length ? loaded.bank_details : [{ key: '', value: '' }],
        description: loaded.description,
        is_default: loaded.is_default === 1,
      });
    }
    setReady(true);
  }

  const set = (patch: Partial<AccountInput>) => setDraft((current) => ({ ...current, ...patch }));

  function save() {
    try {
      if (id) updateAccount(db, id, draft);
      else createAccount(db, draft);
      refresh();
      onClose();
    } catch (error) {
      say('Счёт не сохранён', String(error));
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
        <Text style={styles.formTitle}>{id ? 'Редактирование счёта' : 'Создание счёта'}</Text>
        <Field label="Наименование" value={draft.name} onChange={(name) => set({ name })} required />

        <Field
          label="Текущий баланс"
          value={draft.opening_balance ? String(draft.opening_balance / 100) : ''}
          onChange={(value) => set({ opening_balance: parseMoney(value) ?? 0 })}
          hint="Сколько лежало на счёте до первого документа. Всё, что прошло чеками и ордерами, прибавляется к этому числу само."
        />

        <View style={styles.field}>
          <Text style={styles.label}>Тип счёта</Text>
          <Dropdown
            value={draft.type}
            options={ACCOUNT_TYPES.filter((type) => type.visible).map((type) => ({
              value: type.id,
              label: type.title,
            }))}
            onChange={(type) => set({ type })}
            variant="field"
            label="Тип счёта"
          />
        </View>

        <Toggle
          label="Включен в общий баланс"
          on={draft.include}
          onChange={(include) => set({ include })}
        />

        {draft.type === 'bank_account' ? (
          <Toggle
            label="Используется терминал"
            on={draft.use_terminal}
            onChange={(use_terminal) => set({ use_terminal })}
          />
        ) : null}

        <Toggle
          label="По умолчанию"
          on={draft.is_default}
          onChange={(is_default) => set({ is_default })}
        />

        {draft.type === 'bank_account' ? (
          <>
            <Divider>Банковские реквизиты</Divider>

            <Field
              label="Номер счета"
              value={draft.account_number ?? ''}
              onChange={(account_number) => set({ account_number })}
            />

            <Text style={styles.label}>
              Ввод реквизитов вручную (
              <Text
                accessibilityRole="link"
                onPress={() => set({ bank_details: [...draft.bank_details, { key: '', value: '' }] })}
                style={styles.addMore}
              >
                добавить еще
              </Text>
              )
            </Text>

            {draft.bank_details.map((item, index) => (
              <View key={index} style={styles.pair}>
                <TextInput
                  value={item.key}
                  onChangeText={(key) =>
                    set({
                      bank_details: draft.bank_details.map((row, i) =>
                        i === index ? { ...row, key } : row,
                      ),
                    })
                  }
                  placeholder="Наименование реквизита (прим. БИК)"
                  placeholderTextColor={web.textMuted}
                  accessibilityLabel={`Наименование реквизита ${index + 1}`}
                  style={[styles.input, styles.half]}
                />
                <TextInput
                  value={item.value}
                  onChangeText={(value) =>
                    set({
                      bank_details: draft.bank_details.map((row, i) =>
                        i === index ? { ...row, value } : row,
                      ),
                    })
                  }
                  placeholder="Номер реквизита (прим. 776353444)"
                  placeholderTextColor={web.textMuted}
                  accessibilityLabel={`Номер реквизита ${index + 1}`}
                  style={[styles.input, styles.half]}
                />
              </View>
            ))}
          </>
        ) : null}

        <Field
          label="Комментарий"
          value={draft.description ?? ''}
          onChange={(description) => set({ description })}
        />
      </View>
    </Drawer>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  required?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        style={styles.input}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={() => onChange(!on)}
      style={styles.toggleRow}
    >
      <View style={[styles.track, on && styles.trackOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
      <Text style={styles.toggleLabel}>{label}</Text>
    </Pressable>
  );
}

function Divider({ children }: { children: string }) {
  return (
    <View style={styles.dividerRow}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>{children}</Text>
      <View style={styles.dividerLine} />
    </View>
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
  addMore: { color: web.link, fontWeight: '400' },
  hint: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },
  input: {
    height: 38,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 10,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  pair: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { width: 49, height: 21, borderRadius: 11, backgroundColor: '#D4D4D5', padding: 2 },
  trackOn: { backgroundColor: web.green },
  knob: { width: 17, height: 17, borderRadius: 9, backgroundColor: '#FFFFFF' },
  knobOn: { transform: [{ translateX: 30 }] },
  toggleLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
  dividerLine: { flex: 1, height: 1, backgroundColor: web.border },
  dividerText: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },
});
