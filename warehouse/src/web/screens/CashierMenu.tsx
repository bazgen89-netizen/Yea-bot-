import { useRouter, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  closeShift,
  listRegisters,
  openShift,
  openShiftAnywhere,
  shiftReport,
} from '../../db/shifts';
import { formatMoneyWeb } from '../../domain/money';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { Icon, WebIcon } from '../../ui/icons';
import { pos } from '../../ui/webTheme';

/**
 * Меню кассира — панель, которую открывает кнопка слева внизу.
 *
 * Состав разделов взят из самого кассирского приложения: у него свои экраны
 * (продажа, возврат, история, клиенты, долги, смена, товары, проверка
 * документа, события, оборудование, настройки, выход), и это то, куда из
 * этого меню можно попасть.
 *
 * Разделы, которых у нас пока нет отдельным экраном, ведут туда, где то же
 * самое уже есть: история чеков — в движение товара, клиенты — в справочник.
 * Пункт, ведущий в никуда, читался бы как поломка.
 */

interface Item {
  label: string;
  icon: ReactNode;
  /** Куда вести. Пункты со своим действием обходятся без адреса. */
  href?: Href;
  hint?: string;
  /** Собственное действие: открыть смену, снять X-отчёт. */
  action?: () => void;
  tone?: 'danger';
}

