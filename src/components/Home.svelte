<script>
	import { onDestroy } from 'svelte';
	import { ArrowRight, RefreshCcw } from 'lucide-svelte';
	import AniListMatchModal from './AniListMatchModal.svelte';
	import LibraryEditModal from './LibraryEditModal.svelte';
	import SearchModal from './SearchModal.svelte';
	import { getMangaProgress } from '../lib/anilist.js';
	import { isAuthenticated } from '../lib/anilist-auth.js';
	import { formatChapterLabel } from '../lib/parse.js';
	import {
		applyLibraryEdits,
		getSeriesOrder,
		listProgress,
		listSeriesCovers,
		listVolumes,
		listSeries,
		saveAniListCover,
		saveSeries
	} from '../lib/library.js';
	import { STORAGE_MODES } from '../lib/library.js';
	import {
		advanceLocalProgressFromAniList,
		findFirstChapter,
		findNextChapter,
		markChapterCurrentLocally,
		syncCurrentChapterProgress,
		normalizeMangaName
	} from '../lib/progress.js';

	let {
		onopen,
		onimport,
		onlibrarychange,
		authVersion = 0,
		libraryVersion = 0,
		importing = false,
		storageMode = STORAGE_MODES.FILE_SYSTEM,
		fileSystemStorageSupported = false,
		importError = null
	} = $props();

	const fileAccept =
		'.cbz,.zip,application/zip,application/x-zip-compressed,application/x-cbz,application/vnd.comicbook+zip,application/octet-stream';

	let libraryLoaded = $state(false);
	let dragging = $state(false);
	let openingId = $state(null);
	let openError = $state(null);
	let volumes = $state([]);
	let seriesMeta = $state([]);
	let expandedManga = $state(new Set());
	let expandedVolumes = $state(new Set());
	let matchingManga = $state(null);
	let libraryEditOpen = $state(false);
	let searchOpen = $state(false);
	let heroPressed = $state(false);
	let chapterPressedId = $state(null);
	let chapterContextMenu = $state(null);
	let manualProgressId = $state(null);
	let seriesOrder = $state([]);
	let entranceAnimationsDone = $state(false);
	let fileInput = $state.raw(null);
	let coverObjectUrls = $state(new Map());
	let hoveredCover = $state(null);
	let hasRunAuthEffect = false;
	let hasRunLibraryEffect = false;
	let lastAniListIdsKey = '';
	/** @type {Map<number, number>} */
	let aniListProgress = $state(new Map());
	/** @type {Map<string, import('../lib/library.js').StoredProgress>} */
	let localProgress = $state(new Map());

	/** @type {Map<string, { aniListId: number, aniListTitle: string | null }>} */
	let seriesByName = $derived.by(() => {
		const map = new Map();
		for (const entry of seriesMeta) {
			map.set(entry.mangaName, {
				aniListId: entry.aniListId,
				aniListTitle: entry.aniListTitle ?? null
			});
		}
		return map;
	});

	let series = $derived.by(() => {
		/** @type {Map<string, typeof volumes>} */
		const grouped = new Map();

		for (const volume of volumes) {
			const key = normalizeMangaName(volume.mangaName);
			const list = grouped.get(key) ?? [];
			list.push(volume);
			grouped.set(key, list);
		}

		return [...grouped.entries()]
			.map(([mangaName, mangaVolumes]) => ({
				mangaName,
				volumes: mangaVolumes.sort((a, b) => {
					if (a.volumeNumber != null && b.volumeNumber != null) {
						return a.volumeNumber - b.volumeNumber;
					}
					if (a.volumeNumber != null) return -1;
					if (b.volumeNumber != null) return 1;
					return b.importedAt - a.importedAt;
				})
			}))
			.sort((a, b) => {
				const orderMap = new Map(seriesOrder.map((name, index) => [name, index]));
				const aIndex = orderMap.get(a.mangaName);
				const bIndex = orderMap.get(b.mangaName);
				if (aIndex != null && bIndex != null) return aIndex - bIndex;
				if (aIndex != null) return -1;
				if (bIndex != null) return 1;
				return a.mangaName.localeCompare(b.mangaName);
			});
	});

	let hasLibrary = $derived(series.length > 0);
	let useFileSystemPicker = $derived(
		storageMode === STORAGE_MODES.FILE_SYSTEM && fileSystemStorageSupported
	);

	/** @type {Map<string, { volumeId: string, chapterId: string, pageIndex?: number }>} */
	let progressByManga = $derived.by(() => {
		/** @type {Map<string, { volumeId: string, chapterId: string, pageIndex?: number }>} */
		const map = new Map();

		for (const entry of series) {
			const local = localProgress.get(entry.mangaName);
			if (local) {
				map.set(entry.mangaName, {
					volumeId: local.volumeId,
					chapterId: local.chapterId,
					pageIndex: local.pageIndex
				});
				continue;
			}

			const meta = seriesByName.get(entry.mangaName);
			if (!meta?.aniListId) continue;

			const progress = aniListProgress.get(meta.aniListId);
			if (progress == null) continue;

			const location = findNextChapter(entry.volumes, progress);
			if (location) map.set(entry.mangaName, location);
		}

		return map;
	});

	let searchResults = $derived.by(() =>
		series
			.map((entry) => {
				const location = progressByManga.get(entry.mangaName) ?? findFirstChapter(entry.volumes);
				if (!location) return null;
				const volume = entry.volumes.find((v) => v.id === location.volumeId);
				if (!volume) return null;

				return {
					mangaName: entry.mangaName,
					chapterLabel: formatChapterLabel(volume, location.chapterId),
					volumeId: location.volumeId,
					chapterId: location.chapterId,
					pageIndex: location.pageIndex ?? 0
				};
			})
			.filter(Boolean)
	);

	function aniListIdsKey() {
		return [...new Set(seriesMeta.map((entry) => entry.aniListId).filter((id) => id != null))]
			.sort((a, b) => a - b)
			.join(',');
	}

	/**
	 * @param {{ force?: boolean }} [options]
	 */
	async function refreshAniListProgress(options) {
		if (!isAuthenticated()) {
			aniListProgress = new Map();
			lastAniListIdsKey = '';
			return;
		}

		const currentIdsKey = aniListIdsKey();
		if (!options?.force && currentIdsKey === lastAniListIdsKey) return;

		const mediaIds = currentIdsKey ? currentIdsKey.split(',').map(Number) : [];
		try {
			const nextAniListProgress = await getMangaProgress(mediaIds);
			const nextLocalProgress = new Map(localProgress);

			for (const entry of series) {
				const meta = seriesByName.get(entry.mangaName);
				if (!meta?.aniListId) continue;

				const progress = nextAniListProgress.get(meta.aniListId);
				if (progress == null) continue;

				const updated = await advanceLocalProgressFromAniList(
					entry.mangaName,
					entry.volumes,
					progress
				);
				if (updated) nextLocalProgress.set(updated.mangaName, updated);
			}

			aniListProgress = nextAniListProgress;
			localProgress = nextLocalProgress;
			lastAniListIdsKey = currentIdsKey;
		} catch {
			aniListProgress = new Map();
		}
	}

	/** @param {import('../lib/library.js').StoredSeriesCover[]} covers */
	function replaceCoverObjectUrls(covers) {
		for (const url of coverObjectUrls.values()) {
			URL.revokeObjectURL(url);
		}
		hoveredCover = null;

		const next = new Map();
		for (const cover of covers) {
			next.set(cover.mangaName, URL.createObjectURL(cover.blob));
		}
		coverObjectUrls = next;
	}

	async function refreshLibrary() {
		const [
			nextVolumes,
			nextSeriesMeta,
			nextSeriesOrder,
			nextSeriesCovers,
			nextProgress
		] = await Promise.all([
			listVolumes(),
			listSeries(),
			getSeriesOrder(),
			listSeriesCovers(),
			listProgress()
		]);

		volumes = nextVolumes;
		seriesMeta = nextSeriesMeta;
		seriesOrder = nextSeriesOrder;
		localProgress = new Map(nextProgress.map((progress) => [progress.mangaName, progress]));
		replaceCoverObjectUrls(nextSeriesCovers);
		libraryLoaded = true;
		if (!entranceAnimationsDone) {
			window.setTimeout(() => {
				entranceAnimationsDone = true;
			}, 900);
		}
		void refreshAniListProgress();
	}

	refreshLibrary();

	onDestroy(() => {
		for (const url of coverObjectUrls.values()) {
			URL.revokeObjectURL(url);
		}
	});

	$effect(() => {
		authVersion;
		if (!hasRunAuthEffect) {
			hasRunAuthEffect = true;
			return;
		}
		void refreshAniListProgress({ force: true });
	});

	$effect(() => {
		libraryVersion;
		if (!hasRunLibraryEffect) {
			hasRunLibraryEffect = true;
			return;
		}
		void refreshLibrary();
	});

	/** @param {string} mangaName */
	function openMatchModal(mangaName) {
		matchingManga = mangaName;
	}

	function closeMatchModal() {
		matchingManga = null;
	}

	function openLibraryEdit() {
		libraryEditOpen = true;
	}

	function closeLibraryEdit() {
		libraryEditOpen = false;
	}

	function openSearch() {
		if (!hasLibrary || searchResults.length === 0) return;
		searchOpen = true;
	}

	function closeSearch() {
		searchOpen = false;
	}

	/** @param {string[]} order */
	async function handleLibraryEditSave(order) {
		const remaining = new Set(order);
		const deleted = series.map((entry) => entry.mangaName).filter((name) => !remaining.has(name));
		await applyLibraryEdits({ order, deleted });
		libraryEditOpen = false;
		expandedManga = new Set([...expandedManga].filter((name) => remaining.has(name)));
		if (onlibrarychange) {
			onlibrarychange();
		} else {
			await refreshLibrary();
		}
	}

	/** @param {{ aniListId: number, aniListTitle: string, coverImageUrl: string | null }} match */
	async function confirmMatch(match) {
		if (!matchingManga) return;
		if (match.coverImageUrl) {
			await saveAniListCover(matchingManga, match.coverImageUrl);
		}
		await saveSeries({
			mangaName: matchingManga,
			aniListId: match.aniListId,
			aniListTitle: match.aniListTitle
		});
		await refreshLibrary();
	}

	/**
	 * @param {PointerEvent} event
	 * @param {string} mangaName
	 */
	function showCoverPreview(event, mangaName) {
		const url = coverObjectUrls.get(mangaName);
		if (!url) return;
		hoveredCover = {
			url,
			mangaName,
			x: event.clientX,
			y: event.clientY
		};
	}

	function hideCoverPreview() {
		hoveredCover = null;
	}

	/**
	 * @param {PointerEvent} event
	 * @param {string} mangaName
	 */
	function handleMangaTitlePointerMove(event, mangaName) {
		if (event.target instanceof Element && event.target.closest('.series-title')) {
			showCoverPreview(event, mangaName);
			return;
		}
		hideCoverPreview();
	}

	async function handleDrop(event) {
		event.preventDefault();
		dragging = false;
		const importItems = await getDroppedImportItems(event.dataTransfer);
		if (importItems.length > 0) await onimport?.(importItems);
	}

	function handleFileSelect(event) {
		const input = /** @type {HTMLInputElement} */ (event.currentTarget);
		const files = [...(input.files ?? [])];
		input.value = '';
		if (files.length > 0) void onimport?.(files);
	}

	function handleImportBrowse() {
		if (useFileSystemPicker) {
			void openFilePicker();
			return;
		}

		fileInput?.click();
	}

	async function openFilePicker() {
		if (!useFileSystemPicker || !window.showOpenFilePicker) return;
		try {
			const handles = await window.showOpenFilePicker({
				multiple: true,
				types: [
					{
						description: 'CBZ files',
						accept: {
							'application/vnd.comicbook+zip': ['.cbz'],
							'application/zip': ['.cbz', '.zip']
						}
					}
				],
				excludeAcceptAllOption: false
			});
			if (handles.length > 0) await onimport?.(handles);
		} catch (e) {
			if (!(e instanceof DOMException && e.name === 'AbortError')) {
				throw e;
			}
		}
	}

	/** @param {DataTransfer | null} dataTransfer */
	async function getDroppedImportItems(dataTransfer) {
		if (!dataTransfer) return [];

		if (storageMode === STORAGE_MODES.FILE_SYSTEM && fileSystemStorageSupported) {
			const items = [...dataTransfer.items].filter((item) => item.kind === 'file');
			if (items.length > 0 && items.every((item) => 'getAsFileSystemHandle' in item)) {
				const handles = await Promise.all(
					items.map((item) => item.getAsFileSystemHandle())
				);
				const fileHandles = handles.filter((handle) => handle?.kind === 'file');
				if (fileHandles.length > 0) return fileHandles;
			}
		}

		return [...(dataTransfer.files ?? [])];
	}

	function handleDragOver(event) {
		event.preventDefault();
		dragging = true;
	}

	async function openChapter(volumeId, chapterId, startPageIndex = 0) {
		openError = null;
		openingId = `${volumeId}:${chapterId}`;
		try {
			await onopen({ volumeId, chapterId, startPageIndex });
		} catch (e) {
			openError = e instanceof Error ? e.message : 'Failed to open the chapter.';
		} finally {
			openingId = null;
		}
	}

	/**
	 * @param {MouseEvent} event
	 * @param {string} mangaName
	 * @param {string} volumeId
	 * @param {string} chapterId
	 * @param {number} chapterNumber
	 */
	function openChapterContextMenu(event, mangaName, volumeId, chapterId, chapterNumber) {
		event.preventDefault();
		if (openingId != null) return;

		chapterPressedId = null;
		chapterContextMenu = {
			x: Math.max(8, Math.min(event.clientX, window.innerWidth - 260)),
			y: Math.max(8, Math.min(event.clientY, window.innerHeight - 112)),
			mangaName,
			volumeId,
			chapterId,
			chapterNumber
		};
	}

	function closeChapterContextMenu() {
		chapterContextMenu = null;
	}

	/**
	 * @param {boolean} syncToAniList
	 */
	async function markChapterCurrent(syncToAniList) {
		const selection = chapterContextMenu;
		if (!selection) return;

		const progressKey = `${selection.volumeId}:${selection.chapterId}`;
		chapterContextMenu = null;
		openError = null;
		manualProgressId = progressKey;

		try {
			const progress = await markChapterCurrentLocally(
				selection.mangaName,
				selection.volumeId,
				selection.chapterId
			);
			localProgress = new Map(localProgress).set(selection.mangaName, progress);

			if (syncToAniList) {
				await syncCurrentChapterProgress(
					selection.mangaName,
					selection.volumeId,
					selection.chapterId
				);

				const meta = seriesByName.get(selection.mangaName);
				if (meta?.aniListId) {
					aniListProgress = new Map(aniListProgress).set(
						meta.aniListId,
						Math.max(0, selection.chapterNumber - 1)
					);
				}
			}
		} catch (e) {
			openError = e instanceof Error ? e.message : 'Failed to update chapter progress.';
		} finally {
			manualProgressId = null;
		}
	}

	function volumeLabel(volume) {
		if (volume.volumeNumber != null) return `Vol. ${volume.volumeNumber}`;
		return volume.fileName.replace(/\.cbz$/i, '');
	}

	function continueLabel(entry, location) {
		if (!location) return 'Ch. - ↗';
		const volume = entry.volumes.find((v) => v.id === location.volumeId);
		const chapter = volume?.chapters.find((c) => c.id === location.chapterId);
		return chapter?.number != null ? `Ch. ${chapter.number} ↗` : 'Ch. ↗';
	}

	/** @param {string} mangaName */
	function toggleManga(mangaName) {
		const next = new Set(expandedManga);
		if (next.has(mangaName)) next.delete(mangaName);
		else next.add(mangaName);
		expandedManga = next;
	}

	function handleMangaRowClick(event, mangaName) {
		if (event.target instanceof Element && event.target.closest('.manga-action-btn')) return;
		toggleManga(mangaName);
	}

	/** @param {string} volumeId */
	function toggleVolume(volumeId) {
		const next = new Set(expandedVolumes);
		if (next.has(volumeId)) next.delete(volumeId);
		else next.add(volumeId);
		expandedVolumes = next;
	}

	let flatRows = $derived.by(() => {
		/** @type {Array<any>} */
		const rows = [];
		let mangaIndex = 0;
		for (const entry of series) {
			const mangaOpen = expandedManga.has(entry.mangaName);
			const meta = seriesByName.get(entry.mangaName);
			const progressLocation = progressByManga.get(entry.mangaName);
			rows.push({ type: 'manga', entry, mangaOpen, meta, progressLocation, mangaIndex: mangaIndex++ });
			if (mangaOpen) {
				let beforeCurrentVolume = progressLocation != null;
				for (const volume of entry.volumes) {
					const volumeOpen = expandedVolumes.has(volume.id);
					const isNextVolume = progressLocation?.volumeId === volume.id;
					const isPastVolume = beforeCurrentVolume && !isNextVolume;
					rows.push({
						type: 'volume',
						volume,
						entry,
						volumeOpen,
						isNextVolume,
						isPastVolume,
						progressLocation
					});
					if (volumeOpen) {
						let beforeCurrentChapter = isNextVolume;
						for (const chapter of volume.chapters) {
							const isNextChapter =
								progressLocation?.volumeId === volume.id &&
								progressLocation?.chapterId === chapter.id;
							const isPastChapter = isPastVolume || (beforeCurrentChapter && !isNextChapter);
							rows.push({
								type: 'chapter',
								chapter,
								volume,
								entry,
								isNextChapter,
								isPastChapter
							});
							if (isNextChapter) beforeCurrentChapter = false;
						}
					}
					if (isNextVolume) beforeCurrentVolume = false;
				}
			}
		}
		return rows;
	});

	/** @param {typeof flatRows[0]} row */
	function rowKey(row) {
		if (row.type === 'manga') return `manga:${row.entry.mangaName}`;
		if (row.type === 'volume') return `volume:${row.volume.id}`;
		return `chapter:${row.chapter.id}`;
	}

	/** @param {PointerEvent} event */
	function handleHeroPointerDown(event) {
		if (event.button !== 0) return;
		heroPressed = true;
	}

	/** @param {PointerEvent} event */
	function handleChapterPointerDown(event, volumeId, chapterId) {
		if (event.button !== 0 || openingId != null) return;
		chapterPressedId = `${volumeId}:${chapterId}`;
	}

	function handlePressUp() {
		heroPressed = false;
		chapterPressedId = null;
	}

	/** @param {KeyboardEvent} event */
	function handleWindowKeydown(event) {
		if (event.key === 'Escape' && chapterContextMenu) {
			closeChapterContextMenu();
			return;
		}

		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			openSearch();
		}
	}
