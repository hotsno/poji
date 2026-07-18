<script>
	import { onMount } from 'svelte';
	import { innerWidth, innerHeight } from 'svelte/reactivity/window';
	import ChapterTransition from './ChapterTransition.svelte';
	import ScalingFallbackToast from './ScalingFallbackToast.svelte';
	import { LAYOUT_MODES, READING_DIRECTIONS, SCALE_ALGORITHMS } from '../lib/library.js';
	import { getMitchellResizer } from '../lib/mitchell-resizer.js';
	import { pica } from '../lib/scaling.js';

	let {
		book,
		chapterLabel,
		nextChapter,
		prevChapter,
		readingDirection = READING_DIRECTIONS.LEFT_TO_RIGHT,
		layoutMode = LAYOUT_MODES.SINGLE,
		scaleAlgorithm = SCALE_ALGORITHMS.BROWSER,
		onclose,
		onChapterComplete,
		onPageChange,
		onOpenNext,
		onOpenPrev
	} = $props();

	let webgpuAvailable = true;
	let webgpuFallbackWarned = false;
	let picaAvailable = true;
	let picaFallbackWarned = false;
	/** @type {{ selected: string, fallback: string } | null} */
	let scalingFallback = $state(null);
	const announcedScalingFallbacks = new Set();
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let scalingFallbackTimer;

	let pageIndex = $state(0);

	let isRtl = $derived(readingDirection === READING_DIRECTIONS.RIGHT_TO_LEFT);

	let displayPageIndex = $derived.by(() => {
		if (layoutMode !== 'double') return pageIndex;
		if (pageIndex === 0) return 0;
		return Math.floor((pageIndex + 1) / 2);
	});

	let displayTotalPages = $derived.by(() => {
		if (layoutMode !== 'double') return book.pages.length;
		return 1 + Math.ceil((book.pages.length - 1) / 2);
	});

	let uiVisible = $state(false);
	let cursorHidden = $state(false);
	let chapterCompleted = $state(false);
	/** @type {{ x: number, y: number, pageIndex: number } | null} */
	let imageMenu = $state(null);
	/** @type {HTMLDivElement | undefined} */
	let imageMenuElement = $state();

	const CURSOR_HIDE_DELAY_MS = 500;
	const LONG_PRESS_DELAY_MS = 550;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let cursorHideTimer;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let longPressTimer;
	/** @type {{ x: number, y: number } | null} */
	let longPressStart = null;
	let suppressNextTap = false;

	function resetCursorHideTimer() {
		cursorHidden = false;
		clearTimeout(cursorHideTimer);
		if (uiVisible) return;
		cursorHideTimer = setTimeout(() => {
			cursorHidden = true;
		}, CURSOR_HIDE_DELAY_MS);
	}

	function closeImageMenu() {
		imageMenu = null;
	}

	function clearLongPressTimer() {
		clearTimeout(longPressTimer);
		longPressTimer = undefined;
		longPressStart = null;
	}
	/** @type {'end' | 'start' | null} */
	let chapterTransition = $state(null);

	function maybeCompleteChapter(index) {
		const lastIndex = layoutMode === 'double' && index > 0
			? Math.min(index + 1, book.pages.length - 1)
			: index;
		if (lastIndex === book.pages.length - 1 && !chapterCompleted) {
			chapterCompleted = true;
			onChapterComplete?.();
		}
	}

	/** Decoded bitmaps, keyed by page index. */
	const bitmaps = new Map();

	function getBitmap(index) {
		let promise = bitmaps.get(index);
		if (!promise) {
			promise = createImageBitmap(book.pages[index], {
				colorSpaceConversion: 'none',
				premultiplyAlpha: 'none'
			});
			bitmaps.set(index, promise);
		}
		return promise;
	}

	function getTargetDimensions(bitmap, maxWidth, maxHeight) {
		const dpr = window.devicePixelRatio || 1;
		const scale = Math.min((maxWidth * dpr) / bitmap.width, (maxHeight * dpr) / bitmap.height);
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		return { width, height, cssWidth: width / dpr, cssHeight: height / dpr };
	}

	function get2dContext(canvas) {
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Browser cannot create a 2D canvas context');
		return context;
	}

	function drawBitmapToCanvas(bitmap, canvas, width, height) {
		const context = get2dContext(canvas);
		context.clearRect(0, 0, width, height);
		context.imageSmoothingEnabled = width !== bitmap.width || height !== bitmap.height;
		context.imageSmoothingQuality = 'high';
		context.drawImage(bitmap, 0, 0, width, height);
	}

	/** @typedef {{ canvas: HTMLCanvasElement, width: number, height: number, cssWidth: number, cssHeight: number }} ResizedPage */

	/** Completed offscreen resizes, keyed by `${index}:${width}x${height}`. */
	const resizeCache = new Map();
	/** In-flight offscreen resizes, with the same keys as resizeCache. */
	const resizePromises = new Map();

	function resizeCacheKey(index, width, height) {
		return `${index}:${width}x${height}`;
	}

	function logResize(index, method, bitmap, width, height, startedAt) {
		console.info('[poji:resize]', {
			page: index + 1,
			method,
			source: `${bitmap.width}x${bitmap.height}`,
			target: `${width}x${height}`,
			durationMs: Math.round(performance.now() - startedAt)
		});
	}

	function showScalingFallback(selected, fallback) {
		if (selected === fallback) return;
		const key = `${selected}:${fallback}`;
		if (announcedScalingFallbacks.has(key)) return;

		announcedScalingFallbacks.add(key);
		scalingFallback = { selected, fallback };
		clearTimeout(scalingFallbackTimer);
		scalingFallbackTimer = setTimeout(() => {
			scalingFallback = null;
		}, 6000);
	}

	async function resizeBitmap(index, bitmap, maxWidth, maxHeight, algorithm) {
		const startedAt = performance.now();
		const { width, height, cssWidth, cssHeight } = getTargetDimensions(bitmap, maxWidth, maxHeight);
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;

		if (algorithm === SCALE_ALGORITHMS.MITCHELL && webgpuAvailable) {
			try {
				const resizer = await getMitchellResizer();
				if (resizer) {
					const gpuCanvas = document.createElement('canvas');
					await resizer.render(bitmap, gpuCanvas, width, height);
					drawBitmapToCanvas(gpuCanvas, canvas, width, height);
					logResize(index, 'WebGPU Mitchell', bitmap, width, height, startedAt);
					return { canvas, width, height, cssWidth, cssHeight };
				}
				webgpuAvailable = false;
			} catch (err) {
				webgpuAvailable = false;
				if (!webgpuFallbackWarned) {
					console.warn('Mitchell WebGPU resize failed; falling back to pica Lanczos3', err);
					webgpuFallbackWarned = true;
				}
			}
		}

		if (
			algorithm !== SCALE_ALGORITHMS.BROWSER &&
			(width !== bitmap.width || height !== bitmap.height)
		) {
			if (picaAvailable) {
				try {
					await pica.resize(bitmap, canvas, { filter: 'lanczos3' });
					showScalingFallback(algorithm, SCALE_ALGORITHMS.LANCZOS);
					logResize(index, 'pica Lanczos3', bitmap, width, height, startedAt);
					return { canvas, width, height, cssWidth, cssHeight };
				} catch (err) {
					picaAvailable = false;
					if (!picaFallbackWarned) {
						console.warn('Pica Lanczos3 resize failed; falling back to browser canvas scaling', err);
						picaFallbackWarned = true;
					}
				}
			}
		}

		drawBitmapToCanvas(bitmap, canvas, width, height);
		if (width !== bitmap.width || height !== bitmap.height) {
			showScalingFallback(algorithm, SCALE_ALGORITHMS.BROWSER);
		}
		logResize(
			index,
			width === bitmap.width && height === bitmap.height
				? 'browser canvas (copy only)'
				: 'browser canvas scaling',
			bitmap,
			width,
			height,
			startedAt
		);
		return { canvas, width, height, cssWidth, cssHeight };
	}

	async function getResizedPage(index, maxWidth, maxHeight, algorithm) {
		const bitmap = await getBitmap(index);
		const { width, height } = getTargetDimensions(bitmap, maxWidth, maxHeight);
		const key = `${resizeCacheKey(index, width, height)}:${algorithm}`;

		const cached = resizeCache.get(key);
		if (cached) return cached;

		let promise = resizePromises.get(key);
		if (!promise) {
			promise = resizeBitmap(index, bitmap, maxWidth, maxHeight, algorithm).then((resized) => {
				resizeCache.set(key, resized);
				resizePromises.delete(key);
				return resized;
			});
			resizePromises.set(key, promise);
		}
		return promise;
	}

	function blitToCanvas(canvas, resized) {
		if (canvas.width !== resized.width) canvas.width = resized.width;
		if (canvas.height !== resized.height) canvas.height = resized.height;
		canvas.style.width = `${resized.cssWidth}px`;
		canvas.style.height = `${resized.cssHeight}px`;
		get2dContext(canvas).drawImage(resized.canvas, 0, 0);
	}

	function pruneResizeCache(currentIndex) {
		const keepAhead = 7;
		for (const key of resizeCache.keys()) {
			const cachedPageIndex = Number(key.split(':')[0]);
			if (Math.abs(cachedPageIndex - currentIndex) > keepAhead) resizeCache.delete(key);
		}
	}

	function prefetchNeighbors(index, maxWidth, maxHeight, algorithm) {
		const isDouble = layoutMode === 'double' && index > 0;
		const ahead = 5;
		const behind = isDouble ? 2 : 3;
		for (let i = 1; i <= ahead; i++) {
			const forward = index + i;
			if (forward < book.pages.length) {
				getResizedPage(forward, maxWidth, maxHeight, algorithm).catch((err) =>
					console.error('Failed to prefetch page', forward, err)
				);
			}
		}
		for (let i = 1; i <= behind; i++) {
			const backward = index - i;
			if (backward >= 0) {
				getResizedPage(backward, maxWidth, maxHeight, algorithm).catch((err) =>
					console.error('Failed to prefetch page', backward, err)
				);
			}
		}
		pruneResizeCache(index);
	}

	let renderToken = 0;
	let renderQueue = Promise.resolve();

	function renderPage(canvas) {
		const index = pageIndex;
		const maxWidth = innerWidth.current;
		const maxHeight = innerHeight.current;
		const algorithm = scaleAlgorithm;
		if (!maxWidth || !maxHeight) return;

		const token = ++renderToken;

		renderQueue = renderQueue
			.then(async () => {
				if (token !== renderToken) return;

				if (layoutMode === 'double' && index > 0) {
					const halfWidth = Math.floor(maxWidth / 2);
					const rightIdx = index + 1;
					const [leftResized, rightResized] = await Promise.all([
						getResizedPage(index, halfWidth, maxHeight, algorithm),
						rightIdx < book.pages.length
							? getResizedPage(rightIdx, halfWidth, maxHeight, algorithm)
							: null
					]);
					if (token !== renderToken) return;

					const first = isRtl ? rightResized : leftResized;
					const second = isRtl ? leftResized : rightResized;
					const firstW = first?.width ?? 0;
					const secondW = second?.width ?? 0;

					canvas.width = firstW + secondW;
					canvas.height = Math.max(first?.height ?? 0, second?.height ?? 0);
					canvas.style.width = `${(first?.cssWidth ?? 0) + (second?.cssWidth ?? 0)}px`;
					canvas.style.height = `${Math.max(first?.cssHeight ?? 0, second?.cssHeight ?? 0)}px`;

					const ctx = get2dContext(canvas);
					ctx.clearRect(0, 0, canvas.width, canvas.height);
					if (first) ctx.drawImage(first.canvas, 0, 0);
					if (second) ctx.drawImage(second.canvas, firstW, 0);
				} else {
					const resized = await getResizedPage(index, maxWidth, maxHeight, algorithm);
					if (token !== renderToken) return;
					blitToCanvas(canvas, resized);
				}

				const prefetchW = layoutMode === 'double' && index > 0 ? Math.floor(maxWidth / 2) : maxWidth;
				prefetchNeighbors(index, prefetchW, maxHeight, algorithm);
			})
			.catch((err) => console.error('Failed to render page', err));
		}

	$effect(() => {
		book.volumeId;
		book.chapterId;
		pageIndex = book.startPageIndex ?? 0;
		chapterTransition = null;
		chapterCompleted = false;
		for (const promise of bitmaps.values()) {
			promise.then((bitmap) => bitmap.close()).catch(() => {});
		}
		bitmaps.clear();
		resizeCache.clear();
		resizePromises.clear();
	});

	$effect(() => {
		return () => {
			for (const promise of bitmaps.values()) {
				promise.then((bitmap) => bitmap.close()).catch(() => {});
			}
			resizeCache.clear();
			resizePromises.clear();
		};
	});

	function goTo(index) {
		const next = Math.max(0, Math.min(book.pages.length - 1, index));
		pageIndex = next;
		chapterTransition = null;
		closeImageMenu();
		onPageChange?.(next);
		maybeCompleteChapter(next);
	}

	function nextPage() {
		if (chapterTransition === 'start') {
			chapterTransition = null;
			return;
		}
		if (chapterTransition === 'end') {
			if (nextChapter) onOpenNext?.(nextChapter);
			return;
		}

		const step = layoutMode === 'double' && pageIndex > 0 ? 2 : 1;
		const lastPageInView = layoutMode === 'double' && pageIndex > 0
			? Math.min(pageIndex + 1, book.pages.length - 1)
			: pageIndex;

		if (lastPageInView >= book.pages.length - 1) {
			chapterTransition = 'end';
			maybeCompleteChapter(pageIndex);
			return;
		}
		goTo(Math.min(pageIndex + step, book.pages.length - 1));
	}

	function prevPage() {
		if (chapterTransition === 'end') {
			chapterTransition = null;
			return;
		}
		if (chapterTransition === 'start') {
			if (prevChapter) onOpenPrev?.(prevChapter);
			return;
		}
		if (pageIndex <= 0) {
			chapterTransition = 'start';
			return;
		}
		const step = layoutMode === 'double' && pageIndex > 1 ? 2 : 1;
		goTo(Math.max(0, pageIndex - step));
	}

	function turnFromLeftSide() {
		if (isRtl) {
			nextPage();
			return;
		}
		prevPage();
	}

	function turnFromRightSide() {
		if (isRtl) {
			prevPage();
			return;
		}
		nextPage();
	}

	function leftTapLabel() {
		if (isRtl) {
			return chapterTransition === 'end' && nextChapter ? 'Continue to next chapter' : 'Next page';
		}
		return chapterTransition === 'start' && prevChapter ? 'Go to previous chapter' : 'Previous page';
	}

	function rightTapLabel() {
		if (isRtl) {
			return chapterTransition === 'start' && prevChapter ? 'Go to previous chapter' : 'Previous page';
		}
		return chapterTransition === 'end' && nextChapter ? 'Continue to next chapter' : 'Next page';
	}

	/** @param {Event & { currentTarget: HTMLInputElement }} event */
	function handleScrub(event) {
		const displayIndex = Number(event.currentTarget.value);
		if (layoutMode === 'double') {
			const newPageIndex = displayIndex === 0 ? 0 : displayIndex * 2 - 1;
			goTo(Math.min(newPageIndex, book.pages.length - 1));
		} else {
			goTo(displayIndex);
		}
	}

	function clampMenuPosition(x, y) {
		const menuWidth = 190;
		const menuHeight = 54;
		const margin = 10;
		return {
			x: Math.max(margin, Math.min(x, window.innerWidth - menuWidth - margin)),
			y: Math.max(margin, Math.min(y, window.innerHeight - menuHeight - margin))
		};
	}

	function openImageMenu(x, y) {
		if (chapterTransition) return;
		const position = clampMenuPosition(x, y);
		imageMenu = { ...position, pageIndex };
		uiVisible = false;
		resetCursorHideTimer();
	}

	/** @param {MouseEvent} event */
	function handleContextMenu(event) {
		event.preventDefault();
		openImageMenu(event.clientX, event.clientY);
	}

	/** @param {PointerEvent} event */
	function handlePointerDown(event) {
		closeImageMenu();
		if (event.pointerType === 'mouse' || !event.isPrimary || chapterTransition) return;
		clearLongPressTimer();
		longPressStart = { x: event.clientX, y: event.clientY };
		longPressTimer = setTimeout(() => {
			suppressNextTap = true;
			openImageMenu(event.clientX, event.clientY);
		}, LONG_PRESS_DELAY_MS);
	}

	/** @param {PointerEvent} event */
	function handlePointerMove(event) {
		if (event.pointerType === 'mouse' || !longPressStart) return;
		const distance = Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y);
		if (distance > 10) clearLongPressTimer();
	}

	function handlePointerEnd() {
		clearLongPressTimer();
	}

	/**
	 * @param {MouseEvent} event
	 * @param {() => void} action
	 */
	function handleTapZoneClick(event, action) {
		if (suppressNextTap) {
			event.preventDefault();
			event.stopPropagation();
			suppressNextTap = false;
			return;
		}
		closeImageMenu();
		action();
	}

	function extensionForBlob(blob) {
		const extension = {
			'image/jpeg': 'jpg',
			'image/png': 'png',
			'image/gif': 'gif',
			'image/webp': 'webp',
			'image/avif': 'avif',
			'image/bmp': 'bmp'
		}[blob.type];
		return extension ?? 'bin';
	}

	function sanitizeFileName(name) {
		return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
	}

	function currentImageFileName(index) {
		const sourceName = book.pageNames?.[index]?.split('/').pop();
		if (sourceName) return sanitizeFileName(sourceName);
		const extension = extensionForBlob(book.pages[index]);
		return sanitizeFileName(`${book.name} page ${index + 1}.${extension}`);
	}

	function saveOriginalImage() {
		if (!imageMenu) return;
		const index = imageMenu.pageIndex;
		const blob = book.pages[index];
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = currentImageFileName(index);
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		closeImageMenu();
	}

	/** @param {MouseEvent} event */
	function handleWindowClick(event) {
		if (!imageMenu) return;
		if (event.target instanceof Node && imageMenuElement?.contains(event.target)) return;
		closeImageMenu();
	}

	onMount(() => {
		if (book.pages.length === 1) maybeCompleteChapter(0);
		resetCursorHideTimer();
		return () => {
			clearTimeout(cursorHideTimer);
			clearTimeout(scalingFallbackTimer);
			clearLongPressTimer();
		};
	});

	function handleKeydown(event) {
		if (event.key === 'ArrowRight') {
			turnFromRightSide();
		} else if (event.key === 'ArrowLeft') {
			turnFromLeftSide();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			if (imageMenu) {
				closeImageMenu();
				return;
			}
			uiVisible = !uiVisible;
			resetCursorHideTimer();
		} else if (event.key.toLowerCase() === 'x') {
			event.preventDefault();
			onclose?.();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} onmousemove={resetCursorHideTimer} onclick={handleWindowClick} />

<div class="reader" class:cursor-hidden={cursorHidden && !uiVisible}>
	<div
		class="stage"
		role="presentation"
		oncontextmenu={handleContextMenu}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerEnd}
		onpointercancel={handlePointerEnd}
		onpointerleave={handlePointerEnd}
	>
		{#if chapterTransition}
			<ChapterTransition
				mangaName={book.mangaName}
				currentChapter={chapterLabel}
				adjacentChapter={chapterTransition === 'end' ? nextChapter : prevChapter}
				direction={chapterTransition}
			/>
		{:else}
			<canvas {@attach renderPage}></canvas>
		{/if}
		<div class="tap-zones">
			<button
				type="button"
				class="tap-zone"
				aria-label={leftTapLabel()}
				onclick={(event) => handleTapZoneClick(event, turnFromLeftSide)}
			></button>
			<button type="button" class="tap-zone" aria-label="Toggle reader controls" onclick={(event) => handleTapZoneClick(event, () => {
					uiVisible = !uiVisible;
					resetCursorHideTimer();
				})}></button>
			<button
				type="button"
				class="tap-zone"
				aria-label={rightTapLabel()}
				onclick={(event) => handleTapZoneClick(event, turnFromRightSide)}
			></button>
		</div>
	</div>

	{#if imageMenu}
		<div
			class="image-menu"
			bind:this={imageMenuElement}
			style={`left: ${imageMenu.x}px; top: ${imageMenu.y}px;`}
			role="menu"
			aria-label="Image options"
			tabindex="-1"
		>
			<button type="button" role="menuitem" onclick={saveOriginalImage}>Save original image</button>
		</div>
	{/if}

	{#if scalingFallback}
		<ScalingFallbackToast
			selected={scalingFallback.selected}
			fallback={scalingFallback.fallback}
		/>
	{/if}

	{#if uiVisible}
		<header class="bar top">
			<button type="button" class="back" onclick={onclose} aria-label="Back to home">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M19 12H5" />
					<path d="m12 19-7-7 7-7" />
				</svg>
			</button>
			<span class="title">{book.name}</span>
		</header>

		<footer class="bar bottom">
			{#if chapterTransition}
				<span class="pages">{chapterTransition === 'end' ? 'Chapter complete' : 'Chapter start'}</span>
			{:else}
				<input
					type="range"
					class="scrubber"
					min="0"
					max={displayTotalPages - 1}
					value={displayPageIndex}
					oninput={handleScrub}
					aria-label="Page"
				/>
				<span class="pages">{displayPageIndex + 1} / {displayTotalPages}</span>
			{/if}
		</footer>
	{/if}
</div>

<style>
	.reader {
		position: relative;
		height: 100%;
		background: #000;
	}

	.reader.cursor-hidden,
	.reader.cursor-hidden * {
		cursor: none !important;
	}

	.stage {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		-webkit-touch-callout: none;
	}

	canvas {
		display: block;
	}

	.tap-zones {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
	}

	.tap-zone {
		all: unset;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		touch-action: manipulation;
		user-select: none;
	}

	.image-menu {
		position: fixed;
		z-index: 4;
		min-width: 11.875rem;
		padding: 0.35rem;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 0.5rem;
		background: rgba(23, 23, 27, 0.96);
		box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.35);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
	}

	.image-menu button {
		width: 100%;
		min-height: 2.35rem;
		border: none;
		border-radius: 0.35rem;
		background: transparent;
		color: #f4f4f5;
		font: inherit;
		font-size: 0.9rem;
		text-align: left;
		padding: 0 0.7rem;
		cursor: pointer;
	}

	.image-menu button:hover,
	.image-menu button:focus-visible {
		background: rgba(255, 255, 255, 0.1);
		outline: none;
	}

	.bar {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: rgba(13, 13, 15, 0.85);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
	}

	.top {
		top: 0;
	}

	.bottom {
		bottom: 0;
		padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
	}

	@media (hover: none) and (pointer: coarse) {
		.bottom {
			padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
		}
	}

	.back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		flex-shrink: 0;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: #e8e8ea;
		cursor: pointer;
	}

	.back:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.back svg {
		width: 1.25rem;
		height: 1.25rem;
	}

	.title {
		font-size: 0.95rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.scrubber {
		flex: 1;
		accent-color: #8a7ff0;
		cursor: pointer;
	}

	.pages {
		flex-shrink: 0;
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
		color: #b9b9c1;
	}
</style>
