<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { debounce } from "lodash-es";
import {
  Share2, Search, X, Tv, Download, Upload, Heart,
  Paperclip, FileArchive, FolderOpen, ChevronRight, Home,
} from "lucide-vue-next";
import KButton from "../components/KButton.vue";
import KBadge from "../components/KBadge.vue";
import KEmpty from "../components/KEmpty.vue";
import KSpinner from "../components/KSpinner.vue";
import type { SharedArchive } from "../api/client";
import {
  listSharedArchives,
  contributeArchive,
} from "../api/client";
import { buildSearchIndex, searchArchives } from "../lib/search";

const { t } = useI18n();

// ─── State ────────────────────────────────────────────────────────────────────

const loading = ref(true);
const archives = ref<SharedArchive[]>([]);

// Search & filter
const searchQuery = ref("");
const filterLang = ref("");
const filterGroup = ref("");
const isSearching = computed(() => searchQuery.value.trim().length > 0);
const searchResultIds = ref<Set<string>>(new Set());

// Folder navigation: currentPath = [] → root, ['B'] → letter, ['B','BanG Dream!'] → anime, ['B','BanG Dream!','S1'] → season
const currentPath = ref<string[]>([]);
const navDepth = computed(() => currentPath.value.length);

// Unique languages and sub groups for filter dropdowns
const allLanguages = computed(() => {
  const langs = new Set<string>();
  for (const a of archives.value) {
    try { for (const l of JSON.parse(a.languages)) langs.add(l); } catch {}
  }
  return [...langs].sort();
});

const allSubGroups = computed(() => {
  const groups = new Set<string>();
  for (const a of archives.value) groups.add(a.sub_group);
  return [...groups].sort();
});

// Stats
const stats = computed(() => {
  const animeNames = new Set(archives.value.map((a) => a.name_cn));
  const subGroups = new Set(archives.value.map((a) => a.sub_group));
  return {
    animeCount: animeNames.size,
    archiveCount: archives.value.length,
    subGroupCount: subGroups.size,
  };
});

// ─── Grouped data structures ──────────────────────────────────────────────────

interface AnimeGroup {
  name_cn: string;
  seasons: { name: string; archives: SharedArchive[] }[];
  totalSeasons: number;
  totalArchives: number;
  sub_entries: string[] | null;
}

const filteredArchives = computed(() => {
  let list = archives.value;
  if (filterLang.value) {
    list = list.filter((a) => {
      try { return JSON.parse(a.languages).includes(filterLang.value); } catch { return false; }
    });
  }
  if (filterGroup.value) {
    list = list.filter((a) => a.sub_group === filterGroup.value);
  }
  if (isSearching.value) {
    list = list.filter((a) => searchResultIds.value.has(a.id));
  }
  return list;
});

// Level 0: letter folders with anime counts
const letterFolders = computed(() => {
  const map = new Map<string, Set<string>>();
  for (const a of filteredArchives.value) {
    if (!map.has(a.letter)) map.set(a.letter, new Set());
    map.get(a.letter)!.add(a.name_cn);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, animeSet]) => ({ letter, count: animeSet.size }));
});

// Level 1: anime list for a given letter
const animeFolders = computed(() => {
  if (navDepth.value < 1) return [];
  const letter = currentPath.value[0];
  const animeMap = new Map<string, SharedArchive[]>();
  for (const a of filteredArchives.value) {
    if (a.letter !== letter) continue;
    if (!animeMap.has(a.name_cn)) animeMap.set(a.name_cn, []);
    animeMap.get(a.name_cn)!.push(a);
  }
  return [...animeMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => {
      const seasons = new Set(list.map(a => a.season));
      return { name, seasonCount: seasons.size, archiveCount: list.length };
    });
});

