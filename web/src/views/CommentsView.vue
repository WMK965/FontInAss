<script setup lang="ts">
import { ref, onMounted, onActivated, onUnmounted, shallowRef } from "vue";
import { useI18n } from "vue-i18n";

const { t, locale } = useI18n();

const walineEl = ref<HTMLDivElement>();
const isLoaded = ref(false);
const loadError = ref(false);
let walineController: { update?: (opts: Record<string, unknown>) => void; destroy?: () => void } | null = null;
const styleEl = shallowRef<HTMLStyleElement | null>(null);

const WALINE_SERVER = import.meta.env.VITE_WALINE_SERVER ?? "https://waline.anibt.net/";

function markLoaded() {
  if (isLoaded.value) return;
  isLoaded.value = true;
}

onMounted(async () => {
  if (!walineEl.value) return;

  try {
    // Lazy-load Waline JS + CSS only when this view mounts — zero main-bundle cost
    const [walineModule] = await Promise.all([
      import("@waline/client"),
      import("@waline/client/waline.css"),
    ]);

    // Inject override CSS once
    if (!document.getElementById("waline-overrides")) {
      const style = document.createElement("style");
      style.id = "waline-overrides";
      style.textContent = WALINE_OVERRIDE_CSS;
      document.head.appendChild(style);
      styleEl.value = style;
    }

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
      avatar: "retro",
      imageUploader: false,
      search: false,
    });

    // Detect first render
    const observer = new MutationObserver(() => {
      if (walineEl.value?.querySelector(".wl-editor-wrap, .wl-cards")) {
        markLoaded();
        observer.disconnect();
      }
    });
    observer.observe(walineEl.value, { childList: true, subtree: true });
    setTimeout(markLoaded, 4000);
  } catch {
    loadError.value = true;
    markLoaded();
  }
});

onActivated(() => { walineController?.update?.({}); });

onUnmounted(() => {
  walineController?.destroy?.();
  walineController = null;
  styleEl.value?.remove();
});

