<script>
	import { BookOpen, ChevronDown, LogOut, Settings, User } from 'lucide-svelte';
	import IconDiscord from '~icons/simple-icons/discord';
	import IconGithub from '~icons/simple-icons/github';
	import {
		clearAccessToken,
		getAuthorizationUrl,
		getCachedViewer,
		getViewer,
		isAuthenticated
	} from '../lib/anilist-auth.js';

	let { onauthchange, onsettingsopen } = $props();

	const clientId = import.meta.env.VITE_ANILIST_CLIENT_ID ?? '';

	let connected = $state(isAuthenticated());
	/** @type {{ id: number, name: string, avatarUrl: string | null } | null} */
	let viewer = $state(isAuthenticated() ? getCachedViewer() : null);
	let logoPressed = $state(false);

	async function refreshViewer() {
		if (!isAuthenticated()) {
			connected = false;
			viewer = null;
			return;
		}

		try {
			const result = await getViewer({ maxAgeMs: 60 * 1000 });
			if (result) {
				connected = true;
				viewer = result;
			} else {
				clearAccessToken();
				connected = false;
				viewer = null;
				onauthchange?.();
			}
		} catch {
			connected = isAuthenticated();
		}
	}

	refreshViewer();

	function connect() {
		if (!clientId) return;
		window.location.href = getAuthorizationUrl(clientId);
	}

	function disconnect() {
		clearAccessToken();
		connected = false;
		viewer = null;
		onauthchange?.();
	}

	function openSettings() {
		onsettingsopen?.();
	}

	/** @param {PointerEvent} event */
	function handleLogoPointerDown(event) {
		if (event.button !== 0) return;
		logoPressed = true;
	}

	function handlePressUp() {
		logoPressed = false;
	}
</script>

<svelte:window onpointerup={handlePressUp} onpointercancel={handlePressUp} />

