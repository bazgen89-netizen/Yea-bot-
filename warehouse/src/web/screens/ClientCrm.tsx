import { useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../Translated';

import {
  addNote,
  addTask,
  allTags,
  crmClients,
  listNotes,
  listTasks,
  removeNote,
  removeTask,
  setTags,
  setTaskDone,
  tagsOf,
  today,
} from '../../db/crm';
import { SEGMENT_LABEL, SEGMENT_NOTE, standingOf, whatsappLink, сроком } from '../../domain/crm';
import type { CounterpartyWithTotals } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { web, WEB_FONT } from '../../ui/webTheme';
import { confirm, say } from '../../ui/alert';

/**
 * Заметки, дела и метки — то, чего не бывает в чеке.
 *
 * Заметка отдельными строками, а не одним полем: поле переписывают поверх, и
 * «пьёт только шу» стирается тем, кто дописал «просил позвонить». История
 * разговоров — список, а не строка.
 *
 * Всё сохраняется сразу, без кнопки «Сохранить» на весь блок. Заметка,
 * набранная и потерянная из-за того, что человек закрыл карточку, — худшее,
 * что может случиться с этим экраном: второй раз её уже не напишут.
 */
export function ClientCrm({ party }: { party: CounterpartyWithTotals }) {
  const { db, refresh } = useDatabase();

  const [note, setNote] = useState('');
  const [task, setTask] = useState('');
  const [due, setDue] = useState(today());
  const [tag, setTag] = useState('');

  const notes = useQuery((database) => listNotes(database, party.id), [party.id]);
  const tasks = useQuery(
    (database) => listTasks(database, { partyId: party.id, state: 'all' }),
    [party.id],
  );
  const known = useQuery((database) => allTags(crmClients(database)), []);

  const свои = tagsOf(party.tags ?? '');
  const место = standingOf(
    {
      receipts: party.receipts,
      purchases: party.purchases,
      first_sale_at: party.first_sale_at,
      last_sale_at: party.last_sale_at,
    },
    Date.now(),
  );

  function сохранитьЗаметку() {
    if (!note.trim()) return;
    addNote(db, party.id, note);
    setNote('');
    refresh();
  }

  function завестиДело() {
    if (!task.trim()) {
      say('Нужно название', 'Без названия дело потом не понять.');
      return;
    }
    addTask(db, { partyId: party.id, title: task, due });
    setTask('');
    refresh();
  }

  function метка(one: string, добавить: boolean) {
    const было = tagsOf(party.tags ?? '');
    setTags(db, party.id, добавить ? [...было, one] : было.filter((t) => t !== one));
    refresh();
  }

  const ссылка = whatsappLink(party.phone, `${party.name.trim().split(/\s+/)[0]}, здравствуйте! `);

  return (
    <View style={styles.block}>
      <View style={styles.standing}>
        <Text style={styles.standingLabel}>{SEGMENT_LABEL[место.segment]}</Text>
        <Text style={styles.standingNote}>
          {SEGMENT_NOTE[место.segment]}. Последняя покупка {сроком(место.idle)}
          {место.overdue ? `, опоздал на ${место.overdue} дн.` : ''}
        </Text>
        {ссылка ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Написать ${party.name} в WhatsApp`}
            onPress={() => void Linking.openURL(ссылка)}
            style={styles.write}
          >
            <Text style={styles.writeLabel}>Написать в WhatsApp</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.title}>Метки</Text>
      <View style={styles.tags}>
        {свои.map((one) => (
          <Pressable
            key={one}
            accessibilityRole="button"
            accessibilityLabel={`Убрать метку «${one}»`}
            onPress={() => метка(one, false)}
            style={[styles.tag, styles.tagOn]}
          >
            <Text style={styles.tagOnLabel}>{one} ×</Text>
          </Pressable>
        ))}
        {known
          .filter((one) => !свои.includes(one))
          .map((one) => (
            <Pressable
              key={one}
              accessibilityRole="button"
              accessibilityLabel={`Поставить метку «${one}»`}
              onPress={() => метка(one, true)}
              style={styles.tag}
            >
              <Text style={styles.tagLabel}>+ {one}</Text>
            </Pressable>
          ))}
      </View>
      <View style={styles.line}>
        <TextInput
          value={tag}
          onChangeText={setTag}
          placeholder="Новая метка — «опт», «бар»"
          placeholderTextColor={web.textMuted}
          style={styles.input}
          onSubmitEditing={() => {
            if (!tag.trim()) return;
            метка(tag, true);
            setTag('');
          }}
          returnKeyType="done"
        />
      </View>

      <Text style={styles.title}>Заметки</Text>
      <View style={styles.line}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Пьёт только шу, дочь Аня, аллергия на жасмин"
          placeholderTextColor={web.textMuted}
          style={[styles.input, styles.multiline]}
          multiline
        />
        <Pressable accessibilityRole="button" onPress={сохранитьЗаметку} style={styles.button}>
          <Text style={styles.buttonLabel}>Записать</Text>
        </Pressable>
      </View>

      {notes.map((one) => (
        <View key={one.id} style={styles.note}>
          <View style={styles.noteBody}>
            <Text style={styles.noteText}>{one.body}</Text>
            <Text style={styles.noteWhen}>
              {new Date(one.created_at).toLocaleDateString('ru-RU')}
              {one.author ? ` · ${one.author}` : ''}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Удалить заметку"
            onPress={() =>
              confirm('Удалить заметку?', one.body, 'Удалить', () => {
                removeNote(db, one.id);
                refresh();
              })
            }
            style={styles.remove}
          >
            <Text style={styles.removeLabel}>×</Text>
          </Pressable>
        </View>
      ))}
      {notes.length === 0 ? <Text style={styles.empty}>Заметок пока нет</Text> : null}

      <Text style={styles.title}>Дела</Text>
      <View style={styles.line}>
        <TextInput
          value={task}
          onChangeText={setTask}
          placeholder="Позвонить про пуэр 2019 года"
          placeholderTextColor={web.textMuted}
          style={styles.input}
          onSubmitEditing={завестиДело}
          returnKeyType="done"
        />
        <TextInput
          value={due}
          onChangeText={setDue}
          placeholder="ГГГГ-ММ-ДД"
          placeholderTextColor={web.textMuted}
          style={styles.date}
        />
        <Pressable accessibilityRole="button" onPress={завестиДело} style={styles.button}>
          <Text style={styles.buttonLabel}>Поставить</Text>
        </Pressable>
      </View>

      {tasks.map((one) => (
        <View key={one.id} style={styles.note}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: Boolean(one.done_at) }}
            accessibilityLabel={one.title}
            onPress={() => {
              setTaskDone(db, one.id, !one.done_at);
              refresh();
            }}
            style={[styles.box, one.done_at ? styles.boxOn : null]}
          >
            <Text style={styles.boxMark}>{one.done_at ? '✓' : ''}</Text>
          </Pressable>
          <View style={styles.noteBody}>
            <Text style={[styles.noteText, one.done_at ? styles.done : null]}>{one.title}</Text>
            <Text style={styles.noteWhen}>до {one.due_date}</Text>
          </View>
          {!one.done_at && one.due_date <= today() ? (
            <Text style={styles.due}>пора</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Удалить дело"
            onPress={() =>
              confirm('Удалить дело?', one.title, 'Удалить', () => {
                removeTask(db, one.id);
                refresh();
              })
            }
            style={styles.remove}
          >
            <Text style={styles.removeLabel}>×</Text>
          </Pressable>
        </View>
      ))}
      {tasks.length === 0 ? <Text style={styles.empty}>Дел по нему нет</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10, paddingVertical: 6 },

  standing: {
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: web.radiusControl,
    padding: 12,
    gap: 4,
  },
  standingLabel: { fontFamily: WEB_FONT, fontSize: 16, fontWeight: '700', color: web.text },
  standingNote: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted, lineHeight: 18 },
  write: {
    alignSelf: 'flex-start',
    marginTop: 6,
    borderWidth: 1,
    borderColor: web.green,
    borderRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  writeLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.greenText },

  title: { fontFamily: WEB_FONT, fontSize: 14, fontWeight: '700', color: web.text, marginTop: 6 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  multiline: { minHeight: 56 },
  date: {
    width: 120,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  button: {
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  buttonLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagOn: { backgroundColor: '#EFF1F3', borderColor: '#DDE0E3' },
  tagLabel: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },
  tagOnLabel: { fontFamily: WEB_FONT, fontSize: 12, color: web.text },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  noteBody: { flex: 1, gap: 2 },
  noteText: { fontFamily: WEB_FONT, fontSize: 14, color: web.text, lineHeight: 19 },
  noteWhen: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },
  done: { color: web.textMuted, textDecorationLine: 'line-through' },
  due: { fontFamily: WEB_FONT, fontSize: 12, color: web.orange },
  remove: { paddingHorizontal: 6 },
  removeLabel: { fontFamily: WEB_FONT, fontSize: 18, color: web.textMuted },
  empty: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted, paddingVertical: 6 },

  box: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: web.green, borderColor: web.green },
  boxMark: { color: '#FFFFFF', fontSize: 13, lineHeight: 16 },
});
