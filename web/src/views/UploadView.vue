<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  AlertTriangle, BadgeCheck, CheckCircle2, Clock3, CloudUpload, Copy, FileText,
  History, KeyRound, Loader2, LogOut, RefreshCcw, Send, ShieldCheck, X, XCircle,
} from "lucide-vue-next";
import {
  applyForUploadAccess,
  claimUploadAccessApplication,
  getMyUploadHistory,
  getUploadAccessApplication,
  uploadFontsWithCredential,
  verifyUploadCredential,
} from "../api/client";
import type {
  ApiTokenApplication,
  ApiUploadHistoryItem,
  ApiUploadResult,
  WhoAmIResponse,
} from "../api/client";
import { formatBytes } from "../lib/format";
import { FONT_EXTS } from "../lib/constants";
import KButton from "../components/KButton.vue";
import KInput from "../components/KInput.vue";

const { t } = useI18n();
const CREDENTIAL_KEY = "fontinass_upload_credential";
const APPLICATION_KEY = "fontinass_upload_application";

type PortalMode = "credential" | "apply";
type QueueStatus = "pending" | "uploading" | "success" | "duplicate" | "rejected" | "error";
interface QueueEntry { file: File; status: QueueStatus; result?: ApiUploadResult; message?: string }
interface StoredApplication { id: string; secret: string }

const portalMode = ref<PortalMode>("credential");
const credential = ref(sessionStorage.getItem(CREDENTIAL_KEY) ?? "");
const credentialInput = ref(credential.value);
const identity = ref<WhoAmIResponse | null>(null);
const credentialLoading = ref(false);
const credentialError = ref("");

const applicationName = ref("");
const applicationContact = ref("");
const applicationPurpose = ref("");
const applicationVolume = ref("");
const applicationSubmitting = ref(false);
const applicationError = ref("");
const storedApplication = ref<StoredApplication | null>(loadStoredApplication());
const application = ref<ApiTokenApplication | null>(null);
const applicationLoading = ref(false);
const copyState = ref<"" | "application" | "secret">("");

const queue = ref<QueueEntry[]>([]);
const dragActive = ref(false);
let dragCounter = 0;
const uploadRunning = ref(false);
const uploadError = ref("");
const history = ref<ApiUploadHistoryItem[]>([]);
const historyLoading = ref(false);
const dropError = ref("");
let dropErrorTimer = 0;

const pendingEntries = computed(() => queue.value.filter((entry) => entry.status === "pending"));
const canApply = computed(() => applicationName.value.trim() && applicationContact.value.trim() && applicationPurpose.value.trim().length >= 10);
const applicationTone = computed(() => ({
  pending: "bg-amber-50 text-amber-600 border-amber-200",
  approved: "bg-sky-50 text-sky-500 border-sky-200",
  rejected: "bg-rose-50 text-rose-600 border-rose-200",
  claimed: "bg-mint-50 text-mint-600 border-mint-200",
}[application.value?.status ?? "pending"]));