<header class="topbar">
	<div class="inner">
		<div class="brand">
			<button
				type="button"
				class={['logo', { pressed: logoPressed }]}
				onpointerdown={handleLogoPointerDown}
				onpointerup={handlePressUp}
				onpointercancel={handlePressUp}
			>poji</button>
		</div>

		<div class="actions">
			{#if connected && viewer}
				<div class="profile">
					<div class="profile-trigger" aria-haspopup="menu" aria-label="Account menu">
						{#if viewer.avatarUrl}
							<img class="avatar" src={viewer.avatarUrl} alt="" />
						{:else}
							<span class="avatar-fallback" aria-hidden="true">
								{viewer.name.charAt(0).toUpperCase()}
							</span>
						{/if}
						<ChevronDown size={14} class="profile-chevron" aria-hidden="true" />
					</div>
					<div class="menu" role="menu">
						<a
							class="menu-row menu-item menu-name"
							href={`https://anilist.co/user/${encodeURIComponent(viewer.name)}`}
							target="_blank"
							rel="noreferrer noopener"
							role="menuitem"
						>
							<User size={14} aria-hidden="true" />
							<span>{viewer.name}</span>
						</a>
						<button type="button" class="menu-row menu-item" role="menuitem" onclick={openSettings}>
							<Settings size={14} aria-hidden="true" />
							<span>Settings</span>
						</button>
						<a
							class="menu-row menu-item"
							href="https://wiki.poji.app/"
							target="_blank"
							rel="noreferrer noopener"
							role="menuitem"
						>
							<BookOpen size={14} aria-hidden="true" />
							<span>Wiki</span>
						</a>
						<button type="button" class="menu-row menu-item" role="menuitem" onclick={disconnect}>
							<LogOut size={14} aria-hidden="true" />
							<span>Log out</span>
						</button>
						<div class="menu-socials" role="none">
							<a
								class="menu-social-link"
								href="https://github.com/hotsno/poji"
								target="_blank"
								rel="noreferrer noopener"
								role="menuitem"
								aria-label="GitHub"
								title="GitHub"
							>
								<IconGithub aria-hidden="true" />
							</a>
							<a
								class="menu-social-link"
								href="https://discord.gg/2HwxyuSQHm"
								target="_blank"
								rel="noreferrer noopener"
								role="menuitem"
								aria-label="Discord"
								title="Discord"
							>
								<IconDiscord aria-hidden="true" />
							</a>
						</div>
					</div>
				</div>
			{:else}
				<a class="wiki-link" href="https://wiki.poji.app/" target="_blank" rel="noreferrer noopener">
					Wiki
				</a>
				{#if clientId}
					<button type="button" class="login-btn" onclick={connect}>Login</button>
				{/if}
				<button type="button" class="settings-trigger" aria-label="Settings" onclick={openSettings}>
					<Settings size={17} aria-hidden="true" />
				</button>
			{/if}
		</div>
	</div>
</header>

<style>
	.topbar {
		flex-shrink: 0;
		background: #0d0d0f;
		border-bottom: 1px solid #2a2a32;
		padding: 0 var(--layout-padding-inline);
	}

	.inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: min(var(--layout-max-width), 100%);
		height: 4.5rem;
		margin: 0 auto;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.logo {
		padding: 0;
		border: none;
		background: transparent;
		display: inline-flex;
		align-items: baseline;
		user-select: none;
		cursor: pointer;
		transform: scale(1);
		transition: transform 120ms cubic-bezier(0.33, 1, 0.68, 1);
		font-family:
			'Helvetica Neue',
			Helvetica,
			Arial,
			sans-serif;
		font-size: 1.625rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		line-height: 1;
		color: #8a7ff0;
	}

	.logo.pressed {
		transform: scale(0.94);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2rem;
		font-family: 'Overpass', sans-serif;
	}

	.wiki-link {
		text-decoration: none;
	}

	.settings-trigger {
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

	.settings-trigger:hover {
		background: rgba(255, 255, 255, 0.06);
		color: #d8d8de;
	}

	.login-btn,
	.wiki-link {
		position: relative;
		padding: 0.4rem 0.9rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: #9a9aa3;
		font-family: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transform: translateY(1px);
		transition: color 150ms ease;
	}

	.login-btn::after,
	.wiki-link::after {
		content: '';
		position: absolute;
		left: 0.9rem;
		bottom: 0.25rem;
		width: 0;
		height: 1px;
		background: currentColor;
		transition: width 200ms cubic-bezier(0.33, 1, 0.68, 1);
	}

	.login-btn:hover,
	.wiki-link:hover {
		color: #c8c8d0;
	}

	.login-btn:hover::after,
	.wiki-link:hover::after {
		width: calc(100% - 1.8rem);
	}

	.profile {
		position: relative;
	}

	.profile-trigger {
		all: unset;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		cursor: pointer;
		font-family: inherit;
	}

	.profile-trigger:focus-visible .avatar,
	.profile-trigger:focus-visible .avatar-fallback {
		box-shadow: 0 0 0 2px rgba(138, 127, 240, 0.45);
	}

	.avatar {
		width: 2rem;
		height: 2rem;
		object-fit: cover;
		border-radius: 0.25rem;
	}

	.avatar-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0.25rem;
		background: #2a2a32;
		color: #d8d8de;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.profile-trigger :global(.profile-chevron) {
		flex-shrink: 0;
		color: #6a6a72;
	}

	.menu {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		min-width: 10rem;
		padding: 0.375rem;
		border: 1px solid #2a2a32;
		border-radius: 0.5rem;
		background: #141418;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
		z-index: 20;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition:
			opacity 150ms ease,
			visibility 150ms ease;
	}

	.menu::before {
		content: '';
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		height: 0.5rem;
	}

	.profile:hover .menu,
	.profile:focus-within .menu {
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
	}

	.menu-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		min-height: 1.875rem;
		padding: 0 0.625rem;
		box-sizing: border-box;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 500;
		color: #9a9aa3;
	}

	.menu-row :global(svg) {
		display: block;
		flex-shrink: 0;
		width: 14px;
		height: 14px;
		color: #9a9aa3;
	}

	.menu-row span {
		line-height: 14px;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transform: translateY(1.5px); /* god knows why it's not aligning right */
	}

	.menu-name {
		user-select: none;
	}

	.menu-item {
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		text-decoration: none;
		text-align: left;
		cursor: pointer;
		appearance: none;
	}

	.menu-item:hover {
		background: rgba(138, 127, 240, 0.12);
	}

	.menu-item:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.menu-socials {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		margin-top: 0.375rem;
		padding: 0.375rem 0.25rem 0;
		border-top: 1px solid #2a2a32;
	}

	.menu-social-link {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.875rem;
		height: 1.875rem;
		border-radius: 0.375rem;
		color: #777780;
		transition:
			background-color 150ms ease,
			color 150ms ease;
	}

	.menu-social-link:hover,
	.menu-social-link:focus-visible {
		background: rgba(138, 127, 240, 0.12);
		color: #c8c8d0;
		outline: none;
	}

	.menu-social-link :global(svg) {
		display: block;
		width: 16px;
		height: 16px;
	}
</style>
