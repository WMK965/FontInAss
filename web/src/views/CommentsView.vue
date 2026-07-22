<script setup lang="ts">
import { ref, onMounted, onActivated, onUnmounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Loader2, RefreshCw } from "lucide-vue-next";
import { preloadWalineAssets, WALINE_SERVER } from "../lib/waline-loader";

const { t, locale } = useI18n();

const walineEl = ref<HTMLDivElement>();
const isLoaded = ref(false);
const loadError = ref(false);
let walineController: { update?: (opts: Record<string, unknown>) => void; destroy?: () => void } | null = null;

async function initWaline() {
  if (!walineEl.value) return;
  loadError.value = false;
  isLoaded.value = false;

  try {
    const walineModule = await preloadWalineAssets();
    walineController?.destroy?.();
    walineController = walineModule.init({
      el: walineEl.value,
      serverURL: WALINE_SERVER,
      lang: locale.value === "zh-CN" ? "zh-CN" : "en",
      emoji: false,
      meta: ["nick", "mail"],
      requiredMeta: ["nick"],
      pageSize: 10,
      dark: "html.dark",
      comment: true,
      reaction: false,
      imageUploader: false,
      search: false,
    });
    isLoaded.value = true;
  } catch {
    loadError.value = true;
    isLoaded.value = true;
  }
}

onMounted(initWaline);

watch(locale, (lang) => {
  walineController?.update?.({ lang: lang === "zh-CN" ? "zh-CN" : "en" });
});

onActivated(() => {
  walineController?.update?.({});
});

onUnmounted(() => {
  walineController?.destroy?.();
  walineController = null;
});
</script>

<template>
  <div class="comments-page mx-auto max-w-3xl animate-fade-in">
    <header class="mb-6">
      <h1 class="font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-[1.75rem]">
        {{ t("comments") }}
      </h1>
      <p class="mt-1.5 text-[0.95rem] leading-relaxed text-ink-500">
        {{ t("commentsDesc") }}
      </p>
    </header>

    <div class="card relative overflow-hidden">
      <!-- Loading overlay -->
      <div
        v-if="!isLoaded"
        class="absolute inset-0 z-10 flex min-h-[280px] flex-col items-center justify-center gap-3 bg-surface px-6 py-16 text-ink-400"
      >
        <Loader2 class="h-5 w-5 animate-spin-slow text-sakura-400" />
        <p class="text-sm">{{ t("commentsLoading") }}</p>
      </div>

      <!-- Error overlay -->
      <div
        v-else-if="loadError"
        class="absolute inset-0 z-10 flex min-h-[280px] flex-col items-center justify-center gap-3 bg-surface px-6 py-16 text-center"
      >
        <p class="text-sm text-ink-500">{{ t("commentsLoadError") }}</p>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-sakura-200 bg-sakura-50 px-3 py-1.5 text-sm font-medium text-sakura-600 transition-colors hover:bg-sakura-100"
          @click="initWaline"
        >
          <RefreshCw class="h-3.5 w-3.5" />
          {{ t("retry") }}
        </button>
      </div>

      <!-- Waline mount (always in DOM for init / retry) -->
      <div
        ref="walineEl"
        class="comments-waline min-h-[280px] px-4 py-4 sm:px-5 sm:py-5"
      />
    </div>
  </div>
</template>

<style>
/* Waline theme tokens — Sakura palette, light + dark */
:root {
  --waline-font-size: 0.9rem;
  --waline-white: var(--color-surface);
  --waline-theme-color: var(--color-sakura-500);
  --waline-active-color: var(--color-sakura-600);
  --waline-color: var(--color-ink-800);
  --waline-bg-color: transparent;
  --waline-bg-color-light: var(--color-sakura-50);
  --waline-bg-color-hover: var(--color-sakura-100);
  --waline-border-color: var(--color-sakura-100);
  --waline-disable-bg-color: var(--color-ink-50);
  --waline-disable-color: var(--color-ink-400);
  --waline-code-bg-color: oklch(24% 0.02 260);
  --waline-bq-color: var(--color-sakura-200);
  --waline-info-bg-color: var(--color-ink-50);
  --waline-info-color: var(--color-ink-400);
  --waline-badge-color: var(--color-sakura-500);
  --waline-avatar-size: 2.5rem;
  --waline-m-avatar-size: 2rem;
  --waline-avatar-radius: 999px;
  --waline-border: 1px solid var(--waline-border-color);
  --waline-border-radius: 0.875rem;
  --waline-box-shadow: none;
  --waline-dark-grey: var(--color-ink-600);
  --waline-light-grey: var(--color-ink-400);
}

