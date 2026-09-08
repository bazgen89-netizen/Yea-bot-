<?php
/**
 * Слайдер с миниатюрами. Порт двух вызовов getImageList,
 * которые в MODX рисовали крупные слайды и полосу превью.
 *
 * @var array $args ['field' => имя поля-повторителя]
 */
$eco_rows = eco_rows( $args['field'] ?? '' );
if ( ! $eco_rows ) {
	return;
}
?>
<div class="slider">
	<div class="sld">
		<div class="swiper-container">
			<div class="swiper-wrapper">
				<?php foreach ( $eco_rows as $eco_row ) :
					$eco_img = eco_row_image_url( $eco_row['img'] ?? '' );
					if ( ! $eco_img ) {
						continue;
					}
					?>
					<div class="swiper-slide">
						<div class="im" style="background-image:url(<?php echo esc_url( $eco_img ); ?>)"></div>
						<a href="<?php echo esc_url( $eco_img ); ?>" data-size="<?php echo esc_attr( eco_image_size_attr( $eco_row['img'] ?? '' ) ); ?>"></a>
					</div>
				<?php endforeach; ?>
			</div>
		</div>
	</div>
	<div class="thumbs">
		<div class="swiper-container">
			<div class="swiper-wrapper">
				<?php foreach ( $eco_rows as $eco_row ) :
					$eco_img = eco_row_image_url( $eco_row['img'] ?? '', 'eco_card' );
					if ( ! $eco_img ) {
						continue;
					}
					?>
					<div class="swiper-slide">
						<div class="im" style="background-image:url(<?php echo esc_url( $eco_img ); ?>)"></div>
					</div>
				<?php endforeach; ?>
			</div>
		</div>
	</div>
</div>
