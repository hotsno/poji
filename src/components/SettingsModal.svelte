<script>
	import { onMount } from 'svelte';
	import {
		ArrowLeft,
		ArrowRight,
		Check,
		Cpu,
		Database,
		FolderOpen,
		Info,
		Monitor,
		Waves,
		X
	} from 'lucide-svelte';
	import { READING_DIRECTIONS, SCALE_ALGORITHMS, STORAGE_MODES } from '../lib/library.js';
	import { closeModal } from '../lib/modal-animation.js';

	let {
		storageMode = STORAGE_MODES.FILE_SYSTEM,
		readingDirection = READING_DIRECTIONS.LEFT_TO_RIGHT,
		scaleAlgorithm = SCALE_ALGORITHMS.BROWSER,
		scalingCapabilities = { mitchell: false, lanczos: false, browser: true },
		scalingCapabilitiesReady = false,
		fileSystemStorageSupported = false,
		onstoragemodechange,
		onreadingdirectionchange,
		onscalealgorithmchange,
		onclose
	} = $props();

	let dialog = $state.raw(null);
	let closed = false;
	let modifierKeyLabel = $state('Ctrl');

	onMount(() => {
		modifierKeyLabel = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
		dialog?.showModal();
	});

	/** @param {'file-system' | 'indexed-db'} mode */
	async function setStorageMode(mode) {
		if (mode === storageMode) return;
		await onstoragemodechange?.(mode);
	}

	/** @param {'left-to-right' | 'right-to-left'} direction */
	async function setReadingDirection(direction) {
		if (direction === readingDirection) return;
		await onreadingdirectionchange?.(direction);
	}

	/** @param {'mitchell-linear-light' | 'lanczos' | 'browser'} algorithm */
	async function setScaleAlgorithm(algorithm) {
		if (algorithm === scaleAlgorithm) return;
		await onscalealgorithmchange?.(algorithm);
	}

	async function close() {
		if (closed) return;
		closed = true;
		await closeModal(dialog);
		onclose();
	}

	function handleBackdropClick(event) {
		if (event.target === dialog) {
			void close();
		}
	}

	function handleClose() {
		void close();
	}

	function handleCancel(event) {
		event.preventDefault();
		void close();
	}
</script>

