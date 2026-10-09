// Sky Pro pane driver (written for the comparison page, not part of Sky Pro).
// Runs Sky Pro's atmosphere + volumetric clouds (vendored from Tidewater, see NOTICE.md) on its own raw WebGPU device and canvas:
// the clouds are traced in compute, the final pass draws sky + clouds + a diffuse ground plane and tone maps (ACES, as three's ACESFilmicToneMapping) to the canvas.
import { GPU } from './engine/gpu/GPU.js';
import { FrameUniforms, G, setFrameCamera } from './engine/render/Frame.js';
import { FullscreenPass } from './engine/render/FullscreenPass.js';
import { PerspectiveCamera } from './engine/scene/Camera.js';
import { Vector3, MathUtils } from './engine/math/index.js';
import { Atmosphere, SUN_ILLUMINANCE } from './sky/Atmosphere.js';
import { Sky } from './sky/Sky.js';
import { SkyProClouds } from './sky/SkyProClouds.js';
import baseShapeUrl from './clouds/baseShape64.bin?url';
import blueNoiseUrl from './clouds/blueNoise.bin?url';

const smoothstep = ( x, a, b ) => { const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) ); return t * t * ( 3 - 2 * t ); };

// Tidewater meters an auto exposure (PostFX, refLum 0.25, clamp 0.6..6) on its whole frame (sky, sea, island). This pane has no such scene, so the multiplier
// follows the sun elevation through the values measured in the real demo looking out to sea (X2: 0.86 at 60, 1.19 at 10, 2.02 at 3 degrees). `?skypro_ae=<number>` overrides it.
const AE_POINTS = [ [ 3, 2.02 ], [ 10, 1.19 ], [ 60, 0.86 ] ];
const AE_OVERRIDE = new URLSearchParams( globalThis.location?.search ?? '' ).get( 'skypro_ae' );
function autoExposure( elevationDeg ) {

	if ( AE_OVERRIDE !== null && AE_OVERRIDE !== '' ) return Number( AE_OVERRIDE );
	const P = AE_POINTS;
	if ( elevationDeg <= P[ 0 ][ 0 ] ) return P[ 0 ][ 1 ];
	for ( let i = 1; i < P.length; i ++ ) {

		if ( elevationDeg <= P[ i ][ 0 ] ) { const t = ( elevationDeg - P[ i - 1 ][ 0 ] ) / ( P[ i ][ 0 ] - P[ i - 1 ][ 0 ] ); return P[ i - 1 ][ 1 ] + t * ( P[ i ][ 1 ] - P[ i - 1 ][ 1 ] ); }

	}

	return P[ P.length - 1 ][ 1 ];

}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ groundAlbedo: [number, number, number] }} options
 */
