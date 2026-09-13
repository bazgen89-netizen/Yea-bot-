import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { Dropdown, type Option } from '../Dropdown';
import {
  ВИДЫ,
  listTrash,
  restoreMany,
  type ВидКорзины,
  type СтрокаКорзины,
} from '../../db/trash';
import { быстрыеПериоды } from '../../domain/reportFilter';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { web, webText, WEB_FONT } from '../../ui/webTheme';

/**
 * «Корзина» — то, что удалили и ещё можно вернуть.
 *
 * Устроена как у него: сверху кнопка «Восстановить», отбор по типу и за
 * период, ниже таблица из двух колонок — наименование и дата удаления.
 * Строки отмечаются галочками, отмеченные возвращаются разом.
 *
 * Чего у него есть, а у нас нет: удалённых документов. У нас отмена документа
 * стирает его вместе с движениями по складу насовсем, возвращать оттуда
 * нечего — см. `src/db/trash.ts`. Обещать кнопку, которая не сработает, хуже,
 * чем честно её не показывать.
 */
export function TrashTable() {
  const { db, refresh } = useDatabase();

  const [вид, задатьВид] = useState<ВидКорзины | ''>('');
  /*
   * По умолчанию — неделя, как у него: в его корзине сверху стоит
   * «7 дней (06.09.2026 — 12.09.2026)».
   *
   * И это не просто повтор за ним, а ещё и единственный способ, чтобы раздел
   * был полезен. У нас «убран из работы» и «удалён» — один и тот же признак,
   * а из CloudShop приехали 689 снятых с продажи карточек. Покажи мы всё
   * подряд — человек утонет в них и своего вчерашнего удаления не найдёт.
   * У приехавших даты нет вовсе, поэтому ни в какой период они не попадают;
   * увидеть их можно, выбрав «Всё время».
   */
  const [период, задатьПериод] = useState('неделя');
  const [отмечено, отметить] = useState<ReadonlySet<string>>(new Set());

  const периодыСписком = useMemo(() => быстрыеПериоды(), []);
  const границы = useMemo(
    () => периодыСписком.find((один) => один.ключ === период) ?? null,
    [период, периодыСписком],
  );

  const строки = useQuery(
    (база) =>
      listTrash(база, {
        вид: вид || null,
        от: границы?.от ?? null,
        до: границы?.до ?? null,
      }),
    [вид, период],
  );

  const ключ = (строка: СтрокаКорзины) => `${строка.вид}:${строка.id}`;

  function переключить(строка: СтрокаКорзины) {
    отметить((было) => {
      const стало = new Set(было);
      const к = ключ(строка);
      if (!стало.delete(к)) стало.add(к);
      return стало;
    });
  }

  const всеОтмечены = строки.length > 0 && строки.every((строка) => отмечено.has(ключ(строка)));

  function переключитьВсе() {
    отметить(всеОтмечены ? new Set() : new Set(строки.map(ключ)));
  }

  function вернуть() {
    const вернём = строки.filter((строка) => отмечено.has(ключ(строка)));
    if (вернём.length === 0) {
      say('Ничего не отмечено', 'Отметьте галочками то, что нужно вернуть.');
      return;
    }

    restoreMany(
      db,
      вернём.map((строка) => ({ вид: строка.вид, id: строка.id as Id })),
    );
    отметить(new Set());
    refresh();
  }

  const видыДляОтбора: Option<ВидКорзины | ''>[] = [
    { value: '', label: 'Все' },
    ...Object.entries(ВИДЫ).map(([значение, подпись]) => ({
      value: значение as ВидКорзины,
      label: подпись,
    })),
  ];

  const периоды: Option<string>[] = [
    { value: 'всё', label: 'Всё время' },
    ...периодыСписком.map((один) => ({ value: один.ключ, label: один.имя })),
  ];

  return (
    <View style={стиль.экран}>
      <View style={стиль.панель}>
        <Pressable
          accessibilityRole="button"
          onPress={вернуть}
          style={({ pressed }) => [стиль.вернуть, pressed && { opacity: 0.9 }]}
        >
          <WebIcon.loop color="#FFFFFF" size={16} />
          <Text style={стиль.вернутьПодпись}>Восстановить</Text>
        </Pressable>

        <View style={стиль.отбор}>
          <Text style={стиль.подписьОтбора}>ТИП</Text>
          <Dropdown value={вид} options={видыДляОтбора} onChange={задатьВид} label="Тип" />
        </View>

        <View style={стиль.отбор}>
          <Text style={стиль.подписьОтбора}>ПЕРИОД</Text>
          <Dropdown value={период} options={периоды} onChange={задатьПериод} label="Период" />
        </View>
      </View>

      <ScrollView>
        <View style={стиль.шапка}>
          <Галочка отмечена={всеОтмечены} нажать={переключитьВсе} />
          <Text style={[webText.column, стиль.колонкаИмя]}>Наименование</Text>
          <Text style={[webText.column, стиль.колонкаДата]}>Дата удаления</Text>
        </View>

        {строки.length === 0 ? (
          <View style={стиль.пусто}>
            <Text style={стиль.пустоТекст}>
              {вид || период !== 'всё'
                ? 'За этот период ничего не удаляли.'
                : 'Корзина пуста — ничего не удаляли.'}
            </Text>
          </View>
        ) : (
          строки.map((строка) => (
            <Pressable
              key={ключ(строка)}
              accessibilityRole="button"
              onPress={() => переключить(строка)}
              style={(состояние) => [
                стиль.строка,
                // `hovered` в типах react-native нет, а в вебе он есть и
                // работает: подсветка строки под курсором — как у него.
                (состояние as { hovered?: boolean }).hovered
                  ? { backgroundColor: web.rowHover }
                  : null,
              ]}
            >
              <Галочка
                отмечена={отмечено.has(ключ(строка))}
                нажать={() => переключить(строка)}
              />
              <View style={стиль.колонкаИмя}>
                <Text style={webText.rowCell}>{строка.name}</Text>
                <Text style={webText.cellSmall}>
                  {[ВИДЫ[строка.вид], строка.note].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={[webText.rowCell, стиль.колонкаДата]}>
                {датаУдаления(строка.archived_at)}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

/**
 * «2026-09-12 13:24:05» → «12.09.2026 13:24», как у него.
 *
 * Пусто — когда вещь убрали до того, как мы стали запоминать дату. Ставим
 * прочерк: выдумать её неоткуда.
 */
function датаУдаления(метка: string | null): string {
  if (!метка) return '—';

  const разбор = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(метка);
  if (!разбор) return метка;

  const [, год, месяц, день, часы, минуты] = разбор;
  return `${день}.${месяц}.${год} ${часы}:${минуты}`;
}

function Галочка({ отмечена, нажать }: { отмечена: boolean; нажать: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: отмечена }}
      onPress={нажать}
      hitSlop={6}
      style={[стиль.галочка, отмечена && стиль.галочкаОтмечена]}
    >
      {отмечена ? <WebIcon.done color="#FFFFFF" size={13} /> : null}
    </Pressable>
  );
}

const стиль = StyleSheet.create({
  экран: { flex: 1, backgroundColor: web.bg },
  панель: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  вернуть: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: web.createButton,
    paddingHorizontal: 16,
    height: 36,
    borderRadius: web.radiusControl,
  },
  вернутьПодпись: { fontFamily: WEB_FONT, fontSize: 13, color: '#FFFFFF', fontWeight: '500' },
  отбор: { gap: 4 },
  подписьОтбора: { fontFamily: WEB_FONT, fontSize: 10, color: web.textMuted, letterSpacing: 0.3 },

  шапка: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 22,
    paddingVertical: 10,
    backgroundColor: web.tableHead,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: web.border,
  },
  строка: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  колонкаИмя: { flex: 1, gap: 2 },
  колонкаДата: { width: 200 },

  галочка: {
    width: 17,
    height: 17,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: web.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  галочкаОтмечена: { backgroundColor: web.createButton, borderColor: web.createButton },

  пусто: { padding: 40, alignItems: 'center' },
  пустоТекст: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },
});