const WALINE_OVERRIDE_CSS = /* css */ `
:root{--waline-font-size:.875rem;--waline-white:#fff;--waline-theme-color:oklch(68% .22 350);--waline-active-color:oklch(60% .24 350);--waline-color:oklch(25% .015 355);--waline-bg-color:var(--color-surface);--waline-bg-color-light:oklch(98% .008 355);--waline-bg-color-hover:oklch(97% .012 355);--waline-border-color:oklch(92% .015 355);--waline-disable-bg-color:oklch(96% .005 355);--waline-disable-color:oklch(60% .01 355);--waline-code-bg-color:oklch(22% .02 260);--waline-bq-color:oklch(92% .02 350);--waline-color-light:oklch(55% .01 355);--waline-info-bg-color:oklch(97% .008 355);--waline-info-color:oklch(55% .01 355);--waline-info-font-size:.625em;--waline-badge-color:oklch(68% .18 350);--waline-badge-font-size:.65em;--waline-avatar-size:2.25rem;--waline-m-avatar-size:1.75rem;--waline-avatar-radius:50%;--waline-border:1px solid var(--waline-border-color);--waline-border-radius:.75rem;--waline-box-shadow:none;--waline-dark-grey:oklch(45% .01 355);--waline-light-grey:oklch(60% .01 355);--waline-warning-color:oklch(55% .12 60);--waline-warning-bg-color:oklch(95% .04 75/.5)}
.dark{--waline-white:oklch(18% .008 355);--waline-color:oklch(88% .008 355);--waline-bg-color:var(--color-surface);--waline-bg-color-light:oklch(22% .01 355);--waline-bg-color-hover:oklch(25% .012 355);--waline-border-color:oklch(28% .01 355);--waline-disable-bg-color:oklch(22% .005 355);--waline-disable-color:oklch(45% .01 355);--waline-code-bg-color:oklch(16% .015 260);--waline-bq-color:oklch(25% .01 355);--waline-color-light:oklch(55% .01 355);--waline-info-bg-color:oklch(22% .008 355);--waline-info-color:oklch(50% .01 355);--waline-badge-color:oklch(72% .16 350);--waline-dark-grey:oklch(60% .01 355);--waline-light-grey:oklch(48% .01 355);--waline-warning-color:oklch(70% .10 60);--waline-warning-bg-color:oklch(25% .04 75/.5)}
[data-waline]{font-family:var(--font-body)!important}[data-waline] *{box-sizing:border-box!important}
.waline-wrap .wl-panel{box-shadow:none!important;border:none!important;border-radius:0!important;padding:0!important;margin:0!important;background:transparent!important}
.waline-wrap .wl-header{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))!important;gap:.5rem!important;padding:0!important;border:none!important;border-radius:0!important;margin-bottom:.75rem!important}
.waline-wrap .wl-header-item{display:flex!important;align-items:center!important;padding:0!important;border:none!important;border-radius:.75rem!important;background:var(--waline-bg-color-light)!important;transition:background .15s,box-shadow .15s!important}
.waline-wrap .wl-header-item:focus-within{background:var(--waline-bg-color)!important;box-shadow:0 0 0 2px oklch(68% .22 350/.2)!important}
.waline-wrap .wl-header label{padding:.5rem 0 .5rem .75rem!important;font-size:.75rem!important;font-weight:500!important;color:var(--waline-color-light)!important;min-width:auto!important;white-space:nowrap!important}
.waline-wrap .wl-header input{flex:1!important;padding:.5rem .75rem .5rem .35rem!important;font-size:.8125rem!important;border:none!important;background:transparent!important;color:var(--waline-color)!important;outline:none!important}
.waline-wrap .wl-editor{min-height:7rem!important;margin:0!important;padding:.75rem 1rem!important;border-radius:.75rem!important;background:var(--waline-bg-color-light)!important;font-size:.8125rem!important;line-height:1.65!important;transition:background .15s,box-shadow .15s!important;width:100%!important}
.waline-wrap .wl-editor:focus,.waline-wrap .wl-editor:focus-within{background:var(--waline-bg-color)!important;box-shadow:0 0 0 2px oklch(68% .22 350/.2)!important}
.waline-wrap .wl-footer{margin:.75rem 0 0!important;padding:0!important;gap:.5rem!important}
.waline-wrap .wl-action{width:1.75rem!important;height:1.75rem!important;border-radius:.5rem!important;font-size:.875rem!important;color:var(--waline-color-light)!important;transition:all .15s!important}
.waline-wrap .wl-action:hover{color:var(--waline-theme-color)!important;background:oklch(68% .22 350/.08)!important}
.waline-wrap .wl-btn{border-radius:.625rem!important;font-size:.75rem!important;font-weight:500!important;padding:.45rem 1rem!important;transition:all .2s var(--ease-out-quart)!important;letter-spacing:.01em!important}
.waline-wrap .wl-btn.primary{border-color:oklch(65% .20 347)!important;background:linear-gradient(135deg,oklch(72% .175 347),oklch(63% .210 345))!important;color:#fff!important;box-shadow:0 1px 3px oklch(63% .21 345/.25)!important}
.waline-wrap .wl-btn.primary:hover{border-color:oklch(60% .22 345)!important;background:linear-gradient(135deg,oklch(68% .19 347),oklch(58% .22 345))!important;box-shadow:0 2px 8px oklch(63% .21 345/.35)!important;transform:translateY(-1px)!important}
.waline-wrap .wl-btn.primary:active{transform:translateY(0)!important;box-shadow:0 1px 2px oklch(63% .21 345/.2)!important}
.waline-wrap .wl-count{font-size:.8125rem!important;font-weight:600!important;color:var(--waline-color)!important}
.waline-wrap .wl-sort li{border-radius:.5rem!important;padding:.25rem .625rem!important;font-size:.75rem!important;transition:all .15s!important}
.waline-wrap .wl-sort .active{background:oklch(68% .22 350/.1)!important;color:var(--waline-theme-color)!important}
.waline-wrap .wl-cards{padding-top:.25rem!important}
.waline-wrap .wl-cards>.wl-item{padding:1rem .75rem!important;border-radius:.75rem!important;transition:background .15s!important;margin:0!important}
.waline-wrap .wl-cards>.wl-item:hover{background:var(--waline-bg-color-hover)!important}
.waline-wrap .wl-cards>.wl-item+.wl-item{border-top:1px solid var(--waline-border-color)!important;border-radius:0!important}
.waline-wrap .wl-cards>.wl-item:last-child{border-bottom-left-radius:.75rem!important;border-bottom-right-radius:.75rem!important}
.waline-wrap .wl-cards>.wl-item:first-child{border-top-left-radius:.75rem!important;border-top-right-radius:.75rem!important}
.waline-wrap .wl-avatar,.waline-wrap .wl-user .wl-avatar{border:none!important;box-shadow:0 0 0 2px oklch(92% .015 355),0 1px 3px oklch(0% 0 0/.06)!important}
.dark .waline-wrap .wl-avatar,.dark .waline-wrap .wl-user .wl-avatar{box-shadow:0 0 0 2px oklch(28% .01 355),0 1px 3px oklch(0% 0 0/.2)!important}
.waline-wrap .wl-user img{transition:transform .2s var(--ease-out-quart)!important}
.waline-wrap .wl-user img:hover{transform:scale(1.1)!important}
.waline-wrap .wl-nick{font-weight:600!important;font-size:.8125rem!important;color:var(--waline-color)!important}
.waline-wrap .wl-badge{border-radius:.375rem!important;padding:.1em .4em!important;font-size:.625rem!important;font-weight:600!important;letter-spacing:.02em!important}
.waline-wrap .wl-time{font-size:.6875rem!important;color:var(--waline-color-light)!important}
.waline-wrap .wl-content{font-size:.8125rem!important;line-height:1.7!important;color:var(--waline-color)!important}
.waline-wrap .wl-content p{margin:.35em 0!important}
.waline-wrap .wl-card .wl-content .wl-reply-to{float:left!important;margin:0 .4em 0 0!important;line-height:2!important}
.waline-wrap .wl-reply-to a{background:oklch(68% .22 350/.08)!important;padding:.1em .45em!important;border-radius:.375rem!important;font-size:.75rem!important;font-weight:500!important}
.dark .waline-wrap .wl-reply-to a{background:oklch(68% .22 350/.15)!important}
.waline-wrap .wl-comment-actions button{font-size:.6875rem!important;padding:.15rem .4rem!important;border-radius:.375rem!important;transition:all .15s!important;color:var(--waline-color-light)!important}
.waline-wrap .wl-comment-actions button:hover{color:var(--waline-theme-color)!important;background:oklch(68% .22 350/.06)!important}
.waline-wrap .wl-like.active{color:oklch(60% .20 15)!important}
.waline-wrap .wl-quote{border-inline-start:2px solid var(--waline-border-color)!important;padding-inline-start:.75rem!important;margin:.5rem 0 0!important}
.waline-wrap .wl-quote .wl-item{padding:.5rem 0!important}
.waline-wrap .wl-comment .wl-panel{border-radius:.75rem!important;border:1px solid var(--waline-border-color)!important;background:var(--waline-bg-color-light)!important;padding:.75rem!important;margin:.75rem 0 0!important}
.waline-wrap .wl-empty{padding:2.5rem 1rem!important;font-size:.8125rem!important;color:var(--waline-color-light)!important;text-align:center!important}
.waline-wrap .wl-loading{padding:2rem 0!important}
.waline-wrap .wl-loading svg circle{stroke:var(--waline-theme-color)!important}
.waline-wrap .wl-power{font-size:.625rem!important;opacity:.35!important;margin-top:1.5rem!important;transition:opacity .2s!important}
.waline-wrap .wl-power:hover{opacity:.65!important}
.waline-wrap .wl-preview{border-top:1px dashed var(--waline-border-color)!important;margin:.5rem 0 0!important;padding:.75rem 0 0!important}
.waline-wrap .wl-preview h4{font-size:.75rem!important;font-weight:600!important;color:var(--waline-color-light)!important;text-transform:uppercase!important;letter-spacing:.05em!important}
.waline-wrap .wl-operation{padding:1rem 0 .5rem!important}
.waline-wrap .wl-operation button{border-radius:.625rem!important;font-size:.75rem!important;font-weight:500!important;transition:all .2s var(--ease-out-quart)!important}
[data-waline] blockquote{border-inline-start:3px solid oklch(68% .22 350/.3)!important;background:oklch(68% .22 350/.03)!important;border-radius:0 .5rem .5rem 0!important;padding:.5rem .75rem!important}
[data-waline] code{border-radius:.375rem!important;font-size:.8em!important;padding:.15em .35em!important}
`;
</script>