// Level 2: seasons for a given anime
const seasonFolders = computed(() => {
  if (navDepth.value < 2) return [];
  const [letter, animeName] = currentPath.value;
  const seasonMap = new Map<string, SharedArchive[]>();
  let subEntries: string[] | null = null;
  for (const a of filteredArchives.value) {
    if (a.letter !== letter || a.name_cn !== animeName) continue;
    if (!seasonMap.has(a.season)) seasonMap.set(a.season, []);
    seasonMap.get(a.season)!.push(a);
    if (!subEntries && a.sub_entries) {
      try { subEntries = JSON.parse(a.sub_entries); } catch {}
    }
  }
  return {
    seasons: [...seasonMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, archives]) => ({ name, archiveCount: archives.length })),
    subEntries,
  };
});

// Level 3: archives for a given season
const seasonArchives = computed(() => {
  if (navDepth.value < 3) return [];
  const [letter, animeName, season] = currentPath.value;
  return filteredArchives.value.filter(
    a => a.letter === letter && a.name_cn === animeName && a.season === season
  );
});

// ─── Navigation ───────────────────────────────────────────────────────────────

function navigateTo(depth: number, segment?: string) {
  if (segment !== undefined) {
    currentPath.value = [...currentPath.value.slice(0, depth), segment];
  } else {
    currentPath.value = currentPath.value.slice(0, depth);
  }
}

function goRoot() {
  currentPath.value = [];
}

// ─── Search ───────────────────────────────────────────────────────────────────

const onSearchDebounced = debounce(() => {
  if (!searchQuery.value.trim()) {
    searchResultIds.value = new Set();
    return;
  }
  const ids = searchArchives(searchQuery.value.trim());
  searchResultIds.value = new Set(ids);
}, 200);

function clearSearch() {
  searchQuery.value = "";
  searchResultIds.value = new Set();
}

// ─── Contribute Modal ─────────────────────────────────────────────────────────

const showContributeModal = ref(false);
const uploadForm = ref({
  name_cn: "",
  letter: "",
  season: "S1",
  sub_group: "",
  languages: [] as string[],
  has_fonts: false,
  contributor: "",
});
const uploadFile = ref<File | null>(null);
const uploadSubmitting = ref(false);
const uploadDetected = ref("");
const dropHover = ref(false);

const LANG_OPTIONS = ["chs", "cht", "jpn", "chs_jpn", "cht_jpn", "sc", "tc", "eng"];

function toggleLang(lang: string) {
  const idx = uploadForm.value.languages.indexOf(lang);
  if (idx >= 0) uploadForm.value.languages.splice(idx, 1);
  else uploadForm.value.languages.push(lang);
}

function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    uploadFile.value = file;
    uploadDetected.value = `${formatSize(file.size)}`;
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  dropHover.value = false;
  const file = e.dataTransfer?.files[0];
  if (file && file.name.endsWith(".zip")) {
    uploadFile.value = file;
    uploadDetected.value = `${formatSize(file.size)}`;
  }
}

function resetForm() {
  uploadForm.value = { name_cn: "", letter: "", season: "S1", sub_group: "", languages: [], has_fonts: false, contributor: "" };
  uploadFile.value = null;
  uploadDetected.value = "";
}

async function submitContribute() {
  if (!uploadFile.value || uploadSubmitting.value) return;
  const meta = {
    name_cn: uploadForm.value.name_cn,
    letter: uploadForm.value.letter.toUpperCase(),
    season: uploadForm.value.season,
    sub_group: uploadForm.value.sub_group,
    languages: uploadForm.value.languages,
    has_fonts: uploadForm.value.has_fonts,
    contributor: uploadForm.value.contributor || undefined,
  };
  uploadSubmitting.value = true;
  try {
    await contributeArchive(uploadFile.value, meta);
    showContributeModal.value = false;
    resetForm();
    await loadArchives();
  } catch (e) {
    console.error("Upload error:", e);
    alert(String(e));
  } finally {
    uploadSubmitting.value = false;
  }
}

