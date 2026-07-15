const DB_NAME = 'manga-web-reader';
const VOLUMES_STORE = 'volumes';
const SERIES_STORE = 'series';
const SETTINGS_STORE = 'settings';
const SERIES_COVERS_STORE = 'seriesCovers';
const PROGRESS_STORE = 'progress';
const SERIES_ORDER_KEY = 'seriesOrder';
const STORAGE_MODE_KEY = 'storageMode';
const READING_DIRECTION_KEY = 'readingDirection';
const SCALE_ALGORITHM_KEY = 'scaleAlgorithm';
const DB_VERSION = 5;
/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

export const STORAGE_MODES = {
	FILE_SYSTEM: 'file-system',
	INDEXED_DB: 'indexed-db'
};

export const READING_DIRECTIONS = {
	LEFT_TO_RIGHT: 'left-to-right',
	RIGHT_TO_LEFT: 'right-to-left'
};

export const SCALE_ALGORITHMS = {
	MITCHELL: 'mitchell-linear-light',
	LANCZOS: 'lanczos',
	BROWSER: 'browser'
};

/**
 * @typedef {Object} StoredChapter
 * @property {string} id
 * @property {number} number
 * @property {string} name
 * @property {string[]} pages
 */

/**
 * @typedef {Object} StoredVolume
 * @property {string} id
 * @property {string} fileName
 * @property {string} mangaName
 * @property {number | null} volumeNumber
 * @property {number} importedAt
 * @property {'file-system' | 'indexed-db'} [storageMode]
 * @property {StoredChapter[]} chapters
 * @property {Blob} [blob]
 * @property {FileSystemFileHandle} [fileHandle]
 */

/**
 * @typedef {Object} StoredSeries
 * @property {string} mangaName
 * @property {number} aniListId
 * @property {string | null} [aniListTitle]
 */

/**
 * @typedef {Object} StoredProgress
 * @property {string} mangaName
 * @property {string} volumeId
 * @property {string} chapterId
 * @property {number} pageIndex
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} StoredSeriesCover
 * @property {string} mangaName
 * @property {Blob} blob
 * @property {'local' | 'anilist'} source
 * @property {number} updatedAt
 */

/** @returns {Promise<IDBDatabase>} */
function openDb() {
	if (dbPromise) return dbPromise;

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = (event) => {
			const db = request.result;
			const oldVersion = event.oldVersion;

			if (oldVersion < 1) {
				db.createObjectStore(VOLUMES_STORE, { keyPath: 'id' });
			}

			if (oldVersion < 2) {
				db.createObjectStore(SERIES_STORE, { keyPath: 'mangaName' });
			}

			if (oldVersion < 3) {
				db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
			}

			if (oldVersion < 4) {
				db.createObjectStore(SERIES_COVERS_STORE, { keyPath: 'mangaName' });
			}

			if (oldVersion < 5) {
				db.createObjectStore(PROGRESS_STORE, { keyPath: 'mangaName' });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => {
			dbPromise = null;
			reject(request.error);
		};
	});

	return dbPromise;
}

/**
 * @param {StoredVolume} volume
 */
export async function saveVolume(volume) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(VOLUMES_STORE, 'readwrite');
		tx.objectStore(VOLUMES_STORE).put(volume);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * @param {StoredSeriesCover} cover
 */
export async function saveSeriesCover(cover) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SERIES_COVERS_STORE, 'readwrite');
		tx.objectStore(SERIES_COVERS_STORE).put({
			...cover,
			mangaName: normalizeMangaName(cover.mangaName)
		});
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * @param {string} mangaName
 * @returns {Promise<StoredSeriesCover | undefined>}
 */
export async function getSeriesCover(mangaName) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SERIES_COVERS_STORE, 'readonly');
		const request = tx.objectStore(SERIES_COVERS_STORE).get(normalizeMangaName(mangaName));
		request.onsuccess = () =>
			resolve(/** @type {StoredSeriesCover | undefined} */ (request.result));
		request.onerror = () => reject(request.error);
	});
}

/** @returns {Promise<StoredSeriesCover[]>} */
export async function listSeriesCovers() {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SERIES_COVERS_STORE, 'readonly');
		const request = tx.objectStore(SERIES_COVERS_STORE).getAll();
		request.onsuccess = () => resolve(/** @type {StoredSeriesCover[]} */ (request.result));
		request.onerror = () => reject(request.error);
	});
}

/**
 * @param {string} mangaName
 * @param {string} url
 */
export async function saveAniListCover(mangaName, url) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error('Failed to download the AniList cover.');
	}

	const blob = await response.blob();
	await saveSeriesCover({
		mangaName,
		blob,
		source: 'anilist',
		updatedAt: Date.now()
	});
}

/**
 * @param {StoredSeries} series
 */
