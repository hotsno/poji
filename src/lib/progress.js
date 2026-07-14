import { updateMangaProgress } from './anilist.js';
import { getProgress, getSeries, listVolumes, saveProgress } from './library.js';

/**
 * @param {string} name
 */
export function normalizeMangaName(name) {
	return name.trim().replace(/\s+/g, ' ');
}

/**
 * @param {import('./library.js').StoredVolume[]} volumes
 * @param {string} mangaName
 */
export function volumesForSeries(volumes, mangaName) {
	const target = normalizeMangaName(mangaName);
	return volumes.filter((v) => normalizeMangaName(v.mangaName) === target);
}

/**
 * @param {import('./library.js').StoredVolume} volume
 */
function chaptersInOrder(volume) {
	return [...(volume.chapters ?? [])].sort((a, b) => {
		if (a.number != null && b.number != null) {
			return a.number - b.number;
		}
		return a.id.localeCompare(b.id);
	});
}

/**
 * @param {import('./library.js').StoredVolume[]} volumes
 */
export function sortVolumes(volumes) {
	return [...volumes].sort((a, b) => {
		if (a.volumeNumber != null && b.volumeNumber != null) {
			return a.volumeNumber - b.volumeNumber;
		}
		if (a.volumeNumber != null) return -1;
		if (b.volumeNumber != null) return 1;
		return a.importedAt - b.importedAt;
	});
}

/**
 * @param {import('./library.js').StoredVolume[]} volumes
 * @param {string} volumeId
 * @param {string} chapterId
 * @returns {number | null}
 */
function chapterNumberFor(volumes, volumeId, chapterId) {
	for (const volume of volumes) {
		if (volume.id !== volumeId) continue;
		const chapter = chaptersInOrder(volume).find((entry) => entry.id === chapterId);
		return chapter?.number ?? null;
	}
	return null;
}

/**
 * Locates the chapter immediately before the given one in reading order.
 *
 * @param {import('./library.js').StoredVolume[]} volumes
 * @param {string} volumeId
 * @param {string} chapterId
 * @returns {{ volumeId: string, chapterId: string } | null}
 */
export function findPrecedingChapter(volumes, volumeId, chapterId) {
	const sorted = sortVolumes(volumes);
	/** @type {{ volumeId: string, chapterId: string } | null} */
	let previous = null;

	for (const volume of sorted) {
		for (const chapter of chaptersInOrder(volume)) {
			if (volume.id === volumeId && chapter.id === chapterId) {
				return previous;
			}
			previous = { volumeId: volume.id, chapterId: chapter.id };
		}
	}

	return null;
}

/**
 * Locates the chapter immediately after the given one in reading order.
 *
 * @param {import('./library.js').StoredVolume[]} volumes
 * @param {string} volumeId
 * @param {string} chapterId
 * @returns {{ volumeId: string, chapterId: string } | null}
 */
export function findFollowingChapter(volumes, volumeId, chapterId) {
	const sorted = sortVolumes(volumes);
	let found = false;

	for (const volume of sorted) {
		for (const chapter of chaptersInOrder(volume)) {
			if (found) {
				return { volumeId: volume.id, chapterId: chapter.id };
			}
			if (volume.id === volumeId && chapter.id === chapterId) {
				found = true;
			}
		}
	}

	return null;
}

/**
 * Locates the next unread chapter after the given AniList chapter progress.
 *
 * @param {import('./library.js').StoredVolume[]} volumes
 * @param {number} progress Chapters already read on AniList.
 * @returns {{ volumeId: string, chapterId: string } | null}
 */
export function findNextChapter(volumes, progress) {
	const targetNumber = progress + 1;
	if (targetNumber <= 0) return null;

	const sorted = sortVolumes(volumes);

	for (const volume of sorted) {
		for (const chapter of chaptersInOrder(volume)) {
			if (chapter.number === targetNumber) {
				return { volumeId: volume.id, chapterId: chapter.id };
			}
		}
	}

	return null;
}

/**
 * @param {import('./library.js').StoredVolume[]} volumes
 * @param {{ volumeId: string, chapterId: string }} location
 * @returns {number}
 */
function locationIndex(volumes, location) {
	let index = 0;

	for (const volume of sortVolumes(volumes)) {
		for (const chapter of chaptersInOrder(volume)) {
			if (volume.id === location.volumeId && chapter.id === location.chapterId) {
				return index;
			}
			index++;
		}
	}

	return -1;
}

/**
 * Locates the first chapter in reading order.
 *
 * @param {import('./library.js').StoredVolume[]} volumes
 * @returns {{ volumeId: string, chapterId: string } | null}
 */
export function findFirstChapter(volumes) {
	const sorted = sortVolumes(volumes);

	for (const volume of sorted) {
		const chapter = chaptersInOrder(volume)[0];
		if (chapter) return { volumeId: volume.id, chapterId: chapter.id };
	}

	return null;
}

/**
 * Initializes local progress to the first chapter for a series if none exists yet.
 *
 * @param {string} mangaName
 */
