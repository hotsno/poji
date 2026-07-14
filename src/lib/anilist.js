import { getAccessToken } from './anilist-auth.js';
import { anilistFetch } from './anilist-fetch.js';

/**
 * @typedef {{ id: number, title: { romaji: string | null, english: string | null, native: string | null }, coverImage: { extraLarge: string | null, large: string | null, medium: string | null } }} AniListMedia
 */

/**
 * @param {string} query
 * @returns {Promise<AniListMedia[]>}
 */
export async function searchManga(query) {
	const trimmed = query.trim();
	if (!trimmed) return [];

	const response = await anilistFetch(
		'searchManga',
		{
			query: `
				query ($search: String) {
					Page(page: 1, perPage: 20) {
						media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
							id
							title { romaji english native }
							coverImage { extraLarge large medium }
						}
					}
				}
			`,
			variables: { search: trimmed }
		}
	);

	if (!response.ok) {
		throw new Error('AniList search failed. Try again in a moment.');
	}

	const json = await response.json();
	if (json.errors?.length) {
		throw new Error(json.errors[0]?.message ?? 'AniList search failed.');
	}

	return json.data?.Page?.media ?? [];
}

/**
 * @param {AniListMedia['title']} title
 * @returns {string}
 */
export function formatMediaTitle(title) {
	return title.english ?? title.romaji ?? title.native ?? 'Unknown';
}

/**
 * Fetches chapter progress from the user's AniList list for the given manga IDs.
 *
 * @param {number[]} mediaIds
 * @returns {Promise<Map<number, number>>} AniList media ID → chapter progress.
 */
export async function getMangaProgress(mediaIds) {
	const token = getAccessToken();
	if (!token || mediaIds.length === 0) return new Map();

	const uniqueIds = [...new Set(mediaIds)];
	/** @type {Map<number, number>} */
	const progressById = new Map();

	for (let offset = 0; offset < uniqueIds.length; offset += 50) {
		const chunk = uniqueIds.slice(offset, offset + 50);
		const response = await anilistFetch(
			'getMangaProgress',
			{
				query: `
					query ($ids: [Int]) {
						Page(page: 1, perPage: 50) {
							media(id_in: $ids, type: MANGA) {
								id
								mediaListEntry { progress }
							}
						}
					}
				`,
				variables: { ids: chunk }
			},
			token
		);

		if (!response.ok) continue;

		const json = await response.json();
		if (json.errors?.length) continue;

		const media = json.data?.Page?.media ?? [];
		for (const item of media) {
			if (item.id != null && item.mediaListEntry != null) {
				progressById.set(item.id, item.mediaListEntry.progress ?? 0);
			}
		}
	}

	return progressById;
}

/**
 * Updates the user's manga progress on AniList.
 *
 * @param {number} mediaId
 * @param {number} progress Chapter number to mark as read.
 * @param {{ allowDecrease?: boolean }} [options]
 */
export async function updateMangaProgress(mediaId, progress, options) {
	const token = getAccessToken();
	if (!token) {
		throw new Error('Connect your AniList account to sync progress.');
	}

	const response = await anilistFetch(
		'updateMangaProgress.checkCurrentProgress',
		{
			query: `
				query ($mediaId: Int) {
					Media(id: $mediaId) {
						mediaListEntry { id progress }
					}
				}
			`,
			variables: { mediaId }
		},
		token
	);

	if (!response.ok) {
		throw new Error('Failed to read your AniList progress.');
	}

	const checkJson = await response.json();
	if (checkJson.errors?.length) {
		throw new Error(checkJson.errors[0]?.message ?? 'Failed to read your AniList progress.');
	}

	const entry = checkJson.data?.Media?.mediaListEntry;
	const currentProgress = entry?.progress ?? 0;

	if (!options?.allowDecrease && progress <= currentProgress) return;
	if (options?.allowDecrease && progress === currentProgress) return;

	const mutationResponse = await anilistFetch(
		'updateMangaProgress.saveProgress',
		{
			query: `
				mutation ($id: Int, $mediaId: Int, $progress: Int, $status: MediaListStatus) {
					SaveMediaListEntry(id: $id, mediaId: $mediaId, progress: $progress, status: $status) {
						id
						progress
					}
				}
			`,
			variables: {
				id: entry?.id,
				mediaId,
				progress,
				status: 'CURRENT'
			}
		},
		token
	);

	if (!mutationResponse.ok) {
		throw new Error('Failed to update AniList progress.');
	}

	const mutationJson = await mutationResponse.json();
	if (mutationJson.errors?.length) {
		throw new Error(mutationJson.errors[0]?.message ?? 'Failed to update AniList progress.');
	}
}
