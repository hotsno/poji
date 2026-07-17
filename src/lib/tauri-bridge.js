import { getSeriesCover, saveSeriesCover } from './library.js';

const MAX_COVER_BYTES = 5 * 1024 * 1024;

function nativeInvoke() {
	return window.__TAURI__?.core?.invoke;
}

/**
 * Synchronizes the open reader with the native Poji wrapper. This is a no-op
 * when the site is running in a normal browser.
 *
 * @param {{ mangaName: string, chapterLabel: string } | null} book
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function updateNativeReader(book, { signal } = {}) {
	const invoke = nativeInvoke();
	if (!invoke || signal?.aborted) return;

	if (!book) {
		await invoke('set_reader_state', { state: null });
		return;
	}

	const storedCover = await getSeriesCover(book.mangaName);
	if (signal?.aborted) return;

	let coverMime = null;
	let coverBytes = null;
	if (storedCover?.blob && storedCover.blob.size <= MAX_COVER_BYTES) {
		coverMime = storedCover.blob.type || 'application/octet-stream';
		coverBytes = Array.from(new Uint8Array(await storedCover.blob.arrayBuffer()));
	}

	if (signal?.aborted) return;
	const imgurUrl = await invoke('set_reader_state', {
		state: {
			mangaName: book.mangaName,
			chapterLabel: book.chapterLabel,
			coverUrl: storedCover?.imgurUrl ?? null,
			coverMime,
			coverBytes
		}
	});

	if (storedCover && imgurUrl && imgurUrl !== storedCover.imgurUrl) {
		const latestCover = await getSeriesCover(book.mangaName);
		if (latestCover?.updatedAt === storedCover.updatedAt) {
			await saveSeriesCover({ ...latestCover, imgurUrl });
		}
	}
}
