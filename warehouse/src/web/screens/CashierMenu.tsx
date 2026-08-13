import { useRouter, type Href } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { closeShift, openShiftAnywhere, shiftReport } from '../../db/shifts';
import { formatMoneyWeb } from '../../domain/money';
import type { CashierView } from './CashierViews';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { Icon, WebIcon } from '../../ui/icons';
import { pos } from '../../ui/webTheme';

/**
 * Меню кассира — то, что открывает кнопка «Меню» слева внизу.
 *
 * Состав снят с самого кассирского приложения (`/wpapp/`, версия 4.0.1): его
 * код отдаётся без входа, и меню в нём — один список из десятка строк, который
 * видно целиком. Разбор — `docs/меню-кассира.md`.
 *
 * До этого здесь было пятнадцать пунктов: Товары, Клиенты, Проверка
 * документа, События, Оборудование и другие. В его меню их нет — они собраны
 * из таблицы маршрутов, то есть из перечня экранов, которые в приложении
 * существуют. Существовать и стоять в меню — не одно и то же: товары у него
 * и так на витрине кассы, клиент добавляется кнопкой в чеке, оборудование
 * лежит в настройках. Лишние строки не помогают, а заставляют читать список.
 *
 * Порядок и подписи — его, вплоть до сочетаний клавиш: Shift показывает
 * цифры, цифра открывает раздел. Разница в двух местах, и обе намеренные:
 *   — «Открыть смену». У него для этого отдельный экран, на который касса
 *     сама уводит, пока смена закрыта. У нас его нет, и без пункта в меню
 *     смену было бы не открыть вовсе.
 *   — «Возврат долга». У него появляется, когда за клиентами числится долг.
 *     Мы долги не ведём, и пункт, ведущий в пустоту, читался бы как поломка.
 */

interface Item {
  label: string;
  icon: ReactNode;
  /** Раздел, который откроется внутри кассы. */
  view?: CashierView;
  /** Куда вести. Наружу ведёт единственный пункт — «Выйти в кабинет». */
  href?: Href;
  /** Собственное действие: открыть смену, закрыть смену. */
  action?: () => void;
  /** Цифра быстрого вызова — та же, что у него. */
  key?: string;
  tone?: 'danger';
}

