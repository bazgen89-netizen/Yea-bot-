<?php
/**
 * Шорткоды вместо чанков, которые вставлялись прямо в контент.
 *
 * Скрипты сторонних сервисов не хранятся в тексте страниц: WordPress
 * вырезает <script> у редакторов без прав unfiltered_html, и однажды
 * форма бронирования просто исчезнет после чужой правки. Поэтому
 * TravelLine, карта и подписка вынесены в шорткоды.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Идентификатор объекта в TravelLine — из чанка `head` старого сайта. */
const ECO_TL_CONTEXT  = 'TL-INT-ecopark33_2022-07-25';
const ECO_TL_SCENARIO = '46084';

/** [travelline] — форма бронирования (страница /booking/). */
add_shortcode( 'travelline', 'eco_sc_travelline' );
function eco_sc_travelline() {
	ob_start();
	?>
	<div id="tl-booking-form"></div>
	<script type="text/javascript">
		(function (w) {
			var q = [
				['setContext', '<?php echo esc_js( ECO_TL_CONTEXT ); ?>', 'ru'],
				['embed', 'booking-form', { container: 'tl-booking-form' }]
			];
			var t = w.travelline = (w.travelline || {}), ti = t.integration = (t.integration || {});
			ti.__cq = ti.__cq ? ti.__cq.concat(q) : q;
			if (!ti.__loader) {
				ti.__loader = true;
				var d = w.document, s = d.createElement('script');
				s.type = 'text/javascript'; s.async = true;
				s.src = 'https://ibe.tlintegration.com/integration/loader.js';
				(d.getElementsByTagName('head')[0] || d.getElementsByTagName('body')[0]).appendChild(s);
			}
		})(window);
	</script>
	<?php
	return ob_get_clean();
}

/**
 * [travelline_search] — форма подбора дат.
 *
 * Порт чанков `travelline` и `travelline2`: оба выводили именно форму
 * поиска, а не форму бронирования. Отличались только обёрткой, поэтому
 * здесь один шорткод с параметром.
 *
 * Сам виджет подключается один раз в template-parts/travelline-head.php —
 * тут нужен только контейнер с идентификатором tl-search-form.
 */
add_shortcode( 'travelline_search', 'eco_sc_travelline_search' );
function eco_sc_travelline_search( $atts ) {
	$atts = shortcode_atts( array( 'variant' => '1' ), $atts );

	$inner = '<div id="block-search">'
		. '<div id="tl-search-form" class="tl-container">'
		. '<noindex><a href="https://www.travelline.ru/products/tl-hotel/" rel="nofollow" target="_blank">TravelLine</a></noindex>'
		. '</div></div>';

	if ( '2' === $atts['variant'] ) {
		// Рамка была задана инлайном прямо в чанке — оставляем как было,
		// чтобы разметка совпадала с прежней до атрибута.
		return '<div class="halign"><div class="cont" style="border: solid 1px #ccc; border-radius: 10px;">'
			. $inner . '</div></div>';
	}
	return '<div class="trline"><div class="halign"><div class="cont">' . $inner . '</div></div></div>';
}

/** [booking_button]Забронировать[/booking_button] */
add_shortcode( 'booking_button', 'eco_sc_booking_button' );
function eco_sc_booking_button( $atts, $content = null ) {
	$atts = shortcode_atts( array( 'class' => 'btn brown' ), $atts );
	return sprintf(
		'<a class="%s" href="%s" data-tl-booking-open="true">%s</a>',
		esc_attr( $atts['class'] ),
		esc_attr( eco_booking_url() ),
		esc_html( $content ?: 'Забронировать' )
	);
}

/** [phone] и [email] — бывшие чанки $phone / $phonelink. */
add_shortcode( 'phone', function () {
	return sprintf(
		'<a class="ptel" href="tel:%s">%s</a>',
		esc_attr( eco_contact( 'phone_link' ) ),
		esc_html( eco_contact( 'phone' ) )
	);
} );

add_shortcode( 'email', function () {
	return sprintf(
		'<a class="padr" href="mailto:%1$s">%1$s</a>',
		esc_attr( eco_contact( 'email' ) )
	);
} );

/** [ymap] — блок с картой и контактами (бывший чанк map_and_footer). */
add_shortcode( 'ymap', function () {
	ob_start();
	get_template_part( 'template-parts/map' );
	return ob_get_clean();
} );

/** [services] — слайдер услуг (бывший чанк $services). */
add_shortcode( 'services', function () {
	ob_start();
	get_template_part( 'template-parts/section-services' );
	return ob_get_clean();
} );

/** [links] — блок из трёх плиток (бывший чанк $links). */
add_shortcode( 'links', function () {
	ob_start();
	get_template_part( 'template-parts/section-links' );
	return ob_get_clean();
} );

/**
 * [block slug="mesblock"] — вставляет блок из раздела «Блоки».
 * Заменяет вставку чанка [[$mesblock]] в тексте страницы.
 */
add_shortcode( 'block', 'eco_sc_block' );
function eco_sc_block( $atts ) {
	$atts = shortcode_atts( array( 'slug' => '' ), $atts );
	if ( ! $atts['slug'] ) {
		return '';
	}

	$block = get_page_by_path( $atts['slug'], OBJECT, 'eco_block' );
	if ( ! $block || 'publish' !== $block->post_status ) {
		return '';
	}

	// Вложенный [block] не раскрываем: так не получить бесконечную вложенность.
	static $depth = 0;
	if ( $depth > 0 ) {
		return '';
	}
	$depth++;
	// Без wp_kses_post: он вырезает комментарии вместе с обёрткой, обнажая
	// закомментированную вёрстку, и выбрасывает <style> из блоков.
	// Блоки правят только администраторы — уровень доверия тот же,
	// что и у содержимого страниц.
	$html = do_shortcode( $block->post_content );
	$depth--;
	return $html;
}

/** [events] — слайдер публикаций. Бывший getResources &parents=`5`. */
add_shortcode( 'events', function () {
	ob_start();
	get_template_part( 'template-parts/section-events' );
	return ob_get_clean();
} );

/** [calendar] — блок «Публикации» со слайдером. Бывший чанк `calendar`. */
add_shortcode( 'calendar', function () {
	ob_start();
	get_template_part( 'template-parts/section-calendar' );
	return ob_get_clean();
} );

/** [cottages] — список коттеджей. Бывший getResources &tpl=`nomera_anblock_2`. */
add_shortcode( 'cottages', function () {
	ob_start();
	get_template_part( 'template-parts/section-cottages' );
	return ob_get_clean();
} );

/** [main_event] — главное событие крупным блоком. Бывший чанк `events_mainpage`. */
add_shortcode( 'main_event', function () {
	ob_start();
	get_template_part( 'template-parts/section-main-event' );
	return ob_get_clean();
} );