<template>
  <div class="max-w-3xl mx-auto px-5 py-10">
    <!-- Header -->
    <div class="mb-8">
      <h1 class="font-display font-bold text-2xl text-ink-900 tracking-tight mb-1">
        {{ t("comments") }}
      </h1>
      <p class="text-sm text-ink-400">{{ t("commentsDesc") }}</p>
    </div>

    <div class="relative min-h-[420px]">
      <!-- Error state -->
      <div v-if="loadError" class="rounded-2xl border border-ink-100 bg-surface p-8 text-center">
        <p class="text-ink-400 text-sm">{{ t("commentsLoadError") }}</p>
        <button
          class="mt-3 text-sm text-sakura-500 hover:text-sakura-600 underline underline-offset-2"
          @click="$router.go(0)"
        >
          {{ t("retry") }}
        </button>
      </div>

      <div
        v-else
        ref="walineEl"
        class="waline-wrap rounded-2xl border border-ink-100 bg-surface shadow-[var(--shadow-sm)] overflow-hidden p-5 sm:p-6 transition-opacity duration-400"
        :class="isLoaded ? 'opacity-100' : 'opacity-0'"
      />

      <Transition
        leave-active-class="transition-opacity duration-400"
        leave-to-class="opacity-0"
      >
        <div
          v-if="!isLoaded"
          class="absolute inset-0 pointer-events-none space-y-4"
        >
          <div class="rounded-2xl border border-ink-100 bg-surface p-5 sm:p-6 space-y-3">
            <div class="grid grid-cols-2 gap-2">
              <div v-for="i in 2" :key="i" class="h-10 rounded-xl bg-sakura-50 animate-pulse" />
            </div>
            <div class="h-28 rounded-xl bg-sakura-50 animate-pulse" />
            <div class="flex justify-end">
              <div class="h-9 w-20 rounded-xl bg-sakura-100 animate-pulse" />
            </div>
          </div>
          <div v-for="i in 3" :key="i" class="flex gap-3 px-3 py-3">
            <div
              class="w-9 h-9 rounded-full bg-sakura-50 animate-pulse shrink-0"
              :style="{ animationDelay: `${i * 100}ms` }"
            />
            <div class="flex-1 space-y-2 pt-0.5">
              <div
                class="h-3 rounded-full bg-sakura-50 animate-pulse"
                :style="{ width: `${50 + i * 20}px`, animationDelay: `${i * 100}ms` }"
              />
              <div
                class="h-3 w-full rounded-full bg-sakura-50/60 animate-pulse"
                :style="{ animationDelay: `${i * 120}ms` }"
              />
              <div
                class="h-3 rounded-full bg-sakura-50/40 animate-pulse"
                :style="{ width: `${40 + i * 12}%`, animationDelay: `${i * 140}ms` }"
              />
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