function loadStoredApplication(): StoredApplication | null {
  try {
    const raw = localStorage.getItem(APPLICATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredApplication>;
    return parsed.id && parsed.secret ? { id: parsed.id, secret: parsed.secret } : null;
  } catch { return null; }
}

const saveStoredApplication = (value: StoredApplication | null) => {
  storedApplication.value = value;
  if (value) localStorage.setItem(APPLICATION_KEY, JSON.stringify(value));
  else localStorage.removeItem(APPLICATION_KEY);
};

const connectCredential = async (value = credentialInput.value) => {
  const normalized = value.trim();
  if (!normalized || credentialLoading.value) return;
  credentialLoading.value = true;
  credentialError.value = "";
  try {
    const current = await verifyUploadCredential(normalized);
    credential.value = normalized;
    credentialInput.value = normalized;
    identity.value = current;
    sessionStorage.setItem(CREDENTIAL_KEY, normalized);
    await loadHistory();
  } catch (error) {
    identity.value = null;
    sessionStorage.removeItem(CREDENTIAL_KEY);
    credentialError.value = error instanceof Error ? error.message : String(error);
  } finally {
    credentialLoading.value = false;
  }
};

const disconnectCredential = () => {
  credential.value = "";
  credentialInput.value = "";
  identity.value = null;
  history.value = [];
  queue.value = [];
  sessionStorage.removeItem(CREDENTIAL_KEY);
};

const submitApplication = async () => {
  if (!canApply.value || applicationSubmitting.value) return;
  applicationSubmitting.value = true;
  applicationError.value = "";
  try {
    const receipt = await applyForUploadAccess({
      applicant_name: applicationName.value.trim(),
      contact: applicationContact.value.trim(),
      purpose: applicationPurpose.value.trim(),
      expected_volume: applicationVolume.value.trim() || undefined,
    });
    application.value = receipt.application;
    saveStoredApplication({ id: receipt.application.id, secret: receipt.recovery_secret });
  } catch (error) {
    applicationError.value = error instanceof Error ? error.message : String(error);
  } finally {
    applicationSubmitting.value = false;
  }
};

const refreshApplication = async () => {
  if (!storedApplication.value || applicationLoading.value) return;
  applicationLoading.value = true;
  applicationError.value = "";
  try {
    application.value = await getUploadAccessApplication(storedApplication.value.id, storedApplication.value.secret);
  } catch (error) {
    applicationError.value = error instanceof Error ? error.message : String(error);
  } finally {
    applicationLoading.value = false;
  }
};

const claimApplication = async () => {
  if (!storedApplication.value || applicationLoading.value) return;
  applicationLoading.value = true;
  applicationError.value = "";
  try {
    const claimed = await claimUploadAccessApplication(storedApplication.value.id, storedApplication.value.secret);
    application.value = claimed.application;
    await connectCredential(claimed.plaintext);
  } catch (error) {
    applicationError.value = error instanceof Error ? error.message : String(error);
  } finally {
    applicationLoading.value = false;
  }
};

const useClaimedCredential = async () => {
  if (storedApplication.value) await connectCredential(storedApplication.value.secret);
};

const clearApplicationReceipt = () => {
  application.value = null;
  saveStoredApplication(null);
};

const copyText = async (kind: "application" | "secret", value: string) => {
  await navigator.clipboard.writeText(value);
  copyState.value = kind;
  window.setTimeout(() => { copyState.value = ""; }, 1400);
};

const isFont = (file: File) => FONT_EXTS.has(file.name.split(".").pop()?.toLowerCase() ?? "");
const addToQueue = (files: FileList | File[]) => {
  const valid = Array.from(files).filter(isFont);
  if (!valid.length) {
    clearTimeout(dropErrorTimer);
    dropError.value = t("uploadPortalNoFont");
    dropErrorTimer = window.setTimeout(() => { dropError.value = ""; }, 2500);
    return;
  }
  uploadError.value = "";
  queue.value.push(...valid.map((file) => ({ file, status: "pending" as const })));
};

const chooseFiles = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".ttf,.otf,.ttc,.otc";
  input.onchange = (event) => {
    const files = (event.target as HTMLInputElement).files;
    if (files) addToQueue(files);
  };
  input.click();
};

const removeEntry = (index: number) => {
  if (queue.value[index]?.status !== "uploading") queue.value.splice(index, 1);
};

const clearQueue = () => {
  if (!uploadRunning.value) queue.value = [];
};

const startUpload = async () => {
  if (!identity.value || !credential.value || uploadRunning.value || !pendingEntries.value.length) return;
  const pending = pendingEntries.value;
  pending.forEach((entry) => { entry.status = "uploading"; entry.message = undefined; });
  uploadRunning.value = true;
  uploadError.value = "";
  try {
    const response = await uploadFontsWithCredential(pending.map((entry) => entry.file), credential.value);
    response.results.forEach((result, index) => {
      const entry = pending[index];
      if (!entry) return;
      entry.status = result.status;
      entry.result = result;
      entry.message = result.error ?? undefined;
    });
    identity.value = await verifyUploadCredential(credential.value);
    await loadHistory();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pending.forEach((entry) => { entry.status = "error"; entry.message = message; });
    uploadError.value = message;
  } finally {
    uploadRunning.value = false;
  }
};

const loadHistory = async () => {
  if (!credential.value) return;
  historyLoading.value = true;
  try { history.value = (await getMyUploadHistory(credential.value, 1, 20)).data; }
  catch { history.value = []; }
  finally { historyLoading.value = false; }
};

const statusClass = (status: QueueStatus | ApiUploadHistoryItem["status"]) => ({
  pending: "bg-ink-50 text-ink-500 border-ink-100",
  uploading: "bg-sakura-50 text-sakura-500 border-sakura-100",
  success: "bg-mint-50 text-mint-600 border-mint-200",
  duplicate: "bg-sky-50 text-sky-500 border-sky-200",
  rejected: "bg-amber-50 text-amber-600 border-amber-200",
  error: "bg-rose-50 text-rose-600 border-rose-200",
}[status]);

