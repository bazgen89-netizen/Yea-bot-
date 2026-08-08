import { Section } from '../src/web/screens/Section';

export default function CashierScreen() {
  return (
    <Section
      title={'Интерфейс кассира'}
      note={
        'Плитки товаров с остатком и ценой, поиск по названию, артикулу и штрихкоду, ' +
        'чек справа, выбор покупателя и оплата. Открытая смена и магазин — внизу экрана.'
      }
    />
  );
}
