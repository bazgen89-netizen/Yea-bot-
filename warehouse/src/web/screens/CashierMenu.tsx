import { useRouter, type Href } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { getSettings } from '../../db/settings';
import { openShiftAnywhere } from '../../db/shifts';
import { currentStaff } from '../../db/staff';
import { ROLE_LABEL } from '../../domain/permissions';
import { useCashierKeys } from './useCashierKeys';
import type { CashierView } from './CashierViews';
import { useQuery } from '../../state/DatabaseProvider';
import { startsInCashier } from '../openCashier';
import { WebIcon } from '../../ui/icons';
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
 *
 * «Возврат долга» стоит в меню, пока открыта смена.
 */

/** Высота нижней полосы кассы: меню встаёт ровно над ней. */
const BOTTOM_BAR = 58;

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
  onCloseShift,
  who,
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
  /**
   * Начать закрытие смены.
   *
   * Само закрытие живёт на кассе, а не здесь: оно спрашивает дважды —
   * «действительно?» нижним листом и пересчёт ящика окном, — а меню к этому
   * моменту уже закрыто, и показать что-либо из-под него оно не может.
   */
  onCloseShift: () => void;
  /** Чем подписана касса внизу — «Чайный бар». Им же подписан и вход. */
  who: string;
}) {
  const router = useRouter();

  const shift = useQuery((database) => openShiftAnywhere(database));
  // Кто за прилавком.
  const staff = useQuery((database) => currentStaff(database));
  // Пока сотрудника не выбрали, за кассой стоит владелец — тот, чья это
  // программа. У него в меню так и подписано: имя учётной записи и
  // «Владелец», а не название точки и «Кассир».
  const company = useQuery((database) => getSettings(database).name);
  const name = staff?.name ?? company ?? who;
  const role = staff ? ROLE_LABEL[staff.role] : 'Владелец';

  const tint = pos.text;

  // Первым идёт выход — так же, как у него: это единственный пункт, который
  // уводит из кассы, и он стоит отдельно от всего остального.
  const exit: Item[] = [
    {
      // У него это «Выйти» — выход из кассирского приложения. Входа у нас
      // нет, и единственное, куда отсюда выходят, — кабинет.
      label: 'Выйти',
      icon: <WebIcon.logout size={24} color={tint} />,
      // Касса, открытая своим окном, выходом это окно и закрывает: кабинет
      // никуда не девался, он в соседнем. А если касса открыта в том же
      // окне — просто уходим в кабинет.
      ...(startsInCashier()
        ? { action: () => globalThis.close?.() }
        : { href: '/' as const }),
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
          icon: <WebIcon.loop size={24} color={tint} />,
          action: onToggleMode,
          key: '4',
        },
        {
          label: 'Закрыть смену',
          icon: <WebIcon.closeCircle size={24} color="#D32F2F" />,
          action: onCloseShift,
          key: '5',
          tone: 'danger',
        },
      ]
    : [
        {
          label: 'Открыть смену',
          icon: <WebIcon.lockOpen size={24} color={tint} />,
          action: onOpenShift,
        },
      ];

  const rest: Item[] = [
    // «Возврат долга» стоит в меню всё время, пока открыта смена: пункт,
    // который то появляется, то исчезает, ищут глазами каждый раз заново.
    // Долгов нет — раздел так и скажет.
    ...(shift
      ? [
          {
            label: 'Возврат долга',
            icon: <WebIcon.handshake size={24} color={tint} />,
            view: 'debts' as const,
            key: '3',
          },
        ]
      : []),
    ...(shift
      ? [
          {
            label: 'Журнал чеков',
            icon: <WebIcon.receiptLong size={24} color={tint} />,
            view: 'receipts' as const,
          },
        ]
      : []),
    { label: 'Смены', icon: <WebIcon.calendar size={24} color={tint} />, view: 'shifts', key: '2' },
    { label: 'Настройки', icon: <WebIcon.gear size={24} color={tint} />, view: 'settings', key: '1' },
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

  /**
   * Цифры справа от пунктов показываются, только пока держат Shift.
   *
   * У него так же. Меню от этого читается как список слов, а не как список
   * слов с номерами: цифры нужны тому, кто их уже знает, и он их спросит сам.
   */
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    if (!visible) {
      setShowKeys(false);
      return;
    }

    const down = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShowKeys(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShowKeys(false);
    };

    globalThis.addEventListener?.('keydown', down, true);
    globalThis.addEventListener?.('keyup', up, true);
    return () => {
      globalThis.removeEventListener?.('keydown', down, true);
      globalThis.removeEventListener?.('keyup', up, true);
    };
  }, [visible]);

  // Цифра открывает раздел, пока меню на экране — как у него. Esc закрывает.
  useCashierKeys(visible, (event) => {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    const item = groups.flat().find((entry) => entry.key === event.key);
    if (item) {
      event.preventDefault();
      go(item);
    }
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
              <Text style={styles.avatarLetter}>{name.trim().slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.whoText}>
              <Text style={styles.whoName}>{name}</Text>
              <Text style={styles.whoRole}>{role}</Text>
            </View>
          </View>

          <ScrollView>
            {groups.map((items, index) => (
              <View key={index}>
                <Divider />
                <Group items={items} onPick={go} showKeys={showKeys} />
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Group({
  items,
  onPick,
  showKeys,
}: {
  items: Item[];
  onPick: (item: Item) => void;
  showKeys: boolean;
}) {
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
          {item.key ? (
            <Text style={[styles.itemKey, !showKeys && styles.itemKeyHidden]}>{item.key}</Text>
          ) : null}
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
    // Панель выезжает от кнопки «Меню» — от левого нижнего угла, но саму
    // кнопку не накрывает: у него меню встаёт над нижней полосой, и видно,
    // откуда оно вышло.
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    paddingBottom: BOTTOM_BAR,
  },
  // 240 — минимальная ширина его списка. Панель у него узкая: пунктов мало,
  // и растягивать её не на что.
  panel: {
    // 240 — их наименьшая ширина, но на снимке меню выше и чуть шире: по нему
    // попадают пальцем, а не мышью, и мелкий список для этого не годится.
    // Поэтому строка высокая, подпись крупная, а ширина — ровно под самую
    // длинную подпись («Информация о программе») и не больше: широкая панель
    // закрывает витрину, и по снимку она заметно уже прежних 340.
    minWidth: 296,
    maxHeight: '92%',
    paddingVertical: 8,
    backgroundColor: pos.tile,
    borderTopRightRadius: 4,
    // Затемнение позиционировано абсолютно и потому рисуется поверх обычного
    // потока — без этого оно накрывало бы саму панель и съедало её нажатия.
    zIndex: 1,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: pos.bar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: '#FFFFFF', fontSize: 18, fontFamily: pos.font },
  whoText: { flex: 1 },
  whoName: { fontFamily: pos.font, fontSize: 18, lineHeight: 27, color: pos.text },
  whoRole: { fontFamily: pos.font, fontSize: 15, lineHeight: 24, color: pos.muted },
  // Мерки — их же, из Material: строка не ниже 48 при отступах 8 и 16,
  // столбец значка 56, сам значок 24, подпись 16.
  // Высота строки — доля от ширины панели, снятая с его снимка: 0,184.
  // При наших 296 это 55, а не 62, которые стояли раньше на глаз.
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 55,
  },
  itemHover: { backgroundColor: pos.bg },
  itemIcon: { width: 46, alignItems: 'flex-start' },
  itemLabel: { flex: 1, fontFamily: pos.font, fontSize: 16, lineHeight: 24, color: pos.text },
  danger: { color: '#D32F2F' },
  itemKey: { fontFamily: pos.font, fontSize: 14, color: pos.muted },
  // Прозрачная, а не убранная: иначе подписи прыгали бы вбок под Shift.
  itemKeyHidden: { opacity: 0 },
  divider: { height: 1, backgroundColor: pos.border },
});