export async function saveSeries(series) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SERIES_STORE, 'readwrite');
		tx.objectStore(SERIES_STORE).put({
			...series,
			mangaName: normalizeMangaName(series.mangaName)
		});
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/** @param {string} mangaName @returns {Promise<StoredSeries | undefined>} */
export async function getSeries(mangaName) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SERIES_STORE, 'readonly');
		const request = tx.objectStore(SERIES_STORE).get(normalizeMangaName(mangaName));
		request.onsuccess = () =>
			resolve(/** @type {StoredSeries | undefined} */ (request.result));
		request.onerror = () => reject(request.error);
	});
}

/** @returns {Promise<StoredSeries[]>} */
export async function listSeries() {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SERIES_STORE, 'readonly');
		const request = tx.objectStore(SERIES_STORE).getAll();
		request.onsuccess = () => resolve(/** @type {StoredSeries[]} */ (request.result));
		request.onerror = () => reject(request.error);
	});
}

/** @returns {Promise<StoredVolume[]>} */
export async function listVolumes() {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(VOLUMES_STORE, 'readonly');
		const request = tx.objectStore(VOLUMES_STORE).getAll();
		request.onsuccess = () => {
			const volumes = /** @type {StoredVolume[]} */ (request.result);
			volumes.sort((a, b) => b.importedAt - a.importedAt);
			resolve(volumes);
		};
		request.onerror = () => reject(request.error);
	});
}

/** @returns {Promise<number>} */
export async function countVolumes() {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(VOLUMES_STORE, 'readonly');
		const request = tx.objectStore(VOLUMES_STORE).count();
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** @param {string} id @returns {Promise<StoredVolume | undefined>} */
export async function getVolume(id) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(VOLUMES_STORE, 'readonly');
		const request = tx.objectStore(VOLUMES_STORE).get(id);
		request.onsuccess = () => resolve(/** @type {StoredVolume | undefined} */ (request.result));
		request.onerror = () => reject(request.error);
	});
}

/** @param {string} name */
function normalizeMangaName(name) {
	return name.trim().replace(/\s+/g, ' ');
}

/** @returns {Promise<string[]>} */
export async function getSeriesOrder() {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SETTINGS_STORE, 'readonly');
		const request = tx.objectStore(SETTINGS_STORE).get(SERIES_ORDER_KEY);
		request.onsuccess = () => {
			const result = /** @type {{ mangaNames?: string[] } | undefined} */ (request.result);
			resolve(result?.mangaNames ?? []);
		};
		request.onerror = () => reject(request.error);
	});
}

/** @param {string[]} mangaNames */
export async function saveSeriesOrder(mangaNames) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SETTINGS_STORE, 'readwrite');
		tx.objectStore(SETTINGS_STORE).put({ id: SERIES_ORDER_KEY, mangaNames });
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export function isFileSystemStorageSupported() {
	return 'showOpenFilePicker' in window && 'FileSystemFileHandle' in window;
}

/** @returns {'file-system' | 'indexed-db'} */
export function defaultStorageMode() {
	return isFileSystemStorageSupported() ? STORAGE_MODES.FILE_SYSTEM : STORAGE_MODES.INDEXED_DB;
}

/** @returns {Promise<'file-system' | 'indexed-db'>} */
export async function getStorageMode() {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SETTINGS_STORE, 'readonly');
		const request = tx.objectStore(SETTINGS_STORE).get(STORAGE_MODE_KEY);
		request.onsuccess = () => {
			const result = /** @type {{ value?: 'file-system' | 'indexed-db' } | undefined} */ (request.result);
			if (result?.value === STORAGE_MODES.FILE_SYSTEM && isFileSystemStorageSupported()) {
				resolve(STORAGE_MODES.FILE_SYSTEM);
				return;
			}
			if (result?.value === STORAGE_MODES.INDEXED_DB) {
				resolve(STORAGE_MODES.INDEXED_DB);
				return;
			}
			resolve(defaultStorageMode());
		};
		request.onerror = () => reject(request.error);
	});
}

/** @param {'file-system' | 'indexed-db'} mode */
export async function saveStorageMode(mode) {
	const nextMode =
		mode === STORAGE_MODES.FILE_SYSTEM && !isFileSystemStorageSupported()
			? STORAGE_MODES.INDEXED_DB
			: mode;
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SETTINGS_STORE, 'readwrite');
		tx.objectStore(SETTINGS_STORE).put({ id: STORAGE_MODE_KEY, value: nextMode });
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/** @returns {'left-to-right' | 'right-to-left'} */
export function defaultReadingDirection() {
	return READING_DIRECTIONS.LEFT_TO_RIGHT;
}