const onDragEnter = (event: DragEvent) => { event.preventDefault(); dragCounter++; dragActive.value = true; };
const onDragOver = (event: DragEvent) => event.preventDefault();
const onDragLeave = (event: DragEvent) => { event.preventDefault(); if (--dragCounter <= 0) { dragCounter = 0; dragActive.value = false; } };
const onDrop = (event: DragEvent) => {
  event.preventDefault(); dragCounter = 0; dragActive.value = false;
  if (event.dataTransfer?.files) addToQueue(event.dataTransfer.files);
};

onMounted(async () => {
  if (credential.value) await connectCredential(credential.value);
  if (storedApplication.value) await refreshApplication();
});
onBeforeUnmount(() => clearTimeout(dropErrorTimer));
</script>

<template>
  <div class="flex flex-col gap-7">
    <header class="max-w-3xl">
      <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-sakura-500">
        <ShieldCheck class="h-3.5 w-3.5" />
        {{ t('uploadPortalEyebrow') }}
      </div>
      <h1 class="font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{{ t('uploadPortalTitle') }}</h1>
      <p class="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500">{{ t('uploadPortalDesc') }}</p>
    </header>

    <template v-if="!identity">
      <div v-if="storedApplication" class="rounded-2xl border border-ink-100 bg-surface px-4 py-4 sm:px-5">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div class="flex min-w-0 flex-1 items-start gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-50 text-ink-500">
              <Clock3 v-if="application?.status === 'pending'" class="h-4 w-4" />
              <BadgeCheck v-else-if="application?.status === 'approved' || application?.status === 'claimed'" class="h-4 w-4" />
              <XCircle v-else class="h-4 w-4" />
            </div>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-display font-semibold text-ink-900">{{ t('uploadApplicationReceipt') }}</span>
                <span v-if="application" class="rounded-full border px-2 py-0.5 text-[11px] font-semibold" :class="applicationTone">
                  {{ t(`uploadApplicationStatus_${application.status}`) }}
                </span>
              </div>
              <p class="mt-1 truncate font-mono text-xs text-ink-400">{{ storedApplication.id }}</p>
              <p v-if="application?.public_note" class="mt-1 text-xs text-ink-500">{{ application.public_note }}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <KButton variant="ghost" size="sm" :loading="applicationLoading" @click="refreshApplication">
              <RefreshCcw class="h-3.5 w-3.5" />{{ t('refresh') }}
            </KButton>
            <KButton v-if="application?.status === 'approved'" variant="primary" size="sm" :loading="applicationLoading" @click="claimApplication">
              <KeyRound class="h-3.5 w-3.5" />{{ t('uploadApplicationClaim') }}
            </KButton>
            <KButton v-if="application?.status === 'claimed'" variant="primary" size="sm" @click="useClaimedCredential">
              <KeyRound class="h-3.5 w-3.5" />{{ t('uploadApplicationUseCredential') }}
            </KButton>
            <KButton variant="ghost" size="sm" @click="clearApplicationReceipt">{{ t('uploadApplicationClearReceipt') }}</KButton>
          </div>
        </div>
        <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <div class="min-w-0 rounded-xl bg-ink-50 px-3 py-2 font-mono text-xs text-ink-600 break-all">{{ storedApplication.secret }}</div>
          <KButton variant="outline" size="sm" @click="copyText('secret', storedApplication.secret)">
            <Copy class="h-3.5 w-3.5" />{{ copyState === 'secret' ? t('copiedLabel') : t('copy') }}
          </KButton>
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-amber-600">{{ t('uploadApplicationSecretWarning') }}</p>
      </div>

      <div class="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <div class="pt-2 lg:pt-6">
          <ol class="flex flex-col gap-5">
            <li v-for="(step, index) in [t('uploadPortalStepApply'), t('uploadPortalStepReview'), t('uploadPortalStepUpload')]" :key="step" class="flex gap-3">
              <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sakura-200 bg-sakura-50 font-display text-xs font-bold text-sakura-600">{{ index + 1 }}</span>
              <p class="pt-0.5 text-sm leading-relaxed text-ink-600">{{ step }}</p>
            </li>
          </ol>
          <div class="mt-7 flex items-start gap-2 text-xs leading-relaxed text-ink-400">
            <ShieldCheck class="mt-0.5 h-3.5 w-3.5 shrink-0" />{{ t('uploadPortalSecurity') }}
          </div>
        </div>

        <section class="overflow-hidden rounded-2xl border border-ink-100 bg-surface shadow-[var(--shadow-sm)]">
          <div class="grid grid-cols-2 border-b border-ink-100 bg-ink-50/60 p-1.5">
            <button class="h-9 rounded-xl text-sm font-medium transition-colors" :class="portalMode === 'credential' ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'" @click="portalMode = 'credential'">
              {{ t('uploadPortalHaveCredential') }}
            </button>
            <button class="h-9 rounded-xl text-sm font-medium transition-colors" :class="portalMode === 'apply' ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'" @click="portalMode = 'apply'">
              {{ t('uploadPortalApply') }}
            </button>
          </div>

          <div v-if="portalMode === 'credential'" class="p-5 sm:p-6">
            <div class="mb-5 flex items-start gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sakura-100 bg-sakura-50 text-sakura-500"><KeyRound class="h-4 w-4" /></div>
              <div><h2 class="font-display font-semibold text-ink-900">{{ t('uploadCredentialTitle') }}</h2><p class="mt-1 text-sm text-ink-400">{{ t('uploadCredentialDesc') }}</p></div>
            </div>
            <KInput v-model="credentialInput" type="password" :label="t('uploadCredentialLabel')" :placeholder="t('uploadCredentialPlaceholder')" @enter="connectCredential()" />
            <p v-if="credentialError" class="mt-2 text-xs text-rose-500">{{ credentialError }}</p>
            <KButton class="mt-4 w-full" size="lg" :loading="credentialLoading" :disabled="!credentialInput.trim()" @click="connectCredential()">
              {{ t('uploadCredentialConnect') }}
            </KButton>
          </div>

          <form v-else class="p-5 sm:p-6" @submit.prevent="submitApplication">
            <div class="mb-5 flex items-start gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-500"><Send class="h-4 w-4" /></div>
              <div><h2 class="font-display font-semibold text-ink-900">{{ t('uploadApplicationTitle') }}</h2><p class="mt-1 text-sm text-ink-400">{{ t('uploadApplicationDesc') }}</p></div>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <KInput v-model="applicationName" :label="t('uploadApplicationName')" :placeholder="t('uploadApplicationNamePlaceholder')" />
              <KInput v-model="applicationContact" :label="t('uploadApplicationContact')" :placeholder="t('uploadApplicationContactPlaceholder')" />
            </div>
            <label class="mt-4 flex flex-col gap-1.5 text-xs font-medium text-ink-600">
              {{ t('uploadApplicationPurpose') }}
              <textarea v-model="applicationPurpose" rows="4" maxlength="1000" :placeholder="t('uploadApplicationPurposePlaceholder')" class="resize-none rounded-xl border border-ink-200 bg-surface px-3.5 py-3 text-sm font-normal text-ink-900 outline-none transition focus:border-sakura-400 focus:ring-2 focus:ring-sakura-400/20" />
            </label>
            <KInput v-model="applicationVolume" class="mt-4" :label="t('uploadApplicationVolume')" :placeholder="t('uploadApplicationVolumePlaceholder')" />
            <p v-if="applicationError" class="mt-3 text-xs text-rose-500">{{ applicationError }}</p>
            <KButton class="mt-5 w-full" size="lg" :loading="applicationSubmitting" :disabled="!canApply" @click="submitApplication">
              <Send class="h-4 w-4" />{{ t('uploadApplicationSubmit') }}
            </KButton>
          </form>
        </section>
      </div>
    </template>

    <template v-else>
      <section class="flex flex-col gap-4 border-b border-ink-100 pb-5 sm:flex-row sm:items-center">
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-mint-200 bg-mint-50 text-mint-600"><BadgeCheck class="h-5 w-5" /></div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2"><h2 class="font-display text-lg font-semibold text-ink-900">{{ identity.name }}</h2><code class="rounded-md bg-ink-50 px-1.5 py-0.5 font-mono text-[11px] text-ink-400">fia_{{ identity.prefix }}_…</code></div>
            <p class="mt-1 text-xs text-ink-400">{{ t('uploadPortalIdentityStats', { files: identity.accepted_file_count, bytes: formatBytes(identity.accepted_bytes) }) }}</p>
          </div>
        </div>
        <KButton variant="ghost" size="sm" @click="disconnectCredential"><LogOut class="h-3.5 w-3.5" />{{ t('uploadCredentialDisconnect') }}</KButton>
      </section>

      <div class="grid gap-7 lg:grid-cols-[1.45fr_0.75fr]">
        <section class="min-w-0">
          <div class="drop-zone cursor-pointer px-5 py-11 text-center" :class="dragActive ? 'active bg-sakura-50' : ''" @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop" @click="chooseFiles">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sakura-50 text-sakura-500"><CloudUpload class="h-6 w-6" /></div>
            <h2 class="mt-4 font-display font-semibold text-ink-800">{{ t('uploadPortalDropTitle') }}</h2>
            <p class="mt-1 text-xs text-ink-400">{{ t('uploadPortalDropHint') }}</p>
          </div>
          <p v-if="dropError || uploadError" class="mt-3 flex items-center gap-2 text-xs text-rose-500"><AlertTriangle class="h-3.5 w-3.5" />{{ dropError || uploadError }}</p>

          <div v-if="queue.length" class="mt-5 flex flex-col gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm text-ink-500">{{ t('uploadPortalQueue', { n: queue.length }) }}</span>
              <div class="flex-1" />
              <KButton variant="ghost" size="sm" :disabled="uploadRunning" @click="clearQueue"><X class="h-3.5 w-3.5" />{{ t('clearLabel') }}</KButton>
              <KButton size="sm" :loading="uploadRunning" :disabled="!pendingEntries.length" @click="startUpload"><CloudUpload class="h-3.5 w-3.5" />{{ t('uploadPortalStart') }}</KButton>
            </div>
            <div class="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
              <div v-for="(entry, index) in queue" :key="`${entry.file.name}-${index}`" class="flex items-center gap-3 rounded-xl border px-3 py-2.5" :class="statusClass(entry.status)">
                <Loader2 v-if="entry.status === 'uploading'" class="h-4 w-4 shrink-0 animate-spin-slow" />
                <CheckCircle2 v-else-if="entry.status === 'success' || entry.status === 'duplicate'" class="h-4 w-4 shrink-0" />
                <AlertTriangle v-else-if="entry.status === 'rejected' || entry.status === 'error'" class="h-4 w-4 shrink-0" />
                <FileText v-else class="h-4 w-4 shrink-0" />
                <span class="min-w-0 flex-1 truncate font-mono text-xs text-ink-700">{{ entry.file.name }}</span>
                <span v-if="entry.status !== 'pending' && entry.status !== 'uploading'" class="text-[11px] font-semibold">{{ t(`apiUploadStatus_${entry.status}`) }}</span>
                <span class="text-[11px] text-ink-400">{{ formatBytes(entry.file.size) }}</span>
                <button v-if="entry.status !== 'uploading'" class="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-ink-100" @click="removeEntry(index)"><X class="h-3 w-3" /></button>
              </div>
            </div>
          </div>
        </section>

        <aside class="min-w-0 lg:border-l lg:border-ink-100 lg:pl-6">
          <div class="mb-3 flex items-center gap-2"><History class="h-4 w-4 text-sakura-500" /><h2 class="font-display font-semibold text-ink-900">{{ t('uploadPortalRecent') }}</h2><button class="ml-auto text-ink-300 hover:text-ink-600" @click="loadHistory"><RefreshCcw class="h-3.5 w-3.5" /></button></div>
          <div v-if="historyLoading" class="flex justify-center py-10 text-ink-300"><Loader2 class="h-5 w-5 animate-spin-slow" /></div>
          <p v-else-if="!history.length" class="py-8 text-center text-xs text-ink-400">{{ t('uploadPortalHistoryEmpty') }}</p>
          <div v-else class="flex flex-col gap-2">
            <div v-for="item in history" :key="item.id" class="rounded-xl border border-ink-100 bg-surface px-3 py-2.5">
              <div class="flex items-center gap-2"><span class="min-w-0 flex-1 truncate font-mono text-xs text-ink-700">{{ item.filename }}</span><span class="rounded-md border px-1.5 py-0.5 text-[10px] font-semibold" :class="statusClass(item.status)">{{ t(`apiUploadStatus_${item.status}`) }}</span></div>
              <div class="mt-1 flex items-center justify-between text-[10px] text-ink-400"><span>{{ formatBytes(item.size) }}</span><span>{{ new Date(item.uploaded_at).toLocaleString() }}</span></div>
            </div>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>
