<script>
	import { TriangleAlert } from 'lucide-svelte';
	import { SCALE_ALGORITHMS } from '../lib/library.js';

	let { selected, fallback } = $props();

	function algorithmLabel(algorithm) {
		if (algorithm === SCALE_ALGORITHMS.MITCHELL) return 'Mitchell + linear light';
		if (algorithm === SCALE_ALGORITHMS.LANCZOS) return 'Lanczos';
		return 'default browser scaling';
	}
</script>

<div class="toast" role="status" aria-live="polite">
	<TriangleAlert size={20} aria-hidden="true" />
	<div class="text">
		<p class="title">Scaling fallback</p>
		<p class="detail">Using {algorithmLabel(fallback)} instead of {algorithmLabel(selected)}.</p>
	</div>
</div>

<style>
	.toast {
		position: fixed;
		right: 1.25rem;
		bottom: calc(1.25rem + env(safe-area-inset-bottom, 0px));
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 0.875rem;
		max-width: min(24rem, calc(100vw - 2.5rem));
		padding: 0.875rem 1rem;
		border: 1px solid #3a3545;
		border-radius: 0.75rem;
		background: #141418;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
		font-family: 'Overpass', sans-serif;
	}

	.toast :global(svg) {
		flex-shrink: 0;
		color: #c5bdf9;
	}

	.text {
		min-width: 0;
	}

	.title {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
		color: #e8e8ea;
	}

	.detail {
		margin: 0.125rem 0 0;
		font-size: 0.8rem;
		color: #b9b9c1;
	}
</style>