<dialog class="modal" bind:this={dialog} onclick={handleBackdropClick} oncancel={handleCancel}>
	<div class="panel">
		<header class="header">
			<h2>Settings</h2>
			<button type="button" class="icon-btn" aria-label="Close" onclick={handleClose}>
				<X size={18} aria-hidden="true" />
			</button>
		</header>

		<section class="setting-group" aria-labelledby="cbz-storage-heading">
			<h3 id="cbz-storage-heading">CBZ storage</h3>
			<div class="mode-list">
				<div class="mode-row">
					<button
						type="button"
						class={['mode-btn', { active: storageMode === STORAGE_MODES.FILE_SYSTEM }]}
						aria-pressed={storageMode === STORAGE_MODES.FILE_SYSTEM}
						aria-describedby="file-system-storage-info"
						disabled={!fileSystemStorageSupported}
						onclick={() => setStorageMode(STORAGE_MODES.FILE_SYSTEM)}
					>
						<FolderOpen size={18} aria-hidden="true" />
						<span>File System</span>
						<Check size={16} class="check-icon" aria-hidden="true" />
					</button>
					<button type="button" class="info-wrap" aria-label="File System storage info">
						<Info size={15} aria-hidden="true" />
						<span id="file-system-storage-info" class="info-tip" role="tooltip">
							Uses your original CBZ file instead of saving a full browser copy.
						</span>
					</button>
				</div>
				<div class="mode-row">
					<button
						type="button"
						class={['mode-btn', { active: storageMode === STORAGE_MODES.INDEXED_DB }]}
						aria-pressed={storageMode === STORAGE_MODES.INDEXED_DB}
						aria-describedby="indexed-db-storage-info"
						onclick={() => setStorageMode(STORAGE_MODES.INDEXED_DB)}
					>
						<Database size={18} aria-hidden="true" />
						<span>IndexedDB</span>
						<Check size={16} class="check-icon" aria-hidden="true" />
					</button>
					<button type="button" class="info-wrap" aria-label="IndexedDB storage info">
						<Info size={15} aria-hidden="true" />
						<span id="indexed-db-storage-info" class="info-tip" role="tooltip">
							Saves a complete copy of each CBZ file in browser storage.
						</span>
					</button>
				</div>
			</div>
		</section>

		<div class="section-separator" aria-hidden="true"></div>

		<section class="setting-group" aria-labelledby="reader-heading">
			<h3 id="reader-heading">Reader</h3>
			<div class="setting-label">Page turning</div>
			<div class="mode-list">
				<button
					type="button"
					class={['mode-btn', { active: readingDirection === READING_DIRECTIONS.LEFT_TO_RIGHT }]}
					aria-pressed={readingDirection === READING_DIRECTIONS.LEFT_TO_RIGHT}
					onclick={() => setReadingDirection(READING_DIRECTIONS.LEFT_TO_RIGHT)}
				>
					<ArrowRight size={18} aria-hidden="true" />
					<span>Left to right</span>
					<Check size={16} class="check-icon" aria-hidden="true" />
				</button>
				<button
					type="button"
					class={['mode-btn', { active: readingDirection === READING_DIRECTIONS.RIGHT_TO_LEFT }]}
					aria-pressed={readingDirection === READING_DIRECTIONS.RIGHT_TO_LEFT}
					onclick={() => setReadingDirection(READING_DIRECTIONS.RIGHT_TO_LEFT)}
				>
					<ArrowLeft size={18} aria-hidden="true" />
					<span>Right to left</span>
					<Check size={16} class="check-icon" aria-hidden="true" />
				</button>
			</div>

			<div class="setting-label scaling-label">
				Image scaling
				{#if !scalingCapabilitiesReady}<span class="capability-status">Checking support…</span>{/if}
			</div>
			<div class="mode-list">
				<div class="mode-row">
					<button
						type="button"
						class={['mode-btn', { active: scaleAlgorithm === SCALE_ALGORITHMS.MITCHELL }]}
						aria-pressed={scaleAlgorithm === SCALE_ALGORITHMS.MITCHELL}
						aria-describedby="mitchell-scaling-info"
						disabled={!scalingCapabilitiesReady || !scalingCapabilities.mitchell}
						onclick={() => setScaleAlgorithm(SCALE_ALGORITHMS.MITCHELL)}
					>
						<Cpu size={18} aria-hidden="true" />
						<span>Mitchell + linear light</span>
						<Check size={16} class="check-icon" aria-hidden="true" />
					</button>
					<button type="button" class="info-wrap" aria-label="Mitchell scaling info">
						<Info size={15} aria-hidden="true" />
						<span id="mitchell-scaling-info" class="info-tip" role="tooltip">
							Best quality, fast (WebGPU)<br><i>Unavailable on some browsers</i>
						</span>
					</button>
				</div>
				<div class="mode-row">
					<button
						type="button"
						class={['mode-btn', { active: scaleAlgorithm === SCALE_ALGORITHMS.LANCZOS }]}
						aria-pressed={scaleAlgorithm === SCALE_ALGORITHMS.LANCZOS}
						aria-describedby="lanczos-scaling-info"
						disabled={!scalingCapabilitiesReady || !scalingCapabilities.lanczos}
						onclick={() => setScaleAlgorithm(SCALE_ALGORITHMS.LANCZOS)}
					>
						<Waves size={18} aria-hidden="true" />
						<span>Lanczos</span>
						<Check size={16} class="check-icon" aria-hidden="true" />
					</button>
					<button type="button" class="info-wrap" aria-label="Lanczos scaling info">
						<Info size={15} aria-hidden="true" />
						<span id="lanczos-scaling-info" class="info-tip" role="tooltip">
							Good quality, slow (CPU) <br><i>Unavailable on some browsers</i>
						</span>
					</button>
				</div>
				<div class="mode-row">
					<button
						type="button"
						class={['mode-btn', { active: scaleAlgorithm === SCALE_ALGORITHMS.BROWSER }]}
						aria-pressed={scaleAlgorithm === SCALE_ALGORITHMS.BROWSER}
						aria-describedby="browser-scaling-info"
						onclick={() => setScaleAlgorithm(SCALE_ALGORITHMS.BROWSER)}
					>
						<Monitor size={18} aria-hidden="true" />
						<span>Default</span>
						<Check size={16} class="check-icon" aria-hidden="true" />
					</button>
					<button type="button" class="info-wrap" aria-label="Browser scaling info">
						<Info size={15} aria-hidden="true" />
						<span id="browser-scaling-info" class="info-tip" role="tooltip">
							Low quality, fast
						</span>
					</button>
				</div>
			</div>
		</section>

		<div class="section-separator" aria-hidden="true"></div>

		<section class="setting-group" aria-labelledby="keybinds-heading">
			<h3 id="keybinds-heading">Keybinds</h3>
			<div class="keybind-list" aria-label="Keyboard shortcuts">
				<div class="keybind-scope">Global</div>
				<div class="keybind-row">
					<span>Open settings</span>
					<span class="key-combo">
						<kbd>?</kbd>
					</span>
				</div>

				<div class="keybind-scope">Home page</div>
				<div class="keybind-row">
					<span>Open search</span>
					<span class="key-combo" aria-label={`${modifierKeyLabel} K`}>
						<kbd>{modifierKeyLabel}</kbd>
						+
						<kbd>K</kbd>
					</span>
				</div>

				<div class="keybind-scope">Reader</div>
				<div class="keybind-row">
					<span>Switch pages</span>
					<span class="key-combo" aria-label="Left or right arrow">
						<kbd>←</kbd>
						/
						<kbd>→</kbd>
					</span>
				</div>
				<div class="keybind-row">
					<span>Show or hide reader controls</span>
					<span class="key-combo">
						<kbd>Esc</kbd>
					</span>
				</div>
				<div class="keybind-row">
					<span>Back to library</span>
					<span class="key-combo">
						<kbd>X</kbd>
					</span>
				</div>
			</div>
		</section>
	</div>
</dialog>

<style>
	.modal {
		margin: auto;
		padding: 0;
		border: none;
		background: transparent;
		max-width: min(460px, calc(100vw - 2rem));
		width: 100%;
		user-select: none;
	}

	.modal::backdrop {
		background: rgba(0, 0, 0, 0.65);
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		box-sizing: border-box;
		height: 95dvh;
		padding: 1.25rem;
		border: 1px solid #2a2a32;
		border-radius: 1rem;
		background: #16161a;
		overflow-y: auto;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	h2,
	h3 {
		margin: 0;
		color: #fff;
	}

	h2 {
		font-size: 1.1rem;
		font-weight: 600;
	}

	h3 {
		font-size: 0.86rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #9a9aa3;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: #9a9aa3;
		cursor: pointer;
	}

	.icon-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #e8e8ea;
	}

	.setting-group {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.section-separator {
		height: 1px;
		background: #2a2a32;
	}

	.mode-list {
		display: grid;
		gap: 0.5rem;
	}

	.setting-label {
		color: #d8d8de;
		font-size: 0.88rem;
		font-weight: 500;
	}

	.scaling-label {
		margin-top: 0.25rem;
	}

	.capability-status {
		float: right;
		color: #8f8f98;
		font-size: 0.76rem;
		font-weight: 500;
	}

	.mode-row {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 0.5rem;
	}

	.mode-btn {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.75rem;
		min-height: 3rem;
		width: 100%;
		padding: 0 0.875rem;
		border: 1px solid #2a2a32;
		border-radius: 0.625rem;
		background: rgba(255, 255, 255, 0.03);
		color: #d8d8de;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
		transition:
			background-color 150ms ease,
			border-color 150ms ease,
			color 150ms ease;
	}

	.mode-btn:hover:not(:disabled) {
		border-color: rgba(138, 127, 240, 0.55);
		background: rgba(138, 127, 240, 0.1);
	}

	.mode-btn:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.mode-btn.active {
		border-color: rgba(138, 127, 240, 0.65);
		background: rgba(138, 127, 240, 0.12);
		color: #fff;
	}

	.mode-btn :global(svg) {
		color: #9a9aa3;
	}

	.mode-btn.active :global(svg) {
		color: #8a7ff0;
	}

	.info-wrap {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: #8a8a92;
		cursor: help;
		font: inherit;
	}

	.info-wrap:hover,
	.info-wrap:focus-visible {
		background: rgba(255, 255, 255, 0.06);
		color: #d8d8de;
		outline: none;
	}

	.info-wrap :global(svg) {
		display: block;
	}

	.info-tip {
		position: absolute;
		right: -0.25rem;
		bottom: calc(100% + 0.65rem);
		z-index: 1;
		width: min(17rem, calc(100vw - 4rem));
		padding: 0.625rem 0.75rem;
		border: 1px solid #363640;
		border-radius: 0.5rem;
		background: #202027;
		color: #f1f1f3;
		box-shadow: 0 0.75rem 1.75rem rgba(0, 0, 0, 0.35);
		font-size: 0.78rem;
		font-weight: 500;
		line-height: 1.55;
		text-align: left;
		pointer-events: none;
		opacity: 0;
		transform: translateY(0.25rem);
		transition:
			opacity 120ms ease,
			transform 120ms ease;
	}

	.info-tip::after {
		content: '';
		position: absolute;
		right: 0.35rem;
		bottom: -0.35rem;
		width: 0.7rem;
		height: 0.7rem;
		border-right: 1px solid #363640;
		border-bottom: 1px solid #363640;
		background: #202027;
		transform: rotate(45deg);
	}

	.info-wrap:hover .info-tip,
	.info-wrap:focus-visible .info-tip {
		opacity: 1;
		transform: translateY(0);
	}

	.mode-btn :global(.check-icon) {
		opacity: 0;
	}

	.mode-btn.active :global(.check-icon) {
		opacity: 1;
	}

	.keybind-list {
		display: grid;
		gap: 0.5rem;
	}

	.keybind-scope {
		margin-top: 0.25rem;
		color: #8f8f98;
		font-size: 0.76rem;
		font-weight: 600;
	}

	.keybind-scope:first-child {
		margin-top: 0;
	}

	.keybind-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 1rem;
		min-height: 2.5rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid #2a2a32;
		border-radius: 0.625rem;
		background: rgba(255, 255, 255, 0.03);
		color: #d8d8de;
		font-size: 0.88rem;
		font-weight: 500;
	}

	.key-combo {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.25rem;
		white-space: nowrap;
	}

	kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.75rem;
		height: 1.5rem;
		padding: 0 0.45rem;
		border: 1px solid #393943;
		border-bottom-color: #24242b;
		border-radius: 0.375rem;
		background: #202027;
		color: #f1f1f3;
		box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.3);
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1;
	}
</style>
