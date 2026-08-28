<?php
/**
 * Хелперы шаблонов — замена сниппетов MODX.
 *
 *   pdoMenu / pdoResources / getResources -> WP_Query и wp_nav_menu
 *   getImageList                          -> eco_rows()
 *   sldimgsize                            -> eco_image_size_attr()
 *   randomrooms                           -> eco_other_cottages()
 *   setpagerel / setpagerelog             -> eco_canonical_url()
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Канонический адрес текущей страницы (бывшие setpagerel/setpagerelog). */
function eco_canonical_url() {
	if ( is_front_page() ) {
		return home_url( '/' );
	}
	if ( is_singular() ) {
		return get_permalink();
	}
	return home_url( add_query_arg( array() ) );
}

add_action( 'wp_head', 'eco_canonical_tag', 2 );
function eco_canonical_tag() {
	printf( '<link rel="canonical" href="%s">' . "\n", esc_url( eco_canonical_url() ) );
}

/**
 * Размер картинки для PhotoSwipe в виде "1600x1200".
 * Сниппет sldimgsize читал файл с диска на каждый слайд; здесь берём
 * готовые метаданные вложения и лезем к файлу только если их нет.
 */
function eco_image_size_attr( $value ) {
	if ( is_numeric( $value ) ) {
		$meta = wp_get_attachment_metadata( (int) $value );
		if ( ! empty( $meta['width'] ) && ! empty( $meta['height'] ) ) {
			return $meta['width'] . 'x' . $meta['height'];
		}
		$value = wp_get_attachment_url( (int) $value );
	}
	if ( ! $value ) {
		return '';
	}
	$path = eco_local_path( $value );
	if ( $path && file_exists( $path ) ) {
		$size = @getimagesize( $path );
		if ( $size ) {
			return $size[0] . 'x' . $size[1];
		}
	}
	return '';
}

/** Абсолютный путь на диске для локального URL, иначе пустая строка. */
function eco_local_path( $url ) {
	$home = home_url();
	if ( str_starts_with( $url, $home ) ) {
		$url = substr( $url, strlen( $home ) );
	}
	if ( preg_match( '~^https?://~', $url ) ) {
		return '';
	}
	return ABSPATH . ltrim( $url, '/' );
}

/** Заголовочный блок страницы: варианты v1 и v2 из шаблонов MODX. */
function eco_the_page_header() {
	get_template_part( 'template-parts/page-header' );
}

/** Подвал: с картой или без — бывший TV all_footer_mode. */
function eco_the_footer_blocks() {
	if ( eco_flag( 'all_footer_mode' ) ) {
		get_template_part( 'template-parts/map' );
	}
}

/**
 * Услуги для слайдера на главной и на странице коттеджа.
 * Раньше: getResources &parents=`6` &limit=`6`.
 */
function eco_services( $limit = 6 ) {
	return get_posts( array(
		'post_type'      => 'service',
		'posts_per_page' => $limit,
		'post_status'    => 'publish',
		'orderby'        => 'date',
		'order'          => 'DESC',
	) );
}

/**
 * Другие коттеджи — бывший сниппет randomrooms:
 * три случайных коттеджа, кроме текущего.
 */
function eco_other_cottages( $limit = 3 ) {
	return get_posts( array(
		'post_type'      => 'cottage',
		'posts_per_page' => $limit,
		'post_status'    => 'publish',
		'post__not_in'   => array( get_the_ID() ),
		'orderby'        => 'rand',
	) );
}

/** Публикации для слайдера. */
function eco_events( $limit = 6 ) {
	return get_posts( array(
		'post_type'      => 'event',
		'posts_per_page' => $limit,
		'post_status'    => 'publish',
		'orderby'        => 'date',
		'order'          => 'DESC',
	) );
}

/** Публикация, отмеченная как главная (бывший TV ev_main). */
function eco_main_event() {
	$found = get_posts( array(
		'post_type'      => 'event',
		'posts_per_page' => 1,
		'post_status'    => 'publish',
		'meta_query'     => array(
			'relation' => 'OR',
			array( 'key' => 'ev_main', 'value' => '1' ),
			array( 'key' => 'ev_main', 'value' => 'en' ),
		),
		'orderby'        => 'date',
		'order'          => 'DESC',
	) );
	return $found ? $found[0] : null;
}

/**
 * Ссылка на страницу по её адресу от корня — замена MODX-тега [[~id]].
 * Пример: eco_url('russkaya-banya/') для [[~4]].
 */
function eco_url( $uri = '' ) {
	return home_url( '/' . ltrim( $uri, '/' ) );
}

/** Ссылка на страницу, найденную по прежнему id в MODX. */
function eco_url_by_modx_id( $modx_id, $fallback = '' ) {
	$post_id = eco_find_by_modx_id( $modx_id );
	return $post_id ? get_permalink( $post_id ) : eco_url( $fallback );
}

/** Ссылка «Забронировать» — открывает виджет TravelLine. */
function eco_booking_url() {
	return '?tl-booking-open=true&tl-booking-scenario=46084';
}

/**
 * Заголовок H1. В MODX было два поля: pagetitle (в <title> и карточках)
 * и longtitle (в H1). Здесь pagetitle — это post_title, а longtitle
 * хранится отдельно и используется, только если заполнен.
 */
function eco_long_title( $post_id = null ) {
	$post_id = $post_id ?: get_the_ID();
	$long    = get_post_meta( $post_id, '_eco_longtitle', true );
	return $long ?: get_the_title( $post_id );
}

/** Слайдер с превью по имени поля-повторителя. */
function eco_the_slider( $field ) {
	get_template_part( 'template-parts/slider', null, array( 'field' => $field ) );
}
