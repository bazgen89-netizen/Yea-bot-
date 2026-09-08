<?php
/** Карточка публикации для слайдера. Порт чанка `events_slider_element`. */
$eco_item = $args['post'] ?? null;
if ( ! $eco_item ) {
	return;
}
?>
<div class="swiper-slide eventan">
	<a href="<?php echo esc_url( get_permalink( $eco_item ) ); ?>"></a>
	<div class="i" style="background-image:url(<?php echo esc_url( eco_image_url( 'ev_animg', 'eco_card', $eco_item->ID ) ); ?>)"></div>
	<div class="cont">
		<p class="h"><?php echo esc_html( get_the_title( $eco_item ) ); ?></p>
		<span class="btn">Подробнее</span>
	</div>
</div>
