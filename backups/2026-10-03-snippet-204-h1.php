/**
 * Waystea: название товара — заголовком H1, а не H2.
 *
 * Карточка товара собрана в Elementor, название выводит виджет ShopEngine
 * `shopengine-product-title`, и он печатает `<h2 class="product-title">`.
 * Из-за этого на всех 374 карточках **не было ни одного H1**: проверено
 * разбором живых страниц — венчик, колба, Да Хун Пао, у всех `H1: 0`,
 * а первым заголовком шёл H2 с названием. У каталога и главной H1 на месте,
 * то есть дело именно в этом виджете.
 *
 * Правка точечная: фильтр срабатывает только на выводе этого виджета
 * и меняет первое вхождение открывающего и закрывающего тега. Остальная
 * разметка, классы и стили не трогаются — `.product-title` остаётся.
 *
 * Откат: выключить сниппет.
 */
add_filter(
	'elementor/widget/render_content',
	function ( $content, $widget ) {
		if ( ! is_object( $widget ) || ! method_exists( $widget, 'get_name' ) ) {
			return $content;
		}
		if ( 'shopengine-product-title' !== $widget->get_name() ) {
			return $content;
		}
		if ( ! function_exists( 'is_product' ) || ! is_product() ) {
			return $content;   // на архивах и в подборках заголовок первого уровня не нужен
		}
		if ( false !== stripos( $content, '<h1' ) ) {
			return $content;   // уже исправлено или виджет настроен вручную
		}
		$pos = stripos( $content, '<h2' );
		if ( false === $pos ) {
			return $content;
		}
		$content = substr_replace( $content, '<h1', $pos, 3 );
		$end     = stripos( $content, '</h2>', $pos );
		if ( false !== $end ) {
			$content = substr_replace( $content, '</h1>', $end, 5 );
		}
		return $content;
	},
	10,
	2
);

/**
 * В описаниях части товаров автор текста поставил свой `<h1>`.
 * Пока название было H2, это проходило незаметно; после правки выше
 * на таких карточках стало **два H1** — проверено на живых страницах
 * (Шай Цин Мао Ча, Пуэр Ши Нянь Чунь, Пуэр Шэн Блин Мэнку).
 *
 * Заголовок первого уровня на странице должен быть один — названием
 * товара. Поэтому H1 внутри описания понижается до H2. Текст, классы
 * и атрибуты сохраняются.
 */
function waystea_demote_h1( $html ) {
	if ( ! function_exists( 'is_product' ) || ! is_product() || ! is_string( $html ) ) {
		return $html;
	}
	if ( false === stripos( $html, '<h1' ) ) {
		return $html;
	}
	$html = preg_replace( '/<h1(\s|>)/i', '<h2$1', $html );
	return preg_replace( '/<\/h1>/i', '</h2>', $html );
}
add_filter( 'the_content', 'waystea_demote_h1', 99 );
add_filter( 'woocommerce_short_description', 'waystea_demote_h1', 99 );
