<?php
/** Слайдер услуг. Порт чанка `services` (getResources &parents=`6`). */
$eco_items = eco_services( 6 );
if ( ! $eco_items ) {
	return;
}
?>
<div class="services">
	<div class="halign allanim frombottom">
		<p class="pre">Наши услуги</p>
		<h2>Мы рады будем<br> организовать для вас</h2>
		<p>В Экопарке «Богослово» делают все, чтобы ваш отдых был комфортным, а пребывание было наполнено смыслом, полезной активностью и интересом. У нас вы можете не просто побыть в тишине и покое, но и насладиться прогулкой на велосипеде или лошади, поудить рыбу, приготовить вкусный обед и расслабиться в русской бане.</p>

		<div class="slider">
			<div class="ctrls">
				<div class="pn white">
					<div class="prev"></div>
					<div class="next"></div>
				</div>
			</div>
			<div class="swiper-container">
				<div class="swiper-wrapper">
					<?php foreach ( $eco_items as $eco_item ) : ?>
						<div class="swiper-slide">
							<a href="<?php echo esc_url( get_permalink( $eco_item ) ); ?>"></a>
							<div class="i" style="background-image:url(<?php echo esc_url( eco_image_url( 'usl_animg', 'eco_card', $eco_item->ID ) ); ?>)"></div>
							<div class="cont">
								<p class="h"><?php echo esc_html( get_the_title( $eco_item ) ); ?></p>
								<span class="btn">Подробнее</span>
							</div>
						</div>
					<?php endforeach; ?>
				</div>
			</div>
		</div>
	</div>
</div>