export async function createSkyProPane( canvas, options ) {

	await GPU.init( { canvas } );
	const atmosphere = new Atmosphere();
	const sky = new Sky( atmosphere );
	const clouds = new SkyProClouds( null, atmosphere, { baseShape: baseShapeUrl, blueNoise: blueNoiseUrl } );
	sky.clouds = clouds;
	G.night.value = 0;
	sky.starIntensity.value = 0;
	await clouds.ready;
	const camera = new PerspectiveCamera( 50, 1, 0.5, 600000 );
	const albedo = options.groundAlbedo;
	const groundShadows = options.groundShadows ? '1.0' : '0.0';

	const exposureUniform = FrameUniforms.fields.exposure;
	// final pass: sky (+ clouds) above the horizon, a Lambertian ground plane at y = 0 below it (lit by the sun with the cloud shadow map, and by the sky), hazed toward the horizon colour
	const finalPass = new FullscreenPass( {
		label: 'skypro final', modules: [ sky.module, clouds.shadowModule ], colorFormats: [ GPU.format ],
		code: /* wgsl */`
fn RRTAndODTFit( v: vec3f ) -> vec3f {
	let a = v * ( v + 0.0245786 ) - 0.000090537;
	let b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
// three.js ACESFilmicToneMapping (exposure applied by the caller)
fn aces( c: vec3f ) -> vec3f {
	let ACESInputMat = mat3x3f( vec3f( 0.59719, 0.07600, 0.02840 ), vec3f( 0.35458, 0.90834, 0.13383 ), vec3f( 0.04823, 0.01566, 0.83777 ) );
	let ACESOutputMat = mat3x3f( vec3f( 1.60475, -0.10208, -0.00327 ), vec3f( -0.53108, 1.10813, -0.07276 ), vec3f( -0.07367, -0.00605, 1.07602 ) );
	var color = c / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return sat3( color );
}
fn fragment( in: FSIn ) -> vec4f {
	let uv = in.pos.xy * frame.invResolution;
	let dir = viewRay( uv );
	var L: vec3f;
	if ( dir.y > 0.0 ) {
		L = skyViewRadiance( dir );
	} else {
		let t = frame.cameraPos.y / max( -dir.y, 1e-5 );
		let P = frame.cameraPos + dir * t;
		let albedo = vec3f( ${ albedo.map( v => v.toFixed( 6 ) ).join( ', ' ) } );
		let N = vec3f( 0.0, 1.0, 0.0 );
		let sunDir = atmosphereParams.sunDir;
		let direct = frame.sunColor * max( dot( N, sunDir ), 0.0 ) * mix( 1.0, cloudsShadow( P.xz ), ${ groundShadows } ) * INV_PI;
		let lit = albedo * ( direct + frame.skyIrradiance );
		// haze to the clear horizon colour with distance (no aerial perspective volume in Sky Pro's atmosphere)
		let horizonDir = normalize( vec3f( dir.x, 0.0008, dir.z ) );
		let fogColor = skyBackground( horizonDir, 1.0 );
		let fog = 1.0 - exp( -t / 30000.0 );
		L = mix( lit, fogColor, fog );
	}
	// Tidewater's grading (PostFX.js defaults): white balance nudge, saturation and contrast around mid grey in linear HDR, elliptical vignette (bloom, grain and sharpen are left out)
	var c = L * vec3f( 1.0 + 0.02, 1.0, 1.0 - 0.02 );
	let lum = dot( c, vec3f( 0.2126, 0.7152, 0.0722 ) );
	c = mix( vec3f( lum ), c, 1.06 );
	c = pow( max( c, vec3f( 0.0 ) ) / 0.18, vec3f( 1.04 ) ) * 0.18;
	let dv = ( uv - 0.5 ) * vec2f( 1.0, 0.8 );
	c = c * ( 1.0 - smoothstep( 0.25, 0.75, length( dv ) ) * 0.28 );
	return vec4f( linearToSrgb( aces( c * frame.exposure ) ), 1.0 );
}`,
	} );

	// ---- GPU timing: the cloud kernels (trace, resolve, panorama, shadow) and the final pass
	let timing = null;
	if ( GPU.hasTimestamp ) {
		const parts = [ [ 'trace', clouds.traceKernel ], [ 'resolve', clouds.temporalKernel ], [ 'panorama', clouds.panoKernel ], [ 'shadow', clouds.shadowKernel ], [ 'final', finalPass ] ];
		const querySet = GPU.device.createQuerySet( { type: 'timestamp', count: parts.length * 2 } );
		parts.forEach( ( [ , target ], i ) => { target.timestampWrites = { querySet, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 }; } );
		const resolve = GPU.device.createBuffer( { size: parts.length * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC } );
		const read = GPU.device.createBuffer( { size: parts.length * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ } );
		timing = { parts, querySet, resolve, read, busy: false, ms: Object.fromEntries( parts.map( ( [ n ] ) => [ n, 0 ] ) ) };
	}

	const state = { frame: 0, w: 0, h: 0, sunSet: false, sun: new Vector3(), sunKey: '' };
	const resize = ( w, h ) => {
		w = Math.max( 2, Math.floor( w ) ); h = Math.max( 2, Math.floor( h ) );
		if ( w === canvas.width && h === canvas.height ) return;
		canvas.width = w; canvas.height = h;
	};

	const applySun = ( view ) => {
		const az = view.sunAz * Math.PI / 180, el = view.sunEl * Math.PI / 180;
		state.sun.set( Math.sin( az ) * Math.cos( el ), Math.sin( el ), -Math.cos( az ) * Math.cos( el ) );
		atmosphere.sunDir.value.copy( state.sun );
		G.sunDir.value.copy( state.sun );
		const key = `${ view.sunAz },${ view.sunEl }`;
		if ( key !== state.sunKey ) { state.sunKey = key; atmosphere.skyIrradiance = null; atmosphere.sunTransmittance = null; state.sunSettled = false; } // wait for a readback of the new sun
		// the key light and sky irradiance come back from the GPU a few times a second (as in Tidewater's App.applyAtmosphereReadback)
		const a = atmosphere;
		if ( a.sunTransmittance && a.skyIrradiance && a.horizon ) {
			const T = a.sunTransmittance, irr = a.skyIrradiance;
			const horizonFade = smoothstep( state.sun.y, -0.03, 0.02 );
			G.sunColor.value.setRGB( T[ 0 ], T[ 1 ], T[ 2 ] ).multiplyScalar( SUN_ILLUMINANCE * horizonFade );
			G.skyIrradiance.value.setRGB( irr[ 0 ], irr[ 1 ], irr[ 2 ] );
			G.horizonColor.value.setRGB( a.horizon[ 0 ], a.horizon[ 1 ], a.horizon[ 2 ] );
			state.sunSettled = true;
		}
	};

	let last = performance.now();
	return {
		ready: () => state.sunSettled === true && state.frame > 4,
		resize,
		/** One frame. `view`: { position, forward (unit), fov (vertical degrees), sunAz, sunEl, coverage (Sky Pro's own 0..1), exposure }. */
		render( view ) {
			const now = performance.now();
			const dt = Math.min( 0.1, ( now - last ) / 1000 ); last = now;
			const w = canvas.width, h = canvas.height;
			camera.fov = view.fov; camera.aspect = w / h;
			camera.position.set( view.position[ 0 ], view.position[ 1 ], view.position[ 2 ] );
			camera.up.set( 0, 1, 0 );
			camera.lookAt( view.position[ 0 ] + view.forward[ 0 ], view.position[ 1 ] + view.forward[ 1 ], view.position[ 2 ] + view.forward[ 2 ] );
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld();
			const F = FrameUniforms.fields;
			const prevVP = state.prevVP ?? null;
			setFrameCamera( camera, w, h, { prevViewProj: prevVP, prevCameraPos: state.prevPos ?? null } );
			state.prevVP = F.viewProjNoJitter.value.clone(); state.prevPos = F.cameraPos.value.clone();
			F.outputResolution.value.set( w, h );
			F.time.value += dt; F.dt.value = dt; F.frameIndex.value = state.frame;
			exposureUniform.value = view.exposure * autoExposure( view.sunEl );
			clouds.coverage.value = view.coverage;
			applySun( view );

			GPU.beginFrame();
			atmosphere.update( dt, camera.position.y );
			clouds.update( dt, camera );
			const colorView = GPU.context.getCurrentTexture().createView();
			finalPass.render( { colorViews: [ colorView ] } );
			let issued = false;
			if ( timing && !timing.busy ) {
				const enc = GPU.getEncoder();
				enc.resolveQuerySet( timing.querySet, 0, timing.parts.length * 2, timing.resolve, 0 );
				enc.copyBufferToBuffer( timing.resolve, 0, timing.read, 0, timing.parts.length * 16 );
				timing.busy = true; issued = true;
			}
			GPU.submit();
			if ( issued ) {
				timing.read.mapAsync( GPUMapMode.READ ).then( () => {
					const t = new BigInt64Array( timing.read.getMappedRange().slice( 0 ) );
					timing.read.unmap();
					timing.parts.forEach( ( [ n ], i ) => { const d = Number( t[ i * 2 + 1 ] - t[ i * 2 ] ) / 1e6; if ( d > 0 && d < 1000 ) timing.ms[ n ] = timing.ms[ n ] * 0.8 + d * 0.2; } );
				} ).catch( () => {} ).finally( () => { timing.busy = false; } );
			}
			state.frame++;
		},
		/** GPU milliseconds per pass (smoothed), or null without timestamp queries. */
		gpuMs: () => timing ? { ...timing.ms, total: Object.values( timing.ms ).reduce( ( a, b ) => a + b, 0 ) } : null,
		diagnostics: () => ( { sunSettled: state.sunSettled, frame: state.frame, sunColor: G.sunColor.value.toArray?.() ?? null } ),
	};

}
