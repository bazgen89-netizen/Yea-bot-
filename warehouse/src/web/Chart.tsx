import { useState } from 'react';
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Translated';

import { scaleFor, smooth, spaced, подРукой } from '../domain/chart';
import { formatMoneyWeb } from '../domain/money';
import { web, WEB_FONT } from '../ui/webTheme';

/**
 * График выручки по дням — сглаженной линией с заливкой, как у него.
 *
 * До этого он рисовался столбиками: линию в `react-native-web` пришлось бы
 * рисовать через SVG, а тянуть ради этого библиотеку не хотелось. Но он
 * прислал снимок своего графика, и дело не в красоте: по его графику **водят
 * мышью** и смотрят, сколько наторговали в конкретный день. Столбики этого
 * не умеют.
 *
 * SVG здесь не из библиотеки, а прямой: экраны кабинета рисует react-dom, и
 * `<svg>` в нём — обычный тег. На телефоне такого тега нет, поэтому там
 * остаются столбики: платформа проверяется явно.
 */
export function Chart({
  points,
  days,
  высокий = false,
}: {
  points: number[];
  days: number;
  /** Новый кабинет: график во всю карточку, а не полоской. */
  высокий?: boolean;
}) {
  const values = Array.from({ length: days }, (_, i) => points[i] ?? 0);
  const высота = высокий ? PLOT_HEIGHT_BIG : PLOT_HEIGHT;
  const новыйВид = высокий;

  // Ось размечается круглыми числами: у него это 0, 10 000, 20 000 … 60 000
  // при вершине 46 501. Просто поделить вершину на пять — значит подписать
  // ось числами вида «9 300», а таких на его графике нет.
  const { top: peak, ticks } = scaleFor(Math.max(...values, 1));
  const labelStep = stepFor(days);

  const [width, setWidth] = useState(0);
  /** День под курсором. Кликнутый остаётся, пока не кликнут другой. */
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const active = hover ?? pinned;

  /*
   * Высота курсора внутри графика.
   *
   * Живёт здесь, а не в самой кривой, потому что плашка-линейка у него висит
   * не на графике, а слева на оси — поверх её подписей. Кривая только
   * сообщает, где сейчас мышь.
   */
  const [курсорY, задатьКурсорY] = useState<number | null>(null);

  const measure = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  return (
    <View style={[styles.chart, { height: высота + 26 }]}>
      <View style={styles.axis}>
        {ticks.map((tick, index) => (
          <Text key={index} style={styles.tick}>
            {formatMoneyWeb(tick).replace('.00', '')}
          </Text>
        ))}

        {курсорY !== null ? (
          <View style={[styles.линейка, { top: курсорY - 11 }]}>
            <Text style={styles.линейкаЧисло}>{подРукой(peak, курсорY, высота)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.plot}>
        <View style={[styles.area, { height: высота }]} onLayout={measure}>
          {Platform.OS === 'web' && width > 0 ? (
            <Curve
              values={values}
              peak={peak}
              width={width}
              height={высота}
              active={active}
              lines={ticks.length}
              прежний={!высокий}
              курсорY={курсорY}
              onHover={setHover}
              onCursor={задатьКурсорY}
              onPick={(index) => setPinned((was) => (was === index ? null : index))}
            />
          ) : (
            <Bars values={values} peak={peak} ticks={ticks.length} />
          )}
        </View>

        {/* Числа под графиком нажимаются: нажал день — на графике встала
            его выручка, как по самой линии. Раньше они были синими и
            молчали, а синее, что не нажимается, обещает переход, которого
            нет. Синим отмечена каждая седьмая метка — это его разметка
            недель, а не ссылки. */}
        <View style={styles.days}>
          {values.map((_, index) => (
            <Pressable
              key={index}
              accessibilityRole="button"
              accessibilityLabel={`День ${index + 1}`}
              style={styles.dayCell}
              onPress={() => setPinned((was) => (was === index ? null : index))}
            >
              <Text
                style={[
                  styles.day,
                  // Синие числа по неделям — разметка прежнего кабинета.
                  // В новом все подписи одного цвета: у него на записи
                  // 2-е, 3-е и 29-е одинаково светлые.
                  !новыйВид && isMarked(index + 1) && styles.dayMarked,
                  // Число дня под курсором он подсвечивает плашкой — той же,
                  // что и линейка слева. Пустые подписи не трогаем: плашка
                  // без числа выглядела бы обрубком.
                  active === index && index % labelStep === 0 && styles.dayActive,
                ]}
              >
                {index % labelStep === 0 ? index + 1 : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * Размеры всплывающей карточки.
 *
 * Замерено на его записи экрана: белая карточка 150×66 — сверху число дня,
 * ниже «● Выручка» и сумма у правого края.
 */
const ПОДСКАЗКА_Ш = 150;
const ПОДСКАЗКА_В = 66;

const PLOT_HEIGHT = 254;
/**
 * В новом кабинете график заметно выше.
 *
 * Замерено у них: карточка «Показатели» 1258×658, из них заголовок 29 и ряд
 * карточек показателей — остальное отдано графику. У нас он был вдвое ниже,
 * и Вазген справедливо сказал, что «графа не такая».
 */
const PLOT_HEIGHT_BIG = 460;

/** Сглаженная линия с заливкой и подписью под курсором. */
function Curve({
  values,
  peak,
  width,
  height,
  active,
  lines,
  прежний,
  курсорY,
  onHover,
  onCursor,
  onPick,
}: {
  values: number[];
  peak: number;
  width: number;
  height: number;
  active: number | null;
  /** Сколько горизонтальных линий — столько же, сколько подписей на оси. */
  lines: number;
  /**
   * Прежний кабинет.
   *
   * От этого зависит не палитра, а сама разметка: в прежнем под кривой полная
   * сетка и на каждом дне кружок, в новом — только поперечные линии и чистая
   * кривая. Проверено по записи экрана, которую прислал Вазген.
   */
  прежний: boolean;
  /** Где мышь по высоте — за ней тянется пунктир-линейка. */
  курсорY: number | null;
  onHover: (index: number | null) => void;
  onCursor: (y: number | null) => void;
  onPick: (index: number) => void;
}) {
  // Отступы, чтобы кружок крайнего дня не срезался краем картинки.
  const pad = 6;
  const inner = Math.max(1, width - pad * 2);
  const step = values.length > 1 ? inner / (values.length - 1) : 0;

  const x = (index: number) => pad + index * step;
  const y = (value: number) => height - (value / peak) * height;

  const line = smooth(values.map((value, index) => [x(index), y(value)]));
  const fill = `${line} L ${x(values.length - 1)} ${height} L ${x(0)} ${height} Z`;

  /** Ближайший день к точке, куда попала мышь. */
  const dayAt = (offsetX: number) =>
    Math.max(0, Math.min(values.length - 1, Math.round((offsetX - pad) / (step || 1))));

  return (
    <svg
      width={width}
      height={height}
      style={{ display: 'block', cursor: 'pointer' }}
      onMouseMove={(event: { nativeEvent: { offsetX: number; offsetY: number } }) => {
        onHover(dayAt(event.nativeEvent.offsetX));
        onCursor(event.nativeEvent.offsetY);
      }}
      onMouseLeave={() => {
        onHover(null);
        onCursor(null);
      }}
      onClick={(event: { nativeEvent: { offsetX: number } }) =>
        onPick(dayAt(event.nativeEvent.offsetX))
      }
    >
      {Array.from({ length: lines }, (_, index) => (
        <line
          key={`h${index}`}
          x1={0}
          x2={width}
          y1={(height / (lines - 1)) * index}
          y2={(height / (lines - 1)) * index}
          stroke={web.chartWeb}
        />
      ))}

      {/* Поперечин вдоль дней в новом кабинете нет вовсе — проверено по
          записи Вазгена: полоса в 1100 точек поперёк графика сплошь цвета
          карточки, кроме единственной точки пунктира под курсором. В прежнем
          кабинете сетка полная, там они остаются. */}
      {прежний
        ? values.map((_, index) =>
            index % 5 === 0 ? (
              <line
                key={`v${index}`}
                x1={x(index)}
                x2={x(index)}
                y1={0}
                y2={height}
                stroke={web.chartWeb}
              />
            ) : null,
          )
        : null}

      <path d={fill} fill={web.chartFill} />
      <path d={line} fill="none" stroke={web.chartLine} strokeWidth={2} />

      {/* Кружки на каждом дне — примета прежнего кабинета. В новом кривая
          чистая: на плоском участке его записи ровно три цвета в строку —
          фон, линия и заливка, никаких утолщений. */}
      {прежний
        ? values.map((value, index) => (
            <circle key={index} cx={x(index)} cy={y(value)} r={2.5} fill={web.chartLine} />
          ))
        : null}

      {/* Линейка за курсором: пунктир во всю ширину на его высоте. Число к
          ней рисует ось — плашка у него висит слева, поверх подписей. */}
      {курсорY !== null ? (
        <line
          x1={0}
          x2={width}
          y1={курсорY}
          y2={курсорY}
          stroke={web.chartAxis}
          strokeDasharray="4 4"
        />
      ) : null}

      {active !== null ? (
        <g>
          {/* Пунктир на дне — во всю высоту, а не от точки вниз: так у них. */}
          <line
            x1={x(active)}
            x2={x(active)}
            y1={0}
            y2={height}
            stroke={web.chartAxis}
            strokeDasharray="4 4"
          />
          <circle
            cx={x(active)}
            cy={y(values[active])}
            r={4}
            fill="#FFFFFF"
            stroke={web.chartLine}
            strokeWidth={2}
          />
          {/* Карточка со значением. У них она светлая и в тёмном виде тоже. */}
          <g
            transform={`translate(${
              active > values.length - 7 ? x(active) - ПОДСКАЗКА_Ш - 14 : x(active) + 14
            }, ${Math.min(Math.max(y(values[active]) - 8, 0), height - ПОДСКАЗКА_В)})`}
          >
            <rect
              width={ПОДСКАЗКА_Ш}
              height={ПОДСКАЗКА_В}
              rx={4}
              fill="#FFFFFF"
              stroke="rgba(15,23,42,0.12)"
            />
            <text x={14} y={26} fontSize={15} fill="#0F172A" fontFamily={WEB_FONT}>
              {active + 1}
            </text>
            <circle cx={19} cy={48} r={4} fill={web.chartLine} />
            <text x={30} y={52} fontSize={13} fill="#0F172A" fontFamily={WEB_FONT}>
              Выручка
            </text>
            <text
              x={ПОДСКАЗКА_Ш - 14}
              y={52}
              textAnchor="end"
              fontSize={13}
              fontWeight={600}
              fill="#0F172A"
              fontFamily={WEB_FONT}
            >
              {spaced(values[active])}
            </text>
          </g>
        </g>
      ) : null}
    </svg>
  );
}

/** Запасной вид для телефона: там `<svg>` рисовать нечем. */
function Bars({ values, peak, ticks }: { values: number[]; peak: number; ticks: number }) {
  return (
    <>
      <View style={styles.grid}>
        {Array.from({ length: ticks }, (_, index) => (
          <View key={index} style={styles.gridLine} />
        ))}
      </View>

      <View style={styles.bars}>
        {values.map((value, index) => (
          <View key={index} style={styles.barSlot}>
            <View style={[styles.bar, { height: `${(value / peak) * 100}%` }]} />
          </View>
        ))}
      </View>
    </>
  );
}

/**
 * Через сколько столбцов подписывать ось.
 *
 * За месяц подписан каждый день — как в оригинале. За квартал и год подписи
 * встали бы друг на друга и превратились в серую кашу, поэтому прореживаются
 * до тех же примерно тридцати отметок.
 */
function stepFor(days: number): number {
  return Math.max(1, Math.ceil(days / 31));
}

/** Числа 2, 9, 16, 23, 30 выделены — по ним в исходном приложении идёт неделя. */
function isMarked(day: number): boolean {
  return day % 7 === 2;
}

const styles = StyleSheet.create({
  /*
   * Высота задаётся при отрисовке: в новом кабинете график вдвое выше.
   * Здесь остаётся прежнее значение — оно же и запасное, если высоту не
   * передали. Двадцать шесть точек снизу — под ось дней.
   */
  chart: { flexDirection: 'row', height: PLOT_HEIGHT + 26, gap: 10 },
  axis: { width: 58, justifyContent: 'space-between', paddingBottom: 26 },
  /**
   * Подписи оси — их же: `.dashboard #dashboard-chart .axis text
   * { font-size: 12px; fill: #B0B0B0; font-weight: 300 }`, а у оси дней
   * `.axis.x text { font-size: 10px }`. У меня стояло 12 и 11 обычным
   * начертанием, и ось выходила темнее и тяжелее его.
   */
  tick: {
    fontFamily: WEB_FONT,
    fontSize: 12,
    color: web.chartLabel,
    fontWeight: '300' as const,
    textAlign: 'right',
  },
  plot: { flex: 1 },
  area: { height: PLOT_HEIGHT },
  grid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
  },
  gridLine: { height: 1, backgroundColor: web.chartGrid },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  // Ограничение ширины нужно для периода «сегодня»: один столбец на всю
  // ширину графика выглядел бы залитой плашкой, а не данными.
  barSlot: { flex: 1, maxWidth: 60, height: '100%', justifyContent: 'flex-end' },
  bar: { backgroundColor: web.chartFill, borderTopWidth: 2, borderTopColor: web.chartLine, minHeight: 1 },
  days: { flexDirection: 'row', gap: 2, height: 26, alignItems: 'center' },
  dayCell: { flex: 1, alignItems: 'center' },
  day: {
    fontFamily: WEB_FONT,
    fontSize: 10,
    color: web.chartLabel,
    fontWeight: '300' as const,
    textAlign: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  dayMarked: { color: web.link },
  /* Число дня под курсором — белым по плашке, как у него на записи. */
  dayActive: { color: '#FFFFFF', backgroundColor: web.chartRuler, fontWeight: '400' as const },

  /**
   * Плашка-линейка слева: число на той высоте, где стоит мышь.
   *
   * Лежит поверх подписей оси и закрывает их собой — у него так же: пока
   * линейка над «30,000», самой подписи не видно.
   */
  линейка: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 22,
    borderRadius: 3,
    backgroundColor: web.chartRuler,
    alignItems: 'center',
    justifyContent: 'center',
  },
  линейкаЧисло: { fontFamily: WEB_FONT, fontSize: 11, color: '#FFFFFF' },
});
