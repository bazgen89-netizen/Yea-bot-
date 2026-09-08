/* global jQuery, wp */
/**
 * Поведение своих полей в админке: выбор картинки через медиатеку
 * и добавление/сортировка строк повторителя.
 */
( function ( $ ) {
	'use strict';

	/* ---------- поле-картинка ---------- */

	function bindImageField( $wrap ) {
		if ( $wrap.data( 'ecoBound' ) ) {
			return;
		}
		$wrap.data( 'ecoBound', true );

		var $input   = $wrap.find( '[data-eco-image-input]' );
		var $preview = $wrap.find( '[data-eco-image-preview]' );
		var frame;

		$wrap.on( 'click', '[data-eco-image-pick]', function ( e ) {
			e.preventDefault();
			if ( ! frame ) {
				frame = wp.media( {
					title: 'Выберите изображение',
					button: { text: 'Использовать' },
					library: { type: 'image' },
					multiple: false
				} );
				frame.on( 'select', function () {
					var att = frame.state().get( 'selection' ).first().toJSON();
					var url = ( att.sizes && att.sizes.medium ) ? att.sizes.medium.url : att.url;
					$input.val( att.id );
					$preview.html( $( '<img>' ).attr( { src: url, alt: '' } ) );
				} );
			}
			frame.open();
		} );

		$wrap.on( 'click', '[data-eco-image-clear]', function ( e ) {
			e.preventDefault();
			$input.val( '' );
			$preview.empty();
		} );
	}

	/* ---------- повторитель ---------- */

	function nextIndex( $rows ) {
		var max = -1;
		$rows.find( '[data-eco-repeater-row]' ).each( function () {
			$( this ).find( '[name]' ).each( function () {
				var m = /\[(\d+)\]/.exec( this.name );
				if ( m ) {
					max = Math.max( max, parseInt( m[ 1 ], 10 ) );
				}
			} );
		} );
		return max + 1;
	}

	function bindRepeater( $rep ) {
		if ( $rep.data( 'ecoBound' ) ) {
			return;
		}
		$rep.data( 'ecoBound', true );

		var $rows = $rep.find( '[data-eco-repeater-rows]' ).first();

		$rep.on( 'click', '[data-eco-repeater-add]', function ( e ) {
			e.preventDefault();
			var tpl  = $rep.find( '[data-eco-repeater-template]' ).first().html();
			var html = tpl.split( '__i__' ).join( String( nextIndex( $rows ) ) );
			var $row = $( html );
			$rows.append( $row );
			$row.find( '[data-eco-image]' ).each( function () {
				bindImageField( $( this ) );
			} );
		} );

		$rep.on( 'click', '[data-eco-repeater-remove]', function ( e ) {
			e.preventDefault();
			$( this ).closest( '[data-eco-repeater-row]' ).remove();
		} );

		if ( $.fn.sortable ) {
			$rows.sortable( {
				handle: '[data-eco-repeater-handle]',
				items: '[data-eco-repeater-row]',
				axis: 'y',
				tolerance: 'pointer'
			} );
		}
	}

	$( function () {
		$( '[data-eco-image]' ).each( function () {
			bindImageField( $( this ) );
		} );
		$( '[data-eco-repeater]' ).each( function () {
			bindRepeater( $( this ) );
		} );
	} );
}( jQuery ) );
