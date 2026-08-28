<?php
/**
 * Карточки публикаций для слайдера. Порт getResources с чанком
 * `events_slider_element`.
 *
 * Обёртку swiper-container здесь не рисуем: в MODX getResources
 * подставлял только элементы, а контейнер уже был в разметке вокруг
 * вызова. Если добавить свой — получится вложенный слайдер, и
 * инициализация Swiper падает.
 */
$eco_items = eco_events( 6 );
foreach ( $eco_items as $eco_item ) {
	get_template_part( 'template-parts/card-event', null, array( 'post' => $eco_item ) );
}