/** @returns {Promise<'left-to-right' | 'right-to-left'>} */
export async function getReadingDirection() {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SETTINGS_STORE, 'readonly');
		const request = tx.objectStore(SETTINGS_STORE).get(READING_DIRECTION_KEY);
		request.onsuccess = () => {
			const result = /** @type {{ value?: 'left-to-right' | 'right-to-left' } | undefined} */ (
				request.result
			);
			if (result?.value === READING_DIRECTIONS.RIGHT_TO_LEFT) {
				resolve(READING_DIRECTIONS.RIGHT_TO_LEFT);
				return;
			}
			resolve(defaultReadingDirection());
		};
		request.onerror = () => reject(request.error);
	});
}

/** @param {'left-to-right' | 'right-to-left'} direction */
export async function saveReadingDirection(direction) {
	const nextDirection =
		direction === READING_DIRECTIONS.RIGHT_TO_LEFT
			? READING_DIRECTIONS.RIGHT_TO_LEFT
			: READING_DIRECTIONS.LEFT_TO_RIGHT;
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SETTINGS_STORE, 'readwrite');
		tx.objectStore(SETTINGS_STORE).put({ id: READING_DIRECTION_KEY, value: nextDirection });
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * Returns the saved algorithm when it is still supported, otherwise selects and
 * persists the best currently available implementation.
 * @param {{ mitchell: boolean, lanczos: boolean, browser: boolean }} capabilities
 * @returns {Promise<'mitchell-linear-light' | 'lanczos' | 'browser'>}
 */
export async function getScaleAlgorithm(capabilities) {
	const db = await openDb();
	const saved = await new Promise((resolve, reject) => {
		const tx = db.transaction(SETTINGS_STORE, 'readonly');
		const request = tx.objectStore(SETTINGS_STORE).get(SCALE_ALGORITHM_KEY);
		request.onsuccess = () => resolve(request.result?.value);
		request.onerror = () => reject(request.error);
	});

	const savedIsSupported =
		(saved === SCALE_ALGORITHMS.MITCHELL && capabilities.mitchell) ||
		(saved === SCALE_ALGORITHMS.LANCZOS && capabilities.lanczos) ||
		(saved === SCALE_ALGORITHMS.BROWSER && capabilities.browser);
	if (savedIsSupported) return saved;

	const best = capabilities.mitchell
		? SCALE_ALGORITHMS.MITCHELL
		: capabilities.lanczos
			? SCALE_ALGORITHMS.LANCZOS
			: SCALE_ALGORITHMS.BROWSER;
	await saveScaleAlgorithm(best);
	return best;
}

/** @param {'mitchell-linear-light' | 'lanczos' | 'browser'} algorithm */
export async function saveScaleAlgorithm(algorithm) {
	const value = Object.values(SCALE_ALGORITHMS).includes(algorithm)
		? algorithm
		: SCALE_ALGORITHMS.BROWSER;
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SETTINGS_STORE, 'readwrite');
		tx.objectStore(SETTINGS_STORE).put({ id: SCALE_ALGORITHM_KEY, value });
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * @param {StoredProgress} progress
 */
export async function saveProgress(progress) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(PROGRESS_STORE, 'readwrite');
		tx.objectStore(PROGRESS_STORE).put({
			...progress,
			mangaName: normalizeMangaName(progress.mangaName)
		});
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * @param {string} mangaName
 * @returns {Promise<StoredProgress | undefined>}
 */
export async function getProgress(mangaName) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(PROGRESS_STORE, 'readonly');
		const request = tx.objectStore(PROGRESS_STORE).get(normalizeMangaName(mangaName));
		request.onsuccess = () => resolve(/** @type {StoredProgress | undefined} */ (request.result));
		request.onerror = () => reject(request.error);
	});
}

/** @returns {Promise<StoredProgress[]>} */
export async function listProgress() {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(PROGRESS_STORE, 'readonly');
		const request = tx.objectStore(PROGRESS_STORE).getAll();
		request.onsuccess = () => resolve(/** @type {StoredProgress[]} */ (request.result));
		request.onerror = () => reject(request.error);
	});
}

/** @param {string} mangaName */
export async function deleteSeries(mangaName) {
	const target = normalizeMangaName(mangaName);
	const volumes = await listVolumes();
	const toDelete = volumes.filter((volume) => normalizeMangaName(volume.mangaName) === target);

	const db = await openDb();
	await new Promise((resolve, reject) => {
		const tx = db.transaction(
			[VOLUMES_STORE, SERIES_STORE, SERIES_COVERS_STORE, PROGRESS_STORE],
			'readwrite'
		);
		for (const volume of toDelete) {
			tx.objectStore(VOLUMES_STORE).delete(volume.id);
		}
		tx.objectStore(SERIES_STORE).delete(target);
		tx.objectStore(SERIES_COVERS_STORE).delete(target);
		tx.objectStore(PROGRESS_STORE).delete(target);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * @param {{ order: string[], deleted: string[] }} edits
 */
export async function applyLibraryEdits({ order, deleted }) {
	for (const mangaName of deleted) {
		await deleteSeries(mangaName);
	}
	await saveSeriesOrder(order);
}
