<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  FolderOpen,
  KeyRound as KeyRound2, Database, CloudUpload, Layers,
  Share2,
} from "lucide-vue-next";
import { API_KEY_CHANGED_EVENT, getApiKey } from "../api/client";
import SharingAdminPane from "../components/SharingAdminPane.vue";
import FontUploadPane from "../components/FontUploadPane.vue";
import IndexStatsPane from "../components/IndexStatsPane.vue";
import FontListPane from "../components/FontListPane.vue";
import R2BrowserPane from "../components/R2BrowserPane.vue";
import ApiTokensPane from "../components/ApiTokensPane.vue";
import AuthLockScreen from "../components/AuthLockScreen.vue";
import { useIndexState } from "../composables/useIndexState";

const { t } = useI18n();

// ── API Key lock ──────────────────────────────────────────────────────────────
const apiKey = ref(getApiKey());
const syncKey = () => { apiKey.value = getApiKey(); };
const onUnlocked = (key: string) => { apiKey.value = key; };

onMounted(() => {
  window.addEventListener(API_KEY_CHANGED_EVENT, syncKey);
  window.addEventListener("focus", syncKey);
});
onUnmounted(() => {
  window.removeEventListener(API_KEY_CHANGED_EVENT, syncKey);
  window.removeEventListener("focus", syncKey);
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
type Tab = "list" | "browser" | "upload" | "stats" | "sharing" | "apiTokens";
const activeTab = ref<Tab>("list");

const fontListRef = ref<InstanceType<typeof FontListPane> | null>(null);
const r2BrowserRef = ref<InstanceType<typeof R2BrowserPane> | null>(null);
const { indexProgress } = useIndexState();

const handleFontChanged = () => {
  fontListRef.value?.reload();
};
</script>

<template>
  <div>
    <AuthLockScreen v-if="!apiKey.trim()" @unlocked="onUnlocked" />

    <div v-else class="flex flex-col gap-5">
      <div class="flex items-center gap-1 p-1 bg-ink-100/60 rounded-2xl w-fit max-w-full overflow-x-auto">
        <button
          v-for="tab in [
            { id: 'list',    icon: Database,     label: t('indexedFonts') },
            { id: 'browser', icon: FolderOpen,   label: t('r2Browser')    },
            { id: 'upload',  icon: CloudUpload,  label: t('uploadFonts')  },
            { id: 'stats',   icon: Layers,       label: t('indexStats')   },
            { id: 'sharing', icon: Share2,        label: t('sharingFontsTab') },
            { id: 'apiTokens', icon: KeyRound2,   label: t('navApiTokens') },
          ]"
          :key="tab.id"
          class="flex items-center gap-1.5 h-8 px-4 rounded-xl text-sm font-medium transition-colors duration-150 shrink-0"
          :class="activeTab === tab.id ? 'bg-surface shadow-sm text-ink-900' : 'text-ink-500 hover:text-ink-700'"
          @click="activeTab = tab.id as Tab"
        >
          <component :is="tab.icon" class="w-3.5 h-3.5" />
          {{ tab.label }}
        </button>
      </div>

      <FontListPane v-if="activeTab === 'list'" ref="fontListRef" />
      <R2BrowserPane v-if="activeTab === 'browser'" ref="r2BrowserRef" @changed="handleFontChanged" />
      <FontUploadPane v-if="activeTab === 'upload'" @uploaded="handleFontChanged" />
      <IndexStatsPane v-if="activeTab === 'stats'" :index-progress="indexProgress" @changed="handleFontChanged" />
      <SharingAdminPane v-if="activeTab === 'sharing'" />
      <ApiTokensPane v-if="activeTab === 'apiTokens'" />
    </div>
  </div>
</template>
