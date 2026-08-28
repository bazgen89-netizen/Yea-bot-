<?php
/**
 * Подключение стилей и скриптов.
 * Порядок повторяет чанк `head` из MODX — от него зависит каскад,
 * newstyle.css обязан грузиться последним.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'wp_enqueue_scripts', 'eco_assets' );
function eco_assets() {
	$css = array( 'default-skin', 'photoswipe', 'normalize5.min', 'swiper.min', 'style', 'main', 'temp', 'newstyle', 'theme' );
	$prev = null;
	foreach ( $css as $handle ) {
		$slug = 'eco-' . sanitize_title( $handle );
		wp_enqueue_style( $slug, ECO_URI . "/assets/css/{$handle}.css", $prev ? array( $prev ) : array(), ECO_VERSION );
		$prev = $slug;
	}

	// Тема приехала с jQuery 1.11 и на нём завязаны slimscroll, cookie и script.js.
	// Ядровый jQuery 3.x ломает часть этого кода, поэтому оставляем родную версию.
	wp_deregister_script( 'jquery' );
	wp_register_script( 'jquery', ECO_URI . '/assets/js/jquery-1.11.1.min.js', array(), '1.11.1', false );
	wp_enqueue_script( 'jquery' );

	wp_enqueue_script( 'eco-ymaps', 'https://api-maps.yandex.ru/2.1.11/?lang=ru_RU', array(), null, false );

	$js = array(
		'jquery.slimscroll.min'    => array( 'jquery' ),
		'swiper.min'               => array(),
		'photoswipe.min'           => array(),
		'photoswipe-ui-default.min' => array( 'eco-photoswipe-min' ),
		'spmain.min'               => array( 'jquery' ),
		'jquery.cookie'            => array( 'jquery' ),
		'spanimotion'              => array( 'jquery' ),
		'script'                   => array( 'jquery', 'eco-spmain-min' ),
	);
	foreach ( $js as $handle => $deps ) {
		wp_enqueue_script( 'eco-' . sanitize_title( $handle ), ECO_URI . "/assets/js/{$handle}.js", $deps, ECO_VERSION, false );
	}
}

/**
 * Исходная вёрстка построена на <base href="/"> и относительных путях
 * вида template/img/... . В теме пути абсолютные, но <base> оставляем:
 * на него завязаны якорные ссылки в script.js.
 */
add_action( 'wp_head', 'eco_base_tag', 1 );
function eco_base_tag() {
	echo '<base href="' . esc_url( home_url( '/' ) ) . '">' . "\n";
}
