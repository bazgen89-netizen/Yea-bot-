<?php
/**
 * Микроразметка Schema.org (JSON-LD).
 *
 * У исходного сайта структурированных данных не было. Добавляем разметку
 * загородной базы отдыха (LodgingBusiness) с контактами, адресом, гео и
 * графиком работы — это даёт поисковикам понять, что это за организация,
 * и открывает расширенные сниппеты (адрес, телефон, карта) в выдаче.
 * Ссылки на телефон/почту/адрес берём фактические, домен — текущий.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'wp_head', 'eco_schema_jsonld', 20 );
function eco_schema_jsonld() {
	// Разметку организации выводим на всех страницах фронтенда.
	if ( is_admin() ) {
		return;
	}

	$home = home_url( '/' );
	$data = array(
		'@context'    => 'https://schema.org',
		'@type'       => array( 'LodgingBusiness', 'LocalBusiness' ),
		'@id'         => $home . '#business',
		'name'        => 'ЭкоПарк «Богослово»',
		'description' => 'Загородный комплекс для отдыха вблизи Владимира: коттеджи с банями, русские бани на дровах, спа-программы, отдых на природе.',
		'url'         => $home,
		'telephone'   => '+7 961 253-27-57',
		'email'       => 'ecopark-33@yandex.ru',
		'image'       => $home . 'content/home/img2-1.jpg',
		'priceRange'  => '₽₽',
		'address'     => array(
			'@type'           => 'PostalAddress',
			'streetAddress'   => 'ул. Луговая, д. 45',
			'addressLocality' => 'посёлок Богослово',
			'addressRegion'   => 'Владимирская область',
			'addressCountry'  => 'RU',
		),
		'geo'         => array(
			'@type'     => 'GeoCoordinates',
			'latitude'  => 56.337539,
			'longitude' => 40.988353,
		),
		'openingHoursSpecification' => array(
			'@type'     => 'OpeningHoursSpecification',
			'dayOfWeek' => array( 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday' ),
			'opens'     => '00:00',
			'closes'    => '23:59',
		),
		'sameAs'      => array(
			'https://t.me/ecopark33',
			'https://wa.me/79612532757',
		),
	);

	echo "\n" . '<script type="application/ld+json">'
		. wp_json_encode( $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES )
		. '</script>' . "\n";
}