// Auto-generate letter from name
watch(() => uploadForm.value.name_cn, (name) => {
  if (name && !uploadForm.value.letter) {
    const first = name.charAt(0).toUpperCase();
    if (/[A-Z]/.test(first)) uploadForm.value.letter = first;
  }
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function loadArchives() {
  loading.value = true;
  try {
    archives.value = await listSharedArchives();
    buildSearchIndex(
      archives.value.map((a) => ({
        id: a.id,
        name_cn: a.name_cn,
        sub_group: a.sub_group,
        languages: (() => { try { return JSON.parse(a.languages).join(" "); } catch { return ""; } })(),
        season: a.season,
        letter: a.letter,
      }))
    );
  } catch (e) {
    console.error("Failed to load archives:", e);
  } finally {
    loading.value = false;
  }
}

function downloadArchive(archive: SharedArchive) {
  if (archive.download_url) {
    window.open(archive.download_url, "_blank");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function parseLangs(json: string): string[] {
  try { return JSON.parse(json); } catch { return []; }
}

function parseFmts(json: string): string[] {
  try { return JSON.parse(json); } catch { return []; }
}

onMounted(() => {
  loadArchives();
});
</script>

<template>
  <div class="flex flex-col gap-6 animate-fade-in">

    <!-- ═══ Header: Stats + Search ═══ -->
    <section class="card p-6 bg-gradient-to-br from-white to-sakura-50/40">
      <div class="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-xl bg-sakura-100 flex items-center justify-center shrink-0">
            <Share2 class="w-5 h-5 text-sakura-500" />
          </div>
          <div>
            <h1 class="font-display font-bold text-2xl text-ink-950">
              {{ t('sharingTitle') }}
            </h1>
            <p class="text-sm text-ink-400" v-if="!loading">
              {{ stats.animeCount }} {{ t('sharingAnimeCount') }} ·
              {{ stats.archiveCount }} {{ t('sharingArchiveCount') }} ·
              {{ stats.subGroupCount }} {{ t('sharingGroupCount') }}
            </p>
          </div>
        </div>
      </div>

      <!-- Search + Filters -->
      <div class="flex flex-col sm:flex-row gap-3">
        <div class="relative flex-1">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" />
          <input
            v-model="searchQuery"
            @input="onSearchDebounced"
            class="w-full pl-10 pr-10 py-2.5 rounded-xl border border-sakura-200 bg-white text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-sakura-300/50"
            :placeholder="t('sharingSearchPlaceholder')"
          />
          <button v-if="searchQuery" @click="clearSearch" class="absolute right-3 top-1/2 -translate-y-1/2">
            <X class="w-4 h-4 text-ink-300 hover:text-ink-500" />
          </button>
        </div>
        <div class="flex gap-2">
          <select
            v-model="filterLang"
            class="h-10 rounded-xl border border-sakura-200 bg-white px-3 text-sm text-ink-600"
          >
            <option value="">{{ t('sharingAllLanguages') }}</option>
            <option v-for="lang in allLanguages" :key="lang" :value="lang">{{ lang }}</option>
          </select>
          <select
            v-model="filterGroup"
            class="h-10 rounded-xl border border-sakura-200 bg-white px-3 text-sm text-ink-600"
          >
            <option value="">{{ t('sharingAllGroups') }}</option>
            <option v-for="group in allSubGroups" :key="group" :value="group">{{ group }}</option>
          </select>
        </div>
      </div>
    </section>

    <!-- ═══ Loading ═══ -->
    <div v-if="loading" class="flex justify-center py-16">
      <KSpinner />
    </div>

    <!-- ═══ Empty State ═══ -->
    <KEmpty
      v-else-if="archives.length === 0"
      :title="t('sharingNoArchives')"
      :description="t('sharingNoArchivesDesc')"
    />

    <!-- ═══ Breadcrumb Navigation ═══ -->
    <nav
      v-if="!loading && archives.length > 0 && !isSearching && navDepth > 0"
      class="flex items-center gap-1.5 text-sm flex-wrap"
    >
      <button
        @click="goRoot"
        class="flex items-center gap-1 text-sakura-500 hover:text-sakura-600 transition-colors duration-150 font-medium"
      >
        <Home class="w-3.5 h-3.5" />
        {{ t('sharingBreadcrumbRoot') }}
      </button>
      <template v-for="(seg, idx) in currentPath" :key="idx">
        <ChevronRight class="w-3.5 h-3.5 text-ink-300 shrink-0" />
        <button
          v-if="idx < navDepth - 1"
          @click="navigateTo(idx + 1)"
          class="text-sakura-500 hover:text-sakura-600 transition-colors duration-150 font-medium truncate max-w-48"
        >
          {{ seg }}
        </button>
        <span v-else class="text-ink-700 font-semibold truncate max-w-48">{{ seg }}</span>
      </template>
    </nav>

    <!-- ═══ Level 0: Letter Folder Grid ═══ -->
    <div
      v-if="!loading && archives.length > 0 && !isSearching && navDepth === 0"
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
    >
      <button
        v-for="item in letterFolders"
        :key="item.letter"
        @click="navigateTo(0, item.letter)"
        class="card p-5 flex flex-col items-center gap-3 hover:shadow-md hover:border-sakura-200 transition-all duration-200 cursor-pointer group active:scale-[0.97]"
      >
        <div class="w-12 h-12 rounded-2xl bg-sakura-50 group-hover:bg-sakura-100 flex items-center justify-center transition-colors duration-200">
          <FolderOpen class="w-6 h-6 text-sakura-400 group-hover:text-sakura-500 transition-colors duration-200" />
        </div>
        <span class="font-display font-bold text-2xl text-ink-800">{{ item.letter }}</span>
        <KBadge variant="default">{{ t('sharingLetterFolder', { count: item.count }) }}</KBadge>
      </button>
    </div>

    <!-- ═══ Level 1: Anime List ═══ -->
    <div
      v-if="!loading && archives.length > 0 && !isSearching && navDepth === 1"
      class="flex flex-col gap-3"
    >
      <button
        v-for="item in animeFolders"
        :key="item.name"
        @click="navigateTo(1, item.name)"
        class="card px-5 py-4 flex items-center gap-4 hover:shadow-md hover:border-sakura-200 transition-all duration-200 cursor-pointer group active:scale-[0.99] text-left"
      >
        <div class="w-10 h-10 rounded-xl bg-sky-50 group-hover:bg-sky-100 flex items-center justify-center shrink-0 transition-colors duration-200">
          <Tv class="w-5 h-5 text-sky-400 group-hover:text-sky-500 transition-colors duration-200" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-display font-semibold text-ink-900 text-base truncate">{{ item.name }}</p>
          <p class="text-xs text-ink-400 mt-0.5">
            {{ t('sharingAnimeFolder', { count: item.seasonCount }) }} · {{ item.archiveCount }} {{ t('sharingArchives') }}
          </p>
        </div>
        <ChevronRight class="w-4 h-4 text-ink-300 group-hover:text-sakura-400 shrink-0 transition-colors duration-200" />
      </button>
      <KEmpty v-if="animeFolders.length === 0" :title="t('sharingNoResults')" />
    </div>

    <!-- ═══ Level 2: Season List ═══ -->
    <div
      v-if="!loading && archives.length > 0 && !isSearching && navDepth === 2"
      class="flex flex-col gap-3"
    >
      <button
        v-for="item in seasonFolders.seasons"
        :key="item.name"
        @click="navigateTo(2, item.name)"
        class="card px-5 py-4 flex items-center gap-4 hover:shadow-md hover:border-sakura-200 transition-all duration-200 cursor-pointer group active:scale-[0.99] text-left"
      >
        <div class="w-10 h-10 rounded-xl bg-mint-50 group-hover:bg-mint-100 flex items-center justify-center shrink-0 transition-colors duration-200">
          <FolderOpen class="w-5 h-5 text-mint-400 group-hover:text-mint-500 transition-colors duration-200" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-display font-semibold text-ink-900 text-base">{{ item.name }}</p>
          <p class="text-xs text-ink-400 mt-0.5">{{ t('sharingSeasonFolder', { count: item.archiveCount }) }}</p>
        </div>
        <ChevronRight class="w-4 h-4 text-ink-300 group-hover:text-sakura-400 shrink-0 transition-colors duration-200" />
      </button>

      <!-- Sub-entries info -->
      <div v-if="seasonFolders.subEntries?.length" class="card px-5 py-3 bg-sakura-50/30">
        <p class="text-[11px] text-ink-400 flex items-center gap-1.5">
          <Paperclip class="w-3 h-3 shrink-0" />
          {{ t('sharingIncludes') }}: {{ seasonFolders.subEntries.join(' · ') }}
        </p>
      </div>
      <KEmpty v-if="seasonFolders.seasons.length === 0" :title="t('sharingNoResults')" />
    </div>

    <!-- ═══ Level 3: Archive Files ═══ -->
    <div
      v-if="!loading && archives.length > 0 && !isSearching && navDepth === 3"
      class="flex flex-col gap-2"
    >
      <div
        v-for="archive in seasonArchives"
        :key="archive.id"
        class="card px-5 py-3 flex items-center gap-3 hover:shadow-md transition-all duration-200 group"
      >
        <FileArchive class="w-5 h-5 text-ink-300 shrink-0" />

        <KBadge variant="sakura" class="shrink-0 max-w-[120px] truncate">
          {{ archive.sub_group }}
        </KBadge>

        <div class="flex items-center gap-1.5 flex-1 min-w-0 flex-wrap">
          <span v-if="archive.episode_count" class="text-xs text-ink-400">
            {{ archive.episode_count }} {{ t('sharingEpisodes') }}
          </span>
          <KBadge v-for="fmt in parseFmts(archive.subtitle_format)" :key="fmt" variant="default" class="text-[10px] px-1.5 py-0.5">
            {{ fmt }}
          </KBadge>
          <KBadge v-for="lang in parseLangs(archive.languages)" :key="lang" variant="sky" class="text-[10px] px-1.5 py-0.5">
            {{ lang }}
          </KBadge>
          <KBadge v-if="archive.has_fonts" variant="success" class="text-[10px] px-1.5 py-0.5">
            {{ t('sharingFont') }}
          </KBadge>
        </div>

        <span class="text-xs text-ink-300 shrink-0 tabular-nums">
          {{ formatSize(archive.file_size) }}
        </span>

        <button
          @click="downloadArchive(archive)"
          class="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-ink-300 hover:text-sakura-500 hover:bg-sakura-100 opacity-0 group-hover:opacity-100 transition-all duration-200 active:scale-95"
          :title="t('download')"
        >
          <Download class="w-4 h-4" />
        </button>
      </div>
      <KEmpty v-if="seasonArchives.length === 0" :title="t('sharingNoResults')" />
    </div>

    <!-- ═══ Search Mode: Flat results ═══ -->
    <div v-if="!loading && isSearching" class="mt-2">
      <p class="text-sm text-ink-400 mb-4">
        "<strong class="text-ink-600">{{ searchQuery }}</strong>"
        — {{ filteredArchives.length }}
      </p>

      <div class="flex flex-col gap-3">
        <div
          v-for="result in filteredArchives"
          :key="result.id"
          class="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow duration-200"
        >
          <div class="flex-1 min-w-0">
            <p class="font-display font-medium text-sm text-ink-900 truncate">{{ result.name_cn }}</p>
            <p class="text-xs text-ink-400 mt-0.5">
              {{ result.season }} ·
              <span class="text-sakura-400">{{ result.sub_group }}</span> ·
              {{ result.episode_count }} {{ t('sharingEpisodes') }}
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <KBadge v-for="lang in parseLangs(result.languages)" :key="lang" variant="sky" class="text-[10px]">{{ lang }}</KBadge>
            <span class="text-xs text-ink-300 tabular-nums">{{ formatSize(result.file_size) }}</span>
            <button
              @click="downloadArchive(result)"
              class="w-8 h-8 rounded-lg flex items-center justify-center text-sakura-400 hover:text-sakura-600 hover:bg-sakura-100 transition-colors duration-150 active:scale-95"
            >
              <Download class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <KEmpty v-if="filteredArchives.length === 0" :title="t('sharingNoResults')" :description="t('sharingNoResultsDesc')" />
    </div>

    <!-- ═══ Contribute Footer ═══ -->
    <section v-if="!loading && archives.length > 0" class="card p-6 text-center mt-4">
      <div class="w-11 h-11 rounded-xl bg-mint-100 flex items-center justify-center mx-auto mb-3">
        <Heart class="w-5 h-5 text-mint-500" />
      </div>
      <h3 class="font-display font-semibold text-ink-800 text-base mb-1">
        {{ t('sharingContributeTitle') }}
      </h3>
      <p class="text-sm text-ink-400 mb-4 max-w-md mx-auto leading-relaxed">
        {{ t('sharingContributeDesc') }}
      </p>
      <KButton variant="secondary" @click="showContributeModal = true">
        <Upload class="w-4 h-4" />
        {{ t('sharingContributeButton') }}
      </KButton>
    </section>

    <!-- ═══ Contribute Modal (Improved) ═══ -->
    <Transition name="modal">
      <div v-if="showContributeModal" class="fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="showContributeModal = false">
        <div class="absolute inset-0 bg-ink-950/30 backdrop-blur-sm"></div>
        <div class="card p-0 w-full max-w-lg max-h-[85vh] overflow-y-auto relative z-10 animate-scale-in">

          <!-- Modal header -->
          <div class="px-6 pt-6 pb-4 border-b border-sakura-100/60">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-sakura-100 flex items-center justify-center shrink-0">
                <Heart class="w-5 h-5 text-sakura-500" />
              </div>
              <div>
                <h2 class="font-display font-bold text-lg text-ink-900">{{ t('sharingContributeFormTitle') }}</h2>
                <p class="text-xs text-ink-400 mt-0.5">{{ t('sharingContributeDesc') }}</p>
              </div>
            </div>
          </div>

          <div class="px-6 py-5 flex flex-col gap-5">
            <!-- Step 1: Anime info -->
            <div class="flex flex-col gap-3">
              <div class="flex items-center gap-2 mb-1">
                <div class="w-6 h-6 rounded-full bg-sakura-100 flex items-center justify-center text-xs font-bold text-sakura-500">1</div>
                <span class="text-sm font-semibold text-ink-700">{{ t('sharingAnimeName') }}</span>
              </div>
              <input v-model="uploadForm.name_cn" class="w-full px-3 py-2.5 rounded-xl border border-sakura-200 text-sm focus:outline-none focus:ring-2 focus:ring-sakura-300/50" :placeholder="t('sharingAnimeName')" />
              <div class="flex gap-3">
                <div class="w-20">
                  <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingLetter') }}</label>
                  <input v-model="uploadForm.letter" maxlength="1" class="w-full px-3 py-2 rounded-xl border border-sakura-200 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-sakura-300/50" />
                </div>
                <div class="flex-1">
                  <label class="text-xs font-medium text-ink-500 mb-1 block">{{ t('sharingSeason') }}</label>
                  <select v-model="uploadForm.season" class="w-full px-3 py-2 rounded-xl border border-sakura-200 text-sm focus:outline-none focus:ring-2 focus:ring-sakura-300/50">
                    <option v-for="s in ['S1','S2','S3','S4','Movie','SPs','OVA']" :key="s" :value="s">{{ s }}</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Step 2: Sub group & languages -->
            <div class="flex flex-col gap-3">
              <div class="flex items-center gap-2 mb-1">
                <div class="w-6 h-6 rounded-full bg-sky-100 flex items-center justify-center text-xs font-bold text-sky-500">2</div>
                <span class="text-sm font-semibold text-ink-700">{{ t('sharingSubGroup') }} & {{ t('sharingLanguages') }}</span>
              </div>
              <input v-model="uploadForm.sub_group" class="w-full px-3 py-2.5 rounded-xl border border-sakura-200 text-sm focus:outline-none focus:ring-2 focus:ring-sakura-300/50" :placeholder="t('sharingSubGroup')" />
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="lang in LANG_OPTIONS"
                  :key="lang"
                  @click="toggleLang(lang)"
                  class="px-3 py-1.5 rounded-xl text-xs font-medium border transition-all duration-150"
                  :class="uploadForm.languages.includes(lang)
                    ? 'bg-sakura-100 border-sakura-300 text-sakura-700 shadow-sm'
                    : 'bg-white border-ink-200 text-ink-400 hover:border-sakura-200'"
                >
                  {{ lang }}
                </button>
              </div>
              <label class="flex items-center gap-2 text-sm text-ink-600">
                <input type="checkbox" v-model="uploadForm.has_fonts" class="rounded" />
                {{ t('sharingHasFonts') }}
              </label>
            </div>

            <!-- Step 3: Upload file -->
            <div class="flex flex-col gap-3">
              <div class="flex items-center gap-2 mb-1">
                <div class="w-6 h-6 rounded-full bg-mint-100 flex items-center justify-center text-xs font-bold text-mint-500">3</div>
                <span class="text-sm font-semibold text-ink-700">{{ t('sharingDropZone') }}</span>
              </div>
              <div>
                <label class="text-xs font-medium text-ink-500 mb-1.5 block">{{ t('sharingContributor') }}</label>
                <input v-model="uploadForm.contributor" class="w-full px-3 py-2 rounded-xl border border-sakura-200 text-sm focus:outline-none focus:ring-2 focus:ring-sakura-300/50" :placeholder="t('sharingContributorPlaceholder')" />
              </div>
              <div
                @drop.prevent="handleDrop"
                @dragover.prevent="dropHover = true"
                @dragleave.prevent="dropHover = false"
                @click="($refs.contribFileInput as HTMLInputElement)?.click()"
                class="relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200"
                :class="dropHover
                  ? 'border-sakura-400 bg-sakura-50/60 scale-[1.01]'
                  : uploadFile
                    ? 'border-mint-300 bg-mint-50/30'
                    : 'border-sakura-200 hover:border-sakura-300 hover:bg-sakura-50/30'"
              >
                <div v-if="!uploadFile" class="flex flex-col items-center gap-2">
                  <div class="w-12 h-12 rounded-2xl bg-ink-100 flex items-center justify-center">
                    <FileArchive class="w-6 h-6 text-ink-400" />
                  </div>
                  <p class="text-sm text-ink-500 font-medium">{{ t('sharingDropZone') }}</p>
                  <p class="text-xs text-ink-300">{{ t('sharingMaxSize') }}</p>
                </div>
                <div v-else class="flex flex-col items-center gap-2">
                  <div class="w-12 h-12 rounded-2xl bg-mint-100 flex items-center justify-center">
                    <FileArchive class="w-6 h-6 text-mint-500" />
                  </div>
                  <p class="text-sm text-ink-700 font-semibold truncate max-w-full">{{ uploadFile.name }}</p>
                  <KBadge variant="success">{{ uploadDetected }}</KBadge>
                </div>
                <input ref="contribFileInput" type="file" accept=".zip" class="hidden" @change="handleFileSelect($event)" />
              </div>
            </div>
          </div>

          <!-- Modal footer -->
          <div class="px-6 py-4 border-t border-sakura-100/60 flex justify-end gap-2">
            <KButton variant="ghost" @click="showContributeModal = false; resetForm()">{{ t('cancel') }}</KButton>
            <KButton
              variant="primary"
              :disabled="!uploadForm.name_cn || !uploadForm.sub_group || !uploadForm.languages.length || !uploadFile || uploadSubmitting"
              :loading="uploadSubmitting"
              @click="submitContribute"
            >
              <Upload class="w-4 h-4" />
              {{ t('sharingSubmit') }}
            </KButton>
          </div>
        </div>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
