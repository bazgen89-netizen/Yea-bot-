<?php
/** Подвал. Порт чанков `footer` и `map_and_footer`. */

$eco_with_map = eco_flag( 'all_footer_mode' ) || is_front_page();
?>
	<?php if ( $eco_with_map ) : ?>
		<?php get_template_part( 'template-parts/map' ); ?>
	<?php endif; ?>

	<div class="footer<?php echo $eco_with_map ? '' : ' normal'; ?>">
		<div class="halign">
			<div class="ftlogo"></div>
			<div class="menuwr">
				<?php
				wp_nav_menu( array(
					'theme_location' => 'footer',
					'container'      => false,
					'items_wrap'     => '<ul>%3$s</ul>',
					'depth'          => 1,
					'fallback_cb'    => false,
				) );
				?>
			</div>
			<div class="contact">
				<p class="adr"><?php echo esc_html( eco_contact( 'address' ) ); ?></p>
				<p class="cr"><?php echo wp_kses( eco_contact( 'copyright' ), array( 'br' => array( 'class' => array() ) ) ); ?></p>
				<?php
				wp_nav_menu( array(
					'theme_location' => 'legal',
					'container'      => false,
					'items_wrap'     => '%3$s',
					'depth'          => 1,
					'fallback_cb'    => false,
					'link_before'    => '',
				) );
				?>
				<p class="mt20" style="font-size:12px;color:#696969;"><?php echo esc_html( eco_contact( 'requisites' ) ); ?></p>
			</div>
		</div>
	</div>
</div>

<?php get_template_part( 'template-parts/cookies' ); ?>

<noya-chat api-key="wgt_2425a6cfb8010fc57c4cc743842f034594e2879d6c731931" lang="ru"></noya-chat>
<script src="https://noya-ai.ru/widget.js" defer></script>

<?php wp_footer(); ?>
</body>
</html>