export function CashierMenu({
  visible,
  onClose,
  onOpenView,
  mode,
  onToggleMode,
  onOpenShift,
}: {
  visible: boolean;
  onClose: () => void;
  /** Открыть раздел внутри кассы, не уходя с неё. */
  onOpenView: (view: CashierView) => void;
  /** Что кассир сейчас набирает: продажу или возврат. */
  mode: 'sale' | 'return';
  onToggleMode: () => void;
  /** Показать окно «Открытие смены» — оно живёт на самой кассе. */
  onOpenShift: () => void;
}) {
  const router = useRouter();
  const { db, refresh } = useDatabase();

  const shift = useQuery((database) => openShiftAnywhere(database));
  const report = useQuery(
    (database) => (shift ? shiftReport(database, shift.id) : null),
    [shift?.id],
  );

  /**
   * Закрыть смену.
   *
   * Сначала спрашиваем, точно ли закрывать, и только потом пересчитываем
   * ящик: закрытие необратимо, а нажать пункт меню мимо легко. Раньше первым
   * шёл пересчёт, и кассир вводил сумму, ещё не понимая, что закрывает смену.
   */
  function finish() {
    if (!report) return;

    confirm(
      'Действительно хотите закрыть смену?',
      `Смена №${report.shift.id}, чеков ${report.receipts} на ${formatMoneyWeb(report.revenue)}. ` +
        'После закрытия чеки пойдут в следующую смену. Отменить нельзя.',
      'Закрыть смену',
      () => {
        // Пересчитанные наличные спрашиваем: смысл закрытия — сверить ящик
        // с чеками, а не переписать одно в другое.
        const answer = globalThis.prompt?.(
          `Сколько наличных в кассе?\nОжидается ${formatMoneyWeb(report.expectedCash)}`,
          String(report.expectedCash / 100),
        );
        if (answer === null || answer === undefined) return;

        const counted = Math.round(Number(answer.replace(',', '.')) * 100);
        if (!Number.isFinite(counted)) {
          say('Проверьте сумму', 'Наличные — число.');
          return;
        }

        const z = closeShift(db, report.shift.id, counted);
        refresh();
        say(
          `Z-отчёт по смене №${z.shift.id}`,
          [
            `Чеков: ${z.receipts}`,
            `Выручка: ${formatMoneyWeb(z.revenue)}`,
            `Ожидалось в кассе: ${formatMoneyWeb(z.expectedCash)}`,
            `Пересчитано: ${formatMoneyWeb(counted)}`,
            `Расхождение: ${formatMoneyWeb(z.difference ?? 0)}`,
          ].join('\n'),
        );
      },
    );
  }

  const tint = pos.text;

  // Первым идёт выход — так же, как у него: это единственный пункт, который
  // уводит из кассы, и он стоит отдельно от всего остального.
  const exit: Item[] = [
    {
      // У него это «Выйти» — выход из кассирского приложения. Входа у нас
      // нет, и единственное, куда отсюда выходят, — кабинет.
      label: 'Выйти',
      icon: <WebIcon.chevronLeft size={22} color={tint} />,
      href: '/',
      key: '6',
    },
  ];

  const shiftItems: Item[] = shift
    ? [
        {
          // Пункт переключает кассу в режим возврата, а не открывает журнал:
          // у него он так и устроен — `toggleDocType`, и подпись меняется
          // на обратную, пока возврат набирается.
          label: mode === 'sale' ? 'Создать возврат' : 'Вернуться к продаже',
          icon: <WebIcon.goods size={22} color={tint} />,
          action: onToggleMode,
          key: '4',
        },
        {
          label: 'Закрыть смену',
          icon: <WebIcon.lockClosed size={22} color="#D32F2F" />,
          action: finish,
          key: '5',
          tone: 'danger',
        },
      ]
    : [
        {
          label: 'Открыть смену',
          icon: <WebIcon.lockOpen size={22} color={tint} />,
          action: onOpenShift,
        },
      ];

  const rest: Item[] = [
    ...(shift
      ? [
          {
            label: 'Журнал чеков',
            icon: <Icon.journal size={22} color={tint} />,
            view: 'receipts' as const,
          },
        ]
      : []),
    { label: 'Смены', icon: <WebIcon.calendar size={22} color={tint} />, view: 'shifts', key: '2' },
    { label: 'Настройки', icon: <WebIcon.gear size={22} color={tint} />, view: 'settings', key: '1' },
  ];

  const groups = [exit, shiftItems, rest];

  const go = (item: Item) => {
    if (item.action) {
      // Меню закрывается до действия, а не после: открытие и закрытие смены
      // показывают своё окно, и меню осталось бы висеть поверх него.
      onClose();
      item.action();
      return;
    }

    // Разделы кассы открываются внутри кассы: касса — рабочее место, из неё
    // не выходят затем, чтобы посмотреть чек.
    if (item.view) {
      onClose();
      onOpenView(item.view);
      return;
    }

    if (!item.href) return;
    const { href } = item;
    onClose();
    setTimeout(() => {
      if (router.canGoBack()) router.back();
      setTimeout(() => router.navigate(href), 0);
    }, 0);
  };

  // Цифра открывает раздел, пока меню на экране — как у него. Esc закрывает.
  useEffect(() => {
    if (!visible) return;

    const all = groups.flat();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      const item = all.find((entry) => entry.key === event.key);
      if (item) {
        event.preventDefault();
        go(item);
      }
    };

    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Затемнение лежит отдельным слоем под панелью, а не оборачивает её:
          вложенная кнопка в вебе перехватывает нажатия у того, что внутри. */}
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть меню"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          {/* Наверху — кто работает и в какой роли. У него это первая строка
              списка, а не заголовок: за одной кассой стоят по очереди, и
              видеть, под кем открыта смена, важнее названия меню. */}
          <View style={styles.who}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>W</Text>
            </View>
            <View style={styles.whoText}>
              <Text style={styles.whoName}>waystea</Text>
              <Text style={styles.whoRole}>Владелец</Text>
            </View>
          </View>

          <ScrollView>
            {groups.map((items, index) => (
              <View key={index}>
                <Divider />
                <Group items={items} onPick={go} />
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Group({ items, onPick }: { items: Item[]; onPick: (item: Item) => void }) {
  return (
    <View>
      {items.map((item) => (
        <Pressable
          key={item.label}
          accessibilityRole="button"
          onPress={() => onPick(item)}
          style={(state) => [
            styles.item,
            (state as { hovered?: boolean }).hovered && styles.itemHover,
          ]}
        >
          <View style={styles.itemIcon}>{item.icon}</View>
          <Text style={[styles.itemLabel, item.tone === 'danger' && styles.danger]}>
            {item.label}
          </Text>
          {item.key ? <Text style={styles.itemKey}>{item.key}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    // Панель выезжает от кнопки «Меню» — от левого нижнего угла.
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
  },
  // 240 — минимальная ширина его списка. Панель у него узкая: пунктов мало,
  // и растягивать её не на что.
  panel: {
    minWidth: 280,
    maxHeight: '92%',
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderTopRightRadius: 4,
    // Затемнение позиционировано абсолютно и потому рисуется поверх обычного
    // потока — без этого оно накрывало бы саму панель и съедало её нажатия.
    zIndex: 1,
  },
  who: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingBottom: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: pos.bar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: '#FFFFFF', fontSize: 18, fontFamily: pos.font },
  whoText: { flex: 1 },
  whoName: { fontSize: 16, fontWeight: '500', color: pos.text, fontFamily: pos.font },
  whoRole: { fontSize: 13, color: pos.muted, fontFamily: pos.font },
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, height: 48 },
  itemHover: { backgroundColor: pos.bg },
  itemIcon: { width: 26, alignItems: 'center' },
  itemLabel: { flex: 1, fontSize: 16, color: pos.text, fontFamily: pos.font },
  danger: { color: '#D32F2F' },
  itemKey: { fontSize: 13, color: pos.muted, fontFamily: pos.font },
  divider: { height: 1, backgroundColor: pos.border, marginVertical: 6 },
});