export async function ensureLocalProgress(mangaName) {
	if (await getProgress(mangaName)) return;

	const volumes = await listVolumes();
	const mangaVolumes = volumesForSeries(volumes, mangaName);
	const firstChapter = findFirstChapter(mangaVolumes);
	if (!firstChapter) return;

	await saveProgress({
		mangaName,
		...firstChapter,
		pageIndex: 0,
		updatedAt: Date.now()
	});
}

/**
 * Advances local progress after the user reaches the end of a chapter.
 *
 * @param {string} mangaName
 * @param {string} volumeId
 * @param {string} chapterId
 * @param {number} completedPageIndex
 */
export async function completeLocalChapterProgress(
	mangaName,
	volumeId,
	chapterId,
	completedPageIndex
) {
	const volumes = await listVolumes();
	const mangaVolumes = volumesForSeries(volumes, mangaName);
	const following = findFollowingChapter(mangaVolumes, volumeId, chapterId);
	const nextLocation = {
		volumeId: following?.volumeId ?? volumeId,
		chapterId: following?.chapterId ?? chapterId
	};
	const current = await getProgress(mangaName);

	if (current) {
		const currentIndex = locationIndex(mangaVolumes, current);
		const nextIndex = locationIndex(mangaVolumes, nextLocation);
		if (currentIndex >= 0 && nextIndex >= 0 && nextIndex < currentIndex) return;
	}

	await saveProgress({
		mangaName,
		...nextLocation,
		pageIndex: following ? 0 : completedPageIndex,
		updatedAt: Date.now()
	});
}

/**
 * Stores the current page for the active local progress chapter.
 *
 * @param {string} mangaName
 * @param {string} volumeId
 * @param {string} chapterId
 * @param {number} pageIndex
 */
export async function updateLocalPageProgress(mangaName, volumeId, chapterId, pageIndex) {
	const current = await getProgress(mangaName);
	if (!current || current.volumeId !== volumeId || current.chapterId !== chapterId) return;

	await saveProgress({
		...current,
		pageIndex,
		updatedAt: Date.now()
	});
}

/**
 * Sets local progress to the selected current chapter.
 *
 * @param {string} mangaName
 * @param {string} volumeId
 * @param {string} chapterId
 * @returns {Promise<import('./library.js').StoredProgress>}
 */
export async function markChapterCurrentLocally(mangaName, volumeId, chapterId) {
	const progress = {
		mangaName,
		volumeId,
		chapterId,
		pageIndex: 0,
		updatedAt: Date.now()
	};
	await saveProgress(progress);
	return progress;
}

/**
 * Advances local progress from AniList when AniList points to a later next chapter.
 *
 * @param {string} mangaName
 * @param {import('./library.js').StoredVolume[]} volumes
 * @param {number} aniListProgress Chapters already read on AniList.
 * @returns {Promise<import('./library.js').StoredProgress | null>}
 */
export async function advanceLocalProgressFromAniList(mangaName, volumes, aniListProgress) {
	const target = findNextChapter(volumes, aniListProgress);
	if (!target) return null;

	const current = await getProgress(mangaName);
	if (current) {
		const currentIndex = locationIndex(volumes, current);
		const targetIndex = locationIndex(volumes, target);
		if (currentIndex >= 0 && targetIndex >= 0 && targetIndex <= currentIndex) return null;
	}

	const progress = {
		mangaName,
		...target,
		pageIndex: 0,
		updatedAt: Date.now()
	};
	await saveProgress(progress);
	return progress;
}

/**
 * Syncs chapter completion to AniList when the series is matched and the user is authenticated.
 *
 * @param {string} mangaName
 * @param {string} volumeId
 * @param {string} chapterId
 */
export async function syncChapterProgress(mangaName, volumeId, chapterId) {
	const series = await getSeries(mangaName);
	if (!series?.aniListId) return;

	const volumes = await listVolumes();
	const mangaVolumes = volumesForSeries(volumes, mangaName);
	const progress = chapterNumberFor(mangaVolumes, volumeId, chapterId);
	if (progress == null) return;

	await updateMangaProgress(series.aniListId, progress);
}

/**
 * Syncs the selected current chapter to AniList by marking the previous chapter read.
 *
 * @param {string} mangaName
 * @param {string} volumeId
 * @param {string} chapterId
 */
export async function syncCurrentChapterProgress(mangaName, volumeId, chapterId) {
	const series = await getSeries(mangaName);
	if (!series?.aniListId) {
		throw new Error('Match this series to AniList before syncing progress.');
	}

	const volumes = await listVolumes();
	const mangaVolumes = volumesForSeries(volumes, mangaName);
	const chapterNumber = chapterNumberFor(mangaVolumes, volumeId, chapterId);
	if (chapterNumber == null) {
		throw new Error('This chapter does not have a chapter number to sync.');
	}

	await updateMangaProgress(series.aniListId, Math.max(0, chapterNumber - 1), {
		allowDecrease: true
	});
}
