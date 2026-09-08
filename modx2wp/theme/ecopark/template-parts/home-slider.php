<?php
/**
 * Слайдер на главной. Порт чанка `sliderHome`.
 * Слайды редактируются на странице «Главная» в поле «Слайдер главной».
 */
$eco_slides = eco_rows( 'home_slider', get_option( 'page_on_front' ) );
if ( ! $eco_slides ) {
	return;
}
?>
<div class="topslider">
	<div class="swiper-container">
		<div class="swiper-wrapper">
			<?php foreach ( $eco_slides as $eco_slide ) :
				$eco_img = eco_row_image_url( $eco_slide['img'] ?? '', 'eco_slide' );
				?>
				<div class="swiper-slide">
					<div class="i" style="background-image:url(<?php echo esc_url( $eco_img ); ?>)"></div>
					<div class="cont">
						<div class="in">
							<?php if ( ! empty( $eco_slide['title'] ) ) : ?>
								<p class="h1"><?php echo wp_kses( $eco_slide['title'], array( 'br' => array() ) ); ?></p>
							<?php endif; ?>
							<?php if ( ! empty( $eco_slide['text'] ) ) : ?>
								<p><?php echo esc_html( $eco_slide['text'] ); ?></p>
							<?php endif; ?>
							<?php if ( ! empty( $eco_slide['url'] ) ) : ?>
								<a class="btn white" href="<?php echo esc_url( $eco_slide['url'] ); ?>"><?php echo esc_html( $eco_slide['btn'] ?: 'Узнать больше' ); ?></a>
							<?php endif; ?>
						</div>
					</div>
				</div>
			<?php endforeach; ?>
		</div>
	</div>
</div>
