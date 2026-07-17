<script>
	import Header from './components/Header.svelte';
	import Home from './components/Home.svelte';
	import ImportToast from './components/ImportToast.svelte';
	import Reader from './components/Reader.svelte';
	import SettingsModal from './components/SettingsModal.svelte';
	import { Settings } from 'lucide-svelte';
	import { loadChapter } from './lib/cbz.js';
	import { importVolumeFiles } from './lib/import-volumes.js';
	import {
		defaultReadingDirection,
		defaultStorageMode,
		getReadingDirection,
		getScaleAlgorithm,
		getStorageMode,
		isFileSystemStorageSupported,
		getVolume,
		countVolumes,
		listVolumes,
		getProgress,
		SCALE_ALGORITHMS,
		saveReadingDirection,
		saveScaleAlgorithm,
		saveStorageMode
	} from './lib/library.js';
	import { detectScalingCapabilities, scalingAlgorithmSupported } from './lib/scaling.js';
	import { formatChapterLabel } from './lib/parse.js';
	import { updateNativeReader } from './lib/tauri-bridge.js';
	import {
		completeLocalChapterProgress,
		findFollowingChapter,
		findPrecedingChapter,
		syncChapterProgress,
		updateLocalPageProgress,
		volumesForSeries
	} from './lib/progress.js';

	/** @typedef {{ volumeId: string, chapterId: string, name: string }} AdjacentChapter */

	/** @typedef {{ name: string, chapterLabel: string, pages: Blob[], pageNames?: string[], mangaName: string, volumeId: string, chapterId: string, nextChapter: AdjacentChapter | null, prevChapter: AdjacentChapter | null, startPageIndex: number }} ReadingBook */

	/** @type {ReadingBook | null} */
	let book = $state.raw(null);
	let authVersion = $state(0);
	let libraryVersion = $state(0);
	let importing = $state(false);
	/** @type {{ current: number, total: number, fileName?: string } | null} */
	let importProgress = $state(null);
	let importError = $state(null);
	let fileSystemStorageSupported = $state(isFileSystemStorageSupported());
	let storageMode = $state(defaultStorageMode());
	let readingDirection = $state(defaultReadingDirection());
	let scaleAlgorithm = $state(SCALE_ALGORITHMS.BROWSER);
	let scalingCapabilities = $state.raw({ mitchell: false, lanczos: false, browser: true });
	let scalingCapabilitiesReady = $state(false);
	let hasLibrary = $state(false);
	let settingsOpen = $state(false);
	let currentPageIndex = $state(0);
	let pageProgressQueue = Promise.resolve();
	const pageTitle = $derived(
		book
			? `poji · ${book.mangaName} · ${book.chapterLabel} · Page ${currentPageIndex + 1}`
			: 'poji · .cbz reader'
	);

	$effect(() => {
		const currentBook = book;
		const controller = new AbortController();
		void updateNativeReader(
			currentBook
				? { mangaName: currentBook.mangaName, chapterLabel: currentBook.chapterLabel }
				: null,
			{ signal: controller.signal }
		).catch((error) => {
			if (!controller.signal.aborted) {
				console.warn('Could not update the native reader state', error);
			}
		});

		return () => controller.abort();
	});

	async function refreshStorageMode() {
		storageMode = await getStorageMode();
	}

	refreshStorageMode();

	async function refreshReadingDirection() {
		readingDirection = await getReadingDirection();
	}

	refreshReadingDirection();

	async function initializeScaling() {
		try {
			scalingCapabilities = await detectScalingCapabilities();
			scaleAlgorithm = await getScaleAlgorithm(scalingCapabilities);
		} catch (error) {
			console.warn('Could not initialize image scaling settings', error);
			scalingCapabilities = { mitchell: false, lanczos: false, browser: true };
			scaleAlgorithm = SCALE_ALGORITHMS.BROWSER;
		} finally {
			scalingCapabilitiesReady = true;
		}
	}

	void initializeScaling();

	async function refreshHasLibrary() {
		hasLibrary = (await countVolumes()) > 0;
	}

	refreshHasLibrary();

	$effect(() => {
		libraryVersion;
		void refreshHasLibrary();
	});

	/** @param {File[] | FileSystemFileHandle[] | import('./lib/import-volumes.js').VolumeImportItem[]} items */
	async function handleImport(items) {
		if (importing) return;

		importing = true;
		importError = null;
		importProgress = null;

		try {
			const { error } = await importVolumeFiles(items, {
				storageMode,
				onProgress: (progress) => {
					importProgress = progress;
				},
				onVolumeImported: () => {
					libraryVersion++;
				}
			});

			if (error) {
				importError = error;
			}
		} finally {
			importing = false;
			importProgress = null;
		}
	}

	/** @param {'file-system' | 'indexed-db'} mode */
	async function handleStorageModeChange(mode) {
		await saveStorageMode(mode);
		storageMode = await getStorageMode();
		importError = null;
	}

	/** @param {'left-to-right' | 'right-to-left'} direction */
	async function handleReadingDirectionChange(direction) {
		await saveReadingDirection(direction);
		readingDirection = await getReadingDirection();
	}

	/** @param {'mitchell-linear-light' | 'lanczos' | 'browser'} algorithm */
	async function handleScaleAlgorithmChange(algorithm) {
		if (!scalingAlgorithmSupported(algorithm, scalingCapabilities)) return;
		await saveScaleAlgorithm(algorithm);
		scaleAlgorithm = algorithm;
	}

	function openSettings() {
		settingsOpen = true;
	}

	function closeSettings() {
		settingsOpen = false;
	}

	/** @param {KeyboardEvent} event */
	function handleWindowKeydown(event) {
		if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) return;
		event.preventDefault();
		openSettings();
	}

	/**
	 * @param {import('./library.js').StoredVolume[]} mangaVolumes
	 * @param {{ volumeId: string, chapterId: string }} location
	 * @returns {Promise<AdjacentChapter | null>}
	 */
	async function resolveChapterMeta(mangaVolumes, location) {
		const volume =
			mangaVolumes.find((v) => v.id === location.volumeId) ?? (await getVolume(location.volumeId));
		if (!volume) return null;
		return {
			...location,
			name: formatChapterLabel(volume, location.chapterId)
		};
	}

	/** @param {{ volumeId: string, chapterId: string, startAtEnd?: boolean, startPageIndex?: number }} selection */
	async function handleOpen({ volumeId, chapterId, startAtEnd = false, startPageIndex }) {
		const volume = await getVolume(volumeId);
		if (!volume) {
			throw new Error('This volume is no longer in your library.');
		}
		const chapter = await loadChapter(volume, chapterId);
		const savedProgress =
			startAtEnd || startPageIndex != null ? null : await getProgress(volume.mangaName);
		const savedPageIndex =
			savedProgress?.volumeId === volumeId && savedProgress?.chapterId === chapterId
				? savedProgress.pageIndex
				: 0;
		const mangaVolumes = volumesForSeries(await listVolumes(), volume.mangaName).map((entry) =>
			entry.id === volumeId ? volume : entry
		);
		const following = findFollowingChapter(mangaVolumes, volumeId, chapterId);
		const preceding = findPrecedingChapter(mangaVolumes, volumeId, chapterId);
		const nextChapter = following ? await resolveChapterMeta(mangaVolumes, following) : null;
		const prevChapter = preceding ? await resolveChapterMeta(mangaVolumes, preceding) : null;
		const initialPageIndex = startAtEnd
			? chapter.pages.length - 1
			: Math.max(0, Math.min(chapter.pages.length - 1, startPageIndex ?? savedPageIndex));
		book = {
			...chapter,
			chapterLabel: formatChapterLabel(volume, chapterId),
			mangaName: volume.mangaName,
			volumeId,
			chapterId,
			nextChapter,
			prevChapter,
			startPageIndex: initialPageIndex
		};
		currentPageIndex = initialPageIndex;
	}

	function handleClose() {
		book = null;
	}

	async function handleChapterComplete() {
		if (!book) return;
		try {
			await completeLocalChapterProgress(
				book.mangaName,
				book.volumeId,
				book.chapterId,
				book.pages.length - 1
			);
			await syncChapterProgress(book.mangaName, book.volumeId, book.chapterId);
		} catch (e) {
			console.warn('Chapter progress sync failed:', e);
		}
	}

	function handlePageChange(pageIndex) {
		if (!book) return;
		currentPageIndex = pageIndex;
		if (pageIndex >= book.pages.length - 1) return;
		const { mangaName, volumeId, chapterId } = book;
		pageProgressQueue = pageProgressQueue
			.then(() => {
				if (
					!book ||
					book.mangaName !== mangaName ||
					book.volumeId !== volumeId ||
					book.chapterId !== chapterId
				) {
					return;
				}
				return updateLocalPageProgress(mangaName, volumeId, chapterId, pageIndex);
			})
			.catch((e) => {
				console.warn('Page progress sync failed:', e);
			});
	}
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="app">
	{#if book}
		<Reader
			{book}
			chapterLabel={book.chapterLabel}
			nextChapter={book.nextChapter}
			prevChapter={book.prevChapter}
			onclose={handleClose}
			onChapterComplete={handleChapterComplete}
			onPageChange={handlePageChange}
			onOpenNext={(next) => handleOpen(next)}
			onOpenPrev={(prev) => handleOpen({ ...prev, startAtEnd: true })}
			{readingDirection}
			{scaleAlgorithm}
		/>
	{:else}
		{#if hasLibrary}
			<Header
				onauthchange={() => authVersion++}
				onsettingsopen={openSettings}
			/>
		{:else}
			<div class="empty-actions">
				<a class="empty-wiki-link" href="https://wiki.poji.app/" target="_blank" rel="noreferrer noopener">
					Learn more
				</a>
				<button type="button" class="empty-settings-btn" aria-label="Settings" onclick={openSettings}>
					<Settings size={17} aria-hidden="true" />
				</button>
			</div>
		{/if}
		<Home
			onopen={handleOpen}
			onimport={handleImport}
			onlibrarychange={() => libraryVersion++}
			{authVersion}
			{libraryVersion}
			{importing}
			{storageMode}
			{fileSystemStorageSupported}
			importError={importError}
		/>
		<ImportToast {importing} progress={importProgress} />
	{/if}

	{#if settingsOpen}
		<SettingsModal
			{storageMode}
			{readingDirection}
			{scaleAlgorithm}
			{scalingCapabilities}
			{scalingCapabilitiesReady}
			{fileSystemStorageSupported}
			onstoragemodechange={handleStorageModeChange}
			onreadingdirectionchange={handleReadingDirectionChange}
			onscalealgorithmchange={handleScaleAlgorithmChange}
			onclose={closeSettings}
		/>
	{/if}
</div>

<style>
	.app {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.empty-actions {
		position: absolute;
		top: 1.25rem;
		right: max(
			var(--layout-padding-inline),
			calc((100% - var(--layout-max-width)) / 2)
		);
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: 'Overpass', sans-serif;
	}

	.empty-wiki-link {
		position: relative;
		padding: 0.4rem 0.9rem;
		border-radius: 0.375rem;
		color: #9a9aa3;
		font-size: 0.875rem;
		font-weight: 500;
		text-decoration: none;
		transform: translateY(1px);
		transition: color 150ms ease;
	}

	.empty-wiki-link::after {
		content: '';
		position: absolute;
		left: 0.9rem;
		bottom: 0.25rem;
		width: 0;
		height: 1px;
		background: currentColor;
		transition: width 200ms cubic-bezier(0.33, 1, 0.68, 1);
	}

	.empty-settings-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: #8a8a92;
		cursor: pointer;
		transition:
			background-color 150ms ease,
			color 150ms ease;
	}

	.empty-wiki-link:hover {
		color: #c8c8d0;
	}

	.empty-wiki-link:hover::after {
		width: calc(100% - 1.8rem);
	}

	.empty-settings-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		color: #d8d8de;
	}
</style>
