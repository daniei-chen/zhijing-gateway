<template>
    <div class="space-y-6">
      <!-- S3 Storage Config -->
      <div class="card p-6">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-base font-semibold text-gray-900 dark:text-white">
              {{ t('admin.backup.s3.title') }}
            </h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {{ t('admin.backup.s3.descriptionPrefix') }}
              <button type="button" class="text-primary-600 underline hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300" @click="showR2Guide = true">Cloudflare R2</button>
              {{ t('admin.backup.s3.descriptionSuffix') }}
            </p>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.s3.endpoint') }}</label>
            <input v-model="s3Form.endpoint" class="input w-full" placeholder="https://<account_id>.r2.cloudflarestorage.com" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.s3.region') }}</label>
            <input v-model="s3Form.region" class="input w-full" placeholder="auto" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.s3.bucket') }}</label>
            <input v-model="s3Form.bucket" class="input w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.s3.prefix') }}</label>
            <input v-model="s3Form.prefix" class="input w-full" placeholder="backups/" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.s3.accessKeyId') }}</label>
            <input v-model="s3Form.access_key_id" class="input w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.s3.secretAccessKey') }}</label>
            <input v-model="s3Form.secret_access_key" type="password" class="input w-full" :placeholder="s3SecretConfigured ? t('admin.backup.s3.secretConfigured') : ''" />
          </div>
          <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 md:col-span-2">
            <input v-model="s3Form.force_path_style" type="checkbox" />
            <span>{{ t('admin.backup.s3.forcePathStyle') }}</span>
          </label>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" class="btn btn-secondary btn-sm" :disabled="testingS3" @click="testS3">
            {{ testingS3 ? t('common.loading') : t('admin.backup.s3.testConnection') }}
          </button>
          <button type="button" class="btn btn-primary btn-sm" :disabled="savingS3 || loadingS3" @click="saveS3Config">
            {{ savingS3 ? t('common.loading') : t('common.save') }}
          </button>
        </div>
      </div>

      <!-- Async image object storage -->
      <div class="card p-6">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-base font-semibold text-gray-900 dark:text-white">
              {{ t('admin.backup.imageStorage.title') }}
            </h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {{ t('admin.backup.imageStorage.description') }}
            </p>
          </div>
          <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input v-model="imageStorageForm.enabled" type="checkbox" />
            <span>{{ t('admin.backup.imageStorage.enabled') }}</span>
          </label>
        </div>

        <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input v-model="imageStorageForm.reuse_backup_s3" type="checkbox" />
          <span>{{ t('admin.backup.imageStorage.reuseBackupS3') }}</span>
        </label>

        <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.imageStorage.bucket') }}</label>
            <input v-model="imageStorageForm.bucket" class="input w-full" :placeholder="imageStorageForm.reuse_backup_s3 ? t('admin.backup.imageStorage.bucketInherited') : ''" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.imageStorage.prefix') }}</label>
            <input v-model="imageStorageForm.prefix" class="input w-full" placeholder="images/" />
          </div>

          <template v-if="!imageStorageForm.reuse_backup_s3">
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.s3.endpoint') }}</label>
              <input v-model="imageStorageForm.endpoint" class="input w-full" placeholder="https://<account_id>.r2.cloudflarestorage.com" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.s3.region') }}</label>
              <input v-model="imageStorageForm.region" class="input w-full" placeholder="auto" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.s3.accessKeyId') }}</label>
              <input v-model="imageStorageForm.access_key_id" class="input w-full" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.s3.secretAccessKey') }}</label>
              <input v-model="imageStorageForm.secret_access_key" type="password" class="input w-full" :placeholder="imageStorageSecretConfigured ? t('admin.backup.s3.secretConfigured') : ''" />
            </div>
            <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 md:col-span-2">
              <input v-model="imageStorageForm.force_path_style" type="checkbox" />
              <span>{{ t('admin.backup.s3.forcePathStyle') }}</span>
            </label>
          </template>

          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.imageStorage.publicBaseUrl') }}</label>
            <input v-model="imageStorageForm.public_base_url" class="input w-full" :placeholder="t('admin.backup.imageStorage.publicBaseUrlPlaceholder')" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.imageStorage.presignExpiryHours') }}</label>
            <input v-model.number="imageStorageForm.presign_expiry_hours" type="number" min="1" class="input w-full" />
          </div>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" class="btn btn-secondary btn-sm" :disabled="testingImageStorage" @click="testImageStorage">
            {{ testingImageStorage ? t('common.loading') : t('admin.backup.s3.testConnection') }}
          </button>
          <button type="button" class="btn btn-primary btn-sm" :disabled="savingImageStorage || loadingImageStorage" @click="saveImageStorageConfig">
            {{ savingImageStorage ? t('common.loading') : t('common.save') }}
          </button>
        </div>
      </div>

      <!-- Schedule Config -->
      <div class="card p-6" data-testid="backup-schedule">
        <div class="mb-4">
          <h3 class="text-base font-semibold text-gray-900 dark:text-white">
            {{ t('admin.backup.schedule.title') }}
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ t('admin.backup.schedule.description') }}
          </p>
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 md:col-span-2">
            <input v-model="scheduleForm.enabled" type="checkbox" />
            <span>{{ t('admin.backup.schedule.enabled') }}</span>
          </label>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.schedule.cronExpr') }}</label>
            <input v-model="scheduleForm.cron_expr" class="input w-full" placeholder="0 2 * * *" />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.backup.schedule.cronHint') }}</p>
          </div>
          <h4 class="mt-2 text-sm font-medium text-gray-900 dark:text-white md:col-span-2">{{ t('admin.backup.schedule.ordinaryRetention') }}</h4>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.schedule.retainDays') }}</label>
            <input v-model.number="scheduleForm.retain_days" data-testid="backup-retain-days" type="number" min="0" step="1" class="input w-full" />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.backup.schedule.retainDaysHint') }}</p>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('admin.backup.schedule.retainCount') }}</label>
            <input v-model.number="scheduleForm.retain_count" data-testid="backup-retain-count" type="number" min="0" step="1" class="input w-full" />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.backup.schedule.retainCountHint') }}</p>
          </div>
        </div>
        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.backup.schedule.ordinaryHint') }}</p>
        <BackupArchiveSettings v-model="archiveForm" />
        <p v-if="scheduleValidationError" class="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{{ scheduleValidationError }}</p>
        <div class="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-dark-800 dark:text-gray-300" aria-live="polite">
          <p class="font-medium">{{ t('admin.backup.schedule.preview') }}</p>
          <p>{{ retentionPreview }}</p>
        </div>
        <div class="mt-4">
          <button type="button" class="btn btn-primary btn-sm" :disabled="savingSchedule || loadingSchedule || !!scheduleValidationError" @click="saveSchedule">
            {{ savingSchedule ? t('common.loading') : t('common.save') }}
          </button>
        </div>
      </div>

      <!-- Backup Operations -->
      <div class="card p-6">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-base font-semibold text-gray-900 dark:text-white">
              {{ t('admin.backup.operations.title') }}
            </h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {{ t('admin.backup.operations.description') }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <div class="flex items-center gap-1">
              <label class="text-xs text-gray-600 dark:text-gray-400">{{ t('admin.backup.operations.expireDays') }}</label>
              <input ref="manualExpireDaysInput" v-model.number="manualExpireDays" type="number" min="0" step="1" required class="input w-20 text-xs" />
            </div>
            <button type="button" class="btn btn-primary btn-sm" :disabled="creatingBackup" @click="createBackup">
              {{ creatingBackup ? t('admin.backup.operations.backing') : t('admin.backup.operations.createBackup') }}
            </button>
            <button type="button" class="btn btn-secondary btn-sm" :disabled="loadingBackups" @click="loadBackups">
              {{ loadingBackups ? t('common.loading') : t('common.refresh') }}
            </button>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full min-w-[800px] text-sm">
            <thead>
              <tr class="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-dark-700 dark:text-gray-400">
                <th class="py-2 pr-4">ID</th>
                <th class="py-2 pr-4">{{ t('admin.backup.columns.status') }}</th>
                <th class="py-2 pr-4">{{ t('admin.backup.columns.fileName') }}</th>
                <th class="py-2 pr-4">{{ t('admin.backup.columns.size') }}</th>
                <th class="py-2 pr-4">{{ t('admin.backup.columns.parts') }}</th>
                <th class="py-2 pr-4">{{ t('admin.backup.columns.expiresAt') }}</th>
                <th class="py-2 pr-4">{{ t('admin.backup.columns.triggeredBy') }}</th>
                <th class="py-2 pr-4">{{ t('admin.backup.columns.startedAt') }}</th>
                <th class="py-2">{{ t('admin.backup.columns.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in backups" :key="record.id" class="border-b border-gray-100 align-top dark:border-dark-800">
                <td class="py-3 pr-4 font-mono text-xs">{{ record.id }}</td>
                <td class="py-3 pr-4">
                  <span
                    class="rounded px-2 py-0.5 text-xs"
                    :class="statusClass(record.status)"
                  >
                    {{ record.status === 'running' && record.progress
                      ? t(`admin.backup.progress.${record.progress}`)
                      : t(`admin.backup.status.${record.status}`) }}
                  </span>
                </td>
                <td class="py-3 pr-4 text-xs">
                  {{ record.file_name }}
                  <span v-if="record.monthly_archive" class="ml-1 inline-block rounded bg-primary-50 px-1.5 py-0.5 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">{{ t('admin.backup.archive.badge') }}</span>
                  <div v-if="record.monthly_archive" class="mt-1 text-gray-500 dark:text-gray-400">{{ record.monthly_archive.dates.join(' / ') }}</div>
                </td>
                <td class="py-3 pr-4 text-xs">{{ formatSize(record.size_bytes) }}</td>
                <td class="py-3 pr-4 text-xs">{{ record.parts?.length || (record.status === 'running' ? '-' : 1) }}</td>
                <td class="py-3 pr-4 text-xs">
                  {{ record.monthly_archive
                    ? record.monthly_archive.retain_count === 0 ? t('admin.backup.archive.forever') : t('admin.backup.archive.retainLatest', { count: record.monthly_archive.retain_count })
                    : record.expires_at ? formatDate(record.expires_at) : t('admin.backup.neverExpire') }}
                </td>
                <td class="py-3 pr-4 text-xs">
                  {{ record.triggered_by === 'scheduled' ? t('admin.backup.trigger.scheduled') : t('admin.backup.trigger.manual') }}
                </td>
                <td class="py-3 pr-4 text-xs">{{ formatDate(record.started_at) }}</td>
                <td class="py-3 text-xs">
                  <div class="flex flex-wrap gap-1">
                    <button
                      v-if="record.status === 'completed'"
                      type="button"
                      class="btn btn-secondary btn-xs"
                      :disabled="downloadingIds.has(record.id)"
                      @click="downloadBackup(record.id)"
                    >
                      {{ t('admin.backup.actions.download') }}
                    </button>
                    <button
                      v-if="record.status === 'completed'"
                      type="button"
                      class="btn btn-secondary btn-xs"
                      :disabled="restoringId === record.id || restoringRequests.has(record.id)"
                      @click="restoreBackup(record.id)"
                    >
                      {{ restoringId === record.id || restoringRequests.has(record.id) ? t('common.loading') : t('admin.backup.actions.restore') }}
                    </button>
                    <button
                      v-if="record.status !== 'running'"
                      type="button"
                      class="btn btn-danger btn-xs"
                      :disabled="deletingIds.has(record.id)"
                      @click="removeBackup(record.id)"
                    >
                      {{ t('common.delete') }}
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="backups.length === 0">
                <td colspan="9" class="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                  {{ t('admin.backup.empty') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Cloudflare R2 Setup Guide Modal -->
    <teleport to="body">
      <transition name="modal">
        <div v-if="showR2Guide" class="fixed inset-0 z-50 flex items-center justify-center p-4" @mousedown.self="showR2Guide = false">
          <div class="fixed inset-0 bg-black/50" @click="showR2Guide = false"></div>
          <div class="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl dark:bg-dark-800">
            <button type="button" class="absolute right-4 top-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" @click="showR2Guide = false">
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>

            <h2 class="mb-4 text-lg font-bold text-gray-900 dark:text-white">{{ t('admin.backup.r2Guide.title') }}</h2>
            <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.backup.r2Guide.intro') }}</p>

            <!-- Step 1 -->
            <div class="mb-5">
              <h3 class="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <span class="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">1</span>
                {{ t('admin.backup.r2Guide.step1.title') }}
              </h3>
              <ol class="ml-8 list-decimal space-y-1 text-sm text-gray-600 dark:text-gray-300">
                <li>{{ t('admin.backup.r2Guide.step1.line1') }}</li>
                <li>{{ t('admin.backup.r2Guide.step1.line2') }}</li>
                <li>{{ t('admin.backup.r2Guide.step1.line3') }}</li>
              </ol>
            </div>

            <!-- Step 2 -->
            <div class="mb-5">
              <h3 class="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <span class="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">2</span>
                {{ t('admin.backup.r2Guide.step2.title') }}
              </h3>
              <ol class="ml-8 list-decimal space-y-1 text-sm text-gray-600 dark:text-gray-300">
                <li>{{ t('admin.backup.r2Guide.step2.line1') }}</li>
                <li>{{ t('admin.backup.r2Guide.step2.line2') }}</li>
                <li>{{ t('admin.backup.r2Guide.step2.line3') }}</li>
                <li>{{ t('admin.backup.r2Guide.step2.line4') }}</li>
              </ol>
              <div class="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                {{ t('admin.backup.r2Guide.step2.warning') }}
              </div>
            </div>

            <!-- Step 3 -->
            <div class="mb-5">
              <h3 class="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <span class="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">3</span>
                {{ t('admin.backup.r2Guide.step3.title') }}
              </h3>
              <p class="ml-8 text-sm text-gray-600 dark:text-gray-300">{{ t('admin.backup.r2Guide.step3.desc') }}</p>
              <code class="ml-8 mt-1 block rounded bg-gray-100 px-3 py-2 text-xs text-gray-800 dark:bg-dark-700 dark:text-gray-200">https://&lt;{{ t('admin.backup.r2Guide.step3.accountId') }}&gt;.r2.cloudflarestorage.com</code>
            </div>

            <!-- Step 4: Fill form -->
            <div class="mb-5">
              <h3 class="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <span class="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">4</span>
                {{ t('admin.backup.r2Guide.step4.title') }}
              </h3>
              <div class="ml-8 overflow-hidden rounded-lg border border-gray-200 dark:border-dark-600">
                <table class="w-full text-sm">
                  <tbody>
                    <tr v-for="(row, i) in r2ConfigRows" :key="i" class="border-b border-gray-100 dark:border-dark-700 last:border-0">
                      <td class="whitespace-nowrap bg-gray-50 px-3 py-2 font-medium text-gray-700 dark:bg-dark-700 dark:text-gray-300">{{ row.field }}</td>
                      <td class="px-3 py-2 text-gray-600 dark:text-gray-400"><code class="text-xs">{{ row.value }}</code></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Free tier note -->
            <div class="rounded-lg bg-green-50 p-3 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-300">
              {{ t('admin.backup.r2Guide.freeTier') }}
            </div>

            <div class="mt-4 text-right">
              <button type="button" class="btn btn-primary btn-sm" @click="showR2Guide = false">{{ t('common.close') }}</button>
            </div>
          </div>
        </div>
      </transition>
    </teleport>
    <!-- 分卷下载链接 -->
    <teleport to="body">
      <transition name="modal">
        <div
          v-if="downloadPartsModalOpen"
          class="fixed inset-0 z-50 flex items-center justify-center p-4"
          @mousedown.self="closeDownloadParts"
        >
          <div class="fixed inset-0 bg-black/50" @click="closeDownloadParts"></div>
          <div class="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-2xl dark:bg-dark-800">
            <button
              type="button"
              class="absolute right-4 top-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              :aria-label="t('common.close')"
              @click="closeDownloadParts"
            >
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <h2 class="mb-1 text-lg font-bold text-gray-900 dark:text-white">{{ t('admin.backup.actions.downloadParts') }}</h2>
            <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">{{ t('admin.backup.actions.downloadPartsHint') }}</p>
            <div class="space-y-2">
              <div
                v-for="part in downloadParts"
                :key="part.index"
                class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-dark-600"
              >
                <span class="text-sm text-gray-700 dark:text-gray-300">
                  {{ t('admin.backup.actions.partLabel', { index: part.index }) }}
                  <span class="ml-2 text-xs text-gray-500 dark:text-gray-400">{{ formatSize(part.size_bytes) }}</span>
                </span>
                <a :href="part.url" class="btn btn-secondary btn-xs" rel="noopener">
                  {{ t('admin.backup.actions.download') }}
                </a>
              </div>
            </div>
            <div class="mt-4 text-right">
              <button type="button" class="btn btn-primary btn-sm" @click="closeDownloadParts">{{ t('common.close') }}</button>
            </div>
          </div>
        </div>
      </transition>
    </teleport>
    <TotpStepUpDialog :controller="backupStepUp" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { adminAPI } from '@/api'
import { useAppStore } from '@/stores'
import type {
  BackupS3Config,
  BackupScheduleConfig,
  BackupMonthlyArchiveConfig,
  BackupRecord,
  BackupDownloadPart,
  ImageStorageConfig,
} from '@/api/admin/backup'
import { useStepUp, isStepUpBlocked, isStepUpCancelled, stepUpBlockReason, StepUpCancelledError } from '@/composables/useStepUp'
import { createSessionTasks } from '@/utils/sessionTasks'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog.vue'
import BackupArchiveSettings from '@/components/admin/BackupArchiveSettings.vue'

const { t } = useI18n()
const appStore = useAppStore()
const backupStepUp = useStepUp()
const pageTasks = createSessionTasks()
type BackupTask = ReturnType<typeof pageTasks.begin>

function cloneConfig<T>(config: T): T {
  return JSON.parse(JSON.stringify(config)) as T
}

function sameDraft(current: unknown, initial: unknown): boolean {
  return JSON.stringify(current) === JSON.stringify(initial)
}

/** Hydrate persisted fields without replacing input entered during the request. */
function mergeUneditedFields<T extends object>(current: T, initial: T, received: T): T {
  const merged = { ...current }
  for (const key of Object.keys(received) as Array<keyof T>) {
    if (sameDraft(current[key], initial[key])) merged[key] = received[key]
  }
  return merged
}

function runBackupStepUp<T>(task: BackupTask, action: () => Promise<T>): Promise<T> {
  return backupStepUp.run(() => {
    if (!task.active()) throw new StepUpCancelledError()
    return action()
  })
}

// 敏感操作被 2FA 门控拦截时的统一提示。
function reportStepUpBlocked(error: unknown): boolean {
  if (!isStepUpBlocked(error)) return false
  appStore.showError(
    stepUpBlockReason(error) === 'STEP_UP_ADMIN_API_KEY_FORBIDDEN'
      ? t('stepUp.adminApiKeyForbidden')
      : t('stepUp.notEnabled')
  )
  return true
}

// S3 config
const s3Form = ref<BackupS3Config>({
  endpoint: '',
  region: 'auto',
  bucket: '',
  access_key_id: '',
  secret_access_key: '',
  prefix: 'backups/',
  force_path_style: false,
})
const s3SecretConfigured = ref(false)
const loadingS3 = ref(false)
const savingS3 = ref(false)
const testingS3 = ref(false)

// Async image object storage. Shares the S3 client with backups, so the default is
// to reuse the credentials configured above and only differ by prefix.
const imageStorageForm = ref<ImageStorageConfig>({
  enabled: false,
  reuse_backup_s3: true,
  bucket: '',
  prefix: 'images/',
  public_base_url: '',
  presign_expiry_hours: 24,
  max_download_bytes: 33554432,
  endpoint: '',
  region: 'auto',
  access_key_id: '',
  secret_access_key: '',
  force_path_style: false,
})
const imageStorageSecretConfigured = ref(false)
const loadingImageStorage = ref(false)
const savingImageStorage = ref(false)
const testingImageStorage = ref(false)

// Schedule config
const scheduleForm = ref<BackupScheduleConfig>({
  enabled: false,
  cron_expr: '0 2 * * *',
  retain_days: 14,
  retain_count: 10,
})
const savingSchedule = ref(false)
const loadingSchedule = ref(false)
const archiveForm = ref<BackupMonthlyArchiveConfig>({ enabled: false, days: [1], include_month_end: false, retain_count: 0 })
// Disabling hides the archive parameters, so a save while disabled keeps the
// persisted parameters and only turns the rule off.
const savedArchive = ref<BackupMonthlyArchiveConfig>(cloneArchive(archiveForm.value))
const archivePayload = computed<BackupMonthlyArchiveConfig>(() =>
  archiveForm.value.enabled ? cloneArchive(archiveForm.value) : { ...cloneArchive(savedArchive.value), enabled: false },
)
function cloneArchive(config: BackupMonthlyArchiveConfig): BackupMonthlyArchiveConfig {
  return { ...config, days: [...config.days] }
}
const scheduleValidationError = computed(() => {
  const counts = [scheduleForm.value.retain_days, scheduleForm.value.retain_count]
  if (archiveForm.value.enabled) counts.push(archiveForm.value.retain_count)
  if (!counts.every(value => Number.isSafeInteger(value) && value >= 0)) {
    return t('admin.backup.archive.invalidRetention')
  }
  if (archiveForm.value.enabled && !archiveForm.value.days.length && !archiveForm.value.include_month_end) {
    return t('admin.backup.archive.selectDates')
  }
  return ''
})
const retentionPreview = computed(() => {
  if (scheduleValidationError.value) return scheduleValidationError.value
  const { retain_days: days, retain_count: count } = scheduleForm.value
  const ordinary = days > 0 && count > 0
    ? t('admin.backup.schedule.previewBoth', { days, count })
    : days > 0 ? t('admin.backup.schedule.previewDays', { days })
      : count > 0 ? t('admin.backup.schedule.previewCount', { count }) : t('admin.backup.schedule.previewUnlimited')
  if (!archiveForm.value.enabled) return ordinary
  const dates = [
    ...[...archiveForm.value.days].sort((a, b) => a - b).map(day => t('admin.backup.archive.day', { day })),
    ...(archiveForm.value.include_month_end ? [t('admin.backup.archive.monthEnd')] : []),
  ].join(', ')
  const retention = archiveForm.value.retain_count === 0 ? t('admin.backup.archive.forever') : t('admin.backup.archive.retainLatest', { count: archiveForm.value.retain_count })
  return `${ordinary} ${t('admin.backup.archive.preview', { dates, retention })}`
})

// Backups
const backups = ref<BackupRecord[]>([])
const loadingBackups = ref(false)
const creatingBackup = ref(false)
const restoringId = ref('')
const manualExpireDays = ref(14)
const manualExpireDaysInput = ref<HTMLInputElement | null>(null)
const downloadParts = ref<BackupDownloadPart[]>([])
const downloadPartsModalOpen = ref(false)
const downloadingIds = ref(new Set<string>())
const restoringRequests = ref(new Set<string>())
const deletingIds = ref(new Set<string>())
let downloadRevision = 0
let restoreRevision = 0
let createRequestPending = false
const downloadOwners = new Map<string, object>()
const restoreOwners = new Map<string, object>()
const deleteOwners = new Map<string, object>()

function addPending(ids: Set<string>, id: string): Set<string> {
  return new Set([...ids, id])
}

function removePending(ids: Set<string>, id: string): Set<string> {
  const next = new Set(ids)
  next.delete(id)
  return next
}

// Polling
const pollingTimer = ref<ReturnType<typeof setInterval> | null>(null)
const restoringPollingTimer = ref<ReturnType<typeof setInterval> | null>(null)
const MAX_POLL_COUNT = 900
let disposed = false
let pollingTask: BackupTask | null = null
let restorePollingTask: BackupTask | null = null
let listTask: BackupTask | null = null

function updateRecordInList(updated: BackupRecord) {
  const idx = backups.value.findIndex(r => r.id === updated.id)
  if (idx >= 0) {
    backups.value[idx] = updated
  }
}

function startPolling(backupId: string) {
  if (disposed || !pageTasks.current() || document.hidden) return
  stopPolling()
  const request = pageTasks.begin('poll:backup')
  pollingTask = request
  request.signal.addEventListener('abort', () => {
    if (pollingTask !== request) return
    pollingTask = null
    if (pollingTimer.value) clearInterval(pollingTimer.value)
    pollingTimer.value = null
    request.finish()
  }, { once: true })
  const ownsPoll = () => !disposed && pollingTask === request && request.active()
  let inFlight = false
  let count = 0
  pollingTimer.value = setInterval(async () => {
    if (!ownsPoll()) return
    if (count++ >= MAX_POLL_COUNT) {
      stopPolling()
      creatingBackup.value = false
      appStore.showWarning(t('admin.backup.operations.backupRunning'))
      return
    }
    if (inFlight) return
    inFlight = true
    try {
      const record = await adminAPI.backup.getBackup(backupId, request.signal)
      if (!ownsPoll() || record.id !== backupId) return
      updateRecordInList(record)
      if (record.status === 'completed' || record.status === 'failed') {
        stopPolling()
        creatingBackup.value = false
        if (record.status === 'completed') {
          appStore.showSuccess(t('admin.backup.operations.backupCreated'))
        } else {
          appStore.showError(record.error_message || t('admin.backup.operations.backupFailed'))
        }
        await loadBackups()
      }
    } catch {
      // 轮询失败时不中断
    } finally {
      inFlight = false
    }
  }, 2000)
}

function stopPolling() {
  pageTasks.cancel('poll:backup')
  pollingTask?.finish()
  pollingTask = null
  if (pollingTimer.value) {
    clearInterval(pollingTimer.value)
    pollingTimer.value = null
  }
}

function startRestorePolling(backupId: string) {
  if (disposed || !pageTasks.current() || document.hidden) return
  stopRestorePolling()
  const request = pageTasks.begin('poll:restore')
  restorePollingTask = request
  request.signal.addEventListener('abort', () => {
    if (restorePollingTask !== request) return
    restorePollingTask = null
    if (restoringPollingTimer.value) clearInterval(restoringPollingTimer.value)
    restoringPollingTimer.value = null
    request.finish()
  }, { once: true })
  const ownsPoll = () => !disposed && restorePollingTask === request && request.active()
  let inFlight = false
  let count = 0
  restoringPollingTimer.value = setInterval(async () => {
    if (!ownsPoll()) return
    if (count++ >= MAX_POLL_COUNT) {
      stopRestorePolling()
      if (restoringId.value === backupId) {
        restoringId.value = ''
        appStore.showWarning(t('admin.backup.operations.restoreRunning'))
      }
      return
    }
    if (inFlight) return
    inFlight = true
    try {
      const record = await adminAPI.backup.getBackup(backupId, request.signal)
      if (!ownsPoll() || record.id !== backupId) return
      updateRecordInList(record)
      if (record.restore_status === 'completed' || record.restore_status === 'failed') {
        stopRestorePolling()
        if (restoringId.value === backupId) {
          restoringId.value = ''
          if (record.restore_status === 'completed') {
            appStore.showSuccess(t('admin.backup.actions.restoreSuccess'))
          } else {
            appStore.showError(record.restore_error || t('admin.backup.operations.restoreFailed'))
          }
        }
        await loadBackups()
      }
    } catch {
      // 轮询失败时不中断
    } finally {
      inFlight = false
    }
  }, 2000)
}

function stopRestorePolling() {
  pageTasks.cancel('poll:restore')
  restorePollingTask?.finish()
  restorePollingTask = null
  if (restoringPollingTimer.value) {
    clearInterval(restoringPollingTimer.value)
    restoringPollingTimer.value = null
  }
}

function handleVisibilityChange() {
  if (disposed || !pageTasks.current()) return
  if (document.hidden) {
    stopPolling()
    stopRestorePolling()
  } else {
    // 标签页恢复时刷新列表，检查是否仍有活跃操作
    loadBackups().then((loaded) => {
      if (!loaded || disposed || !pageTasks.current() || document.hidden) return
      const running = backups.value.find(r => r.status === 'running')
      if (running && !createRequestPending) {
        creatingBackup.value = true
        startPolling(running.id)
      }
      const restoring = backups.value.find(r => r.restore_status === 'running')
      if (restoring && restoreOwners.size === 0) {
        restoringId.value = restoring.id
        startRestorePolling(restoring.id)
      }
    })
  }
}

// R2 guide
const showR2Guide = ref(false)
const r2ConfigRows = computed(() => [
  { field: t('admin.backup.s3.endpoint'), value: 'https://<account_id>.r2.cloudflarestorage.com' },
  { field: t('admin.backup.s3.region'), value: 'auto' },
  { field: t('admin.backup.s3.bucket'), value: t('admin.backup.r2Guide.step4.bucketValue') },
  { field: t('admin.backup.s3.prefix'), value: 'backups/' },
  { field: 'Access Key ID', value: t('admin.backup.r2Guide.step4.fromStep2') },
  { field: 'Secret Access Key', value: t('admin.backup.r2Guide.step4.fromStep2') },
  { field: t('admin.backup.s3.forcePathStyle'), value: t('admin.backup.r2Guide.step4.unchecked') },
])

async function loadS3Config() {
  if (!pageTasks.current()) return
  const task = pageTasks.begin('load:s3')
  const initial = cloneConfig(s3Form.value)
  loadingS3.value = true
  try {
    const cfg = await adminAPI.backup.getS3Config()
    if (!task.active()) return
    const received: BackupS3Config = {
      endpoint: cfg.endpoint || '',
      region: cfg.region || 'auto',
      bucket: cfg.bucket || '',
      access_key_id: cfg.access_key_id || '',
      secret_access_key: '',
      prefix: cfg.prefix || 'backups/',
      force_path_style: cfg.force_path_style,
    }
    s3Form.value = mergeUneditedFields(s3Form.value, initial, received)
    s3SecretConfigured.value = Boolean(cfg.access_key_id)
  } catch (error) {
    if (task.active()) appStore.showError((error as { message?: string })?.message || t('errors.networkError'))
  } finally {
    if (task.owned()) loadingS3.value = false
    task.finish()
  }
}

async function saveS3Config() {
  if (!pageTasks.current() || savingS3.value || loadingS3.value) return
  const task = pageTasks.begin('save:s3')
  const request = cloneConfig(s3Form.value)
  savingS3.value = true
  try {
    await runBackupStepUp(task, () => adminAPI.backup.updateS3Config(request))
    if (!task.active()) return
    if (sameDraft(s3Form.value, request)) {
      appStore.showSuccess(t('admin.backup.s3.saved'))
      await loadS3Config()
    }
  } catch (error) {
    if (!task.active() || isStepUpCancelled(error)) return
    appStore.showError((error as { message?: string })?.message || t('errors.networkError'))
  } finally {
    if (task.owned()) savingS3.value = false
    task.finish()
  }
}

async function loadImageStorageConfig() {
  if (!pageTasks.current()) return
  const task = pageTasks.begin('load:image-storage')
  const initial = cloneConfig(imageStorageForm.value)
  loadingImageStorage.value = true
  try {
    const { config, secret_configured } = await adminAPI.backup.getImageStorageConfig()
    if (!task.active()) return
    const received: ImageStorageConfig = {
      ...config,
      prefix: config.prefix || 'images/',
      region: config.region || 'auto',
      secret_access_key: '',
    }
    imageStorageForm.value = mergeUneditedFields(imageStorageForm.value, initial, received)
    imageStorageSecretConfigured.value = secret_configured
  } catch (error) {
    if (task.active()) appStore.showError((error as { message?: string })?.message || t('errors.networkError'))
  } finally {
    if (task.owned()) loadingImageStorage.value = false
    task.finish()
  }
}

async function saveImageStorageConfig() {
  if (!pageTasks.current() || savingImageStorage.value || loadingImageStorage.value) return
  const task = pageTasks.begin('save:image-storage')
  const request = cloneConfig(imageStorageForm.value)
  savingImageStorage.value = true
  try {
    await runBackupStepUp(task, () => adminAPI.backup.updateImageStorageConfig(request))
    if (!task.active()) return
    if (sameDraft(imageStorageForm.value, request)) {
      appStore.showSuccess(t('admin.backup.imageStorage.saved'))
      await loadImageStorageConfig()
    }
  } catch (error) {
    if (!task.active() || isStepUpCancelled(error)) return
    appStore.showError((error as { message?: string })?.message || t('errors.networkError'))
  } finally {
    if (task.owned()) savingImageStorage.value = false
    task.finish()
  }
}

async function testImageStorage() {
  if (!pageTasks.current() || testingImageStorage.value) return
  const task = pageTasks.begin('test:image-storage')
  const request = cloneConfig(imageStorageForm.value)
  testingImageStorage.value = true
  try {
    const result = await adminAPI.backup.testImageStorageConnection(request)
    if (!task.active() || !sameDraft(imageStorageForm.value, request)) return
    if (result.ok) {
      appStore.showSuccess(result.message || t('admin.backup.s3.testSuccess'))
    } else {
      appStore.showError(result.message || t('admin.backup.s3.testFailed'))
    }
  } catch (error) {
    if (task.active() && sameDraft(imageStorageForm.value, request)) appStore.showError((error as { message?: string })?.message || t('errors.networkError'))
  } finally {
    if (task.owned()) testingImageStorage.value = false
    task.finish()
  }
}

async function testS3() {
  if (!pageTasks.current() || testingS3.value) return
  const task = pageTasks.begin('test:s3')
  const request = cloneConfig(s3Form.value)
  testingS3.value = true
  try {
    const result = await adminAPI.backup.testS3Connection(request)
    if (!task.active() || !sameDraft(s3Form.value, request)) return
    if (result.ok) {
      appStore.showSuccess(result.message || t('admin.backup.s3.testSuccess'))
    } else {
      appStore.showError(result.message || t('admin.backup.s3.testFailed'))
    }
  } catch (error) {
    if (task.active() && sameDraft(s3Form.value, request)) appStore.showError((error as { message?: string })?.message || t('errors.networkError'))
  } finally {
    if (task.owned()) testingS3.value = false
    task.finish()
  }
}

async function loadSchedule() {
  if (!pageTasks.current()) return
  const task = pageTasks.begin('load:schedule')
  const initial = cloneConfig(scheduleForm.value)
  const initialArchive = cloneArchive(archiveForm.value)
  loadingSchedule.value = true
  try {
    const cfg = await adminAPI.backup.getSchedule()
    if (!task.active()) return
    const received: BackupScheduleConfig = {
      enabled: cfg.enabled,
      cron_expr: cfg.cron_expr || '0 2 * * *',
      retain_days: cfg.retain_days ?? 14,
      retain_count: cfg.retain_count ?? 10,
    }
    const receivedArchive: BackupMonthlyArchiveConfig = {
      enabled: cfg.monthly_archive?.enabled ?? false,
      days: cfg.monthly_archive?.days ?? [1],
      include_month_end: cfg.monthly_archive?.include_month_end ?? false,
      retain_count: cfg.monthly_archive?.retain_count ?? 0,
    }
    scheduleForm.value = mergeUneditedFields(scheduleForm.value, initial, received)
    archiveForm.value = mergeUneditedFields(archiveForm.value, initialArchive, receivedArchive)
    savedArchive.value = cloneArchive(receivedArchive)
  } catch (error) {
    if (task.active()) appStore.showError((error as { message?: string })?.message || t('errors.networkError'))
  } finally {
    if (task.owned()) loadingSchedule.value = false
    task.finish()
  }
}

async function saveSchedule() {
  if (!pageTasks.current() || savingSchedule.value || loadingSchedule.value || scheduleValidationError.value) return
  const task = pageTasks.begin('save:schedule')
  const request = { ...cloneConfig(scheduleForm.value), monthly_archive: cloneArchive(archivePayload.value) }
  const draft = JSON.stringify({ config: scheduleForm.value, archive: archiveForm.value })
  savingSchedule.value = true
  try {
    await adminAPI.backup.updateSchedule(request)
    if (!task.active()) return
    savedArchive.value = cloneArchive(request.monthly_archive)
    if (draft === JSON.stringify({ config: scheduleForm.value, archive: archiveForm.value })) {
      appStore.showSuccess(t('admin.backup.schedule.saved'))
    }
  } catch (error) {
    if (task.active()) appStore.showError((error as { message?: string })?.message || t('errors.networkError'))
  } finally {
    if (task.owned()) savingSchedule.value = false
    task.finish()
  }
}

async function loadBackups() {
  if (disposed || !pageTasks.current()) return false
  const request = pageTasks.begin('load:list')
  listTask = request
  const ownsRequest = () => !disposed && listTask === request && request.active()
  loadingBackups.value = true
  try {
    const result = await adminAPI.backup.listBackups(request.signal)
    if (!ownsRequest()) return false
    backups.value = result.items || []
    return true
  } catch (error) {
    if (ownsRequest()) appStore.showError((error as { message?: string })?.message || t('errors.networkError'))
    return false
  } finally {
    if (listTask === request) {
      listTask = null
      if (pageTasks.current()) loadingBackups.value = false
    }
    request.finish()
  }
}

async function createBackup() {
  if (!pageTasks.current() || creatingBackup.value) return
  if (!Number.isSafeInteger(manualExpireDays.value) || manualExpireDays.value < 0) {
    manualExpireDaysInput.value?.reportValidity()
    appStore.showError(t('admin.backup.operations.invalidExpiryDays'))
    return
  }
  const task = pageTasks.begin('command:create')
  const request = { expire_days: manualExpireDays.value }
  let accepted = false
  createRequestPending = true
  creatingBackup.value = true
  try {
    const record = await runBackupStepUp(task, () => adminAPI.backup.createBackup(request))
    if (!task.active()) return
    // 插入到列表顶部
    backups.value.unshift(record)
    accepted = true
    startPolling(record.id)
  } catch (error: any) {
    if (!task.active() || isStepUpCancelled(error)) return
    if (reportStepUpBlocked(error)) return
    if (error?.status === 409 || error?.response?.status === 409) {
      appStore.showWarning(t('admin.backup.operations.alreadyInProgress'))
    } else {
      appStore.showError(error?.message || t('errors.networkError'))
    }
  } finally {
    if (task.owned()) {
      createRequestPending = false
      if (!accepted) creatingBackup.value = false
    }
    task.finish()
  }
}

async function downloadBackup(id: string) {
  if (!pageTasks.current() || downloadOwners.has(id)) return
  const revision = ++downloadRevision
  const owner = {}
  downloadOwners.set(id, owner)
  downloadingIds.value = addPending(downloadingIds.value, id)
  downloadPartsModalOpen.value = false
  downloadParts.value = []
  const task = pageTasks.begin(`download:${id}`, () => revision === downloadRevision)
  try {
    const result = await runBackupStepUp(task, () => adminAPI.backup.getDownloadURL(id))
    if (!task.active()) return
    if (result.parts && result.parts.length > 0) {
      downloadParts.value = result.parts
      downloadPartsModalOpen.value = true
      return
    }
    if (!result.url) {
      throw new Error(t('admin.backup.actions.downloadFailed'))
    }
    // 预签名 URL 带 attachment disposition，同页 anchor 导航直接触发下载；
    // 不用 window.open：step-up 弹窗 await 会耗尽瞬态用户激活，新标签页会被浏览器拦截。
    const link = document.createElement('a')
    link.href = result.url
    link.rel = 'noopener'
    link.click()
  } catch (error) {
    if (!task.active() || isStepUpCancelled(error)) return
    if (reportStepUpBlocked(error)) return
    appStore.showError((error as { message?: string })?.message || t('errors.networkError'))
  } finally {
    if (downloadOwners.get(id) === owner) {
      downloadOwners.delete(id)
      if (pageTasks.current()) downloadingIds.value = removePending(downloadingIds.value, id)
    }
    task.finish()
  }
}

function closeDownloadParts() {
  downloadRevision += 1
  pageTasks.cancel('download:')
  downloadOwners.clear()
  downloadingIds.value = new Set()
  downloadPartsModalOpen.value = false
  downloadParts.value = []
}

async function restoreBackup(id: string) {
  if (!pageTasks.current() || restoreOwners.has(id) || restoringId.value === id) return
  if (!window.confirm(t('admin.backup.actions.restoreConfirm'))) return
  if (!pageTasks.current()) return
  const password = window.prompt(t('admin.backup.actions.restorePasswordPrompt'))
  if (!password || !pageTasks.current()) return
  const revision = ++restoreRevision
  const owner = {}
  restoreOwners.set(id, owner)
  restoringRequests.value = addPending(restoringRequests.value, id)
  const task = pageTasks.begin(`restore:${id}`, () => revision === restoreRevision)
  restoringId.value = id
  try {
    const record = await runBackupStepUp(task, () => adminAPI.backup.restoreBackup(id, password))
    if (!task.active()) return
    updateRecordInList(record)
    startRestorePolling(id)
  } catch (error: any) {
    if (!task.active()) return
    if (restoringId.value === id) restoringId.value = ''
    if (isStepUpCancelled(error)) return
    if (reportStepUpBlocked(error)) return
    // apiClient 拦截器把 HTTP 错误归一化为顶层 { status } 平面对象（无 response 字段）
    if (error?.status === 409 || error?.response?.status === 409) {
      appStore.showWarning(t('admin.backup.operations.restoreRunning'))
    } else {
      appStore.showError(error?.message || t('errors.networkError'))
    }
  } finally {
    if (restoreOwners.get(id) === owner) {
      restoreOwners.delete(id)
      if (pageTasks.current()) restoringRequests.value = removePending(restoringRequests.value, id)
    }
    task.finish()
  }
}

async function removeBackup(id: string) {
  if (!pageTasks.current() || deleteOwners.has(id)) return
  const archived = !!backups.value.find(record => record.id === id)?.monthly_archive
  if (!window.confirm(t(archived ? 'admin.backup.archive.deleteConfirm' : 'admin.backup.actions.deleteConfirm'))) return
  if (!pageTasks.current()) return
  const owner = {}
  deleteOwners.set(id, owner)
  deletingIds.value = addPending(deletingIds.value, id)
  const task = pageTasks.begin(`delete:${id}`)
  try {
    await adminAPI.backup.deleteBackup(id, archived)
    if (!task.active()) return
    appStore.showSuccess(t('admin.backup.actions.deleted'))
    await loadBackups()
  } catch (error) {
    if (task.active()) appStore.showError((error as { message?: string })?.message || t('errors.networkError'))
  } finally {
    if (deleteOwners.get(id) === owner) {
      deleteOwners.delete(id)
      if (pageTasks.current()) deletingIds.value = removePending(deletingIds.value, id)
    }
    task.finish()
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    case 'running':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    case 'failed':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-dark-800 dark:text-gray-300'
  }
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

onMounted(async () => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  await Promise.all([loadS3Config(), loadImageStorageConfig(), loadSchedule(), loadBackups()])
  if (disposed || !pageTasks.current() || document.hidden) return

  // 如果有正在 running 的备份，恢复轮询
  const runningBackup = backups.value.find(r => r.status === 'running')
  if (runningBackup && !createRequestPending) {
    creatingBackup.value = true
    startPolling(runningBackup.id)
  }
  const restoringBackup = backups.value.find(r => r.restore_status === 'running')
  if (restoringBackup && restoreOwners.size === 0) {
    restoringId.value = restoringBackup.id
    startRestorePolling(restoringBackup.id)
  }
})

onBeforeUnmount(() => {
  disposed = true
  pageTasks.dispose()
  stopPolling()
  stopRestorePolling()
  listTask = null
  downloadOwners.clear()
  restoreOwners.clear()
  deleteOwners.clear()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

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
