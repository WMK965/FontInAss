<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { Trash2, RefreshCcw, Search, CheckCircle2, Loader2, Download } from "lucide-vue-next";
import { listFonts, deleteFont, deleteFontsBatch, downloadFontFile } from "../api/client";
import type { FontItem } from "../api/client";
import { useConfirm } from "../composables/useConfirm";
import KButton from "./KButton.vue";
import KBadge from "./KBadge.vue";
import KEmpty from "./KEmpty.vue";
import { formatBytes } from "../lib/format";

const props = withDefaults(defineProps<{ canDelete?: boolean }>(), { canDelete: true });

const { t } = useI18n();

// ── State ─────────────────────────────────────────────────────────────────────
const fonts = ref<FontItem[]>([]);
const fontTotal = ref(0);
const fontPage = ref(1);
const fontLimit = 100;
const fontSearch = ref("");
const fontLoading = ref(false);
const fontAllLoaded = ref(false);
const selectedIds = reactive(new Set<string>());
const downloadingIds = reactive(new Set<string>());
const batchDownloading = ref(false);
const actionNotice = ref("");
let actionNoticeTimer = 0;

const selectedFonts = computed(() => fonts.value.filter(font => selectedIds.has(font.id)));

const showActionNotice = (msg: string) => {
  clearTimeout(actionNoticeTimer);
  actionNotice.value = msg;
  actionNoticeTimer = window.setTimeout(() => { actionNotice.value = ""; }, 2000);
};

// Sentinel for infinite scroll
const sentinel = ref<HTMLElement | null>(null);
let io: IntersectionObserver | null = null;

const loadFontList = async (reset = true) => {
  if (fontLoading.value) return;
  if (reset) { fontPage.value = 1; fontAllLoaded.value = false; fonts.value = []; selectedIds.clear(); }
  fontLoading.value = true;
  try {
    const res = await listFonts(fontPage.value, fontLimit, fontSearch.value);
    if (reset) {
      fonts.value = res.data;
    } else {
      fonts.value.push(...res.data);
    }
    fontTotal.value = res.total;
    fontAllLoaded.value = fonts.value.length >= res.total;
    fontPage.value++;
  } catch (e) {
    useConfirm().alert({ title: t('errorTitle'), message: String(e instanceof Error ? e.message : e), variant: 'danger' });
  } finally {
    fontLoading.value = false;
  }
};

const loadNextPage = () => {
  if (!fontAllLoaded.value && !fontLoading.value) loadFontList(false);
};

const setupInfiniteScroll = () => {
  if (io) { io.disconnect(); io = null; }
  io = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) loadNextPage();
  }, { rootMargin: "200px" });
  if (sentinel.value) io.observe(sentinel.value);
};

watch(sentinel, (el) => {
  if (el) setupInfiniteScroll();
});

let searchTimer: ReturnType<typeof setTimeout>;
watch(fontSearch, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadFontList(true), 300);
});

const toggleSelect = (id: string) => {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
};

const deleteSelected = async () => {
  if (selectedIds.size === 0) return;
  const ids = [...selectedIds];
  const { confirm } = useConfirm();
  const ok = await confirm({
    title: t("deleteFontsTitle"),
    message: t("deleteFontsConfirm", { n: ids.length }),
    variant: "danger",
    confirmText: t("delete"),
  });
  if (!ok) return;
  try {
    await deleteFontsBatch(ids);
    showActionNotice(`×${ids.length} ${t("deleted")}`);
    loadFontList(true);
  } catch (e) {
    useConfirm().alert({ title: t('errorTitle'), message: String(e instanceof Error ? e.message : e), variant: 'danger' });
  }
};

const deleteSingle = async (id: string) => {
  try {
    await deleteFont(id);
    showActionNotice(t("deleted"));
    loadFontList(true);
  } catch (e) {
    useConfirm().alert({ title: t('errorTitle'), message: String(e instanceof Error ? e.message : e), variant: 'danger' });
  }
};

const uniqueFilename = (used: Set<string>, filename: string) => {
  if (!used.has(filename)) {
    used.add(filename);
    return filename;
  }

  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  let index = 2;
  let next = `${base} (${index})${ext}`;
  while (used.has(next)) {
    index++;
    next = `${base} (${index})${ext}`;
  }
  used.add(next);
  return next;
};

const saveFontBlob = async (blob: Blob, filename: string) => {
  const { saveAs } = await import("file-saver");
  saveAs(blob, filename);
};

const downloadSingle = async (font: FontItem) => {
  if (downloadingIds.has(font.id)) return;

  downloadingIds.add(font.id);
  try {
    const { blob, filename } = await downloadFontFile(font.id);
    await saveFontBlob(blob, filename);
    showActionNotice(t("fontDownloadStarted"));
  } catch (e) {
    useConfirm().alert({ title: t('errorTitle'), message: String(e instanceof Error ? e.message : e), variant: 'danger' });
  } finally {
    downloadingIds.delete(font.id);
  }
};

const downloadSelected = async () => {
  const targets = selectedFonts.value;
  if (targets.length === 0 || batchDownloading.value) return;

  batchDownloading.value = true;
  try {
    if (targets.length === 1) {
      await downloadSingle(targets[0]);
      return;
    }

    const [{ default: JSZip }, { saveAs }] = await Promise.all([import("jszip"), import("file-saver")]);
    const zip = new JSZip();
    const usedNames = new Set<string>();

    await Promise.all(targets.map(async (font) => {
      downloadingIds.add(font.id);
      const { blob, filename } = await downloadFontFile(font.id);
      zip.file(uniqueFilename(usedNames, filename), blob);
    }));

    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "fonts.zip");
    showActionNotice(t("fontDownloadStarted"));
  } catch (e) {
    useConfirm().alert({ title: t('errorTitle'), message: String(e instanceof Error ? e.message : e), variant: 'danger' });
  } finally {
    batchDownloading.value = false;
    for (const font of targets) downloadingIds.delete(font.id);
  }
};