export function CashierMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const { db, refresh } = useDatabase();

  const shift = useQuery((database) => openShiftAnywhere(database));
  const registers = useQuery((database) => listRegisters(database));
  const report = useQuery(
    (database) => (shift ? shiftReport(database, shift.id) : null),
    [shift?.id],
  );

  function start() {
    const free = registers.find((register) => register.open_shift_id === null);
    if (!free) {
      say('Нет свободной кассы', 'Смена уже открыта.');
      return;
    }
    openShift(db, { registerId: free.id, cashier: 'waystea' });
    refresh();
    say('Смена открыта', `${free.name}. Чеки будут копиться в ней, пока её не закроют.`);
  }

  function xReport() {
    if (!report) return;
    say(
      `X-отчёт по смене №${report.shift.id}`,
      [
        `Касса: ${report.register_name}`,
        `Чеков: ${report.receipts}`,
        `Выручка: ${formatMoneyWeb(report.revenue)}`,
        `Наличными: ${formatMoneyWeb(report.cash)}`,
        `Картой: ${formatMoneyWeb(report.card)}`,
        `Должно быть в кассе: ${formatMoneyWeb(report.expectedCash)}`,
      ].join('\n'),
    );
  }

  function finish() {
    if (!report) return;

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

    confirm(
      'Закрыть смену?',
      'После закрытия чеки пойдут в следующую смену. Отменить нельзя.',
      'Закрыть',
      () => {
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

  const sale: Item[] = [
    {
      label: 'Продажа',
      icon: <WebIcon.home size={22} color={tint} />,
      action: onClose,
      hint: 'текущий чек',
    },
    {
      label: 'Возврат продажи',
      icon: <WebIcon.goods size={22} color={tint} />,
      href: '/journal',
      hint: 'выберите чек',
    },
    { label: 'История чеков', icon: <Icon.journal size={22} color={tint} />, href: '/journal' },
    {
      label: 'Клиенты',
      icon: <WebIcon.parties size={22} color={tint} />,
      href: { pathname: '/counterparties', params: { kind: 'customer' } },
    },
    { label: 'Долги', icon: <WebIcon.money size={22} color={tint} />, href: '/money' },
  ];

  const shiftItems: Item[] = shift
    ? [
        {
          label: 'X-отчёт',
          icon: <WebIcon.reports size={22} color={tint} />,
          action: xReport,
          hint: 'без закрытия смены',
        },
        {
          label: 'Закрыть смену',
          icon: <WebIcon.lockClosed size={22} color={tint} />,
          action: finish,
          hint: `смена №${shift.id}`,
        },
      ]
    : [
        {
          label: 'Открыть смену',
          icon: <WebIcon.lockOpen size={22} color={tint} />,
          action: start,
          hint: 'сейчас закрыта',
        },
      ];

  const rest: Item[] = [
    { label: 'Смены и кассы', icon: <WebIcon.registers size={22} color={tint} />, href: '/shifts' },
    { label: 'Товары', icon: <WebIcon.products size={22} color={tint} />, href: '/catalog' },
    { label: 'Внесение и изъятие', icon: <WebIcon.money size={22} color={tint} />, href: '/money' },
    { label: 'Проверка документа', icon: <WebIcon.done size={22} color={tint} />, href: '/journal' },
    { label: 'События', icon: <WebIcon.whatsNew size={22} color={tint} />, href: '/journal' },
    { label: 'Оборудование', icon: <WebIcon.barcode size={22} color={tint} />, href: '/company' },
    { label: 'Настройки', icon: <WebIcon.gear size={22} color={tint} />, href: '/company' },
  ];

  // Выход закреплён внизу панели, а не стоит последним в списке: список
  // прокручивается, и единственный способ уйти из кассы не должен требовать
  // сначала до него доскроллить.
  const exit: Item = {
    label: 'Выйти в кабинет',
    icon: <WebIcon.chevronLeft size={22} color={tint} />,
    href: '/',
    tone: 'danger',
  };

  const go = (item: Item) => {
    if (item.action) {
      item.action();
      return;
    }
    if (!item.href) return;

    const { href } = item;
    onClose();

    // Касса лежит поверх группы вкладок, и переход в раздел этой группы
    // прямо отсюда открывал её заново — то есть с начального экрана,
    // с Главной. Поэтому сначала снимаем кассу, а раздел выбираем уже
    // изнутри группы, как это делает боковое меню кабинета.
    //
    // Заодно уходит вторая беда: без этого каждый заход в кассу и обратно
    // добавлял в стек ещё один экран, и «назад» приходилось жать по разу
    // на каждый заход.
    setTimeout(() => {
      if (router.canGoBack()) router.back();
      setTimeout(() => router.navigate(href), 0);
    }, 0);
  };

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
          <View style={styles.head}>
            <Icon.menu size={24} color="#FFFFFF" />
            <Text style={styles.headTitle}>Меню</Text>
          </View>

          <ScrollView>
            <Group items={sale} onPick={go} />
            <Divider />
            <Group items={shiftItems} onPick={go} />
            <Divider />
            <Group items={rest} onPick={go} />
          </ScrollView>

          <View style={styles.footer}>
            <Group items={[exit]} onPick={go} />
          </View>
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
          <View style={styles.itemText}>
            <Text style={[styles.itemLabel, item.tone === 'danger' && { color: '#D32F2F' }]}>
              {item.label}
            </Text>
            {item.hint ? <Text style={styles.itemHint}>{item.hint}</Text> : null}
          </View>
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
  panel: {
    width: 380,
    maxHeight: '92%',
    backgroundColor: '#FFFFFF',
    borderTopRightRadius: 4,
    // Затемнение позиционировано абсолютно и потому рисуется поверх обычного
    // потока — без этого оно накрывало бы саму панель и съедало её нажатия.
    zIndex: 1,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    height: 64,
    paddingHorizontal: 20,
    backgroundColor: pos.bar,
  },
  headTitle: { color: '#FFFFFF', fontSize: 20, fontFamily: pos.font },
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, height: 56 },
  itemHover: { backgroundColor: pos.bg },
  itemIcon: { width: 26, alignItems: 'center' },
  itemText: { flex: 1 },
  itemLabel: { fontSize: 17, color: pos.text, fontFamily: pos.font },
  itemHint: { fontSize: 13, color: pos.muted },
  divider: { height: 1, backgroundColor: pos.border, marginVertical: 6 },
  footer: { borderTopWidth: 1, borderTopColor: pos.border },
});