.dark {
  --waline-white: var(--color-surface);
  --waline-color: var(--color-ink-800);
  --waline-bg-color: transparent;
  --waline-bg-color-light: var(--color-surface-raised);
  --waline-bg-color-hover: var(--color-ink-100);
  --waline-border-color: var(--color-ink-200);
  --waline-disable-bg-color: var(--color-ink-100);
  --waline-disable-color: var(--color-ink-400);
  --waline-code-bg-color: oklch(16% 0.015 260);
  --waline-bq-color: var(--color-ink-200);
  --waline-info-bg-color: var(--color-ink-100);
  --waline-info-color: var(--color-ink-400);
  --waline-badge-color: var(--color-sakura-400);
  --waline-dark-grey: var(--color-ink-600);
  --waline-light-grey: var(--color-ink-400);
}

/* ─── Layout: clean comment section ─────────────────────────────────────── */

.comments-waline [data-waline] {
  font-family: var(--font-body);
}

/* Composer panel */
.comments-waline .wl-panel {
  margin: 0 0 0.25rem;
  border: 1px solid var(--waline-border-color);
  border-radius: var(--waline-border-radius);
  background: var(--color-surface);
  box-shadow: none;
}

.comments-waline .wl-header {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  padding: 0;
  border-bottom: 1px solid var(--waline-border-color);
  border-top-left-radius: var(--waline-border-radius);
  border-top-right-radius: var(--waline-border-radius);
  overflow: hidden;
}

.comments-waline .wl-header-item {
  flex: 1;
  min-width: 0;
  border-right: 1px solid var(--waline-border-color);
}

.comments-waline .wl-header-item:last-child {
  border-right: none;
}

.comments-waline .wl-header label {
  min-width: auto;
  padding: 0.7rem 0.2rem 0.7rem 0.85rem;
  color: var(--waline-light-grey);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.comments-waline .wl-header input {
  flex: 1;
  min-width: 0;
  width: auto;
  padding: 0.65rem 0.85rem 0.65rem 0.35rem;
  font-size: 0.85rem;
  color: var(--waline-color);
  background: transparent;
}

.comments-waline .wl-editor {
  width: 100%;
  min-height: 7.5rem;
  margin: 0;
  padding: 0.85rem 1rem;
  border-radius: 0;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--waline-color);
  background: transparent;
  box-sizing: border-box;
}

.comments-waline .wl-editor:focus {
  background: var(--waline-bg-color-light);
}

.comments-waline .wl-footer {
  margin: 0;
  padding: 0.55rem 0.75rem 0.65rem;
  border-top: 1px solid var(--waline-border-color);
  gap: 0.35rem;
}

.comments-waline .wl-action {
  color: var(--waline-light-grey);
  border-radius: 0.5rem;
}

.comments-waline .wl-action:hover {
  color: var(--waline-theme-color);
  background: var(--waline-bg-color-light);
}

.comments-waline .wl-btn {
  border-radius: 0.65rem;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.45rem 0.95rem;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.comments-waline .wl-btn.primary {
  border-color: var(--waline-theme-color);
  background: var(--waline-theme-color);
  color: oklch(99% 0.004 355);
}

.comments-waline .wl-btn.primary:hover {
  border-color: var(--waline-active-color);
  background: var(--waline-active-color);
}

/* Meta / sort bar */
.comments-waline .wl-meta-head {
  padding: 1rem 0 0.35rem;
  border-top: 1px solid var(--waline-border-color);
  margin-top: 0.75rem;
}

.comments-waline .wl-count {
  font-family: var(--font-display);
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--waline-color);
}

.comments-waline .wl-sort li {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--waline-light-grey);
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  transition: color 0.15s, background 0.15s;
}