const styleLabel = (f: FontItem) => {
  if (f.bold && f.italic) return t("boldItalic");
  if (f.bold) return t("bold");
  if (f.italic) return t("italic");
  return t("regular");
};

// Expose reload for parent
defineExpose({ reload: () => loadFontList(true) });

onMounted(() => loadFontList(true));

onBeforeUnmount(() => {
  io?.disconnect();
  clearTimeout(searchTimer);
  clearTimeout(actionNoticeTimer);
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 flex-wrap">
      <div class="relative flex-1 min-w-48">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
        <input
          v-model="fontSearch"
          class="w-full h-9 pl-9 pr-3 rounded-xl border border-ink-200 text-sm text-ink-700 placeholder:text-ink-400 focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20 outline-none transition-colors bg-surface"
          :placeholder="t('searchFonts')"
        />
      </div>
      <span class="text-sm text-ink-400">{{ t('fontTotal', { n: fontTotal }) }}</span>
      <div class="flex items-center gap-2">
        <Transition name="fade">
          <span v-if="actionNotice" class="flex items-center gap-1 text-xs font-medium text-mint-600 select-none">
            <CheckCircle2 class="w-3 h-3" />{{ actionNotice }}
          </span>
        </Transition>
        <KButton
          v-if="selectedIds.size > 0"
          variant="sky"
          size="sm"
          :loading="batchDownloading"
          @click="downloadSelected"
        >
          <Download v-if="!batchDownloading" class="w-3.5 h-3.5" />{{ t('downloadSelectedFonts') }}
        </KButton>
        <KButton v-if="props.canDelete && selectedIds.size > 0" variant="danger" size="sm" :disabled="batchDownloading" @click="deleteSelected">
          <Trash2 class="w-3.5 h-3.5" />{{ selectedIds.size }} {{ t('selected') }}
        </KButton>
        <KButton variant="ghost" size="sm" @click="loadFontList(true)">
          <RefreshCcw class="w-3.5 h-3.5" />
        </KButton>
      </div>
    </div>

    <!-- Font list with infinite scroll -->
    <div class="flex flex-col gap-1.5">
      <KEmpty v-if="!fontLoading && fonts.length === 0" :title="t('noFontsIndexed')" :description="t('noFonts')" />

      <TransitionGroup name="list">
        <div
          v-for="font in fonts"
          :key="font.id"
          class="card flex items-center gap-3 px-4 py-3 hover:shadow-md transition-shadow cursor-pointer"
          style="content-visibility: auto; contain-intrinsic-size: 0 56px;"
          @click="toggleSelect(font.id)"
        >
          <div
            class="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors"
            :class="selectedIds.has(font.id)
              ? 'bg-sakura-400 border-sakura-400'
              : 'border-ink-200 hover:border-sakura-300'"
          >
            <CheckCircle2 v-if="selectedIds.has(font.id)" class="w-3.5 h-3.5 text-white" />
          </div>

          <div class="flex-1 min-w-0">
            <p class="font-medium text-sm text-ink-900 truncate">{{ font.filename }}</p>
            <p class="text-xs text-ink-400 truncate">{{ font.names }}</p>
          </div>

          <div class="hidden sm:flex items-center gap-2">
            <KBadge variant="default">{{ styleLabel(font) }}</KBadge>
            <KBadge variant="default">{{ font.weight }}</KBadge>
            <span class="text-xs text-ink-400">{{ formatBytes(font.size) }}</span>
          </div>

          <button
            class="w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:text-sky-500 hover:bg-sky-50 transition-colors shrink-0 disabled:opacity-50 disabled:pointer-events-none"
            :aria-label="t('downloadFont')"
            :title="t('downloadFont')"
            :disabled="downloadingIds.has(font.id)"
            @click.stop="downloadSingle(font)"
          >
            <Loader2 v-if="downloadingIds.has(font.id)" class="w-3.5 h-3.5 animate-spin-slow" />
            <Download v-else class="w-3.5 h-3.5" />
          </button>

          <button
            v-if="props.canDelete"
            class="w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shrink-0"
            :aria-label="t('delete')"
            @click.stop="deleteSingle(font.id)"
          ><Trash2 class="w-3.5 h-3.5" /></button>
        </div>
      </TransitionGroup>

      <!-- Infinite scroll sentinel -->
      <div ref="sentinel" class="h-4 flex items-center justify-center">
        <Loader2 v-if="fontLoading && fonts.length > 0" class="w-4 h-4 text-sakura-400 animate-spin-slow" />
        <span v-else-if="fontAllLoaded && fonts.length > 0" class="text-xs text-ink-300">
          — {{ t('fontTotal', { n: fontTotal }) }} —
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.list-enter-active { transition: all 0.2s cubic-bezier(0.25, 1, 0.5, 1); }
.list-leave-active { transition: all 0.15s ease-in; position: absolute; width: 100%; }
.list-enter-from { opacity: 0; transform: translateY(-4px); }
.list-leave-to   { opacity: 0; }
</style>
