<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { FileArchive, X } from "lucide-vue-next";
import KBadge from "./KBadge.vue";
import KSpinner from "./KSpinner.vue";
import { previewArchive } from "../api/client";

const { t } = useI18n();

const props = defineProps<{
  archiveId: string | null;
}>();

const emit = defineEmits<{ close: [] }>();

const previewLoading = ref(false);
const previewData = ref<{ filename: string; totalFiles: number; subtitleFiles: number; files: { name: string; ext: string; isSubtitle: boolean }[] } | null>(null);
const previewError = ref("");

watch(() => props.archiveId, async (id) => {
  if (!id) return;
  previewLoading.value = true;
  previewError.value = "";
  previewData.value = null;
  try {
    previewData.value = await previewArchive(id);
  } catch (e: any) {
    previewError.value = e.message || String(e);
  } finally {
    previewLoading.value = false;
  }
});

function close() {
  previewData.value = null;
  previewError.value = "";
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <Transition name="slide">
      <div v-if="archiveId" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" @click.self="close">
        <div class="bg-surface rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-6 py-4 border-b border-ink-100">
            <h3 class="font-display font-bold text-lg text-ink-900">{{ t('sharingPreviewTitle') }}</h3>
            <button @click="close" class="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-ink-100 transition-colors">
              <X class="w-4 h-4 text-ink-400" />
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-6">
            <div v-if="previewLoading" class="flex justify-center py-8"><KSpinner /></div>
            <div v-else-if="previewError" class="text-sm text-red-600 p-4 rounded-xl bg-red-50">{{ previewError }}</div>
            <template v-else-if="previewData">
              <div class="flex gap-4 mb-4">
                <KBadge variant="default">{{ t('sharingTotalFiles') }}: {{ previewData.totalFiles }}</KBadge>
                <KBadge variant="sky">{{ t('sharingSubtitleFiles') }}: {{ previewData.subtitleFiles }}</KBadge>
              </div>
              <div class="divide-y divide-ink-100">
                <div
                  v-for="file in previewData.files"
                  :key="file.name"
                  class="flex items-center gap-3 py-2 text-sm"
                >
                  <FileArchive class="w-4 h-4 shrink-0" :class="file.isSubtitle ? 'text-sky-400' : 'text-ink-300'" />
                  <span class="flex-1 truncate text-ink-700">{{ file.name }}</span>
                  <KBadge v-if="file.isSubtitle" variant="sky" class="text-[10px]">{{ file.ext }}</KBadge>
                  <KBadge v-else variant="default" class="text-[10px]">{{ file.ext }}</KBadge>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.slide-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.slide-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>