</script>

{#snippet importHint()}
	<div class="import-hint-wrap">
		<button
			type="button"
			class={['import-hint', { disabled: importing }]}
			aria-busy={importing}
			disabled={importing}
			onclick={handleImportBrowse}
		>
			<span>
				Drop files anywhere, or <span class="import-hint-click">click here</span> to browse
			</span>
			{#if importError}
				<span class="import-error">{importError}</span>
			{/if}
		</button>
	</div>
{/snippet}

<svelte:window
	onkeydown={handleWindowKeydown}
	onclick={closeChapterContextMenu}
	onblur={closeChapterContextMenu}
	onpointerup={handlePressUp}
	onpointercancel={handlePressUp}
/>

<input
	type="file"
	accept={fileAccept}
	multiple
	class="file-input"
	disabled={importing}
	bind:this={fileInput}
	onchange={handleFileSelect}
/>

<main
	class={['home', { empty: !hasLibrary, dragging, settled: entranceAnimationsDone }]}
	ondragover={handleDragOver}
	ondragleave={() => (dragging = false)}
	ondrop={handleDrop}
>
	{#if dragging}
		<div class="drag-overlay" aria-hidden="true">
			<div class="drag-overlay-content">
				<svg class="drag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 7v14" />
					<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
				</svg>
				<p class="drag-title">Drop to add volumes</p>
				<p class="drag-hint"><code>.cbz</code> files will be added to your library</p>
			</div>
		</div>
	{/if}

	<div class={['content', { empty: !hasLibrary }]}>
		{#if libraryLoaded}
		{#if !hasLibrary}
			<div class="empty-state">
				<div class="empty-top" aria-hidden="true"></div>
				<div class="empty-middle">
					<div class="hero">
						<h1
							class={['hero-logo', { pressed: heroPressed }]}
							onpointerdown={handleHeroPointerDown}
							onpointerup={handlePressUp}
							onpointercancel={handlePressUp}
						>
							poji
						</h1>
						<p class="hero-tagline">local <code>.cbz</code> reader for the browser</p>
					</div>
				</div>
				<div class="empty-bottom">
					{@render importHint()}
				</div>
			</div>
		{:else}
			<section class="library" aria-label="Library">
				<div class="library-heading-row">
					<h2 class="library-heading">Library</h2>
					<button type="button" class="library-edit-btn" onclick={openLibraryEdit}>(edit)</button>
				</div>

				{#if openError}
					<p class="library-error">{openError}</p>
				{/if}

			<div class="library-list">
			{#each flatRows as row, i (rowKey(row))}
				<div
					class={[
						'row',
						`row-${row.type}`,
						{
							striped: i % 2 === 0,
							past:
								(row.type === 'volume' && row.isPastVolume) ||
								(row.type === 'chapter' && row.isPastChapter)
						}
					]}
					style={row.type === 'manga' ? `--manga-index: ${row.mangaIndex}` : undefined}
				>
					{#if row.type === 'manga'}
						<button
							type="button"
							class="row-toggle"
							aria-expanded={row.mangaOpen}
							onpointermove={(event) => handleMangaTitlePointerMove(event, row.entry.mangaName)}
							onpointerleave={hideCoverPreview}
							onpointercancel={hideCoverPreview}
							onclick={(e) => {
								handleMangaRowClick(e, row.entry.mangaName);
								e.currentTarget.blur();
							}}
						>
							<svg
								class={['chevron', { open: row.mangaOpen }]}
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="m9 18 6-6-6-6" />
							</svg>
							<span class="row-text series-title">{row.entry.mangaName}</span>
						</button>
						{#if row.progressLocation || row.meta}
							<button
								type="button"
								class="manga-action-btn continue-btn"
								disabled={openingId != null || !row.progressLocation}
								aria-label="Continue"
								aria-busy={row.progressLocation && openingId === `${row.progressLocation.volumeId}:${row.progressLocation.chapterId}`}
								title={row.progressLocation ? 'Continue' : 'No progress available'}
								onclick={(event) => {
									event.stopPropagation();
									openChapter(
										row.progressLocation.volumeId,
										row.progressLocation.chapterId,
										row.progressLocation.pageIndex ?? 0
									);
								}}
							>
								{continueLabel(row.entry, row.progressLocation)}
							</button>
						{/if}
						<button
							type="button"
							class={['manga-action-btn', 'anilist-btn', { matched: row.meta != null }]}
							aria-label={row.meta ? `AniList: ${row.meta.aniListTitle ?? row.meta.aniListId}` : 'Match on AniList'}
							title={row.meta ? `Matched: ${row.meta.aniListTitle ?? row.meta.aniListId}` : 'Match on AniList'}
							onclick={(event) => {
								event.stopPropagation();
								openMatchModal(row.entry.mangaName);
							}}
						>
							<RefreshCcw size={18} aria-hidden="true" />
						</button>
						<span class="badge">{row.entry.volumes.length} vol.</span>
					{:else if row.type === 'volume'}
						<button
							type="button"
							class="row-toggle"
							aria-expanded={row.volumeOpen}
							onclick={() => toggleVolume(row.volume.id)}
						>
							<svg
								class={['chevron', { open: row.volumeOpen }]}
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="m9 18 6-6-6-6" />
							</svg>
							<span class={['row-text volume-title', { next: row.isNextVolume }]}>{volumeLabel(row.volume)}</span>
							<span class="badge">{row.volume.chapters.length} ch.</span>
						</button>
					{:else}
						<button
							type="button"
							class={[
								'chapter-btn',
								{ pressed: chapterPressedId === `${row.volume.id}:${row.chapter.id}` }
							]}
							disabled={openingId != null || manualProgressId != null}
							aria-busy={
								openingId === `${row.volume.id}:${row.chapter.id}` ||
								manualProgressId === `${row.volume.id}:${row.chapter.id}`
							}
							onpointerdown={(event) => handleChapterPointerDown(event, row.volume.id, row.chapter.id)}
							onpointerup={handlePressUp}
							onpointercancel={handlePressUp}
							oncontextmenu={(event) =>
								openChapterContextMenu(
									event,
									row.entry.mangaName,
									row.volume.id,
									row.chapter.id,
									row.chapter.number
								)}
							onclick={() => openChapter(row.volume.id, row.chapter.id)}
						>
							<span class="chapter-label">
								<span class={['chapter-name', { next: row.isNextChapter }]}>{row.chapter.name}</span>
								<ArrowRight class="chapter-arrow" size={13} aria-hidden="true" />
							</span>
							<span class="chapter-meta">Ch. {row.chapter.number}</span>
						</button>
					{/if}
				</div>
			{/each}
			</div>
			</section>
		{/if}
		{/if}
	</div>

	{#if matchingManga}
		{@const meta = seriesByName.get(matchingManga)}
		<AniListMatchModal
			mangaName={matchingManga}
			aniListId={meta?.aniListId}
			aniListTitle={meta?.aniListTitle}
			onconfirm={confirmMatch}
			onclose={closeMatchModal}
		/>
	{/if}

	{#if libraryEditOpen}
		<LibraryEditModal
			series={series.map((entry) => ({
				mangaName: entry.mangaName,
				volumeCount: entry.volumes.length
			}))}
			{importing}
			{importError}
			onimportbrowse={handleImportBrowse}
			onsave={handleLibraryEditSave}
			onclose={closeLibraryEdit}
		/>
	{/if}

	{#if searchOpen}
		<SearchModal
			results={searchResults}
			{openingId}
			onselect={(result) =>
				openChapter(result.volumeId, result.chapterId, result.pageIndex ?? 0)}
			onclose={closeSearch}
		/>
	{/if}

	{#if chapterContextMenu}
		<div
			class="chapter-context-menu"
			style={`left: ${chapterContextMenu.x}px; top: ${chapterContextMenu.y}px;`}
			role="menu"
			aria-label="Chapter progress actions"
			tabindex="-1"
		>
			<button type="button" role="menuitem" onclick={() => markChapterCurrent(false)}>
				Mark as current locally
			</button>
			<button type="button" role="menuitem" onclick={() => markChapterCurrent(true)}>
				Mark as current and sync to AniList
			</button>
		</div>
	{/if}

	{#if hoveredCover}
		{#key hoveredCover.mangaName}
			<div
				class="cover-preview"
				style={`left: ${hoveredCover.x}px; top: ${hoveredCover.y}px;`}
				aria-hidden="true"
			>
				<img src={hoveredCover.url} alt="" />
			</div>
		{/key}
	{/if}
</main>

<style>
	.home {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--layout-padding-inline);
	}

	.home.empty {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		padding: 0;
	}

	.content {
		width: min(var(--layout-max-width), 100%);
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.content.empty {
		flex: 1;
		width: 100%;
		min-height: 0;
		gap: 0;
		display: flex;
		flex-direction: column;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		height: 100%;
		width: 100%;
	}

	.empty-top,
	.empty-bottom {
		flex: 1;
		min-height: 0;
	}

	.empty-middle {
		flex: 0 0 auto;
	}

	.empty-bottom {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		padding: 1.25rem 2rem 0;
	}

	.empty-bottom::before {
		content: '';
		width: min(200px, 100%);
		height: 1px;
		background: #2a2a32;
		margin-bottom: 1.25rem;
		opacity: 0;
		animation: library-enter 0.45s cubic-bezier(0.33, 1, 0.68, 1) forwards;
		animation-delay: 120ms;
	}

	.empty-bottom .import-hint {
		opacity: 0;
		animation: library-enter 0.45s cubic-bezier(0.33, 1, 0.68, 1) forwards;
		animation-delay: 140ms;
	}

	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		text-align: center;
	}

	.hero-logo {
		margin: 0;
		font-family:
			'Helvetica Neue',
			Helvetica,
			Arial,
			sans-serif;
		font-size: clamp(3rem, 10vw, 4.5rem);
		font-weight: 700;
		letter-spacing: -0.04em;
		line-height: 1;
		color: #8a7ff0;
		user-select: none;
		cursor: pointer;
		opacity: 0;
		scale: 1;
		animation: hero-logo-enter 0.45s cubic-bezier(0.33, 1, 0.68, 1) forwards;
		animation-delay: 40ms;
		transition: scale 120ms cubic-bezier(0.33, 1, 0.68, 1);
	}

	.hero-logo.pressed {
		scale: 0.94;
	}

	@keyframes hero-logo-enter {
		from {
			opacity: 0;
			translate: 0 14px;
		}

		to {
			opacity: 1;
			translate: 0 0;
		}
	}

	.hero-tagline {
		position: relative;
		display: inline-block;
		margin: 0;
		font-size: 1rem;
		color: #9a9aa3;
		user-select: none;
		opacity: 0;
		animation: library-enter 0.45s cubic-bezier(0.33, 1, 0.68, 1) forwards;
		animation-delay: 90ms;
		transition: color 150ms ease;
	}

	.hero-tagline::after {
		content: '';
		position: absolute;
		left: 0;
		bottom: -0.15em;
		width: 0;
		height: 1px;
		background: #b8b8c0;
		transition: width 200ms cubic-bezier(0.33, 1, 0.68, 1);
	}

	.hero-tagline:hover {
		color: #b8b8c0;
	}

	.hero-tagline:hover::after {
		width: 100%;
	}

	.drag-overlay {
		position: fixed;
		inset: 0;
		z-index: 15;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(13, 13, 15, 0.88);
		border: 3px dashed #8a7ff0;
		pointer-events: none;
	}

	.drag-overlay-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		text-align: center;
		color: #c9c4f7;
		padding: 2rem;
	}

	.drag-icon {
		width: 3.5rem;
		height: 3.5rem;
		opacity: 0.9;
	}

	.drag-title {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 600;
		color: #e8e8ea;
	}

	.drag-hint {
		margin: 0;
		font-size: 0.95rem;
		color: #9a9aa3;
	}

	.library {
		padding-top: 6rem;
	}

	.library-heading-row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		user-select: none;
	}

	@keyframes library-enter {
		from {
			opacity: 0;
			transform: translateY(14px);
		}

		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.library-heading {
		margin: 0;
		font-size: 2rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #e8e8ea;
	}

	.library-edit-btn {
		all: unset;
		font-size: 0.65rem;
		font-weight: 500;
		color: #6a6a72;
		cursor: pointer;
		transition:
			color 150ms ease,
			opacity 150ms ease;
	}

	@media (hover: hover) and (pointer: fine) {
		.library-edit-btn {
			opacity: 0;
			pointer-events: none;
		}

		.library-heading-row:hover .library-edit-btn,
		.library-heading-row:focus-within .library-edit-btn,
		.library-edit-btn:focus-visible {
			opacity: 1;
			pointer-events: auto;
		}
	}

	.library-edit-btn:hover {
		color: #9a9aa3;
	}

	.library-error {
		margin: 0 0 1rem;
		color: #f0867f;
		white-space: pre-line;
	}

	.cover-preview {
		position: fixed;
		z-index: 20;
		width: 128px;
		aspect-ratio: 2 / 3;
		padding: 4px;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 7px;
		background: rgba(13, 13, 15, 0.92);
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
		pointer-events: none;
		transform: translate(-50%, calc(-100% - 14px));
		animation: cover-preview-in 100ms cubic-bezier(0.33, 1, 0.68, 1) 300ms both;
	}

	.cover-preview img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 4px;
		background: #0d0d0f;
	}

	@keyframes cover-preview-in {
		from {
			opacity: 0;
			transform: translate(-50%, calc(-100% - 8px)) scale(0.98);
		}

		to {
			opacity: 1;
			transform: translate(-50%, calc(-100% - 14px)) scale(1);
		}
	}

	.chapter-context-menu {
		position: fixed;
		z-index: 25;
		width: max-content;
		min-width: 240px;
		padding: 0.25rem;
		border: 1px solid rgba(255, 255, 255, 0.13);
		border-radius: 7px;
		background: rgba(18, 18, 22, 0.98);
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
		animation: context-menu-in 90ms cubic-bezier(0.33, 1, 0.68, 1) both;
	}

	.chapter-context-menu button {
		all: unset;
		box-sizing: border-box;
		display: block;
		width: 100%;
		padding: 0.48rem 0.625rem;
		border-radius: 5px;
		color: #d8d8de;
		font-size: 0.78rem;
		line-height: 1.2;
		white-space: nowrap;
		cursor: pointer;
	}

	.chapter-context-menu button:hover,
	.chapter-context-menu button:focus-visible {
		background: rgba(138, 127, 240, 0.16);
		color: #f0efff;
	}

	@keyframes context-menu-in {
		from {
			opacity: 0;
			transform: translateY(-3px) scale(0.98);
		}

		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.hero-tagline code,
	.drag-hint code {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.875em;
		background: rgba(255, 255, 255, 0.08);
		padding: 0.1em 0.4em;
		border-radius: 0.35em;
	}

	.library-list {
		display: flex;
		flex-direction: column;
	}

	.row {
		display: flex;
		align-items: center;
		border-radius: 7px;
		min-height: 36px;
	}

	.row.striped {
		background: rgba(255, 255, 255, 0.02);
	}

	.row.past {
		color: #74747e;
	}

	.row.past .row-toggle,
	.row.past .chapter-btn {
		color: inherit;
	}

	.row.past .volume-title,
	.row.past .chapter-name,
	.row.past .chapter-meta,
	.row.past .chevron,
	.row.past :global(.chapter-arrow) {
		color: currentColor;
	}

	.row.past .badge {
		background: rgba(255, 255, 255, 0.05);
		color: #74747e;
	}

	.row.past .chapter-btn:hover:not(:disabled) {
		color: #9a9aa3;
	}

	.row-manga {
		gap: 0.25rem;
		padding-right: 0.75rem;
		cursor: pointer;
	}

	.home.settled .empty-bottom::before,
	.home.settled .empty-bottom .import-hint,
	.home.settled .hero-logo,
	.home.settled .hero-tagline {
		opacity: 1;
		animation: none;
		transform: none;
		translate: 0 0;
	}

	.row-manga .row-toggle {
		flex: 1 1 auto;
	}

	.row-manga .manga-action-btn {
		opacity: 0;
		overflow: hidden;
		pointer-events: none;
		transition: opacity 150ms ease;
	}

	.row-manga .anilist-btn {
		margin-left: auto;
	}

	.row-manga .continue-btn {
		margin-left: auto;
	}

	.row-manga .continue-btn + .anilist-btn {
		margin-left: 0;
	}

	@media (pointer: coarse) {
		.row-manga .manga-action-btn {
			opacity: 1;
			overflow: visible;
			pointer-events: auto;
		}
	}

	@media (hover: hover) and (pointer: fine) {
		.row-manga:hover .manga-action-btn {
			opacity: 1;
			overflow: visible;
			pointer-events: auto;
		}
	}

	.row-volume .row-toggle {
		padding-left: 1.75rem;
	}

	.row-chapter .chapter-btn {
		padding-left: 3.5rem;
	}

	.row-toggle {
		all: unset;
		box-sizing: border-box;
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.55rem 0.75rem;
		cursor: pointer;
	}

	.chapter-btn {
		all: unset;
		box-sizing: border-box;
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.75rem;
		cursor: pointer;
		transition: color 150ms ease;
	}

	.chapter-btn:hover:not(:disabled) {
		color: #c9c4f7;
	}

	.chapter-btn:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.row-text {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.file-input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.import-hint-wrap {
		display: contents;
	}

	.import-hint {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0;
		border: none;
		background: transparent;
		font-size: 0.8rem;
		color: #6a6a72;
		font-family: inherit;
		cursor: pointer;
		user-select: none;
	}

	.empty-bottom .import-hint {
		align-items: center;
		text-align: center;
	}

	.library .import-hint {
		align-items: flex-start;
		text-align: left;
		margin-top: 1rem;
	}

	.import-hint-click {
		position: relative;
		display: inline-block;
	}

	.import-hint-click::after {
		content: '';
		position: absolute;
		left: 0;
		bottom: -0.1em;
		width: 0;
		height: 1px;
		background: currentColor;
		transition: width 200ms cubic-bezier(0.33, 1, 0.68, 1);
	}

	.import-hint:hover:not(.disabled) .import-hint-click::after {
		width: 100%;
	}

	.import-hint.disabled {
		opacity: 0.5;
		cursor: wait;
		pointer-events: none;
	}

	.import-error {
		color: #f0867f;
		font-size: 0.75rem;
		white-space: pre-line;
	}

	.manga-action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: #9a9aa3;
		cursor: pointer;
		transition:
			background-color 150ms ease,
			color 150ms ease;
	}

	.manga-action-btn:hover:not(:disabled) {
		background: rgba(138, 127, 240, 0.15);
		color: #c9c4f7;
	}

	.manga-action-btn:disabled {
		cursor: default;
	}

	.continue-btn {
		width: auto;
		height: auto;
		min-height: 1.45rem;
		padding: 0.14rem 0.55rem 0.16rem;
		border: 1px solid rgba(165, 157, 255, 0.34);
		border-radius: 999px;
		background: rgba(138, 127, 240, 0.08);
		color: #c9c4f7;
		font-family: inherit;
		font-size: 0.74rem;
		font-weight: 400;
		white-space: nowrap;
	}

	.continue-btn:hover:not(:disabled) {
		/* border-color: rgba(201, 196, 247, 0.58); */
		background: rgba(138, 127, 240, 0.16);
	}

	.anilist-btn.matched {
		color: #8a7ff0;
	}

	.series-title {
		flex: 0 1 auto;
		font-size: 0.9rem;
		font-weight: 500;
		color: #d8d8de;
	}

	.volume-title {
		font-size: 0.9rem;
		font-weight: 500;
		color: #d8d8de;
	}

	.badge {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-weight: 500;
		color: #8a7ff0;
		background: rgba(138, 127, 240, 0.12);
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		cursor: pointer;
		user-select: none;
	}

	.chevron {
		flex-shrink: 0;
		width: 1rem;
		height: 1rem;
		color: #9a9aa3;
		transition: transform 150ms ease;
	}

	.chevron.open {
		transform: rotate(90deg);
	}

	.volume-title.next,
	.chapter-name.next {
		color: #8a7ff0;
	}

	.chapter-label {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		flex: 1;
		min-width: 0;
		scale: 1;
		transform-origin: left center;
		transition: scale 120ms cubic-bezier(0.33, 1, 0.68, 1);
	}

	.chapter-btn.pressed .chapter-label {
		scale: 0.94;
	}

	.chapter-name {
		flex: 0 1 auto;
		min-width: 0;
		font-size: 0.9rem;
		color: #d8d8de;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chapter-btn :global(.chapter-arrow) {
		flex-shrink: 0;
		color: #8a7ff0;
		opacity: 0;
		transform: translateX(-5px);
		transition:
			opacity 180ms ease,
			transform 180ms ease;
	}

	.chapter-btn:hover:not(:disabled) :global(.chapter-arrow) {
		opacity: 1;
		transform: translateX(0);
	}

	.chapter-meta {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: #9a9aa3;
		font-variant-numeric: tabular-nums;
	}
</style>