.comments-waline .wl-sort li.active {
  color: var(--waline-theme-color);
  background: color-mix(in oklch, var(--waline-theme-color) 12%, transparent);
}

/* Comment cards — classic list, not decorative tiles */
.comments-waline .wl-cards {
  margin: 0;
  padding: 0;
}

.comments-waline .wl-card-item {
  padding: 0.85rem 0;
}

.comments-waline .wl-card {
  margin-inline-start: 0;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--waline-border-color);
}

.comments-waline .wl-card-item:last-child > .wl-card {
  border-bottom: none;
  padding-bottom: 0;
}

.comments-waline .wl-cards .wl-user {
  margin-inline-end: 0.7rem;
}

.comments-waline .wl-cards .wl-user .wl-user-avatar,
.comments-waline .wl-avatar {
  border: 1px solid var(--waline-border-color);
  box-shadow: none;
}

.comments-waline .wl-nick {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 0.88rem;
  color: var(--waline-color);
}

.comments-waline .wl-badge {
  border-radius: 999px;
  padding: 0.08em 0.45em;
  font-weight: 600;
  font-size: 0.65em;
}

.comments-waline .wl-time {
  font-size: 0.72rem;
  color: var(--waline-info-color);
}

.comments-waline .wl-content {
  font-size: 0.88rem;
  line-height: 1.7;
  color: var(--waline-color);
  padding-top: 0.4rem;
  margin-bottom: 0.4rem;
}

.comments-waline .wl-content p {
  margin: 0.35em 0;
}

.comments-waline .wl-reply-to a {
  background: color-mix(in oklch, var(--waline-theme-color) 12%, transparent);
  color: var(--waline-theme-color);
  padding: 0.1em 0.45em;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.comments-waline .wl-comment-actions button {
  font-size: 0.72rem;
  color: var(--waline-light-grey);
  padding: 0.15rem 0.3rem;
  border-radius: 0.4rem;
  transition: color 0.15s, background 0.15s;
}

.comments-waline .wl-comment-actions button:hover {
  color: var(--waline-theme-color);
  background: var(--waline-bg-color-light);
}

.comments-waline .wl-like.active {
  color: var(--color-rose-500);
}

/* Nested replies */
.comments-waline .wl-quote {
  margin-top: 0.5rem;
  border-inline-start: 2px solid var(--waline-border-color);
  padding-inline-start: 0.65rem;
}

.comments-waline .wl-quote .wl-card {
  border-bottom-color: transparent;
}

/* Inline reply composer */
.comments-waline .wl-comment .wl-panel {
  margin: 0.65rem 0 0;
  background: var(--waline-bg-color-light);
}

/* Empty / loading / power */
.comments-waline .wl-empty {
  padding: 2rem 1rem;
  font-size: 0.88rem;
  color: var(--waline-light-grey);
}

.comments-waline .wl-loading svg circle {
  stroke: var(--waline-theme-color);
}

.comments-waline .wl-power {
  font-size: 0.65rem;
  opacity: 0.4;
  margin-top: 0.75rem;
  padding-bottom: 0;
}

.comments-waline .wl-power:hover {
  opacity: 0.7;
}

.comments-waline .wl-operation {
  padding: 0.75rem 0 0.25rem;
}

.comments-waline .wl-operation button {
  border-radius: 0.65rem;
  font-size: 0.78rem;
  font-weight: 600;
}

/* Content extras */
.comments-waline blockquote {
  border-inline-start: 3px solid color-mix(in oklch, var(--waline-theme-color) 40%, transparent);
  background: color-mix(in oklch, var(--waline-theme-color) 6%, transparent);
  border-radius: 0 0.5rem 0.5rem 0;
  padding: 0.45rem 0.75rem;
  margin: 0.4rem 0;
}

.comments-waline code {
  border-radius: 0.35rem;
  font-size: 0.84em;
  padding: 0.12em 0.35em;
}

@media (max-width: 580px) {
  .comments-waline .wl-header {
    grid-template-columns: 1fr;
  }

  .comments-waline .wl-header-item {
    border-right: none;
    border-bottom: 1px solid var(--waline-border-color);
  }

  .comments-waline .wl-header-item:last-child {
    border-bottom: none;
  }
}
</style>
